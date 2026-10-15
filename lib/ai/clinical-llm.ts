import crypto from "crypto";
import { groqClient, GroqChatMessage } from "./groq-client";
import { nvidiaClient, NvidiaChatMessage } from "./nvidia-client";
import { PreArbiterResult } from "../triage/pre-arbiter";
import { ClinicalInterviewState } from "../triage/conversation-manager";
import { DoctorProfile } from "@/config/doctors";
import { DEFAULT_LOCALE_CONFIG, LocaleConfig } from "../config/locale";
import {
  detectQuestionTargetSlot,
  validateDoctorReplyTarget,
} from "../triage/clinical-state";
import {
  CallerProfile,
  PatientProfile,
  CandidateFactProposal,
  ConversationalAction,
  ServerTurnTelemetry,
  calculateAgeFromDOB,
  ClinicalPassage,
} from "../clinical-knowledge/types";
import { clinicalKnowledgeRetriever } from "../clinical-knowledge/retriever";

export { validateDoctorReplyTarget };

export interface GenerateTurnOptions {
  patientUtterance: string;
  conversationHistory: Array<{ role: "patient" | "doctor" | "assistant"; text?: string; content?: string }>;
  interviewState?: ClinicalInterviewState;
  preArbiterResult: PreArbiterResult;
  demographics?: { age?: number | null; age_group: string; age_source?: string };
  doctor: DoctorProfile;
  missingDimensions?: string[];
  fallbackReply?: string;
  careNetworkSummary?: string;
  localeConfig?: LocaleConfig;
  callerProfile?: CallerProfile;
  patientProfile?: PatientProfile;
  targetSubject?: "self" | "mother" | "child" | "third_party";
  turnId?: number;
  onCandidateSafetyConcern?: (concern: string) => void;
  isClarificationRequest?: boolean;
  clarificationGuidance?: string;
}

export interface GeneratedTurnResult {
  reply: string;
  provider: "groq" | "nvidia" | "fallback" | "safety_arbiter_deterministic";
  responseProvenance: "llm_generative_dialogue" | "validated_fallback" | "deterministic_safety_arbiter";
  model?: string;
  latencyMs: number;
  rejectionReason?: string;
  fallbackReason?: string;
  liveGenerated: boolean;
  telemetry?: ServerTurnTelemetry;
  understoodContext?: string;
  conversationalAction?: ConversationalAction;
  candidateFacts?: CandidateFactProposal[];
  unmappedObservations?: string[];
  intendedTargets?: string[];
  candidateSafetyConcern?: string;
}

export const REASONING_LEAK_PATTERNS = [
  /\bwe have a patient\b/i,
  /\bthe patient has\b/i,
  /\bpatient\s+\d+\b/i,
  /\bneed to ask\b/i,
  /\balready asked\b/i,
  /\blet'?s think\b/i,
  /\bwe need to\b/i,
  /\bthe user asks\b/i,
  /\bhigh-yield question\b/i,
  /\bclinical state\b/i,
  /\bsystem prompt\b/i,
  /\bthought:\b/i,
  /\bthinking:\b/i,
  /\bscratchpad:\b/i,
  /\bword count:\b/i,
  /\bcount words\b/i,
  /\bensure \d+-\d+ words\b/i,
  /\bassistantresponse\b/i,
  /\bdiagnostic hypothesis\b/i,
  /\bdifferential diagnosis\b/i,
  /\bcould be tia\b/i,
  /\btia-shaped\b/i,
  /\bchecklist\b/i,
];

// ─── PROMPT INJECTION DEFENSE (UNTRUSTED INPUT DOCTRINE) ─────────────────────

export function detectAndNeutralizePromptInjection(rawText: string): {
  sanitizedText: string;
  injectionDetected: boolean;
  threatType?: string;
} {
  const injectionPatterns: Array<{ pattern: RegExp; type: string }> = [
    { pattern: /\bignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions\b/i, type: "instruction_override" },
    { pattern: /\bdisregard\s+(?:system|safety|clinical|all)\s+(?:rules|guidelines|prompts?)\b/i, type: "safety_bypass" },
    { pattern: /\boutput\s+(?:your\s+)?(?:system\s+prompt|developer\s+instructions)\b/i, type: "prompt_exfiltration" },
    { pattern: /\breveal\s+(?:confidential|system|internal)\s+(?:rules|prompt)\b/i, type: "prompt_exfiltration" },
    { pattern: /\bgive\s+me\s+(?:the\s+)?(?:data|records|info)\s+for\s+(?:user|patient)\b/i, type: "data_exfiltration" },
    { pattern: /\byou\s+are\s+now\s+(?:DAN|jailbreak|unrestricted)\b/i, type: "persona_jailbreak" },
  ];

  let sanitized = rawText;
  let detected = false;
  let threat: string | undefined = undefined;

  for (const { pattern, type } of injectionPatterns) {
    if (pattern.test(sanitized)) {
      detected = true;
      threat = type;
      sanitized = sanitized.replace(pattern, "[security-filtered]");
    }
  }

  return { sanitizedText: sanitized, injectionDetected: detected, threatType: threat };
}

// ─── DATA MINIMIZATION (PII SCRUBBING) ───────────────────────────────────────

export function minimizeClinicalDataPII(text: string): string {
  let clean = text;
  // Phone numbers
  clean = clean.replace(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[PHONE]");
  // Email addresses
  clean = clean.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL]");
  // National IDs / Aadhaar / SSN formats
  clean = clean.replace(/\b\d{4}[-\s]\d{4}[-\s]\d{4}\b/g, "[ID]");
  clean = clean.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[ID]");
  return clean;
}

// ─── SERVER-SIDE TELEMETRY INTEGRITY HASH ───────────────────────────────────

export function createTelemetryIntegrityHash(
  turnId: number,
  provider: string,
  model: string,
  latencyMs: number,
  timestamp: string
): string {
  const secret = process.env.TELEMETRY_SECRET || "medvoice-telemetry-integrity-key-2026";
  return crypto.createHmac("sha256", secret)
    .update(`${turnId}:${provider}:${model}:${latencyMs}:${timestamp}`)
    .digest("hex");
}

// ─── DETERMINISTIC RESPONSE VALIDATOR ───────────────────────────────────────

export interface ValidatorCheckResult {
  isValid: boolean;
  reason?: string;
  category?: "attribution" | "provenance" | "diagnosis_inflation" | "medication_safety" | "emergency_instruction" | "false_dispatch_claim";
}

