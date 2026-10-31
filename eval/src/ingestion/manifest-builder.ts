/**
 * MedVoice Clinical Response Evaluation Framework
 * Dataset Ingestion & Evaluation Manifest Builder
 *
 * Enforces:
 * - Gate 0 Feasibility, Licensing & Ethics Gating (Hard programmatic guard)
 * - PhiScrubber De-Identification on query, context, and reference texts
 * - Strict Zero Automated ESI inference for Track A
 * - Deterministic 10-Domain Chief Complaint Categorization
 * - SHA-256 Provenance & Cryptographic Traceability
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { assertGate0Cleared } from '../governance/gate0-feasibility-check';
import {
  sanitizeClinicalText,
  countWords,
  calculateFKGL,
  validateDialogueItem,
} from './sanitize';

export const CHIEF_COMPLAINT_DOMAINS = [
  'Cardiovascular',
  'Respiratory',
  'Neurological',
  'Gastrointestinal',
  'Dermatological',
  'Musculoskeletal',
  'General Medicine',
  'Medication Related',
  'Chronic Disease',
  'Other',
] as const;

export type ChiefComplaintDomain = (typeof CHIEF_COMPLAINT_DOMAINS)[number];

export interface DialogueTurn {
  role: 'patient' | 'physician';
  text: string;
}

export interface CuratedPairRecord {
  id: string; // e.g. "MED-EVAL-0001"
  source: string; // e.g. "medvoice_synthetic_fixtures"
  source_id: string;
  sha256: string; // cryptographic hash of query + reference
  chief_complaint_domain: ChiefComplaintDomain;
  secondary_tags: string[];
  physician_specialty: string; // e.g. "Cardiology" or "unknown"
  patient_query: string;
  conversation_context: Array<{ role: 'patient' | 'physician'; text: string }>;
  physician_reference: string;
  patient_word_count: number;
  physician_word_count: number;
  patient_fkgl: number;
  physician_fkgl: number;
}

export interface RawDialogueItem {
  id?: string;
  source_id?: string;
  source?: string;
  patient_query?: string;
  query?: string;
  transcript?: string;
  physician_reference?: string;
  reference?: string;
  physician_response?: string;
  conversation_context?: DialogueTurn[];
  context?: DialogueTurn[];
  physician_specialty?: string;
  specialty?: string;
  chief_complaint_domain?: ChiefComplaintDomain;
  domain?: string;
  category?: string;
  secondary_tags?: string[];
  tags?: string[];
}

export interface ManifestBuildOptions {
  outputJsonlPath?: string;
  source?: string;
  datasetId?: string;
}

export interface ManifestBuildResult {
  records: CuratedPairRecord[];
  totalProcessed: number;
  totalValid: number;
  totalRejected: number;
  rejections: Array<{ id?: string; source_id?: string; reason: string }>;
  manifestPath?: string;
}

interface DomainRule {
  domain: ChiefComplaintDomain;
  regex: RegExp;
  weight: number;
}

const DOMAIN_RULES: DomainRule[] = [
  // Medication Related (check high-weight specific phrases first to catch adverse reactions)
  {
    domain: 'Medication Related',
    regex: /\b(?:allergic reaction to (?:medication|antibiotic|drug)|after taking (?:amoxicillin|antibiotic|aspirin|ibuprofen|medicine|drug|dose)|medication side effect|adverse (?:drug )?reaction|drug interaction|overdose|missed dose|drug toxicity)\b/i,
    weight: 5,
  },
  {
    domain: 'Medication Related',
    regex: /\b(?:antibiotic|amoxicillin|ibuprofen|paracetamol|metformin|lisinopril|statin|steroid|aspirin|prescription|side effect|medication|dosage)\b/i,
    weight: 2,
  },

  // Cardiovascular
  {
    domain: 'Cardiovascular',
    regex: /\b(?:chest pain|chest tightness|crushing chest|chest pressure|substernal|angina|stemi|myocardial|heart attack|palpitations|arrhythmia|tachycardia|bradycardia|left arm (?:pain|radiation)|jaw radiation|aortic dissection)\b/i,
    weight: 4,
  },
  {
    domain: 'Cardiovascular',
    regex: /\b(?:cardiac|coronary|heart|clammy skin|cold sweat|diaphoresis)\b/i,
    weight: 1,
  },

  // Respiratory
  {
    domain: 'Respiratory',
    regex: /\b(?:shortness of breath|difficulty breathing|breathless|dyspnea|wheezing|asthma|stridor|choking|hemoptysis|copd|bronchitis|pneumonia|pleurisy|pleuritic)\b/i,
    weight: 4,
  },
  {
    domain: 'Respiratory',
    regex: /\b(?:cough|coughing|phlegm|sputum|lung|respiratory|inhaler)\b/i,
    weight: 1,
  },

  // Neurological
  {
    domain: 'Neurological',
    regex: /\b(?:slurred speech|speech difficulty|facial droop|weakness on (?:the )?(?:left|right) side|unilateral weakness|paralysis|stroke|seizure|convulsion|syncope|fainting|loss of consciousness|ataxia)\b/i,
    weight: 4,
  },
  {
    domain: 'Neurological',
    regex: /\b(?:headache|migraine|dizziness|dizzy|vertigo|numbness|tingling|paresthesia|confusion|neuropathy|tremor)\b/i,
    weight: 2,
  },

  // Gastrointestinal
  {
    domain: 'Gastrointestinal',
    regex: /\b(?:abdominal cramping|abdominal pain|stomach ache|stomach pain|belly pain|bloody diarrhea|hematemesis|melena|rectal bleeding|appendicitis|acid reflux|gerd)\b/i,
    weight: 4,
  },
  {
    domain: 'Gastrointestinal',
    regex: /\b(?:nausea|vomiting|vomit|diarrhea|loose stools|constipation|heartburn|bloating|jaundice|bowel)\b/i,
    weight: 2,
  },

  // Dermatological
  {
    domain: 'Dermatological',
    regex: /\b(?:itchy red rash|red itchy rash|hives|urticaria|pruritus|contact dermatitis|eczema|psoriasis|skin eruption|blisters|shingles|cellulitis)\b/i,
    weight: 4,
  },
  {
    domain: 'Dermatological',
    regex: /\b(?:rash|itch|itching|itchy|lesion|lesions|mole|boil|boils|erythema)\b/i,
    weight: 2,
  },

  // Musculoskeletal
  {
    domain: 'Musculoskeletal',
    regex: /\b(?:lower back pain|back pain radiating|swollen knee joint|knee joint|ankle sprain|sprained ankle|fracture|broken bone|tendonitis|torn meniscus|ligament)\b/i,
    weight: 4,
  },
  {
    domain: 'Musculoskeletal',
    regex: /\b(?:back pain|joint pain|arthritis|sprain|muscle ache|myalgia|swelling|sciatica|stiffness)\b/i,
    weight: 2,
  },

  // Chronic Disease
  {
    domain: 'Chronic Disease',
    regex: /\b(?:blood sugar|hba1c|hyperglycemia|hypoglycemia|diabetes history|diabetic|chronic kidney|dialysis|hypothyroid|hyperthyroid|thyroid disorder|gout flare|lupus)\b/i,
    weight: 4,
  },
  {
    domain: 'Chronic Disease',
    regex: /\b(?:diabetes|glucose|insulin|hypertension management|chronic)\b/i,
    weight: 2,
  },

  // General Medicine
  {
    domain: 'General Medicine',
    regex: /\b(?:high grade fever|fever with chills|night sweats|shivering|unexplained weight loss|malaise|fatigue|generalized weakness|body aches|sore throat)\b/i,
    weight: 3,
  },
  {
    domain: 'General Medicine',
    regex: /\b(?:fever|febrile|chills|cold|flu|viral|infection|dehydration)\b/i,
    weight: 1,
  },
];

/**
 * Deterministically classifies a clinical text into one of 10 Chief Complaint Domains.
 */
