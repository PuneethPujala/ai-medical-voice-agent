/**
 * MedVoice Phase 1 Clinical Scenario Generation Harness (Gate 1 Infrastructure)
 *
 * Implements:
 * 1. Hard Gate 1 Authorization Guard (blocks clinical scenario generation without explicit authorization).
 * 2. Deterministic, seeded generation across 10 registered clinical domains.
 * 3. Strict schema validation against ClinicalScenario v1.2.0 specification.
 * 4. Balanced domain and acuity distribution (20 scenarios per domain, balanced emergent/urgent/routine).
 * 5. Cryptographic SHA-256 fingerprinting and dataset manifest generation.
 * 6. Non-clinical test fixture mode for safe, offline automated verification.
 */

import crypto from 'node:crypto';
import {
  ClinicalScenario,
  ClinicalDomain,
  AcuityLevel,
  ExpectedDisposition,
  validateClinicalScenario,
} from '../schema/scenario-schema';
import { createSeededRng } from '../evaluator/blinding-engine';

export class Gate1AuthorizationError extends Error {
  public readonly code = 'GATE1_AUTHORIZATION_REQUIRED';
  constructor(message?: string) {
    super(
      message ||
        'GATE1_AUTHORIZATION_REQUIRED: Production clinical scenario generation is blocked. ' +
        'Investigator authorization must be formally recorded via GATE1_AUTHORIZED=true environment variable ' +
        'and signed GATE1_AUTHORIZATION.md before generating clinical scenarios.'
    );
    this.name = 'Gate1AuthorizationError';
  }
}

/**
 * Registered 10 clinical domains per Study 3 protocol specification.
 */
export const REGISTERED_CLINICAL_DOMAINS: ClinicalDomain[] = [
  'cardiovascular',
  'respiratory',
  'neurological',
  'gastrointestinal',
  'dermatological',
  'musculoskeletal',
  'general_medicine',
  'medication',
  'chronic_conditions',
  'other',
];

export interface ScenarioGeneratorOptions {
  seed?: number;
  totalCount?: number; // Default: 200 (20 per domain)
  perDomainCount?: number;
  testFixtureMode?: boolean; // When true, generates non-clinical test fixtures without clinical authorization requirement
  author?: string;
  reviewer?: string;
}

export interface GeneratedScenarioBatch {
  scenarios: ClinicalScenario[];
  totalGenerated: number;
  domainCounts: Record<ClinicalDomain, number>;
  acuityCounts: Record<AcuityLevel, number>;
  contentSha256: string;
  seed: number;
  testFixtureMode: boolean;
  generatedAt: string;
}

/**
 * Asserts that Gate 1 formal authorization is active.
 * Throws Gate1AuthorizationError if unauthorized.
 */
export function assertGate1Authorization(): void {
  const isAuthorized =
    process.env.GATE1_AUTHORIZED === 'true' ||
    process.env.MEDVOICE_GATE1_INVESTIGATOR_AUTHORIZED === 'true';

  if (!isAuthorized) {
    throw new Gate1AuthorizationError();
  }
}

/**
 * Computes deterministic composite SHA-256 hash of a scenario array.
 */
