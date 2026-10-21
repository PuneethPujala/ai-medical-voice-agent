"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Minus, Locate, Check, MapPin, Layers, PhoneCall, Sparkles, Info } from "lucide-react";
import { getHospitalFamousFor, calculateDistanceKm } from "@/lib/hospitals-india-data";
import { clientCareCache, CachedRouteResult } from "@/lib/care-network/care-cache";

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
  sourceType?: string;
}

export interface RouteTelemetryInfo {
  roadDistanceKm: number;
  etaMinutes: number;
  roadGeometryAvailable: boolean;
  source?: string;
  unavailable?: boolean;
  isCalculating?: boolean;
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

/**
 * Clean, restrained basemap tile providers:
 * - Light Canvas: Official Esri World Light Gray Canvas (Base + Reference Labels).
 *   Pristine neutral canvas with muted road hierarchy, crisp locality labels, zero watermarks, and zero API keys.
 * - Satellite: High-resolution Esri World Imagery for terrain and site inspection.
 */
export const TILE_LAYERS = {
  light_canvas: {
    baseUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    labelsUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    options: {
      maxZoom: 16,
      attribution:
        'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, MapmyIndia',
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
  onRouteCalculated?: (info: RouteTelemetryInfo) => void;
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

  // Canonical route reference to synchronize marker labels, popups, and parent state
  const activeRouteStatsRef = useRef<{
    hospitalId: string;
    roadDistanceKm: number;
    etaMinutes: number;
    isVerified: boolean;
    unavailable: boolean;
  } | null>(null);

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

  const prevCoordsRef = useRef<string>("");
  const prevHospitalIdRef = useRef<string>("");

  // Default to light neutral canvas for clean, restrained, high-contrast healthcare presentation
  const [mapStyle, setMapStyle] = useState<"light_canvas" | "satellite">("light_canvas");

  const [routeInfo, setRouteInfo] = useState<RouteTelemetryInfo>({
    roadDistanceKm: selectedHospital?.distanceKm || 1.1,
    etaMinutes: calculateCalibratedDriveTime(selectedHospital?.distanceKm || 1.1),
    roadGeometryAvailable: false,
    unavailable: false,
    isCalculating: false,
  });

  // Switch between clean Light Canvas and ESRI World Satellite
  const switchMapStyle = useCallback((newStyle: "light_canvas" | "satellite") => {
    setMapStyle(newStyle);
    if (!mapInstanceRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const map = mapInstanceRef.current;
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    if (newStyle === "light_canvas") {
      const base = L.tileLayer(TILE_LAYERS.light_canvas.baseUrl, TILE_LAYERS.light_canvas.options);
      const labels = L.tileLayer(TILE_LAYERS.light_canvas.labelsUrl, {
        ...TILE_LAYERS.light_canvas.options,
        zIndex: 400,
      });
      const group = L.layerGroup([base, labels]);
      baseLayerRef.current = group;
      group.addTo(map);
      group.eachLayer((l: any) => l.bringToBack());
    } else {
      const config = TILE_LAYERS.satellite;
      const layer = L.tileLayer(config.url, config.options);
      baseLayerRef.current = layer;
      layer.addTo(map);
      layer.bringToBack();
    }
  }, []);

  /**
   * Origin Marker: Neutral Ink Black with crisp white core
   */
  function createOriginIcon(L: any) {
    return L.divIcon({
      className: "custom-origin-pin",
      html: `
        <div style="position:relative; width:32px; height:32px; display:flex; align-items:center; justify-content:center; pointer-events:auto;">
          <div style="position:absolute; width:30px; height:30px; border-radius:50%; background:rgba(5,7,15,0.12); animation:ping 3s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="position:relative; width:22px; height:22px; border-radius:50%; background:#05070F; border:2.5px solid #FFFFFF; box-shadow:0 2px 8px rgba(5,7,15,0.35); display:flex; align-items:center; justify-content:center;">
            <div style="width:6px; height:6px; border-radius:50%; background:#B7FF72;"></div>
          </div>
          <div style="position:absolute; top:-22px; white-space:nowrap; background:#05070F; color:#FFFFFF; font-family:system-ui,-apple-system,sans-serif; font-size:10px; font-weight:700; padding:2px 7px; border-radius:6px; box-shadow:0 2px 6px rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.15); pointer-events:none;">
            Departure Origin
          </div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }

  /**
   * Destination & Facility Markers:
   * - Selected: Forest Graphite #18251D / Ink Black with Acid Mint #B7FF72 highlight, rank, and canonical distance/ETA label.
   * - Other ranked (1-5): Small, quiet neutral circular badges.
   * - Unranked / >5: Minimal 8px neutral dots with tooltip.
   */
  function createHospitalIcon(
    L: any,
    hosp: HospitalItem,
    isSelected: boolean,
    rank?: number,
    canonicalStats?: { roadDistanceKm: number; etaMinutes: number; unavailable?: boolean } | null
  ) {
    const famousFor = hosp.famousFor || getHospitalFamousFor(hosp);
    const shortName = hosp.name.split("-")[0].split("(")[0].trim();
    const effectiveRank = hosp.rank ?? rank;
    const isTopRanked = typeof effectiveRank === "number" && effectiveRank >= 1 && effectiveRank <= 5;

    if (isSelected) {
      // Use canonical route stats if available, otherwise fallback to hospital base
      const dist = canonicalStats?.roadDistanceKm ?? hosp.distanceKm;
      const eta = canonicalStats?.etaMinutes ?? (hosp.etaMinutes || calculateCalibratedDriveTime(hosp.distanceKm));
      const isUnavailable = canonicalStats?.unavailable;

      return L.divIcon({
        className: "custom-hospital-marker-selected",
        html: `
          <div style="position:relative; width:44px; height:44px; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:1000;">
            <!-- Acid Mint Ambient Pulse Ring -->
            <div style="position:absolute; width:42px; height:42px; border-radius:50%; background:rgba(183,255,114,0.32); animation:pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;"></div>

            <!-- Core Destination Pin: Forest Graphite with Acid Mint Border -->
            <div style="position:relative; width:34px; height:34px; border-radius:11px; background:#18251D; border:2.5px solid #B7FF72; box-shadow:0 4px 14px rgba(5,7,15,0.45); display:flex; align-items:center; justify-content:center; color:#B7FF72; font-weight:800; font-size:13px; font-family:system-ui,-apple-system,sans-serif;">
              ${effectiveRank ? `#${effectiveRank}` : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#B7FF72" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`}
            </div>

            <!-- Persistent Floating Destination Label (Only on Selected Pin) -->
            <div style="position:absolute; bottom:42px; left:50%; transform:translateX(-50%); white-space:nowrap; background:#05070F; color:#FFFFFF; font-family:system-ui,-apple-system,sans-serif; padding:5px 10px; border-radius:10px; box-shadow:0 4px 16px rgba(5,7,15,0.3); z-index:9999; border:1px solid rgba(183,255,114,0.4); pointer-events:none;">
              <div style="font-size:11px; font-weight:700; color:#FFFFFF; display:flex; align-items:center; gap:5px; line-height:1.2;">
                <span>${shortName}</span>
                <span style="color:#B7FF72; font-weight:700; font-family:monospace; font-size:10.5px;">
                  (${dist} km · ~${eta}m)
                </span>
              </div>
              <div style="font-size:9.5px; font-weight:600; font-family:monospace; color:#A7F3D0; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); padding:1px 6px; border-radius:5px; margin-top:2px; line-height:1.2; display:inline-flex; align-items:center;">
                ${isUnavailable ? "Direct Route" : hosp.isEmergency24x7 ? "24/7 Verified ER" : famousFor}
              </div>
            </div>
          </div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      });
    }

    if (isTopRanked) {
      // Quiet numbered markers matching directory list rank
      const isFirst = effectiveRank === 1;
      const borderCol = isFirst ? "#05070F" : "#CBD5E1";
      const bgCol = "#FFFFFF";
      const textCol = isFirst ? "#05070F" : "#334155";

      return L.divIcon({
        className: "custom-hospital-marker-unselected",
        html: `
          <div style="position:relative; width:26px; height:26px; display:flex; align-items:center; justify-content:center; cursor:pointer;">
            <div style="width:24px; height:24px; border-radius:50%; background:${bgCol}; border:2px solid ${borderCol}; box-shadow:0 1px 4px rgba(0,0,0,0.12); display:flex; align-items:center; justify-content:center; color:${textCol}; font-weight:800; font-size:10.5px; font-family:system-ui,-apple-system,sans-serif;">
              ${effectiveRank}
            </div>
          </div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
    }

    // Rank > 5: Small clean neutral dot (8px) to keep basemap quiet and uncluttered
    return L.divIcon({
      className: "custom-hospital-marker-subtle",
      html: `
        <div style="position:relative; width:12px; height:12px; display:flex; align-items:center; justify-content:center; cursor:pointer;">
          <div style="width:8px; height:8px; border-radius:50%; background:#94A3B8; border:1.5px solid #FFFFFF; box-shadow:0 1px 3px rgba(0,0,0,0.2);"></div>
        </div>
      `,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
  }

  /**
   * Popup HTML: Uses identical canonical distance and ETA numbers as the marker and selected card
   */
  function createPopupHtml(
    hosp: HospitalItem,
    origin?: { lat: number; lng: number } | null,
    isSelectedHospital?: boolean,
    canonicalStats?: { roadDistanceKm: number; etaMinutes: number; unavailable?: boolean } | null
  ) {
    const famousFor = hosp.famousFor || getHospitalFamousFor(hosp);
    const googleMapsUrl = origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${hosp.latitude},${hosp.longitude}&travelmode=driving`
      : `https://www.google.com/maps/search/?api=1&query=${hosp.latitude},${hosp.longitude}`;

    let directPhone = "";
    if (hosp.emergencyPhone && hosp.emergencyPhone !== "108" && hosp.emergencyPhone !== "112") {
      directPhone = hosp.emergencyPhone.trim();
    } else if (hosp.phone && hosp.phone !== "108" && hosp.phone !== "112") {
      directPhone = hosp.phone.trim();
    }
    const hasDirectPhone = directPhone.length >= 5;
    const emergencyNum = hasDirectPhone ? directPhone : "108";
    const actionLabel = hasDirectPhone ? "Call Hospital" : "Call 108 Dispatch";

    // Synchronize distance and ETA from canonical source
    const dist = isSelectedHospital && canonicalStats
      ? canonicalStats.roadDistanceKm
      : hosp.distanceKm;
    const eta = isSelectedHospital && canonicalStats
      ? canonicalStats.etaMinutes
      : (hosp.etaMinutes || calculateCalibratedDriveTime(hosp.distanceKm));

    return `
      <div style="font-family:system-ui,-apple-system,sans-serif; padding:12px 14px 10px 14px; line-height:1.4; width:270px; color:#05070F; box-sizing:border-box;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:5px; padding-right:16px;">
          <b style="font-size:13px; font-weight:800; color:#05070F; line-height:1.3; display:block;">
            ${hosp.rank ? `#${hosp.rank} ` : ""}${hosp.name}
          </b>
        </div>

        <div style="display:inline-flex; align-items:center; margin-bottom:8px; background:#F0FDF4; color:#16A34A; border:1px solid #DCFCE7; font-family:monospace; font-size:10px; font-weight:700; padding:2px 8px; border-radius:6px;">
          ${hosp.isEmergency24x7 ? "24/7 Verified Emergency Care" : famousFor}
        </div>

        <!-- Canonical Distance and ETA: Always agrees with selected card and marker -->
        <div style="display:flex; align-items:center; gap:6px; font-size:11.5px; font-weight:600; margin-bottom:6px; color:#05070F;">
          <span style="font-weight:700;">${dist} km by road</span>
          <span style="color:#94A3B8;">•</span>
          <span style="color:#16A34A; font-weight:700;">~${eta} min drive</span>
        </div>

        <div style="color:#64748B; font-size:11px; line-height:1.35; margin-bottom:10px;">${hosp.address}</div>

        ${isSelectedHospital ? `
          <div style="width:100%; text-align:center; background:#F8FAFC; color:#05070F; font-weight:700; font-size:11px; padding:7px 10px; border-radius:10px; border:1px solid #E2E8F0; margin-bottom:8px; display:flex; align-items:center; justify-content:center; gap:5px; box-sizing:border-box;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            Active Selected Destination
          </div>
        ` : `
          <button
            onclick="window.medvoiceSelectHospitalById && window.medvoiceSelectHospitalById('${hosp.id}')"
            style="width:100%; text-align:center; background:#05070F; color:#FFFFFF; font-weight:700; font-size:11px; padding:8px 12px; border-radius:10px; border:none; cursor:pointer; margin-bottom:8px; display:flex; align-items:center; justify-content:center; gap:5px; box-shadow:0 1px 3px rgba(0,0,0,0.1); box-sizing:border-box;"
          >
            Select Facility
          </button>
        `}

        <div style="display:flex; gap:6px;">
          <a
            href="tel:${emergencyNum}"
            style="flex:1; text-align:center; background:#E11D48; color:#FFFFFF; font-weight:700; font-size:10.5px; padding:7px 8px; border-radius:10px; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:4px; box-sizing:border-box;"
          >
            ${actionLabel}
          </a>
          <a
            href="${googleMapsUrl}"
            target="_blank"
            rel="noopener noreferrer"
            style="flex:1; text-align:center; background:#FFFFFF; color:#1E293B; font-weight:600; font-size:10.5px; padding:7px 8px; border-radius:10px; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:4px; border:1px solid #E2E8F0; box-sizing:border-box;"
          >
            Directions ↗
          </a>
        </div>
      </div>
    `;
  }

  /**
   * Draw road route from origin to destination:
   * Uses clientCareCache for instant deduplicated queries, draws a clean luminous corridor,
   * updates the canonical route reference, and propagates identical numbers to all components.
   */
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
        return;
      }

      const currentId = ++routingRequestIdRef.current;

      // Abort in-flight network request if active
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
        activeAbortControllerRef.current = null;
      }

      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      routeLayerRef.current.clearLayers();

      const origin = { lat: patientCoords.lat, lng: patientCoords.lng };
      const destination = { lat: targetHospital.latitude, lng: targetHospital.longitude };

      // Set initial state matching targetHospital until live route resolves
      const initialDist = targetHospital.distanceKm;
      const initialEta = targetHospital.etaMinutes || calculateCalibratedDriveTime(initialDist);

      setRouteInfo({
        roadDistanceKm: initialDist,
        etaMinutes: initialEta,
        roadGeometryAvailable: false,
        isCalculating: true,
        unavailable: false,
      });

      try {
        // Fetch or read from deduplicated client cache
        const { route } = await clientCareCache.fetchRouteWithDeduplication(
          origin.lat,
          origin.lng,
          destination.lat,
          destination.lng,
          async (sig) => {
            const url = `/api/route?fromLat=${origin.lat}&fromLng=${origin.lng}&toLat=${destination.lat}&toLng=${destination.lng}`;
            const res = await fetch(url, { signal: sig });
            if (!res.ok) {
              throw new Error(`Route API returned ${res.status}`);
            }
            const data = await res.json();
            if (!data.success || !Array.isArray(data.coordinates) || data.coordinates.length < 2) {
              throw new Error("Invalid route geometry returned");
            }
            return {
              roadDistanceKm: data.roadDistanceKm,
              etaMinutes: data.etaMinutes,
              coordinates: data.coordinates,
              source: data.source || "osrm_turn_by_turn",
              success: true,
            };
          },
          abortController.signal
        );

        // Guard against race conditions: only apply if this request is still the active one
        if (routingRequestIdRef.current === currentId && route.success) {
          const roadPoints: [number, number][] = route.coordinates;
          const canonicalDist = route.roadDistanceKm;
          const canonicalEta = route.etaMinutes;

          activeRouteStatsRef.current = {
            hospitalId: targetHospital.id,
            roadDistanceKm: canonicalDist,
            etaMinutes: canonicalEta,
            isVerified: route.source === "osrm_turn_by_turn",
            unavailable: false,
          };

          // Draw clean, elegant route corridor (Subtle cyan glow, dark casing, bright mint/cyan core)
          routeLayerRef.current.clearLayers();

          const roadGlow = L.polyline(roadPoints, {
            color: "#0EA5E9",
            weight: 8,
            opacity: 0.18,
            lineCap: "round",
            lineJoin: "round",
          });

          const roadCasing = L.polyline(roadPoints, {
            color: "#05070F",
            weight: 4.5,
            opacity: 0.88,
            lineCap: "round",
            lineJoin: "round",
          });

          const roadCore = L.polyline(roadPoints, {
            color: "#38BDF8",
            weight: 2.8,
            opacity: 1,
            lineCap: "round",
            lineJoin: "round",
          });

          routeLayerRef.current.addLayer(roadGlow);
          routeLayerRef.current.addLayer(roadCasing);
          routeLayerRef.current.addLayer(roadCore);

          // Smoothly frame the map camera to encompass origin and destination
          if (autoFrame && roadPoints.length > 1) {
            if (map.invalidateSize) map.invalidateSize();
            const roadBounds = L.latLngBounds(roadPoints);
            if (roadBounds.isValid()) {
              map.fitBounds(roadBounds, {
                paddingTopLeft: [40, 40],
                paddingBottomRight: [40, 40],
                maxZoom: 15,
                animate: true,
              });
            }
          }

          setRouteInfo({
            roadDistanceKm: canonicalDist,
            etaMinutes: canonicalEta,
            roadGeometryAvailable: true,
            source: route.source,
            unavailable: false,
            isCalculating: false,
          });

          // Propagate canonical stats to parent component
          if (onRouteCalculated) {
            onRouteCalculated({
              roadDistanceKm: canonicalDist,
              etaMinutes: canonicalEta,
              roadGeometryAvailable: true,
              source: route.source,
              unavailable: false,
              isCalculating: false,
            });
          }

          // Update marker popup and label with canonical stats
          const markerObj = hospitalMarkersMapRef.current.get(targetHospital.id);
          if (markerObj) {
            markerObj.marker.setIcon(createHospitalIcon(L, targetHospital, true, targetHospital.rank, activeRouteStatsRef.current));
            markerObj.marker.setPopupContent(createPopupHtml(targetHospital, origin, true, activeRouteStatsRef.current));
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.warn("[InteractiveRouteMap] Road route unavailable:", err.message);
          if (routingRequestIdRef.current === currentId) {
            activeRouteStatsRef.current = {
              hospitalId: targetHospital.id,
              roadDistanceKm: initialDist,
              etaMinutes: initialEta,
              isVerified: false,
              unavailable: true,
            };

            setRouteInfo({
              roadDistanceKm: initialDist,
              etaMinutes: initialEta,
              roadGeometryAvailable: false,
              unavailable: true,
              isCalculating: false,
            });

            if (onRouteCalculated) {
              onRouteCalculated({
                roadDistanceKm: initialDist,
                etaMinutes: initialEta,
                roadGeometryAvailable: false,
                unavailable: true,
                isCalculating: false,
              });
            }
          }
        }
      } finally {
        if (routingRequestIdRef.current === currentId) {
          activeAbortControllerRef.current = null;
        }
      }
    },
    [patientCoords?.lat, patientCoords?.lng, onRouteCalculated]
  );

  /**
   * Render User Location and Hospital Destination Markers
   */
  const renderMarkers = useCallback(
    (L: any, map: any) => {
      if (!map || !markersLayerRef.current || !L) return;

      markersLayerRef.current.clearLayers();
      hospitalMarkersMapRef.current.clear();

      if (isManualPicking) return;

      // 1. Origin Marker
      if (patientCoords && Number.isFinite(patientCoords.lat) && Number.isFinite(patientCoords.lng)) {
        const originMarker = L.marker([patientCoords.lat, patientCoords.lng], {
          icon: createOriginIcon(L),
          zIndexOffset: 1200,
        });
        originMarker.bindPopup(`
          <div style="font-family:system-ui,-apple-system,sans-serif; padding:6px 8px; line-height:1.4;">
            <b style="color:#05070F; font-size:12px; display:inline-flex; align-items:center; gap:5px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16A34A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>
              Departure Origin
            </b><br/>
            <span style="color:#64748B; font-size:11px;">${patientLocationName || "Current Geographic Position"}</span>
          </div>
        `);
        markersLayerRef.current.addLayer(originMarker);
      }

      // Helper for popup action
      (window as any).medvoiceSelectHospitalById = (hospId: string) => {
        const found = allHospitals.find((h) => h.id === hospId);
        if (found) onSelectHospital(found);
      };

      // 2. Hospital Markers
      allHospitals.forEach((hosp, idx) => {
        if (!hosp.latitude || !hosp.longitude) return;

        const isSelected = selectedHospital?.id === hosp.id;
        const effectiveRank = hosp.rank ?? (idx + 1);
        const icon = createHospitalIcon(L, hosp, isSelected, effectiveRank, isSelected ? activeRouteStatsRef.current : null);

        const marker = L.marker([hosp.latitude, hosp.longitude], {
          icon,
          zIndexOffset: isSelected ? 1500 : hosp.isEligible ? 300 : 100,
        });

        // Hover tooltip for non-selected hospitals (prevents persistent visual clutter)
        const famousFor = hosp.famousFor || getHospitalFamousFor(hosp);
        marker.bindTooltip(
          `
          <div style="font-family:system-ui,-apple-system,sans-serif; padding:4px 6px; line-height:1.35; max-width:220px;">
            <b style="color:#05070F; font-size:11px; display:block;">#${effectiveRank} ${hosp.name}</b>
            <span style="color:#16A34A; font-size:9.5px; font-weight:700;">${famousFor}</span><br/>
            <span style="color:#64748B; font-size:9.5px;">${hosp.distanceKm} km · Click to select</span>
          </div>
        `,
          { direction: "top", offset: [0, -14], opacity: 0.95 }
        );

        // Click popup
        marker.bindPopup(
          createPopupHtml(hosp, patientCoords, isSelected, isSelected ? activeRouteStatsRef.current : null),
          {
            autoPan: true,
            autoPanPaddingTopLeft: [30, 140],
            autoPanPaddingBottomRight: [30, 30],
            className: "custom-leaflet-popup",
          }
        );

        marker.on("click", (e: any) => {
          if (L.DomEvent) L.DomEvent.stopPropagation(e);
          onSelectHospital(hosp);
          marker.openPopup();
        });

        hospitalMarkersMapRef.current.set(hosp.id, { marker, hosp });
        markersLayerRef.current.addLayer(marker);
      });
    },
    [patientCoords?.lat, patientCoords?.lng, patientLocationName, isManualPicking, allHospitals, onSelectHospital, selectedHospital?.id]
  );

  // Initialize Map
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

      // Pristine light neutral basemap default (Esri World Light Gray Canvas)
      if (mapStyle === "light_canvas") {
        const base = L.tileLayer(TILE_LAYERS.light_canvas.baseUrl, TILE_LAYERS.light_canvas.options);
        const labels = L.tileLayer(TILE_LAYERS.light_canvas.labelsUrl, {
          ...TILE_LAYERS.light_canvas.options,
          zIndex: 400,
        });
        const group = L.layerGroup([base, labels]);
        baseLayerRef.current = group;
        group.addTo(map);
        group.eachLayer((l: any) => l.bringToBack());
      } else {
        const config = TILE_LAYERS.satellite;
        const layer = L.tileLayer(config.url, config.options);
        baseLayerRef.current = layer;
        layer.addTo(map);
        layer.bringToBack();
      }

      map.on("click", (e: any) => {
        if (isManualPicking) return;
        const clickPoint = e.layerPoint;
        let closestHosp: HospitalItem | null = null;
        let minDistancePx = 30;

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
        }
      });

      mapInstanceRef.current = map;
      markersLayerRef.current = L.layerGroup().addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);

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

  // Update Markers when allHospitals or patientCoords changes
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current) return;
    renderMarkers(leafletRef.current, mapInstanceRef.current);
  }, [renderMarkers]);

  // Synchronize selection changes with route and markers
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current) return;
    const L = leafletRef.current;
    const map = mapInstanceRef.current;

    // 1. Update marker visual highlights and popups
    hospitalMarkersMapRef.current.forEach(({ marker, hosp }) => {
      const isSelected = selectedHospital?.id === hosp.id;
      marker.setIcon(createHospitalIcon(L, hosp, isSelected, hosp.rank, isSelected ? activeRouteStatsRef.current : null));
      marker.setZIndexOffset(isSelected ? 1500 : hosp.isEligible ? 300 : 100);
      marker.setPopupContent(createPopupHtml(hosp, patientCoords, isSelected, isSelected ? activeRouteStatsRef.current : null));
    });

    // 2. Draw route
    if (!patientCoords || !Number.isFinite(patientCoords.lat) || !Number.isFinite(patientCoords.lng)) {
      if (routeLayerRef.current) {
        routeLayerRef.current.clearLayers();
      }
      prevCoordsRef.current = "";
      return;
    }

    const coordsKey = `${patientCoords.lat},${patientCoords.lng}`;
    const hospitalKey = selectedHospital?.id || "";
    const hasChanged = prevCoordsRef.current !== coordsKey || prevHospitalIdRef.current !== hospitalKey;

    if (!hasChanged) return;

    prevCoordsRef.current = coordsKey;
    prevHospitalIdRef.current = hospitalKey;

    if (selectedHospital && selectedHospital.latitude && selectedHospital.longitude) {
      drawRouteToHospital(L, map, selectedHospital, true);
    } else if (routeLayerRef.current) {
      routeLayerRef.current.clearLayers();
    }
  }, [selectedHospital, patientCoords?.lat, patientCoords?.lng, drawRouteToHospital]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onResetToRecommendedRef.current?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Map Controls
  const handleZoomIn = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomIn();
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomOut();
  };

  const handleRecenter = () => {
    if (mapInstanceRef.current) {
      if (patientCoords && Number.isFinite(patientCoords.lat) && Number.isFinite(patientCoords.lng)) {
        mapInstanceRef.current.flyTo([patientCoords.lat, patientCoords.lng], 14, { duration: 0.6 });
      } else if (selectedHospital) {
        mapInstanceRef.current.flyTo([selectedHospital.latitude, selectedHospital.longitude], 14, { duration: 0.6 });
      } else if (mapCenter) {
        mapInstanceRef.current.flyTo([mapCenter.lat, mapCenter.lng], 12, { duration: 0.6 });
      } else {
        mapInstanceRef.current.flyTo([20.5937, 78.9629], 5, { duration: 0.6 });
      }
    }
  };

  const handleConfirmCenterLocation = () => {
    if (mapInstanceRef.current) {
      const center = mapInstanceRef.current.getCenter();
      onConfirmManualLocation(center.lat, center.lng);
    }
  };

  return (
    <div className="relative w-full h-full min-h-[500px] flex-1 rounded-3xl overflow-hidden bg-[#FAF9F6] isolate">
      {/* Leaflet Map Canvas */}
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* ============================================================ MANUAL PIN LOCATION OVERLAY */}
      {isManualPicking && (
        <>
          <div className="absolute top-4 left-4 right-4 z-20 mx-auto max-w-lg rounded-2xl bg-[#05070F] text-white p-3.5 shadow-2xl border border-slate-800 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#B7FF72]/20 text-[#B7FF72] border border-[#B7FF72]/30 shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white leading-tight">Position Departure Location</div>
                <div className="text-[11px] text-slate-400 truncate">Move map to align center marker over origin</div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onCancelManualPicking}
                className="px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCenterLocation}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#B7FF72] hover:bg-[#a3f055] text-[#05070F] text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Confirm</span>
              </button>
            </div>
          </div>

          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="relative flex flex-col items-center -translate-y-5">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[#05070F] border-2 border-white shadow-2xl text-[#B7FF72]">
                <div className="h-3 w-3 rounded-full bg-[#B7FF72]" />
              </div>
              <div className="h-4 w-1 bg-[#05070F] rounded-b shadow-sm" />
              <div className="h-2 w-4 rounded-full bg-black/30 blur-[1px] mt-0.5" />
            </div>
          </div>
        </>
      )}

      {/* ============================================================ MAP / SATELLITE SWITCHER */}
      <div className="absolute top-3.5 right-3.5 z-10 flex items-center gap-1 p-1 rounded-2xl bg-white/95 backdrop-blur-md border border-[#E5E7EB] shadow-2xs pointer-events-auto">
        <button
          type="button"
          onClick={() => switchMapStyle("light_canvas")}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs transition-all cursor-pointer ${
            mapStyle === "light_canvas"
              ? "bg-[#05070F] text-white font-bold shadow-xs"
              : "bg-white hover:bg-slate-50 text-[#334155] font-semibold"
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
              ? "bg-[#05070F] text-white font-bold shadow-xs"
              : "bg-white hover:bg-slate-50 text-[#334155] font-semibold"
          }`}
        >
          <span>Satellite</span>
        </button>
      </div>

      {/* ============================================================ MAP CONTROLS */}
      <div className="absolute bottom-3.5 right-3.5 z-10 flex flex-col gap-1.5 pointer-events-auto">
        <div className="flex flex-col rounded-xl bg-white/95 backdrop-blur-md border border-[#E5E7EB] shadow-2xs overflow-hidden divide-y divide-[#E5E7EB]">
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label="Zoom In"
            className="flex h-8 w-8 items-center justify-center text-[#334155] hover:bg-slate-50 hover:text-[#05070F] transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            aria-label="Zoom Out"
            className="flex h-8 w-8 items-center justify-center text-[#334155] hover:bg-slate-50 hover:text-[#05070F] transition-colors cursor-pointer"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={handleRecenter}
          aria-label="Recenter on Destination"
          title="Recenter on Destination"
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/95 backdrop-blur-md border border-[#E5E7EB] text-[#334155] hover:bg-slate-50 hover:text-[#05070F] shadow-2xs transition-all cursor-pointer"
        >
          <Locate className="w-4 h-4" />
        </button>
      </div>

      {/* ============================================================ UNIFIED COMPACT LEGEND */}
      <div className="hidden sm:flex absolute bottom-3.5 left-3.5 z-10 items-center gap-2.5 rounded-xl bg-white/95 backdrop-blur-md px-3 py-1.5 text-[10px] font-semibold text-[#475569] border border-[#E5E7EB] shadow-2xs pointer-events-auto">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#05070F] border border-[#B7FF72]" />
          <span>Origin</span>
        </div>
        <span className="text-slate-300">·</span>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[#18251D] border border-[#B7FF72]" />
          <span>Selected Destination</span>
        </div>
        <span className="text-slate-300">·</span>
        <div
          className="flex items-center gap-1.5 cursor-help"
          title="Calibrated road travel times based on turn-by-turn road networks."
        >
          <span className="h-1 w-3.5 bg-[#38BDF8] rounded-full" />
          <span>Driving Route</span>
          <Info className="w-3 h-3 text-slate-400" />
        </div>
      </div>
    </div>
  );
}