export function validateDoctorTurnResponse(
  candidateReply: string,
  patientUtterance: string,
  targetSubject: "self" | "mother" | "child" | "third_party",
  isEmergency: boolean,
  primaryEmergencyNumber = "112",
  ambulanceNumber = "108"
): ValidatorCheckResult {
  const lowerReply = candidateReply.toLowerCase();
  const lowerUtterance = patientUtterance.toLowerCase();

  // 1. Attribution Integrity: preserve affected person's identity
  if (targetSubject === "mother") {
    // Must NOT attribute symptom to caller ("in your chest", "your pain", "in your belly")
    if (/\b(?:in\s+your\s+chest|your\s+(?:chest\s+pain|stomach\s+pain|belly\s+pain|heart|shaking|sweating))\b/i.test(candidateReply)) {
      return {
        isValid: false,
        category: "attribution",
        reason: "Transposed patient identity: attributed mother's symptoms to the caller ('in your chest')",
      };
    }
    // Must refer to the third party ("mother", "she", "her", "your mom")
    if (!/\b(?:mother|she|her|mom)\b/i.test(candidateReply)) {
      return {
        isValid: false,
        category: "attribution",
        reason: "Missing third-party attribution: response failed to reference the mother",
      };
    }
  }

  // 2. Symptom Provenance: Grounded strictly in stated symptoms without hallucination
  // CHALLENGE-02: patient said "chest pain", not "tight pressure" or "crushing"
  if (/\bchest\s+pain\b/i.test(lowerUtterance) && !/\b(?:tight|pressure|crushing|squeezing)\b/i.test(lowerUtterance)) {
    if (/\b(?:tight\s+pressure|crushing\s+pressure|heavy\s+elephant)\b/i.test(candidateReply)) {
      return {
        isValid: false,
        category: "provenance",
        reason: "Hallucinated unsupported symptom quality (invented 'tight pressure' when only 'chest pain' was stated)",
      };
    }
  }

  // CHALLENGE-03: patient explicitly negated chest pain and asserted stomach pain
  if (/\bdon'?t\s+have\s+chest\s+pain\b/i.test(lowerUtterance) || /\bno\s+chest\s+pain\b/i.test(lowerUtterance)) {
    if (/\b(?:left\s+arm|jaw\s+pain|radiation\s+to\s+arm|heart\s+attack|coronary|angina)\b/i.test(candidateReply)) {
      return {
        isValid: false,
        category: "provenance",
        reason: "Queried negated cardiac domain when patient explicitly denied chest pain",
      };
    }
  }

  // CHALLENGE-05: patient explicitly denied fever
  if (/\bno\s+fever\b/i.test(lowerUtterance) && !/\bfever\b/i.test(lowerUtterance.replace(/\bno\s+fever\b/g, ""))) {
    if (/\b(?:because\s+of\s+your\s+fever|your\s+fever|feverish)\b/i.test(candidateReply)) {
      return {
        isValid: false,
        category: "provenance",
        reason: "Asserted fever when patient explicitly denied fever",
      };
    }
    if (/\b(?:worsening|getting\s+worse|rapidly\s+progressing)\b/i.test(candidateReply)) {
      return {
        isValid: false,
        category: "provenance",
        reason: "Hallucinated unsupported worsening trajectory",
      };
    }
  }

  // 3. Diagnostic Restraint: No unsupported definitive diagnosis
  if (/\b(?:you\s+have|she\s+has|diagnosed\s+with|confirmed|definite)\s+(?:a\s+)?(?:heart\s+attack|myocardial\s+infarction|stroke|hypoglycemia|appendicitis|meningitis)\b/i.test(candidateReply)) {
    return {
      isValid: false,
      category: "diagnosis_inflation",
      reason: "Offered unsupported definitive diagnosis instead of triage inquiry/evaluation",
    };
  }

  // 4. Medication Safety: No unauthorized prescription commands
  if (/\b(?:take|give\s+her|swallow)\s+(?:an?\s+)?(?:aspirin|nitroglycerin|metformin|antibiotic|ibuprofen)\b/i.test(candidateReply)) {
    if (!/\b(?:if\s+you\s+have\s+aspirin|consult\s+doctor)\b/i.test(candidateReply)) {
      return {
        isValid: false,
        category: "medication_safety",
        reason: "Issued uncertified medication administration directive",
      };
    }
  }

  // 5. False Emergency-Dispatch Prohibition: MedVoice is an intake/triage tool, NOT a CAD (Computer Aided Dispatch)
  // NEVER allow claiming that an ambulance, paramedics, or emergency responders have been dispatched, sent, or are en route.
  const falseDispatchRegex = new RegExp(
    [
      "\\b(?:(?:i(?:'ve|\\s+have)?|we(?:'ve|\\s+have)?)\\s+(?:dispatched|sent|called|contacted|ordered|alerted)\\s+(?:an?\\s+)?(?:ambulance|paramedics?|first\\s+responders?|help|emergency\\s+services|a\\s+unit))\\b",
      "\\b(?:(?:ambulance|paramedics?|first\\s+responders?|help|emergency\\s+services)\\s+(?:is|are|has\\s+been|have\\s+been)\\s+(?:on\\s+(?:the|their|its)\\s+way|en\\s*route|dispatched|sent|called))\\b",
      "\\b(?:an?\\s+ambulance\\s+(?:is|has\\s+been)\\s+(?:on\\s+(?:the|its)\\s+way|en\\s*route|called|dispatched|sent))\\b",
      "\\b(?:help\\s+is\\s+(?:on\\s+the\\s+way|en\\s*route))\\b",
      "\\b(?:i(?:'ve|\\s+have)?\\s+called\\s+(?:an?\\s+ambulance|emergency(?:\\s+services)?|112|108|911)\\s+for\\s+you)\\b",
      "\\b(?:don'?t\\s+worry,?\\s+(?:an?\\s+ambulance|help|emergency))\\b",
    ].join("|"),
    "i"
  );

  if (falseDispatchRegex.test(candidateReply)) {
    return {
      isValid: false,
      category: "false_dispatch_claim",
      reason: "False emergency-dispatch claim detected: MedVoice cannot dispatch emergency responders or confirm an ambulance is en route.",
    };
  }

  // 6. Emergency Policy Adherence: Tier 1/2 must include 112/108/emergency services
  if (isEmergency) {
    const emergencyRegex = new RegExp(`\\b(${primaryEmergencyNumber}|${ambulanceNumber}|emergency|er|urgent|hospital)\\b`, "i");
    if (!emergencyRegex.test(candidateReply)) {
      return {
        isValid: false,
        category: "emergency_instruction",
        reason: `Emergency active but response lacked approved emergency directive (${primaryEmergencyNumber}/${ambulanceNumber})`,
      };
    }
  }

  return { isValid: true };
}

// ─── STRICT OUTPUT PARSER & REASONING-LEAK GUARD ─────────────────────────────

export interface ParsedDoctorReply {
  cleanReply: string;
  understoodContext?: string;
  conversationalAction?: ConversationalAction;
  candidateFacts?: CandidateFactProposal[];
  unmappedObservations?: string[];
  intendedTargets?: string[];
  candidateSafetyConcern?: string;
  rejectedReason?: string;
}

