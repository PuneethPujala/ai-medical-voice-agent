/**
 * MedVoice Study 3 Deterministic Scenario-to-Payload Transformer
 *
 * Implements deterministic transformation T_payload:
 * Converts a scenario blueprint JSON into the standardized runtime evaluation payload
 * provided to both MedVoice and comparator systems under strict matched-information parity.
 *
 * Enforces:
 * 1. Exact key-by-key property mapping.
 * 2. Range and type validation on all vital signs.
 * 3. Structured allergy status ('none_known' vs 'known' vs 'unknown_not_documented').
 * 4. Injection of shared clinical context (care_setting, jurisdiction).
 * 5. Strict quarantine/exclusion of ground-truth rubrics and ESI labels.
 */

export interface ScenarioVitalSigns {
  heart_rate_bpm: number;
  blood_pressure_mmhg: string;
  respiratory_rate_bpm: number;
  spo2_percent: number;
  temperature_celsius: number;
}

export interface ScenarioAllergies {
  status: 'none_known' | 'known' | 'unknown_not_documented';
  details: string[];
}

export interface ScenarioPatientProfile {
  biological_sex: 'female' | 'male' | 'other';
  age: number;
  comorbidities: string[];
  active_medications: string[];
  allergies: ScenarioAllergies;
  vital_signs: ScenarioVitalSigns;
}

export interface ScenarioBlueprint {
  scenario_id: string;
  domain: string;
  care_setting: 'emergency_department' | 'outpatient';
  urgency_tier: 'emergent' | 'urgent' | 'routine';
  esi_level: 1 | 2 | 3 | 4 | 5 | null;
  age_group?: string;
  presentation_type?: string;
  comorbidity_complexity?: string;
  patient_profile: ScenarioPatientProfile;
  chief_complaint: string;
  consolidated_vignette: string;
  missing_information_challenge_archival?: string;
  required_red_flags?: string[];
  critical_omissions?: string[];
  contraindicated_advice?: string[];
  guideline_derived_evaluation_reference?: any;
  emergency_routing_standard?: string;
  provenance?: any;
}

export interface RuntimeEvaluationPayload {
  chief_complaint: string;
  consolidated_history: string;
  vital_signs: {
    heart_rate: number;
    blood_pressure: string;
    respiratory_rate: number;
    spo2: number;
    temperature: number;
  };
  patient_demographics: {
    age: number;
    biological_sex: 'female' | 'male' | 'other';
    comorbidities: string[];
    active_medications: string[];
    allergies: {
      status: 'none_known' | 'known' | 'unknown_not_documented';
      details: string[];
    };
  };
  clinical_context: {
    care_setting: 'emergency_department' | 'outpatient';
    jurisdiction: {
      country: string;
      emergency_dispatch_system: string;
    };
  };
}

export class ScenarioTransformationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenarioTransformationError';
  }
}

const BP_REGEX = /^\d{2,3}\/\d{2,3}$/;

/**
 * Validates vital signs ranges and formats.
 */
export function validateVitalSigns(vitals: ScenarioVitalSigns): void {
  if (!vitals || typeof vitals !== 'object') {
    throw new ScenarioTransformationError('Missing or invalid vital_signs object.');
  }

  if (
    !Number.isInteger(vitals.heart_rate_bpm) ||
    vitals.heart_rate_bpm < 20 ||
    vitals.heart_rate_bpm > 260
  ) {
    throw new ScenarioTransformationError(
      `heart_rate_bpm out of valid physiological range (20-260 bpm): ${vitals.heart_rate_bpm}`
    );
  }

  if (typeof vitals.blood_pressure_mmhg !== 'string' || !BP_REGEX.test(vitals.blood_pressure_mmhg)) {
    throw new ScenarioTransformationError(
      `blood_pressure_mmhg format invalid (expected SBP/DBP, e.g. 120/80): ${vitals.blood_pressure_mmhg}`
    );
  }

  if (
    !Number.isInteger(vitals.respiratory_rate_bpm) ||
    vitals.respiratory_rate_bpm < 4 ||
    vitals.respiratory_rate_bpm > 60
  ) {
    throw new ScenarioTransformationError(
      `respiratory_rate_bpm out of valid physiological range (4-60 bpm): ${vitals.respiratory_rate_bpm}`
    );
  }

  if (
    !Number.isInteger(vitals.spo2_percent) ||
    vitals.spo2_percent < 50 ||
    vitals.spo2_percent > 100
  ) {
    throw new ScenarioTransformationError(
      `spo2_percent out of valid range (50-100%): ${vitals.spo2_percent}`
    );
  }

  if (
    typeof vitals.temperature_celsius !== 'number' ||
    isNaN(vitals.temperature_celsius) ||
    vitals.temperature_celsius < 30.0 ||
    vitals.temperature_celsius > 45.0
  ) {
    throw new ScenarioTransformationError(
      `temperature_celsius out of valid range (30.0-45.0 °C): ${vitals.temperature_celsius}`
    );
  }
}

