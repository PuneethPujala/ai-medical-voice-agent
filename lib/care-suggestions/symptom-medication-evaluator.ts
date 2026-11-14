/**
 * SYMPTOM-SPECIFIC MEDICATION INFORMATION & CLINICAL SAFETY EVALUATOR
 *
 * Invariants:
 * 1. CLINICAL DECISION SUPPORT ONLY: Strictly non-prescriptive education. Never invent dosages,
 *    frequencies, durations, or administration routes.
 * 2. CLEAR CATEGORICAL SEPARATION: Formally separates:
 *    - Existing Patient Medications
 *    - Potential OTC Medication Education
 *    - Medication Safety and Precautions
 *    - Information Requiring Clinical Clarification
 * 3. NO "NO MEDICATIONS REPORTED" BLINDNESS: If a patient has reported symptoms (e.g. headache, fever,
 *    sore throat) but has not reported taking existing drugs, evaluates whether general OTC medication
 *    education is appropriate rather than dismissing the section.
 * 4. HEADACHE & SYMPTOM RED-FLAG GATING:
 *    - Evaluates headache red flags (thunderclap sudden onset, focal neurological deficits, fever with neck stiffness,
 *      post-head trauma).
 *    - If red flags or severe contraindications exist, OTC medication education is safely withheld and the rationale
 *      is clearly documented in clinical clarification.
 * 5. CONTRAINDICATION & ALLERGY ENFORCEMENT:
 *    - Aspirin prohibited in pediatric/adolescent patients (<19y) due to Reye's syndrome risk.
 *    - NSAIDs prohibited in peptic ulcer disease, active GI bleed, chronic kidney disease, 3rd trimester pregnancy,
 *      suspected dengue/thrombocytopenia, or known NSAID allergy.
 *    - Paracetamol (acetaminophen) prohibited in severe hepatic impairment, acute liver failure, or paracetamol allergy.
 * 6. UNCERTAINTY & FOLLOW-UP INQUIRIES: Formulates targeted follow-up questions and lists missing clinical telemetry.
 */

import { PatientProfile } from "@/lib/clinical-knowledge/types";
import { RedFlagResult } from "@/lib/triage/universal-red-flags";

export interface OtcMedicationEducationItem {
  genericName: string;
  tradeNames: string[];
  commonlyUsedFor: string;
  precautions: string[];
  contraindicationsAndInteractions: string[];
  approvalRequirement: string;
  source: string;
}

export interface ExistingMedicationsSection {
  reported: string[];
  verifiedFromProfile: string[];
  statusSummary: string;
}

export interface MedicationSafetySection {
  contraindicationsDetected: string[];
  safetyWarnings: string[];
  requiresClinicianApproval: boolean;
  generalPrecautions: string[];
}

export interface ClinicalClarificationSection {
  missingSafetyInformation: string[];
  followUpQuestions: string[];
  rationaleIfNoMedicationAppropriate?: string;
}

export interface EnhancedMedicationInformation {
  existingMedications: ExistingMedicationsSection;
  potentialOtcEducation: OtcMedicationEducationItem[];
  safetyAndPrecautions: MedicationSafetySection;
  clinicalClarification: ClinicalClarificationSection;

  // Backward compatibility fields
  items: Array<{
    name: string;
    genericName?: string;
    purpose?: string;
    relevantContext?: string;
    safetyWarnings?: string[];
    source?: string;
    requiresClinicianReview: boolean;
  }>;
  patientReportedMedications: string[];
  contraindicationsDetected: string[];
  safetyWarnings: string[];
  requiresClinicianApproval: boolean;
}

export interface SymptomEvaluationInput {
  conversationText: string;
  primaryConcern: string;
  patientProfile?: PatientProfile | null;
  reportedMedications?: string[];
  isEmergency?: boolean;
  isUrgent?: boolean;
  redFlagResult?: RedFlagResult;
  soapReport?: {
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
  } | null;
}

