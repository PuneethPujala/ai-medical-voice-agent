"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  MapPin,
  LocateFixed,
  Compass,
  Search,
  PhoneCall,
  ExternalLink,
  ShieldCheck,
  Building2,
  Clock,
  Car,
  Filter,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Navigation,
  Activity,
  Sparkles,
  Check,
} from "lucide-react";
import { SpecialtyIcon } from "@/components/care/SpecialtyIcon";
import { AppFooter } from "../_components/AppFooter";
import { HospitalItem } from "../_components/InteractiveRouteMap";
import { CardNav, RegionCardItem } from "@/components/navigation/CardNav";
import { MovingBorder } from "@/components/motion/MovingBorder";
import SplitText from "@/components/ui/SplitText";
import GradientText from "@/components/ui/GradientText";
import { AmbientPageBackground } from "@/components/ui/AmbientPageBackground";
import StarBorder from "@/components/ui/StarBorder";
import {
  ALL_REGION_PRESETS,
  RegionPresetItem,
  MEDICAL_ISSUE_OPTIONS,
  MedicalIssueOption,
  getHospitalFamousFor,
} from "@/lib/hospitals-india-data";
import { evaluateAndRankForSpecialty } from "@/lib/care-network/evaluator";

// Leaflet map dynamically imported with SSR disabled
const InteractiveRouteMap = dynamic(
  () => import("../_components/InteractiveRouteMap").then((mod) => mod.InteractiveRouteMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[460px] sm:h-[500px] rounded-3xl bg-slate-100/80 border border-slate-200/80 flex flex-col items-center justify-center gap-3 animate-pulse">
        <div className="w-8 h-8 rounded-full border-2 border-slate-900 border-t-transparent animate-spin" />
        <span className="text-xs font-semibold text-slate-500 font-mono">Loading road network...</span>
      </div>
    ),
  }
);

export type LocationStatus =
  | "LOCATION_UNKNOWN"
  | "LOCATION_PERMISSION_REQUESTED"
  | "LOCATION_PERMISSION_DENIED"
  | "LOCATION_RESOLVED"
  | "LOCATION_MANUALLY_SELECTED";

export type LocationSource = "gps" | "preset" | "search" | "manual_pin";

export interface CareOrigin {
  lat: number;
  lng: number;
  label: string;
  source: LocationSource;
  resolvedAt?: number;
}

const STORAGE_KEY = "medvoice_care_origin";
const PAGE_SIZE = 10;

