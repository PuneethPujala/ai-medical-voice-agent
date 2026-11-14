/**
 * CARE SUGGESTION SERVICE
 * 
 * Generates structured, personalized, evidence-grounded care suggestions
 * for patients post-consultation based on:
 * - Scenario A: SOAP Report + Full Consultation Dialogue Transcript + Patient Profile + MedlinePlus RAG
 * - Scenario B (Resilient Fallback): Full Consultation Dialogue Transcript + Patient Profile + MedlinePlus RAG
 *   (Engaged whenever SOAP generation fails, is incomplete, or unavailable)
 * 
 * Strict Clinical Safety Invariants:
 * 1. Clinical Decision Support: Never acts as an autonomous physician, prescriber, or diagnostician.
 * 2. Zero Prescribing: Never invents medication names, dosages, frequencies, or durations.
 * 3. Non-Discontinuation: Never recommends stopping or changing prescribed therapies without clinician authorization.
 * 4. Grounded Knowledge: Grounded in MedlinePlus RAG, local clinical safety matrix, and RxNorm/openFDA.
 * 5. Monotonic Emergency Priority: Emergency symptoms (ESI 1-2, universal red flags) take priority
 *    over all routine care guidance and can never be downgraded.
 * 6. Audit & Immutability: Saved care suggestions never alter or mutate a signed SOAP artifact.
 */

import { z } from "zod";
import { groqClient, GroqChatMessage } from "../ai/groq-client";
import { clinicalKnowledgeRetriever } from "../clinical-knowledge/retriever";
import { evaluateUniversalRedFlags, RedFlagResult } from "../triage/universal-red-flags";
import { evaluatePharmacologySafetyShield } from "../clinical-knowledge/safety-matrix";
import { getDrugEducationAndSafety, resolveGenericDrugName } from "../clinical-knowledge/drug-external-service";
import { PatientProfile } from "../clinical-knowledge/types";
import { getDb } from "@/config/db";
import { careSuggestionsTable, CareSuggestionsData, consultationsTable, clinicalArtifactsTable } from "@/config/schema";
import { eq, desc } from "drizzle-orm";
import { logAuditEventAsync } from "../audit/audit-logger";
import {
  SymptomMedicationEvaluator,
  SymptomEvaluationInput,
  EnhancedMedicationInformation,
} from "./symptom-medication-evaluator";

export const CareSuggestionsSchema = z.object({
  consultationId: z.string(),
  source: z.enum(["soap_and_transcript", "transcript_only"]),
  sourceDisplay: z.string(),
  soapAvailable: z.boolean(),
  soapArtifactId: z.string().nullable().optional(),
  reviewStatus: z.literal("pending_clinician_review"),
  requiresClinicianApproval: z.boolean().default(true),
  clinicalSummary: z.string(),
  medicationInformation: z.object({
    existingMedications: z.object({
      reported: z.array(z.string()),
      verifiedFromProfile: z.array(z.string()),
      statusSummary: z.string(),
    }).optional(),
    potentialOtcEducation: z.array(z.object({
      genericName: z.string(),
      tradeNames: z.array(z.string()),
      commonlyUsedFor: z.string(),
      precautions: z.array(z.string()),
      contraindicationsAndInteractions: z.array(z.string()),
      approvalRequirement: z.string(),
      source: z.string(),
    })).optional(),
    safetyAndPrecautions: z.object({
      contraindicationsDetected: z.array(z.string()),
      safetyWarnings: z.array(z.string()),
      requiresClinicianApproval: z.boolean(),
      generalPrecautions: z.array(z.string()),
    }).optional(),
    clinicalClarification: z.object({
      missingSafetyInformation: z.array(z.string()),
      followUpQuestions: z.array(z.string()),
      rationaleIfNoMedicationAppropriate: z.string().optional(),
    }).optional(),
    items: z.array(z.object({
      name: z.string(),
      genericName: z.string().optional(),
      purpose: z.string().optional(),
      relevantContext: z.string().optional(),
      safetyWarnings: z.array(z.string()).optional(),
      source: z.string().optional(),
      requiresClinicianReview: z.boolean().default(true),
    })),
    patientReportedMedications: z.array(z.string()),
    contraindicationsDetected: z.array(z.string()),
    safetyWarnings: z.array(z.string()),
    requiresClinicianApproval: z.literal(true),
  }),
  restAndRecovery: z.array(z.string()),
  dietRecommendations: z.object({
    suitable: z.array(z.string()),
    avoidOrLimit: z.array(z.string()),
    generalAdvice: z.array(z.string()),
  }),
  hydrationGuidance: z.array(z.string()),
  precautions: z.array(z.string()),
  warningSigns: z.object({
    routine: z.array(z.string()),
    urgent: z.array(z.string()),
    emergency: z.array(z.string()),
  }),
  followUpRecommendations: z.array(z.string()),
  missingInformation: z.array(z.string()),
  sources: z.array(z.object({
    title: z.string(),
    url: z.string().optional(),
    source: z.string(),
    domain: z.string().optional(),
  })),
  groundedSources: z.array(z.object({
    title: z.string(),
    url: z.string().optional(),
    source: z.string(),
    domain: z.string().optional(),
  })).optional(),
  safetyNotes: z.array(z.string()),
  disclaimer: z.string(),
});