export class SymptomMedicationEvaluator {
  /**
   * Main evaluation method to generate symptom-specific medication information.
   */
  public static evaluate(input: SymptomEvaluationInput): EnhancedMedicationInformation {
    const text = `${input.conversationText} ${input.primaryConcern} ${input.soapReport?.subjective || ""} ${input.soapReport?.assessment || ""}`.toLowerCase();
    const profile = input.patientProfile;

    // ----------------------------------------------------
    // 1. RECONCILE EXISTING MEDICATIONS
    // ----------------------------------------------------
    const profileMeds = (profile?.currentMedications || []).map(
      (m: any) => `${m.name}${m.dose || m.dosage ? ` (${m.dose || m.dosage})` : ""}${m.frequency ? ` - ${m.frequency}` : ""}`
    );

    const explicitlyReported = input.reportedMedications || [];
    const allReportedMeds = Array.from(new Set([...profileMeds, ...explicitlyReported])).filter(Boolean);

    let statusSummary = "";
    if (allReportedMeds.length > 0) {
      statusSummary = `Patient has ${allReportedMeds.length} active or reported medication(s). Continue current prescription therapies as directed until evaluated by an attending clinician.`;
    } else {
      statusSummary = "No active prescription or over-the-counter medications were reported by the patient during this encounter.";
    }

    const existingSection: ExistingMedicationsSection = {
      reported: allReportedMeds.length > 0 ? allReportedMeds : ["None reported during this consultation intake."],
      verifiedFromProfile: profileMeds.length > 0 ? profileMeds : ["No pre-existing medications recorded in electronic health profile."],
      statusSummary,
    };

    // ----------------------------------------------------
    // 2. DETECT PRESENTING SYMPTOMS
    // ----------------------------------------------------
    const hasHeadache = /\b(headache|migraine|head hurts|throbbing head|head pain|sir dard|tala noppi|tension headache|head pounding)\b/i.test(text);
    const hasFever = /\b(fever|high temperature|chills|shivering|feverish|bukhar|jwaram|febrile|pyrexia|sweating with fever)\b/i.test(text);
    const hasBodyAche = /\b(body ache|muscle ache|myalgia|joint pain|arthralgia|backache|neck ache|body soreness|badan dard)\b/i.test(text);
    const hasSoreThroat = /\b(sore throat|throat pain|hurts to swallow|odynophagia|pharyngitis|scratchy throat|gala dard|gala kharab)\b/i.test(text);
    const hasCough = /\b(cough|dry cough|wet cough|coughing|khansi|phlegm)\b/i.test(text);
    const hasHeartburn = /\b(heartburn|acid reflux|acidity|acid indigestion|gerd|burning in chest after food|sour burps|stomach acid)\b/i.test(text);
    const hasAllergies = /\b(runny nose|sneezing|allergic rhinitis|hay fever|stuffy nose|nasal congestion|itchy eyes|sinus congestion)\b/i.test(text);
    const hasMildDiarrhea = /\b(loose motion|loose stool|mild diarrhea|watery stool|dast)\b/i.test(text);

    // ----------------------------------------------------
    // 3. DETECT RED FLAGS & CLINICAL CONTRAINDICATIONS
    // ----------------------------------------------------
    const contraindicationsDetected: string[] = [];
    const missingSafetyInfo: string[] = [];
    const followUpQuestions: string[] = [];
    let rationaleIfNoMedicationAppropriate: string | undefined = undefined;

    // A. Headache-Specific Red Flags Screen
    const hasThunderclapOnset = /\b(thunderclap|worst headache|sudden severe|struck like lightning|instant(ly)? (peak|severe)|peaked in (seconds|1 min|a minute))\b/i.test(text);
    const hasNeurologicalDeficits = /\b(slurred speech|facial droop|one-sided weakness|numbness|paralysis|vision loss|double vision|confusion|trouble speaking|difficulty walking)\b/i.test(text);
    const hasMeningism = (/\b(stiff neck|neck stiffness|nuchal rigidity|chin to chest)\b/i.test(text) && (hasFever || /\b(fever|temperature)\b/i.test(text)));
    const hasHeadTrauma = /\b(head (injury|trauma|impact)|hit (my|the) head|fall|accident|concussion|blow to head)\b/i.test(text);
    const isHeadacheRedFlag = hasThunderclapOnset || hasNeurologicalDeficits || hasMeningism || hasHeadTrauma;

    if (hasHeadache && isHeadacheRedFlag) {
      const redFlagReasons: string[] = [];
      if (hasThunderclapOnset) redFlagReasons.push("instant sudden peak onset (thunderclap pattern)");
      if (hasNeurologicalDeficits) redFlagReasons.push("focal neurological deficits");
      if (hasMeningism) redFlagReasons.push("fever combined with nuchal rigidity / stiff neck");
      if (hasHeadTrauma) redFlagReasons.push("recent head impact / trauma");

      contraindicationsDetected.push(
        `Emergency neurovascular red flag identified (${redFlagReasons.join(", ")}). Routine OTC analgesics are contraindicated pending urgent in-person medical evaluation.`
      );
      rationaleIfNoMedicationAppropriate =
        `Due to identified red-flag features (${redFlagReasons.join(", ")}), over-the-counter analgesics must NOT be used as a primary solution. Immediate emergency neurovascular evaluation (112 / 108 / 911) is required to rule out intracranial hemorrhage, meningitis, or structural injury.`;

      missingSafetyInfo.push("Urgent neurovascular imaging (CT/MRI) and clinical neurological examination unassessed.");
      followUpQuestions.push("Did your headache reach maximum intensity within 60 seconds of starting?");
      followUpQuestions.push("Do you have any difficulty speaking, facial weakness, or vision loss?");
      followUpQuestions.push("Can you bend your chin down to touch your chest without severe neck pain?");
    }

    // B. Dengue / Bleeding Tendency Screen
    const hasDengueOrBleedingRisk = /\b(dengue|petechiae|purpura|bleeding gums|nosebleed|low platelets|thrombocytopenia|unexplained bruising)\b/i.test(text);
    if (hasDengueOrBleedingRisk) {
      contraindicationsDetected.push(
        "MoHFW / WHO Standard Protocol: NSAIDs (Ibuprofen, Naproxen, Aspirin, Diclofenac) are strictly prohibited due to severe bleeding and hemorrhagic dengue risk."
      );
    }

    // C. Gastrointestinal Ulcer / Bleeding Screen
    const hasGiUlcerOrBleed =
      /\b(ulcer|peptic ulcer|gastric ulcer|stomach ulcer|gi bleed|bleeding ulcer|vomiting blood|black tarry stool|melena|hematemesis)\b/i.test(text) ||
      (profile?.knownConditions || []).some((c) => /ulcer|bleed|gastritis/i.test(c));
    if (hasGiUlcerOrBleed) {
      contraindicationsDetected.push(
        "NSAIDs (Ibuprofen, Naproxen, Aspirin) are contraindicated due to active or prior gastrointestinal mucosal ulceration / bleeding risk."
      );
    }

    // D. Renal Impairment Screen
    const hasKidneyDisease =
      /\b(kidney failure|renal failure|ckd|chronic kidney|dialysis|high creatinine)\b/i.test(text) ||
      (profile?.knownConditions || []).some((c) => /kidney|renal|ckd/i.test(c));
    if (hasKidneyDisease) {
      contraindicationsDetected.push(
        "NSAIDs are contraindicated due to renal impairment and risk of acute kidney injury. Caution with magnesium-containing antacids."
      );
    }

    // E. Hepatic Impairment Screen
    const hasLiverDisease =
      /\b(liver failure|cirrhosis|hepatitis|jaundice|liver disease|hepatic impairment)\b/i.test(text) ||
      (profile?.knownConditions || []).some((c) => /liver|hepat|cirrhosis/i.test(c));
    if (hasLiverDisease) {
      contraindicationsDetected.push(
        "Paracetamol (Acetaminophen) is contraindicated or requires strict dose reduction due to documented liver disease / hepatic impairment."
      );
    }

    // F. Age Considerations (Aspirin & NSAIDs in Pediatrics)
    const patientAge = profile?.age;
    const isPediatric = patientAge !== undefined && patientAge < 19;
    if (isPediatric) {
      contraindicationsDetected.push(
        "Aspirin is strictly prohibited in patients under 19 years of age due to the risk of Reye's syndrome (fatal hepatic and cerebral encephalopathy)."
      );
    }

    // G. Pregnancy Screen
    const isPregnant =
      profile?.pregnancyStatus === "pregnant" ||
      /\b(pregnant|pregnancy|trimester)\b/i.test(text);
    if (isPregnant) {
      contraindicationsDetected.push(
        "NSAIDs are strictly contraindicated during pregnancy (particularly 3rd trimester) due to risk of premature closure of the fetal ductus arteriosus and oligohydramnios."
      );
    }

    // H. Drug Allergies
    const knownAllergies = (profile?.drugAllergies || []).map(
      (a) => (a as any).drugName || (a as any).allergen || ""
    );
    const hasParacetamolAllergy = knownAllergies.some((a) => /paracetamol|acetaminophen|tylenol|dolo|crocin|calpol/i.test(a));
    const hasNsaidAllergy = knownAllergies.some((a) => /nsaid|ibuprofen|aspirin|advil|brufen|combiflam|naproxen|diclofenac/i.test(a));

    if (hasParacetamolAllergy) {
      contraindicationsDetected.push("Paracetamol (Acetaminophen) is prohibited due to documented patient hypersensitivity.");
    }
    if (hasNsaidAllergy) {
      contraindicationsDetected.push("NSAIDs (Ibuprofen, Aspirin, Naproxen) are prohibited due to documented patient allergy.");
    }

    // Missing information assessment & contextual deduplication
    const hasAnsweredAllergies = profile?.drugAllergies && profile.drugAllergies.length > 0;
    const hasAnsweredOnset = text.includes("gradual") || text.includes("sudden") || text.includes("thunderclap") || text.includes("slowly") || text.includes("dheere");
    const hasAnsweredMedicalHistory = profile?.knownConditions && profile.knownConditions.length > 0;

    if (!hasAnsweredAllergies) {
      missingSafetyInfo.push("Complete drug allergy and adverse drug reaction history unverified.");
      followUpQuestions.push("Do you have any known allergies to paracetamol, ibuprofen, aspirin, or any other medications?");
    }
    if (hasHeadache && !hasAnsweredOnset) {
      missingSafetyInfo.push("Headache onset timeline (seconds vs gradual hours) unmeasured.");
      followUpQuestions.push("Did your headache start suddenly within seconds, or did it build up gradually?");
    }
    if (!hasGiUlcerOrBleed && !hasAnsweredMedicalHistory && (hasHeadache || hasFever || hasBodyAche)) {
      followUpQuestions.push("Do you have any history of stomach ulcers, acid reflux, or kidney disease?");
    }

    // Safety Invariant: If allergies or medical history are unverified, do not claim no contraindications exist
    if (!hasAnsweredAllergies || !hasAnsweredMedicalHistory) {
      contraindicationsDetected.push(
        "Contraindication status cannot be cleared: Comprehensive drug allergy history, current chronic medications, and renal/hepatic laboratory telemetry are unverified/unknown. Attending clinician review is required before starting any medication."
      );
    }

    // ----------------------------------------------------
    // 4. FORMULATE POTENTIAL OTC MEDICATION EDUCATION
    // ----------------------------------------------------
    const potentialOtcEducation: OtcMedicationEducationItem[] = [];

    // Check emergency override
    const isEmergency = input.isEmergency || input.redFlagResult?.level === "EMERGENCY_NOW";
    if (isEmergency && !rationaleIfNoMedicationAppropriate) {
      rationaleIfNoMedicationAppropriate =
        "Acute clinical emergency criteria detected. Emergency medical stabilization (112 / 108 / 911) takes precedence over all routine over-the-counter medication education.";
    }

    // Only provide OTC education if not contraindicated by emergency/red flags
    const canProvidePainFeverOtc =
      !isEmergency &&
      (!hasHeadache || !isHeadacheRedFlag);

    if (canProvidePainFeverOtc && (hasHeadache || hasFever || hasBodyAche)) {
      // Option 1: Paracetamol (Acetaminophen) - First line antipyretic & analgesic
      if (!hasParacetamolAllergy && !hasLiverDisease) {
        potentialOtcEducation.push({
          genericName: "Paracetamol (Acetaminophen)",
          tradeNames: ["Dolo 650", "Calpol", "Crocin", "Tylenol", "PCM"],
          commonlyUsedFor: "Temporary relief of mild-to-moderate headache, muscle aches, sore throat discomfort, and fever reduction",
          precautions: [
            "Individualized safe dosing parameters must be established by a physician or pharmacist based on your age, body weight, liver and kidney function, and concurrent therapies.",
            "Never exceed package-directed limits or combine with other products containing paracetamol/acetaminophen to protect liver function.",
            "Strictly avoid alcohol while taking paracetamol to prevent hepatotoxicity.",
          ],
          contraindicationsAndInteractions: [
            "Severe hepatic impairment, active acute hepatitis, or severe liver cirrhosis.",
            "Known hypersensitivity to paracetamol.",
            "Caution with concurrent warfarin (frequent high doses may augment anticoagulant effect).",
          ],
          approvalRequirement: "Requires evaluation by an attending clinician or pharmacist to determine appropriateness and individualized dosing parameters.",
          source: "MedlinePlus Outpatient Health Guidelines / U.S. National Library of Medicine / CDSCO India",
        });
      }

      // Option 2: Ibuprofen (NSAID) - Anti-inflammatory analgesic
      const canTakeNsaid =
        !hasNsaidAllergy &&
        !hasGiUlcerOrBleed &&
        !hasKidneyDisease &&
        !hasDengueOrBleedingRisk &&
        !isPregnant &&
        !isPediatric;

      if (canTakeNsaid) {
        potentialOtcEducation.push({
          genericName: "Ibuprofen",
          tradeNames: ["Advil", "Motrin", "Brufen"],
          commonlyUsedFor: "Temporary relief of inflammatory discomfort, tension headache, musculoskeletal aches, or fever",
          precautions: [
            "Individualized safe dosing parameters must be evaluated with a doctor or pharmacist based on your clinical history.",
            "Always take with food or milk to protect stomach lining and reduce gastric irritation.",
            "Use only for the shortest duration necessary; do not take concurrently with other NSAIDs (e.g. naproxen, diclofenac) or aspirin.",
          ],
          contraindicationsAndInteractions: [
            "Active peptic ulcer disease, gastric bleeding history, or severe gastrointestinal reflux.",
            "Severe chronic kidney disease or acute renal impairment.",
            "Pregnancy (especially 3rd trimester) due to risk of premature closure of ductus arteriosus.",
            "Suspected dengue fever or thrombocytopenia (bleeding risk).",
            "Interacts with oral anticoagulants, antihypertensives (ACE inhibitors/ARBs), and lithium.",
          ],
          approvalRequirement: "Must be discussed with a doctor or pharmacist prior to administration, particularly if you have cardiovascular, renal, or gastric conditions.",
          source: "U.S. FDA DailyMed & CDSCO Standard Treatment Guidelines",
        });
      }
    }

    // Option 3: Sore Throat Demulcents & Lozenges
    if (!isEmergency && hasSoreThroat) {
      potentialOtcEducation.push({
        genericName: "Sore Throat Lozenges / Warm Saline Gargle",
        tradeNames: ["Strepsils", "Cēpacol", "Vicks VapoDrops", "Salt Water Gargle"],
        commonlyUsedFor: "Temporary soothing of pharyngeal irritation, throat dryness, and painful swallowing",
        precautions: [
          "Dissolve lozenges slowly in the mouth; do not chew whole.",
          "Warm salt water rinses (1/2 tsp salt in warm water) can be used 3-4 times daily without systemic absorption risks.",
          "Avoid in young children who may present a choking hazard.",
        ],
        contraindicationsAndInteractions: [
          "Avoid lozenges with local anesthetics (e.g. benzocaine) if you have documented local anesthetic allergies.",
        ],
        approvalRequirement: "Consult a clinician if throat pain is severe, accompanied by difficulty opening mouth (trismus), drooling, or high fever.",
        source: "MedlinePlus Clinical Guide for Pharyngitis",
      });
    }

    // Option 4: Heartburn / Acid Reflux (Antacids)
    if (!isEmergency && hasHeartburn) {
      const canTakeAntacid = !hasKidneyDisease;
      potentialOtcEducation.push({
        genericName: "Antacids (Calcium carbonate / Magnesium hydroxide / Aluminum hydroxide)",
        tradeNames: ["Tums", "Gelusil", "Digene", "Mylanta"],
        commonlyUsedFor: "Rapid, temporary relief of episodic heartburn, acid indigestion, and sour stomach",
        precautions: [
          "Separate administration from other prescription medications by at least 1-2 hours to prevent binding and impaired absorption.",
          "Not intended for continuous, chronic use exceeding 2 weeks without physician evaluation.",
        ],
        contraindicationsAndInteractions: [
          canTakeAntacid
            ? "Caution in severe renal impairment (magnesium/aluminum accumulation risk)."
            : "Renal impairment: Avoid magnesium-containing antacids without nephrologist approval.",
          "Interacts with tetracyclines, fluoroquinolones, and iron supplements via chelation.",
        ],
        approvalRequirement: "Consult a healthcare provider if heartburn occurs more than twice weekly or is accompanied by difficulty swallowing or unexplained weight loss.",
        source: "MedlinePlus / U.S. National Library of Medicine",
      });
    }

    // Option 5: Allergic Rhinitis (Second-Generation Antihistamines)
    if (!isEmergency && hasAllergies) {
      potentialOtcEducation.push({
        genericName: "Cetirizine / Loratadine (Second-Generation Antihistamine)",
        tradeNames: ["Zyrtec", "Claritin", "Cetzine", "Alerid"],
        commonlyUsedFor: "Relief of sneezing, runny nose, itchy watery eyes, and allergic rhinitis symptoms",
        precautions: [
          "Second-generation antihistamines are less sedating than first-generation, but mild drowsiness may still occur; use caution when driving.",
          "Avoid concurrent alcohol consumption.",
        ],
        contraindicationsAndInteractions: [
          "Severe end-stage renal disease requires dose adjustment.",
          "Known hypersensitivity to cetirizine, hydroxyzine, or loratadine.",
        ],
        approvalRequirement: "Review with a physician or pharmacist, particularly for elderly patients or individuals with renal insufficiency.",
        source: "MedlinePlus Antihistamine Guidance",
      });
    }

    // If symptoms were present, but no OTC education could be approved:
    if (potentialOtcEducation.length === 0 && !rationaleIfNoMedicationAppropriate) {
      if (contraindicationsDetected.length > 0) {
        rationaleIfNoMedicationAppropriate =
          `Over-the-counter medication education is withheld due to identified clinical contraindications: ${contraindicationsDetected.join(" ")} Attending clinician review is required before starting any medication.`;
      } else {
        rationaleIfNoMedicationAppropriate =
          "No specific over-the-counter pharmacological therapy is clinically indicated for the reported symptoms without in-person physical assessment.";
      }
    }

    // ----------------------------------------------------
    // 5. SAFETY & PRECAUTIONS SECTION
    // ----------------------------------------------------
    const safetySection: MedicationSafetySection = {
      contraindicationsDetected: Array.from(new Set(contraindicationsDetected)),
      safetyWarnings: [
        "MedVoice AI does not autonomously prescribe, dose, or dispense pharmaceuticals.",
        "Never alter, skip, or discontinue prescribed chronic therapies without direct physician authorization.",
        "Always inspect package labels to avoid accidental duplicate active ingredients (such as multiple paracetamol-containing products).",
        "Over-the-counter remedies provide symptom relief only and do not replace definitive treatment for underlying clinical conditions.",
      ],
      requiresClinicianApproval: true,
      generalPrecautions: [
        "Store all medications securely in a dry place out of reach of children.",
        "Discontinue use immediately and seek urgent medical evaluation if you experience swelling of the face/lips, difficulty breathing, or a widespread rash.",
      ],
    };

    // ----------------------------------------------------
    // 6. CLINICAL CLARIFICATION SECTION
    // ----------------------------------------------------
    const clarificationSection: ClinicalClarificationSection = {
      missingSafetyInformation: Array.from(new Set(missingSafetyInfo)),
      followUpQuestions: Array.from(new Set(followUpQuestions)),
      rationaleIfNoMedicationAppropriate,
    };

    // ----------------------------------------------------
    // 7. BACKWARD COMPATIBILITY ITEMS
    // ----------------------------------------------------
    const legacyItems = potentialOtcEducation.map((otc) => ({
      name: otc.genericName,
      genericName: otc.genericName,
      purpose: otc.commonlyUsedFor,
      relevantContext: `${otc.precautions[0]} ${otc.approvalRequirement}`,
      safetyWarnings: [...otc.precautions, ...otc.contraindicationsAndInteractions],
      source: otc.source,
      requiresClinicianReview: true,
    }));

    // Also include reported medications in legacy items if present
    if (allReportedMeds.length > 0) {
      allReportedMeds.forEach((med) => {
        legacyItems.unshift({
          name: med,
          genericName: med,
          purpose: "Patient-reported active therapy",
          relevantContext: "Patient reports currently taking this medication; requires clinician reconciliation.",
          safetyWarnings: ["Prescribed medication: do not alter dose without doctor consultation."],
          source: "Patient Medical History",
          requiresClinicianReview: true,
        });
      });
    }

    return {
      existingMedications: existingSection,
      potentialOtcEducation,
      safetyAndPrecautions: safetySection,
      clinicalClarification: clarificationSection,

      // Legacy compatibility
      items: legacyItems,
      patientReportedMedications: allReportedMeds,
      contraindicationsDetected: safetySection.contraindicationsDetected,
      safetyWarnings: safetySection.safetyWarnings,
      requiresClinicianApproval: true,
    };
  }
}
