import { NextResponse } from "next/server";
import { INDIAN_HOSPITALS_DATASET, ALL_REGION_PRESETS, calculateDistanceKm, Hospital, getHospitalFamousFor } from "@/lib/hospitals-india-data";
import { discoverHospitalsNearCoordinates } from "@/lib/care-network/osm-discovery";
import { deduplicateAndMergeHospitals, isPlaceholderOrGenericHospitalName } from "@/lib/care-network/evaluator";

function calculateRealisticDriveTime(distanceKm: number): number {
  if (distanceKm <= 4) {
    // Dense city traffic: ~18 km/h + signal buffer
    return Math.max(4, Math.round((distanceKm / 18) * 60));
  } else if (distanceKm <= 12) {
    // Mixed urban/arterial: ~25 km/h
    return Math.max(6, Math.round((distanceKm / 25) * 60));
  } else if (distanceKm <= 50) {
    // Suburban / ring road: ~45 km/h
    return Math.max(10, Math.round(13 + ((distanceKm - 4) / 45) * 60));
  } else {
    // Inter-city National Highway: ~65 km/h
    return Math.max(25, Math.round(30 + ((distanceKm - 15) / 65) * 60));
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawLat = searchParams.get("lat");
    const rawLng = searchParams.get("lng");
    const userLat = rawLat !== null ? parseFloat(rawLat) : null;
    const userLng = rawLng !== null ? parseFloat(rawLng) : null;

    // Patient departure coordinates (where user is physically located)
    const patientLatParam = searchParams.get("patientLat") ? parseFloat(searchParams.get("patientLat")!) : null;
    const patientLngParam = searchParams.get("patientLng") ? parseFloat(searchParams.get("patientLng")!) : null;

    const searchFilter = searchParams.get("query")?.toLowerCase().trim() || "";
    const cityFilter = searchParams.get("city")?.toLowerCase().trim() || "";

    const latProvided = rawLat !== null && rawLat.trim() !== "";
    const lngProvided = rawLng !== null && rawLng.trim() !== "";
    const hasCitySearch = Boolean(cityFilter || searchFilter);

    // Validate coordinates if provided
    if (latProvided || lngProvided) {
      if (
        userLat === null ||
        userLng === null ||
        !Number.isFinite(userLat) ||
        !Number.isFinite(userLng) ||
        userLat < -90 ||
        userLat > 90 ||
        userLng < -180 ||
        userLng > 180
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid coordinates provided: latitude must be between -90 and 90, longitude between -180 and 180.",
            hospitals: [],
          },
          { status: 400 }
        );
      }
    }

    // Require either explicit coordinates or explicit city search
    if (!latProvided && !lngProvided && !hasCitySearch) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required location: valid latitude and longitude coordinates or explicit city parameter are required.",
          hospitals: [],
        },
        { status: 400 }
      );
    }

    // Determine reference coordinates (search center)
    let refLat = userLat ?? 0;
    let refLng = userLng ?? 0;
    let locationContext: { type: string; label: string } = {
      type: latProvided ? "coordinates" : "default",
      label: latProvided ? `GPS (${refLat.toFixed(4)}°, ${refLng.toFixed(4)}°)` : "No location",
    };

    // City/Query text search → resolve to coordinates
    if (hasCitySearch) {
      const q = (cityFilter || searchFilter).toLowerCase().trim();

      const matchedPreset = ALL_REGION_PRESETS.find(
        (p) => p.name.toLowerCase() === q || p.label.toLowerCase().includes(q)
      );

      const matchedCity = matchedPreset ||
        INDIAN_HOSPITALS_DATASET.find(
          (h) => h.city.toLowerCase() === q || h.address.toLowerCase().includes(q)
        );

      if (matchedCity) {
        if ("lat" in matchedCity) {
          refLat = matchedCity.lat;
          refLng = matchedCity.lng;
          locationContext = {
            type: "city",
            label: `City Center (${matchedCity.name})`,
          };
        } else {
          refLat = (matchedCity as Hospital).latitude;
          refLng = (matchedCity as Hospital).longitude;
          locationContext = {
            type: "city",
            label: `City Center (${(matchedCity as Hospital).city})`,
          };
        }
      } else {
        return NextResponse.json(
          {
            success: false,
            error: `Unknown city or region '${cityFilter || searchFilter}'. Please provide valid coordinates or an accredited city name.`,
            hospitals: [],
          },
          { status: 400 }
        );
      }
    }

    // True origin coords for calculating distance & driving time from where the patient is
    const hasPatientOrigin =
      patientLatParam !== null &&
      Number.isFinite(patientLatParam) &&
      patientLngParam !== null &&
      Number.isFinite(patientLngParam);
    const originLat = hasPatientOrigin ? patientLatParam! : refLat;
    const originLng = hasPatientOrigin ? patientLngParam! : refLng;

    // DYNAMIC POI DISCOVERY: Discover real local hospitals around any coordinate worldwide
    let localCandidates: Hospital[] = [];
    if (Number.isFinite(refLat) && Number.isFinite(refLng)) {
      try {
        const liveDiscovered = await discoverHospitalsNearCoordinates(refLat, refLng, 40);
        if (liveDiscovered && liveDiscovered.length > 0) {
          localCandidates = liveDiscovered;
        }
      } catch (err: any) {
        console.warn("[HospitalsAPI] Dynamic OSM discovery failed, using registry:", err.message);
      }
    }

    // Blend with any verified offline registry hospitals that are within reach (<= 65km)
    const nearbyRegistry = INDIAN_HOSPITALS_DATASET.filter((h) => {
      const d = calculateDistanceKm(refLat, refLng, h.latitude, h.longitude);
      return d <= 65;
    });

    // Combine local discovered + nearby registry (raw, pre-dedup)
    let hospitals = [...localCandidates, ...nearbyRegistry];

    // Fallback: If no facilities found within 65km (e.g. rural area or rate limit), use closest regional hubs
    if (hospitals.length === 0) {
      const sortedByProximity = [...INDIAN_HOSPITALS_DATASET].sort((a, b) => {
        const da = calculateDistanceKm(refLat, refLng, a.latitude, a.longitude);
        const db = calculateDistanceKm(refLat, refLng, b.latitude, b.longitude);
        return da - db;
      });
      hospitals = sortedByProximity.slice(0, 10);
    }

    // ─── DEDUPLICATION: Multi-signal merge (canonical name + 350m geo proximity) ───
    hospitals = deduplicateAndMergeHospitals(hospitals.filter((h) => !isPlaceholderOrGenericHospitalName(h.name)));

    // ─── ENRICH: Add distance, ETA, and famousFor to every hospital ───
    // NOTE: NO specialty filtering here. The full enriched dataset is returned.
    //       Client-side useMemo handles specialty evaluation & ranking instantly.
    const enrichedHospitals = hospitals.map((h) => {
      const dist = calculateDistanceKm(originLat, originLng, h.latitude, h.longitude);
      const etaMinutes = calculateRealisticDriveTime(dist);
      const famousFor = (h as any).famousFor || getHospitalFamousFor(h);

      return {
        id: h.id,
        name: h.name,
        specialty: h.specialty,
        famousFor,
        city: h.city,
        state: h.state,
        address: h.address,
        phone: h.phone,
        emergencyPhone: h.emergencyPhone,
        latitude: h.latitude,
        longitude: h.longitude,
        ownership: h.ownership || "private",
        affordabilityNotes: h.affordabilityNotes,
        acceptsPublicInsurance: h.acceptsPublicInsurance,
        isEmergency24x7: h.isEmergency24x7,
        rating: h.rating,
        accreditation: h.accreditation,
        cancerSpecialistsAvailable: h.cancerSpecialistsAvailable,
        sourceType: h.sourceType,
        distanceKm: parseFloat(dist.toFixed(1)),
        etaMinutes,
        hasDistanceContext: true,
        distanceSource: locationContext.type,
        // Placeholder fields — client fills these via evaluateAndRankForSpecialty()
        isEligible: true,
        rank: 0,
        matchTier: h.sourceType === "official_registry" ? ("verified" as const) : ("inferred" as const),
        matchedCategory: "General Care",
        isFallback: false,
        actionType: (h.isEmergency24x7 ? "call_ed" : "call_hospital") as "call_ed" | "call_hospital",
        matchLabel: "FACILITY DIRECTORY",
        matchReasons: [] as string[],
        googleMapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${encodeURIComponent(
          `${h.name}, ${h.address}`
        )}`,
      };
    });

    // Sort by distance as the default ordering
    enrichedHospitals.sort((a, b) => a.distanceKm - b.distanceKm);

    // Assign sequential ranks (default distance-based)
    enrichedHospitals.forEach((h, idx) => {
      h.rank = idx + 1;
    });

    return NextResponse.json({
      status: "success",
      count: enrichedHospitals.length,
      // No specialty evaluation server-side; client does this locally
      categoryFallback: false,
      fallbackBanner: null,
      categoryClass: "emergency",
      categoryLabel: "All Hospitals & 24/7 ERs",
      locationContext,
      userLocationDetected: latProvided && lngProvided,
      userCoordinates: { lat: refLat, lng: refLng },
      hospitals: enrichedHospitals,
    });
  } catch (error: any) {
    console.error("[HospitalsRouteError]", error);
    return NextResponse.json(
      {
        status: "error",
        message: process.env.NODE_ENV === "production" ? "Failed to retrieve healthcare facilities directory" : (error?.message || "Failed to fetch hospital care routing data"),
      },
      { status: 500 }
    );
  }
}
