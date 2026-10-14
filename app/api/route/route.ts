import { NextResponse } from "next/server";
import { calculateDistanceKm } from "@/lib/hospitals-india-data";

function calculateCalibratedDriveTime(distanceKm: number, rawOsrmSeconds?: number): number {
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

// Generate realistic road highway bezier spline between two coordinates
function generateHighwaySpline(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): [number, number][] {
  const steps = 18;
  const points: [number, number][] = [];
  const midLat = (origin.lat + destination.lat) / 2;
  const midLng = (origin.lng + destination.lng) / 2;
  const dLat = destination.lat - origin.lat;
  const dLng = destination.lng - origin.lng;
  // Natural curve along road corridor
  const perpLat = -dLng * 0.07;
  const perpLng = dLat * 0.07;

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fromLat = parseFloat(searchParams.get("fromLat") || "");
    const fromLng = parseFloat(searchParams.get("fromLng") || "");
    const toLat = parseFloat(searchParams.get("toLat") || "");
    const toLng = parseFloat(searchParams.get("toLng") || "");

    if (isNaN(fromLat) || isNaN(fromLng) || isNaN(toLat) || isNaN(toLng)) {
      return NextResponse.json(
        { error: "Invalid coordinates provided" },
        { status: 400 }
      );
    }

    const aerialDistanceKm = calculateDistanceKm(fromLat, fromLng, toLat, toLng);

    // 1. Try public OSRM driving service with 2.8s strict timeout
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
      const res = await fetch(osrmUrl, {
        headers: { "User-Agent": "MedVoice-Emergency-Routing/1.0" },
        signal: AbortSignal.timeout(2800),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.code === "Ok" && data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const rawMeters = route.distance || 0;
          const rawSeconds = route.duration || 0;
          const roadDistanceKm = parseFloat((rawMeters / 1000).toFixed(1));
          const etaMinutes = calculateCalibratedDriveTime(roadDistanceKm, rawSeconds);

          // Convert OSRM GeoJSON [lng, lat] coordinates to Leaflet [lat, lng] format
          const rawCoords = route.geometry?.coordinates || [];
          if (rawCoords.length > 1) {
            const coordinates: [number, number][] = rawCoords.map((pt: [number, number]) => [pt[1], pt[0]]);
            return NextResponse.json({
              success: true,
              roadDistanceKm: Math.max(0.1, roadDistanceKm),
              etaMinutes: Math.max(2, etaMinutes),
              coordinates,
              source: "osrm_turn_by_turn",
            });
          }
        }
      }
    } catch (osrmErr: any) {
      console.warn("[RouteAPI] OSRM service unavailable or timed out, generating calibrated road spline:", osrmErr.message);
    }

    // 2. High-fidelity calibrated fallback if OSRM is slow or offline
    const fallbackDist = parseFloat((aerialDistanceKm * 1.25).toFixed(1)); // Standard road-to-aerial winding factor
    const fallbackEta = calculateCalibratedDriveTime(fallbackDist);
    const splineCoordinates = generateHighwaySpline(
      { lat: fromLat, lng: fromLng },
      { lat: toLat, lng: toLng }
    );

    return NextResponse.json({
      success: true,
      roadDistanceKm: Math.max(0.1, fallbackDist),
      etaMinutes: Math.max(2, fallbackEta),
      coordinates: splineCoordinates,
      source: "calibrated_spline_fallback",
    });
  } catch (err: any) {
    console.error("[RouteAPI] Unexpected error:", err);
    return NextResponse.json(
      {
        error: "Failed to calculate route",
        details: process.env.NODE_ENV === "production" ? undefined : err?.message,
      },
      { status: 500 }
    );
  }
}
