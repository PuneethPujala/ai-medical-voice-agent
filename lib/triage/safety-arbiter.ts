import { z } from 'zod';
import {
  ClinicalFact,
  RedFlagDomainAssessment,
  reconcileConflictingFacts,
  getProvenanceRank,
} from './clinical-state';
import { PatientProfile, ContraindicationAlert } from '../clinical-knowledge/types';
import { evaluatePharmacologySafetyShield } from '../clinical-knowledge/safety-matrix';
import {
  evaluateUniversalRedFlags,
  RedFlagResult,
  UniversalScreenPatient,
} from './universal-red-flags';

/**
 * CLINICAL FEATURES SCHEMA
 * Structured representation of symptoms extracted from patient utterances and structured state.
 */
export const ClinicalFeaturesSchema = z.object({
  // Cardiovascular / Hemodynamic
  chestPain: z.boolean().default(false),
  pressureLikePain: z.boolean().default(false),
  radiationToArm: z.boolean().default(false),
  radiationToJaw: z.boolean().default(false),
  diaphoresis: z.boolean().default(false), // Cold sweats
  palpitations: z.boolean().default(false),
  syncopeOrDizziness: z.boolean().default(false),

  // Neurological (BE-FAST Criteria)
  facialDroop: z.boolean().default(false),
  armWeakness: z.boolean().default(false),
  speechDifficulty: z.boolean().default(false),
  suddenConfusion: z.boolean().default(false),
  thunderclapHeadache: z.boolean().default(false), // 'Worst headache of life'
  neckStiffness: z.boolean().default(false),
  lossOfConsciousness: z.boolean().default(false),

  // Respiratory / Airway
  severeDyspnea: z.boolean().default(false),
  stridor: z.boolean().default(false), // Upper airway obstruction
  cyanosis: z.boolean().default(false), // Blue lips/skin
  inabilityToSpeakFullSentences: z.boolean().default(false),
  wheezing: z.boolean().default(false),

  // Allergic / Anaphylaxis & Airway
  throatTightness: z.boolean().default(false),
  tongueSwelling: z.boolean().default(false),
  allergenExposure: z.boolean().default(false),
  deepNeckInfectionRisk: z.boolean().default(false),

  // Gastrointestinal / Acute Abdomen
  severeAbdominalPain: z.boolean().default(false),
  rigidAbdomen: z.boolean().default(false),
  rightLowerQuadrantPain: z.boolean().default(false),
  vomitingBloodOrMelena: z.boolean().default(false),
  severeDehydrationWithOrthostasis: z.boolean().default(false),

  // Pediatric & Systemic Sepsis
  pediatricPatient: z.boolean().default(false),
  highFever: z.boolean().default(false), // > 103 F / 39.4 C
  infantUnder3Months: z.boolean().default(false),
  lethargyOrInconsolable: z.boolean().default(false),

  // Low Acuity / Chronic / Routine
  mildCoughOrCold: z.boolean().default(false),
  localizedRashWithoutFever: z.boolean().default(false),
  minorSprainWithoutDeformity: z.boolean().default(false),
  prescriptionRefill: z.boolean().default(false),
});

export type ClinicalFeatures = z.infer<typeof ClinicalFeaturesSchema>;

export type MedVoiceUrgencyTier = 1 | 2 | 3 | 4 | 5;

export interface ArbiterResult {
  triageLevel: 'emergency' | 'priority' | 'routine';
  urgencyTier: MedVoiceUrgencyTier;
  tierTitle: string;
  esiScore: MedVoiceUrgencyTier; // Maintained as backward-compatible alias for existing tests and APIs
  esiTitle: string; // Maintained as backward-compatible alias for existing tests and APIs
  isEmergency: boolean;
  arbiterOverride: boolean; // True when deterministic arbiter overrode an unsafe suggestion
  redFlagsTriggered: string[];
  matchedRules: string[];
  clinicalProtocol: string;
  recommendedAction: string;
  icd10Codes: string[];
  detectedSymptoms: string[];
  unresolvedRedFlags: string[];
  isScreeningComplete: boolean;
  universalRedFlagResult?: RedFlagResult;
  contraindicationAlerts?: ContraindicationAlert[];
  provenanceSummary?: {
    highestProvenance: string;
    contradictionsResolved: number;
    resolvedOverrides?: string[];
  };
  latencyMs: number;
}

export interface SafetyArbiterStructuredInput {
  facts?: ClinicalFact[];
  establishedFacts?: ClinicalFact[];
  symptomProfile?: Record<string, any>;
  associatedSymptoms?: ClinicalFact[];
  redFlags?: Record<string, RedFlagDomainAssessment | any>;
  slots?: Record<string, any>;
  vitals?: Record<string, any>;
  provenanceEvidence?: any[];
}

export interface EvaluateSafetyArbiterOptions {
  features?: Partial<ClinicalFeatures>;
  rawText?: string;
  llmSuggestedLevel?: string;
  patientAge?: number;
  patientProfile?: PatientProfile;
  universalPatient?: UniversalScreenPatient;
  candidateAdvice?: string;
  structuredState?: SafetyArbiterStructuredInput;
  facts?: ClinicalFact[];
  redFlags?: Record<string, RedFlagDomainAssessment | any>;
  vitals?: Record<string, any>;
}

/**
 * Normalizes symptom/slot name into a standard comparable key.
 */
function normalizeSymptomKey(name: string): string {
  const clean = name.toLowerCase().trim().replace(/[\s-]/g, '_');
  if (/dysphagia|swallow|swallowing_difficulty/i.test(clean)) return 'swallowing_difficulty';
  if (/odynophagia|painful_swallowing/i.test(clean)) return 'odynophagia';
  if (/chest_pain|angina|precordial/i.test(clean)) return 'chest_pain';
  if (/chest_pressure|pressure_pain|crushing/i.test(clean)) return 'chest_pressure';
  if (/fever|temperature|pyrexia/i.test(clean)) return 'fever';
  if (/facial_droop|face_droop/i.test(clean)) return 'facial_droop';
  if (/arm_weakness|weak_arm|hemiparesis/i.test(clean)) return 'arm_weakness';
  if (/slurred_speech|speech_difficulty|dysarthria|aphasia/i.test(clean)) return 'speech_difficulty';
  if (/stridor|high_pitched_breathing/i.test(clean)) return 'stridor';
  if (/shortness_of_breath|dyspnea|difficulty_breathing/i.test(clean)) return 'severe_dyspnea';
  if (/vomiting_blood|hematemesis|melena/i.test(clean)) return 'vomiting_blood';
  if (/rigid_abdomen|board_like/i.test(clean)) return 'rigid_abdomen';
  if (/right_lower_quadrant|rlq|appendix/i.test(clean)) return 'rlq_pain';
  return clean;
}

/**
 * Parse temperature reading from value or text to detect high fever (>= 39.4 C / 103 F)
 */