/**
 * Validates allergies object.
 */
export function validateAllergies(allergies: ScenarioAllergies): void {
  if (!allergies || typeof allergies !== 'object') {
    throw new ScenarioTransformationError('Missing allergies object.');
  }

  const validStatuses = ['none_known', 'known', 'unknown_not_documented'];
  if (!validStatuses.includes(allergies.status)) {
    throw new ScenarioTransformationError(
      `Invalid allergies.status: '${allergies.status}'. Expected one of: ${validStatuses.join(', ')}`
    );
  }

  if (!Array.isArray(allergies.details)) {
    throw new ScenarioTransformationError('allergies.details must be an array of strings.');
  }

  if (allergies.status === 'known' && allergies.details.length === 0) {
    throw new ScenarioTransformationError(
      'allergies.status is "known" but details array is empty.'
    );
  }
}

/**
 * Transforms a scenario blueprint into the runtime evaluation payload.
 * Strictly strips all ground truth rubrics, ESI levels, and internal metadata.
 */
export function transformScenarioToPayload(scenario: ScenarioBlueprint): RuntimeEvaluationPayload {
  if (!scenario || typeof scenario !== 'object') {
    throw new ScenarioTransformationError('Invalid scenario: must be a non-null object.');
  }

  if (!scenario.chief_complaint || typeof scenario.chief_complaint !== 'string') {
    throw new ScenarioTransformationError('Scenario must contain a non-empty chief_complaint.');
  }

  if (!scenario.consolidated_vignette || typeof scenario.consolidated_vignette !== 'string') {
    throw new ScenarioTransformationError('Scenario must contain a non-empty consolidated_vignette.');
  }

  const profile = scenario.patient_profile;
  if (!profile || typeof profile !== 'object') {
    throw new ScenarioTransformationError('Scenario must contain a valid patient_profile.');
  }

  validateVitalSigns(profile.vital_signs);
  validateAllergies(profile.allergies);

  if (scenario.care_setting !== 'emergency_department' && scenario.care_setting !== 'outpatient') {
    throw new ScenarioTransformationError(
      `Invalid care_setting: '${scenario.care_setting}'. Expected 'emergency_department' or 'outpatient'.`
    );
  }

  const payload: RuntimeEvaluationPayload = {
    chief_complaint: scenario.chief_complaint,
    consolidated_history: scenario.consolidated_vignette,
    vital_signs: {
      heart_rate: profile.vital_signs.heart_rate_bpm,
      blood_pressure: profile.vital_signs.blood_pressure_mmhg,
      respiratory_rate: profile.vital_signs.respiratory_rate_bpm,
      spo2: profile.vital_signs.spo2_percent,
      temperature: profile.vital_signs.temperature_celsius,
    },
    patient_demographics: {
      age: profile.age,
      biological_sex: profile.biological_sex,
      comorbidities: Array.isArray(profile.comorbidities) ? [...profile.comorbidities] : [],
      active_medications: Array.isArray(profile.active_medications) ? [...profile.active_medications] : [],
      allergies: {
        status: profile.allergies.status,
        details: [...profile.allergies.details],
      },
    },
    clinical_context: {
      care_setting: scenario.care_setting,
      jurisdiction: {
        country: 'IND',
        emergency_dispatch_system: 'national_integrated_112_and_108',
      },
    },
  };

  return payload;
}