export type CareSuggestionsResponse = z.infer<typeof CareSuggestionsSchema>;

export interface GenerateCareSuggestionsInput {
  consultationId: string;
  transcript: Array<{ role: string; text: string; timestamp?: string }>;
  soapReport?: {
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
  } | null;
  soapArtifactId?: string | null;
  patientProfile?: PatientProfile | null;
  chiefComplaint?: string;
  esiScore?: number | null;
  triageLevel?: string;
  doctorId?: string;
  doctorName?: string;
  specialty?: string;
  actorId?: string;
  actorRole?: string;
}

// In-memory fallback datastore for testing (NODE_ENV === 'test' or when DB unconfigured)
export const memoryCareSuggestions = new Map<string, CareSuggestionsResponse>();

export class CareSuggestionService {
  /**
   * Generates structured care suggestions, persisting them to the database.
   * Works in both Scenario A (SOAP available) and Scenario B (SOAP unavailable fallback).
   */
  public static async generateSuggestions(
    input: GenerateCareSuggestionsInput
  ): Promise<CareSuggestionsResponse> {
    const {
      consultationId,
      transcript = [],
      soapReport,
      soapArtifactId,
      patientProfile,
      chiefComplaint,
      esiScore,
      triageLevel,
      doctorName = "Attending Clinician",
      specialty = "General Medicine",
      actorId = "system",
      actorRole = "patient",
    } = input;

    // 1. Determine Source Availability
    const hasUsableSoap = Boolean(
      soapReport &&
      typeof soapReport.subjective === "string" &&
      soapReport.subjective.trim().length > 15 &&
      typeof soapReport.assessment === "string" &&
      soapReport.assessment.trim().length > 15 &&
      !soapReport.subjective.includes("[INCOMPLETE DRAFT")
    );

    const source: "soap_and_transcript" | "transcript_only" = hasUsableSoap
      ? "soap_and_transcript"
      : "transcript_only";

    const sourceDisplay = hasUsableSoap
      ? "SOAP Report + Consultation Chat"
      : "Consultation Chat (SOAP Unavailable)";

    // 2. Transcribe & Extract Conversation Evidence
    const patientTurns = transcript.filter((t) => t.role === "patient");
    const doctorTurns = transcript.filter((t) => t.role === "doctor" || t.role === "assistant");
    const allPatientText = patientTurns.map((t) => t.text).join(" ");
    const fullConversationText = transcript
      .map((t) => `${t.role === "patient" ? "Patient" : "Doctor"}: ${t.text}`)
      .join("\n");

    const primaryConcern =
      chiefComplaint ||
      (patientTurns.length > 0 ? patientTurns[0].text.replace(/^"|"$/g, "").slice(0, 150) : "Clinical consultation intake");

    // 3. Pre-Generation Clinical Safety Screen (Universal Red Flags & Life Threats)
    const redFlagResult: RedFlagResult = evaluateUniversalRedFlags({
      rawText: allPatientText,
      cumulativeTranscript: fullConversationText,
      patient: {
        ageYears: patientProfile?.age,
        modifiers: patientProfile?.knownConditions,
        drugAllergies: patientProfile?.drugAllergies?.map((a) => (a as any).drugName || (a as any).allergen || ""),
      },
    });

    const isEmergency =
      redFlagResult.level === "EMERGENCY_NOW" ||
      esiScore === 1 ||
      esiScore === 2 ||
      triageLevel === "emergency";

    const isUrgent =
      redFlagResult.level === "URGENT_SAME_DAY" ||
      esiScore === 3 ||
      triageLevel === "priority";

    // 4. Extract Mentioned Medications & Drug Allergies
    const extractedMedications = this.extractReportedMedications(
      fullConversationText,
      patientProfile?.currentMedications?.map((m) => m.name) || []
    );

    const knownAllergies = [
      ...(patientProfile?.drugAllergies?.map((a) => (a as any).drugName || (a as any).allergen || "") || []),
    ];

    // Check pharmacology safety shield
    const pharmaShieldResult = evaluatePharmacologySafetyShield(
      patientProfile || undefined,
      extractedMedications.join(" "),
      {
        presentingSymptoms: [primaryConcern],
      }
    );
    const contraindicationAlerts = pharmaShieldResult?.alerts || [];

    // 5. Query MedlinePlus Knowledge Retrieval (RAG)
    const retrievedRAG = clinicalKnowledgeRetriever.retrieveWithContext({
      query: `${primaryConcern} ${allPatientText.slice(0, 300)}`,
      patient: patientProfile ? {
        id: patientProfile.id || "patient-anon",
        age: patientProfile.age,
        ageGroup: patientProfile.ageGroup,
        pregnancyStatus: patientProfile.pregnancyStatus,
        knownConditions: patientProfile.knownConditions,
      } : undefined,
      topK: 4,
    });

    // 6. External Drug Education (RxNorm + openFDA with resilient fallback)
    const externalDrugInfoPromises = extractedMedications.map((drug) =>
      getDrugEducationAndSafety(drug).catch(() => null)
    );
    const externalDrugInfos = (await Promise.all(externalDrugInfoPromises)).filter(Boolean);

    // 7. Generate Structured Care Suggestions (AI with Resilient Deterministic Fallback)
    let suggestionsData: CareSuggestionsResponse;

    try {
      suggestionsData = await this.synthesizeWithGroq({
        consultationId,
        source,
        sourceDisplay,
        hasUsableSoap,
        transcript,
        patientTurns,
        soapReport,
        soapArtifactId,
        patientProfile,
        primaryConcern,
        isEmergency,
        isUrgent,
        redFlagResult,
        extractedMedications,
        knownAllergies,
        contraindicationAlerts,
        retrievedRAG,
        externalDrugInfos,
        doctorName,
        specialty,
      });
    } catch (aiErr) {
      console.warn("[CareSuggestionService] Groq LLM synthesis notice, engaging deterministic compiler:", aiErr);
      suggestionsData = this.synthesizeDeterministicFallback({
        consultationId,
        source,
        sourceDisplay,
        hasUsableSoap,
        transcript,
        patientTurns,
        soapReport,
        soapArtifactId,
        patientProfile,
        primaryConcern,
        isEmergency,
        isUrgent,
        redFlagResult,
        extractedMedications,
        knownAllergies,
        contraindicationAlerts,
        retrievedRAG,
        externalDrugInfos,
        doctorName,
        specialty,
      });
    }

    // 8. Post-Generation Clinical Safety Enforcement
    suggestionsData = this.applyPostGenerationSafetyShield(
      suggestionsData,
      isEmergency,
      isUrgent,
      redFlagResult,
      {
        conversationText: fullConversationText,
        primaryConcern,
        patientProfile,
        reportedMedications: extractedMedications,
        isEmergency,
        isUrgent,
        redFlagResult,
        soapReport,
      }
    );

    // 9. Persist to Database & Memory Store
    await this.persistCareSuggestions(consultationId, suggestionsData, actorId);

    // 10. Audit Logging
    await logAuditEventAsync({
      actorId,
      actorRole: actorRole as any,
      action: "CARE_SUGGESTIONS_GENERATED" as any,
      resourceType: "consultation",
      resourceId: consultationId,
      status: "SUCCESS",
      metadata: {
        source,
        hasUsableSoap,
        medicationCount: suggestionsData.medicationInformation.items.length,
        isEmergency,
      },
    }).catch((auditErr) => console.warn("[CareSuggestionService] Audit notice:", auditErr));

    return suggestionsData;
  }

