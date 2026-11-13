import { NextResponse } from "next/server";
import { clinicalBoard } from "@/lib/agents/clinical-board";
import { buildProvenanceEvidenceFromClinicalState } from "@/lib/agents/provenance";
import { PatientCase } from "@/lib/agents/schemas";
import { getAuthContext } from "@/lib/auth/rbac";
import { getDb } from "@/config/db";
import { consultationsTable } from "@/config/schema";
import { memoryConsultations } from "../route";
import { eq } from "drizzle-orm";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";

export async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    const body = await request.json().catch(() => ({}));

    // Authentication check: allow authenticated users and demo mode
    if (auth.userId === "unauthenticated" && !auth.isDemoMode) {
      return NextResponse.json(
        { success: false, error: "Authentication required to evaluate consultation.", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const {
      encounterId,
      patientName = "Patient",
      patientAge,
      patientGender,
      doctorId = "dr-sarah-chen",
      messages = [],
      interviewState,
      speechFeatures,
      persist = true,
      durationSeconds = 0,
    } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one message is required to evaluate clinical consultation.", code: "EMPTY_MESSAGES" },
        { status: 400 }
      );
    }

    // Build cumulative transcript
    const cumulativeTranscript = messages
      .map((m: any) => `${m.role === "patient" ? (patientName || "Patient") : "Doctor"}: ${m.text}`)
      .join("\n");

    const patientUtterances = messages.filter((m: any) => m.role === "patient");
    const chiefComplaint = patientUtterances[0]?.text?.replace(/^"|"$/g, "") || "Clinical symptom consultation";

    // Extract symptoms/facts
    const knownFacts: string[] = Array.isArray(interviewState?.slots?.known_facts) && interviewState.slots.known_facts.length > 0
      ? interviewState.slots.known_facts
      : [chiefComplaint];

    const ageNum = patientAge ? parseInt(String(patientAge), 10) : undefined;
    const ageGroup = (ageNum !== undefined && !isNaN(ageNum))
      ? (ageNum < 1 ? "infant" : ageNum < 18 ? "pediatric" : ageNum > 65 ? "older_adult" : "adult")
      : "adult";

    // Build provenance evidence
    const patientId = encounterId || `PT-${Date.now().toString().slice(-4)}`;
    const provenanceEvidence = interviewState
      ? buildProvenanceEvidenceFromClinicalState({
          state: interviewState,
          speechFeatures: speechFeatures || undefined,
          vitals: {},
          transcript: cumulativeTranscript,
          patientName,
          patientId,
        })
      : [];

    const patientCase: PatientCase = {
      patient_id: patientId,
      patient_name: patientName,
      transcript: cumulativeTranscript,
      conversation_history: messages.map((m: any) => ({
        role: (m.role === "patient" ? "patient" : "doctor") as "doctor" | "patient" | "system",
        text: m.text,
        timestamp: m.timestamp,
      })),
      demographics: {
        age: ageNum,
        age_group: ageGroup as any,
        gender: patientGender === "male" || patientGender === "female" ? patientGender : "other",
      },
      detected_symptoms: knownFacts,
      vitals: {},
      speech_features: speechFeatures || undefined,
      pre_safety_flags: [],
      immediate_danger_detected: false,
      provenance_evidence: provenanceEvidence,
      case_version: interviewState?.caseVersion || 1,
    };

    // Execute multi-agent clinical board evaluation
    const boardOutput = await clinicalBoard.evaluate(patientCase);
    const soapNote = boardOutput.soap_note;

    const finalEsiLevel = boardOutput.post_arbiter.final_esi_level;
    const triageLevel = finalEsiLevel <= 2 ? "emergency" : (finalEsiLevel === 3 ? "priority" : "routine");
    const triageTitle = boardOutput.post_arbiter.final_esi_title || "Clinical Voice Consultation Evaluation";

    const triage = {
      triageLevel,
      triageTitle,
      esiScore: finalEsiLevel,
      isEmergency: finalEsiLevel <= 2,
      arbiterOverride: boardOutput.post_arbiter.arbiter_override_applied,
      overrideRationale: boardOutput.post_arbiter.override_rationale,
      redFlagsTriggered: boardOutput.post_arbiter.red_flags,
      detectedSymptoms: boardOutput.consensus.key_findings || knownFacts,
      icdCodes: boardOutput.post_arbiter.icd10_codes || [],
      recommendedAction: boardOutput.post_arbiter.final_disposition,
      soap: soapNote,
    };

    // If persist requested and encounterId provided, update or upsert the encounter in datastore
    if (persist && encounterId) {
      const dbClient = getDb();
      const formattedTranscript = messages.map((m: any) => ({
        role: m.role || "patient",
        text: m.text || "",
        timestamp: m.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }));

      const updateData = {
        chiefComplaint,
        transcript: formattedTranscript,
        soapSubjective: soapNote.subjective,
        soapObjective: soapNote.objective,
        soapAssessment: soapNote.assessment,
        soapPlan: soapNote.plan,
        triageLevel,
        triageTitle,
        esiScore: finalEsiLevel,
        icd10Codes: boardOutput.post_arbiter.icd10_codes || [],
        detectedSymptoms: boardOutput.consensus.key_findings || knownFacts,
        recommendedAction: boardOutput.post_arbiter.final_disposition,
        status: "completed_pending_review",
        durationSeconds: durationSeconds || undefined,
      };

      if (dbClient) {
        try {
          const updated = await dbClient
            .update(consultationsTable)
            .set(updateData)
            .where(eq(consultationsTable.id, encounterId))
            .returning();

          if (updated.length === 0) {
            await dbClient.insert(consultationsTable).values({
              id: encounterId,
              userId: auth.userId || "anon-user",
              patientName,
              patientAge: patientAge ? String(patientAge) : undefined,
              patientGender,
              doctorId,
              doctorName: "Attending Specialist",
              specialty: "Clinical Specialist",
              ...updateData,
              caseVersion: 1,
              createdAt: new Date(),
            } as any);
          }
        } catch (dbErr) {
          console.warn("[EvaluateRoute] Failed to update/insert encounter in database:", dbErr);
        }
      } else {
        const memIdx = memoryConsultations.findIndex((c) => c.id === encounterId);
        if (memIdx !== -1) {
          Object.assign(memoryConsultations[memIdx], updateData);
        } else {
          memoryConsultations.unshift({
            id: encounterId,
            userId: auth.userId || "anon-user",
            patientName,
            patientAge: patientAge ? String(patientAge) : undefined,
            patientGender,
            doctorId,
            doctorName: "Attending Specialist",
            specialty: "Clinical Specialist",
            ...updateData,
            caseVersion: 1,
            createdAt: new Date().toISOString(),
          });
        }
      }

      await logAuditEventAsync({
        actorId: auth.userId,
        actorRole: auth.role,
        action: "CONSULTATION_UPDATED",
        resourceType: "consultation",
        resourceId: encounterId,
        status: "SUCCESS",
        metadata: {
          triageLevel,
          esiScore: finalEsiLevel,
          hasSoap: true,
        },
      }).catch((auditErr) => console.warn("[EvaluateRoute] Audit log notice:", auditErr));
    }

    return NextResponse.json({
      success: true,
      soap: soapNote,
      triage,
      board: boardOutput.consensus,
      trace: boardOutput.trace,
    });
  } catch (err: any) {
    console.error("[EvaluateRoute] Clinical evaluation failed:", err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || "Clinical board evaluation failed.",
        code: "EVALUATION_FAILED",
      },
      { status: 500 }
    );
  }
}
