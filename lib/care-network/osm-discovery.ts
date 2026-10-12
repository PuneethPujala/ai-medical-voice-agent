import { Hospital, calculateDistanceKm, getHospitalFamousFor } from "../hospitals-india-data";
import { isPlaceholderOrGenericHospitalName, isValidHospitalPhoneNumber } from "./evaluator";

interface DiscoveryCacheEntry {
  hospitals: Hospital[];
  timestamp: number;
}

// In-memory cache with 1-hour TTL to prevent redundant network queries
const discoveryCache = new Map<string, DiscoveryCacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Generates a coarse cache key based on ~10km grid resolution (0.1 deg lat/lng)
 */
function getGridKey(lat: number, lng: number): string {
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

/**
 * Multiple reliable Overpass API mirrors
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/**
 * Queries OpenStreetMap Overpass POI API for all medical and hospital facilities
 * within radiusKm of any coordinate worldwide.
 */
async function queryOverpassHospitals(
  lat: number,
  lng: number,
  radiusKm: number = 30
): Promise<Hospital[]> {
  const radiusMeters = Math.min(50000, Math.round(radiusKm * 1000));
  const query = `[out:json][timeout:5];(
    node["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
    way["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
    relation["amenity"="hospital"](around:${radiusMeters},${lat},${lng});
    node["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
    way["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
    relation["healthcare"="hospital"](around:${radiusMeters},${lat},${lng});
    node["amenity"="clinic"](around:${radiusMeters},${lat},${lng});
    way["amenity"="clinic"](around:${radiusMeters},${lat},${lng});
    node["healthcare"="centre"](around:${radiusMeters},${lat},${lng});
    node["healthcare"="clinic"](around:${radiusMeters},${lat},${lng});
  );out center 80;`;

  const body = `data=${encodeURIComponent(query)}`;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "MedVoiceAI/2.0 (healthcare-triage-locator; contact: care@medvoice.ai)",
        },
        body,
        signal: AbortSignal.timeout(2000),
      });

      if (!res.ok) continue;

      const data = await res.json();
      if (!data.elements || !Array.isArray(data.elements) || data.elements.length === 0) {
        continue;
      }

      const discovered: Hospital[] = [];

      for (const el of data.elements) {
        const hLat = el.lat ?? el.center?.lat;
        const hLng = el.lon ?? el.center?.lon;
        if (!hLat || !hLng) continue;

        const dist = calculateDistanceKm(lat, lng, hLat, hLng);
        if (dist > radiusKm * 1.2) continue;

        const tags = el.tags || {};
        const rawName = tags["name:en"] || tags.name || tags.operator || "";
        if (!rawName || isPlaceholderOrGenericHospitalName(rawName)) continue;

        const lowerName = rawName.toLowerCase();

        // Categorize ownership
        const isGovernment =
          tags["operator:type"] === "government" ||
          tags["operator:type"] === "public" ||
          lowerName.includes("government") ||
          lowerName.includes("general hospital") ||
          lowerName.includes("district hospital") ||
          lowerName.includes("area hospital") ||
          lowerName.includes("civil hospital") ||
          lowerName.includes("aiims") ||
          lowerName.includes("ggh") ||
          lowerName.includes("chc") ||
          lowerName.includes("phc") ||
          lowerName.includes("esi");

        const isTertiary =
          lowerName.includes("multispeciality") ||
          lowerName.includes("multi specialty") ||
          lowerName.includes("multi-specialty") ||
          lowerName.includes("super specialty") ||
          lowerName.includes("medical college") ||
          lowerName.includes("institute") ||
          lowerName.includes("aiims") ||
          lowerName.includes("apollo") ||
          lowerName.includes("manipal") ||
          lowerName.includes("fortis") ||
          lowerName.includes("max ") ||
          lowerName.includes("care hospital") ||
          lowerName.includes("aster") ||
          lowerName.includes("kims") ||
          lowerName.includes("narayana") ||
          lowerName.includes("general hospital");

        const osmSpec = (tags["healthcare:speciality"] || tags["speciality"] || "").toLowerCase();

        // Specialty tagging
        const specialties: string[] = ["Emergency & Trauma", "General Medicine"];
        if (isTertiary || osmSpec.includes("cardio") || lowerName.includes("cardio") || lowerName.includes("heart")) specialties.push("Cardiology");
        if (isTertiary || osmSpec.includes("neuro") || lowerName.includes("neuro") || lowerName.includes("brain") || lowerName.includes("spine")) specialties.push("Neurology");
        if (isTertiary || osmSpec.includes("pediatric") || lowerName.includes("child") || lowerName.includes("pediatric") || lowerName.includes("maternity")) specialties.push("Pediatrics");
        if (isTertiary || osmSpec.includes("oncol") || lowerName.includes("cancer") || lowerName.includes("oncol") || lowerName.includes("tumor")) specialties.push("Oncology / Cancer");
        if (osmSpec.includes("ophthal") || lowerName.includes("eye") || lowerName.includes("ophthal") || lowerName.includes("netra")) specialties.push("Ophthalmology");
        if (isTertiary || osmSpec.includes("ortho") || lowerName.includes("ortho") || lowerName.includes("bone") || lowerName.includes("joint")) specialties.push("Orthopedics");
        if (osmSpec.includes("nephro") || lowerName.includes("kidney") || lowerName.includes("nephro") || lowerName.includes("dialysis")) specialties.push("Nephrology / Kidney");
        if (lowerName.includes("ayurved") || tags.healthcare === "alternative" || osmSpec.includes("ayurved")) specialties.push("Ayurveda & Traditional Healing");
        if (lowerName.includes("homeo") || osmSpec.includes("homeo")) specialties.push("Homeopathy");
        if (lowerName.includes("matern") || lowerName.includes("women") || lowerName.includes("gynec") || osmSpec.includes("gynec")) specialties.push("Maternity & Women's Health");
        if (lowerName.includes("lung") || lowerName.includes("pulmo") || lowerName.includes("chest") || osmSpec.includes("pulmo")) specialties.push("Pulmonology");
        if (lowerName.includes("gastro") || lowerName.includes("liver") || osmSpec.includes("gastro")) specialties.push("Gastroenterology");
        if (lowerName.includes("dental") || lowerName.includes("tooth") || osmSpec.includes("dent")) specialties.push("Dental Care");
        if (lowerName.includes("ent") || osmSpec.includes("ent")) specialties.push("ENT (Ear, Nose & Throat)");
        if (lowerName.includes("derma") || lowerName.includes("skin") || osmSpec.includes("derma")) specialties.push("Dermatology");

        const city = tags["addr:city"] || tags["addr:district"] || tags["addr:suburb"] || "Local Healthcare Hub";
        const state = tags["addr:state"] || "";
        const street = tags["addr:street"] || tags["addr:place"] || "";
        const fullAddress = [street, city, state].filter(Boolean).join(", ") || `${rawName}, ${city}`;

        const isEmergency =
          tags.emergency === "yes" ||
          isGovernment ||
          lowerName.includes("emergency") ||
          lowerName.includes("trauma") ||
          lowerName.includes("hospital") ||
          lowerName.includes("multispeciality") ||
          lowerName.includes("super specialty");

        const rawPhone = tags.phone || tags["contact:phone"] || "";
        const phone = isValidHospitalPhoneNumber(rawPhone) ? rawPhone.trim() : (isGovernment ? "108" : "");

        const hospitalObj: Hospital = {
          id: `osm-${el.type}-${el.id}`,
          name: rawName.trim(),
          specialty: specialties,
          city,
          state: state || "India",
          address: fullAddress,
          phone,
          emergencyPhone: isGovernment ? "108" : phone,
          latitude: hLat,
          longitude: hLng,
          isEmergency24x7: isEmergency,
          rating: isGovernment ? 4.3 : 4.4,
          accreditation: tags.accreditation ? [tags.accreditation] : [],
          ownership: isGovernment ? "government" : "private",
          acceptsPublicInsurance: isGovernment,
          affordabilityNotes: isGovernment
            ? "Public healthcare facility; Ayushman Bharat / PM-JAY & State health scheme eligible."
            : "Private facility; standard tariffs apply.",
          source: "OpenStreetMap Global Care Discovery",
          sourceType: "osm_discovery",
          lastVerified: new Date().toISOString().slice(0, 10),
          cancerSpecialistsAvailable: specialties.includes("Oncology / Cancer"),
        };
        hospitalObj.famousFor = getHospitalFamousFor(hospitalObj);

        discovered.push(hospitalObj);
      }

      if (discovered.length > 0) {
        return discovered;
      }
    } catch {
      // Try next mirror
    }
  }

  return [];
}

