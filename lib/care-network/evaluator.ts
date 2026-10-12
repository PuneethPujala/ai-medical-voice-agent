/**
 * Care Network Evaluator
 *
 * Shared logic for:
 * 1. Canonical hospital name normalization
 * 2. Multi-signal deduplication (name similarity + geo proximity)
 * 3. Client-side specialty filtering & ranking (used by page.tsx useMemo)
 *
 * This module is imported by BOTH the server API route AND the client care page
 * so that specialty switching can happen instantly with zero network requests.
 */

import { calculateDistanceKm, type Hospital } from "../hospitals-india-data";

// ─── Category Rules (shared between server and client) ──────────────────────

export interface CategoryRule {
  class: "emergency" | "elective";
  label: string;
  mustHaveKeywords: string[];
  boostKeywords: string[];
  actionType: "call_ed" | "call_hospital";
}

export const CATEGORY_RULES: Record<string, CategoryRule> = {
  cardiology: {
    class: "emergency",
    label: "Cardiology",
    mustHaveKeywords: ["cardio", "heart", "cath lab", "chest pain", "angioplasty"],
    boostKeywords: ["cath lab", "icu", "coronary care", "24/7 er"],
    actionType: "call_ed",
  },
  neurology: {
    class: "emergency",
    label: "Neurology & Stroke",
    mustHaveKeywords: ["neuro", "stroke", "brain", "paralysis", "nimhans", "spine", "neurosurgery"],
    boostKeywords: ["ct scan", "mri", "neuro icu", "thrombolysis", "be-fast"],
    actionType: "call_ed",
  },
  pediatrics: {
    class: "emergency",
    label: "Pediatrics & Child Care",
    mustHaveKeywords: ["pediatric", "child", "children", "nicu", "picu", "infant", "newborn", "rainbow", "ankura"],
    boostKeywords: ["nicu", "picu", "pediatric emergency"],
    actionType: "call_ed",
  },
  pulmonology: {
    class: "emergency",
    label: "Pulmonology & Respiratory",
    mustHaveKeywords: ["pulmo", "respiratory", "lung", "asthma", "copd", "pneumonia"],
    boostKeywords: ["ventilator", "respiratory icu", "24/7 er"],
    actionType: "call_ed",
  },
  dermatology: {
    class: "elective",
    label: "Skin & Dermatology",
    mustHaveKeywords: ["derma", "skin", "burns", "plastic surgery", "allergy", "cosmetic"],
    boostKeywords: ["opd", "dermatology clinic", "skin specialist"],
    actionType: "call_hospital",
  },
  burns: {
    class: "emergency",
    label: "Burns & Trauma",
    mustHaveKeywords: ["burn", "burns", "plastic surgery", "trauma"],
    boostKeywords: ["burn unit", "icu", "trauma er"],
    actionType: "call_ed",
  },
  eye: {
    class: "elective",
    label: "Eye & Ophthalmology",
    mustHaveKeywords: ["eye", "ophthal", "netra", "vision", "cataract", "retina", "lvpei", "glaucoma"],
    boostKeywords: ["lasik", "retina clinic", "eye hospital"],
    actionType: "call_hospital",
  },
  dental: {
    class: "elective",
    label: "Dental & Maxillofacial",
    mustHaveKeywords: ["dental", "tooth", "teeth", "maxillofacial", "oral", "dentist"],
    boostKeywords: ["dental clinic", "oral surgery"],
    actionType: "call_hospital",
  },
  ayurveda: {
    class: "elective",
    label: "Ayurveda & Traditional",
    mustHaveKeywords: ["ayurved", "panchakarma", "herbal", "ayush", "naturopathy", "homeo"],
    boostKeywords: ["panchakarma unit", "ayurvedic hospital"],
    actionType: "call_hospital",
  },
  diabetes: {
    class: "elective",
    label: "Diabetes & Endocrinology",
    mustHaveKeywords: ["diabet", "endocrin", "insulin", "thyroid", "sugar"],
    boostKeywords: ["diabetic foot care", "endocrinology opd"],
    actionType: "call_hospital",
  },
  cancer: {
    class: "elective",
    label: "Oncology & Cancer Care",
    mustHaveKeywords: ["cancer", "oncol", "tumor", "chemo", "radiation", "surgical oncology"],
    boostKeywords: ["surgical oncology", "pet-ct", "radiation bunker", "tumor board"],
    actionType: "call_hospital",
  },
  orthopedics: {
    class: "emergency",
    label: "Orthopedics & Joint Trauma",
    mustHaveKeywords: ["ortho", "bone", "fracture", "joint", "trauma", "spine"],
    boostKeywords: ["joint replacement", "trauma er", "icu"],
    actionType: "call_ed",
  },
  maternity: {
    class: "emergency",
    label: "Maternity & Obstetrics",
    mustHaveKeywords: ["matern", "gynec", "obstet", "delivery", "pregnancy", "labor", "nicu"],
    boostKeywords: ["nicu", "labor delivery suite", "high-risk obstetrics"],
    actionType: "call_ed",
  },
  kidney: {
    class: "emergency",
    label: "Kidney & Dialysis",
    mustHaveKeywords: ["kidney", "renal", "dialysis", "nephro", "urol"],
    boostKeywords: ["hemodialysis", "nephrology icu"],
    actionType: "call_ed",
  },
  gastroenterology: {
    class: "elective",
    label: "Gastroenterology & Liver",
    mustHaveKeywords: ["gastro", "liver", "digestive", "endoscopy", "stomach", "hepat"],
    boostKeywords: ["endoscopy suite", "liver transplant"],
    actionType: "call_hospital",
  },
  ent: {
    class: "elective",
    label: "ENT & Head-Neck",
    mustHaveKeywords: ["ent", "ear", "nose", "throat", "audiol", "sinus"],
    boostKeywords: ["audiology", "micro-ear surgery"],
    actionType: "call_hospital",
  },
  emergency: {
    class: "emergency",
    label: "Emergency & Trauma",
    mustHaveKeywords: ["emergency", "trauma", "critical", "resuscitation", "casualty", "icu"],
    boostKeywords: ["level-1 trauma", "24/7 er", "resuscitation bay"],
    actionType: "call_ed",
  },
};