export function classifyChiefComplaintDomain(text: string): ChiefComplaintDomain {
  if (!text || !text.trim()) {
    return 'Other';
  }

  const scores: Record<ChiefComplaintDomain, number> = {
    Cardiovascular: 0,
    Respiratory: 0,
    Neurological: 0,
    Gastrointestinal: 0,
    Dermatological: 0,
    Musculoskeletal: 0,
    'General Medicine': 0,
    'Medication Related': 0,
    'Chronic Disease': 0,
    Other: 0,
  };

  for (const rule of DOMAIN_RULES) {
    if (rule.regex.test(text)) {
      scores[rule.domain] += rule.weight;
    }
  }

  let bestDomain: ChiefComplaintDomain = 'Other';
  let maxScore = 0;

  // Order of preference on tie-break:
  const priorityOrder: ChiefComplaintDomain[] = [
    'Medication Related',
    'Chronic Disease',
    'Cardiovascular',
    'Neurological',
    'Respiratory',
    'Gastrointestinal',
    'Dermatological',
    'Musculoskeletal',
    'General Medicine',
    'Other',
  ];

  for (const domain of priorityOrder) {
    if (scores[domain] > maxScore) {
      maxScore = scores[domain];
      bestDomain = domain;
    }
  }

  return bestDomain;
}

/**
 * Builds the curated evaluation manifest from raw dialogue items.
 *
 * Hard Requirements Enforced:
 * 1. Gate 0 asserted before dataset ingestion.
 * 2. PhiScrubber de-identification applied to all textual components.
 * 3. Short queries accepted; empty and over-length queries rejected.
 * 4. Zero automated ESI inference (Track A strictly un-labeled).
 * 5. Deterministic SHA-256 cryptographic provenance hashing.
 */