/**
 * Secondary Fallback: Nominatim bounding box query
 */
async function queryNominatimFallback(
  lat: number,
  lng: number,
  radiusKm: number = 30
): Promise<Hospital[]> {
  const deltaLat = radiusKm / 111;
  const deltaLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

  const minLat = lat - deltaLat;
  const maxLat = lat + deltaLat;
  const minLng = lng - deltaLng;
  const maxLng = lng + deltaLng;

  const viewbox = `${minLng.toFixed(4)},${maxLat.toFixed(4)},${maxLng.toFixed(4)},${minLat.toFixed(4)}`;
  const url = `https://nominatim.openstreetmap.org/search?q=hospital&format=json&bounded=1&viewbox=${viewbox}&limit=35&namedetails=1&extratags=1`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "MedVoiceAI/2.0 (healthcare-triage-locator; contact: dev@medvoice.ai)",
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) return [];

    const items = await res.json();
    if (!Array.isArray(items)) return [];

    const discovered: Hospital[] = [];

    for (const item of items) {
      const hLat = parseFloat(item.lat);
      const hLng = parseFloat(item.lon);
      if (isNaN(hLat) || isNaN(hLng)) continue;

      const dist = calculateDistanceKm(lat, lng, hLat, hLng);
      if (dist > radiusKm * 1.25) continue;

      const rawName = item.namedetails?.name || item.display_name.split(",")[0]?.trim() || "";
      if (!rawName || isPlaceholderOrGenericHospitalName(rawName)) continue;
      const parts = item.display_name.split(",").map((p: string) => p.trim());
      const lowerName = rawName.toLowerCase();

      const isGovernment =
        lowerName.includes("government") ||
        lowerName.includes("general hospital") ||
        lowerName.includes("district hospital") ||
        lowerName.includes("area hospital") ||
        lowerName.includes("civil hospital") ||
        lowerName.includes("aiims") ||
        lowerName.includes("ggh");

      const city = parts[parts.length - 4] || parts[parts.length - 3] || "Local Area";

      const specs: string[] = ["Emergency & Trauma", "General Medicine"];
      if (lowerName.includes("cardio") || lowerName.includes("heart")) specs.push("Cardiology");
      if (lowerName.includes("neuro") || lowerName.includes("brain") || lowerName.includes("stroke")) specs.push("Neurology");
      if (lowerName.includes("cancer") || lowerName.includes("oncol")) specs.push("Oncology / Cancer");
      if (lowerName.includes("child") || lowerName.includes("pediatric")) specs.push("Pediatrics");
      if (lowerName.includes("ortho") || lowerName.includes("bone")) specs.push("Orthopedics");
      if (lowerName.includes("eye") || lowerName.includes("ophthal") || lowerName.includes("netra")) specs.push("Ophthalmology");
      if (lowerName.includes("kidney") || lowerName.includes("nephro") || lowerName.includes("dialysis")) specs.push("Nephrology / Kidney");
      if (lowerName.includes("ayurved")) specs.push("Ayurveda & Traditional Healing");
      if (lowerName.includes("matern") || lowerName.includes("women") || lowerName.includes("gynec")) specs.push("Maternity & Women's Health");
      if (lowerName.includes("lung") || lowerName.includes("pulmo")) specs.push("Pulmonology");
      if (lowerName.includes("dental") || lowerName.includes("tooth")) specs.push("Dental Care");

      const rawPhone = item.extratags?.phone || item.extratags?.["contact:phone"] || "";
      const phone = isValidHospitalPhoneNumber(rawPhone) ? rawPhone.trim() : (isGovernment ? "108" : "");

      const nomHosp: Hospital = {
        id: `nom-${item.osm_id || Math.abs(Math.round(hLat * 10000 + hLng * 10000))}`,
        name: rawName,
        specialty: specs,
        city,
        state: parts[parts.length - 2] || "India",
        address: parts.slice(0, 3).join(", "),
        phone,
        emergencyPhone: isGovernment ? "108" : phone,
        latitude: hLat,
        longitude: hLng,
        isEmergency24x7: true,
        rating: isGovernment ? 4.2 : 4.4,
        accreditation: [],
        ownership: isGovernment ? "government" : "private",
        acceptsPublicInsurance: isGovernment,
        affordabilityNotes: isGovernment
          ? "Government institution; Ayushman Bharat / State health scheme accepted."
          : "Standard hospital rates apply.",
        source: "OpenStreetMap Nominatim Discovery",
        sourceType: "osm_discovery",
        lastVerified: new Date().toISOString().slice(0, 10),
      };
      nomHosp.famousFor = getHospitalFamousFor(nomHosp);

      discovered.push(nomHosp);
    }

    return discovered;
  } catch {
    return [];
  }
}

/**
 * Dynamically discovers real local hospitals from OpenStreetMap
 * around any GPS coordinate worldwide (with in-memory caching).
 */
export async function discoverHospitalsNearCoordinates(
  lat: number,
  lng: number,
  radiusKm: number = 35
): Promise<Hospital[]> {
  const gridKey = getGridKey(lat, lng);
  const cached = discoveryCache.get(gridKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.hospitals;
  }

  // 1. Try Overpass POI API (rich spatial elements with tags)
  let facilities = await queryOverpassHospitals(lat, lng, radiusKm);

  // 2. If Overpass mirror is busy/empty, fallback to Nominatim
  if (facilities.length === 0) {
    facilities = await queryNominatimFallback(lat, lng, radiusKm);
  }

  if (facilities.length > 0) {
    discoveryCache.set(gridKey, { hospitals: facilities, timestamp: Date.now() });
  }

  return facilities;
}
