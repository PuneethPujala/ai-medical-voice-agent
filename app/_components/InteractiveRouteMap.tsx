"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Navigation, ExternalLink, Plus, Minus, Locate, Check, MapPin, Layers, PhoneCall, Sparkles } from "lucide-react";
import { getHospitalFamousFor, calculateDistanceKm, INDIAN_HOSPITALS_DATASET } from "@/lib/hospitals-india-data";

export interface HospitalItem {
  id: string;
  name: string;
  specialty: string[];
  famousFor?: string;
  city: string;
  address: string;
  phone: string;
  emergencyPhone: string;
  distanceKm: number;
  latitude: number;
  longitude: number;
  googleMapsUrl?: string;
  matchReasons?: string[];
  matchLabel?: string;
  rating?: number;
  isEmergency24x7?: boolean;
  etaMinutes?: number;
  isEligible?: boolean;
  acceptsPublicInsurance?: boolean;
  ownership?: string;
  rank?: number;
  matchTier?: "verified" | "inferred" | "fallback";
  matchedCategory?: string;
  isFallback?: boolean;
  actionType?: "call_ed" | "call_hospital";
}

export function calculateCalibratedDriveTime(distanceKm: number, rawOsrmSeconds?: number): number {
  if (rawOsrmSeconds && rawOsrmSeconds > 0) {
    const rawMinutes = rawOsrmSeconds / 60;
    if (distanceKm <= 4) {
      return Math.max(4, Math.round(rawMinutes * 1.5 + 2));
    } else if (distanceKm <= 12) {
      return Math.max(6, Math.round(rawMinutes * 1.45 + 3));
    } else {
      return Math.max(10, Math.round(rawMinutes * 1.4 + 4));
    }
  }

  if (distanceKm <= 4) {
    return Math.max(4, Math.round((distanceKm / 18) * 60));
  } else if (distanceKm <= 12) {
    return Math.max(6, Math.round((distanceKm / 25) * 60));
  } else {
    return Math.max(10, Math.round(13 + ((distanceKm - 4) / 45) * 60));
  }
}

export const TILE_LAYERS = {
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: {
      maxZoom: 19,
      attribution:
        "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP",
    },
  },
};

export interface InteractiveRouteMapProps {
  patientCoords: { lat: number; lng: number } | null;
  patientLocationName?: string;
  selectedHospital: HospitalItem | null;
  allHospitals: HospitalItem[];
  isManualPicking: boolean;
  onSelectHospital: (hospital: HospitalItem) => void;
  onConfirmManualLocation: (lat: number, lng: number) => void;
  onCancelManualPicking: () => void;
  onRouteCalculated?: (info: { roadDistanceKm: number; etaMinutes: number }) => void;
  onResetToRecommended?: () => void;
  mapCenter?: { lat: number; lng: number };
  onRequestLocation?: () => void;
}

