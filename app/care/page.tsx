"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  MapPin,
  LocateFixed,
  Compass,
  Search,
  PhoneCall,
  ExternalLink,
  Building2,
  Car,
  ChevronLeft,
  ChevronRight,
  Activity,
  Sparkles,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  Shield,
  Layers,
  X,
  RefreshCw,
  AlertTriangle,
  Radio,
  Clock,
  ArrowRight
} from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArchitecturalBrandLedgerFooter } from "../_components/ArchitecturalBrandLedgerFooter";
import { HospitalItem, RouteTelemetryInfo, calculateCalibratedDriveTime } from "../_components/InteractiveRouteMap";
import { SpecialtyIcon } from "@/components/care/SpecialtyIcon";
import {
  ALL_REGION_PRESETS,
  RegionPresetItem,
  MEDICAL_ISSUE_OPTIONS,
  getHospitalFamousFor,
} from "@/lib/hospitals-india-data";
import {
  evaluateAndRankForSpecialty,
  isPlaceholderOrGenericHospitalName,
  isValidHospitalPhoneNumber,
} from "@/lib/care-network/evaluator";
import { clientCareCache } from "@/lib/care-network/care-cache";

// Leaflet map dynamically imported with SSR disabled
const InteractiveRouteMap = dynamic(
  () => import("../_components/InteractiveRouteMap").then((mod) => mod.InteractiveRouteMap),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[500px] lg:h-[560px] rounded-3xl bg-white border border-[#E5E7EB] flex flex-col items-center justify-center gap-3 animate-pulse">
        <div className="w-8 h-8 rounded-full border-2 border-[#05070F] border-t-transparent animate-spin" />
        <span className="text-xs font-semibold text-[#64748B] font-mono">Initializing geographic telemetry...</span>
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

// Default initial exploration hub (Hyderabad / Banjara Hills)
const DEFAULT_EXPLORATION_HUB: CareOrigin = {
  lat: 17.426,
  lng: 78.412,
  label: "Hyderabad (Banjara Hills Hub)",
  source: "preset",
  resolvedAt: Date.now(),
};

export default function CarePage() {
  const prefersReducedMotion = useReducedMotion();

  // Core Data States
  const [rawHospitals, setRawHospitals] = useState<HospitalItem[]>([]);
  const [userSelectedId, setUserSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isStaleData, setIsStaleData] = useState<boolean>(false);

  // Authoritative location state machine
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("LOCATION_UNKNOWN");
  const [userLocation, setUserLocation] = useState<CareOrigin | null>(null);
  const [searchRegion, setSearchRegion] = useState<CareOrigin>(DEFAULT_EXPLORATION_HUB);

  // Saved location suggestion from previous sessions
  const [savedSuggestion, setSavedSuggestion] = useState<CareOrigin | null>(null);
  const [isChoosingCity, setIsChoosingCity] = useState<boolean>(false);

  const [isDetectingGps, setIsDetectingGps] = useState<boolean>(false);
  const [isManualPicking, setIsManualPicking] = useState<boolean>(false);

  // Canonical road routing stats calculated from map routing
  const [liveRoadStats, setLiveRoadStats] = useState<RouteTelemetryInfo | null>(null);

  // Discovery Mode: "all" (All Hospitals & 24/7 ERs) vs "issues" (Condition-Specific)
  const [viewMode, setViewMode] = useState<"all" | "issues">("all");
  const [selectedZone, setSelectedZone] = useState<string>("all");

  // Specialty & Condition Filters
  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");
  const [issueSearchText, setIssueSearchText] = useState<string>("");

  const [ownershipFilter, setOwnershipFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"fastest" | "government" | "rating">("fastest");
  const [isRationaleExpanded, setIsRationaleExpanded] = useState<boolean>(false);

  // Pagination state (10 results per page)
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Search Autocomplete state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Request race condition protection
  const activeQuerySeqRef = useRef<number>(0);

  // Unified hospital selection handler: updates selection and triggers map camera sync
  const handleSelectHospital = (hosp: HospitalItem, shouldScrollToMap: boolean = false) => {
    setUserSelectedId(hosp.id);
    setLiveRoadStats({
      roadDistanceKm: hosp.distanceKm,
      etaMinutes: hosp.etaMinutes || calculateCalibratedDriveTime(hosp.distanceKm),
      roadGeometryAvailable: false,
      isCalculating: true,
      unavailable: false,
    });
    if (shouldScrollToMap && typeof window !== "undefined") {
      const mapEl = document.getElementById("care-command-map");
      if (mapEl) {
        mapEl.scrollIntoView({ behavior: prefersReducedMotion ? "instant" : "smooth", block: "start" });
      }
    }
  };

  const handleResetToRecommended = () => {
    setUserSelectedId(null);
    if (recommendedHospital) {
      setLiveRoadStats({
        roadDistanceKm: recommendedHospital.distanceKm,
        etaMinutes: recommendedHospital.etaMinutes || calculateCalibratedDriveTime(recommendedHospital.distanceKm),
        roadGeometryAvailable: false,
        isCalculating: true,
        unavailable: false,
      });
    }
  };

  // Fetch facilities with in-memory caching and request deduplication
  const loadFacilities = useCallback(
    async (targetRegion: CareOrigin, departureOrigin: CareOrigin | null) => {
      const effectiveDeparture = departureOrigin || targetRegion;
      const querySeq = ++activeQuerySeqRef.current;

      if (rawHospitals.length > 0) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const { hospitals, fromCache } = await clientCareCache.fetchWithDeduplication(
          targetRegion.lat,
          targetRegion.lng,
          effectiveDeparture.lat,
          effectiveDeparture.lng,
          async (signal) => {
            const res = await fetch(
              `/api/hospitals?lat=${targetRegion.lat}&lng=${targetRegion.lng}&patientLat=${effectiveDeparture.lat}&patientLng=${effectiveDeparture.lng}`,
              { signal }
            );
            if (!res.ok) {
              throw new Error(`Failed to load hospitals: ${res.status}`);
            }
            const data = await res.json();
            return data.hospitals || [];
          }
        );

        // Guard against race condition if user clicked rapidly
        if (querySeq !== activeQuerySeqRef.current) return;

        setIsStaleData(false);
        if (hospitals && hospitals.length > 0) {
          setRawHospitals(hospitals);
          setUserSelectedId(null);
          const first = hospitals[0] || null;
          if (first) {
            setLiveRoadStats({
              roadDistanceKm: first.distanceKm,
              etaMinutes: first.etaMinutes || calculateCalibratedDriveTime(first.distanceKm),
              roadGeometryAvailable: false,
              isCalculating: true,
              unavailable: false,
            });
          }
        } else {
          setRawHospitals([]);
          setUserSelectedId(null);
          setLiveRoadStats(null);
        }

        setSearchRegion(targetRegion);
        if (departureOrigin) {
          setUserLocation(departureOrigin);
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
            } catch {}
          }
        }
      } catch (e) {
        console.warn("[CarePage] Fetch error:", e);
        if (querySeq === activeQuerySeqRef.current) {
          setIsStaleData(true);
        }
      } finally {
        if (querySeq === activeQuerySeqRef.current) {
          setLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [rawHospitals.length]
  );

  // Initialize on mount: check session storage suggestion or load default hub
  useEffect(() => {
    let initialOrigin: CareOrigin | null = null;

    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          const candidate = parsed?.userLocation || parsed;
          if (
            candidate &&
            Number.isFinite(candidate.lat) &&
            Number.isFinite(candidate.lng) &&
            typeof candidate?.label === "string"
          ) {
            initialOrigin = {
              lat: candidate.lat,
              lng: candidate.lng,
              label: candidate.label,
              source: candidate.source || "preset",
              resolvedAt: candidate.resolvedAt || Date.now(),
            };
            setSavedSuggestion(initialOrigin);
          }
        }
      } catch {}
    }

    const startRegion = initialOrigin || DEFAULT_EXPLORATION_HUB;
    setSearchRegion(startRegion);
    if (initialOrigin) {
      setUserLocation(initialOrigin);
      setLocationStatus("LOCATION_MANUALLY_SELECTED");
    }
    loadFacilities(startRegion, initialOrigin);
  }, []);

  // GPS Detection Handler
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
          { signal: AbortSignal.timeout(3000) }
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
      } catch {}

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
      setIsChoosingCity(false);
      setSearchQuery("");
      loadFacilities(newGpsOrigin, newGpsOrigin);
    };

    const onLocationError = (err: GeolocationPositionError) => {
      console.warn("[CarePage] Geolocation denied/timeout:", err.message);
      setIsDetectingGps(false);
      setLocationStatus("LOCATION_PERMISSION_DENIED");
    };

    navigator.geolocation.getCurrentPosition(onLocationSuccess, onLocationError, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 60000,
    });
  };

  // Preset City Selector Handler
  const handleSelectPreset = (preset: RegionPresetItem) => {
    setIsManualPicking(false);
    setSearchQuery("");
    setShowDropdown(false);
    setIsChoosingCity(false);

    const chosenOrigin: CareOrigin = {
      lat: preset.lat,
      lng: preset.lng,
      label: preset.name,
      source: "preset",
      resolvedAt: Date.now(),
    };

    setUserLocation(chosenOrigin);
    setSearchRegion(chosenOrigin);
    setLocationStatus("LOCATION_MANUALLY_SELECTED");
    loadFacilities(chosenOrigin, chosenOrigin);
  };

  // Search Autocomplete Handler
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
    setIsChoosingCity(false);

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

  // Map Click Pin-Drop Handler
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
    } catch {}

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

  // Medical Specialty Evaluation (Client-Side Instant Re-Rank)
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

  const { categoryFallback, fallbackBanner, categoryLabel } = evaluationResult;

  // Filter & Sort
  const filteredAndSortedHospitals = useMemo(() => {
    let list = evaluationResult.ranked.filter((h) => !isPlaceholderOrGenericHospitalName(h.name));

    if (ownershipFilter === "government") {
      list = list.filter((h) => (h as any).ownership === "government");
    } else if (ownershipFilter === "private") {
      list = list.filter((h) => (h as any).ownership === "private");
    }

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

  const recommendedHospital = useMemo(() => {
    return filteredAndSortedHospitals[0] || null;
  }, [filteredAndSortedHospitals]);

  const selectedHospital = useMemo(() => {
    if (!userSelectedId) return recommendedHospital;
    return filteredAndSortedHospitals.find((h) => h.id === userSelectedId) || recommendedHospital;
  }, [userSelectedId, recommendedHospital, filteredAndSortedHospitals]);

  // True Pagination (10 per page)
  const totalPages = Math.max(1, Math.ceil(filteredAndSortedHospitals.length / PAGE_SIZE));
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filteredAndSortedHospitals.length);

  const pageHospitals = useMemo(() => {
    return filteredAndSortedHospitals.slice(startIndex, endIndex);
  }, [filteredAndSortedHospitals, startIndex, endIndex]);

  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push(-1);
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push(-1);
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, currentPage]);

  const mapsUrl = selectedHospital && userLocation
    ? `https://www.google.com/maps/dir/?api=1&origin=${userLocation.lat},${userLocation.lng}&destination=${selectedHospital.latitude},${selectedHospital.longitude}&travelmode=driving`
    : selectedHospital
    ? `https://www.google.com/maps/search/?api=1&query=${selectedHospital.latitude},${selectedHospital.longitude}`
    : "#";

  return (
    <div className="relative min-h-screen bg-[#FAF9F6] text-[#05070F] flex flex-col font-sans selection:bg-[#B7FF72] selection:text-[#05070F]">

      {/* Main Command Center Canvas */}
      <main className="relative z-10 flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 lg:px-8 pt-28 sm:pt-32 pb-16 flex flex-col gap-6">

        {/* ========================================================================= */}
        {/* COMMAND CENTER HEADER: COMPACT CLINICAL NARRATIVE                         */}
        {/* ========================================================================= */}
        <header className="border-b border-[#E5E7EB] pb-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#F0FDF4] border border-[#DCFCE7] text-[11px] font-mono font-bold uppercase tracking-[0.12em] text-[#16A34A]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse" />
                <span>MEDVOICE · CARE NETWORK COMMAND CENTER</span>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F3F4F6] border border-[#E5E7EB] text-[11px] text-[#475569]">
                <Shield className="w-3 h-3 text-[#16A34A]" />
                <span>36+ Regions · Verified Healthcare Registry</span>
              </div>
            </div>

            {/* Quick Emergency Dispatch Actions */}
            <div className="flex items-center gap-2">
              <a
                href="tel:108"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition-all shadow-2xs"
                title="Call 108 Emergency Ambulance Dispatch"
              >
                <PhoneCall className="w-3.5 h-3.5 text-rose-600" />
                <span>Ambulance: 108</span>
              </a>
              <a
                href="tel:112"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#05070F] border border-[#E2E8F0] text-xs font-semibold transition-all"
                title="Call 112 National Emergency Helpline"
              >
                <span>Emergency: 112</span>
              </a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="flex flex-col gap-1 max-w-2xl">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-[#05070F] tracking-tight">
                Emergency Reachability & Facility Routing
              </h1>
              <p className="text-xs sm:text-sm text-[#475569] leading-relaxed">
                Calibrated road reachability, emergency travel times, and specialist on-duty coverage across accredited regional healthcare networks.
              </p>
            </div>

            {/* Discovery Mode Switcher */}
            <div className="flex items-center gap-1 p-1 bg-[#F3F4F6] border border-[#E5E7EB] rounded-2xl shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => {
                  setViewMode("all");
                  setSpecialtyFilter("all");
                  setIssueSearchText("");
                  setCurrentPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === "all"
                    ? "bg-[#05070F] text-white shadow-xs"
                    : "text-[#475569] hover:text-[#05070F] hover:bg-white/60"
                }`}
              >
                All Facilities & 24/7 ERs
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("issues");
                  if (specialtyFilter === "all") {
                    setSpecialtyFilter("cardiology");
                    setIssueSearchText("Heart & Cardiology");
                  }
                  setCurrentPage(1);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === "issues"
                    ? "bg-[#05070F] text-white shadow-xs"
                    : "text-[#475569] hover:text-[#05070F] hover:bg-white/60"
                }`}
              >
                Filter by Condition
              </button>
            </div>
          </div>

          {/* ======================================================================= */}
          {/* LOCATION & GEOGRAPHIC CONTROLS BAR                                      */}
          {/* ======================================================================= */}
          <div className="pt-2 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-3 bg-white border border-[#E5E7EB] rounded-2xl shadow-xs">
            {/* Left: Active Departure Location Indicator */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#F0FDF4] border border-[#DCFCE7] flex items-center justify-center text-[#16A34A] shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8] font-bold">
                    Departure Origin
                  </span>
                  {userLocation?.source === "gps" && (
                    <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold">
                      GPS
                    </span>
                  )}
                </div>
                <div className="text-xs font-bold text-[#05070F] truncate">
                  {isDetectingGps ? (
                    <span className="text-[#16A34A] flex items-center gap-1.5">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Locating via GPS satellites...
                    </span>
                  ) : userLocation ? (
                    userLocation.label
                  ) : (
                    `Exploring: ${searchRegion.label}`
                  )}
                </div>
              </div>
            </div>

            {/* Right: Geolocation & City Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleDetectLiveLocation}
                disabled={isDetectingGps}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#05070F] hover:bg-black text-white text-xs font-semibold shadow-xs transition-all cursor-pointer active:scale-98 disabled:opacity-50"
              >
                <LocateFixed className={`w-3.5 h-3.5 text-[#B7FF72] ${isDetectingGps ? "animate-spin" : ""}`} />
                <span>{isDetectingGps ? "Locating..." : "Use my live location"}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsChoosingCity(!isChoosingCity)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                  isChoosingCity
                    ? "bg-[#05070F] text-white border-[#05070F]"
                    : "bg-white hover:bg-[#F8FAFC] text-[#334155] border-[#E2E8F0]"
                }`}
              >
                <Building2 className={`w-3.5 h-3.5 ${isChoosingCity ? "text-[#B7FF72]" : "text-[#64748B]"}`} />
                <span>Choose City (36+)</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isChoosingCity ? "rotate-180" : ""}`} />
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsManualPicking(!isManualPicking);
                  setIsChoosingCity(false);
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                  isManualPicking
                    ? "bg-amber-600 text-white border-amber-600"
                    : "bg-white hover:bg-[#F8FAFC] text-[#334155] border-[#E2E8F0]"
                }`}
                title="Click on the road map to pick departure pin"
              >
                <Compass className="w-3.5 h-3.5 text-amber-500" />
                <span>{isManualPicking ? "Click Map to Pin" : "Pick on Map"}</span>
              </button>
            </div>
          </div>

          {/* ======================================================================= */}
          {/* EXPANDABLE CITY PRESET GRID & AUTOCOMPLETE                              */}
          {/* ======================================================================= */}
          <AnimatePresence>
            {isChoosingCity && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="p-5 rounded-3xl bg-white border border-[#E5E7EB] shadow-xs flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#F1F5F9] pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-[#05070F]">Select Region or Search Any City</h3>
                      <p className="text-xs text-[#64748B]">Continuous coverage across 36+ verified healthcare hubs in India</p>
                    </div>

                    {/* Autocomplete Input */}
                    <div className="relative min-w-[280px]">
                      <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-2.5 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={handleSearchChange}
                        placeholder="Search city, town, or pincode..."
                        className="w-full pl-9 pr-8 py-1.5 text-xs rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20 bg-[#F8FAFC]"
                      />
                      {isSearching && (
                        <RefreshCw className="w-3.5 h-3.5 text-[#16A34A] animate-spin absolute right-3 top-2.5" />
                      )}

                      {showDropdown && searchResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-[#E2E8F0] shadow-lg z-50 overflow-hidden">
                          {searchResults.map((item, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleSelectSearchResult(item)}
                              className="w-full px-3.5 py-2 text-left text-xs text-[#05070F] hover:bg-[#F0FDF4] hover:text-[#16A34A] flex items-center gap-2 transition-colors border-b border-[#F1F5F9] last:border-b-0 cursor-pointer"
                            >
                              <MapPin className="w-3 h-3 text-[#16A34A] shrink-0" />
                              <span className="truncate">{item.display_name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Zone Filter Tabs */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[#94A3B8] font-bold mr-1 shrink-0">
                      Zone:
                    </span>
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
                        type="button"
                        onClick={() => setSelectedZone(zone.id)}
                        className={`px-3 py-1 rounded-xl text-xs transition-all cursor-pointer font-semibold ${
                          selectedZone === zone.id
                            ? "bg-[#05070F] text-white shadow-2xs"
                            : "bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]"
                        }`}
                      >
                        {zone.label}
                      </button>
                    ))}
                  </div>

                  {/* Preset City Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {ALL_REGION_PRESETS.filter(
                      (p) => selectedZone === "all" || p.zone === selectedZone
                    ).map((preset) => {
                      const isSelected = searchRegion.label.includes(preset.name);
                      return (
                        <button
                          key={preset.name}
                          type="button"
                          onClick={() => handleSelectPreset(preset)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                            isSelected
                              ? "bg-[#05070F] text-white shadow-xs"
                              : "bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#334155] border border-[#E2E8F0]"
                          }`}
                        >
                          {preset.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Condition-Specific Discovery Filter Box */}
          <AnimatePresence>
            {viewMode === "issues" && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="p-5 rounded-3xl bg-white border border-[#E5E7EB] shadow-xs flex flex-col gap-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h3 className="text-xs font-bold text-[#05070F] uppercase tracking-wide">
                        Filter by Medical Condition / Specialty
                      </h3>
                      <p className="text-[11px] text-[#64748B]">
                        Prioritizes certified facilities with verified specialist on-duty coverage
                      </p>
                    </div>
                    {specialtyFilter !== "all" && (
                      <span className="text-[11px] font-bold text-[#16A34A] bg-[#F0FDF4] px-2.5 py-0.5 rounded-full border border-[#DCFCE7]">
                        Active Filter: {specialtyFilter}
                      </span>
                    )}
                  </div>

                  {/* Specialty chips grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pt-1">
                    {MEDICAL_ISSUE_OPTIONS.map((item) => {
                      const isActive = specialtyFilter === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setSpecialtyFilter(item.id);
                            setIssueSearchText(item.label);
                            setCurrentPage(1);
                          }}
                          className={`p-2 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-0.5 ${
                            isActive
                              ? "bg-[#05070F] text-white border-[#05070F] shadow-xs font-bold"
                              : "bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#334155] border-[#E2E8F0]"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <SpecialtyIcon id={item.id} className="w-3.5 h-3.5 shrink-0" />
                            <span className="text-xs font-semibold truncate">{item.label}</span>
                          </div>
                          <span className={`text-[10px] truncate ${isActive ? "text-[#B7FF72]" : "text-[#94A3B8]"}`}>
                            {item.famousFor}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </header>

        {/* ========================================================================= */}
        {/* DOMINANT 60/40 WORKSPACE: MAP (LEFT) + RANKED DIRECTORY (RIGHT)          */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* ----------------------------------------------------------------------- */}
          {/* LEFT COLUMN: DOMINANT MAP + SELECTED FACILITY ROUTE INTELLIGENCE (~58%)  */}
          {/* ----------------------------------------------------------------------- */}
          <div className="lg:col-span-7 xl:col-span-7 flex flex-col gap-4 min-w-0 lg:sticky lg:top-24">

            {/* MAP CONTAINER */}
            <div
              id="care-command-map"
              className="rounded-3xl overflow-hidden border border-[#E5E7EB] shadow-xs bg-white h-[480px] sm:h-[520px] lg:h-[560px] relative"
            >
              <InteractiveRouteMap
                patientCoords={userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null}
                patientLocationName={userLocation?.label}
                mapCenter={{ lat: searchRegion.lat, lng: searchRegion.lng }}
                selectedHospital={selectedHospital}
                allHospitals={filteredAndSortedHospitals}
                isManualPicking={isManualPicking}
                onSelectHospital={(h) => handleSelectHospital(h, false)}
                onConfirmManualLocation={handleConfirmManualLocation}
                onCancelManualPicking={() => setIsManualPicking(false)}
                onRouteCalculated={(stats) => setLiveRoadStats(stats)}
                onResetToRecommended={handleResetToRecommended}
                onRequestLocation={handleDetectLiveLocation}
              />
            </div>

            {/* DEDICATED SELECTED HOSPITAL ROUTE CARD */}
            {selectedHospital ? (
              <div
                data-selected-facility-card="true"
                className="rounded-3xl bg-white border border-[#E5E7EB] shadow-xs p-5 sm:p-6 flex flex-col gap-4"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                          selectedHospital.id === recommendedHospital?.id
                            ? "bg-[#05070F] text-white"
                            : "bg-[#F1F5F9] text-[#334155]"
                        }`}
                      >
                        #{selectedHospital.rank} {selectedHospital.id === recommendedHospital?.id ? "Recommended Match" : "Selected Facility"}
                      </span>

                      {selectedHospital.sourceType === "official_registry" && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#F0FDF4] text-[#16A34A] border border-[#DCFCE7]">
                          ✓ Verified Registry
                        </span>
                      )}

                      {selectedHospital.isEmergency24x7 && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200">
                          24/7 ER
                        </span>
                      )}

                      {(selectedHospital as any).ownership === "government" && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
                          Government
                        </span>
                      )}

                      {selectedHospital.acceptsPublicInsurance && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 border border-purple-200">
                          Ayushman / PM-JAY
                        </span>
                      )}
                    </div>

                    <h2 className="text-base sm:text-lg font-extrabold text-[#05070F] leading-tight">
                      {selectedHospital.name}
                    </h2>
                    <p className="text-xs text-[#64748B] mt-0.5 line-clamp-1">
                      {selectedHospital.famousFor || getHospitalFamousFor(selectedHospital)}
                    </p>
                  </div>

                  {/* Reset to #1 Recommended if another hospital is active */}
                  {selectedHospital.id !== recommendedHospital?.id && (
                    <button
                      type="button"
                      onClick={handleResetToRecommended}
                      className="px-3 py-1.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-xs font-semibold text-[#05070F] transition-colors cursor-pointer shrink-0"
                    >
                      Reset to #1 Match
                    </button>
                  )}
                </div>

                {/* Address Strip */}
                <div className="flex items-center gap-2 text-xs text-[#475569] bg-[#F8FAFC] px-3.5 py-2.5 rounded-xl border border-[#E2E8F0]">
                  <MapPin className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
                  <span className="truncate">{selectedHospital.address}</span>
                </div>

                {/* Driving Route Telemetry Strip */}
                {liveRoadStats?.unavailable ? (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex-wrap">
                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Road route telemetry temporarily unavailable</span>
                      <span className="text-amber-700 font-normal">·</span>
                      <span className="text-amber-800">Direct phone & navigation ready</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-[#F0FDF4] border border-[#DCFCE7] flex-wrap">
                    <div className="flex items-center gap-2 text-xs font-bold text-[#18251D]">
                      {liveRoadStats?.isCalculating ? (
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-[#16A34A] border-t-transparent animate-spin shrink-0" />
                      ) : (
                        <Car className="w-4 h-4 text-[#16A34A] shrink-0" />
                      )}
                      <span>
                        ~{liveRoadStats ? liveRoadStats.etaMinutes : (selectedHospital.etaMinutes || calculateCalibratedDriveTime(selectedHospital.distanceKm))} min drive
                      </span>
                      <span className="text-[#94A3B8] font-normal">·</span>
                      <span className="text-[#475569] font-medium">
                        ~{liveRoadStats ? liveRoadStats.roadDistanceKm.toFixed(1) : selectedHospital.distanceKm.toFixed(1)} km by road
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#16A34A] font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse" />
                      <span>
                        {liveRoadStats?.source === "osrm_turn_by_turn" ? "Turn-by-Turn Route" : "Calibrated Road Route"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-2.5 flex-wrap pt-1">
                  {(() => {
                    let directPhone = "";
                    if (selectedHospital.emergencyPhone && selectedHospital.emergencyPhone !== "108" && selectedHospital.emergencyPhone !== "112") {
                      directPhone = selectedHospital.emergencyPhone.trim();
                    } else if (selectedHospital.phone && selectedHospital.phone !== "108" && selectedHospital.phone !== "112") {
                      directPhone = selectedHospital.phone.trim();
                    }
                    const hasDirectPhone = isValidHospitalPhoneNumber(directPhone);

                    return hasDirectPhone ? (
                      <a
                        href={`tel:${directPhone}`}
                        className={`flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-white font-bold text-xs shadow-xs active:scale-98 transition-all cursor-pointer ${
                          selectedHospital.isEmergency24x7 ? "bg-rose-600 hover:bg-rose-700" : "bg-[#05070F] hover:bg-black"
                        }`}
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                        <span>Call Facility ({directPhone})</span>
                      </a>
                    ) : (
                      <a
                        href="tel:108"
                        className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-white font-bold text-xs shadow-xs active:scale-98 transition-all cursor-pointer bg-rose-600 hover:bg-rose-700"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                        <span>Call 108 Ambulance (Dispatch)</span>
                      </a>
                    );
                  })()}

                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#05070F] hover:bg-black text-white font-bold text-xs shadow-xs active:scale-98 transition-all cursor-pointer"
                  >
                    <span>Start Navigation</span>
                    <ExternalLink className="w-3.5 h-3.5 text-[#B7FF72]" />
                  </a>
                </div>
              </div>
            ) : (
              <div className="rounded-3xl bg-white border border-[#E5E7EB] p-6 text-center text-xs text-[#64748B]">
                Select a facility from the directory to inspect calibrated road routes and emergency lines.
              </div>
            )}
          </div>

          {/* ----------------------------------------------------------------------- */}
          {/* RIGHT COLUMN: MATCHING FACILITIES DIRECTORY & FILTERS (~42%)            */}
          {/* ----------------------------------------------------------------------- */}
          <div className="lg:col-span-5 xl:col-span-5 flex flex-col gap-4 min-w-0">

            {/* Category Fallback Warning Banner */}
            {categoryFallback && fallbackBanner && (
              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex items-start gap-2.5 shadow-2xs">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 leading-snug">
                  <strong className="font-bold text-amber-900 block mb-0.5">Specialty Fallback Active</strong>
                  <span className="text-[11px] text-amber-800">{fallbackBanner}</span>
                </div>
              </div>
            )}

            {/* Directory Control Strip: Count, Sort, Ownership */}
            <div className="p-4 rounded-2xl bg-white border border-[#E5E7EB] shadow-xs flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold text-[#05070F] uppercase tracking-wider">
                    Matching Facilities
                  </h3>
                  <span className="text-[10px] font-mono font-bold bg-[#F1F5F9] text-[#18251D] px-2 py-0.5 rounded-full border border-[#E2E8F0]">
                    {filteredAndSortedHospitals.length}
                  </span>
                  {isRefreshing && (
                    <RefreshCw className="w-3 h-3 text-[#16A34A] animate-spin" />
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="text-[11px] font-semibold text-[#334155] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-2.5 py-1 focus:outline-none cursor-pointer"
                  >
                    <option value="fastest">Fastest / Best Match</option>
                    <option value="government">Government First</option>
                    <option value="rating">Highest Rating</option>
                  </select>

                  <select
                    value={ownershipFilter}
                    onChange={(e) => setOwnershipFilter(e.target.value)}
                    className="text-[11px] font-semibold text-[#334155] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-2.5 py-1 focus:outline-none cursor-pointer"
                  >
                    <option value="all">All Ownership</option>
                    <option value="government">Govt Only</option>
                    <option value="private">Private Only</option>
                  </select>
                </div>
              </div>

              <div className="text-[11px] text-[#64748B] flex items-center justify-between">
                <span>{categoryLabel} · Ranked by road distance</span>
                <button
                  type="button"
                  onClick={() => setIsRationaleExpanded(!isRationaleExpanded)}
                  className="text-[10px] font-bold text-[#16A34A] hover:underline cursor-pointer flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{isRationaleExpanded ? "Hide Match Factors" : "Why Ranked #1"}</span>
                </button>
              </div>

              {/* Collapsible Recommendation Factors */}
              {isRationaleExpanded && selectedHospital && (
                <div className="pt-2 border-t border-[#F1F5F9] grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-[#475569]">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                    <span className="truncate">{selectedHospital.isEmergency24x7 ? "24/7 Verified Emergency Care" : "Specialized Care"}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                    <span className="truncate">
                      {selectedHospital.sourceType === "official_registry" ? "Official Health Registry" : "Verified Provider"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                    <span className="truncate">~{selectedHospital.distanceKm.toFixed(1)} km road distance</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                    <span className="truncate">
                      {selectedHospital.acceptsPublicInsurance ? "Ayushman PM-JAY Cashless" : "Arterial Road Reachability"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* RESULTS LIST: NORMAL DOCUMENT FLOW — ZERO NESTED SCROLLBARS */}
            <div className="flex flex-col gap-2.5">
              {loading && rawHospitals.length === 0 ? (
                <div className="p-8 rounded-3xl bg-white border border-[#E5E7EB] text-center flex flex-col items-center justify-center gap-3">
                  <div className="w-6 h-6 rounded-full border-2 border-[#16A34A] border-t-transparent animate-spin" />
                  <p className="text-xs font-bold text-[#05070F]">Evaluating verified facilities nearby...</p>
                </div>
              ) : filteredAndSortedHospitals.length === 0 ? (
                <div className="p-8 rounded-3xl bg-white border border-[#E5E7EB] text-center flex flex-col items-center justify-center gap-2">
                  <Building2 className="w-6 h-6 text-[#94A3B8]" />
                  <p className="text-xs font-bold text-[#05070F]">No facilities match current filters</p>
                  <p className="text-[11px] text-[#64748B]">Try selecting another region or clearing specialty filter.</p>
                </div>
              ) : (
                pageHospitals.map((hosp) => {
                  const isSelected = hosp.id === selectedHospital?.id;
                  const eta = hosp.etaMinutes || Math.max(3, Math.round(hosp.distanceKm * 1.5));

                  return (
                    <div
                      key={hosp.id}
                      data-facility-card="true"
                      data-facility-id={hosp.id}
                      onClick={() => handleSelectHospital(hosp, false)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2 ${
                        isSelected
                          ? "bg-[#05070F] text-white border-[#05070F] shadow-md ring-2 ring-[#B7FF72]/40"
                          : "bg-white hover:bg-[#F8FAFC] text-[#05070F] border-[#E5E7EB] hover:border-[#CBD5E1] shadow-2xs"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                              isSelected
                                ? "bg-[#B7FF72] text-[#05070F]"
                                : hosp.rank === 1
                                ? "bg-[#05070F] text-white"
                                : "bg-[#F1F5F9] text-[#475569]"
                            }`}
                          >
                            #{hosp.rank} {hosp.rank === 1 ? "Top Match" : ""}
                          </span>

                          {hosp.sourceType === "official_registry" && (
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${
                                isSelected
                                  ? "bg-white/10 text-[#B7FF72] border-[#B7FF72]/30"
                                  : "bg-[#F0FDF4] text-[#16A34A] border-[#DCFCE7]"
                              }`}
                            >
                              ✓ Verified
                            </span>
                          )}

                          {hosp.isEmergency24x7 && (
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                                isSelected
                                  ? "bg-rose-950/80 text-rose-300 border border-rose-800"
                                  : "bg-rose-50 text-rose-800 border border-rose-200"
                              }`}
                            >
                              24/7 ER
                            </span>
                          )}

                          {(hosp as any).ownership === "government" && (
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                                isSelected
                                  ? "bg-blue-950/80 text-blue-300 border border-blue-800"
                                  : "bg-blue-50 text-blue-800 border border-blue-200"
                              }`}
                            >
                              Govt
                            </span>
                          )}
                        </div>

                        {/* Distance & ETA */}
                        <div className="flex items-center gap-1.5 shrink-0 text-right">
                          <Car className={`w-3.5 h-3.5 ${isSelected ? "text-[#B7FF72]" : "text-[#16A34A]"}`} />
                          <span className={`text-xs font-mono font-bold ${isSelected ? "text-white" : "text-[#05070F]"}`}>
                            ~{eta}m
                          </span>
                          <span className={`text-[11px] ${isSelected ? "text-white/60" : "text-[#64748B]"}`}>
                            · {hosp.distanceKm.toFixed(1)} km
                          </span>
                        </div>
                      </div>

                      <div>
                        <h4 className={`text-xs sm:text-sm font-bold leading-snug ${isSelected ? "text-white" : "text-[#05070F]"}`}>
                          {hosp.name}
                        </h4>
                        <p className={`text-[11px] mt-0.5 line-clamp-1 ${isSelected ? "text-white/70" : "text-[#64748B]"}`}>
                          {hosp.famousFor || getHospitalFamousFor(hosp)}
                        </p>
                      </div>

                      <div className={`flex items-center gap-1.5 text-[10px] truncate ${isSelected ? "text-white/60" : "text-[#94A3B8]"}`}>
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{hosp.address}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* TRUE PAGINATION BAR */}
            {totalPages > 1 && (
              <div className="pt-2 flex items-center justify-between gap-3 text-xs border-t border-[#E5E7EB]">
                <span className="text-[11px] text-[#64748B]">
                  Showing {startIndex + 1}–{endIndex} of {filteredAndSortedHospitals.length}
                </span>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] disabled:opacity-30 disabled:cursor-not-allowed text-[#05070F] transition-colors cursor-pointer"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>

                  {pageNumbers.map((p, idx) =>
                    p === -1 ? (
                      <span key={`ellipsis-${idx}`} className="px-1.5 text-xs text-[#94A3B8]">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCurrentPage(p)}
                        className={`w-7 h-7 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          currentPage === p
                            ? "bg-[#05070F] text-white shadow-2xs"
                            : "bg-white hover:bg-[#F8FAFC] text-[#475569] border border-[#E2E8F0]"
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] disabled:opacity-30 disabled:cursor-not-allowed text-[#05070F] transition-colors cursor-pointer"
                    title="Next page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </main>

      {/* Global Architectural Brand Ledger Footer */}
      <ArchitecturalBrandLedgerFooter />
    </div>
  );
}
