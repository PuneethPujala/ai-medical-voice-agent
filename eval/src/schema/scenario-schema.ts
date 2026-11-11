/**
 * MedVoice Computational Evaluation Framework
 * Versioned Clinical Scenario Schema & Validation Engine
 *
 * Implements strict Phase 1 computational governance invariants:
 * 1. Independent statistical unit: Scenario/Vignette (not patient consultation).
 * 2. Four-tier provenance classification (synthetic_authored, synthetic_derived, public_dataset, real_deidentified).
 * 3. Authorship transparency (clinician_authored vs researcher_authored vs ai_assisted_draft).
 * 4. Transparent review status ('pending_clinical_review' | 'clinician_verified' | 'adjudicated').
 * 5. Prohibition of "deidentification_verified" assertions on synthetic data.
 * 6. Explicit guideline citation with issuing body, year, section, and jurisdiction.
 * 7. Structured reference requirements:
 *    - required_clinical_questions
 *    - required_red_flags
 *    - contraindicated_advice
 *    - critical_omissions_checklist
 *    - clinical_uncertainty_and_limitations
 *    - simulated expert-reference responses
 */

export type ProvenanceType =
  | 'synthetic_authored'
  | 'synthetic_derived'
  | 'public_dataset'
  | 'real_deidentified';

export type AuthorshipType =
  | 'clinician_authored'
  | 'researcher_authored'
  | 'ai_assisted_draft';

export type ClinicalDomain =
  | 'cardiovascular'
  | 'respiratory'
  | 'neurological'
  | 'gastrointestinal'
  | 'dermatological'
  | 'musculoskeletal'
  | 'general_medicine'
  | 'medication'
  | 'chronic_conditions'
  | 'other';

export type AcuityLevel = 'emergent' | 'urgent' | 'routine';

export type ExpectedDisposition =
  | 'emergency_department_or_ambulance'
  | 'emergency_department_or_911'
  | 'urgent_medical_evaluation'
  | 'urgent_care_same_day'
  | 'primary_care_routine'
  | 'self_care_home_monitoring';

export interface ScenarioProvenance {
  provenance_type: ProvenanceType;
  authorship_type: AuthorshipType;
  source_reference: string;
  source_url: string | null;
  license_basis: string;
  attribution: string;
  retrieval_date: string; // ISO 8601 date (YYYY-MM-DD)
  transformations: string;
  author: string;
  clinical_reviewer: string;
  review_status: 'pending_clinical_review' | 'clinician_verified' | 'adjudicated';
  schema_version: string; // e.g., "1.2.0"
}

export interface ClinicalGuidelineReference {
  guideline_title: string;
  issuing_organization: string;
  publication_year: number;
  section_or_recommendation: string;
  clinical_jurisdiction: string;
  source_url: string | null;
}

export interface SyntheticPatientProfile {
  age: number;
  biological_sex: 'female' | 'male' | 'other';
  comorbidities: string[];
  active_medications: string[];
  known_allergies: string[];
  vital_signs?: {
    heart_rate_bpm?: number;
    blood_pressure_mmhg?: string;
    respiratory_rate_bpm?: number;
    spo2_percent?: number;
    temperature_celsius?: number;
  };
  narrative_context: string;
}

export interface DialogueTurn {
  turn_number: number;
  speaker: 'patient' | 'doctor';
  utterance: string;
  intent_or_notes?: string;
}

export interface ClinicalScenario {
  scenario_id: string;
  provenance: ScenarioProvenance;
  domain: ClinicalDomain;
  subspecialty: string;
  acuity: AcuityLevel;
  patient_profile: SyntheticPatientProfile;
  initial_patient_utterance: string;
  follow_up_dialogue: DialogueTurn[];
  expected_disposition: ExpectedDisposition;
  expected_escalation: string;
  emergency_number_context?: string;
  required_clinical_questions: string[];
  required_red_flags: string[];
  contraindicated_advice: string[];
  critical_omissions_checklist: string[];
  clinical_uncertainty_and_limitations: string;
  clinical_guideline: ClinicalGuidelineReference;
  clinical_guideline_rationale: string;
  physician_reference_response: string;
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Validates a clinical scenario object against the computational framework schema.
 */
export function validateClinicalScenario(scenario: any): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  if (!scenario || typeof scenario !== 'object') {
    return { valid: false, issues: [{ field: 'root', message: 'Scenario must be an object', severity: 'error' }] };
  }