function isHighFeverReading(val: any, text?: string): boolean {
  if (typeof val === 'number') {
    if (val >= 103) return true; // Fahrenheit
    if (val >= 39.4 && val <= 44) return true; // Celsius
  }
  const combined = `${val ?? ''} ${text ?? ''}`.toLowerCase();
  const matchF = combined.match(/\b(10[3-8](?:\.\d+)?)\s*(?:°|deg|f)?\b/);
  if (matchF && parseFloat(matchF[1]) >= 103) return true;
  const matchC = combined.match(/\b(39\.[4-9]|4[0-3](?:\.\d+)?)\s*(?:°|deg|c)?\b/);
  if (matchC && parseFloat(matchC[1]) >= 39.4) return true;
  return /high fever|burning up/i.test(combined);
}

/**
 * Consolidated structured evidence extractor.
 * Evaluates structured clinical facts with provenance hierarchy and contradiction resolution.
 */
function consolidateStructuredEvidence(
  structuredState?: SafetyArbiterStructuredInput,
  directFacts?: ClinicalFact[],
  directRedFlags?: Record<string, any>,
  directVitals?: Record<string, any>
): {
  featureOverrides: Partial<ClinicalFeatures>;
  deniedFeatures: Set<keyof ClinicalFeatures>;
  structuredRedFlags: string[];
  unresolvedRedFlags: string[];
  isScreeningComplete: boolean;
  contradictionOverrides: string[];
  highestProvenance: string;
  symptomsDetected: string[];
} {
  const featureOverrides: Partial<ClinicalFeatures> = {};
  const deniedFeatures: Set<keyof ClinicalFeatures> = new Set();
  const structuredRedFlags: string[] = [];
  const contradictionOverrides: string[] = [];
  const symptomsDetected: string[] = [];

  let maxProvenanceRank = 0;
  let highestProvenance = 'not_assessed';

  // 1. Gather all candidate facts
  const candidateFacts: ClinicalFact[] = [
    ...(directFacts || []),
    ...(structuredState?.facts || []),
    ...(structuredState?.establishedFacts || []),
    ...(structuredState?.associatedSymptoms || []),
  ];

  if (structuredState?.symptomProfile) {
    for (const [key, val] of Object.entries(structuredState.symptomProfile)) {
      if (val && typeof val === 'object' && val.name && val.status) {
        candidateFacts.push(val as ClinicalFact);
      }
    }
  }

  if (structuredState?.provenanceEvidence) {
    for (const item of structuredState.provenanceEvidence) {
      if (item && item.source) {
        candidateFacts.push({
          id: item.id || `prov-${Math.random().toString(36).substring(7)}`,
          name: item.id || item.type || 'unknown_evidence',
          label: item.label || item.description || '',
          category: 'associated_symptom',
          status: item.status === 'denied' || item.status === 'absent' ? 'absent' :
                  item.status === 'present' ? 'present' : 'unknown',
          value: item.value,
          normalizedText: item.description || '',
          confidence: item.confidence ?? 1.0,
          source: item.source,
          turnId: item.turnId ?? 1,
          timestamp: item.timestamp || new Date().toISOString(),
        });
      }
    }
  }

  // 2. Reconcile facts per normalized symptom slot
  const reconciledFacts = new Map<string, ClinicalFact>();
  for (const fact of candidateFacts) {
    const rank = getProvenanceRank(fact.source);
    if (rank > maxProvenanceRank) {
      maxProvenanceRank = rank;
      highestProvenance = fact.source;
    }

    const key = normalizeSymptomKey(fact.name);
    const existing = reconciledFacts.get(key);
    if (!existing) {
      reconciledFacts.set(key, fact);
    } else {
      const outcome = reconcileConflictingFacts(existing, fact);
      reconciledFacts.set(key, outcome.winner);
      if (outcome.hasContradiction && outcome.resolutionRationale) {
        contradictionOverrides.push(outcome.resolutionRationale);
      }
    }
  }

  // 3. Map winning facts to clinical features
  for (const [key, fact] of reconciledFacts.entries()) {
    const isPresent = fact.status === 'present';
    const isAbsent = fact.status === 'absent';

    switch (key) {
      case 'chest_pain':
        if (isPresent) {
          featureOverrides.chestPain = true;
          symptomsDetected.push(fact.label || 'Chest pain');
        } else if (isAbsent) {
          deniedFeatures.add('chestPain');
        }
        break;
      case 'chest_pressure':
        if (isPresent) {
          featureOverrides.pressureLikePain = true;
          featureOverrides.chestPain = true;
          symptomsDetected.push(fact.label || 'Crushing chest pressure');
        } else if (isAbsent) {
          deniedFeatures.add('pressureLikePain');
        }
        break;
      case 'radiation':
      case 'radiation_arm':
        if (isPresent) {
          const text = `${fact.value || ''} ${fact.normalizedText || ''}`.toLowerCase();
          if (text.includes('arm') || key === 'radiation_arm') {
            featureOverrides.radiationToArm = true;
            symptomsDetected.push('Radiation to arm');
          }
          if (text.includes('jaw') || text.includes('neck')) {
            featureOverrides.radiationToJaw = true;
            symptomsDetected.push('Radiation to jaw');
          }
        } else if (isAbsent) {
          deniedFeatures.add('radiationToArm');
          deniedFeatures.add('radiationToJaw');
        }
        break;
      case 'fever':
        if (isPresent) {
          if (isHighFeverReading(fact.value, fact.normalizedText)) {
            featureOverrides.highFever = true;
            symptomsDetected.push('High fever (>103°F / 39.4°C)');
          } else {
            symptomsDetected.push(fact.label || 'Fever');
          }
        } else if (isAbsent) {
          deniedFeatures.add('highFever');
        }
        break;
      case 'facial_droop':
        if (isPresent) {
          featureOverrides.facialDroop = true;
          symptomsDetected.push('Facial droop');
        } else if (isAbsent) {
          deniedFeatures.add('facialDroop');
        }
        break;
      case 'arm_weakness':
        if (isPresent) {
          featureOverrides.armWeakness = true;
          symptomsDetected.push('Unilateral arm weakness');
        } else if (isAbsent) {
          deniedFeatures.add('armWeakness');
        }
        break;
      case 'speech_difficulty':
        if (isPresent) {
          featureOverrides.speechDifficulty = true;
          symptomsDetected.push('Speech difficulty');
        } else if (isAbsent) {
          deniedFeatures.add('speechDifficulty');
        }
        break;
      case 'stridor':
        if (isPresent) {
          featureOverrides.stridor = true;
          symptomsDetected.push('Stridor / upper airway obstruction');
        } else if (isAbsent) {
          deniedFeatures.add('stridor');
        }
        break;
      case 'severe_dyspnea':
        if (isPresent) {
          featureOverrides.severeDyspnea = true;
          symptomsDetected.push('Severe dyspnea / shortness of breath');
        } else if (isAbsent) {
          deniedFeatures.add('severeDyspnea');
        }
        break;
      case 'swallowing_difficulty':
        if (isPresent) {
          featureOverrides.throatTightness = true;
          symptomsDetected.push('Inability to swallow / severe dysphagia');
        } else if (isAbsent) {
          deniedFeatures.add('throatTightness');
        }
        break;
      case 'vomiting_blood':
        if (isPresent) {
          featureOverrides.vomitingBloodOrMelena = true;
          symptomsDetected.push('Hematemesis / GI bleed');
        } else if (isAbsent) {
          deniedFeatures.add('vomitingBloodOrMelena');
        }
        break;
      case 'rigid_abdomen':
        if (isPresent) {
          featureOverrides.rigidAbdomen = true;
          symptomsDetected.push('Board-like abdominal rigidity');
        } else if (isAbsent) {
          deniedFeatures.add('rigidAbdomen');
        }
        break;
      case 'rlq_pain':
        if (isPresent) {
          featureOverrides.rightLowerQuadrantPain = true;
          symptomsDetected.push('Right lower quadrant pain');
        } else if (isAbsent) {
          deniedFeatures.add('rightLowerQuadrantPain');
        }
        break;
    }
  }

  // 4. Process structured red-flag domain assessments
  const combinedRedFlags: Record<string, any> = {
    ...(directRedFlags || {}),
    ...(structuredState?.redFlags || {}),
  };

  const coreDomains = ['airway', 'swallowing', 'breathing', 'cardiac', 'neurological', 'bleeding'];
  const unresolvedRedFlags: string[] = [];

  for (const domain of coreDomains) {
    const assessment = combinedRedFlags[domain];
    if (!assessment || !assessment.assessed || assessment.status === 'pending') {
      unresolvedRedFlags.push(domain);
      continue;
    }

    if (assessment.status === 'critical' || assessment.status === 'concerning') {
      structuredRedFlags.push(`STRUCTURED_${domain.toUpperCase()}_RED_FLAG`);
      if (domain === 'airway') {
        featureOverrides.stridor = true;
      } else if (domain === 'swallowing') {
        featureOverrides.throatTightness = true;
        if (assessment.status === 'critical') {
          featureOverrides.stridor = true;
        }
      } else if (domain === 'breathing') {
        featureOverrides.severeDyspnea = true;
      } else if (domain === 'cardiac') {
        featureOverrides.chestPain = true;
        featureOverrides.pressureLikePain = true;
      } else if (domain === 'neurological') {
        featureOverrides.facialDroop = true;
        featureOverrides.speechDifficulty = true;
      } else if (domain === 'bleeding') {
        featureOverrides.vomitingBloodOrMelena = true;
      }
    }
  }

  // 5. Process vitals (only if explicitly supplied; never fabricate)
  const combinedVitals: Record<string, any> = {
    ...(directVitals || {}),
    ...(structuredState?.vitals || {}),
  };

  if (combinedVitals.temp_c !== undefined || combinedVitals.temperature_c !== undefined || combinedVitals.temp !== undefined) {
    const rawT = combinedVitals.temp_c ?? combinedVitals.temperature_c ?? combinedVitals.temp;
    if (isHighFeverReading(rawT)) {
      featureOverrides.highFever = true;
      symptomsDetected.push(`High fever measured: ${rawT}`);
    }
  }
  if (combinedVitals.spo2 !== undefined || combinedVitals.pulse_ox !== undefined) {
    const spo2 = Number(combinedVitals.spo2 ?? combinedVitals.pulse_ox);
    if (!isNaN(spo2)) {
      if (spo2 < 90) {
        featureOverrides.severeDyspnea = true;
        symptomsDetected.push(`Severe hypoxia: SpO2 ${spo2}%`);
      }
      if (spo2 < 85) {
        featureOverrides.cyanosis = true;
        symptomsDetected.push(`Critical hypoxia/cyanosis: SpO2 ${spo2}%`);
      }
    }
  }

  const isScreeningComplete = unresolvedRedFlags.length === 0;

  return {
    featureOverrides,
    deniedFeatures,
    structuredRedFlags,
    unresolvedRedFlags,
    isScreeningComplete,
    contradictionOverrides,
    highestProvenance,
    symptomsDetected,
  };
}

