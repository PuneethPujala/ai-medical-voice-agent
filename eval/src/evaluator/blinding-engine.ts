/**
 * Blinding, Balanced Strata Allocation & AES-256-GCM Encrypted Secret Mapping
 */

import crypto from 'node:crypto';

export interface BlindedPair {
  pair_id: string;
  sample_id: string;
  domain: string;
  option_a: string;
  option_b: string;
}

export interface SecretMappingRecord {
  sample_id: string;
  pair_id: string;
  domain: string;
  response_a_provenance: 'agent' | 'reference';
  response_b_provenance: 'agent' | 'reference';
  coin_flip_random: number;
}

export interface EncryptedSecretPayload {
  version: 'aes-256-gcm-v1';
  iv: string; // 12-byte hex
  authTag: string; // 16-byte hex
  ciphertext: string; // hex
}

/**
 * Strips speaker tags and product prefixes while preserving natural clinical terminology.
 * Normalizes typographic quotes, dashes, and whitespace identically for both candidate responses.
 */
export function stripProvenance(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // Remove speaker prefixes at start of text or line, e.g. "Dr. Sarah Chen:", "MedVoice:", "Physician:"
  const speakerPrefixRegex =
    /^(?:(?:Dr\.\s*Sarah\s*Chen|MedVoice(?:\s*AI)?|Physician|Assistant|Doctor|Clinical\s*Assistant|HealthCareMagic|MedDialog)[:\-–—]\s*)+/gim;
  cleaned = cleaned.replace(speakerPrefixRegex, '');

  // Normalize typographic characters to standard ASCII
  cleaned = cleaned
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-');

  // Normalize internal and surrounding whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Deterministic PRNG (Mulberry32) for reproducible tests.
 */
export function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cryptographically secure random uint32 seed for production experiments.
 */
export function generateCryptographicSeed(): number {
  return crypto.randomBytes(4).readUInt32BE(0);
}

/**
 * Allocates a single pair into Option A and Option B based on a coin flip float [0, 1).
 */
export function allocateBlindedPair(
  sampleId: string,
  pairId: string,
  domain: string,
  rawAgentResponse: string,
  rawReferenceResponse: string,
  randomFloat: number
): { blindedPair: BlindedPair; secretRecord: SecretMappingRecord } {
  const agentClean = stripProvenance(rawAgentResponse);
  const refClean = stripProvenance(rawReferenceResponse);

  const agentIsA = randomFloat < 0.5;

  const optionA = agentIsA ? agentClean : refClean;
  const optionB = agentIsA ? refClean : agentClean;

  const blindedPair: BlindedPair = {
    pair_id: pairId,
    sample_id: sampleId,
    domain,
    option_a: optionA,
    option_b: optionB,
  };

  const secretRecord: SecretMappingRecord = {
    sample_id: sampleId,
    pair_id: pairId,
    domain,
    response_a_provenance: agentIsA ? 'agent' : 'reference',
    response_b_provenance: agentIsA ? 'reference' : 'agent',
    coin_flip_random: randomFloat,
  };

  return { blindedPair, secretRecord };
}

/**
 * Stratified balanced allocation across clinical domain strata.
 * Guarantees that within each domain stratum, Option A is split evenly between agent and reference.
 */
export function stratifiedAllocateBatch<T extends { id: string; domain: string }>(
  scenarios: T[],
  getResponsePair: (item: T) => { agentResponse: string; referenceResponse: string },
  seed: number
): { blindedPairs: BlindedPair[]; secretRecords: SecretMappingRecord[] } {
  const rng = createSeededRng(seed);

  // Group by domain
  const strata: Record<string, T[]> = {};
  for (const scen of scenarios) {
    strata[scen.domain] = strata[scen.domain] || [];
    strata[scen.domain].push(scen);
  }

  const blindedPairs: BlindedPair[] = [];
  const secretRecords: SecretMappingRecord[] = [];

  for (const [domain, items] of Object.entries(strata)) {
    const n = items.length;
    const numAgentA = Math.floor(n / 2);
    // Create balanced assignments: true = agent is A, false = reference is A
    const assignments: boolean[] = [];
    for (let i = 0; i < n; i++) {
      assignments.push(i < numAgentA);
    }

    // Fisher-Yates shuffle assignments using rng
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const temp = assignments[i];
      assignments[i] = assignments[j];
      assignments[j] = temp;
    }

    for (let i = 0; i < n; i++) {
      const scen = items[i];
      const { agentResponse, referenceResponse } = getResponsePair(scen);
      const pairId = `pair_${scen.id}`;
      // assignment true => float 0.25 (< 0.5), false => float 0.75 (>= 0.5)
      const randomFloat = assignments[i] ? 0.25 : 0.75;
      const { blindedPair, secretRecord } = allocateBlindedPair(
        scen.id,
        pairId,
        domain,
        agentResponse,
        referenceResponse,
        randomFloat
      );
      blindedPairs.push(blindedPair);
      secretRecords.push(secretRecord);
    }
  }

  return { blindedPairs, secretRecords };
}

/**
 * Encrypts secret mapping records using AES-256-GCM.
 */
export function encryptSecretMapping(
  records: SecretMappingRecord[],
  passphraseOrKey: string
): EncryptedSecretPayload {
  const key = crypto.createHash('sha256').update(passphraseOrKey).digest(); // 32 bytes
  const iv = crypto.randomBytes(12); // 12-byte nonce for GCM

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonString = JSON.stringify(records);
  const ciphertext = Buffer.concat([cipher.update(jsonString, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 'aes-256-gcm-v1',
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

/**
 * Decrypts secret mapping records using AES-256-GCM and verifies authenticity.
 */
export function decryptSecretMapping(
  payload: EncryptedSecretPayload,
  passphraseOrKey: string
): SecretMappingRecord[] {
  if (payload.version !== 'aes-256-gcm-v1') {
    throw new Error(`Unsupported secret mapping version: ${payload.version}`);
  }

  const key = crypto.createHash('sha256').update(passphraseOrKey).digest();
  const iv = Buffer.from(payload.iv, 'hex');
  const authTag = Buffer.from(payload.authTag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const ciphertext = Buffer.from(payload.ciphertext, 'hex');
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return JSON.parse(decrypted.toString('utf8'));
}