  // Scenario ID
  if (!scenario.scenario_id || typeof scenario.scenario_id !== 'string') {
    issues.push({ field: 'scenario_id', message: 'scenario_id is required', severity: 'error' });
  }

  // Provenance
  const prov = scenario.provenance;
  if (!prov || typeof prov !== 'object') {
    issues.push({ field: 'provenance', message: 'provenance object is required', severity: 'error' });
  } else {
    const validProvenanceTypes: ProvenanceType[] = [
      'synthetic_authored',
      'synthetic_derived',
      'public_dataset',
      'real_deidentified',
    ];
    if (!validProvenanceTypes.includes(prov.provenance_type)) {
      issues.push({
        field: 'provenance.provenance_type',
        message: `Invalid provenance_type. Must be one of: ${validProvenanceTypes.join(', ')}`,
        severity: 'error',
      });
    }

    const validAuthorshipTypes: AuthorshipType[] = [
      'clinician_authored',
      'researcher_authored',
      'ai_assisted_draft',
    ];
    if (!validAuthorshipTypes.includes(prov.authorship_type)) {
      issues.push({
        field: 'provenance.authorship_type',
        message: `Invalid authorship_type. Must be one of: ${validAuthorshipTypes.join(', ')}`,
        severity: 'error',
      });
    }

    const validReviewStatus = ['pending_clinical_review', 'clinician_verified', 'adjudicated'];
    if (!validReviewStatus.includes(prov.review_status)) {
      issues.push({
        field: 'provenance.review_status',
        message: `Invalid review_status. Must be one of: ${validReviewStatus.join(', ')}`,
        severity: 'error',
      });
    }

    // Safety governance rule: Never assert deidentification on synthetic data
    if (
      (prov.provenance_type === 'synthetic_authored' || prov.provenance_type === 'synthetic_derived') &&
      'deidentification_verified' in prov
    ) {
      issues.push({
        field: 'provenance.deidentification_verified',
        message: 'Synthetic scenarios must not contain deidentification_verified claims (scientifically invalid).',
        severity: 'error',
      });
    }

    if (!prov.author || typeof prov.author !== 'string') {
      issues.push({ field: 'provenance.author', message: 'author is required', severity: 'error' });
    }
    if (!prov.clinical_reviewer || typeof prov.clinical_reviewer !== 'string') {
      issues.push({ field: 'provenance.clinical_reviewer', message: 'clinical_reviewer is required', severity: 'error' });
    }
  }