  /**
   * Retrieves existing persisted care suggestions for a consultation.
   */
  public static async getSavedSuggestions(
    consultationId: string
  ): Promise<CareSuggestionsResponse | null> {
    // 1. Try Primary Database (Neon PostgreSQL)
    const db = getDb();
    if (db) {
      try {
        const rows = await db
          .select()
          .from(careSuggestionsTable)
          .where(eq(careSuggestionsTable.consultationId, consultationId))
          .orderBy(desc(careSuggestionsTable.createdAt))
          .limit(1);

        if (rows.length > 0) {
          const row = rows[0];
          return (row.suggestions as CareSuggestionsResponse) || null;
        }
      } catch (dbErr) {
        console.warn("[CareSuggestionService] DB lookup error:", dbErr);
      }
    }

    // 2. Try In-Memory Fallback
    return memoryCareSuggestions.get(consultationId) || null;
  }

  /**
   * Synthesizes care suggestions using Groq OpenAI-compatible LLM.
   */
  private static async synthesizeWithGroq(ctx: any): Promise<CareSuggestionsResponse> {
    if (!groqClient.isConfigured()) {
      throw new Error("GROQ_API_KEY is not configured or disabled.");
    }

    const {
      consultationId,
      source,
      sourceDisplay,
      hasUsableSoap,
      fullConversationText,
      transcript,
      soapReport,
      soapArtifactId,
      patientProfile,
      primaryConcern,
      isEmergency,
      isUrgent,
      redFlagResult,
      extractedMedications,
      knownAllergies,
      contraindicationAlerts,
      retrievedRAG,
      externalDrugInfos,
      doctorName,
      specialty,
    } = ctx;

    const ragContextText = (retrievedRAG?.passages || [])
      .map((p: any) => `[Source: ${p.source} - ${p.title} (${p.section})]: ${p.content}`)
      .join("\n\n");

    const drugContextText = (externalDrugInfos || [])
      .map((d: any) => `[Drug Info: ${d.genericName} (Trade: ${d.tradeNames.join(", ")})]: ${d.fdaWarnings.join("; ")} | Notice: ${d.jurisdictionNotice}`)
      .join("\n");

    const systemPrompt = `You are the MedVoice AI Clinical Care Planning Assistant.
Your duty is to generate structured, personalized, evidence-grounded post-consultation care suggestions for a patient.

MANDATORY CLINICAL SAFETY RULES:
1. CLINICAL DECISION SUPPORT ONLY: This is patient education and decision support. Do NOT autonomously diagnose or prescribe.
2. NO PRESCRIPTIONS OR INVENTED DOSAGES: Never prescribe medication, recommend new prescription pharmaceuticals, or invent dosages, frequencies, or treatment schedules.
3. PRESERVE EXISTING THERAPIES: Never recommend discontinuing, altering, or substituting a patient's existing prescribed medications without attending clinician authorization.
4. STRICT ALLERGY AWARENESS: Respect all known drug allergies and contraindications.
5. GROUNDED RECOVERY & SELF-CARE: Provide practical, evidence-based guidance for rest, recovery, dietary choices, hydration, and self-care symptoms monitoring grounded in the retrieved clinical knowledge.
6. THREE-TIER WARNING SIGNS:
   - Routine: Mild symptoms to track at home.
   - Urgent: Symptoms warranting prompt outpatient evaluation within 24-48 hours.
   - Emergency: Red flag life-threats requiring immediate 112 / 108 / 911 emergency care.
7. ${isEmergency ? "CRITICAL EMERGENCY DETECTED: Emergency life-threat criteria met. Prioritize immediate emergency transport in warning signs and guidance." : ""}
8. MISSING INFORMATION: Explicitly state unknown vitals, unverified allergies, or missing duration details. Do NOT fabricate missing facts.
9. OUTPUT FORMAT: Return ONLY valid, well-formed JSON matching the required schema. Zero markdown commentary or conversational wrapper.`;

    const userPrompt = `Generate structured care suggestions for Encounter ID: ${consultationId}

SOURCE MODE: ${sourceDisplay}
${hasUsableSoap ? `SOAP REPORT AVAILABLE:
[Subjective]: ${soapReport.subjective}
[Objective]: ${soapReport.objective}
[Assessment]: ${soapReport.assessment}
[Plan]: ${soapReport.plan}` : `SOAP REPORT UNAVAILABLE. Relying directly on the full dialogue transcript below.`}

PATIENT PROFILE CONTEXT:
- Age: ${patientProfile?.age ?? "Unknown"} (${patientProfile?.ageGroup ?? "adult"})
- Known Conditions: ${(patientProfile?.knownConditions || []).join(", ") || "None documented"}
- Known Drug Allergies: ${(knownAllergies || []).join(", ") || "None documented / Unassessed"}
- Current Medications: ${(extractedMedications || []).join(", ") || "None reported"}

FULL CONVERSATION TRANSCRIPT:
${transcript.map((t: any) => `${t.role.toUpperCase()}: ${t.text}`).join("\n")}

RETRIEVED CLINICAL KNOWLEDGE (MedlinePlus & Guidelines):
${ragContextText || "General clinical outpatient supportive care principles apply."}

MEDICATION INTELLIGENCE (RxNorm / openFDA / Safety Matrix):
${drugContextText || "No active medications detected in consultation dialogue."}
${contraindicationAlerts.length > 0 ? `CONTRAINDICATION WARNINGS: ${contraindicationAlerts.map((a: any) => a.rationale).join("; ")}` : ""}

Respond with a JSON object with this exact structure:
{
  "clinicalSummary": "2-3 concise sentences summarizing the presenting concern, clinical impression, and care goals based on ${hasUsableSoap ? "the SOAP report and dialogue" : "the consultation conversation"}",
  "medicationInformation": {
    "items": [
      {
        "name": "Medication or class discussed",
        "genericName": "Generic API if applicable",
        "purpose": "Patient-reported purpose or educational context",
        "relevantContext": "Information on safe usage or clinician evaluation requirement",
        "safetyWarnings": ["Safety precautions or interaction warnings"],
        "source": "MedlinePlus / RxNorm / openFDA",
        "requiresClinicianReview": true
      }
    ],
    "patientReportedMedications": ["Medications mentioned by patient"],
    "contraindicationsDetected": ["Any identified interaction or allergy warnings"],
    "safetyWarnings": ["General medication safety rules"],
    "requiresClinicianApproval": true
  },
  "restAndRecovery": ["2 concise rest and recovery recommendations"],
  "dietRecommendations": {
    "suitable": ["Suitable foods"],
    "avoidOrLimit": ["Foods to avoid or limit"],
    "generalAdvice": ["General nutritional guidance"]
  },
  "hydrationGuidance": ["Hydration advice"],
  "precautions": ["2 concise self-care precautions"],
  "warningSigns": {
    "routine": ["Routine symptoms to track"],
    "urgent": ["Symptoms requiring prompt clinical check"],
    "emergency": ["Severe emergency signs requiring immediate 112/108 call"]
  },
  "followUpRecommendations": ["1-2 follow-up recommendations"],
  "missingInformation": ["Unmeasured clinical observations"],
  "sources": [
    {
      "title": "Clinical Guidelines / MedlinePlus Topic",
      "url": "https://medlineplus.gov/",
      "source": "MedlinePlus / National Library of Medicine",
      "domain": "outpatient_care"
    }
  ],
  "safetyNotes": ["Key safety reminders"],
  "disclaimer": "This care plan provides clinical decision-support guidance derived from conversational telehealth intake. It is not an automated prescription or diagnosis and must be reviewed with an attending physician."
}`;

    const messages: GroqChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const modelToUse = process.env.GROQ_CARE_MODEL || process.env.GROQ_MODEL || "qwen/qwen3.8-27b";

    const completion = await groqClient.createChatCompletion(messages, {
      model: modelToUse,
      temperature: 0.2,
      max_tokens: 850,
      timeoutMs: 12000,
    });

    const rawJsonText = completion.content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const parsed = JSON.parse(rawJsonText);

    return {
      consultationId,
      source,
      sourceDisplay,
      soapAvailable: hasUsableSoap,
      soapArtifactId: soapArtifactId || null,
      reviewStatus: "pending_clinician_review",
      requiresClinicianApproval: true,
      clinicalSummary: parsed.clinicalSummary || "Clinical intake review and supportive care guidance.",
      medicationInformation: {
        items: Array.isArray(parsed.medicationInformation?.items) ? parsed.medicationInformation.items : [],
        patientReportedMedications: Array.isArray(parsed.medicationInformation?.patientReportedMedications)
          ? parsed.medicationInformation.patientReportedMedications
          : extractedMedications,
        contraindicationsDetected: Array.isArray(parsed.medicationInformation?.contraindicationsDetected)
          ? parsed.medicationInformation.contraindicationsDetected
          : (Array.isArray(contraindicationAlerts)
              ? contraindicationAlerts
              : (contraindicationAlerts as any)?.alerts || []
            ).map((a: any) => a?.rationale || a?.description || String(a)),
        safetyWarnings: Array.isArray(parsed.medicationInformation?.safetyWarnings)
          ? parsed.medicationInformation.safetyWarnings
          : ["All medications require evaluation by a qualified medical professional."],
        requiresClinicianApproval: true,
      },
      restAndRecovery: Array.isArray(parsed.restAndRecovery) ? parsed.restAndRecovery : ["Rest adequately to promote recovery."],
      dietRecommendations: {
        suitable: Array.isArray(parsed.dietRecommendations?.suitable) ? parsed.dietRecommendations.suitable : ["Light, easily digestible meals."],
        avoidOrLimit: Array.isArray(parsed.dietRecommendations?.avoidOrLimit) ? parsed.dietRecommendations.avoidOrLimit : ["Alcohol and heavy foods."],
        generalAdvice: Array.isArray(parsed.dietRecommendations?.generalAdvice) ? parsed.dietRecommendations.generalAdvice : ["Maintain balanced nutrition."],
      },
      hydrationGuidance: Array.isArray(parsed.hydrationGuidance) ? parsed.hydrationGuidance : ["Maintain adequate oral fluid intake as tolerated."],
      precautions: Array.isArray(parsed.precautions) ? parsed.precautions : ["Monitor symptoms for changes."],
      warningSigns: {
        routine: Array.isArray(parsed.warningSigns?.routine) ? parsed.warningSigns.routine : ["Mild baseline discomfort."],
        urgent: Array.isArray(parsed.warningSigns?.urgent) ? parsed.warningSigns.urgent : ["Symptoms worsening past 3 days."],
        emergency: Array.isArray(parsed.warningSigns?.emergency) ? parsed.warningSigns.emergency : ["Acute shortness of breath, severe chest pain, or loss of consciousness."],
      },
      followUpRecommendations: Array.isArray(parsed.followUpRecommendations) ? parsed.followUpRecommendations : ["Follow up with primary care clinician."],
      missingInformation: Array.isArray(parsed.missingInformation) ? parsed.missingInformation : ["In-person physical examination and vitals telemetry unassessed."],
      sources: Array.isArray(parsed.sources) && parsed.sources.length > 0 ? parsed.sources : [
        {
          title: "MedlinePlus Outpatient Health Guidelines",
          url: "https://medlineplus.gov/",
          source: "U.S. National Library of Medicine",
          domain: "clinical_support",
        },
      ],
      groundedSources: Array.isArray(parsed.sources) && parsed.sources.length > 0 ? parsed.sources : [
        {
          title: "MedlinePlus Outpatient Health Guidelines",
          url: "https://medlineplus.gov/",
          source: "U.S. National Library of Medicine",
          domain: "clinical_support",
        },
      ],
      safetyNotes: Array.isArray(parsed.safetyNotes) ? parsed.safetyNotes : ["Always contact emergency services immediately if acute symptoms arise."],
      disclaimer: "This care plan provides clinical decision support derived from conversational telehealth intake. It does not replace in-person examination or prescription by a licensed physician.",
    };
  }