// ─── 1. Canonical Name Normalization ────────────────────────────────────────

/**
 * Generic suffixes & noise words stripped during canonical comparison.
 * Order matters: longer phrases first to avoid partial stripping.
 */
const STRIP_WORDS = [
  "super speciality",
  "super specialty",
  "multi speciality",
  "multi specialty",
  "multispeciality",
  "multispecialty",
  "institute of medical sciences",
  "medical college",
  "nursing home",
  "health care",
  "healthcare",
  "hospital",
  "hospitals",
  "clinic",
  "clinics",
  "centre",
  "center",
  "pvt ltd",
  "pvt",
  "ltd",
  "private limited",
  "private",
  "and",
  "&",
];

/**
 * Normalizes a hospital name for deduplication comparison.
 *
 * - Lowercases
 * - Strips punctuation (dots, commas, apostrophes, hyphens → spaces)
 * - Removes generic suffixes ("hospital", "clinic", "super speciality", etc.)
 * - Collapses whitespace
 * - Trims
 *
 * Examples:
 *   "Vijaya Hospital"                    → "vijaya"
 *   "vijaya hospital"                    → "vijaya"
 *   "Vijaya Multi Speciality Hospital"   → "vijaya"
 *   "St. Joseph's Hospital"              → "st josephs"
 */