export function InteractiveRouteMap({
  patientCoords,
  patientLocationName,
  selectedHospital,
  allHospitals,
  isManualPicking,
  onSelectHospital,
  onConfirmManualLocation,
  onCancelManualPicking,
  onRouteCalculated,
  onResetToRecommended,
  mapCenter,
  onRequestLocation,
}: InteractiveRouteMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const routeLayerRef = useRef<any>(null);
  const markersLayerRef = useRef<any>(null);
  const baseLayerRef = useRef<any>(null);
  const hospitalMarkersMapRef = useRef<Map<string, { marker: any; hosp: HospitalItem }>>(new Map());

  // Keep references to latest props to prevent stale closure in map event listeners
  const allHospitalsRef = useRef(allHospitals);
  allHospitalsRef.current = allHospitals;
  const patientCoordsRef = useRef(patientCoords);
  patientCoordsRef.current = patientCoords;
  const onSelectHospitalRef = useRef(onSelectHospital);
  onSelectHospitalRef.current = onSelectHospital;
  const onResetToRecommendedRef = useRef(onResetToRecommended);
  onResetToRecommendedRef.current = onResetToRecommended;

  // Track sequence ID to cancel older routing requests and prevent race conditions
  const routingRequestIdRef = useRef<number>(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const safetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const prevCoordsRef = useRef<string>("");
  const prevHospitalIdRef = useRef<string>("");

  const [mapStyle, setMapStyle] = useState<"osm" | "satellite">("osm");

  const [routeInfo, setRouteInfo] = useState<{
    distanceKm: number;
    etaMinutes: number;
    roadGeometryAvailable: boolean;
  }>({
    distanceKm: selectedHospital?.distanceKm || 1.1,
    etaMinutes: calculateCalibratedDriveTime(selectedHospital?.distanceKm || 1.1),
    roadGeometryAvailable: false,
  });
  const [isRouting, setIsRouting] = useState<boolean>(false);

  // Switch between clean OpenStreetMap and ESRI World Satellite
  const switchMapStyle = useCallback((newStyle: "osm" | "satellite") => {
    setMapStyle(newStyle);
    if (!mapInstanceRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const map = mapInstanceRef.current;
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
    }
    const config = TILE_LAYERS[newStyle];
    const layer = L.tileLayer(config.url, config.options);
    baseLayerRef.current = layer;
    layer.addTo(map);
    layer.bringToBack();
  }, []);

  // Helper to generate natural bezier highway spline between coordinates
  function generateHighwaySpline(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number }
  ): [number, number][] {
    const steps = 16;
    const points: [number, number][] = [];
    const midLat = (origin.lat + destination.lat) / 2;
    const midLng = (origin.lng + destination.lng) / 2;
    const dLat = destination.lat - origin.lat;
    const dLng = destination.lng - origin.lng;
    const perpLat = -dLng * 0.08;
    const perpLng = dLat * 0.08;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const lat =
        (1 - t) * (1 - t) * origin.lat + 2 * (1 - t) * t * (midLat + perpLat) + t * t * destination.lat;
      const lng =
        (1 - t) * (1 - t) * origin.lng + 2 * (1 - t) * t * (midLng + perpLng) + t * t * destination.lng;
      points.push([parseFloat(lat.toFixed(6)), parseFloat(lng.toFixed(6))]);
    }
    return points;
  }

  function createHospitalIcon(L: any, hosp: HospitalItem, isSelected: boolean, rank?: number) {
    const isEligible = Boolean(hosp.isEligible);
    const famousFor = hosp.famousFor || getHospitalFamousFor(hosp);
    const shortName = hosp.name.split("-")[0].split("(")[0].trim();
    const effectiveRank = hosp.rank ?? rank;
    const isTopRanked = typeof effectiveRank === "number" && effectiveRank >= 1 && effectiveRank <= 10;

    if (isSelected) {
      const pinColor = hosp.isEmergency24x7 ? "#e11d48" : "#020617";
      const etaNum = hosp.etaMinutes || calculateCalibratedDriveTime(hosp.distanceKm);

      return L.divIcon({
        className: "custom-hospital-marker",
        html: `
          <div style="position:relative; width:44px; height:44px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:1000;">
            <div style="position:absolute; width:44px; height:44px; border-radius:50%; background:${hosp.isEmergency24x7 ? "rgba(225,29,72,0.22)" : "rgba(2,6,23,0.22)"}; animation:pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;"></div>
            <div style="position:relative; width:34px; height:34px; border-radius:10px; background:${pinColor}; border:2.5px solid #FFFFFF; box-shadow:0 4px 14px rgba(2,6,23,0.32); display:flex; align-items:center; justify-content:center; color:#FFFFFF; font-weight:800; font-size:13px; font-family:system-ui,-apple-system,sans-serif;">
              ${effectiveRank ? `#${effectiveRank}` : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`}
            </div>
            <div style="position:absolute; bottom:-48px; left:50%; transform:translateX(-50%); white-space:nowrap; background:#ffffff; color:#0f172a; font-family:system-ui,-apple-system,sans-serif; padding:4px 9px; border-radius:10px; box-shadow:0 4px 14px rgba(2,6,23,0.12); z-index:9999; border:1px solid #e2e8f0; pointer-events:none;">
              <div style="font-size:11px; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:4px; line-height:1.2;">
                ${shortName} <span style="color:#0284c7; font-weight:600;">(${hosp.distanceKm} km · ~${etaNum}m)</span>
              </div>
              <div style="font-size:9.5px; font-weight:500; font-family:monospace; color:${hosp.isFallback ? "#9f1239" : "#1e293b"}; background:${hosp.isFallback ? "#fff1f2" : "#f1f5f9"}; border:1px solid ${hosp.isFallback ? "#fecdd3" : "#e2e8f0"}; padding:1px 6px; border-radius:6px; margin-top:2px; line-height:1.2; display:inline-flex; align-items:center;">
                ${hosp.isFallback ? "Fallback: 24/7 ER" : famousFor}
              </div>
            </div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
    }

    if (isTopRanked) {
      // Pins 1-10: Numbered circular badges matching list rank
      const isFirst = effectiveRank === 1;
      const borderCol = isFirst ? "#020617" : isEligible ? "#0284c7" : "#94a3b8";
      const bgCol = isFirst ? "#020617" : isEligible ? "#f0f9ff" : "#FFFFFF";
      const textCol = isFirst ? "#FFFFFF" : isEligible ? "#0369a1" : "#0f172a";

      return L.divIcon({
        className: "custom-hospital-marker",
        html: `
          <div style="position:relative; width:${isFirst ? "34px" : "28px"}; height:${isFirst ? "34px" : "28px"}; display:flex; align-items:center; justify-content:center; cursor:pointer;">
            ${isFirst ? `<div style="position:absolute; top:-14px; background:#020617; color:#FFFFFF; font-size:8px; font-weight:800; padding:1px 5px; border-radius:4px; white-space:nowrap; letter-spacing:0.3px; box-shadow:0 1px 4px rgba(2,6,23,0.35);">RECOMMENDED</div>` : ""}
            <div style="width:${isFirst ? "26px" : "24px"}; height:${isFirst ? "26px" : "24px"}; border-radius:50%; background:${bgCol}; border:${isFirst ? "2.5px" : "2px"} solid ${borderCol}; box-shadow:0 2px 6px rgba(0,0,0,0.18); display:flex; align-items:center; justify-content:center; color:${textCol}; font-weight:800; font-size:11px; font-family:system-ui,-apple-system,sans-serif;">
              ${effectiveRank}
            </div>
          </div>
        `,
        iconSize: [isFirst ? 34 : 28, isFirst ? 34 : 28],
        iconAnchor: [isFirst ? 17 : 14, isFirst ? 17 : 14],
      });
    }

    // Rank > 10: Subtle small dot (14px)
    return L.divIcon({
      className: "custom-hospital-marker",
      html: `
        <div style="position:relative; width:14px; height:14px; display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:0.75;">
          <div style="width:10px; height:10px; border-radius:50%; background:#CBD5E1; border:1.5px solid #64748B;"></div>
        </div>
      `,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  function createPopupHtml(hosp: HospitalItem, origin?: { lat: number; lng: number } | null) {
    const famousFor = hosp.famousFor || getHospitalFamousFor(hosp);
    const googleMapsUrl = origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${hosp.latitude},${hosp.longitude}&travelmode=driving`
      : `https://www.google.com/maps/search/?api=1&query=${hosp.latitude},${hosp.longitude}`;
    const emergencyNum = hosp.emergencyPhone || hosp.phone || "108";
    const isCallHospital = hosp.actionType === "call_hospital";
    const actionLabel = isCallHospital ? "Call hospital" : "Call ED";
    const actionColor = isCallHospital ? "#020617" : "#e11d48";
    const actionClass = isCallHospital
      ? "bg-slate-950 hover:bg-slate-900"
      : "bg-rose-600 hover:bg-rose-700";

    const matchBadgeClass = hosp.isFallback
      ? "bg-rose-50 text-rose-800 border-rose-200"
      : hosp.matchTier
      ? "bg-cyan-50 text-cyan-800 border-cyan-200"
      : hosp.isEmergency24x7
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : "bg-slate-100 text-slate-800 border-slate-200/80";

    const matchBadgeText = hosp.isFallback
      ? "Fallback: Nearest 24/7 ER"
      : hosp.matchTier
      ? `Matched · ${hosp.matchTier === "verified" ? "Verified" : "Inferred"}`
      : hosp.isEmergency24x7
      ? "24/7 Emergency Care"
      : "Specialty Center";

    const badgeStyle = hosp.isFallback
      ? "background:#fff1f2; color:#9f1239; border:1px solid #fecdd3;"
      : hosp.matchTier
      ? "background:#ecfeff; color:#155e75; border:1px solid #a5f3fc;"
      : hosp.isEmergency24x7
      ? "background:#ecfdf5; color:#065f46; border:1px solid #a7f3d0;"
      : "background:#f1f5f9; color:#1e293b; border:1px solid #e2e8f0;";

    const etaNum = hosp.etaMinutes || calculateCalibratedDriveTime(hosp.distanceKm);

    return `
      <div style="font-family:system-ui,-apple-system,sans-serif; padding:10px 8px; line-height:1.4; max-width:270px; color:#0f172a;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
          <b style="font-size:13px; font-weight:700; color:#0f172a; line-height:1.3;">${hosp.rank ? `#${hosp.rank} ` : ""}${hosp.name}</b>
        </div>
        <div class="${matchBadgeClass} rounded-lg text-xs font-mono font-semibold px-2.5 py-1 inline-flex items-center mb-1.5" style="display:inline-flex; align-items:center; margin-bottom:6px; ${badgeStyle} font-family:monospace; font-size:10px; font-weight:600; padding:2.5px 8px; border-radius:8px;">
          ${matchBadgeText}
        </div>
        <div style="display:flex; align-items:center; gap:6px; font-size:11px; font-weight:600; margin-bottom:4px; color:#0f172a;">
          <span>${hosp.distanceKm} km by road</span>
          <span style="color:#94a3b8;">•</span>
          <span style="color:#0284c7;">~${etaNum} min</span>
        </div>
        <div style="color:#64748b; font-size:10.5px; line-height:1.35; margin-bottom:10px;">${hosp.address}</div>
        <button
          onclick="window.medvoiceSelectHospitalById && window.medvoiceSelectHospitalById('${hosp.id}')"
          class="bg-slate-950 hover:bg-slate-900 text-white font-semibold shadow-xs rounded-xl transition-all cursor-pointer"
          style="width:100%; text-align:center; background:#020617; color:#ffffff; font-weight:600; font-size:11.5px; padding:8px 12px; border-radius:12px; border:1px solid #0f172a; cursor:pointer; margin-bottom:6px; display:flex; align-items:center; justify-content:center; gap:5px; box-shadow:0 1px 2px rgba(0,0,0,0.05); transition:all 0.15s ease;"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
          Select as Destination
        </button>
        <div style="display:flex; gap:6px;">
          <a
            href="tel:${emergencyNum}"
            class="${actionClass} text-white font-semibold shadow-xs rounded-xl transition-all"
            style="flex:1; text-align:center; background:${actionColor}; color:#ffffff; font-weight:600; font-size:11px; padding:7px 8px; border-radius:12px; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:4px; box-shadow:0 1px 2px rgba(0,0,0,0.05); transition:all 0.15s ease;"
          >
            ${actionLabel}
          </a>
          <a
            href="${googleMapsUrl}"
            target="_blank"
            rel="noopener noreferrer"
            class="bg-white hover:bg-slate-50 text-slate-800 border border-slate-200/90 shadow-2xs rounded-xl font-medium transition-all"
            style="flex:1; text-align:center; background:#ffffff; color:#1e293b; font-weight:500; font-size:11px; padding:7px 8px; border-radius:12px; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:4px; border:1px solid #e2e8f0; box-shadow:0 1px 2px rgba(0,0,0,0.03); transition:all 0.15s ease;"
          >
            Directions
          </a>
        </div>
      </div>
    `;
  }

  // Draw driving route from user coordinates to selected hospital
  const drawRouteToHospital = useCallback(
    async (
      L: any,
      map: any,
      targetHospital: HospitalItem,
      autoFrame: boolean = true
    ) => {
      if (
        !map ||
        !routeLayerRef.current ||
        !L ||
        !patientCoords ||
        !Number.isFinite(patientCoords.lat) ||
        !Number.isFinite(patientCoords.lng)
      ) {
        if (routeLayerRef.current) routeLayerRef.current.clearLayers();
        setIsRouting(false);
        return;
      }

      const currentId = ++routingRequestIdRef.current;

      // Abort previous in-flight fetch immediately
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
        activeAbortControllerRef.current = null;
      }

      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }

      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      // Clear previous route lines immediately
      routeLayerRef.current.clearLayers();

      const origin = { lat: patientCoords.lat, lng: patientCoords.lng };
      const destination = { lat: targetHospital.latitude, lng: targetHospital.longitude };

      // 1. INSTANT FAST PREVIEW ROAD SPLINE (0ms latency visual feedback)
      const previewPoints = generateHighwaySpline(origin, destination);
      let dist = targetHospital.distanceKm;
      let dur = calculateCalibratedDriveTime(dist);

      const previewGlowLine = L.polyline(previewPoints, {
        color: "#0284c7",
        weight: 9,
        opacity: 0.22,
        lineCap: "round",
        lineJoin: "round",
      });

      const previewCasingLine = L.polyline(previewPoints, {
        color: "#020617",
        weight: 5,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round",
      });

      const previewCoreLine = L.polyline(previewPoints, {
        color: "#38bdf8",
        weight: 3.5,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        dashArray: "6, 6",
      });

      routeLayerRef.current.addLayer(previewGlowLine);
      routeLayerRef.current.addLayer(previewCasingLine);
      routeLayerRef.current.addLayer(previewCoreLine);

      if (autoFrame && previewPoints.length > 1) {
        if (map.invalidateSize) map.invalidateSize();
        const bounds = L.latLngBounds([
          [origin.lat, origin.lng],
          [destination.lat, destination.lng],
        ]);
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15, animate: true });
        }
      }

      // Immediately show route stats
      setRouteInfo({
        distanceKm: dist,
        etaMinutes: dur,
        roadGeometryAvailable: false,
      });

      setIsRouting(true);

      // GUARANTEE: Safety timer ensures calculating indicator can NEVER get stuck
      safetyTimeoutRef.current = setTimeout(() => {
        if (routingRequestIdRef.current === currentId) {
          setIsRouting(false);
        }
      }, 2500);

      try {
        // 2. Fetch turn-by-turn road route from /api/route (proxying OSRM with local fallback)
        const routeUrl = `/api/route?fromLat=${origin.lat}&fromLng=${origin.lng}&toLat=${destination.lat}&toLng=${destination.lng}`;
        const res = await fetch(routeUrl, {
          signal: abortController.signal,
        });

        if (res.ok) {
          const data = await res.json();
          // Check if this request is still the most recent one
          if (routingRequestIdRef.current === currentId && data.success && Array.isArray(data.coordinates) && data.coordinates.length > 1) {
            const roadPoints: [number, number][] = data.coordinates;
            dist = data.roadDistanceKm || dist;
            dur = data.etaMinutes || dur;

            // Clear preview and draw accurate turn-by-turn geometry with luminous navigation corridor
            routeLayerRef.current.clearLayers();

            const roadGlow = L.polyline(roadPoints, {
              color: "#0284c7",
              weight: 9.5,
              opacity: 0.28,
              lineCap: "round",
              lineJoin: "round",
            });

            const roadCasing = L.polyline(roadPoints, {
              color: "#020617",
              weight: 5.5,
              opacity: 0.92,
              lineCap: "round",
              lineJoin: "round",
            });

            const roadCore = L.polyline(roadPoints, {
              color: "#38bdf8",
              weight: 3.5,
              opacity: 1,
              lineCap: "round",
              lineJoin: "round",
            });

            routeLayerRef.current.addLayer(roadGlow);
            routeLayerRef.current.addLayer(roadCasing);
            routeLayerRef.current.addLayer(roadCore);

            if (autoFrame && roadPoints.length > 1) {
              if (map.invalidateSize) map.invalidateSize();
              const roadBounds = L.latLngBounds(roadPoints);
              if (roadBounds.isValid()) {
                map.fitBounds(roadBounds, { padding: [60, 60], maxZoom: 15, animate: true });
              }
            }

            setRouteInfo({
              distanceKm: dist,
              etaMinutes: dur,
              roadGeometryAvailable: true,
            });

            if (onRouteCalculated) {
              onRouteCalculated({ roadDistanceKm: dist, etaMinutes: dur });
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.warn("[InteractiveRouteMap] Road route using preview geometry:", err.message);
        }
      } finally {
        if (routingRequestIdRef.current === currentId) {
          if (safetyTimeoutRef.current) {
            clearTimeout(safetyTimeoutRef.current);
            safetyTimeoutRef.current = null;
          }
          activeAbortControllerRef.current = null;
          setIsRouting(false);
        }
      }
    },
    [patientCoords?.lat, patientCoords?.lng, onRouteCalculated]
  );

  // Renders User Location and Hospital Destination Markers
  const renderMarkers = useCallback(
    (L: any, map: any) => {
      if (!map || !markersLayerRef.current || !L) return;

      markersLayerRef.current.clearLayers();
      hospitalMarkersMapRef.current.clear();

      if (isManualPicking) return;

      // 1. USER LOCATION MARKER (Render ONLY when patientCoords is non-null and valid)
      if (patientCoords && Number.isFinite(patientCoords.lat) && Number.isFinite(patientCoords.lng)) {
        const origin = { lat: patientCoords.lat, lng: patientCoords.lng };
        const userPinIcon = L.divIcon({
          className: "custom-user-pin",
          html: `
            <div style="position:relative; width:34px; height:34px; display:flex; align-items:center; justify-content:center;">
              <div style="position:absolute; width:32px; height:32px; border-radius:50%; background:rgba(2,6,23,0.18); animation:ping 2.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
              <div style="position:relative; width:20px; height:20px; border-radius:50%; background:#020617; border:2.5px solid #ffffff; box-shadow:0 2px 8px rgba(2,6,23,0.25); display:flex; align-items:center; justify-content:center;">
                <div style="width:5px; height:5px; border-radius:50%; background:#ffffff;"></div>
              </div>
              <div style="position:absolute; top:-22px; white-space:nowrap; background:#020617; color:#ffffff; font-family:sans-serif; font-size:10px; font-weight:600; padding:2px 7px; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.2); pointer-events:none;">
                Your location
              </div>
            </div>
          `,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        });

        const userMarker = L.marker([origin.lat, origin.lng], { icon: userPinIcon, zIndexOffset: 1000 });
        userMarker.bindPopup(`
          <div style="font-family:sans-serif; padding:4px; line-height:1.4;">
            <b style="color:#0f172a; font-size:12px; display:inline-flex; align-items:center; gap:4px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
              Your location
            </b><br/>
            <span style="color:#64748b; font-size:11px;">${patientLocationName}</span>
          </div>
        `);
        markersLayerRef.current.addLayer(userMarker);
      }

      // Expose click helper for popup navigation
      (window as any).medvoiceSelectHospitalById = (hospId: string) => {
        const found = allHospitals.find((h) => h.id === hospId);
        if (found) onSelectHospital(found);
      };

      // 2. HOSPITAL DESTINATION MARKERS (Restrained, low noise, selected is primary)
      allHospitals.forEach((hosp, idx) => {
        const hLat = hosp.latitude;
        const hLng = hosp.longitude;
        if (!hLat || !hLng) return;

        const isSelected = selectedHospital?.id === hosp.id;
        const effectiveRank = hosp.rank ?? (idx + 1);
        const hospIcon = createHospitalIcon(L, hosp, isSelected, effectiveRank);

        const marker = L.marker([hLat, hLng], {
          icon: hospIcon,
          zIndexOffset: isSelected ? 1400 : hosp.isEligible ? 400 : 100,
        });

        const famousFor = hosp.famousFor || getHospitalFamousFor(hosp);

        // Hover tooltip
        marker.bindTooltip(
          `
          <div style="font-family:system-ui,-apple-system,sans-serif; padding:4px 6px; line-height:1.35; max-width:240px;">
            <b style="color:#0f172a; font-size:11px; display:block;">${effectiveRank ? `#${effectiveRank} ` : ""}${hosp.name}</b>
            <div style="margin:3px 0; display:inline-flex; align-items:center; background:#f1f5f9; color:#1e293b; border:1px solid #e2e8f0; font-family:monospace; font-size:9.5px; font-weight:500; padding:1.5px 6px; border-radius:6px;">
              ${famousFor}
            </div><br/>
            <span style="color:#64748b; font-size:9.5px;">${hosp.distanceKm} km by road • ~${hosp.etaMinutes || calculateCalibratedDriveTime(hosp.distanceKm)} min</span>
          </div>
        `,
          { direction: "top", offset: [0, -16], opacity: 0.96 }
        );

        // Click popup
        marker.bindPopup(createPopupHtml(hosp, patientCoords));

        // Clicking marker immediately selects this hospital and changes route
        marker.on("click", (e: any) => {
          if (L.DomEvent) L.DomEvent.stopPropagation(e);
          onSelectHospital(hosp);
        });

        hospitalMarkersMapRef.current.set(hosp.id, { marker, hosp });
        markersLayerRef.current.addLayer(marker);
      });
    },
    [patientCoords?.lat, patientCoords?.lng, patientLocationName, isManualPicking, allHospitals, onSelectHospital]
  );

  // Initialize Leaflet Map on Mount
  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (typeof window === "undefined" || !mapContainerRef.current) return;

      const L = (await import("leaflet")).default;
      leafletRef.current = L;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }

      if (!mapContainerRef.current || !isMounted) return;

      const initialCenter: [number, number] =
        patientCoords && Number.isFinite(patientCoords.lat) && Number.isFinite(patientCoords.lng)
          ? [patientCoords.lat, patientCoords.lng]
          : mapCenter && Number.isFinite(mapCenter.lat) && Number.isFinite(mapCenter.lng)
          ? [mapCenter.lat, mapCenter.lng]
          : selectedHospital
          ? [selectedHospital.latitude, selectedHospital.longitude]
          : [20.5937, 78.9629];

      const initialZoom = patientCoords ? 14 : selectedHospital ? 13 : 5;

      const map = L.map(mapContainerRef.current, {
        center: initialCenter,
        zoom: initialZoom,
        zoomControl: false,
        attributionControl: false,
      });

      // 100% Free OpenStreetMap standard tiles (Zero API keys, zero watermarks)
      const initialLayerConfig = TILE_LAYERS[mapStyle];
      const initialTileLayer = L.tileLayer(initialLayerConfig.url, initialLayerConfig.options).addTo(map);
      baseLayerRef.current = initialTileLayer;

      // Map click: ONLY select hospital if user clicks on or near an existing hospital marker pin
      map.on("click", (e: any) => {
        if (isManualPicking) return;
        const clickPoint = e.layerPoint;
        let closestHosp: HospitalItem | null = null;
        let minDistancePx = 35; // 35px click tolerance around hospital pin

        hospitalMarkersMapRef.current.forEach(({ marker, hosp }) => {
          const markerPoint = map.latLngToLayerPoint(marker.getLatLng());
          const distPx = clickPoint.distanceTo(markerPoint);
          if (distPx < minDistancePx) {
            minDistancePx = distPx;
            closestHosp = hosp;
          }
        });

        if (closestHosp) {
          onSelectHospitalRef.current(closestHosp);
        } else {
          // Empty map click: return to recommended (#1)
          if (onResetToRecommendedRef.current) {
            onResetToRecommendedRef.current();
          }
        }
      });

      mapInstanceRef.current = map;
      markersLayerRef.current = L.layerGroup().addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);

      // Leaflet layout invalidation to ensure crisp rendering
      setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      }, 100);

      renderMarkers(L, map);

      if (
        selectedHospital &&
        selectedHospital.latitude &&
        selectedHospital.longitude &&
        patientCoords &&
        Number.isFinite(patientCoords.lat) &&
        Number.isFinite(patientCoords.lng)
      ) {
        prevHospitalIdRef.current = selectedHospital.id;
        prevCoordsRef.current = `${patientCoords.lat},${patientCoords.lng}`;
        drawRouteToHospital(L, map, selectedHospital, true);
      }
    }

    initMap();

    return () => {
      isMounted = false;
      if (safetyTimeoutRef.current) {
        clearTimeout(safetyTimeoutRef.current);
        safetyTimeoutRef.current = null;
      }
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
        activeAbortControllerRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      leafletRef.current = null;
    };
  }, []);

  // Update Markers Layer ONLY when allHospitals or patientCoords or isManualPicking changes
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current) return;
    renderMarkers(leafletRef.current, mapInstanceRef.current);
  }, [renderMarkers]);

  // Update Route & Marker Selection Highlights without rebuilding layer
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const map = mapInstanceRef.current;

    // 1. Update marker visual highlights and popup state
    hospitalMarkersMapRef.current.forEach(({ marker, hosp }) => {
      const isSelected = selectedHospital?.id === hosp.id;
      marker.setIcon(createHospitalIcon(L, hosp, isSelected, hosp.rank));
      marker.setZIndexOffset(isSelected ? 1400 : hosp.isEligible ? 400 : 100);
      if (isSelected) {
        marker.openPopup();
      }
    });

    // 2. Draw route
    if (!patientCoords || !Number.isFinite(patientCoords.lat) || !Number.isFinite(patientCoords.lng)) {
      if (routeLayerRef.current) {
        routeLayerRef.current.clearLayers();
      }
      setIsRouting(false);
      prevCoordsRef.current = "";
      return;
    }

    const coordsKey = `${patientCoords.lat},${patientCoords.lng}`;
    const hospitalKey = selectedHospital?.id || "";

    const hasChanged =
      prevCoordsRef.current !== coordsKey || prevHospitalIdRef.current !== hospitalKey;

    if (!hasChanged) return;

    prevCoordsRef.current = coordsKey;
    prevHospitalIdRef.current = hospitalKey;

    if (selectedHospital && selectedHospital.latitude && selectedHospital.longitude) {
      drawRouteToHospital(L, map, selectedHospital, true);
    } else if (routeLayerRef.current) {
      routeLayerRef.current.clearLayers();
      setIsRouting(false);
    }
  }, [selectedHospital, patientCoords?.lat, patientCoords?.lng, drawRouteToHospital]);

  // Handle Escape key to reset selection to recommended
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onResetToRecommendedRef.current?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Custom Controls Handlers
  const handleZoomIn = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomIn();
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomOut();
  };

  const handleRecenter = () => {
    if (mapInstanceRef.current) {
      if (patientCoords && Number.isFinite(patientCoords.lat) && Number.isFinite(patientCoords.lng)) {
        mapInstanceRef.current.flyTo([patientCoords.lat, patientCoords.lng], 14, { duration: 0.8 });
      } else if (selectedHospital) {
        mapInstanceRef.current.flyTo([selectedHospital.latitude, selectedHospital.longitude], 14, { duration: 0.8 });
      } else if (mapCenter) {
        mapInstanceRef.current.flyTo([mapCenter.lat, mapCenter.lng], 12, { duration: 0.8 });
      } else {
        mapInstanceRef.current.flyTo([20.5937, 78.9629], 5, { duration: 0.8 });
      }
    }
  };

  const handleConfirmCenterLocation = () => {
    if (mapInstanceRef.current) {
      const center = mapInstanceRef.current.getCenter();
      onConfirmManualLocation(center.lat, center.lng);
    }
  };

  const directGoogleMapsUrl =
    selectedHospital && patientCoords
      ? `https://www.google.com/maps/dir/?api=1&origin=${patientCoords.lat},${patientCoords.lng}&destination=${selectedHospital.latitude},${selectedHospital.longitude}&travelmode=driving`
      : selectedHospital
      ? `https://www.google.com/maps/search/?api=1&query=${selectedHospital.latitude},${selectedHospital.longitude}`
      : "#";

  return (
    <div className="relative w-full h-[480px] sm:h-[540px] lg:h-[580px] rounded-2xl overflow-hidden bg-slate-100 isolate">
      {/* Leaflet Map Canvas */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* ============================================================ MANUAL POSITIONING MODE OVERLAY */}
      {isManualPicking && (
        <>
          <div className="absolute top-4 left-4 right-4 z-20 mx-auto max-w-lg rounded-2xl bg-slate-950 text-white p-3.5 shadow-2xl border border-slate-800 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400 border border-sky-400/30 shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white leading-tight">Move map to position your location</div>
                <div className="text-[11px] text-slate-400 truncate">Align the center marker over your location</div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={onCancelManualPicking}
                className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmCenterLocation}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-950 text-xs font-semibold transition-all shadow-xs cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Confirm</span>
              </button>
            </div>
          </div>

          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="relative flex flex-col items-center -translate-y-5">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 border-2 border-white shadow-2xl text-sky-400">
                <div className="h-3 w-3 rounded-full bg-sky-400" />
              </div>
              <div className="h-4 w-1 bg-slate-950 rounded-b shadow-sm" />
              <div className="h-2 w-4 rounded-full bg-black/30 blur-[1px] mt-0.5" />
            </div>
          </div>
        </>
      )}

      {/* ============================================================ COMPACT LIVE ROUTE PILL */}
      {/* ============================================================ MODERN NAVIGATION HUD (Apple Maps / Google Maps style) */}
      {!isManualPicking && patientCoords && selectedHospital && (
        <div className="absolute top-3.5 left-3.5 z-10 max-w-[320px] sm:max-w-[340px] rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-lg p-3.5 text-xs text-slate-900 pointer-events-auto transition-all animate-in fade-in duration-200">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Active Route
              </span>
            </div>
            {isRouting ? (
              <span className="text-[10px] font-mono font-medium text-slate-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full border border-slate-700 border-t-transparent animate-spin" />
                Updating...
              </span>
            ) : (
              <span className="text-[10px] font-mono font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                Live
              </span>
            )}
          </div>

          <div className="font-bold text-slate-900 truncate text-sm mt-1.5 leading-snug" title={selectedHospital.name}>
            {selectedHospital.name}
          </div>

          <div className="text-[11px] text-slate-500 truncate mt-0.5">
            {selectedHospital.famousFor || getHospitalFamousFor(selectedHospital)}
          </div>

          <div className="flex items-center justify-between text-xs mt-2.5 pt-2 border-t border-slate-200/90">
            <div className="flex items-center gap-1.5 font-bold text-slate-900">
              <Navigation className="w-3.5 h-3.5 text-slate-900" />
              <span>{routeInfo.distanceKm} km</span>
              <span className="text-slate-300 font-normal">·</span>
              <span className="text-slate-900">~{routeInfo.etaMinutes} min</span>
            </div>
            <div className="flex items-center gap-1.5">
              <a
                href={`tel:${selectedHospital.emergencyPhone || selectedHospital.phone || "108"}`}
                title="Call Emergency"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-rose-600 hover:bg-rose-700 shadow-xs px-2.5 py-1.5 rounded-xl transition-all cursor-pointer"
              >
                <PhoneCall className="w-3 h-3" />
                <span>Call ED</span>
              </a>
              <a
                href={directGoogleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in Google Maps"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-slate-950 hover:bg-slate-900 shadow-xs px-2.5 py-1.5 rounded-xl transition-all cursor-pointer"
              >
                <span>Nav</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ MAP / SATELLITE SWITCHER */}
      <div className="absolute top-3.5 right-3.5 z-10 flex items-center gap-1 p-1 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-2xs pointer-events-auto">
        <button
          type="button"
          onClick={() => switchMapStyle("osm")}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs transition-all cursor-pointer ${
            mapStyle === "osm"
              ? "bg-slate-950 text-white font-semibold shadow-xs"
              : "bg-white hover:bg-slate-50 text-slate-800 border border-slate-200/90 shadow-2xs font-medium"
          }`}
        >
          <Layers className="w-3 h-3" />
          <span>Map</span>
        </button>
        <button
          type="button"
          onClick={() => switchMapStyle("satellite")}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs transition-all cursor-pointer ${
            mapStyle === "satellite"
              ? "bg-slate-950 text-white font-semibold shadow-xs"
              : "bg-white hover:bg-slate-50 text-slate-800 border border-slate-200/90 shadow-2xs font-medium"
          }`}
        >
          <span>Satellite</span>
        </button>
      </div>

      {/* ============================================================ LOCATION REQUIRED OVERLAY */}
      {!isManualPicking && !patientCoords && allHospitals.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4 bg-slate-950/10 backdrop-blur-[2px] pointer-events-none">
          <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-lg p-6 max-w-sm text-center flex flex-col items-center gap-3 pointer-events-auto">
            <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-900">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Find Care Near You</h3>
              <p className="text-xs text-slate-600 mt-1">
                Enable GPS or select a region to view emergency hospitals, live road travel times, and on-duty specialists.
              </p>
            </div>
            {onRequestLocation && (
              <button
                onClick={onRequestLocation}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-950 hover:bg-slate-900 text-white font-semibold text-xs shadow-xs transition-all cursor-pointer"
              >
                <Locate className="w-3.5 h-3.5" />
                <span>Use my live location</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ MAP CONTROLS */}
      <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1.5 pointer-events-auto">
        <div className="flex flex-col rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-2xs overflow-hidden divide-y divide-slate-200/90">
          <button
            onClick={handleZoomIn}
            aria-label="Zoom In"
            className="flex h-8 w-8 items-center justify-center text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomOut}
            aria-label="Zoom Out"
            className="flex h-8 w-8 items-center justify-center text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={handleRecenter}
          aria-label="Recenter on My Location"
          title="Recenter on My Location"
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/90 text-slate-800 hover:bg-slate-50 hover:text-slate-950 shadow-2xs transition-all cursor-pointer"
        >
          <Locate className="w-4 h-4" />
        </button>
      </div>

      {/* ============================================================ MAP LEGEND */}
      <div className="hidden sm:flex absolute bottom-3.5 left-3.5 z-10 items-center gap-2.5 rounded-xl bg-white/95 backdrop-blur-md px-3 py-1.5 text-[10px] font-semibold text-slate-600 border border-slate-200/90 shadow-2xs pointer-events-auto">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-950 border border-white shadow-xs" />
          <span>Your location</span>
        </div>
        <span className="text-slate-200">|</span>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-rose-600" />
          <span>Selected hospital</span>
        </div>
        <span className="text-slate-200">|</span>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-3.5 bg-slate-950 rounded-full" />
          <span>Driving route</span>
        </div>
      </div>
    </div>
  );
}