  // Domain & Acuity
  const validDomains: ClinicalDomain[] = [
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
  if (!validDomains.includes(scenario.domain)) {
    issues.push({ field: 'domain', message: `Invalid clinical domain: ${scenario.domain}`, severity: 'error' });
  }

  const validAcuity: AcuityLevel[] = ['emergent', 'urgent', 'routine'];
  if (!validAcuity.includes(scenario.acuity)) {
    issues.push({ field: 'acuity', message: `Invalid acuity: ${scenario.acuity}`, severity: 'error' });
  }

  const validDispositions: ExpectedDisposition[] = [
    'emergency_department_or_ambulance',
    'emergency_department_or_911',
    'urgent_medical_evaluation',
    'urgent_care_same_day',
    'primary_care_routine',
    'self_care_home_monitoring',
  ];
  if (!validDispositions.includes(scenario.expected_disposition)) {
    issues.push({
      field: 'expected_disposition',
      message: `Invalid expected_disposition: ${scenario.expected_disposition}. Must be one of: ${validDispositions.join(', ')}`,
      severity: 'error',
    });
  }

  // Patient profile
  const profile = scenario.patient_profile;
  if (!profile || typeof profile !== 'object') {
    issues.push({ field: 'patient_profile', message: 'patient_profile is required', severity: 'error' });
  } else {
    if (typeof profile.age !== 'number' || profile.age < 0 || profile.age > 125) {
      issues.push({ field: 'patient_profile.age', message: 'Valid age is required', severity: 'error' });
    }
    if (!Array.isArray(profile.comorbidities)) {
      issues.push({ field: 'patient_profile.comorbidities', message: 'comorbidities must be an array', severity: 'error' });
    }
    if (!Array.isArray(profile.active_medications)) {
      issues.push({ field: 'patient_profile.active_medications', message: 'active_medications must be an array', severity: 'error' });
    }
  }

  // Utterance & Reference
  if (!scenario.initial_patient_utterance || typeof scenario.initial_patient_utterance !== 'string' || scenario.initial_patient_utterance.trim().length === 0) {
    issues.push({ field: 'initial_patient_utterance', message: 'initial_patient_utterance cannot be empty', severity: 'error' });
  }
  if (!scenario.physician_reference_response || typeof scenario.physician_reference_response !== 'string' || scenario.physician_reference_response.trim().length === 0) {
    issues.push({ field: 'physician_reference_response', message: 'physician_reference_response cannot be empty', severity: 'error' });
  }

  // Clinical guideline reference
  const guide = scenario.clinical_guideline;
  if (!guide || typeof guide !== 'object') {
    issues.push({ field: 'clinical_guideline', message: 'clinical_guideline object is required', severity: 'error' });
  } else {
    if (!guide.guideline_title || typeof guide.guideline_title !== 'string') {
      issues.push({ field: 'clinical_guideline.guideline_title', message: 'guideline_title is required', severity: 'error' });
    }
    if (!guide.issuing_organization || typeof guide.issuing_organization !== 'string') {
      issues.push({ field: 'clinical_guideline.issuing_organization', message: 'issuing_organization is required', severity: 'error' });
    }
    if (!guide.publication_year || typeof guide.publication_year !== 'number') {
      issues.push({ field: 'clinical_guideline.publication_year', message: 'publication_year is required (number)', severity: 'error' });
    }
    if (!guide.section_or_recommendation || typeof guide.section_or_recommendation !== 'string') {
      issues.push({ field: 'clinical_guideline.section_or_recommendation', message: 'section_or_recommendation is required', severity: 'error' });
    }
    if (!guide.clinical_jurisdiction || typeof guide.clinical_jurisdiction !== 'string') {
      issues.push({ field: 'clinical_guideline.clinical_jurisdiction', message: 'clinical_jurisdiction is required', severity: 'error' });
    }
  }

  // Structured Clinical Element Checklists
  if (!Array.isArray(scenario.required_clinical_questions) || scenario.required_clinical_questions.length === 0) {
    issues.push({ field: 'required_clinical_questions', message: 'required_clinical_questions must contain at least one question item', severity: 'error' });
  }
  if (!Array.isArray(scenario.required_red_flags) || scenario.required_red_flags.length === 0) {
    issues.push({ field: 'required_red_flags', message: 'required_red_flags must contain at least one red-flag item', severity: 'error' });
  }
  if (!Array.isArray(scenario.contraindicated_advice) || scenario.contraindicated_advice.length === 0) {
    issues.push({ field: 'contraindicated_advice', message: 'contraindicated_advice must contain at least one unsafe/contraindicated item', severity: 'error' });
  }
  if (!Array.isArray(scenario.critical_omissions_checklist) || scenario.critical_omissions_checklist.length === 0) {
    issues.push({ field: 'critical_omissions_checklist', message: 'critical_omissions_checklist must contain at least one checklist item', severity: 'error' });
  }
  if (!scenario.clinical_uncertainty_and_limitations || typeof scenario.clinical_uncertainty_and_limitations !== 'string') {
    issues.push({ field: 'clinical_uncertainty_and_limitations', message: 'clinical_uncertainty_and_limitations is required', severity: 'error' });
  }
  if (!scenario.clinical_guideline_rationale || typeof scenario.clinical_guideline_rationale !== 'string') {
    issues.push({ field: 'clinical_guideline_rationale', message: 'clinical_guideline_rationale is required', severity: 'error' });
  }

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  };
}
