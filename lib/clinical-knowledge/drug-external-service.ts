/**
 * External Drug Information & Education Service (RxNorm + openFDA)
 * 
 * Provides educational medication terminology, active ingredients,
 * and regulatory labeling warnings grounded in official biomedical APIs:
 * - NLM RxNorm REST API: https://rxnav.nlm.nih.gov/REST/
 * - openFDA Drug Labeling API: https://api.fda.gov/drug/label.json
 * 
 * Clinical Invariants:
 * 1. Educational/Informational only: Never acts as an autonomous prescriber or dosage calculator.
 * 2. High Resilience: Strict 2.5s network timeouts with AbortController and memory cache.
 * 3. Graceful Local Fallback: If external APIs are unavailable or throttled, falls back to
 *    local DRUG_SYNONYMS_AND_BRANDS and MedlinePlus RAG passages without failing the consultation.
 * 4. Jurisdiction Transparency: RxNorm and openFDA are US-oriented regulatory databases.
 *    Any retrieved data includes explicit jurisdictional disclaimer noting that formulations,
 *    brand approvals, and schedules in India (CDSCO/MoHFW) or other jurisdictions require local clinician review.
 */

import { DRUG_SYNONYMS_AND_BRANDS } from "./safety-matrix";

export interface DrugExternalEducation {
  queryTerm: string;
  genericName: string;
  tradeNames: string[];
  rxcui?: string | null;
  dosageForms?: string[];
  fdaWarnings?: string[];
  boxedWarning?: string | null;
  indicationsAndUsage?: string[];
  adverseReactions?: string[];
  sourcesUsed: Array<{
    name: "RxNorm" | "openFDA" | "Local_Pharmacology_Matrix";
    url?: string;
    jurisdiction: string;
  }>;
  jurisdictionNotice: string;
}

interface CacheEntry {
  data: DrugExternalEducation;
  timestamp: number;
}

const DRUG_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolves any colloquial or Indian brand name to its primary active generic ingredient.
 */
export function resolveGenericDrugName(drugName: string): { generic: string; matchedBrand?: string } {
  const clean = drugName.toLowerCase().trim();
  
  // Direct match in keys
  if (DRUG_SYNONYMS_AND_BRANDS[clean]) {
    return { generic: clean };
  }

  // Brand lookup
  for (const [generic, brands] of Object.entries(DRUG_SYNONYMS_AND_BRANDS)) {
    if (brands.some((b) => b === clean || clean.includes(b) || b.includes(clean))) {
      return { generic, matchedBrand: clean };
    }
  }

  return { generic: clean };
}

/**
 * Fetch with strict timeout.
 */
async function fetchWithTimeout(url: string, timeoutMs: number = 2500): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Query RxNorm for Concept Unique Identifier (RxCUI) and basic forms.
 */
async function queryRxNorm(genericName: string): Promise<{ rxcui: string | null; dosageForms: string[] }> {
  try {
    const url = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(genericName)}`;
    const res = await fetchWithTimeout(url, 2500);
    if (!res.ok) return { rxcui: null, dosageForms: [] };

    const data = await res.json().catch(() => ({}));
    const idGroup = data?.idGroup;
    const rxcui = idGroup?.rxnormId?.[0] || null;

    let dosageForms: string[] = [];
    if (rxcui) {
      try {
        const propUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(rxcui)}/property.json?propName=RxNorm%20Name`;
        const propRes = await fetchWithTimeout(propUrl, 2000);
        if (propRes.ok) {
          const propData = await propRes.json().catch(() => ({}));
          const propConcept = propData?.propConceptGroup?.propConcept?.[0];
          if (propConcept?.propValue) {
            dosageForms.push(propConcept.propValue);
          }
        }
      } catch {
        // Non-critical property lookup failure
      }
    }

    return { rxcui, dosageForms };
  } catch (err) {
    // Network timeout or offline - graceful fallback
    return { rxcui: null, dosageForms: [] };
  }
}

/**
 * Query openFDA for drug labeling warnings and safety information.
 */
async function queryOpenFda(genericName: string): Promise<{
  warnings: string[];
  boxedWarning: string | null;
  indications: string[];
}> {
  try {
    const clean = genericName.split(" ")[0]; // First token for multi-ingredient combos
    const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:"${encodeURIComponent(clean)}"&limit=1`;
    const res = await fetchWithTimeout(url, 2500);
    if (!res.ok) return { warnings: [], boxedWarning: null, indications: [] };

    const data = await res.json().catch(() => ({}));
    const result = data?.results?.[0];
    if (!result) return { warnings: [], boxedWarning: null, indications: [] };

    const warnings: string[] = [];
    if (Array.isArray(result.warnings)) {
      warnings.push(...result.warnings.slice(0, 2).map((w: string) => w.slice(0, 300)));
    } else if (typeof result.warnings === "string") {
      warnings.push(result.warnings.slice(0, 300));
    }

    const boxedWarning = Array.isArray(result.boxed_warning)
      ? result.boxed_warning[0]?.slice(0, 350) || null
      : typeof result.boxed_warning === "string"
      ? result.boxed_warning.slice(0, 350)
      : null;

    const indications: string[] = [];
    if (Array.isArray(result.indications_and_usage)) {
      indications.push(result.indications_and_usage[0]?.slice(0, 250));
    }

    return { warnings, boxedWarning, indications };
  } catch (err) {
    // Network timeout or offline - graceful fallback
    return { warnings: [], boxedWarning: null, indications: [] };
  }
}

/**
 * Retrieve comprehensive educational medication knowledge.
 */
export async function getDrugEducationAndSafety(drugName: string): Promise<DrugExternalEducation> {
  const clean = drugName.trim();
  const cacheKey = clean.toLowerCase();

  const cached = DRUG_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const { generic, matchedBrand } = resolveGenericDrugName(clean);
  const knownTradeNames = DRUG_SYNONYMS_AND_BRANDS[generic] || (matchedBrand ? [matchedBrand] : []);

  // Parallel asynchronous queries to RxNorm & openFDA with timeouts
  const [rxNormResult, openFdaResult] = await Promise.all([
    queryRxNorm(generic),
    queryOpenFda(generic),
  ]);

  const sourcesUsed: DrugExternalEducation["sourcesUsed"] = [
    {
      name: "Local_Pharmacology_Matrix",
      jurisdiction: "India (CDSCO) & Global (WHO Essential Medicines)",
    },
  ];

  if (rxNormResult.rxcui) {
    sourcesUsed.push({
      name: "RxNorm",
      url: "https://www.nlm.nih.gov/research/umls/rxnorm/",
      jurisdiction: "United States (NLM / NIH)",
    });
  }

  if (openFdaResult.warnings.length > 0 || openFdaResult.boxedWarning) {
    sourcesUsed.push({
      name: "openFDA",
      url: "https://open.fda.gov/apis/drug/label/",
      jurisdiction: "United States (FDA FAERS/DailyMed)",
    });
  }

  const result: DrugExternalEducation = {
    queryTerm: clean,
    genericName: generic,
    tradeNames: knownTradeNames,
    rxcui: rxNormResult.rxcui,
    dosageForms: rxNormResult.dosageForms,
    fdaWarnings: openFdaResult.warnings,
    boxedWarning: openFdaResult.boxedWarning,
    indicationsAndUsage: openFdaResult.indications,
    sourcesUsed,
    jurisdictionNotice:
      "RxNorm and openFDA entries represent United States regulatory labeling. For clinical consultations in India or other regions, local drug formulations, CDSCO approvals, and attending physician guidance take precedence.",
  };

  DRUG_CACHE.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}
