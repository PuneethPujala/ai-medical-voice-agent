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
  ChevronDown,
  ChevronUp,
  Info,
  Shield,
  Stethoscope,
  Award,
} from "lucide-react";
import { AnimatedList } from "@/components/AnimatedList";
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
import {
  evaluateAndRankForSpecialty,
  isPlaceholderOrGenericHospitalName,
  isValidHospitalPhoneNumber,
} from "@/lib/care-network/evaluator";

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
  const [isRationaleExpanded, setIsRationaleExpanded] = useState<boolean>(false);

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
    let list = evaluationResult.ranked.filter((h) => !isPlaceholderOrGenericHospitalName(h.name));

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
      <main className="relative z-10 flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 pt-24 sm:pt-28 pb-16 flex flex-col gap-6">

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
                className="w-full sm:w-auto cursor-pointer shadow-xs border border-slate-800 bg-slate-950 text-white hover:bg-slate-900 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 text-sm font-semibold px-6 py-3.5"
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
            <div id="care-map-section" className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch scroll-mt-32">

              {/* LEFT: Dominant Live Route Map + Dedicated Selected Hospital Card (58% width on large screens) */}
              <div className="lg:col-span-7 flex flex-col gap-4">
                {/* MAP CONTAINER */}
                <div className="rounded-2xl overflow-hidden shadow-xs border border-slate-200/90 bg-white h-[460px] sm:h-[480px] relative">
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

                {/* DEDICATED SELECTED HOSPITAL & ROUTE INTELLIGENCE CARD (BELOW THE MAP) */}
                {selectedHospital ? (
                  <div className="rounded-2xl bg-white border border-slate-200/90 shadow-xs p-4 sm:p-5 flex flex-col gap-3 transition-all animate-in fade-in duration-200">
                    {/* HEADER: RANK BADGE, PROVENANCE, NAME & SPECIALTY */}
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md text-white ${
                              selectedHospital.id === recommendedHospital?.id ? "bg-slate-950" : "bg-slate-800"
                            }`}
                          >
                            #{selectedHospital.rank} {selectedHospital.id === recommendedHospital?.id ? "Recommended Match" : "Selected Facility"}
                          </span>

                          {/* Verification / Provenance Badge (Strict: Verified only for official registry) */}
                          <span
                            className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${
                              selectedHospital.sourceType === "official_registry"
                                ? "bg-emerald-50 text-emerald-800 border-emerald-200 font-semibold"
                                : "bg-slate-100 text-slate-700 border-slate-200 font-medium"
                            }`}
                          >
                            {selectedHospital.sourceType === "official_registry"
                              ? "✓ Verified Registry"
                              : "OSM Care Directory"}
                          </span>

                          {selectedHospital.isEmergency24x7 && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200">
                              24/7 ER
                            </span>
                          )}
                          {(selectedHospital as any).ownership === "government" && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
                              Government
                            </span>
                          )}
                          {selectedHospital.acceptsPublicInsurance && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 border border-purple-200">
                              Ayushman / PM-JAY
                            </span>
                          )}
                        </div>

                        <h3 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
                          {selectedHospital.name}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                          {selectedHospital.famousFor || getHospitalFamousFor(selectedHospital)}
                        </p>
                      </div>
                    </div>

                    {/* ADDRESS STRIP */}
                    <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-xl border border-slate-100">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{selectedHospital.address}</span>
                    </div>

                    {/* DRIVING ROUTE TELEMETRY STRIP - Fully decoupled from action buttons */}
                    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 flex-wrap">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                        <Car className="w-4 h-4 text-sky-600 shrink-0" />
                        <span>~{liveRoadStats ? liveRoadStats.etaMinutes : (selectedHospital.etaMinutes || 12)} min drive</span>
                        <span className="text-slate-300 font-normal">·</span>
                        <span className="text-slate-600 font-medium">
                          ~{liveRoadStats ? liveRoadStats.roadDistanceKm.toFixed(1) : selectedHospital.distanceKm.toFixed(1)} km by road
                        </span>
                      </div>
                      <div
                        className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 cursor-help"
                        title="Route and estimated travel time calculated for car travel along roads."
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                        <span>Driving route · Car</span>
                        <Info className="w-3 h-3 text-slate-400" />
                      </div>
                    </div>

                    {/* ACTION BUTTONS ROW - Responsive wrapping with zero overlap */}
                    {(() => {
                      let directPhone = "";
                      if (selectedHospital.emergencyPhone && selectedHospital.emergencyPhone !== "108" && selectedHospital.emergencyPhone !== "112") {
                        directPhone = selectedHospital.emergencyPhone.trim();
                      } else if (selectedHospital.phone && selectedHospital.phone !== "108" && selectedHospital.phone !== "112") {
                        directPhone = selectedHospital.phone.trim();
                      }
                      const hasDirectPhone = isValidHospitalPhoneNumber(directPhone);
                      const mapsUrl = userLocation
                        ? `https://www.google.com/maps/dir/?api=1&origin=${userLocation.lat},${userLocation.lng}&destination=${selectedHospital.latitude},${selectedHospital.longitude}&travelmode=driving`
                        : `https://www.google.com/maps/search/?api=1&query=${selectedHospital.latitude},${selectedHospital.longitude}`;

                      return (
                        <div className="flex items-center gap-2.5 pt-0.5 flex-wrap">
                          {hasDirectPhone ? (
                            <a
                              href={`tel:${directPhone}`}
                              className={`flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-white font-semibold text-xs shadow-xs active:scale-[0.98] transition-all cursor-pointer ${
                                selectedHospital.isEmergency24x7 ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-950 hover:bg-slate-900"
                              }`}
                              title={`Call direct facility line: ${directPhone}`}
                            >
                              <PhoneCall className="w-3.5 h-3.5" />
                              <span>{selectedHospital.actionType === "call_hospital" ? "Call Hospital" : "Call Hospital ED"}</span>
                              <span className="text-[10.5px] opacity-80 font-mono font-normal">({directPhone})</span>
                            </a>
                          ) : (
                            <a
                              href="tel:108"
                              className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-white font-semibold text-xs shadow-xs active:scale-[0.98] transition-all cursor-pointer bg-rose-600 hover:bg-rose-700"
                              title="Call 108 Emergency Ambulance Dispatch"
                            >
                              <PhoneCall className="w-3.5 h-3.5" />
                              <span>Call 108 Ambulance (Emergency Dispatch)</span>
                            </a>
                          )}

                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-950 hover:bg-slate-900 text-white font-semibold text-xs shadow-xs active:scale-[0.98] transition-all cursor-pointer"
                            title="Open turn-by-turn navigation in Google Maps"
                          >
                            <span>Start Navigation</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-white border border-slate-200/90 p-4 text-center text-xs text-slate-500">
                    Select a facility to view route details and emergency contact
                  </div>
                )}
              </div>

              {/* RIGHT: Decoupled Matching Facilities Rail + Animated List */}
              <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs p-4 sm:p-5 flex flex-col gap-3 h-[740px] sm:h-[760px] lg:h-[780px] max-h-[780px] overflow-hidden">

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

                {/* 1. COMPACT PANEL HEADING & CONTROLS */}
                <div className="flex flex-col gap-2 pb-2.5 border-b border-slate-200/90 shrink-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider truncate">
                        Matching Facilities
                      </h3>
                      <span className="text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full border border-slate-200">
                        {filteredAndSortedHospitals.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {selectedHospital && selectedHospital.id !== recommendedHospital?.id && (
                        <button
                          onClick={handleResetToRecommended}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-medium border border-slate-200 transition-colors cursor-pointer"
                          title="Return to #1 recommended match"
                        >
                          Reset to #1
                        </button>
                      )}
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        aria-label="Sort order"
                        className="text-[11px] font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-200/90 shadow-2xs rounded-lg px-2 py-1 focus:outline-none transition-all cursor-pointer"
                      >
                        <option value="fastest">Fastest / Best Match</option>
                        <option value="government">Government First</option>
                        <option value="rating">Highest Rating</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[10.5px] text-slate-500">
                    <span className="truncate">{categoryLabel} · Ranked by suitability</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={ownershipFilter}
                        onChange={(e) => setOwnershipFilter(e.target.value)}
                        aria-label="Ownership filter"
                        className="text-[10.5px] font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md px-1.5 py-0.5 focus:outline-none cursor-pointer"
                      >
                        <option value="all">All Ownership</option>
                        <option value="government">Govt Only</option>
                        <option value="private">Private Only</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 2. KEY MATCH FACTORS & RECOMMENDATION RATIONALE (Collapsible & compact) */}
                {selectedHospital && (() => {
                  const isRecommended = selectedHospital.id === recommendedHospital?.id;
                  const isGovernment = (selectedHospital as any).ownership === "government";
                  const distanceKm = liveRoadStats ? liveRoadStats.roadDistanceKm : selectedHospital.distanceKm;
                  const etaMinutes = liveRoadStats ? liveRoadStats.etaMinutes : (selectedHospital.etaMinutes || Math.max(3, Math.round(distanceKm * 1.5)));
                  const famousFor = selectedHospital.famousFor || getHospitalFamousFor(selectedHospital);

                  return (
                    <div className="rounded-xl bg-slate-50/90 border border-slate-200/90 shrink-0 shadow-2xs overflow-hidden transition-all">
                      <button
                        type="button"
                        onClick={() => setIsRationaleExpanded(!isRationaleExpanded)}
                        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-slate-100/70 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Sparkles className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {isRecommended ? "Why Ranked #1 · Key Match Factors" : `Match Rationale · #${selectedHospital.rank}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-800 border border-cyan-200">
                            ~{etaMinutes}m drive
                          </span>
                          <span className="text-[10.5px] font-semibold text-slate-500">
                            {isRationaleExpanded ? "Hide" : "Factors"}
                          </span>
                          {isRationaleExpanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
                        </div>
                      </button>

                      {isRationaleExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-slate-700 animate-in fade-in duration-150">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">{selectedHospital.isEmergency24x7 ? "24/7 Verified Emergency Care" : "Specialized Care"}</span>
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">
                              {selectedHospital.sourceType === "official_registry"
                                ? "State Health Authority Accredited"
                                : "Verified Care Provider"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">~{distanceKm.toFixed(1)} km away · ~{etaMinutes}m drive</span>
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">
                              {selectedHospital.acceptsPublicInsurance
                                ? "Ayushman / PM-JAY Cashless"
                                : isGovernment
                                ? "Government Hospital"
                                : famousFor}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 3. HOSPITAL RESULTS LIST (FIXED CONTAINER, INTERNAL SCROLL WITH ANIMATED LIST) */}
                <div className="flex-1 min-h-0 overflow-hidden relative">
                  {loading ? (
                    <div className="py-16 text-center text-xs text-slate-600 flex items-center justify-center gap-2">
                      <div className="w-4 h-4 rounded-full border-2 border-cyan-600 border-t-transparent animate-spin" />
                      <span>Evaluating verified facilities nearby...</span>
                    </div>
                  ) : filteredAndSortedHospitals.length === 0 ? (
                    <div className="p-8 rounded-2xl bg-white border border-slate-200/90 text-center flex flex-col items-center justify-center gap-2 shadow-xs">
                      <Building2 className="w-6 h-6 text-slate-400" />
                      <p className="text-xs font-semibold text-slate-900">No facilities matching criteria</p>
                      <p className="text-[11px] text-slate-500">Try broadening your medical issue or selecting another region.</p>
                    </div>
                  ) : (
                    <AnimatedList
                      items={filteredAndSortedHospitals}
                      selectedIndex={filteredAndSortedHospitals.findIndex((h) => h.id === selectedHospital?.id)}
                      onItemSelect={(item) => handleSelectHospital(item as any)}
                      renderItem={(item, index, isSelected) => {
                        const hosp = item as any;
                        const isBest = recommendedHospital?.id === hosp.id;
                        const distanceNum = isSelected && liveRoadStats ? liveRoadStats.roadDistanceKm : hosp.distanceKm;
                        const durationNum = isSelected && liveRoadStats ? liveRoadStats.etaMinutes : hosp.etaMinutes || Math.max(3, Math.round(distanceNum * 1.5));
                        const isGovernment = hosp.ownership === "government";
                        const famousFor = hosp.famousFor || getHospitalFamousFor(hosp);

                        return (
                          <div className="w-full flex items-start justify-between gap-3 py-0.5">
                            {/* Left side: Rank + Hospital Name (up to 2 lines) + Specialty + Clean Badges */}
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              {/* Rank Badge */}
                              <span
                                className={`font-mono font-bold text-xs w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                                  isSelected
                                    ? "bg-slate-950 text-white shadow-xs"
                                    : isBest
                                    ? "bg-cyan-100 text-cyan-900 border border-cyan-300 font-extrabold"
                                    : "bg-slate-100 text-slate-700 border border-slate-200"
                                }`}
                              >
                                #{hosp.rank}
                              </span>

                              {/* Content Column */}
                              <div className="min-w-0 flex-1 flex flex-col gap-1">
                                {/* Hospital Name: Wraps up to 2 lines cleanly without aggressive truncation */}
                                <h4
                                  className="text-xs sm:text-[13px] font-bold text-slate-900 leading-snug line-clamp-2"
                                  title={hosp.name}
                                >
                                  {hosp.name}
                                </h4>

                                {/* Specialty or service category */}
                                <p className="text-[11px] text-slate-600 line-clamp-1 font-medium">
                                  {famousFor}
                                </p>

                                {/* Clean, restrained status tags: max 1 or 2 */}
                                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                  {isSelected && (
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-slate-950 text-white uppercase tracking-wider shrink-0">
                                      Selected destination
                                    </span>
                                  )}
                                  {hosp.sourceType === "official_registry" && (
                                    <span className="text-[10px] font-medium text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/80">
                                      ✓ Verified registry
                                    </span>
                                  )}
                                  {hosp.isEmergency24x7 && (
                                    <span className="text-[10px] font-medium text-rose-800 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200/80">
                                      24/7 ER
                                    </span>
                                  )}
                                  {isGovernment && (
                                    <span className="text-[10px] font-medium text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200/80">
                                      Govt
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Right side: Drive Metrics Area (Dedicated column, aligned) */}
                            <div className="flex flex-col items-end shrink-0 text-right pl-2 pr-1 min-w-[78px]">
                              <span className="text-xs sm:text-[13px] font-extrabold text-slate-950 font-mono tracking-tight leading-tight">
                                ~{durationNum} min
                              </span>
                              <span className="text-[10.5px] text-slate-500 font-mono leading-tight mt-0.5">
                                {distanceNum.toFixed(1)} km by road
                              </span>
                            </div>
                          </div>
                        );
                      }}
                      animation="pop"
                      stagger={0.03}
                      showGradients={true}
                      fadeSize={20}
                      displayScrollbar={true}
                      frame={false}
                      theme="light"
                      radius={12}
                      gap={10}
                      width="100%"
                      maxHeight={isRationaleExpanded ? 580 : 620}
                      className="w-full"
                    />
                  )}
                </div>
              </div>
            </div>
          </>
        )}

      </main>

      <AppFooter />
    </AmbientPageBackground>
  );
}