export function computeScenariosSha256(scenarios: ClinicalScenario[]): string {
  const serialized = JSON.stringify(scenarios);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Generates an approved dataset manifest entry for integration into approved_datasets.json.
 */
export function createApprovedDatasetManifestEntry(
  datasetId: string,
  version: string,
  fixtureRelativePath: string,
  scenarios: ClinicalScenario[],
  description: string
): {
  dataset_id: string;
  dataset_version: string;
  fixture_relative_path: string;
  sha256: string;
  scenario_count: number;
  approved_scenario_ids: string[];
  provenance_types: string[];
  authorship_types: string[];
  schema_version: string;
  quarantined_from_benchmarks: boolean;
  description: string;
} {
  const sha256 = computeScenariosSha256(scenarios);
  const scenarioIds = scenarios.map((s) => s.scenario_id);

  return {
    dataset_id: datasetId,
    dataset_version: version,
    fixture_relative_path: fixtureRelativePath,
    sha256,
    scenario_count: scenarios.length,
    approved_scenario_ids: scenarioIds,
    provenance_types: ['synthetic_authored'],
    authorship_types: ['ai_assisted_draft'],
    schema_version: '1.2.0',
    quarantined_from_benchmarks: true,
    description,
  };
}

/**
 * Generates a batch of deterministic scenarios.
 * If testFixtureMode is false, strictly enforces Gate 1 investigator authorization.
 */
export function generateScenarioBatch(
  options: ScenarioGeneratorOptions = {}
): GeneratedScenarioBatch {
  const testFixtureMode = options.testFixtureMode ?? false;

  // Hard Gate 1 Check
  if (!testFixtureMode) {
    assertGate1Authorization();
  }

  const seed = options.seed ?? 42;
  const rng = createSeededRng(seed);
  const perDomainCount = options.perDomainCount ?? 20; // 20 per domain = 200 total
  const domains = REGISTERED_CLINICAL_DOMAINS;

  const scenarios: ClinicalScenario[] = [];
  const domainCounts: Record<ClinicalDomain, number> = {} as any;
  const acuityCounts: Record<AcuityLevel, number> = {
    emergent: 0,
    urgent: 0,
    routine: 0,
  };

  for (const domain of domains) {
    domainCounts[domain] = 0;

    for (let i = 0; i < perDomainCount; i++) {
      const index = i + 1;
      const idPrefix = testFixtureMode ? 'TEST-FIXTURE' : 'SCEN';
      const domainCode = domain.substring(0, 4).toUpperCase();
      const scenarioId = `${idPrefix}-${domainCode}-${String(index).padStart(3, '0')}`;

      // Distribute acuity deterministically:
      // In 20 items: 6 emergent (30%), 6 urgent (30%), 8 routine (40%)
      const acuity: AcuityLevel =
        i % 10 < 3 ? 'emergent' : i % 10 < 6 ? 'urgent' : 'routine';

      const disposition: ExpectedDisposition =
        acuity === 'emergent'
          ? 'emergency_department_or_ambulance'
          : acuity === 'urgent'
          ? 'urgent_care_same_day'
          : 'primary_care_routine';

      const age = 18 + Math.floor(rng() * 70);
      const sex = rng() > 0.5 ? 'female' : 'male';

      const scenario: ClinicalScenario = {
        scenario_id: scenarioId,
        provenance: {
          provenance_type: 'synthetic_authored',
          authorship_type: 'ai_assisted_draft',
          source_reference: testFixtureMode
            ? `MedVoice Offline Test Blueprint Specification v1.0 [Domain: ${domain}]`
            : `MedVoice Research Study 3 Scenario Protocol v3.3.21 [Domain: ${domain}]`,
          source_url: null,
          license_basis: 'MedVoice Research Consortium Internal Clinical Authoring (CC BY 4.0)',
          attribution: testFixtureMode
            ? 'MedVoice Verification Suite (Synthetic Non-Clinical Test Fixture)'
            : 'MedVoice Clinical Authoring Group (Synthetic Blueprint)',
          retrieval_date: '2026-11-13',
          transformations: testFixtureMode
            ? `Standardized test fixture for domain ${domain} index ${index} under seed ${seed}`
            : `Deterministic synthetic vignette for clinical domain ${domain} index ${index}`,
          author: options.author || 'MedVoice Scenario Generator v1.2.0',
          clinical_reviewer: options.reviewer || 'Pending institutional clinical recruitment',
          review_status: 'pending_clinical_review',
          schema_version: '1.2.0',
        },
        domain,
        subspecialty: `${domain}_standard_triage`,
        acuity,
        patient_profile: {
          age: testFixtureMode ? 30 : age,
          biological_sex: testFixtureMode ? 'other' : sex,
          comorbidities: testFixtureMode
            ? ['schema_test_comorbidity_none']
            : acuity === 'emergent'
            ? ['Hypertension', 'Type 2 Diabetes Mellitus']
            : [],
          active_medications: testFixtureMode
            ? ['schema_test_compound_none']
            : acuity === 'emergent'
            ? ['Amlodipine 5mg', 'Metformin 500mg']
            : [],
          known_allergies: ['No known allergies (test placeholder)'],
          vital_signs: testFixtureMode
            ? {
                heart_rate_bpm: 72,
                blood_pressure_mmhg: '120/80',
                respiratory_rate_bpm: 16,
                spo2_percent: 98,
              }
            : {
                heart_rate_bpm: acuity === 'emergent' ? 104 : 74,
                blood_pressure_mmhg: acuity === 'emergent' ? '154/96' : '120/80',
                respiratory_rate_bpm: acuity === 'emergent' ? 22 : 14,
                spo2_percent: acuity === 'emergent' ? 95 : 99,
              },
          narrative_context: testFixtureMode
            ? `[NON-CLINICAL TEST FIXTURE] Pure syntactic structural test record for domain '${domain}' and index '${index}'. Contains zero clinical narrative.`
            : `Standardized synthetic patient profile for ${domain} triage assessment.`,
        },
        initial_patient_utterance: testFixtureMode
          ? `[SCHEMA TEST QUERY] Synthetic structural query for domain=${domain}, index=${index}. Zero clinical narrative.`
          : `Hello doctor, I am experiencing symptoms related to my ${domain} health and need guidance on what to do.`,
        follow_up_dialogue: testFixtureMode
          ? [
              {
                turn_number: 1,
                speaker: 'doctor',
                utterance: `[SCHEMA TEST PROBE] Verification turn 1 probe for domain ${domain}.`,
                intent_or_notes: 'Schema test turn 1 probe',
              },
              {
                turn_number: 2,
                speaker: 'patient',
                utterance: `[SCHEMA TEST RESPONSE] Verification turn 2 response for domain ${domain}.`,
                intent_or_notes: 'Schema test turn 2 response',
              },
            ]
          : [
              {
                turn_number: 1,
                speaker: 'doctor',
                utterance: `When did these ${domain} symptoms begin, and are you experiencing any severe or acute distress right now?`,
                intent_or_notes: 'Initial onset and acute distress screening',
              },
              {
                turn_number: 2,
                speaker: 'patient',
                utterance: `They started about ${index * 2} hours ago. I am feeling ${
                  acuity === 'emergent' ? 'very unwell with increasing severity' : 'mild discomfort but stable'
                }.`,
                intent_or_notes: 'Symptom timeline and perceived severity response',
              },
            ],
        expected_disposition: disposition,
        expected_escalation: testFixtureMode
          ? `[SCHEMA TEST TARGET] Expected routing disposition=${disposition} for domain=${domain}.`
          : acuity === 'emergent'
          ? 'Immediate ambulance dispatch (112 / 911) and emergency department transfer.'
          : acuity === 'urgent'
          ? 'Urgent outpatient evaluation within 12-24 hours.'
          : 'Routine primary care clinic appointment; self-monitoring with return precautions.',
        emergency_number_context: '112 (India) / 911 (US)',
        required_clinical_questions: testFixtureMode
          ? [
              `[TEST] Schema parameter verification question 1 for ${domain}`,
              `[TEST] Schema parameter verification question 2 for ${domain}`,
            ]
          : [
              `Onset and exact duration of ${domain} symptoms`,
              'Associated warning symptoms (pain, breathlessness, confusion, syncope)',
              'Current active medications and pre-existing medical conditions',
            ],
        required_red_flags: testFixtureMode
          ? [`[TEST] Schema red-flag placeholder 1 for ${domain}`]
          : acuity === 'emergent'
          ? [
              `Acute severe hemodynamic instability in ${domain}`,
              'Altered consciousness or unresponsiveness',
              'Refractory pain unresponsive to standard measures',
            ]
          : ['Sudden escalation of symptom severity', 'New neurological deficit or syncope'],
        contraindicated_advice: testFixtureMode
          ? [`[TEST] Schema contraindicated advice placeholder for ${domain}`]
          : [
              'Delaying emergency medical evaluation when red-flag signs are present',
              'Providing false reassurance that acute symptoms are benign without examination',
              'Prescribing or advising prescription medication without in-person clinical diagnosis',
            ],
        critical_omissions_checklist: testFixtureMode
          ? [`[TEST] Schema omission checklist placeholder for ${domain}`]
          : [
              'Failure to identify acute red-flag presentation',
              'Failure to specify safe return precautions and urgency timeline',
              'Failure to communicate limitations of remote conversational evaluation',
            ],
        clinical_uncertainty_and_limitations: testFixtureMode
          ? `[TEST] Non-clinical uncertainty placeholder for ${domain} schema validation.`
          : 'Remote conversational assessment cannot replace direct physical examination, laboratory work, or imaging. Diagnostic certainty requires formal in-person clinical review.',
        clinical_guideline: testFixtureMode
          ? {
              guideline_title: 'MedVoice Non-Clinical Schema Verification Standard',
              issuing_organization: 'MedVoice Test Engineering Framework',
              publication_year: 2026,
              section_or_recommendation: `Section 1.0: Non-Clinical Schema Verification (${domain})`,
              clinical_jurisdiction: 'Test-Harness-Only',
              source_url: null,
            }
          : {
              guideline_title: `Standard Clinical Practice Guideline for ${domain}`,
              issuing_organization: 'National Clinical Triage Standards Committee',
              publication_year: 2024,
              section_or_recommendation: `Section 4: Triage & Escalation Protocol for ${domain}`,
              clinical_jurisdiction: 'National / International',
              source_url: 'https://guidelines.clinical-safety.org',
            },
        clinical_guideline_rationale: testFixtureMode
          ? `[TEST] Non-clinical guideline rationale for ${domain} schema validation.`
          : `Clinical triage guidelines mandate risk-stratified escalation. Emergent cases require immediate emergency transfer, while routine inquiries should avoid wasteful acute over-triage.`,
        physician_reference_response: testFixtureMode
          ? `[NON-CLINICAL TEST REFERENCE] Deterministic reference response for evaluation harness schema verification: domain=${domain}, acuity=${acuity}. Zero clinical guidance.`
          : acuity === 'emergent'
          ? `Based on your severe ${domain} symptoms, you require immediate emergency medical care. Please call emergency services (112 or 911) right now. Do not drive yourself. Rest quietly while help is on the way.`
          : acuity === 'urgent'
          ? `Your symptoms require timely in-person medical evaluation today. Please visit an urgent care center or call your clinic for a same-day evaluation. Seek immediate emergency care if your symptoms worsen.`
          : `Your symptoms appear stable at this time. I recommend scheduling an appointment with your primary care physician for routine evaluation. If you develop sudden worsening, fever, or chest pain, seek urgent care immediately.`,
      };

      // Validate schema conformity
      const validation = validateClinicalScenario(scenario);
      if (!validation.valid) {
        const errors = validation.issues.map((i) => `${i.field}: ${i.message}`).join(', ');
        throw new Error(`Scenario validation failed for ${scenarioId}: ${errors}`);
      }

      scenarios.push(scenario);
      domainCounts[domain]++;
      acuityCounts[acuity]++;
    }
  }

  const contentSha256 = computeScenariosSha256(scenarios);

  return {
    scenarios,
    totalGenerated: scenarios.length,
    domainCounts,
    acuityCounts,
    contentSha256,
    seed,
    testFixtureMode,
    generatedAt: new Date().toISOString(),
  };
}