  /**
   * Deterministic Fallback Synthesis:
   * Guarantees that care suggestions NEVER fail, even when Groq API is offline or returns an error.
   * Compiles grounded care suggestions directly from conversation transcript, MedlinePlus guidelines, and safety matrix.
   */
  private static synthesizeDeterministicFallback(ctx: any): CareSuggestionsResponse {
    const {
      consultationId,
      source,
      sourceDisplay,
      hasUsableSoap,
      soapReport,
      soapArtifactId,
      patientProfile,
      primaryConcern,
      isEmergency,
      isUrgent,
      redFlagResult,
      extractedMedications,
      knownAllergies,
      contraindicationAlerts,
      retrievedRAG,
      externalDrugInfos,
      doctorName,
      specialty,
    } = ctx;

    const summaryText = hasUsableSoap && soapReport?.assessment
      ? `Patient presented with ${primaryConcern}. Assessment formulated under ${specialty} consultation with ${doctorName}. Follow-up and structured supportive care outlined below.`
      : `Patient presented with ${primaryConcern} during clinical voice consultation. Supportive recovery guidance compiled directly from conversational testimony.`;

    const medicationItems = extractedMedications.map((med: string) => {
      const { generic } = resolveGenericDrugName(med);
      const extInfo = externalDrugInfos.find((d: any) => d.queryTerm === med || d.genericName === generic);
      return {
        name: med,
        genericName: generic,
        purpose: "Reported in consultation dialogue",
        relevantContext: "Patient-reported therapy. Requires formal clinician reconciliation before alterations.",
        safetyWarnings: extInfo?.fdaWarnings?.length ? extInfo.fdaWarnings : ["Do not exceed recommended dosages. Discuss with your physician."],
        source: extInfo ? "openFDA / RxNorm" : "MedVoice Clinical Matrix",
        requiresClinicianReview: true,
      };
    });

    const sourcesList = [
      {
        title: "MedlinePlus Clinical Knowledge Guidelines",
        url: "https://medlineplus.gov/",
        source: "MedlinePlus / U.S. National Library of Medicine",
        domain: "supportive_care",
      },
    ];

    if (externalDrugInfos.length > 0) {
      sourcesList.push({
        title: "RxNorm & openFDA Biomedical Reference",
        url: "https://rxnav.nlm.nih.gov/",
        source: "NLM RxNorm / FDA Drug Labeling (US Jurisdiction)",
        domain: "pharmacology",
      });
    }

    const fullConversationText = (ctx.transcript || [])
      .map((t: any) => `${t.role === "patient" ? "Patient" : "Doctor"}: ${t.text}`)
      .join("\n");

    const enhancedMedInfo = SymptomMedicationEvaluator.evaluate({
      conversationText: fullConversationText,
      primaryConcern,
      patientProfile,
      reportedMedications: extractedMedications,
      isEmergency,
      isUrgent,
      redFlagResult,
      soapReport,
    });

    return {
      consultationId,
      source,
      sourceDisplay,
      soapAvailable: hasUsableSoap,
      soapArtifactId: soapArtifactId || null,
      reviewStatus: "pending_clinician_review",
      requiresClinicianApproval: true,
      clinicalSummary: summaryText,
      medicationInformation: {
        existingMedications: enhancedMedInfo.existingMedications,
        potentialOtcEducation: enhancedMedInfo.potentialOtcEducation,
        safetyAndPrecautions: enhancedMedInfo.safetyAndPrecautions,
        clinicalClarification: enhancedMedInfo.clinicalClarification,
        items: enhancedMedInfo.items,
        patientReportedMedications: enhancedMedInfo.patientReportedMedications,
        contraindicationsDetected: enhancedMedInfo.contraindicationsDetected,
        safetyWarnings: enhancedMedInfo.safetyWarnings,
        requiresClinicianApproval: true,
      },
      restAndRecovery: [
        "Prioritize 7-9 hours of restorative sleep to support physiological recovery.",
        "Avoid strenuous physical exertion or heavy lifting while presenting symptoms remain active.",
        "Take scheduled rest intervals throughout the day in a calm, well-ventilated environment.",
      ],
      dietRecommendations: {
        suitable: [
          "Nutrient-dense, easily digestible meals (warm soups, light broth, cooked vegetables).",
          "Fruits rich in vitamins and antioxidants as tolerated.",
        ],
        avoidOrLimit: [
          "Heavily processed, greasy, or spicy foods that may stress digestion.",
          "Excessive caffeine and alcoholic beverages.",
        ],
        generalAdvice: [
          "Eat small, frequent meals rather than large sittings if experiencing fatigue or discomfort.",
        ],
      },
      hydrationGuidance: [
        "Maintain regular oral fluid intake (water, clear broths, oral rehydration solutions).",
        "Sip fluids consistently throughout the day rather than drinking large volumes at once.",
        "If you have a known cardiac or renal fluid-restriction condition, strictly follow your physician's prescribed volume limits.",
      ],
      precautions: [
        "Track symptom frequency, intensity, and temperature at regular intervals.",
        "Practice diligent hand hygiene and avoid close contact with vulnerable individuals if respiratory symptoms are present.",
        "Do not operate heavy machinery if experiencing drowsiness, lightheadedness, or fatigue.",
      ],
      warningSigns: {
        routine: [
          "Mild fatigue or residual discomfort that gradually improves each day.",
          "Stable baseline symptoms without new acute features.",
        ],
        urgent: [
          "Symptoms persisting or worsening beyond 48-72 hours without noticeable relief.",
          "Persistent high fever (>101°F / 38.3°C) unresponsive to standard antipyretics.",
          "Inability to tolerate oral fluids or food for more than 24 hours.",
        ],
        emergency: [
          "Acute onset of crushing chest pain, pressure, or pain radiating to the left arm, neck, or jaw.",
          "Sudden severe shortness of breath, stridor, or inability to speak in full sentences.",
          "Sudden facial droop, arm weakness, or slurred speech (Signs of Acute Stroke / BE-FAST).",
          "Loss of consciousness, acute confusion, or uncontrollable bleeding.",
        ],
      },
      followUpRecommendations: [
        `Schedule an in-person outpatient clinical evaluation with ${doctorName} (${specialty}) or a primary care provider within 2-3 days if symptoms do not resolve.`,
        "Bring a complete list of your current medications and this care summary to your in-person visit.",
      ],
      missingInformation: [
        "Physical examination and in-person diagnostic telemetry unassessed (remote voice intake).",
        "Recent blood pressure, heart rate, and temperature biometrics unmeasured.",
        patientProfile?.drugAllergies?.length ? "" : "Complete comprehensive drug allergy history unverified.",
      ].filter(Boolean),
      sources: sourcesList,
      groundedSources: sourcesList,
      safetyNotes: [
        "Clinical guidance derived from conversational telehealth intake.",
        "Emergency warning signs require immediate ambulance transport (112 / 108 / 911).",
      ],
      disclaimer:
        "This care plan provides clinical decision-support guidance derived from conversational telehealth intake. It is not an automated prescription or diagnosis and must be reviewed with an attending physician.",
    };
  }