/**
 * DETERMINISTIC FEATURE EXTRACTOR
 * Clinical regex-powered extraction with context-aware negation detection.
 */
export function extractClinicalFeatures(text: string, patientAge?: number): ClinicalFeatures {
  const lower = ' ' + text.toLowerCase() + ' ';

  // Checks pattern with robust negation, uncertainty, third-party attribution, and temporal resolution inspection
  const matchesPattern = (regex: RegExp): boolean => {
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
    const gRegex = new RegExp(regex.source, flags);
    let match: RegExpExecArray | null;
    let foundUnnegated = false;

    while ((match = gRegex.exec(lower)) !== null) {
      // 1. Preceding text up to punctuation / clause boundary
      const preceding = lower.substring(Math.max(0, match.index - 70), match.index);
      const lastBoundary = Math.max(
        preceding.lastIndexOf('.'),
        preceding.lastIndexOf(';'),
        preceding.lastIndexOf('!'),
        preceding.lastIndexOf('?'),
        preceding.lastIndexOf('\n'),
        preceding.lastIndexOf(' but ')
      );
      const effectivePreceding = lastBoundary !== -1 ? preceding.slice(lastBoundary) : preceding;

      // 2. Following text up to punctuation / clause boundary
      const matchEnd = match.index + match[0].length;
      const following = lower.substring(matchEnd, Math.min(lower.length, matchEnd + 80));
      const nextBoundaries = [
        following.indexOf('.'),
        following.indexOf(';'),
        following.indexOf('!'),
        following.indexOf('?'),
        following.indexOf('\n'),
      ].filter((idx) => idx !== -1);
      const nextBoundary = nextBoundaries.length > 0 ? Math.min(...nextBoundaries) : -1;
      const effectiveFollowing = nextBoundary !== -1 ? following.slice(0, nextBoundary) : following;

      // Check negation in preceding
      const isNegatedPreceding = /\b(no|not|never|never had|denies|denied|without|negative for|neither|none of|absence of|zero)\b/i.test(effectivePreceding);

      // Check uncertainty in preceding (e.g. "I don't know whether he has a fever", "uncertain if")
      const isUncertainPreceding = /\b(don't know|do not know|not sure|unknown|uncertain|unclear|wondering if|checking if|asked if)\b/i.test(effectivePreceding);

      // Check third-party attribution when caller reports for themselves (e.g. "I am feeling fine ... but my mother has chest pain")
      const callerReportsForSelf = /\b(i\s+am|i\s+have|i'?m|my\s+own|for\s+me)\b/i.test(lower);
      const isThirdPartyPreceding = callerReportsForSelf &&
        /\b(my (?:mother|father|mom|dad|wife|husband|friend|colleague|brother|sister|son|daughter)|someone else)\b/i.test(effectivePreceding) &&
        !/\b(we both|both of us|me too)\b/i.test(effectivePreceding);

      // Check resolution or negation in following (e.g. "chest pain yesterday, now resolved", "went away within 5 minutes", "100% fine", "is negative")
      const isResolvedFollowing = /\b(resolved|now resolved|went away|cleared up|completely gone|gone|stopped|no longer present|was yesterday.*?today.*?(?:fine|normal|ok)|100% (?:fine|normal|ok)|negative|none|absent|false)\b/i.test(effectiveFollowing);

      // Combined clause check for historical resolution (e.g. "had mild chest tightness yesterday... went away")
      const clauseContext = `${effectivePreceding} ${match[0]} ${effectiveFollowing}`;
      const isHistoricalResolved = /\b(yesterday|in the past|hours ago|days ago)\b/i.test(clauseContext) &&
        /\b(went away|resolved|disappeared|stopped|feels? 100% (?:normal|fine|ok)|today.*?(?:normal|fine|ok))\b/i.test(clauseContext);

      const isDisqualified = isNegatedPreceding || isUncertainPreceding || isThirdPartyPreceding || isResolvedFollowing || isHistoricalResolved;

      if (!isDisqualified) {
        foundUnnegated = true;
        break;
      }
    }
    return foundUnnegated;
  };

  const isPediatric = (patientAge !== undefined && patientAge <= 14) ||
    /\b(child|baby|infant|toddler|pediatric|my son|my daughter|newborn)\b|\b\d+\s*(months?|weeks?|years?)\s*old\b/i.test(lower);

  const hasChestPainOrPressure = matchesPattern(/(chest|precordial|substernal).*?(pain|pressure|tight|crush|weight|elephant|discomfort)|(pain|pressure|crush|tight|weight|elephant).*?(chest|precordium|substernal)/i);

  const features: ClinicalFeatures = {
    // Cardiovascular
    chestPain: hasChestPainOrPressure,
    pressureLikePain: matchesPattern(/crush|elephant|heavy weight|squeezing|tight band|intense pressure|tight pressure|pressure in (?:the )?(?:center|middle)|(severe|heavy|crushing)\s+(tight\s+)?(chest\s+)?pressure|(severe|intense)\s+(chest\s+)?tight/i),
    radiationToArm: matchesPattern(/(radiat|spread|travel).*?(arm|arms|shoulder)|(left|both).*?arm.*?(pain|numb|heav|ach)|(pain|heav).*?(down|in).*?(left|both).*?arm/i),
    radiationToJaw: matchesPattern(/(radiat|spread|travel).*?(jaw|neck|teeth)|(jaw|neck).*?(pain|ache|tight)/i),
    diaphoresis: matchesPattern(/sweat|diaphoresis|clammy|cold sweat/i),
    palpitations: matchesPattern(/heart.*?(rac|flutter|pound|skip)|palpitation|racing heart|irregular beat/i),
    syncopeOrDizziness: matchesPattern(/pass(ed)? out|black(ed)? out|faint|syncope|dizzy|lightheaded/i),

    // Neurological (BE-FAST Criteria)
    facialDroop: matchesPattern(/face.*?(droop|drop|asymmetr|crooked|numb)|(droop|crooked).*?(face|mouth|smile)|mouth.*?droop/i),
    armWeakness: matchesPattern(/(arm|hand|leg|limb).*?(weak|numb|heavy|cannot lift|unable to lift)|one-?sided weakness|hemiparesis/i),
    speechDifficulty: matchesPattern(/(speech|talk|words).*?(slur|garbl|troubl|cannot find|incoherent)|(slur|garbl).*?(speech|words)|aphasia|dysarthria/i),
    suddenConfusion: matchesPattern(/sudden confusion|disoriented|does not recognize|confused/i),
    thunderclapHeadache: matchesPattern(/worst headache|thunderclap|sudden explosive headache|head.*?explod/i),
    neckStiffness: matchesPattern(/stiff neck|nuchal rigidity|neck pain with fever/i),
    lossOfConsciousness: matchesPattern(/unresponsive|passed out|unconscious|cannot wake/i),

    // Respiratory
    severeDyspnea: matchesPattern(/cannot breathe|shortness of breath|gasping|suffocating|fighting for breath/i),
    stridor: matchesPattern(/stridor|high pitched breathing|choking sound|airway closing/i),
    cyanosis: matchesPattern(/blue lips|turning blue|cyanosis|fingertips blue/i),
    inabilityToSpeakFullSentences: matchesPattern(/cannot speak full sentences|words between breaths|struggling to speak/i),
    wheezing: matchesPattern(/wheez|asthma attack|bronchospasm|tight lungs/i),

    // Allergic / Anaphylaxis & Airway
    throatTightness: matchesPattern(/throat.*?(clos|tight|chok)|cannot swallow/i),
    tongueSwelling: matchesPattern(/swollen tongue|tongue.*?swell|lips.*?swell|facial swelling/i),
    allergenExposure: matchesPattern(/peanut|bee sting|wasp|shellfish|penicillin|allergic reaction/i),
    deepNeckInfectionRisk: (
      (matchesPattern(/muffled voice|hot potato voice|something in (?:my )?mouth|potato in (?:my )?mouth/i) || matchesPattern(/\bmuffled\b/i)) &&
      (matchesPattern(/swallowing saliva|painful to swallow saliva|saliva is really painful|spitting saliva|drooling|cannot swallow saliva/i) || matchesPattern(/\bsaliva\b/i))
    ),

    // Gastrointestinal
    severeAbdominalPain: matchesPattern(/severe stomach pain|excruciating abdominal|belly pain|stomach cramps/i),
    rigidAbdomen: matchesPattern(/hard as a (?:rock|board)|board[- ]?like|(?:rigid|hard).*?(?:board|belly|abdomen|stomach)|rigid (?:belly|abdomen|stomach)|guarding/i),
    rightLowerQuadrantPain: matchesPattern(/right lower|appendix|right side of stomach|lower right belly/i),
    vomitingBloodOrMelena: matchesPattern(/vomit(?:ing)?\s+(?:.*?\s+)?blood|coffee[- ]?ground\s+(?:emesis|vomit|blood)|black\s+tarry\s+stool|blood\s+in\s+stool/i),
    severeDehydrationWithOrthostasis: matchesPattern(/(?:loose\s+motions?|diarrhea|watery\s+stool|vomit\w*).*?(?:cannot\s+stand|barely\s+stand|unable\s+to\s+stand|collapse|pass(?:ed)?\s+out|faint)|(?:cannot\s+stand|barely\s+stand|unable\s+to\s+stand).*?(?:loose\s+motions?|diarrhea|watery\s+stool|vomit\w*)/i),

    // Pediatric
    pediatricPatient: isPediatric,
    highFever: matchesPattern(/103|104|105|high fever|burning up|fever of 39|fever of 40/i),
    infantUnder3Months: matchesPattern(/newborn|\b[1-8]\s*weeks?\s*old\b|\b[1-2]\s*months?\s*old\b|neonat/i),
    lethargyOrInconsolable: matchesPattern(/unusually sleepy|cannot wake|limp|inconsolable|will not stop crying|lethargic/i),

    // Low Acuity
    mildCoughOrCold: matchesPattern(/runny nose|mild cough|sneezing|scratchy throat|cold symptoms|congestion/i),
    localizedRashWithoutFever: matchesPattern(/mild rash|itchy spot|dry skin|eczema|dermatitis/i),
    minorSprainWithoutDeformity: matchesPattern(/twisted ankle|mild sprain|ankle hurts|wrist sprain/i),
    prescriptionRefill: matchesPattern(/refill|renew prescription|routine checkup|medication renewal/i),
  };

  return features;
}

/**
 * DETERMINISTIC SAFETY ARBITER
 * Pure rule-based clinical decision engine according to ESI v4.
 * Never delegates emergency/life-threat classification to a probabilistic model.
 */
export function evaluateSafetyArbiter(input: EvaluateSafetyArbiterOptions): ArbiterResult {
  const start = performance.now();

  // 1. Process structured clinical evidence
  const structuredEvidence = consolidateStructuredEvidence(
    input.structuredState,
    input.facts,
    input.redFlags,
    input.vitals
  );

  // 2. Build consolidated features: text regex + structured overrides
  const textFeatures = input.rawText ? extractClinicalFeatures(input.rawText, input.patientAge) : ({} as ClinicalFeatures);
  const mergedFeatures: Record<string, boolean> = { ...textFeatures };

  // Explicit structured denials override raw text regex matches
  for (const deniedKey of structuredEvidence.deniedFeatures) {
    mergedFeatures[deniedKey as string] = false;
  }

  // Explicit structured positives override text matches
  for (const [key, val] of Object.entries(structuredEvidence.featureOverrides)) {
    if (val !== undefined) {
      mergedFeatures[key] = Boolean(val);
    }
  }

  // Direct manual feature overrides (if supplied)
  if (input.features) {
    for (const [key, val] of Object.entries(input.features)) {
      if (val !== undefined) {
        mergedFeatures[key] = Boolean(val);
      }
    }
  }

  const features: ClinicalFeatures = ClinicalFeaturesSchema.parse(mergedFeatures);

  const redFlags: string[] = [...structuredEvidence.structuredRedFlags];
  const rules: string[] = [];
  const icd10: Set<string> = new Set();
  const symptoms: Set<string> = new Set(structuredEvidence.symptomsDetected);

  const rawTextLower = (input.rawText || '').toLowerCase();
  
  // Consume structured medication evidence from facts, provenance, and structured history
  const medSources: string[] = [rawTextLower];

  const allFacts = [
    ...(input.facts || []),
    ...(input.structuredState?.facts || []),
  ];
  for (const f of allFacts) {
    if (f.value !== undefined && f.value !== null) medSources.push(String(f.value).toLowerCase());
    if (f.normalizedText) medSources.push(String(f.normalizedText).toLowerCase());
    if (f.label) medSources.push(String(f.label).toLowerCase());
    if (f.name) medSources.push(String(f.name).toLowerCase());
  }

  const allProv = [
    ...(input.structuredState?.provenanceEvidence || []),
  ];
  for (const p of allProv) {
    if (p.value !== undefined && p.value !== null) medSources.push(String(p.value).toLowerCase());
    if (p.description) medSources.push(String(p.description).toLowerCase());
    if (p.label) medSources.push(String(p.label).toLowerCase());
  }

  const structuredHist = (input.structuredState as any)?.structuredHistory || (input.structuredState as any)?.history;
  if (structuredHist?.currentMedications && Array.isArray(structuredHist.currentMedications)) {
    medSources.push(...structuredHist.currentMedications.map((m: any) => String(m).toLowerCase()));
  }

  // Consume medications and allergies from structured patient profile if provided
  if (input.patientProfile) {
    if (input.patientProfile.currentMedications) {
      for (const m of input.patientProfile.currentMedications) {
        medSources.push(m.name.toLowerCase());
        if (m.brandName) medSources.push(m.brandName.toLowerCase());
      }
    }
  }

  const combinedMedText = medSources.join(' ');

  // Evaluate deterministic pharmacology safety shield (Allergies, DDIs, Teratogens)
  const pharmaShieldText = [combinedMedText, input.candidateAdvice || ''].join(' ').trim();
  const pharmaShieldResult = input.patientProfile
    ? evaluatePharmacologySafetyShield(input.patientProfile, pharmaShieldText)
    : { isSafe: true, alerts: [] as ContraindicationAlert[] };

  const hasNitratePde5Contraindication =
    (/sildenafil|viagra|tadalafil|cialis|vardenafil|levitra/i.test(combinedMedText)) &&
    (/nitroglycerin|nitrate|nitrostat|isordil|isosorbide/i.test(combinedMedText));

  let esiScore: 1 | 2 | 3 | 4 | 5 = 4; // Default baseline: Less Urgent
  let triageLevel: 'emergency' | 'priority' | 'routine' = 'routine';
  let esiTitle = 'ESI LEVEL 4: LESS URGENT — Routine Ambulatory Evaluation';
  let protocol = 'Standard outpatient clinical evaluation recommended within 24-48 hours.';
  let action = 'Schedule outpatient consultation or visit general urgent care.';

  // Build patient spec for presentation-independent universal red-flag screen
  const screenPatient: UniversalScreenPatient = input.universalPatient || {
    ageYears: input.patientAge ?? input.patientProfile?.age,
    pregnancy: input.patientProfile?.pregnancy
      ? {
          status: input.patientProfile.pregnancy.isPregnant ? "pregnant" : "not_pregnant",
          weeks: input.patientProfile.pregnancy.gestationalWeeks,
        }
      : undefined,
    modifiers: input.patientProfile?.conditions || [],
    drugAllergies: input.patientProfile?.allergies?.map(a => a.allergen) || [],
  };

  const universalRedFlagResult = evaluateUniversalRedFlags({
    rawText: input.rawText || '',
    cumulativeTranscript: (input.structuredState as any)?.cumulativeTranscript,
    patient: screenPatient,
    clinicalFacts: allFacts.map(f => (f as any).fact || f.normalizedText || f.label || f.name).filter(Boolean),
    deniedSymptoms: [
      ...Array.from(structuredEvidence.deniedFeatures).map(String),
      ...(structuredEvidence.deniedFeatures.has('chestPain') ? ['chest pain', 'chest tightness', 'chest'] : []),
    ],
  });

  if (universalRedFlagResult.level === "EMERGENCY_NOW") {
    for (const fired of universalRedFlagResult.firedRules) {
      if (!redFlags.includes(fired.ruleId)) redFlags.push(fired.ruleId);
      rules.push(`UNIVERSAL-RED-FLAG: ${fired.ruleId}`);
    }
  }

  // If a critical pharmacological contraindication or anaphylactic allergy is blocked by the shield
  if (!pharmaShieldResult.isSafe && pharmaShieldResult.alerts.length > 0) {
    for (const alert of pharmaShieldResult.alerts) {
      if (alert.actionRequired === 'block') {
        redFlags.push(`CRITICAL_CONTRAINDICATION_${alert.category.toUpperCase()}`);
        rules.push(`PHARMA-BLOCK: ${alert.category} - ${alert.clinicalRationale}`);
      }
    }
  }

  // =========================================================================
  // RULE 1: ESI TIER 1 - IMMEDIATE RESUSCITATION (Life-Threatening Collapse)
  // =========================================================================
  if (features.lossOfConsciousness || features.stridor || (features.throatTightness && features.tongueSwelling)) {
    esiScore = 1;
    triageLevel = 'emergency';
    esiTitle = 'ESI LEVEL 1: IMMEDIATE RESUSCITATION REQUIRED — Critical Airway / Hemodynamic Compromise';
    redFlags.push('IMMEDIATE_AIRWAY_OR_HEMODYNAMIC_COLLAPSE');
    rules.push('ESI-1.1: Airway obstruction / Unresponsive state / Anaphylactic shock');
    protocol = 'CRITICAL: Call 911 / 108 immediately. Prepare bag-valve-mask, IM Epinephrine 0.3mg if anaphylaxis, continuous cardiac telemetry.';
    action = 'Call 108 / 911 immediately for emergency medical transport. Do NOT drive self.';
    if (features.throatTightness || features.tongueSwelling) icd10.add('T78.2XXA'); // Anaphylaxis
    if (features.lossOfConsciousness) icd10.add('R55'); // Syncope / Unresponsive
    if (features.stridor) icd10.add('R06.1'); // Stridor
    symptoms.add('Loss of consciousness or severe airway obstruction');
  }

  // =========================================================================
  // RULE 2: ESI TIER 2 - ACUTE CORONARY SYNDROME / STEMI RISK & LETHAL CONTRAINDICATIONS
  // =========================================================================
  else if (
    ((features.chestPain || features.pressureLikePain) &&
    (features.radiationToArm || features.radiationToJaw || features.diaphoresis || features.pressureLikePain)) ||
    ((features.chestPain || features.pressureLikePain) && hasNitratePde5Contraindication)
  ) {
    esiScore = 2;
    triageLevel = 'emergency';
    if (hasNitratePde5Contraindication) {
      esiTitle = 'ESI LEVEL 2: EMERGENT — Lethal Pharmacotherapy Contraindication Protocol (Nitrates + PDE5 Inhibitors)';
      redFlags.push('LETHAL_DRUG_CONTRAINDICATION_NITRATE_PDE5');
      rules.push('ESI-2.1b: Lethal pharmacotherapy contraindication (Nitrates + PDE-5 inhibitors in acute chest pain)');
      protocol = 'CRITICAL CONTRAINDICATION: DO NOT ADMINISTER NITROGLYCERIN. High risk of refractory hypotension/cardiovascular collapse. Urgent 12-lead ECG, fluid resuscitation, telemetry.';
      action = 'Proceed immediately to the Emergency Department. Do NOT take nitroglycerin.';
      icd10.add('T46.3X5A');
      symptoms.add('Chest pressure with lethal nitrate/PDE5 drug contraindication');
    } else {
      esiTitle = 'ESI LEVEL 2: EMERGENT — Suspected Acute Coronary Syndrome (ACS) Protocol';
      redFlags.push('ACS_CHEST_PAIN_WITH_HIGH_RISK_RADIATION_OR_DIAPHORESIS');
      rules.push('ESI-2.1: High-risk ischemic cardiac features (Angina / STEMI equivalent)');
      protocol = 'Urgent 12-lead ECG within 10 minutes of ED arrival. Serial cardiac troponins. CHEWABLE ASPIRIN 325mg if no contraindication. Maintain SpO2 > 90%.';
      action = 'Proceed immediately to the nearest Emergency Department equipped with 24/7 Cardiac Cath Lab / PCI.';
      symptoms.add('Crushing substernal chest pressure');
    }
    icd10.add('I20.9'); // Angina pectoris
    icd10.add('I21.9'); // Acute myocardial infarction
    if (features.radiationToArm) symptoms.add('Pain radiating to left arm');
    if (features.diaphoresis) symptoms.add('Diaphoresis / cold sweats');
  }

  // =========================================================================
  // RULE 3: ESI TIER 2 - ACUTE STROKE / NEUROLOGICAL EMERGENCY (BE-FAST)
  // =========================================================================
  else if (features.facialDroop || features.armWeakness || features.speechDifficulty || features.thunderclapHeadache) {
    esiScore = 2;
    triageLevel = 'emergency';
    if (features.thunderclapHeadache) {
      esiTitle = 'ESI LEVEL 2: EMERGENT — Thunderclap Headache Protocol (Rule Out SAH)';
      redFlags.push('THUNDERCLAP_HEADACHE_SUBARACHNOID_HEMORRHAGE_RISK');
      rules.push('ESI-2.2B: Thunderclap onset headache (< 1 min to peak)');
      protocol = 'Immediate non-contrast head CT to rule out Subarachnoid Hemorrhage (SAH) or cerebral aneurysm rupture. Lumbar puncture if CT negative.';
      action = 'Urgent transfer to Comprehensive Stroke / Neurosurgical Emergency Department.';
      icd10.add('I60.9'); // Nontraumatic subarachnoid hemorrhage
      symptoms.add('Sudden explosive thunderclap headache');
    } else {
      esiTitle = 'ESI LEVEL 2: EMERGENT — Acute Neurological Deficit Protocol (BE-FAST Screen)';
      redFlags.push('BE_FAST_ACUTE_ISCHEMIC_STROKE_SYMPTOMS');
      rules.push('ESI-2.2A: Focal neurological deficit within acute thrombolytic window');
      protocol = 'Emergency Code Stroke activation. Non-contrast CT scan within 20 minutes. Evaluate for IV thrombolysis (tPA/TNK) and endovascular thrombectomy. NPO.';
      action = 'Call 108 / 911 immediately to request emergency ambulance transport to certified Primary Stroke Center.';
      icd10.add('I63.9'); // Cerebral infarction
      icd10.add('R47.01'); // Aphasia / Dysarthria
    }
    if (features.facialDroop) symptoms.add('Facial droop');
    if (features.armWeakness) symptoms.add('Unilateral arm weakness');
    if (features.speechDifficulty) symptoms.add('Speech slurring or difficulty');
  }

  // =========================================================================
  // RULE 4: ESI TIER 2 - SEVERE RESPIRATORY DISTRESS / ASTHMA HYPOXIA
  // =========================================================================
  else if (features.severeDyspnea || features.cyanosis || features.inabilityToSpeakFullSentences) {
    esiScore = 2;
    triageLevel = 'emergency';
    esiTitle = 'ESI LEVEL 2: EMERGENT — Acute Respiratory Compromise Protocol';
    redFlags.push('ACUTE_RESPIRATORY_FAILURE_RISK');
    rules.push('ESI-2.3: Severe dyspnea / inability to speak in sentences / hypoxia risk');
    protocol = 'Immediate high-flow oxygen, continuous pulse oximetry, nebulized Albuterol/Ipratropium, prepare for non-invasive positive pressure ventilation (BiPAP) if tiring.';
    action = 'Emergency department evaluation required immediately.';
    icd10.add('J96.00'); // Acute respiratory failure
    icd10.add('J45.901'); // Asthma exacerbation
    symptoms.add('Acute respiratory distress');
    if (features.cyanosis) symptoms.add('Cyanosis / peripheral hypoxia');
  }

  // =========================================================================
  // RULE 4b: ESI TIER 2 - PERITONSILLAR ABSCESS / DEEP NECK INFECTION AIRWAY THREAT
  // =========================================================================
  else if (features.deepNeckInfectionRisk || structuredHist?.provenanceEvidence?.some((p: any) => p.trigger_flags?.includes('PRE_FLAG_DEEP_NECK_INFECTION_OR_PTA'))) {
    esiScore = 2;
    triageLevel = 'emergency';
    esiTitle = 'ESI LEVEL 2: EMERGENT — Suspected Peritonsillar Abscess / Deep Neck Space Infection Protocol';
    redFlags.push('PERITONSILLAR_ABSCESS_OR_DEEP_NECK_INFECTION_RISK');
    rules.push('ESI-2.6: Muffled voice, severe saliva odynophagia, and fever with impending airway compromise risk');
    protocol = 'Urgent in-person ENT / Emergency Department evaluation today. Continuous airway monitoring, neck examination, parenteral analgesia and empiric IV antibiotics, evaluate for urgent needle drainage or surgical incision. Do not delay 24-48 hours.';
    action = 'Proceed immediately to the nearest Emergency Department or Urgent Care facility with on-call ENT specialists.';
    icd10.add('J36'); // Peritonsillar abscess
    icd10.add('J02.9'); // Acute pharyngitis
    symptoms.add('Muffled voice with severe saliva odynophagia and fever');
  }

  // =========================================================================
  // RULE 5: ESI TIER 2 - PEDIATRIC FEBRILE SEPSIS CRISIS
  // =========================================================================
  else if (features.pediatricPatient && (features.infantUnder3Months || (features.highFever && features.lethargyOrInconsolable))) {
    esiScore = 2;
    triageLevel = 'emergency';
    esiTitle = 'ESI LEVEL 2: EMERGENT — Pediatric Febrile / Lethargy Urgent Evaluation Protocol';
    redFlags.push('PEDIATRIC_LETHARGY_OR_NEONATAL_FEVER');
    rules.push('ESI-2.4: Pediatric pyrexia with altered behavior or neonatal age < 90 days');
    protocol = 'Full neonatal/pediatric sepsis workup: blood cultures, urinalysis/culture, rapid viral panel, prompt empiric antibiotic coverage.';
    action = 'Transport immediately to Pediatric Emergency Department or specialized Children\'s Hospital.';
    icd10.add('R50.9'); // Fever in pediatric patient
    icd10.add('A41.9'); // Sepsis unspecified risk
    symptoms.add('High pediatric fever');
    symptoms.add('Lethargy / Inconsolable crying');
  }

  // =========================================================================
  // RULE 6: ESI TIER 2 / 3 - ACUTE ABDOMEN / SURGICAL SUSPICION / PERITONITIS
  // =========================================================================
  else if (features.severeAbdominalPain || features.rightLowerQuadrantPain || features.rigidAbdomen || features.vomitingBloodOrMelena) {
    const isPeritonealEmergency = features.rigidAbdomen || features.vomitingBloodOrMelena ||
      (features.rightLowerQuadrantPain && (rawTextLower.includes('rebound') || rawTextLower.includes('severe') || rawTextLower.includes('guarding') || rawTextLower.includes('peritonitis') || features.highFever));
    esiScore = isPeritonealEmergency ? 2 : 3;
    triageLevel = esiScore === 2 ? 'emergency' : 'priority';
    esiTitle = esiScore === 2 ? 'ESI LEVEL 2: EMERGENT — Acute Surgical Abdomen / Hemorrhage Protocol' : 'ESI LEVEL 3: URGENT — Acute Abdominal Evaluation Protocol';
    if (isPeritonealEmergency) {
      redFlags.push('ACUTE_PERITONITIS_OR_SURGICAL_ABDOMEN');
      rules.push('ESI-2.5: Board-like abdominal rigidity, active hematemesis, or high-risk acute surgical abdomen / peritonitis');
      protocol = 'Two large-bore IVs, type and screen, urgent surgical consultation, NPO.';
      action = 'Immediate surgical emergency department transfer.';
      if (features.vomitingBloodOrMelena) icd10.add('K92.0'); // Hematemesis
      if (features.rigidAbdomen) icd10.add('R19.8'); // Rigid abdomen
      if (features.rightLowerQuadrantPain) {
        icd10.add('K35.80'); // Unspecified acute appendicitis
        icd10.add('R10.31'); // Right lower quadrant pain
      }
    } else {
      rules.push('ESI-3.1: Acute RLQ abdominal pain (Appendicitis risk) requiring multiple resources');
      protocol = 'Abdominal ultrasound / IV contrast CT scan, CBC with differential, surgical consult, serial abdominal exams.';
      action = 'Urgent emergency or surgical clinic evaluation within 2-4 hours.';
      icd10.add('K35.80'); // Unspecified acute appendicitis
      icd10.add('R10.31'); // Right lower quadrant pain
    }
    symptoms.add('Acute abdominal pain');
  }

  // =========================================================================
  // RULE 7: ESI TIER 3 - MODERATE ISOLATED SYSTEMIC SYMPTOMS
  // =========================================================================
  else if (features.chestPain || features.highFever || features.palpitations || features.severeDehydrationWithOrthostasis) {
    esiScore = 3;
    triageLevel = 'priority';
    esiTitle = features.severeDehydrationWithOrthostasis
      ? 'ESI LEVEL 3: URGENT — Acute Dehydration & Postural Compromise Protocol'
      : 'ESI LEVEL 3: URGENT — Cardiorespiratory / Febrile Diagnostic Workup';
    rules.push(features.severeDehydrationWithOrthostasis
      ? 'ESI-3.3: Acute volume depletion with functional orthostasis requiring urgent rehydration workup'
      : 'ESI-3.2: Significant clinical complaint requiring multiple diagnostic resources');
    protocol = features.severeDehydrationWithOrthostasis
      ? 'Urgent clinical evaluation today. Initiate oral rehydration solution (ORS). Assess orthostatic vitals, electrolytes, and renal function.'
      : 'Baseline diagnostic workup (ECG, vitals monitoring, focused lab panel).';
    action = features.severeDehydrationWithOrthostasis
      ? 'Urgent outpatient clinic or urgent care evaluation today for rehydration.'
      : 'Urgent clinical evaluation at an emergency clinic or urgent care facility today.';
    if (features.chestPain) icd10.add('R07.9'); // Chest pain unspecified
    if (features.highFever) icd10.add('R50.9'); // Fever unspecified
    if (features.palpitations) icd10.add('R00.2'); // Palpitations
    if (features.severeDehydrationWithOrthostasis) icd10.add('E86.0'); // Dehydration
    symptoms.add(features.severeDehydrationWithOrthostasis ? 'Acute gastroenteritis / diarrhea with severe postural weakness' : 'Cardiorespiratory or febrile symptom without immediate red-flags');
  }

  // =========================================================================
  // RULE 8: ESI TIER 4 & 5 - ROUTINE / MINOR OUTPATIENT
  // =========================================================================
  else {
    esiScore = features.prescriptionRefill ? 5 : 4;
    triageLevel = 'routine';
    esiTitle = esiScore === 5 ? 'ESI LEVEL 5: NON-URGENT — Supportive Care / Medication Refill' : 'ESI LEVEL 4: LESS URGENT — Routine Ambulatory Evaluation';
    rules.push(esiScore === 5 ? 'ESI-5.1: Zero resource medical refill or chronic maintenance' : 'ESI-4.1: Minor localized symptoms suitable for outpatient clinic');
    protocol = 'Routine ambulatory care evaluation. Supportive symptomatic care.';
    action = 'Schedule visit with primary care physician or walk-in outpatient clinic.';
    if (features.mildCoughOrCold) icd10.add('J06.9'); // Acute URI
    if (features.localizedRashWithoutFever) icd10.add('L30.9'); // Dermatitis
    if (features.minorSprainWithoutDeformity) icd10.add('S93.40'); // Ankle sprain
    if (features.prescriptionRefill) icd10.add('Z76.0'); // Repeat prescription
    symptoms.add('Mild non-emergent outpatient complaint');
  }

  // Missing information != negative information:
  // If baseline is routine but red-flag screening is incomplete, append clear clinical note
  if (!structuredEvidence.isScreeningComplete && structuredEvidence.unresolvedRedFlags.length > 0 && esiScore >= 4) {
    protocol += ` (Screening Note: Core red-flag domains [${structuredEvidence.unresolvedRedFlags.join(', ')}] remain pending/unassessed. Life-threats not definitively excluded until screening completes.)`;
  }

  // Universal Red-Flag Screen Escalation Guarantee
  const tier1UniversalRules = new Set([
    "UNI-AIR-01", "UNI-AIR-02", "UNI-AIR-03", "UNI-AIR-04",
    "UNI-CIR-01", "UNI-ALL-01", "UNI-PED-02", "UNI-TOX-01"
  ]);

  if (universalRedFlagResult.level === "EMERGENCY_NOW") {
    const isTier1 = universalRedFlagResult.firedRules.some(r => tier1UniversalRules.has(r.ruleId));
    if (isTier1) {
      esiScore = 1;
      triageLevel = 'emergency';
      esiTitle = 'ESI LEVEL 1: IMMEDIATE RESUSCITATION REQUIRED — Critical Airway / Physiological Compromise';
      protocol = 'CRITICAL: Call 112 / 108 immediately. Prepare bag-valve-mask, IM Epinephrine 0.3mg if anaphylaxis, continuous telemetry.';
      action = 'Call 112 / 108 immediately for emergency medical care. Do NOT drive self.';
      symptoms.add('Universal airway / physiological collapse red flag');
    } else if (esiScore > 2) {
      esiScore = 2;
      triageLevel = 'emergency';
      esiTitle = 'ESI LEVEL 2: EMERGENT — Universal Red Flag Triggered';
      protocol = 'URGENT: Emergency department evaluation required immediately. Call 112 / 108 or proceed to nearest ED.';
      action = 'Proceed immediately to the nearest Emergency Department. Call 112 / 108.';
      symptoms.add('Universal emergency red flag triggered: ' + universalRedFlagResult.firedRules.map(r => r.ruleId).join(', '));
    }
  } else if (universalRedFlagResult.level === "URGENT_SAME_DAY" && esiScore > 3) {
    esiScore = 3;
    triageLevel = 'priority';
    esiTitle = 'ESI LEVEL 3: URGENT — Same-Day Outpatient or Urgent Care Evaluation';
    action = 'Urgent outpatient consultation recommended today.';
  }

  // =========================================================================
  // SAFETY ARBITER OVERRIDE GUARANTEE
  // If an upstream model suggested 'routine' or 'priority' when red flags were
  // triggered, the Arbiter forcefully overrides it and logs the discrepancy.
  // =========================================================================
  const llmSuggested = input.llmSuggestedLevel?.toLowerCase();
  const isEmergency = esiScore <= 2;
  const arbiterOverride = Boolean(isEmergency && llmSuggested && llmSuggested !== 'emergency');

  const latencyMs = Number((performance.now() - start).toFixed(2));
  const tierTitle = esiTitle.replace(/^ESI LEVEL (\d+)/i, 'MEDVOICE TIER $1');

  return {
    triageLevel,
    urgencyTier: esiScore,
    tierTitle,
    esiScore,
    esiTitle,
    isEmergency,
    arbiterOverride,
    redFlagsTriggered: redFlags,
    matchedRules: rules,
    clinicalProtocol: protocol,
    recommendedAction: action,
    icd10Codes: Array.from(icd10),
    detectedSymptoms: Array.from(symptoms),
    unresolvedRedFlags: structuredEvidence.unresolvedRedFlags,
    isScreeningComplete: structuredEvidence.isScreeningComplete,
    universalRedFlagResult,
    contraindicationAlerts: pharmaShieldResult.alerts,
    provenanceSummary: {
      highestProvenance: structuredEvidence.highestProvenance,
      contradictionsResolved: structuredEvidence.contradictionOverrides.length,
      resolvedOverrides: structuredEvidence.contradictionOverrides,
    },
    latencyMs,
  };
}