export default function CarePage() {
  const [rawHospitals, setRawHospitals] = useState<HospitalItem[]>([]);
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null);
  const [showAllInRanked, setShowAllInRanked] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  // Authoritative location state machine
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("LOCATION_UNKNOWN");
  // Patient departure location state (where the user actually is) - strictly NULL on initial mount
  const [userLocation, setUserLocation] = useState<CareOrigin | null>(null);
  // Target hospital exploration region state - strictly NULL on initial mount
  const [searchRegion, setSearchRegion] = useState<CareOrigin | null>(null);

  // Non-authoritative previously saved location suggestion (requires explicit user action to activate)
  const [savedSuggestion, setSavedSuggestion] = useState<CareOrigin | null>(null);
  // Toggle for city picker dropdown/panel
  const [isChoosingCity, setIsChoosingCity] = useState<boolean>(false);

  const [isDetectingGps, setIsDetectingGps] = useState<boolean>(false);
  const [isManualPicking, setIsManualPicking] = useState<boolean>(false);

  // Live road stats calculated from map routing
  const [liveRoadStats, setLiveRoadStats] = useState<{ roadDistanceKm: number; etaMinutes: number } | null>(null);

  // User Mode Choice: "all" (Show All Hospitals) vs "issues" (Based on Health Issues)
  const [viewMode, setViewMode] = useState<"all" | "issues">("all");
  const [selectedZone, setSelectedZone] = useState<string>("all");

  // Step 1: Medical issue & specialty states
  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");
  const [issueSearchText, setIssueSearchText] = useState<string>("");

  const [ownershipFilter, setOwnershipFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"fastest" | "government" | "rating">("fastest");

  // True Pagination state (10 results per page)
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Step 2: Search autocomplete state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Mode switcher handler
  const handleSelectViewMode = (mode: "all" | "issues") => {
    setViewMode(mode);
    if (mode === "all") {
      setSpecialtyFilter("all");
      setIssueSearchText("");
    } else {
      if (specialtyFilter === "all") {
        setSpecialtyFilter("cardiology");
        setIssueSearchText("Heart & Cardiology");
      }
    }
    setUserSelectedId(null);
    setCurrentPage(1);
  };

  // Issue selection and search handlers
  const handleSelectSpecialty = (id: string, label?: string) => {
    setViewMode("issues");
    setSpecialtyFilter(id);
    setIssueSearchText(id === "all" ? "" : (label || id));
    setUserSelectedId(null);
    setCurrentPage(1);
  };

  const handleIssueInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setIssueSearchText(val);
    const trimmed = val.trim().toLowerCase();
    setViewMode("issues");
    setSpecialtyFilter(trimmed.length > 0 ? trimmed : "all");
    setUserSelectedId(null);
    setCurrentPage(1);
  };

  const handleClearIssue = () => {
    setIssueSearchText("");
    setSpecialtyFilter("all");
    setUserSelectedId(null);
    setCurrentPage(1);
  };

  // Unified hospital selection handler: updates selection, resets/syncs road stats, and triggers map route
  const handleSelectHospital = (hosp: HospitalItem, shouldScrollToMap: boolean = false) => {
    setUserSelectedId(hosp.id);
    setLiveRoadStats({
      roadDistanceKm: hosp.distanceKm,
      etaMinutes: hosp.etaMinutes || Math.max(3, Math.round(hosp.distanceKm * 1.5)),
    });
    if (shouldScrollToMap && typeof window !== "undefined") {
      const mapEl = document.getElementById("care-map-section");
      if (mapEl) {
        mapEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  };

  const handleResetToRecommended = () => {
    setUserSelectedId(null);
    if (recommendedHospital) {
      setLiveRoadStats({
        roadDistanceKm: recommendedHospital.distanceKm,
        etaMinutes: recommendedHospital.etaMinutes || Math.max(3, Math.round(recommendedHospital.distanceKm * 1.5)),
      });
    }
  };

  // 1. Session Storage on Mount: Non-authoritative suggestion ONLY.
  // Never automatically restores active location or triggers hospital discovery.
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const candidate = parsed?.userLocation || parsed;

        const allowedSources: LocationSource[] = ["gps", "preset", "search", "manual_pin"];
        const isValidSource = allowedSources.includes(candidate?.source);
        const hasValidCoords =
          candidate &&
          Number.isFinite(candidate.lat) &&
          Number.isFinite(candidate.lng) &&
          candidate.lat >= -90 &&
          candidate.lat <= 90 &&
          candidate.lng >= -180 &&
          candidate.lng <= 180;
        const isValidLabel = typeof candidate?.label === "string" && candidate.label.trim().length > 0;

        // Invalidate legacy default records (which had Amaravati 16.5131, 80.5165 without explicit user action)
        const isLegacyDefault =
          !candidate?.resolvedAt &&
          Math.abs(candidate?.lat - 16.5131) < 0.001 &&
          Math.abs(candidate?.lng - 80.5165) < 0.001;

        if (isValidSource && hasValidCoords && isValidLabel && !isLegacyDefault) {
          const restoredOrigin: CareOrigin = {
            lat: candidate.lat,
            lng: candidate.lng,
            label: candidate.label,
            source: candidate.source,
            resolvedAt: candidate.resolvedAt || Date.now(),
          };

          // NON-AUTHORITATIVE: Store strictly as an unconfirmed suggestion.
          // userLocation remains null, locationStatus remains LOCATION_UNKNOWN,
          // and ZERO hospital fetch requests are made until user confirms.
          setSavedSuggestion(restoredOrigin);
          return;
        } else {
          sessionStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch (e) {
      console.warn("Could not read saved search origin suggestion:", e);
      sessionStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // Explicit user confirmation to apply saved location suggestion
  const handleApplySuggestion = () => {
    if (!savedSuggestion) return;
    setUserLocation(savedSuggestion);
    setSearchRegion(savedSuggestion);
    const nextStatus: LocationStatus =
      savedSuggestion.source === "gps" ? "LOCATION_RESOLVED" : "LOCATION_MANUALLY_SELECTED";
    setLocationStatus(nextStatus);
    loadFacilities(savedSuggestion, savedSuggestion);
  };

  // User dismissal of saved suggestion
  const handleDismissSuggestion = () => {
    setSavedSuggestion(null);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch { }
    }
  };

  // User resets location to return to calm initial screen
  const handleResetLocation = () => {
    setUserLocation(null);
    setSearchRegion(null);
    setLocationStatus("LOCATION_UNKNOWN");
    setRawHospitals([]);
    setUserSelectedId(null);
    setLiveRoadStats(null);
    setIsChoosingCity(false);
  };

  // 2. Fetch facilities based on target region and user departure location
  // STRICTLY GATED: Cannot run unless departureOrigin and targetRegion have valid numeric coordinates
  const loadFacilities = async (
    targetRegion: CareOrigin,
    departureOrigin: CareOrigin
  ) => {
    if (
      !targetRegion ||
      !Number.isFinite(targetRegion.lat) ||
      !Number.isFinite(targetRegion.lng) ||
      !departureOrigin ||
      !Number.isFinite(departureOrigin.lat) ||
      !Number.isFinite(departureOrigin.lng)
    ) {
      console.warn("[CarePage] Aborted loadFacilities: Missing verified departure coordinates.");
      return;
    }

    setLoading(true);
    setCurrentPage(1);
    try {
      // Fetch ALL hospitals for this location — NO specialty param.
      // Specialty evaluation happens locally via useMemo (instant, zero latency).
      const res = await fetch(
        `/api/hospitals?lat=${targetRegion.lat}&lng=${targetRegion.lng}&patientLat=${departureOrigin.lat}&patientLng=${departureOrigin.lng}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.hospitals && data.hospitals.length > 0) {
          const list: HospitalItem[] = data.hospitals;
          setRawHospitals(list);
          setUserSelectedId(null);
          const first = list[0] || null;
          if (first) {
            setLiveRoadStats({
              roadDistanceKm: first.distanceKm,
              etaMinutes: first.etaMinutes || Math.max(3, Math.round(first.distanceKm * 1.5)),
            });
          }
        } else {
          setRawHospitals([]);
          setUserSelectedId(null);
          setLiveRoadStats(null);
        }
      }
      setSearchRegion(targetRegion);
      setUserLocation(departureOrigin);

      // Persist ONLY verified, explicitly resolved/selected location
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              userLocation: departureOrigin,
              searchRegion: targetRegion,
              resolvedAt: Date.now(),
            })
          );
        } catch { }
      }
    } catch (e) {
      console.warn("Failed to load facilities:", e);
    } finally {
      setLoading(false);
    }
  };

  // NOTE: No useEffect([specialtyFilter]) — specialty changes are handled
  //       entirely by the useMemo below (instant, zero network requests).

  // Handle GPS detection: strictly user-initiated
  const handleDetectLiveLocation = () => {
    if (typeof window === "undefined") return;

    if (!("geolocation" in navigator)) {
      setLocationStatus("LOCATION_PERMISSION_DENIED");
      return;
    }

    setLocationStatus("LOCATION_PERMISSION_REQUESTED");
    setIsDetectingGps(true);

    const onLocationSuccess = async (pos: GeolocationPosition) => {
      const { latitude, longitude } = pos.coords;
      let label = "Your Live Location";
      try {
        const revRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16`,
          { signal: AbortSignal.timeout(2500) }
        );
        if (revRes.ok) {
          const revData = await revRes.json();
          if (revData.address) {
            const area =
              revData.address.suburb ||
              revData.address.neighbourhood ||
              revData.address.residential ||
              revData.address.road ||
              revData.address.city ||
              "Current Location";
            const city = revData.address.city || revData.address.state_district || revData.address.state || "";
            label = `Near ${area}${city ? `, ${city}` : ""}`;
          }
        }
      } catch { }

      const newGpsOrigin: CareOrigin = {
        lat: latitude,
        lng: longitude,
        label,
        source: "gps",
        resolvedAt: Date.now(),
      };

      setUserLocation(newGpsOrigin);
      setSearchRegion(newGpsOrigin);
      setLocationStatus("LOCATION_RESOLVED");
      setIsDetectingGps(false);
      setSearchQuery("");
      loadFacilities(newGpsOrigin, newGpsOrigin);
    };

    const onLocationError = (err: GeolocationPositionError) => {
      console.warn("[CarePage] Geolocation failed/denied:", err.message);
      setIsDetectingGps(false);
      setLocationStatus("LOCATION_PERMISSION_DENIED");
      // NEVER silently substitute Vijayawada or trigger fallback discovery.
      // ZERO hospital requests are triggered.
    };

    navigator.geolocation.getCurrentPosition(onLocationSuccess, onLocationError, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 60000,
    });
  };

  // Handle preset city selection: explicit user choice
  const handleSelectPreset = (preset: RegionPresetItem) => {
    setIsManualPicking(false);
    setSearchQuery("");
    setShowDropdown(false);
    const chosenOrigin: CareOrigin = {
      lat: preset.lat,
      lng: preset.lng,
      label: preset.label,
      source: "preset",
      resolvedAt: Date.now(),
    };
    setUserLocation(chosenOrigin);
    setSearchRegion(chosenOrigin);
    setLocationStatus("LOCATION_MANUALLY_SELECTED");
    loadFacilities(chosenOrigin, chosenOrigin);
  };

  // Handle Search Input Autocomplete
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (query.trim().length >= 3) {
      setIsSearching(true);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
              query + ", India"
            )}&limit=5&countrycodes=in`,
            { signal: AbortSignal.timeout(3000) }
          );
          if (res.ok) {
            const data = await res.json();
            setSearchResults(data);
            setShowDropdown(true);
          }
        } catch {
          setSearchResults([]);
        } finally {
          setIsSearching(false);
        }
      }, 350);
    } else {
      setSearchResults([]);
      setShowDropdown(false);
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (result: { display_name: string; lat: string; lon: string }) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    setShowDropdown(false);
    setSearchQuery("");
    setIsManualPicking(false);
    const labelParts = result.display_name.split(",");
    const shortLabel = labelParts.slice(0, 2).join(",").trim();
    const chosenOrigin: CareOrigin = {
      lat,
      lng,
      label: shortLabel,
      source: "search",
      resolvedAt: Date.now(),
    };
    setUserLocation(chosenOrigin);
    setSearchRegion(chosenOrigin);
    setLocationStatus("LOCATION_MANUALLY_SELECTED");
    loadFacilities(chosenOrigin, chosenOrigin);
  };

  const handleConfirmManualLocation = async (lat: number, lng: number) => {
    setIsManualPicking(false);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    let label = `Selected Pin (${lat.toFixed(3)}°N, ${lng.toFixed(3)}°E)`;
    try {
      const revRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`,
        { signal: AbortSignal.timeout(2500) }
      );
      if (revRes.ok) {
        const revData = await revRes.json();
        if (revData.address) {
          const area =
            revData.address.suburb ||
            revData.address.neighbourhood ||
            revData.address.residential ||
            revData.address.road ||
            revData.address.city ||
            "Selected Location";
          const city = revData.address.city || revData.address.state_district || revData.address.state || "";
          label = `Near ${area}${city ? `, ${city}` : ""}`;
        }
      }
    } catch { }

    const newOrigin: CareOrigin = {
      lat,
      lng,
      label,
      source: "manual_pin",
      resolvedAt: Date.now(),
    };
    setUserLocation(newOrigin);
    setSearchRegion(newOrigin);
    setLocationStatus("LOCATION_MANUALLY_SELECTED");
    loadFacilities(newOrigin, newOrigin);
  };

  const handleSetRegionAsDeparture = () => {
    if (searchRegion) {
      loadFacilities(searchRegion, searchRegion);
    }
  };

  // ─── LOCAL SPECIALTY EVALUATION (instant, zero network requests) ───────────
  // evaluateAndRankForSpecialty runs the same CATEGORY_RULES matching that was
  // previously done server-side, but now executes in useMemo on rawHospitals.
  // Changing specialtyFilter → instant re-rank, no "0 MATCHING FACILITIES" flicker.
  const evaluationResult = useMemo(() => {
    if (rawHospitals.length === 0) {
      return {
        ranked: [] as HospitalItem[],
        categoryFallback: false,
        fallbackBanner: null as string | null,
        categoryLabel: "All Hospitals & 24/7 ERs",
        categoryClass: "emergency",
      };
    }
    return evaluateAndRankForSpecialty(rawHospitals, specialtyFilter);
  }, [rawHospitals, specialtyFilter]);

  const { categoryFallback, fallbackBanner, categoryLabel, categoryClass } = evaluationResult;

  // Filter & Sort: Apply ownership filter and sort on top of evaluated results
  const filteredAndSortedHospitals = useMemo(() => {
    let list = [...evaluationResult.ranked];

    // Ownership filter
    if (ownershipFilter === "government") {
      list = list.filter((h) => (h as any).ownership === "government");
    } else if (ownershipFilter === "private") {
      list = list.filter((h) => (h as any).ownership === "private");
    }

    // Sort order: When a medical issue is active, always put specialized facilities first!
    if (sortBy === "fastest") {
      list.sort((a, b) => {
        if (specialtyFilter !== "all") {
          const aEl = a.isEligible ? 1 : 0;
          const bEl = b.isEligible ? 1 : 0;
          if (aEl !== bEl) return bEl - aEl;
        }
        return a.distanceKm - b.distanceKm;
      });
    } else if (sortBy === "government") {
      list.sort((a, b) => {
        if (specialtyFilter !== "all") {
          const aEl = a.isEligible ? 1 : 0;
          const bEl = b.isEligible ? 1 : 0;
          if (aEl !== bEl) return bEl - aEl;
        }
        const aGov = (a as any).ownership === "government" ? 1 : 0;
        const bGov = (b as any).ownership === "government" ? 1 : 0;
        if (aGov !== bGov) return bGov - aGov;
        return a.distanceKm - b.distanceKm;
      });
    } else if (sortBy === "rating") {
      list.sort((a, b) => {
        if (specialtyFilter !== "all") {
          const aEl = a.isEligible ? 1 : 0;
          const bEl = b.isEligible ? 1 : 0;
          if (aEl !== bEl) return bEl - aEl;
        }
        return (b.rating || 0) - (a.rating || 0);
      });
    }

    return list.map((h, idx) => ({
      ...h,
      rank: idx + 1,
    }));
  }, [evaluationResult.ranked, ownershipFilter, sortBy, specialtyFilter]);

  // Primary recommended facility (#1)
  const recommendedHospital = useMemo(() => {
    return filteredAndSortedHospitals[0] || null;
  }, [filteredAndSortedHospitals]);

  // Authoritative selected facility: user clicked override OR default recommended #1
  const selectedHospital = useMemo(() => {
    if (!userSelectedId) return recommendedHospital;
    return filteredAndSortedHospitals.find((h) => h.id === userSelectedId) || recommendedHospital;
  }, [userSelectedId, recommendedHospital, filteredAndSortedHospitals]);

  // Breakdown of specialized vs other facilities
  const specializedCount = useMemo(() => {
    return filteredAndSortedHospitals.filter((h) => h.isEligible).length;
  }, [filteredAndSortedHospitals]);

  // True Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredAndSortedHospitals.length / PAGE_SIZE));
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filteredAndSortedHospitals.length);

  // Sliced 10 facilities for the active page
  const pageHospitals = useMemo(() => {
    return filteredAndSortedHospitals.slice(startIndex, endIndex);
  }, [filteredAndSortedHospitals, startIndex, endIndex]);

  // Generate pagination numbers (1, 2, 3... totalPages)
  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push(-1); // Ellipsis
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push(-1); // Ellipsis
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, currentPage]);

  const currentGoogleMapsUrl = selectedHospital && userLocation
    ? `https://www.google.com/maps/dir/?api=1&origin=${userLocation.lat},${userLocation.lng}&destination=${selectedHospital.latitude},${selectedHospital.longitude}&travelmode=driving`
    : selectedHospital
    ? `https://www.google.com/maps/search/?api=1&query=${selectedHospital.latitude},${selectedHospital.longitude}`
    : "#";

  return (
    <AmbientPageBackground>
      <main className="relative z-10 flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-16 flex flex-col gap-6">

        {/* ========================================================================= */}
        {/* CASE 1: LOCATION UNKNOWN — CALM, QUIET LUXURY FIRST IMPRESSION            */}
        {/* The map, routes, and hospital fetches DO NOT appear until user authorizes */}
        {/* ========================================================================= */}
        {!userLocation && !isManualPicking ? (
          <section className="py-10 sm:py-20 max-w-2xl mx-auto w-full flex flex-col items-center text-center gap-6">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-50/90 text-cyan-700 border border-cyan-200/90 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-600" />
              <span>Care Network · 36+ Regions</span>
            </div>

            <div className="space-y-2">
              <SplitText
                text="Find verified care near you"
                tag="h1"
                className="text-3xl sm:text-5xl font-semibold tracking-tight text-slate-900"
              />
              <div className="pt-0.5">
                <GradientText
                  colors={["#0284c7", "#06b6d4", "#0f172a"]}
                  className="text-xs sm:text-sm font-bold uppercase tracking-wider font-mono"
                >
                  Regional Trauma & Specialist Reachability Network
                </GradientText>
              </div>
              <p className="text-sm sm:text-base text-slate-600 max-w-lg mx-auto leading-relaxed">
                Choose where you're starting from to calculate road reachability, emergency travel times, and specialist on-duty coverage.
              </p>
            </div>

            {/* NON-AUTHORITATIVE SAVED SUGGESTION (Requires explicit user confirmation) */}
            {savedSuggestion && (
              <div className="w-full p-4 rounded-2xl bg-white border border-slate-200/90 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-left">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#FAF9F6] border border-slate-200/90 flex items-center justify-center text-cyan-700 shrink-0">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[11px] font-semibold text-cyan-700 uppercase tracking-wide block">
                      Last used location
                    </span>
                    <span className="text-xs sm:text-sm font-semibold text-slate-900 truncate block">
                      {savedSuggestion.label}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  <button
                    onClick={handleApplySuggestion}
                    className="px-4 py-2 rounded-xl bg-slate-950 hover:bg-slate-900 text-white text-xs font-semibold shadow-xs border border-slate-800 active:scale-[0.98] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                  >
                    Use this location
                  </button>
                  <button
                    onClick={handleDismissSuggestion}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-950 bg-white hover:bg-slate-50 border border-slate-200/90 hover:border-slate-300 rounded-xl shadow-2xs transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* PRIMARY ONBOARDING ACTIONS */}
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
              <StarBorder
                as="button"
                onClick={() => handleDetectLiveLocation()}
                disabled={isDetectingGps}
                color="#38bdf8"
                duration={3.5}
                theme="dark"
                backgroundColor="#090D16"
                textColor="#ffffff"
                borderColor="rgba(255, 255, 255, 0.15)"
                radius={12}
                className="w-full sm:w-auto cursor-pointer shadow-xs border border-slate-800 hover:bg-slate-900 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 text-sm font-semibold px-6 py-3.5"
              >
                <div className="flex items-center justify-center gap-2">
                  <LocateFixed className={`w-4 h-4 text-cyan-400 ${isDetectingGps ? "animate-spin" : ""}`} />
                  <span>{isDetectingGps ? "Locating..." : "Use my live location"}</span>
                </div>
              </StarBorder>

              <button
                onClick={() => setIsChoosingCity(!isChoosingCity)}
                className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold border shadow-2xs hover:shadow-xs active:scale-[0.98] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
                  isChoosingCity
                    ? "bg-slate-950 text-white border-slate-900 shadow-xs"
                    : "bg-white hover:bg-slate-50 text-slate-800 hover:text-slate-950 border border-slate-200/90 hover:border-slate-300"
                }`}
              >
                <Building2 className={`w-4 h-4 ${isChoosingCity ? "text-cyan-400" : "text-cyan-700"}`} />
                <span>{isChoosingCity ? "Hide city selector" : "Choose a city or region"}</span>
              </button>
            </div>

            {locationStatus === "LOCATION_PERMISSION_DENIED" && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2 max-w-md">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <span>Location permission was denied or timed out. Please choose a city or search below.</span>
              </div>
            )}

            {/* EXPANDABLE CITY & REGION SELECTOR */}
            {isChoosingCity && (
              <div className="w-full p-5 sm:p-6 rounded-3xl bg-white border border-slate-200/90 shadow-xs flex flex-col gap-5 text-left animate-in fade-in duration-200">
                <div className="flex items-center justify-between border-b border-slate-200/90 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Select Region or Search Any City</h3>
                    <p className="text-xs text-slate-600">Coverage across 36+ verified healthcare networks in India</p>
                  </div>
                  <button
                    onClick={() => {
                      setIsChoosingCity(false);
                      setIsManualPicking(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-800 hover:text-slate-950 text-xs font-semibold shadow-2xs active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <Compass className="w-3.5 h-3.5 text-cyan-700" />
                    <span>Pick on map</span>
                  </button>
                </div>

                {/* Autocomplete Input */}
                <div className="relative">
                  <div className="relative flex items-center">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={handleSearchChange}
                      onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                      placeholder="Search any city, town, or pincode (e.g. Pune, Bangalore, Amaravati, Guntur)..."
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-white border border-slate-200/90 focus:border-cyan-600 focus:ring-2 focus:ring-cyan-50 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 transition-all outline-none"
                    />
                    {isSearching && (
                      <div className="w-4 h-4 rounded-full border-2 border-cyan-600 border-t-transparent animate-spin absolute right-3.5" />
                    )}
                  </div>

                  {/* Dropdown */}
                  {showDropdown && searchResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200/90 shadow-lg z-50 overflow-hidden">
                      {searchResults.map((item, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSelectSearchResult(item)}
                          className="w-full px-4 py-2.5 text-left text-xs text-slate-900 hover:bg-cyan-50/90 hover:text-cyan-700 flex items-center gap-2.5 transition-colors border-b border-slate-200/90 last:border-b-0 cursor-pointer"
                        >
                          <MapPin className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
                          <span className="truncate">{item.display_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Zone Filter */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                  <span className="text-[11px] font-semibold text-slate-400 mr-1 shrink-0">Zone:</span>
                  {[
                    { id: "all", label: "All Regions (36+)" },
                    { id: "ap_tg", label: "AP & Telangana (15)" },
                    { id: "south", label: "South (KA, TN, KL)" },
                    { id: "west", label: "West (MH, GJ, GA)" },
                    { id: "north", label: "North (DL, NCR, UP, RJ)" },
                    { id: "east_central", label: "East & Central" },
                  ].map((zone) => (
                    <button
                      key={zone.id}
                      onClick={() => setSelectedZone(zone.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs transition-all cursor-pointer border active:scale-[0.98] ${
                        selectedZone === zone.id
                          ? "bg-slate-950 text-white font-bold border-slate-900 shadow-xs"
                          : "bg-white text-slate-700 border-slate-200/90 hover:bg-slate-50 hover:text-slate-950 font-semibold shadow-2xs"
                      }`}
                    >
                      {zone.label}
                    </button>
                  ))}
                </div>

                {/* Preset Pills */}
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  {ALL_REGION_PRESETS.filter(
                    (p) => selectedZone === "all" || p.zone === selectedZone
                  ).map((preset) => {
                    const isSelected = savedSuggestion?.label === preset.name;
                    return (
                      <button
                        key={preset.name}
                        onClick={() => handleSelectPreset(preset)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer active:scale-[0.97] ${
                          isSelected
                            ? "bg-slate-950 text-white font-bold border border-slate-900 shadow-xs"
                            : "bg-white hover:bg-slate-50 hover:text-slate-950 text-slate-700 border border-slate-200/90 hover:border-slate-300 shadow-2xs"
                        }`}
                      >
                        {preset.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        ) : (
          /* ========================================================================= */
          /* CASE 2: LOCATION RESOLVED / PIN PICKING — DOMINANT WORKSPACE             */
          /* ========================================================================= */
          <>
            {/* COMPACT TOOL HEADER */}
            <header className="flex flex-col gap-2 pt-1 pb-1">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-50/90 text-cyan-700 border border-cyan-200/90 text-xs font-semibold mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-600" />
                    <span>Care Network</span>
                  </div>
                  <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight text-slate-900">
                    Care Network
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-600 mt-0.5 max-w-xl">
                    Verified healthcare facilities and reachable road routing from your departure point.
                  </p>
                </div>

                {/* Location Status Bar */}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-slate-200/90 shadow-xs">
                    {isDetectingGps ? (
                      <div className="flex items-center gap-2 text-cyan-700">
                        <span className="w-2 h-2 rounded-full border-2 border-cyan-600 border-t-transparent animate-spin" />
                        <span className="font-semibold">Locating with GPS...</span>
                      </div>
                    ) : userLocation ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-cyan-600" />
                        <span className="text-slate-600 font-medium">Starting point:</span>
                        <span className="text-slate-900 font-semibold truncate max-w-[180px] sm:max-w-[240px]">
                          {userLocation.label}
                        </span>
                        <button
                          onClick={handleResetLocation}
                          className="ml-1 text-[11px] font-semibold text-cyan-700 hover:underline cursor-pointer"
                        >
                          Change
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-slate-600">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <span className="font-semibold">Placing pin on map...</span>
                        <button
                          onClick={handleResetLocation}
                          className="ml-1 text-[11px] font-semibold text-slate-600 hover:underline cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </header>

            {/* DISCOVERY MODE TOGGLE */}
            <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              <div>
                <h3 className="text-xs sm:text-sm font-semibold text-slate-900">
                  Hospital discovery mode
                </h3>
                <p className="text-[11px] sm:text-xs text-slate-600">
                  Explore all accredited 24/7 facilities or filter by specific medical conditions.
                </p>
              </div>

              <div className="flex items-center gap-1.5 p-1.5 bg-slate-100/90 rounded-2xl border border-slate-200/90 shrink-0">
                <button
                  onClick={() => handleSelectViewMode("all")}
                  className={`px-4 py-2 rounded-xl text-xs transition-all cursor-pointer ${
                    viewMode === "all"
                      ? "bg-slate-950 text-white font-bold shadow-xs border border-slate-900"
                      : "bg-transparent text-slate-700 hover:text-slate-950 font-semibold"
                  }`}
                >
                  All Hospitals & 24/7 ERs
                </button>

                <button
                  onClick={() => handleSelectViewMode("issues")}
                  className={`px-4 py-2 rounded-xl text-xs transition-all cursor-pointer ${
                    viewMode === "issues"
                      ? "bg-slate-950 text-white font-bold shadow-xs border border-slate-900"
                      : "bg-transparent text-slate-700 hover:text-slate-950 font-semibold"
                  }`}
                >
                  Filter by Condition
                </button>
              </div>
            </div>

            {/* CONDITION FILTER SECTION (Active when viewMode === 'issues') */}
            {viewMode === "issues" && (
              <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs flex flex-col gap-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h2 className="text-xs sm:text-sm font-semibold text-slate-900">
                      Filter by medical condition
                    </h2>
                    <p className="text-[11px] text-slate-600">
                      Prioritizes facilities verified for the selected specialty
                    </p>
                  </div>
                  {specialtyFilter !== "all" && (
                    <span className="text-[11px] font-semibold text-cyan-700 bg-cyan-50/90 px-2.5 py-0.5 rounded-full border border-cyan-200/90">
                      Active: {specialtyFilter}
                    </span>
                  )}
                </div>

                <div className="relative flex items-center">
                  <div className="absolute left-3.5 pointer-events-none flex items-center justify-center">
                    {specialtyFilter !== "all" ? (
                      <SpecialtyIcon id={specialtyFilter} className="w-4 h-4" />
                    ) : (
                      <Activity className="w-4 h-4 text-cyan-700" />
                    )}
                  </div>
                  <input
                    type="text"
                    value={issueSearchText}
                    onChange={handleIssueInputChange}
                    placeholder="Search any condition (e.g. Heart, Stroke, Fracture, Ayurveda, Kidney, Maternity, Eye)..."
                    className="w-full pl-10 pr-16 py-2.5 rounded-xl bg-white border border-slate-200/90 focus:border-cyan-600 focus:ring-2 focus:ring-cyan-50 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 transition-all outline-none"
                  />
                  {issueSearchText && (
                    <button
                      type="button"
                      onClick={handleClearIssue}
                      className="absolute right-3 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:text-slate-950 bg-white hover:bg-slate-50 border border-slate-200/90 rounded-xl shadow-2xs transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-2.5 pt-1">
                  {MEDICAL_ISSUE_OPTIONS.map((item) => {
                    const isActive = specialtyFilter === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelectSpecialty(item.id, item.label)}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-0.5 active:scale-[0.98] ${
                          isActive
                            ? "bg-slate-950 text-white border-slate-900 shadow-xs font-bold"
                            : "bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90 hover:border-slate-300 font-medium shadow-2xs"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <SpecialtyIcon id={item.id} className="w-4 h-4 shrink-0" />
                          <span className="text-xs font-semibold truncate">{item.label}</span>
                        </div>
                        <span className={`text-[10px] truncate ${isActive ? "text-cyan-400 font-semibold" : "text-slate-600"}`}>
                          {item.famousFor}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* DOMINANT WORKSPACE: LIVE MAP + RANKED FACILITIES LIST */}
            <div id="care-map-section" className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch scroll-mt-24">

              {/* LEFT: Dominant Live Route Map (58% width on large screens) */}
              <div className="lg:col-span-7 rounded-2xl overflow-hidden shadow-xs border border-slate-200/90 bg-white min-h-[480px] lg:min-h-[640px] flex flex-col">
                <InteractiveRouteMap
                  patientCoords={userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null}
                  patientLocationName={userLocation?.label}
                  mapCenter={searchRegion ? { lat: searchRegion.lat, lng: searchRegion.lng } : undefined}
                  selectedHospital={selectedHospital}
                  allHospitals={filteredAndSortedHospitals}
                  isManualPicking={isManualPicking}
                  onSelectHospital={(h) => handleSelectHospital(h, false)}
                  onConfirmManualLocation={handleConfirmManualLocation}
                  onCancelManualPicking={() => setIsManualPicking(false)}
                  onRouteCalculated={(stats) => setLiveRoadStats(stats)}
                  onResetToRecommended={handleResetToRecommended}
                  onRequestLocation={() => handleDetectLiveLocation()}
                />
              </div>

              {/* RIGHT: Decoupled Current Destination + All Matching Facilities Rail (42% width) */}
              <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs p-4 sm:p-5 flex flex-col gap-3.5 max-h-[640px] lg:max-h-[680px] overflow-hidden">

                {/* CATEGORY FALLBACK ALERT BANNER */}
                {categoryFallback && fallbackBanner && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start gap-2.5 shadow-xs shrink-0">
                    <span className="text-base leading-none shrink-0 mt-0.5">⚠️</span>
                    <div className="flex-1 leading-snug">
                      <strong className="font-bold text-amber-900 block mb-0.5">Category fallback active</strong>
                      <span className="text-[11px] text-amber-800">{fallbackBanner}</span>
                    </div>
                  </div>
                )}

                {/* SECTION 1: CURRENT DESTINATION CARD (Driven by selectedHospital) */}
                <div className="rounded-2xl bg-white border border-slate-200/90 p-4 flex flex-col gap-3 shrink-0 shadow-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/90">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-600 animate-pulse" />
                      <span className="text-[10.5px] font-bold text-slate-900 uppercase tracking-wider font-mono">
                        Current Destination
                      </span>
                    </div>
                    {selectedHospital && selectedHospital.id !== recommendedHospital?.id && (
                      <button
                        onClick={handleResetToRecommended}
                        className="px-2.5 py-1 rounded-xl bg-white hover:bg-slate-50 text-slate-800 hover:text-slate-950 border border-slate-200/90 text-xs font-medium shadow-2xs transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <span>Return to #1 Match</span>
                      </button>
                    )}
                  </div>

                  {selectedHospital ? (
                    <>
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span
                              className={`w-6 h-6 rounded-md flex items-center justify-center font-bold text-xs text-white shrink-0 ${
                                selectedHospital.id === recommendedHospital?.id ? "bg-slate-950" : "bg-slate-800"
                              }`}
                            >
                              #{selectedHospital.rank}
                            </span>
                            <h4 className="text-xs sm:text-sm font-bold text-slate-900 truncate" title={selectedHospital.name}>
                              {selectedHospital.name}
                            </h4>
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            {selectedHospital.isFallback ? (
                              <span className="bg-rose-50 text-rose-800 border border-rose-200 rounded-lg text-xs font-mono font-semibold px-2.5 py-1">
                                Fallback · Nearest 24/7 ER
                              </span>
                            ) : (
                              <span className="bg-cyan-50 text-cyan-800 border border-cyan-200 rounded-lg text-xs font-mono font-semibold px-2.5 py-1">
                                Matched: {selectedHospital.matchedCategory || categoryLabel} · {selectedHospital.matchTier === "verified" ? "Verified" : "Inferred"}
                              </span>
                            )}
                            <span className="bg-slate-100 text-slate-800 border border-slate-200/80 rounded-lg text-xs font-mono font-medium px-2.5 py-1 truncate max-w-[200px]">
                              {selectedHospital.famousFor || getHospitalFamousFor(selectedHospital)}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-600 truncate mt-1.5">
                            {selectedHospital.address}
                          </p>
                        </div>

                        <div className="flex flex-col items-end shrink-0 text-right">
                          <span className="text-xs sm:text-sm font-bold text-slate-900">
                            ~{liveRoadStats ? liveRoadStats.etaMinutes : (selectedHospital.etaMinutes || 12)} min
                          </span>
                          <span className="text-[11px] text-slate-600">
                            ~{liveRoadStats ? liveRoadStats.roadDistanceKm.toFixed(1) : selectedHospital.distanceKm.toFixed(1)} km by road
                          </span>
                        </div>
                      </div>

                      {/* Verified capability tags */}
                      <div className="flex items-center gap-1.5 flex-wrap text-xs">
                        {selectedHospital.isEmergency24x7 ? (
                          <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-mono font-semibold px-2.5 py-1">
                            ✓ 24/7 Verified Emergency
                          </span>
                        ) : (
                          <span className="bg-slate-100 text-slate-800 border border-slate-200/80 rounded-lg text-xs font-mono font-medium px-2.5 py-1">
                            Specialty OPD
                          </span>
                        )}
                        <span className="bg-slate-100 text-slate-800 border border-slate-200/80 rounded-lg text-xs font-mono font-medium px-2.5 py-1">
                          ✓ {(selectedHospital as any).ownership === "government" ? "Government" : "Private"}
                        </span>
                        {selectedHospital.acceptsPublicInsurance && (
                          <span className="bg-slate-100 text-slate-800 border border-slate-200/80 rounded-lg text-xs font-mono font-medium px-2.5 py-1">
                            ✓ Ayushman / PM-JAY
                          </span>
                        )}
                      </div>

                      {/* Why Ranked #1 Box (when #1 is selected) */}
                      {selectedHospital.id === recommendedHospital?.id && selectedHospital.matchReasons && selectedHospital.matchReasons.length > 0 && (
                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-800 flex flex-col gap-1.5">
                          <span className="font-bold flex items-center gap-1 text-slate-900">
                            <Sparkles className="w-3.5 h-3.5 text-cyan-600" /> Why ranked #1:
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedHospital.matchReasons.map((reason, rIdx) => (
                              <span key={rIdx} className="bg-slate-100 text-slate-800 border border-slate-200/80 rounded-lg px-2.5 py-1 text-xs font-mono font-medium inline-flex items-center gap-1.5">
                                <Check className="w-3 h-3 text-emerald-600" /> {reason}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 pt-0.5">
                        <a
                          href={`tel:${selectedHospital.emergencyPhone || selectedHospital.phone || "108"}`}
                          className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-white font-semibold text-xs shadow-xs active:scale-[0.98] transition-all cursor-pointer ${
                            selectedHospital.actionType === "call_hospital"
                              ? "bg-slate-950 hover:bg-slate-900"
                              : "bg-rose-600 hover:bg-rose-700"
                          }`}
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          <span>{selectedHospital.actionType === "call_hospital" ? "Call hospital" : "Call ED"}</span>
                        </a>
                        <a
                          href={
                            userLocation
                              ? `https://www.google.com/maps/dir/?api=1&origin=${userLocation.lat},${userLocation.lng}&destination=${selectedHospital.latitude},${selectedHospital.longitude}&travelmode=driving`
                              : `https://www.google.com/maps/search/?api=1&query=${selectedHospital.latitude},${selectedHospital.longitude}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white hover:bg-slate-50 text-slate-800 font-medium text-xs border border-slate-200/90 shadow-2xs active:scale-[0.98] transition-all cursor-pointer"
                        >
                          <Navigation className="w-3.5 h-3.5 text-slate-500" />
                          <span>Directions</span>
                        </a>
                      </div>
                    </>
                  ) : (
                    <div className="p-3 text-center text-xs text-slate-600">
                      No destination selected. Select any facility below or on the map.
                    </div>
                  )}
                </div>

                {/* SECTION 2: ALL MATCHING FACILITIES RAIL */}
                <div className="flex flex-col gap-2 min-h-0 flex-1">
                  <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200/90 shrink-0">
                    <div className="min-w-0">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider truncate">
                        {filteredAndSortedHospitals.length} Matching Facilities
                      </h3>
                      <p className="text-[10.5px] text-slate-600 truncate">
                        Ranked for {categoryLabel} · Select any to route
                      </p>
                    </div>
                    <select
                      value={sortBy}
                      onChange={(e) => {
                        setSortBy(e.target.value as any);
                        setCurrentPage(1);
                      }}
                      aria-label="Sort order"
                      className="text-xs font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-200/90 shadow-2xs rounded-xl px-2.5 py-1.5 focus:outline-none transition-all cursor-pointer shrink-0"
                    >
                      <option value="fastest">Best Match / Fastest</option>
                      <option value="government">Government First</option>
                      <option value="rating">Highest Rating</option>
                    </select>
                  </div>

                  {/* SCROLLABLE LIST OF ALL FACILITIES */}
                  <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2 min-h-0">
                    {loading ? (
                      <div className="py-12 text-center text-xs text-slate-600 flex items-center justify-center gap-2">
                        <div className="w-4 h-4 rounded-full border-2 border-cyan-600 border-t-transparent animate-spin" />
                        <span>Evaluating verified facilities nearby...</span>
                      </div>
                    ) : filteredAndSortedHospitals.length === 0 ? (
                      <div className="p-8 rounded-2xl bg-white border border-slate-200/90 text-center flex flex-col items-center justify-center gap-2 shadow-xs">
                        <Building2 className="w-6 h-6 text-slate-400" />
                        <p className="text-xs font-semibold text-slate-900">No facilities matching criteria</p>
                      </div>
                    ) : (
                      filteredAndSortedHospitals.map((hosp) => {
                        const isSelected = selectedHospital?.id === hosp.id;
                        const isBest = recommendedHospital?.id === hosp.id;
                        const distanceNum = isSelected && liveRoadStats ? liveRoadStats.roadDistanceKm : hosp.distanceKm;
                        const durationNum = isSelected && liveRoadStats ? liveRoadStats.etaMinutes : hosp.etaMinutes || Math.max(3, Math.round(distanceNum * 1.5));
                        const isGovernment = (hosp as any).ownership === "government";
                        const famousFor = hosp.famousFor || getHospitalFamousFor(hosp);

                        return (
                          <div
                            key={hosp.id}
                            onClick={() => handleSelectHospital(hosp)}
                            className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5 ${
                              isSelected
                                ? "bg-slate-950/5 border-slate-900 shadow-xs ring-1 ring-slate-900/20"
                                : "bg-white hover:bg-slate-50 border border-slate-200/90 shadow-xs"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-2 min-w-0">
                                <div
                                  className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[11px] shrink-0 ${
                                    isSelected
                                      ? "bg-slate-950 text-white shadow-xs"
                                      : isBest
                                      ? "bg-cyan-50 text-cyan-800 border border-cyan-300"
                                      : "bg-slate-100 text-slate-700 border border-slate-200"
                                  }`}
                                >
                                  #{hosp.rank}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <h4 className="text-xs font-bold text-slate-900 truncate" title={hosp.name}>
                                      {hosp.name}
                                    </h4>
                                    {isSelected && (
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-slate-950 text-white uppercase tracking-wider">
                                        Destination
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-lg bg-slate-100 text-slate-800 border border-slate-200/80 truncate max-w-[160px]">
                                      {famousFor}
                                    </span>
                                    <span className="text-[10px] text-slate-600">
                                      {hosp.isEmergency24x7 ? "24/7 ER" : "OPD"} · {isGovernment ? "Govt" : "Private"}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-col items-end shrink-0 text-right">
                                <span className="text-xs font-bold text-slate-900">
                                  ~{durationNum}m
                                </span>
                                <span className="text-[10px] text-slate-600">
                                  ~{distanceNum.toFixed(1)} km
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>
            </div>

            {/* FILTER & SORT BAR */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-900">
                  {filteredAndSortedHospitals.length} facilities match criteria
                </span>
                {filteredAndSortedHospitals.length > 0 && (
                  <span className="text-xs text-slate-600">
                    · Showing {startIndex + 1}–{endIndex} of {filteredAndSortedHospitals.length}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs flex-wrap">
                {/* Sort */}
                <div className="flex items-center gap-1 bg-white hover:bg-slate-50 border border-slate-200/90 shadow-2xs rounded-xl px-2.5 py-1.5 transition-all">
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  <select
                    value={sortBy}
                    onChange={(e) => {
                      setSortBy(e.target.value as any);
                      setCurrentPage(1);
                    }}
                    aria-label="Sort order"
                    className="text-xs font-medium text-slate-800 bg-transparent focus:outline-none cursor-pointer"
                  >
                    <option value="fastest">Sort: Fastest / Closest</option>
                    <option value="government">Sort: Government First</option>
                    <option value="rating">Sort: Highest Rating</option>
                  </select>
                </div>

                {/* Specialty */}
                <select
                  value={specialtyFilter}
                  onChange={(e) => {
                    setSpecialtyFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="Clinical capability filter"
                  className="bg-white hover:bg-slate-50 border border-slate-200/90 shadow-2xs rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:outline-none transition-all cursor-pointer"
                >
                  <option value="all">All Specialties</option>
                  <option value="cardiology">Cardiology / Heart</option>
                  <option value="neurology">Neurology / Stroke</option>
                  <option value="pediatrics">Pediatrics / Child</option>
                  <option value="cancer">Oncology / Cancer</option>
                </select>

                {/* Ownership */}
                <select
                  value={ownershipFilter}
                  onChange={(e) => {
                    setOwnershipFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  aria-label="Ownership filter"
                  className="bg-white hover:bg-slate-50 border border-slate-200/90 shadow-2xs rounded-xl px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:outline-none transition-all cursor-pointer"
                >
                  <option value="all">All Ownership</option>
                  <option value="government">Government / Subsidized</option>
                  <option value="private">Private Tertiary</option>
                </select>
              </div>
            </div>

            {/* HOSPITAL RESULTS LIST */}
            <div className="flex flex-col gap-3">
              {loading ? (
                <div className="py-12 text-center text-xs text-slate-600 flex items-center justify-center gap-2">
                  <div className="w-4 h-4 rounded-full border-2 border-cyan-600 border-t-transparent animate-spin" />
                  <span>Evaluating verified facilities nearby...</span>
                </div>
              ) : pageHospitals.length === 0 ? (
                <div className="p-8 rounded-2xl bg-white border border-slate-200/90 text-center flex flex-col items-center justify-center gap-2">
                  <Building2 className="w-8 h-8 text-slate-400" />
                  <p className="text-xs font-semibold text-slate-900">No facilities matching current filters</p>
                  <p className="text-[11px] text-slate-600">
                    Try selecting "All Specialties" or broadening your search.
                  </p>
                </div>
              ) : (
                pageHospitals.map((hosp, pIdx) => {
                  const globalIndex = startIndex + pIdx;
                  const isSelected = selectedHospital?.id === hosp.id;
                  const distanceNum =
                    isSelected && liveRoadStats ? liveRoadStats.roadDistanceKm : hosp.distanceKm;
                  const durationNum =
                    isSelected && liveRoadStats ? liveRoadStats.etaMinutes : hosp.etaMinutes || Math.max(2, Math.round(distanceNum * 1.5));
                  const isGovernment = (hosp as any).ownership === "government";
                  const isSpecMatch = Boolean(hosp.isEligible && specialtyFilter !== "all");

                  return (
                    <div
                      key={hosp.id}
                      onClick={() => handleSelectHospital(hosp)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col gap-3 ${
                        isSelected
                          ? "bg-white border-slate-900 shadow-sm ring-1 ring-slate-900/20"
                          : "bg-white hover:bg-slate-50 border border-slate-200/90 shadow-xs"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-slate-900 truncate">
                              {hosp.name}
                            </span>
                            <span className="bg-slate-100 text-slate-800 border border-slate-200/80 rounded-lg text-xs font-mono font-medium px-2.5 py-1 inline-flex items-center">
                              <span>{hosp.famousFor || getHospitalFamousFor(hosp)}</span>
                            </span>
                            {isSpecMatch && (
                              <span className="bg-cyan-50 text-cyan-800 border border-cyan-200 rounded-lg text-xs font-mono font-semibold px-2.5 py-1">
                                Verified {specialtyFilter}
                              </span>
                            )}
                            {hosp.acceptsPublicInsurance && (
                              <span className="bg-slate-100 text-slate-800 border border-slate-200/80 rounded-lg text-xs font-mono font-medium px-2.5 py-1">
                                Ayushman / Aarogyasri
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-600 truncate mt-0.5">{hosp.address}</span>
                        </div>

                        <div className="flex items-end flex-col shrink-0">
                          <span className="text-xs font-semibold text-slate-900">
                            ~{durationNum} min
                          </span>
                          <span className="text-[11px] text-slate-600">
                            ~{distanceNum.toFixed(1)} km
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-slate-200/90 text-xs">
                        <div className="flex items-center gap-2">
                          {hosp.isEmergency24x7 ? (
                            <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-mono font-semibold px-2.5 py-1 inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                              24/7 Emergency & Trauma
                            </span>
                          ) : (
                            <span className="bg-slate-100 text-slate-800 border border-slate-200/80 rounded-lg text-xs font-mono font-medium px-2.5 py-1">
                              Specialty Center
                            </span>
                          )}
                          <span className="text-slate-300">•</span>
                          <span className="text-slate-600 text-[11px] font-mono">{isGovernment ? "Government" : "Private"}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <a
                            href={`tel:${hosp.emergencyPhone || hosp.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-xs transition-all cursor-pointer"
                          >
                            <PhoneCall className="w-3 h-3" />
                            <span>Call ED</span>
                          </a>

                          <a
                            href={userLocation ? `https://www.google.com/maps/dir/?api=1&origin=${userLocation.lat},${userLocation.lng}&destination=${hosp.latitude},${hosp.longitude}&travelmode=driving` : `https://www.google.com/maps/search/?api=1&query=${hosp.latitude},${hosp.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 font-medium text-xs border border-slate-200/90 shadow-2xs transition-all cursor-pointer active:scale-[0.98]"
                          >
                            <span>Directions</span>
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </a>
                        </div>
                      </div>

                      {/* EXPANDED HOSPITAL & ROUTE INTELLIGENCE DETAILS */}
                      {isSelected && (
                        <div className="pt-3 border-t border-slate-200/90 flex flex-col gap-3 animate-in fade-in duration-200">
                          {/* Live route banner with scroll to map button */}
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 p-3 rounded-2xl bg-cyan-50/70 border border-cyan-200/80 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-cyan-600 animate-pulse shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-bold text-cyan-800">
                                  Active Route: ~{distanceNum.toFixed(1)} km · ~{durationNum} min drive
                                </span>
                                <span className="text-[11px] text-slate-600">
                                  Live road route calculated and plotted on map above
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectHospital(hosp, true);
                              }}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-950 hover:bg-slate-900 text-white font-semibold text-xs shadow-xs transition-all cursor-pointer shrink-0 active:scale-[0.98]"
                            >
                              <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                              <span>View route on map</span>
                            </button>
                          </div>

                          {/* Specialties List */}
                          {hosp.specialty && hosp.specialty.length > 0 && (
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-1.5 font-mono">
                                Clinical capabilities & departments
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {hosp.specialty.map((s, sIdx) => (
                                  <span
                                    key={sIdx}
                                    className="bg-slate-100 text-slate-800 border border-slate-200/80 rounded-lg text-xs font-mono font-medium px-2.5 py-1"
                                  >
                                    {s}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Match reasons */}
                          {hosp.matchReasons && hosp.matchReasons.length > 0 && (
                            <div>
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-1.5 font-mono">
                                Why this facility
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {hosp.matchReasons.map((reason, rIdx) => (
                                  <span
                                    key={rIdx}
                                    className="bg-slate-100 text-slate-800 border border-slate-200/80 rounded-lg text-xs font-mono font-medium px-2.5 py-1 flex items-center gap-1.5"
                                  >
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>{reason}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Contact details */}
                          <div className="flex items-center justify-between text-xs text-slate-600 pt-1">
                            <div>
                              <span>Emergency ED: </span>
                              <a
                                href={`tel:${hosp.emergencyPhone || hosp.phone || "108"}`}
                                onClick={(e) => e.stopPropagation()}
                                className="font-bold text-rose-600 hover:text-rose-700 hover:underline"
                              >
                                {hosp.emergencyPhone || hosp.phone || "108"}
                              </a>
                            </div>
                            {hosp.phone && hosp.phone !== hosp.emergencyPhone && (
                              <div>
                                <span>Reception: </span>
                                <a
                                  href={`tel:${hosp.phone}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="font-semibold text-slate-900 hover:underline"
                                >
                                  {hosp.phone}
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* PAGINATION CONTROLS */}
            {!loading && filteredAndSortedHospitals.length > PAGE_SIZE && (
              <div className="pt-4 pb-4 border-t border-slate-200/90 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <span className="text-slate-600">
                  Showing {startIndex + 1}–{endIndex} of {filteredAndSortedHospitals.length} facilities
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-xl border border-slate-200/90 hover:border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-800 hover:text-slate-950 shadow-2xs transition-all cursor-pointer flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Previous</span>
                  </button>

                  {pageNumbers.map((p, idx) =>
                    p === -1 ? (
                      <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 font-bold">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        className={`w-8 h-8 rounded-xl text-xs transition-all cursor-pointer ${
                          currentPage === p
                            ? "bg-slate-950 text-white font-bold border border-slate-900 shadow-xs"
                            : "bg-white hover:bg-slate-50 border border-slate-200/90 hover:border-slate-300 text-slate-800 font-medium shadow-2xs"
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}

                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 rounded-xl border border-slate-200/90 hover:border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-slate-800 hover:text-slate-950 shadow-2xs transition-all cursor-pointer flex items-center gap-1"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

      </main>

      <AppFooter />
    </AmbientPageBackground>
  );
}