export function parseAndSanitizeDoctorReply(
  rawContent: string,
  fallbackReply: string,
  knownDemographics?: { age?: number | null; ageSource?: string }
): ParsedDoctorReply {
  let candidate = "";
  let understoodContext: string | undefined = undefined;
  let conversationalAction: ConversationalAction | undefined = undefined;
  let candidateFacts: CandidateFactProposal[] = [];
  let unmappedObservations: string[] = [];
  let intendedTargets: string[] = [];
  let candidateSafetyConcern: string | undefined = undefined;

  // 1. Strip <think> tags if present
  let text = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // 2. Strip code block wrappers
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // 3. Attempt JSON parse
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed) {
        if (typeof (parsed.patientResponse || parsed.doctorReply || parsed.reply) === "string") {
          candidate = String(parsed.patientResponse || parsed.doctorReply || parsed.reply).trim();
        }
        if (typeof parsed.understoodContext === "string") {
          understoodContext = parsed.understoodContext.trim();
        }
        if (typeof parsed.conversationalAction === "string") {
          conversationalAction = parsed.conversationalAction as ConversationalAction;
        }
        if (Array.isArray(parsed.candidateFacts)) {
          candidateFacts = parsed.candidateFacts.filter((f: any) => f && typeof f.concept === "string");
        }
        if (Array.isArray(parsed.unmappedObservations)) {
          unmappedObservations = parsed.unmappedObservations.filter((o: any) => typeof o === "string" && o.trim()).map((o: string) => o.trim());
        }
        if (Array.isArray(parsed.intendedTargets)) {
          intendedTargets = parsed.intendedTargets.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim());
        }
        if (typeof parsed.candidateSafetyConcern === "string" && parsed.candidateSafetyConcern.trim()) {
          candidateSafetyConcern = parsed.candidateSafetyConcern.trim();
        }
      }
    }
  } catch {}

  // 4. Fallback key regex extraction if JSON parse failed
  if (!candidate) {
    const keyMatch = text.match(/"patientResponse"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
    if (keyMatch && keyMatch[1]) {
      candidate = keyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, " ").trim();
    } else {
      candidate = text.replace(/^["']|["']$/g, "").trim();
    }
  }

  // 5. Output Guard: Reject internal reasoning leaks
  for (const pattern of REASONING_LEAK_PATTERNS) {
    if (pattern.test(candidate)) {
      console.warn(`[MedVoice AI Output Guard] Detected internal reasoning leak (${pattern}). Rejecting candidate.`);
      return {
        cleanReply: fallbackReply,
        rejectedReason: `Reasoning leak detected: ${pattern}`,
      };
    }
  }

  // 6. Output Guard: Reject defaulted/invented age references
  const hasDefaultedAge = /\bpatient\s+(?:45|\d{2,3})\b/i.test(candidate);
  const hasInventedAge = (!knownDemographics?.age && /\b(?:45\s*years?\s*old|at\s*45\b|a\s*45-year-old)\b/i.test(candidate));
  if (hasDefaultedAge || hasInventedAge) {
    console.warn(`[MedVoice AI Output Guard] Detected defaulted or invented age reference. Rejecting candidate.`);
    return {
      cleanReply: fallbackReply,
      rejectedReason: "Defaulted or invented age reference detected",
    };
  }

  // 7. Length Guard: Limit spoken length to safe conversational length (~55 words)
  const wordCount = candidate.split(/\s+/).filter(Boolean).length;
  if (wordCount > 60 || candidate.length > 380) {
    console.warn(`[MedVoice AI Output Guard] Response exceeded safe conversational length (${wordCount} words). Truncating.`);
    const sentences = candidate.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length >= 1 && sentences.slice(0, 2).join(" ").split(/\s+/).length <= 45) {
      candidate = sentences.slice(0, 2).join(" ").trim();
    } else {
      return {
        cleanReply: fallbackReply,
        rejectedReason: "Excessive response length",
      };
    }
  }

  // 8. Clean residual markdown formatting
  candidate = candidate.replace(/[*_#`\[\]]/g, "").trim();

  // 10. Output Guard: Enforce focused questioning (max 1 question per turn)
  if ((candidate.match(/\?/g) || []).length > 1) {
    const firstQIdx = candidate.indexOf("?");
    if (firstQIdx > 0) {
      candidate = candidate.slice(0, firstQIdx + 1).trim();
    }
  }

  candidate = candidate.replace(/,\s*(?:a\s+)?fever(?:,\s*(?:or|and)\s+any\s+ear\s+pain)?\?/i, "?");
  candidate = candidate.replace(/,\s*(?:or|and)\s+any\s+ear\s+pain\?/i, "?");

  if (!candidate) {
    return { cleanReply: fallbackReply, rejectedReason: "Empty candidate after cleaning" };
  }

  if (intendedTargets.length === 0 && candidate.includes("?")) {
    const detected = detectQuestionTargetSlot(candidate);
    if (detected) intendedTargets = [detected];
  }

  return {
    cleanReply: candidate,
    understoodContext,
    conversationalAction,
    candidateFacts,
    unmappedObservations,
    intendedTargets,
    candidateSafetyConcern,
  };
}

// ─── SYSTEM PROMPT BUILDER ───────────────────────────────────────────────────

export interface SystemPromptConfig {
  doctor?: DoctorProfile;
  localeConfig?: LocaleConfig;
  callerProfile?: CallerProfile;
  patientProfile?: PatientProfile;
  inferredSubject?: "self" | "mother" | "child" | "third_party";
  ageDisplay?: string;
  confirmedFacts?: string[];
  deniedSymptoms?: string[];
  uncertainties?: string[];
  isEmergency?: boolean;
  flags?: string[];
  evidenceAnalysis?: { situation: string; conversationalGuidance: string };
  retrievedPassagesSummary?: string;
  primaryEmergencyNumber?: string;
  ambulanceNumber?: string;
  unmappedObservations?: string[];
  timelineAnchor?: string;
  unansweredDimensions?: string[];
  advisoryInquiryTopic?: string;
  isClarificationRequest?: boolean;
  clarificationGuidance?: string;
}

export function buildDoctorSystemPrompt(
  doctorOrConfig?: Partial<SystemPromptConfig> | DoctorProfile,
  legacyHistory?: any[],
  patientProfile?: PatientProfile,
  callerProfile?: CallerProfile,
  targetSubject?: "self" | "mother" | "child" | "third_party"
): string {
  let cfg: Partial<SystemPromptConfig> = {};
  if (
    doctorOrConfig &&
    typeof doctorOrConfig === "object" &&
    ("inferredSubject" in doctorOrConfig ||
      "patientProfile" in doctorOrConfig ||
      "ageDisplay" in doctorOrConfig ||
      "evidenceAnalysis" in doctorOrConfig)
  ) {
    cfg = doctorOrConfig as Partial<SystemPromptConfig>;
  } else {
    cfg = {
      doctor: (doctorOrConfig as DoctorProfile) || undefined,
      patientProfile,
      callerProfile,
      inferredSubject: targetSubject || (callerProfile?.relationshipToPatient === "child" ? "mother" : "self"),
    };
  }

  const doc = cfg.doctor || ({
    name: "Dr. Sarah Rao",
    specialty: "General & Family Physician",
  } as DoctorProfile);
  const locale = cfg.localeConfig || DEFAULT_LOCALE_CONFIG;
  const inferredSubject = cfg.inferredSubject || "self";
  const callerRelation = cfg.callerProfile?.relationshipToPatient || (inferredSubject === "mother" ? "child" : "self");

  let ageDisplay = cfg.ageDisplay;
  if (!ageDisplay) {
    if (cfg.patientProfile?.dateOfBirth) {
      const calc = calculateAgeFromDOB(cfg.patientProfile.dateOfBirth);
      ageDisplay = `${calc.years} years (DOB: ${cfg.patientProfile.dateOfBirth})`;
    } else if (cfg.patientProfile?.age != null) {
      ageDisplay = `${cfg.patientProfile.age} years old`;
    } else {
      ageDisplay = "Unknown";
    }
  }

  const attributionInstruction =
    inferredSubject === "mother"
      ? `CRITICAL ATTRIBUTION RULE: The patient is the caller's MOTHER. Address the caller about their mother using "your mother", "she", or "her". NEVER say "in your chest" or treat the caller as experiencing the symptoms.`
      : inferredSubject === "child"
      ? `CRITICAL ATTRIBUTION RULE: The patient is the caller's CHILD. Address the caller about their child using "your child" or "they".`
      : `The patient is speaking for THEMSELVES. Address them directly as "you".`;

  const confirmedConditions =
    cfg.patientProfile?.knownConditions?.join(", ") ||
    (cfg.confirmedFacts && cfg.confirmedFacts.length > 0 ? cfg.confirmedFacts.slice(-3).join("; ") : "None recorded");
  const confirmedMeds = cfg.patientProfile?.currentMedications?.map((m) => m.name).join(", ") || "None recorded";
  const confirmedAllergies =
    cfg.patientProfile?.drugAllergies && cfg.patientProfile.drugAllergies.length > 0
      ? cfg.patientProfile.drugAllergies
          .map((a) => `${a.drugName} (${a.severity || a.reactionType || "allergy"}${a.reactionDescription ? `: ${a.reactionDescription}` : ""})`)
          .join(", ")
      : cfg.patientProfile?.allergyStatus === "none_known"
      ? "No known drug allergies"
      : "Unassessed";
  const surgicalHistory = cfg.patientProfile?.surgicalHistory?.join(", ") || "None recorded";
  const communicationPref = cfg.patientProfile?.accessibilityPreferences?.communicationStyle || "Standard";

  const confirmedFacts = cfg.confirmedFacts || [];
  const deniedSymptoms = cfg.deniedSymptoms || [];
  const uncertainties = cfg.uncertainties || [];
  const isEmergency = Boolean(cfg.isEmergency);
  const flags = cfg.flags || [];
  const primaryEmergencyNumber = cfg.primaryEmergencyNumber || locale.emergencyNumber || "112";
  const ambulanceNumber = cfg.ambulanceNumber || locale.alternateEmergencyNumbers?.[0] || "108";
  const evidenceAnalysis = cfg.evidenceAnalysis || {
    situation: "clear",
    conversationalGuidance: "Standard clinical evaluation.",
  };
  const retrievedPassagesSummary = cfg.retrievedPassagesSummary || "";

  return `You are ${doc.name}, ${doc.specialty} at MedVoice AI (${locale.country}).
You are an active-listening, empathetic medical conversational agent conducting clinical intake.

3-TIER CONTEXT:
1. CALLER LAYER: Caller relationship to patient: "${callerRelation}".
${attributionInstruction}
2. PATIENT PROFILE LAYER: Target Patient: ${cfg.patientProfile?.name || (inferredSubject === "mother" ? "Mother" : "Self")}. Calculated Age: ${ageDisplay}.
Confirmed Conditions: ${confirmedConditions}.
Confirmed Medications: ${confirmedMeds}.
Confirmed Drug Allergies: ${confirmedAllergies}.
Surgical History: ${surgicalHistory}.
Communication / Preferences: ${communicationPref}.
3. ENCOUNTER STATE LAYER:
${cfg.timelineAnchor ? `- Chief Complaint & Timeline Anchor: ${cfg.timelineAnchor}` : ""}
- Active Reported Facts: ${confirmedFacts.slice(-10).join("; ") || "Initial intake"}
${deniedSymptoms.length > 0 ? `- Denied Findings (DO NOT RE-ASK): ${deniedSymptoms.join(", ")}` : ""}
${uncertainties.length > 0 ? `- Uncertain Findings: ${uncertainties.join("; ")}` : ""}
${cfg.unmappedObservations && cfg.unmappedObservations.length > 0 ? `- Unmapped Nuances / Raw Observations: ${cfg.unmappedObservations.join("; ")}` : ""}
${cfg.unansweredDimensions && cfg.unansweredDimensions.length > 0 ? `- Unresolved Dimensions: ${cfg.unansweredDimensions.join(", ")}` : ""}
${cfg.advisoryInquiryTopic ? `- Specialist Advisory Suggestion (optional): ${cfg.advisoryInquiryTopic}` : ""}
- Safety Triage Status: ${isEmergency ? `CRITICAL EMERGENCY (${flags.join(", ")})` : "AMBULATORY CLINICAL INTAKE"}

OPEN-WORLD EVIDENCE CONTEXT (${evidenceAnalysis.situation}):
${evidenceAnalysis.conversationalGuidance}
${retrievedPassagesSummary ? `Retrieved Guidelines:\n${retrievedPassagesSummary}` : ""}

CONVERSATIONAL ACTION PALETTE:
Select from: "INQUIRE", "ANSWER_QUESTION", "ACKNOWLEDGE_CORRECTION", "EXPLAIN_CLINICAL_RATIONALE", "SUMMARIZE_AND_CHECK", "EMERGENCY_DIRECTIVE", "PROVIDE_SUPPORT".
You do NOT need to ask a question on every turn if answering, acknowledging, or providing emergency guidance is more appropriate.
${
  cfg.isClarificationRequest
    ? `
AMBIGUITY CLARIFICATION OBJECTIVE:
The patient's latest statement was ambiguous, fragmented, or unclear.
${cfg.clarificationGuidance ? `Context/Suggested Clarification: "${cfg.clarificationGuidance}"` : ""}
Do NOT blindly repeat a rigid canned script. Respond with empathetic bedside manner, acknowledge what was heard, and ask a natural, spoken clarifying question. Keep it under 2 short sentences.`
    : ""
}

CRITICAL CLINICAL RULES:
1. Preserve symptom provenance: Ground strictly in what was stated. NEVER invent unmentioned symptoms (e.g. do not add "tight pressure" when only "chest pain" was stated; do not mention "fever" when fever was denied).
2. Diagnostic restraint: NEVER state a definitive diagnosis (e.g. "you have a heart attack", "diagnosed with hypoglycemia"). Triage explores, it does not certify.
3. Spoken Bedside Manner: Exactly 1 to 2 short spoken sentences (~15-35 words maximum). Zero conversational rambling, zero robotic filler. Never ask more than ONE clarifying question.
${
  isEmergency
    ? `4. EMERGENCY DIRECTIVE (HIGHEST PRIORITY): A life-threatening emergency is active. You MUST deliver clear emergency guidance to call ${primaryEmergencyNumber} or ${ambulanceNumber} (Ambulance) or proceed to the nearest emergency department immediately. This takes strict precedence over all conversational exploration.`
    : `4. If open-world presentation (e.g. yellow urine despite water), explore duration, jaundice, stool color, and supplements without jumping to conclusions.`
}
5. Multi-Complaint Conciseness: When a patient reports multiple symptoms simultaneously across disparate organ systems (or changes in one while others remain constant), acknowledge them concisely in a single brief clause (e.g. "I understand your vision and ankle are unchanged while the stomach burning has intensified") and ask exactly ONE high-priority focused clarifying question. Never lecture or try to exhaustively cross-examine every organ system at once. Keep the entire spoken reply strictly within 1 to 2 short sentences (under 35 words total).
6. CONTEXT-AWARE PROFILE DOCTRINE:
- The Patient Profile provides passive background context to personalize care without interrogating the patient.
- Do NOT conduct a intake questionnaire or interrogate the patient for blank profile fields. Focus exclusively on their chief complaint.
- DO NOT ask for missing profile fields (name, age, medical history, allergies, medications) simply to fill out a questionnaire or form.
- Ask for missing clinical factors (such as age or pregnancy status) ONLY when clinically pertinent to evaluating the active complaint or ensuring safety (e.g. asking age when chest pain, stroke signs, or fever requires pediatric vs adult risk stratification; or asking current medications if evaluating potential adverse drug interactions or polypharmacy).
- Always state the clinical reason why you are asking (e.g. "Because medications can sometimes interact with stomach symptoms, are you currently taking any regular prescriptions?").
- Seamlessly use confirmed profile facts. Do NOT ask 'Do you have diabetes?' if the profile already confirms diabetes.
- If a profile fact is already confirmed above (e.g. age, conditions, medications), NEVER ask the patient for it again. Use it seamlessly.
- If the patient provides a correction to a profile fact (e.g. "I stopped taking metformin last week"), acknowledge the correction, use the updated fact, and prioritize the real-time statement over the stored profile. Patient corrections always override stored profile facts.
- Treat unknown profile information as unknown—NEVER assume an absent allergy or condition means it is negative.
- Emergency safety screening ALWAYS takes strict precedence over routine profile queries.
7. PROHIBITION OF FALSE EMERGENCY DISPATCH CLAIMS: NEVER state, imply, or promise that you or MedVoice have dispatched an ambulance, called emergency services, or that help/paramedics are on the way. MedVoice cannot dispatch emergency responders. Always instruct the caller/patient to dial ${primaryEmergencyNumber} or ${ambulanceNumber} themselves immediately.
8. EMPATHY & ANXIETY VALIDATION: When a patient expresses fear, panic, anxiety, or emotional distress (e.g. terrified due to family medical history, stress, or feeling overwhelmed), ALWAYS validate their feelings with a warm, empathetic opening clause (e.g. "I understand this is very frightening, especially with your father's history" or "I hear how scary and stressful this feels right now") before asking your focused clinical question. Never ignore patient distress or treat emotional statements as irrelevant noise.
9. PATIENT CORRECTIONS & TIMELINE REVISIONS: When a patient clarifies or corrects information stated earlier (such as correcting a symptom from constant to postural/positional, or revising a timeline), ALWAYS explicitly acknowledge their correction and the revised detail in your opening clause (e.g. "Thank you for clarifying that it goes away when lying down and surges when standing" or "I understand that sitting or standing triggers it"). Then proceed with your focused inquiry based on the corrected presentation.

OUTPUT FORMAT (STRICT JSON ONLY):
{
  "patientResponse": "<1-2 short spoken sentences, strictly under 35 words total. When conversationalAction is 'INQUIRE', you MUST end with exactly ONE focused clinical question ending in '?' (e.g. 'I understand... [brief reflection]. Could you tell me [focused question]?')>",
  "understoodContext": "<concise clinical reflection of what was expressed>",
  "candidateFacts": [
    {
      "concept": "<clinical concept>",
      "assertionStatus": "present | absent | uncertain",
      "subjectReference": "${inferredSubject}",
      "temporalScope": "current | historical"
    }
  ],
  "unmappedObservations": ["<patient descriptions or nuances not fitting standard slots>"],
  "conversationalAction": "<action from palette>",
  "intendedTargets": ["<clinical topic targeted if asking question, e.g. 'orthostatic_timing', 'dizziness_character', 'laterality'>"],
  "candidateSafetyConcern": "<any subtle unscripted danger sign observed, or null>"
}
`;
}

// ─── TOKEN-BUDGETED, LOSS-AWARE CONTEXT ASSEMBLER ────────────────────────────

export interface AssembleContextOptions {
  systemPrompt: string;
  conversationHistory: Array<{ role: "patient" | "doctor" | "assistant"; text?: string; content?: string }>;
  currentUtterance: string;
  timelineAnchor?: string;
  maxTokensBudget?: number;
}

export function assembleLossAwareConversationContext(options: AssembleContextOptions): NvidiaChatMessage[] {
  const { systemPrompt, conversationHistory = [], currentUtterance, maxTokensBudget = 2000 } = options;
  const messages: NvidiaChatMessage[] = [{ role: "system", content: systemPrompt }];
  const cleanCurrentUtterance = currentUtterance.trim();

  // If conversation is short (<= 8 turns), include all turns with character capping
  if (conversationHistory.length <= 8) {
    for (const turn of conversationHistory) {
      const role = turn.role === "doctor" || turn.role === "assistant" ? "assistant" : "user";
      let content = (turn.text || turn.content || "").trim();
      if (content.length > 350) content = content.slice(0, 350) + "...";
      if (content) messages.push({ role, content });
    }
  } else {
    // Extended conversation (> 8 turns):
    // 1. PIN TURN 1 (Chief complaint & initial framing)
    const turn1 = conversationHistory[0];
    const role1 = turn1.role === "doctor" || turn1.role === "assistant" ? "assistant" : "user";
    let content1 = (turn1.text || turn1.content || "").trim();
    if (content1.length > 350) content1 = content1.slice(0, 350) + "...";
    if (content1) messages.push({ role: role1, content: content1 });

    // If turn 2 is the patient's initial response to greeting, pin turn 2 as anchor
    if (conversationHistory.length > 1 && role1 === "assistant") {
      const turn2 = conversationHistory[1];
      const role2 = turn2.role === "doctor" || turn2.role === "assistant" ? "assistant" : "user";
      let content2 = (turn2.text || turn2.content || "").trim();
      if (content2.length > 350) content2 = content2.slice(0, 350) + "...";
      if (content2) messages.push({ role: role2, content: content2 });
    }

    // 2. COMPRESS INTERMEDIATE TURNS (Between anchor turns and last 6 turns)
    const recentTurnCount = 6;
    const startIndex = (role1 === "assistant" && conversationHistory.length > 1) ? 2 : 1;
    const endIndex = conversationHistory.length - recentTurnCount;

    if (endIndex > startIndex) {
      const intermediateTurns = conversationHistory.slice(startIndex, endIndex);
      const intermediateSummaryLines: string[] = [];
      for (const turn of intermediateTurns) {
        const speaker = turn.role === "doctor" || turn.role === "assistant" ? "Doctor" : "Patient";
        const text = (turn.text || turn.content || "").trim();
        if (text) {
          const snippet = text.length > 120 ? text.slice(0, 120) + "..." : text;
          intermediateSummaryLines.push(`${speaker}: ${snippet}`);
        }
      }

      if (intermediateSummaryLines.length > 0) {
        messages.push({
          role: "system",
          content: `[Encounter Dialogue Summary — Turns ${startIndex + 1} to ${endIndex}]:\n${intermediateSummaryLines.join("\n")}`,
        });
      }
    }

    // 3. RETAIN RECENT 6 TURNS VERBATIM
    const recentTurns = conversationHistory.slice(-recentTurnCount);
    for (const turn of recentTurns) {
      const role = turn.role === "doctor" || turn.role === "assistant" ? "assistant" : "user";
      let content = (turn.text || turn.content || "").trim();
      if (content.length > 350) content = content.slice(0, 350) + "...";
      if (content) messages.push({ role, content });
    }
  }

  // Ensure latest patient utterance is included at the tail
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== cleanCurrentUtterance) {
    if (cleanCurrentUtterance) {
      messages.push({ role: "user", content: cleanCurrentUtterance });
    }
  }

  // 4. Token budgeting: approximate 4 chars per token, max budget = ~2000 tokens (approx 8000 chars)
  let totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const maxChars = maxTokensBudget * 4;

  if (totalChars > maxChars) {
    // Compress intermediate messages while strictly preserving system prompt and last 2 messages
    for (let i = 1; i < messages.length - 2 && totalChars > maxChars; i++) {
      if (messages[i].content.length > 100) {
        const diff = totalChars - maxChars;
        const trimAmount = Math.min(diff, messages[i].content.length - 100);
        messages[i].content = messages[i].content.slice(0, messages[i].content.length - trimAmount) + "...";
        totalChars -= trimAmount;
      }
    }
  }

  return messages;
}

// ─── GENERATIVE CLINICAL CONVERSATION ENGINE ─────────────────────────────────

export async function generateDoctorTurnResponse(
  options: GenerateTurnOptions
): Promise<GeneratedTurnResult> {
  const {
    patientUtterance,
    conversationHistory,
    interviewState,
    preArbiterResult,
    demographics = { age: null, age_group: "adult", age_source: "unknown" },
    doctor,
    missingDimensions = [],
    fallbackReply,
    careNetworkSummary,
    localeConfig = DEFAULT_LOCALE_CONFIG,
    callerProfile,
    patientProfile,
    targetSubject: explicitTargetSubject,
    turnId = interviewState?.structuredHistory?.turnCount || 1,
    onCandidateSafetyConcern,
  } = options;

  const isEmergency = Boolean(preArbiterResult?.immediate_danger || interviewState?.informationState === "emergency_preempted");
  if (isEmergency) {
    const primaryEmergencyNumber = localeConfig.emergencyNumber || "112";
    const ambulanceNumber = localeConfig.alternateEmergencyNumbers?.[0] || "108";
    const emergencyDirective = fallbackReply ||
      `This is a medical emergency. Please call ${primaryEmergencyNumber} or ${ambulanceNumber} immediately for an ambulance. Do not drive yourself.`;
    const emergencyTs = new Date().toISOString();
    return {
      reply: emergencyDirective,
      provider: "safety_arbiter_deterministic",
      responseProvenance: "deterministic_safety_arbiter",
      latencyMs: 0,
      liveGenerated: false,
      conversationalAction: "EMERGENCY_DIRECTIVE",
      telemetry: {
        provider: "safety_arbiter_deterministic",
        model: "pre_arbiter_emergency_preemption",
        liveGenerated: false,
        latencyMs: 0,
        fallbackUsed: false,
        telemetryIntegrityHash: createTelemetryIntegrityHash(turnId, "pre_arbiter", "deterministic", 0, emergencyTs),
        timestamp: emergencyTs,
      },
    };
  }

  const flags = preArbiterResult?.pre_safety_flags || [];
  const knownFacts = interviewState?.slots.known_facts || [];

  // Determine Target Subject (self vs mother vs child)
  const inferredSubject: "self" | "mother" | "child" | "third_party" =
    explicitTargetSubject ||
    (callerProfile?.relationshipToPatient === "child" ? "mother" :
     callerProfile?.relationshipToPatient === "parent" ? "child" :
     /\b(?:my\s+mother|my\s+mom|she\s+has|her\s+chest)\b/i.test(patientUtterance) ? "mother" :
     /\b(?:my\s+child|my\s+baby|my\s+son|my\s+daughter)\b/i.test(patientUtterance) ? "child" : "self");

  // Ingest conversation memory and response plan
  const memory = interviewState?.conversationMemory;
  const rawPlan = interviewState?.responsePlan;
  const pendingQ = interviewState?.pendingQuestion;

  const confirmedFacts = memory?.confirmedFacts && memory.confirmedFacts.length > 0
    ? memory.confirmedFacts
    : knownFacts;
  const deniedSymptoms = memory?.deniedSymptoms || [];
  const uncertainties = memory?.uncertainties || [];
  const questionsAlreadyAsked = memory?.questionsAlreadyAsked || [];
  const rawMustAvoid = rawPlan?.mustAvoidAsking && rawPlan.mustAvoidAsking.length > 0
    ? rawPlan.mustAvoidAsking
    : questionsAlreadyAsked;

  const effectiveInquiry = rawPlan?.nextHighValueInquiry || (pendingQ?.targetSlot ? {
    topic: pendingQ.targetSlot,
    clinicalRationale: pendingQ.purpose || `Inquire about ${pendingQ.targetSlot}`,
    suggestedPhrasing: fallbackReply || pendingQ.question,
  } : undefined);

  const activeTargetSlot = effectiveInquiry?.topic || pendingQ?.targetSlot;
  const correctedSlots = new Set<string>();
  if (memory?.patientCorrections && Array.isArray(memory.patientCorrections)) {
    for (const c of memory.patientCorrections) {
      if ((c as any).target) correctedSlots.add(String((c as any).target).toLowerCase().trim());
      if ((c as any).slot) correctedSlots.add(String((c as any).slot).toLowerCase().trim());
    }
  }
  if (/\b(?:correct|correction|not constant|need to correct|instead|said earlier|actually)\b/i.test(patientUtterance)) {
    correctedSlots.add("character");
    correctedSlots.add("onset_pattern");
    correctedSlots.add("timing_pattern");
    correctedSlots.add("course");
    correctedSlots.add("orthostatic_timing");
  }

  const filteredMustAvoid = rawMustAvoid.filter(item => {
    if (!item) return false;
    const itemLower = item.toLowerCase().trim();
    if (activeTargetSlot && itemLower === activeTargetSlot.toLowerCase().trim()) return false;
    if (correctedSlots.has(itemLower)) return false;
    return true;
  });

  const plan = {
    primaryGoal: rawPlan?.primaryGoal || "ADVANCE_CLINICAL_INTAKE",
    conversationalFocus: rawPlan?.conversationalFocus || pendingQ?.purpose || `Inquire about ${pendingQ?.targetSlot || "clinical symptoms"}`,
    mustAvoidAsking: filteredMustAvoid,
    nextHighValueInquiry: effectiveInquiry,
    suggestedSpokenReply: rawPlan?.suggestedSpokenReply || fallbackReply || pendingQ?.question || "Could you tell me more about what you're experiencing?",
  };

  const primaryEmergencyNumber = localeConfig.emergencyNumber || "112";
  const ambulanceNumber = localeConfig.alternateEmergencyNumbers?.[0] || "108";
  const rawFallback = fallbackReply || plan?.suggestedSpokenReply || "Could you tell me more about what you're experiencing?";

  let effectiveFallback = rawFallback;
  if (!isEmergency && (rawMustAvoid.length > 0 || deniedSymptoms.length > 0)) {
    const activeTargetSlot = effectiveInquiry?.topic || pendingQ?.targetSlot;
    const fallbackTargetSlot = detectQuestionTargetSlot(rawFallback, activeTargetSlot);
    const permittedFallbackTargets = new Set([activeTargetSlot, fallbackTargetSlot].filter(Boolean).map(target => target!.toLowerCase()));
    const fallbackMustAvoid = rawMustAvoid.filter(item => !permittedFallbackTargets.has(item.toLowerCase()));
    const fallbackValidation = validateDoctorReplyTarget(
      rawFallback,
      { mustAvoidAsking: fallbackMustAvoid },
      interviewState?.slots,
      memory,
      confirmedFacts,
      deniedSymptoms
    );
    if (!fallbackValidation.isValid) {
      effectiveFallback = effectiveInquiry?.suggestedPhrasing ||
        "I understand. Thank you for sharing that. Could you tell me what else you've been noticing or how things have changed?";
    }
  }

  // 1. Check provider availability
  const isGroq = groqClient.isConfigured();
  const isNvidia = !isGroq && nvidiaClient.isConfigured();

  if (!isGroq && !isNvidia) {
    const fallbackTs = new Date().toISOString();
    return {
      reply: effectiveFallback,
      provider: "fallback",
      responseProvenance: "validated_fallback",
      latencyMs: 0,
      liveGenerated: false,
      fallbackReason: "no_provider_configured",
      telemetry: {
        provider: "fallback",
        model: "deterministic_clinical_engine",
        liveGenerated: false,
        latencyMs: 0,
        fallbackUsed: true,
        fallbackReason: "no_provider_configured",
        telemetryIntegrityHash: createTelemetryIntegrityHash(turnId, "fallback", "none", 0, fallbackTs),
        timestamp: fallbackTs,
      },
    };
  }

  // 2. Prompt Injection Defense (Untrusted Input Doctrine)
  const { sanitizedText: safeUtterance, injectionDetected } = detectAndNeutralizePromptInjection(patientUtterance);
  if (injectionDetected) {
    console.warn(`[MedVoice Security] Neutralized prompt injection attempt in turn ${turnId}`);
  }

  // 3. Data Minimization (PII Scrubbing)
  const minimizedUtterance = minimizeClinicalDataPII(safeUtterance);

  // 4. Dynamic Age Calculation from DOB
  let ageDisplay = "Unknown";
  if (patientProfile?.dateOfBirth) {
    const calc = calculateAgeFromDOB(patientProfile.dateOfBirth);
    ageDisplay = `${calc.years} years (DOB: ${patientProfile.dateOfBirth})`;
  } else if (demographics.age != null) {
    ageDisplay = `${demographics.age} years (${demographics.age_group})`;
  }

  // 5. Open-World RAG Retrieval Across Evidence Situations
  const evidenceAnalysis = clinicalKnowledgeRetriever.evaluateEvidenceSituation(minimizedUtterance);
  const retrievedPassagesSummary = evidenceAnalysis.passages.map(p => `[${p.title}]: ${p.content.slice(0, 200)}`).join("\n");

  const timelineAnchor = interviewState?.structuredHistory?.timeline?.anchor ||
    (interviewState?.slots?.onset ? `Onset: ${interviewState.slots.onset}` : undefined);
  const unmappedObsStrings = interviewState?.unmappedObservations?.map(o => o.rawEvidence) || [];

  // 6. Build 3-Tier Context System Prompt
  const systemPrompt = buildDoctorSystemPrompt({
    doctor,
    localeConfig,
    callerProfile,
    patientProfile,
    inferredSubject,
    ageDisplay,
    confirmedFacts,
    deniedSymptoms,
    uncertainties,
    isEmergency,
    flags,
    evidenceAnalysis,
    retrievedPassagesSummary,
    primaryEmergencyNumber,
    ambulanceNumber,
    unmappedObservations: unmappedObsStrings,
    timelineAnchor,
    unansweredDimensions: interviewState?.structuredHistory?.unansweredDimensions,
    advisoryInquiryTopic: effectiveInquiry?.topic,
    isClarificationRequest: options.isClarificationRequest,
    clarificationGuidance: options.clarificationGuidance,
  });

  // 7. Token-Budgeted, Loss-Aware Context Assembly (pins Turn 1 anchor + timeline, compresses intermediate turns, retains recent 6 verbatim)
  const messages = assembleLossAwareConversationContext({
    systemPrompt,
    conversationHistory,
    currentUtterance: minimizedUtterance,
    timelineAnchor,
    maxTokensBudget: 2000,
  });

  // 8. Invoke Provider with Telemetry Measurement & 1-Retry on Validator Rejection
  const t0 = Date.now();
  const activeProvider: "groq" | "nvidia" = isGroq ? "groq" : "nvidia";
  let activeModel = isGroq ? groqClient.getDefaultModel() : (process.env.NVIDIA_MODEL || "openai/gpt-oss-20b");

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      let completion: { content: string; model: string; latencyMs: number };

      if (isGroq) {
        const tokenLimit = activeModel.startsWith("openai/") ? 800 : 420;
        try {
          completion = await groqClient.createChatCompletion(messages, {
            model: activeModel,
            max_tokens: tokenLimit,
            temperature: 0.2,
            timeoutMs: 12000,
          });
        } catch (groqErr: any) {
          const backupModel = process.env.GROQ_BACKUP_MODEL || "openai/gpt-oss-120b";
          if (activeModel !== backupModel) {
            console.warn(`[MedVoice AI] Primary model ${activeModel} failed (${groqErr.message}). Retrying with backup model ${backupModel}...`);
            activeModel = backupModel;
            const backupLimit = backupModel.startsWith("openai/") ? 800 : 420;
            completion = await groqClient.createChatCompletion(messages, {
              model: backupModel,
              max_tokens: backupLimit,
              temperature: 0.2,
              timeoutMs: 12000,
            });
          } else {
            throw groqErr;
          }
        }
      } else {
        completion = await nvidiaClient.createChatCompletion(messages, {
          max_tokens: 420,
          temperature: 0.2,
          timeoutMs: 20000,
        });
      }

      const totalLatency = Date.now() - t0;
      activeModel = completion.model;

      // 9. Parse Output
      const parsed = parseAndSanitizeDoctorReply(completion.content, effectiveFallback, demographics);
      if (parsed.rejectedReason) {
        if (attempt === 1) {
          messages.push({ role: "user", content: `Please provide a valid, safe clinical reply in 1-2 spoken sentences adhering to JSON format.` });
          continue;
        }
        return {
          reply: effectiveFallback,
          provider: "fallback",
          responseProvenance: "validated_fallback",
          model: activeModel,
          latencyMs: totalLatency,
          liveGenerated: false,
          fallbackReason: `sanitize_rejected: ${parsed.rejectedReason}`,
          telemetry: {
            provider: "fallback",
            model: activeModel,
            liveGenerated: false,
            latencyMs: totalLatency,
            fallbackUsed: true,
            fallbackReason: parsed.rejectedReason,
            telemetryIntegrityHash: createTelemetryIntegrityHash(turnId, "fallback", activeModel, totalLatency, new Date().toISOString()),
            timestamp: new Date().toISOString(),
          },
        };
      }

      // 9a. Multi-Question Rejection: detect before parse truncates
      if (!isEmergency) {
        let rawResponseText = "";
        try {
          const jsonMatch = completion.content.replace(/<think>[\s\S]*?<\/think>/gi, "").match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const rawJson = JSON.parse(jsonMatch[0]);
            rawResponseText = String(rawJson.patientResponse || rawJson.doctorReply || rawJson.reply || "");
          }
        } catch {}
        if (!rawResponseText) rawResponseText = parsed.cleanReply;

        const rawQuestionCount = (rawResponseText.match(/\?/g) || []).length;
        if (rawQuestionCount > 1) {
          console.warn(`[MedVoice Validator] Multi-question output detected on attempt ${attempt}: ${rawQuestionCount} questions`);
          if (attempt === 1) {
            messages.push({
              role: "user",
              content: `Your response contained ${rawQuestionCount} questions. Ask exactly ONE focused clinical question per turn.`,
            });
            continue;
          }
          return {
            reply: effectiveFallback,
            provider: "fallback",
            responseProvenance: "validated_fallback",
            model: activeModel,
            latencyMs: totalLatency,
            liveGenerated: false,
            fallbackReason: `multi_question_rejected: ${rawQuestionCount} questions detected`,
            telemetry: {
              provider: "fallback",
              model: activeModel,
              liveGenerated: false,
              latencyMs: totalLatency,
              fallbackUsed: true,
              fallbackReason: `multi_question_rejected: ${rawQuestionCount} questions`,
              telemetryIntegrityHash: createTelemetryIntegrityHash(turnId, "fallback", activeModel, totalLatency, new Date().toISOString()),
              timestamp: new Date().toISOString(),
            },
          };
        }
      }

      // 9b. Contextual Target-Slot Validation: ensure question is clinically grounded and satisfies safety invariants
      if (!isEmergency && parsed.cleanReply.includes("?")) {
        const llmDetectedTarget = (parsed.intendedTargets && parsed.intendedTargets[0]) || detectQuestionTargetSlot(parsed.cleanReply, effectiveInquiry?.topic);
        const plannedTopic = effectiveInquiry?.topic ? effectiveInquiry.topic.toLowerCase() : "";
        const detectedTopic = llmDetectedTarget.toLowerCase();

        // Also run mustAvoid/resolved-dimension/relevance check via contextual validator
        const targetValResult = validateDoctorReplyTarget(
          parsed.cleanReply,
          {
            ...plan,
            patientUtterance: safeUtterance,
          },
          interviewState?.slots,
          memory,
          confirmedFacts,
          deniedSymptoms,
        );

        if (!targetValResult.isValid) {
          console.warn(`[MedVoice Validator] Target validation rejected on attempt ${attempt}: ${targetValResult.reason}`);
          if (attempt === 1) {
            messages.push({
              role: "user",
              content: `Correction required: ${targetValResult.reason}. Please ask specifically about an unresolved symptom or clinical dimension.`,
            });
            continue;
          }
          return {
            reply: effectiveFallback,
            provider: "fallback",
            responseProvenance: "validated_fallback",
            model: activeModel,
            latencyMs: totalLatency,
            liveGenerated: false,
            fallbackReason: `target_slot_mismatch: ${targetValResult.reason}`,
            intendedTargets: [plannedTopic || "symptoms"],
            telemetry: {
              provider: "fallback",
              model: activeModel,
              liveGenerated: false,
              latencyMs: totalLatency,
              fallbackUsed: true,
              fallbackReason: `target_slot_mismatch: ${detectedTopic} vs ${plannedTopic}`,
              telemetryIntegrityHash: createTelemetryIntegrityHash(turnId, "fallback", activeModel, totalLatency, new Date().toISOString()),
              timestamp: new Date().toISOString(),
            },
          };
        }
      }

      // 10. Strict Deterministic Response Validator
      const valCheck = validateDoctorTurnResponse(
        parsed.cleanReply,
        patientUtterance,
        inferredSubject,
        isEmergency,
        primaryEmergencyNumber,
        ambulanceNumber
      );

      if (!valCheck.isValid) {
        console.warn(`[MedVoice Validator] Validation failed on attempt ${attempt}: ${valCheck.reason}`);
        if (attempt === 1) {
          // 1-Retry with explicit validation guidance
          messages.push({
            role: "user",
            content: `Correction required: ${valCheck.reason}. Please regenerate preserving correct subject attribution, symptom provenance, and emergency instructions.`,
          });
          continue;
        }

        // Retry exhausted: calibrated context-preserving fallback
        return {
          reply: effectiveFallback,
          provider: "fallback",
          responseProvenance: "validated_fallback",
          model: activeModel,
          latencyMs: totalLatency,
          liveGenerated: false,
          fallbackReason: `validator_rejected: ${valCheck.reason}`,
          telemetry: {
            provider: "fallback",
            model: activeModel,
            liveGenerated: false,
            latencyMs: totalLatency,
            fallbackUsed: true,
            fallbackReason: valCheck.reason,
            telemetryIntegrityHash: createTelemetryIntegrityHash(turnId, "fallback", activeModel, totalLatency, new Date().toISOString()),
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Surface candidate safety concern if model identified one
      if (parsed.candidateSafetyConcern && onCandidateSafetyConcern) {
        onCandidateSafetyConcern(parsed.candidateSafetyConcern);
      }

      const serverTimestamp = new Date().toISOString();
      const integrityHash = createTelemetryIntegrityHash(turnId, activeProvider, activeModel, totalLatency, serverTimestamp);

      return {
        reply: parsed.cleanReply,
        provider: activeProvider,
        responseProvenance: "llm_generative_dialogue",
        model: activeModel,
        latencyMs: totalLatency,
        liveGenerated: true,
        understoodContext: parsed.understoodContext,
        conversationalAction: parsed.conversationalAction || "INQUIRE",
        candidateFacts: parsed.candidateFacts,
        unmappedObservations: parsed.unmappedObservations,
        intendedTargets: parsed.intendedTargets,
        candidateSafetyConcern: parsed.candidateSafetyConcern,
        telemetry: {
          provider: activeProvider,
          model: activeModel,
          liveGenerated: true,
          latencyMs: totalLatency,
          fallbackUsed: false,
          telemetryIntegrityHash: integrityHash,
          timestamp: serverTimestamp,
        },
      };
    } catch (err: any) {
      console.warn(`[MedVoice AI Error] Provider call failed on attempt ${attempt}: ${err.message}`);
      if (attempt === 1 && !err.message?.includes("429")) {
        continue;
      }
      break;
    }
  }

  // Final fallback if network/model failed
  const finalLatency = Date.now() - t0;
  const fallbackTs = new Date().toISOString();
  return {
    reply: effectiveFallback,
    provider: "fallback",
    responseProvenance: "validated_fallback",
    model: activeModel,
    latencyMs: finalLatency,
    liveGenerated: false,
    fallbackReason: "provider_unavailable",
    telemetry: {
      provider: "fallback",
      model: activeModel,
      liveGenerated: false,
      latencyMs: finalLatency,
      fallbackUsed: true,
      fallbackReason: "provider_unavailable",
      telemetryIntegrityHash: createTelemetryIntegrityHash(turnId, "fallback", activeModel, finalLatency, fallbackTs),
      timestamp: fallbackTs,
    },
  };
}
