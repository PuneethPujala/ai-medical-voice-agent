/**
 * MedVoice Clinical Response Evaluation Framework: Human Review Sampler & Blinding Engine
 *
 * Implements double-blinded subset sampling, unbiased randomized response allocation (A/B coin flip),
 * and strict textual provenance stripping (removing doctor personas, model branding, and formatting cues).
 */

import fs from "node:fs";
import path from "node:path";

export interface SampleItem {
  id: string;
  domain: string;
  patient_query: string;
  agent_response: string;
  reference_response: string;
}

export interface BlindReviewPrompt {
  sample_id: string;
  domain: string;
  patient_query: string;
  response_a: string;
  response_b: string;
  instructions: string;
}

export interface SecretMappingRecord {
  sample_id: string;
  pair_id: string;
  domain: string;
  response_a_provenance: "agent" | "reference";
  response_b_provenance: "agent" | "reference";
  coin_flip_random: number;
}

export interface SamplerOptions {
  sampleSize?: number;
  seed?: number;
  stratifyByDomain?: boolean;
  outputBlindedPath?: string;
  outputSecretPath?: string;
}

export interface SamplerResult {
  blindedSample: BlindReviewPrompt[];
  secretMapping: SecretMappingRecord[];
}

/**
 * Deterministic pseudo-random number generator (Mulberry32).
 */
function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Strips all identifiable provenance signatures, doctor persona names,
 * and system branding from conversational text to maintain true double-blinding.
 */
export function stripProvenance(text: string): string {
  if (!text) return "";

  let cleaned = text;

  // 1. Remove specific doctor personas and product branding
  const brandingPatterns = [
    /Dr\.\s*Sarah\s*Chen[:\-]?\s*/gi,
    /Dr\.\s*Chen[:\-]?\s*/gi,
    /MedVoice[:\-]?\s*/gi,
    /Physician[:\-]?\s*/gi,
    /Doctor[:\-]?\s*/gi,
    /Patient[:\-]?\s*/gi,
    /AI\s*Assistant[:\-]?\s*/gi,
    /Assistant[:\-]?\s*/gi,
    /Clinical\s*Assistant[:\-]?\s*/gi,
    /HealthCareMagic[:\-]?\s*/gi,
    /MedDialog[:\-]?\s*/gi,
  ];

  for (const pattern of brandingPatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  // 2. Normalize typographical quotes and dashes to standard ASCII
  cleaned = cleaned
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-");

  // 3. Normalize internal and surrounding whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

/**
 * Samples a blinded subset of evaluated dialogue pairs, randomizing A/B presentation
 * with an unbiased coin flip (50% Agent is A, 50% Reference is A) and recording
 * the unblinding key into a secret mapping file.
 */
export function sampleBlindSubset(
  pairs: SampleItem[],
  options: SamplerOptions = {}
): SamplerResult {
  const sampleSize = options.sampleSize ?? Math.min(100, pairs.length);
  const seed = options.seed ?? 42;
  const stratifyByDomain = options.stratifyByDomain ?? true;
  const rng = createSeededRng(seed);

  if (pairs.length === 0) {
    return { blindedSample: [], secretMapping: [] };
  }

  let selectedPairs: SampleItem[] = [];

  if (stratifyByDomain) {
    // Group pairs by domain
    const domainBuckets = new Map<string, SampleItem[]>();
    for (const pair of pairs) {
      const bucket = domainBuckets.get(pair.domain) || [];
      bucket.push(pair);
      domainBuckets.set(pair.domain, bucket);
    }

    // Shuffle within each bucket using seeded rng
    for (const [_, bucket] of domainBuckets) {
      for (let i = bucket.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [bucket[i], bucket[j]] = [bucket[j], bucket[i]];
      }
    }

    // Round-robin selection across buckets until sampleSize is reached
    const domains = Array.from(domainBuckets.keys()).sort();
    let currentIdx = 0;
    while (selectedPairs.length < sampleSize) {
      let addedInRound = false;
      for (const d of domains) {
        const bucket = domainBuckets.get(d)!;
        if (bucket.length > 0) {
          selectedPairs.push(bucket.shift()!);
          addedInRound = true;
          if (selectedPairs.length >= sampleSize) break;
        }
      }
      if (!addedInRound) break; // All buckets exhausted
    }
  } else {
    // Global shuffle and slice
    const copy = [...pairs];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    selectedPairs = copy.slice(0, sampleSize);
  }

  const blindedSample: BlindReviewPrompt[] = [];
  const secretMapping: SecretMappingRecord[] = [];

  const standardInstructions =
    "Review the patient inquiry and evaluate both Response A and Response B independently " +
    "according to the MedVoice 5-point Likert Clinical Rubric and Binary Safety Error Flags.";

  for (let idx = 0; idx < selectedPairs.length; idx++) {
    const pair = selectedPairs[idx];
    const sampleId = `blind_${String(idx + 1).padStart(4, "0")}`;

    // Unbiased coin flip
    const coinFlip = rng();
    const agentIsA = coinFlip < 0.5;

    const cleanedQuery = stripProvenance(pair.patient_query);
    const cleanedAgent = stripProvenance(pair.agent_response);
    const cleanedRef = stripProvenance(pair.reference_response);

    const responseA = agentIsA ? cleanedAgent : cleanedRef;
    const responseB = agentIsA ? cleanedRef : cleanedAgent;

    blindedSample.push({
      sample_id: sampleId,
      domain: pair.domain,
      patient_query: cleanedQuery,
      response_a: responseA,
      response_b: responseB,
      instructions: standardInstructions,
    });

    secretMapping.push({
      sample_id: sampleId,
      pair_id: pair.id,
      domain: pair.domain,
      response_a_provenance: agentIsA ? "agent" : "reference",
      response_b_provenance: agentIsA ? "reference" : "agent",
      coin_flip_random: coinFlip,
    });
  }

  // Write outputs if file paths specified
  if (options.outputBlindedPath) {
    const outDir = path.dirname(options.outputBlindedPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const jsonlContent = blindedSample.map((item) => JSON.stringify(item)).join("\n") + "\n";
    fs.writeFileSync(options.outputBlindedPath, jsonlContent, "utf-8");
  }

  if (options.outputSecretPath) {
    const outDir = path.dirname(options.outputSecretPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(
      options.outputSecretPath,
      JSON.stringify(secretMapping, null, 2),
      "utf-8"
    );
  }

  return { blindedSample, secretMapping };
}