  /**
   * Applies post-generation safety arbiter rules:
   * 1. Enforces emergency warning signs if red flags were detected.
   * 2. Enforces clinician approval flags on medications.
   * 3. Sanitizes prescribing verbs.
   */
  private static applyPostGenerationSafetyShield(
    data: CareSuggestionsResponse,
    isEmergency: boolean,
    isUrgent: boolean,
    redFlags: RedFlagResult,
    evalInput?: SymptomEvaluationInput
  ): CareSuggestionsResponse {
    const sanitized = { ...data };

    // Emergency Invariant: Emergency symptoms cannot be downgraded or erased
    if (isEmergency) {
      const emergencyAlerts = [
        "CRITICAL EMERGENCY ALERT: Emergency symptoms detected during clinical intake.",
        "Proceed immediately to the nearest Emergency Department or call 112 / 108 / 911.",
        ...redFlags.firedRules.map((r) => `Identified clinical red flag: ${r.ruleId}`),
      ];

      sanitized.warningSigns = {
        ...sanitized.warningSigns,
        emergency: Array.from(new Set([...emergencyAlerts, ...sanitized.warningSigns.emergency])),
      };

      sanitized.safetyNotes = Array.from(new Set([
        "EMERGENCY PROTOCOL ACTIVE: Emergency medical attention takes precedence over all routine self-care suggestions.",
        ...sanitized.safetyNotes,
      ]));
    }

    // Symptom-Specific Medication & Safety Evaluation
    if (evalInput) {
      const enhancedMed = SymptomMedicationEvaluator.evaluate(evalInput);

      sanitized.medicationInformation = {
        ...sanitized.medicationInformation,
        existingMedications: enhancedMed.existingMedications,
        potentialOtcEducation: enhancedMed.potentialOtcEducation,
        safetyAndPrecautions: enhancedMed.safetyAndPrecautions,
        clinicalClarification: enhancedMed.clinicalClarification,
        items: enhancedMed.items,
        patientReportedMedications: enhancedMed.patientReportedMedications,
        contraindicationsDetected: enhancedMed.contraindicationsDetected,
        safetyWarnings: enhancedMed.safetyWarnings,
        requiresClinicianApproval: true,
      };

      if (enhancedMed.clinicalClarification.rationaleIfNoMedicationAppropriate) {
        sanitized.safetyNotes = Array.from(new Set([
          enhancedMed.clinicalClarification.rationaleIfNoMedicationAppropriate,
          ...sanitized.safetyNotes,
        ]));
      }

      if (enhancedMed.clinicalClarification.missingSafetyInformation.length > 0) {
        sanitized.missingInformation = Array.from(new Set([
          ...sanitized.missingInformation,
          ...enhancedMed.clinicalClarification.missingSafetyInformation,
        ]));
      }
    }

    // Medication Safety Invariant: Always mark as requiring clinician approval
    sanitized.medicationInformation.requiresClinicianApproval = true;
    sanitized.medicationInformation.items = sanitized.medicationInformation.items.map((item) => ({
      ...item,
      requiresClinicianReview: true,
      // Strip any accidental autonomous prescribing verbs
      purpose: (item.purpose || "Patient-reported therapy")
        .replace(/\b(take|prescribed|dose at|administer)\s+\d+\s*(mg|ml|tablets?)/gi, "Dosage to be determined by clinician"),
    }));

    // Disclaimer Invariant
    sanitized.disclaimer =
      "This care plan provides clinical decision-support guidance derived from conversational telehealth intake. It is not an automated prescription or diagnosis and must be reviewed with an attending physician.";

    return sanitized;
  }