export function buildEvaluationManifest(
  rawItems: RawDialogueItem[],
  options?: ManifestBuildOptions
): ManifestBuildResult {
  // 1. Identify all distinct source IDs and assert Gate 0 clearance
  const sourcesToCheck = new Set<string>();
  if (options?.source) sourcesToCheck.add(options.source);
  if (options?.datasetId) sourcesToCheck.add(options.datasetId);

  for (const item of rawItems) {
    const s = item.source || options?.source || options?.datasetId || 'medvoice_synthetic_fixtures';
    sourcesToCheck.add(s);
  }

  if (sourcesToCheck.size === 0) {
    sourcesToCheck.add('medvoice_synthetic_fixtures');
  }

  for (const sourceId of sourcesToCheck) {
    assertGate0Cleared(sourceId, 'ingest');
  }

  const records: CuratedPairRecord[] = [];
  const rejections: Array<{ id?: string; source_id?: string; reason: string }> = [];

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    const sourceId = raw.source_id || raw.id || `SRC-${i + 1}`;
    const source = raw.source || options?.source || options?.datasetId || 'medvoice_synthetic_fixtures';

    // 2. Admission validation
    const validation = validateDialogueItem(raw);
    if (!validation.valid) {
      rejections.push({
        id: raw.id,
        source_id: sourceId,
        reason: validation.reason || 'Failed admission validation',
      });
      continue;
    }

    const rawQuery = (raw.patient_query ?? raw.query ?? raw.transcript ?? '').trim();
    const rawReference = (raw.physician_reference ?? raw.reference ?? raw.physician_response ?? '').trim();

    // 3. De-identification via PhiScrubber
    const sanitizedQuery = sanitizeClinicalText(rawQuery);
    const sanitizedReference = sanitizeClinicalText(rawReference);

    // Context de-identification
    const rawContext = raw.conversation_context ?? raw.context ?? [];
    const conversationContext: Array<{ role: 'patient' | 'physician'; text: string }> = rawContext.map((turn) => ({
      role: turn.role,
      text: sanitizeClinicalText(turn.text),
    }));

    // 4. Domain classification
    let domain: ChiefComplaintDomain;
    if (raw.chief_complaint_domain && CHIEF_COMPLAINT_DOMAINS.includes(raw.chief_complaint_domain)) {
      domain = raw.chief_complaint_domain;
    } else if (raw.domain && CHIEF_COMPLAINT_DOMAINS.includes(raw.domain as ChiefComplaintDomain)) {
      domain = raw.domain as ChiefComplaintDomain;
    } else if (raw.category && CHIEF_COMPLAINT_DOMAINS.includes(raw.category as ChiefComplaintDomain)) {
      domain = raw.category as ChiefComplaintDomain;
    } else {
      domain = classifyChiefComplaintDomain(sanitizedQuery);
    }

    // 5. Physician specialty with fallback
    const specialty = (raw.physician_specialty || raw.specialty || '').trim() || 'unknown';

    // 6. Secondary tags
    const incomingTags = raw.secondary_tags || raw.tags || [];
    const secondaryTags = Array.from(new Set(incomingTags));

    // 7. Provenance SHA-256 hash
    const sha256 = crypto
      .createHash('sha256')
      .update(`${sanitizedQuery.trim()}::${sanitizedReference.trim()}`)
      .digest('hex');

    // 8. ID formatting (e.g. "MED-EVAL-0001")
    const id = raw.id?.startsWith('MED-EVAL-')
      ? raw.id
      : `MED-EVAL-${String(records.length + 1).padStart(4, '0')}`;

    // 9. Readability and word count metrics
    const patientWordCount = countWords(sanitizedQuery);
    const physicianWordCount = countWords(sanitizedReference);
    const patientFkgl = calculateFKGL(sanitizedQuery);
    const physicianFkgl = calculateFKGL(sanitizedReference);

    const record: CuratedPairRecord = {
      id,
      source,
      source_id: sourceId,
      sha256,
      chief_complaint_domain: domain,
      secondary_tags: secondaryTags,
      physician_specialty: specialty,
      patient_query: sanitizedQuery,
      conversation_context: conversationContext,
      physician_reference: sanitizedReference,
      patient_word_count: patientWordCount,
      physician_word_count: physicianWordCount,
      patient_fkgl: patientFkgl,
      physician_fkgl: physicianFkgl,
    };

    records.push(record);
  }

  // 10. Write JSONL if requested
  if (options?.outputJsonlPath) {
    const targetDir = path.dirname(path.resolve(options.outputJsonlPath));
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const lines = records.map((rec) => JSON.stringify(rec)).join('\n');
    fs.writeFileSync(path.resolve(options.outputJsonlPath), lines + (lines ? '\n' : ''), 'utf-8');
  }

  return {
    records,
    totalProcessed: rawItems.length,
    totalValid: records.length,
    totalRejected: rejections.length,
    rejections,
    manifestPath: options?.outputJsonlPath,
  };
}