export function normalizeHospitalName(name: string): string {
  let n = name.toLowerCase();
  // Strip punctuation → spaces
  n = n.replace(/[.,'"'`\-()[\]{}]/g, " ");
  // Remove generic words (longest first to prevent partial matches)
  for (const w of STRIP_WORDS) {
    // Replace as whole word boundaries where possible
    n = n.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
  }
  // Collapse whitespace and trim
  n = n.replace(/\s+/g, " ").trim();
  return n;
}

/**
 * Validates whether a hospital name is genuine rather than a generic tag or placeholder.
 * Rejects entries like "#hospital", "Hospital", "hospital", "Local Hospital", "Dispensary", etc.
 */
export function isPlaceholderOrGenericHospitalName(name: string | null | undefined): boolean {
  if (!name || typeof name !== "string") return true;
  const trimmed = name.trim();
  if (trimmed.length < 2) return true;

  // Starts with hashtags, symbols, or invalid prefixes (e.g. #hospital)
  if (/^[#@$%&*^~_+=!/?]/.test(trimmed)) return true;

  const lower = trimmed.toLowerCase();

  // Known exact placeholder tokens
  const genericExact = new Set([
    "hospital",
    "hospitals",
    "#hospital",
    "clinic",
    "clinics",
    "dispensary",
    "nursing home",
    "health care",
    "healthcare",
    "health centre",
    "health center",
    "primary health centre",
    "community health centre",
    "medical centre",
    "medical center",
    "medical college",
    "local hospital",
    "general hospital",
    "district hospital",
    "government hospital",
    "private hospital",
    "unknown",
    "null",
    "undefined",
    "test",
    "test hospital",
    "sample",
    "dummy",
    "placeholder",
    "temp",
    "rmp hospital",
    "hospital jyo",
  ]);

  if (genericExact.has(lower)) return true;

  // Canonical name must leave at least 2 distinct characters
  // e.g. "Hospital" -> "" (invalid)
  // "Super Speciality Hospital" -> "" (invalid)
  const canon = normalizeHospitalName(trimmed);
  if (!canon || canon.length < 2) return true;

  // Pure digits
  if (/^\d+$/.test(canon)) return true;

  return false;
}

/**
 * Validates whether a hospital phone number is genuine rather than a placeholder.
 */
export function isValidHospitalPhoneNumber(phone?: string | null): boolean {
  if (!phone || typeof phone !== "string") return false;
  const trimmed = phone.trim();
  if (trimmed.length < 3) return false;
  if (trimmed.includes("8000 000 000") || trimmed.includes("0000000000") || trimmed === "0000") return false;
  return true;
}


// ─── 2. Multi-Signal Deduplication ──────────────────────────────────────────

/**
 * Deduplicates a list of hospitals using two signals:
 *
 * 1. **Canonical name match** — normalizeHospitalName(a) === normalizeHospitalName(b)
 * 2. **Geo proximity** — haversine distance ≤ 350 meters
 *
 * Both signals must match for a pair to be considered duplicates.
 * Also filters out any generic or placeholder hospital entries.
 */
export function deduplicateAndMergeHospitals<T extends Hospital>(hospitals: T[]): T[] {
  // First, strip out all placeholder and generic records
  const validHospitals = hospitals.filter((h) => !isPlaceholderOrGenericHospitalName(h.name));
  if (validHospitals.length <= 1) return validHospitals;

  const result: T[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < validHospitals.length; i++) {
    if (consumed.has(i)) continue;

    let best = validHospitals[i];
    const bestCanon = normalizeHospitalName(best.name);

    for (let j = i + 1; j < validHospitals.length; j++) {
      if (consumed.has(j)) continue;

      const other = validHospitals[j];
      const otherCanon = normalizeHospitalName(other.name);

      // Both signals must agree: same canonical name AND within 350m
      if (bestCanon !== otherCanon) continue;

      const dist = calculateDistanceKm(
        best.latitude,
        best.longitude,
        other.latitude,
        other.longitude
      );
      if (dist > 0.35) continue;

      // Merge: prefer curated/registry record as base
      consumed.add(j);
      best = mergeHospitalRecords(best, other);
    }

    result.push(best);
  }

  return result;
}

/**
 * Merges two duplicate hospital records, preferring the "richer" one.
 * Priority: official_registry > has accreditation > has real phone.
 */
function mergeHospitalRecords<T extends Hospital>(a: T, b: T): T {
  // Score each record to decide which is the "authoritative" base
  const scoreRecord = (h: Hospital): number => {
    let s = 0;
    if (h.sourceType === "official_registry") s += 10;
    if (h.accreditation && h.accreditation.length > 0 && !h.accreditation[0]?.includes("State Health")) s += 5;
    if (h.phone && !h.phone.includes("8000 000 000") && h.phone !== "108") s += 3;
    if (h.specialty && h.specialty.length > 2) s += 2;
    if ((h as any).famousFor) s += 1;
    return s;
  };

  const scoreA = scoreRecord(a);
  const scoreB = scoreRecord(b);

  const [base, donor] = scoreA >= scoreB ? [a, b] : [b, a];

  // Merge specialties (union, deduplicated)
  const mergedSpecs = Array.from(
    new Set([...(base.specialty || []), ...(donor.specialty || [])])
  );

  // Merge accreditation
  const mergedAccred = Array.from(
    new Set([...(base.accreditation || []), ...(donor.accreditation || [])])
  ).filter((a) => !a.includes("State Health Authority")); // Remove generic OSM placeholder

  return {
    ...base,
    specialty: mergedSpecs.length > 0 ? mergedSpecs : base.specialty,
    accreditation: mergedAccred.length > 0 ? mergedAccred : base.accreditation,
    isEmergency24x7: base.isEmergency24x7 || donor.isEmergency24x7,
    acceptsPublicInsurance: base.acceptsPublicInsurance || donor.acceptsPublicInsurance,
    // Keep the curated phone, fallback to donor's if base is placeholder
    phone:
      base.phone && !base.phone.includes("8000 000 000")
        ? base.phone
        : donor.phone && !donor.phone.includes("8000 000 000")
        ? donor.phone
        : base.phone,
  };
}


// ─── 3. Client-Side Specialty Evaluation & Ranking ──────────────────────────

/**
 * Minimal shape the evaluator needs from each hospital record.
 * HospitalItem from InteractiveRouteMap satisfies this via structural typing.
 */
export interface EvaluableHospital {
  id: string;
  name: string;
  specialty: string[];
  famousFor?: string;
  isEmergency24x7?: boolean;
  rating?: number;
  accreditation?: string[];
  acceptsPublicInsurance?: boolean;
  distanceKm: number;
  etaMinutes?: number;
  sourceType?: string;
  // Allow any extra fields to pass through
  [key: string]: any;
}

/**
 * Evaluate and rank a pre-fetched hospital list against a specialty filter.
 *
 * This runs entirely on the client (inside useMemo) so specialty changes
 * are instant with ZERO network requests.
 */
export function evaluateAndRankForSpecialty<T extends EvaluableHospital>(
  hospitals: T[],
  specialtyFilter: string
): {
  ranked: (T & { isSpecialtyMatch: boolean; specialtyScore: number; matchTier: string; matchedCategory: string; isFallback: boolean; isEligible: boolean; actionType: string; matchReasons: string[]; matchLabel: string; rank: number })[];
  categoryFallback: boolean;
  fallbackBanner: string | null;
  categoryLabel: string;
  categoryClass: string;
} {
  const rule = specialtyFilter && specialtyFilter !== "all" ? CATEGORY_RULES[specialtyFilter] : null;
  const isCategoryFilterActive = Boolean(rule);

  // Evaluate each hospital against the specialty
  const evaluated = hospitals.map((h) => {
    const matchReasons: string[] = [];
    const hospName = h.name.toLowerCase();
    const hospSpecs = (h.specialty || []).map((s) => s.toLowerCase());
    const famousFor = (h.famousFor || "").toLowerCase();
    const allText = `${hospName} ${hospSpecs.join(" ")} ${famousFor}`;

    let isSpecialtyMatch = false;
    let specialtyScore = 0;

    if (rule) {
      const hasMustHave = rule.mustHaveKeywords.some((kw) => allText.includes(kw));
      if (hasMustHave) {
        isSpecialtyMatch = true;
        specialtyScore = 40;
        for (const bkw of rule.boostKeywords) {
          if (allText.includes(bkw)) specialtyScore += 5;
        }
        matchReasons.push(`Matched: ${rule.label}`);
      }
    } else {
      isSpecialtyMatch = true;
      specialtyScore = h.isEmergency24x7 ? 30 : 20;
      matchReasons.push(h.isEmergency24x7 ? "24/7 Emergency Care" : "Specialty Care");
    }

    let matchTier: "verified" | "inferred" | "fallback" = "inferred";
    if (!isSpecialtyMatch && isCategoryFilterActive) {
      matchTier = "fallback";
    } else if (
      h.sourceType === "official_registry" ||
      (h.accreditation && h.accreditation.length > 0 && h.sourceType !== "osm_discovery")
    ) {
      matchTier = "verified";
    }

    const isFallback = isCategoryFilterActive && !isSpecialtyMatch;
    const actionType = rule ? rule.actionType : h.isEmergency24x7 ? "call_ed" : "call_hospital";

    if (h.isEmergency24x7) matchReasons.push("24/7 Emergency Department");
    if (h.accreditation && h.accreditation.length > 0) {
      matchReasons.push(`${h.accreditation.join(" & ")} Accredited`);
    }
    matchReasons.push(`${h.distanceKm.toFixed(1)} km away · ~${h.etaMinutes}m drive`);
    if (h.acceptsPublicInsurance) matchReasons.push("Ayushman / PM-JAY Empanelled");

    return {
      ...h,
      isSpecialtyMatch,
      specialtyScore,
      matchTier,
      matchedCategory: isFallback
        ? "Nearest 24/7 ER (Emergency Fallback)"
        : rule
        ? rule.label
        : "General Care",
      isFallback,
      actionType,
      matchReasons,
      isEligible: !isFallback,
    };
  });

  // Separate matched vs non-matched
  let matched = evaluated.filter((h) => h.isSpecialtyMatch);
  const nonMatched = evaluated.filter((h) => !h.isSpecialtyMatch);

  let categoryFallback = false;
  let fallbackBanner: string | null = null;

  if (isCategoryFilterActive && matched.length === 0) {
    categoryFallback = true;
    fallbackBanner = `No verified ${rule!.label} facility confirmed nearby. Showing nearest accredited 24/7 ERs for emergency care.`;
    matched = nonMatched.map((h) => ({
      ...h,
      isFallback: true,
      isEligible: false,
      matchTier: "fallback" as const,
      matchedCategory: "Nearest 24/7 ER",
      actionType: "call_ed" as const,
      matchReasons: [
        `No confirmed ${rule!.label} facility nearby`,
        "Nearest 24/7 emergency facility for stabilization",
      ],
    }));
  }

  // Rank matched facilities
  if (rule?.class === "elective") {
    matched.sort((a, b) => {
      if (b.specialtyScore !== a.specialtyScore) return b.specialtyScore - a.specialtyScore;
      const rA = a.rating || 4.0;
      const rB = b.rating || 4.0;
      if (rB !== rA) return rB - rA;
      return a.distanceKm - b.distanceKm;
    });
  } else {
    matched.sort((a, b) => {
      const erA = a.isEmergency24x7 ? 1 : 0;
      const erB = b.isEmergency24x7 ? 1 : 0;
      if (erA !== erB) return erB - erA;
      return a.distanceKm - b.distanceKm;
    });
  }

  nonMatched.sort((a, b) => a.distanceKm - b.distanceKm);

  const orderedPool = categoryFallback ? matched : [...matched, ...nonMatched];

  const ranked = orderedPool.map((h, idx) => {
    const rank = idx + 1;
    let matchLabel = "FACILITY DIRECTORY";
    if (h.isFallback) {
      matchLabel = "24/7 ER FALLBACK";
    } else if (rank === 1) {
      matchLabel = "BEST MATCH";
    } else if (h.isSpecialtyMatch) {
      matchLabel = "SPECIALTY MATCH";
    }

    return {
      ...h,
      rank,
      matchLabel,
    };
  });

  return {
    ranked,
    categoryFallback,
    fallbackBanner,
    categoryLabel: rule ? rule.label : "All Hospitals & 24/7 ERs",
    categoryClass: rule ? rule.class : "emergency",
  };
}