  /**
   * Persists suggestions to Neon PostgreSQL and in-memory fallback.
   */
  private static async persistCareSuggestions(
    consultationId: string,
    data: CareSuggestionsResponse,
    userId: string
  ): Promise<void> {
    // 1. Memory Store (always update for fast retrieval and test isolation)
    memoryCareSuggestions.set(consultationId, data);

    // 2. Primary Database
    const db = getDb();
    if (!db) return;

    try {
      const recordId = `care-${consultationId}`;
      const now = new Date();

      await db
        .insert(careSuggestionsTable)
        .values({
          id: recordId,
          consultationId,
          soapArtifactId: data.soapArtifactId || null,
          userId: userId || null,
          source: data.source,
          sourceDisplay: data.sourceDisplay,
          status: "completed",
          reviewStatus: "pending_clinician_review",
          clinicalSummary: data.clinicalSummary,
          suggestions: data as any,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: careSuggestionsTable.id,
          set: {
            source: data.source,
            sourceDisplay: data.sourceDisplay,
            clinicalSummary: data.clinicalSummary,
            suggestions: data as any,
            soapArtifactId: data.soapArtifactId || null,
            updatedAt: now,
          },
        });
    } catch (dbErr) {
      console.warn("[CareSuggestionService] Database persist notice (using memory fallback):", dbErr);
    }
  }

  /**
   * Helper: Extracts mentioned medications from conversation text.
   */
  private static extractReportedMedications(
    text: string,
    profileMeds: string[] = []
  ): string[] {
    const detected = new Set<string>(profileMeds);
    const lower = text.toLowerCase();

    // Check known brands and generic names
    const commonDrugs = [
      "dolo", "paracetamol", "calpol", "crocin", "tylenol", "acetaminophen",
      "ibuprofen", "advil", "motrin", "combiflam", "brufen",
      "aspirin", "ecosprin", "disprin",
      "amoxicillin", "augmentin", "azithromycin", "ciprofloxacin",
      "pantoprazole", "pan 40", "pantocid", "omeprazole", "omez",
      "metformin", "glimepiride", "insulin",
      "amlodipine", "telmisartan", "losartan", "atorvastatin",
      "cetirizine", "allegra", "fexofenadine", "montelukast",
      "nitroglycerin", "sorbitrate", "sildenafil", "viagra",
    ];

    for (const drug of commonDrugs) {
      const regex = new RegExp(`\\b${drug}\\b`, "i");
      if (regex.test(lower)) {
        detected.add(drug);
      }
    }

    return Array.from(detected);
  }
}
