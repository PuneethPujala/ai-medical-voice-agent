import { NextResponse } from "next/server";
import { evaluateSafetyArbiter } from "@/lib/triage/safety-arbiter";
import { getAuthContext } from "@/lib/auth/rbac";
import { logAuditEventAsync } from "@/lib/audit/audit-logger";
import {
  evaluateRateLimit,
  buildRateLimit429Response,
  RATE_LIMIT_POLICIES,
} from "@/lib/security/rate-limiter";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.FASTAPI_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000";

export async function POST(request: Request) {
  try {
    const auth = await getAuthContext(request);
    const body = await request.json();
    const {
      transcript,
      patient_id = "P-1002",
      patient_name = "Anonymous Patient",
      patient_age,
      structured_state,
      facts,
      red_flags,
      vitals,
    } = body;

    if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
      return NextResponse.json(
        { status: "error", message: "Transcript text is required." },
        { status: 400 }
      );
    }

    // Distributed Rate Limiting with Deterministic Emergency Preemption
    const rateLimit = await evaluateRateLimit({
      policy: RATE_LIMIT_POLICIES.TRIAGE_EVAL,
      userId: auth.userId,
      request,
      preflightUtterance: transcript,
    });
    if (!rateLimit.allowed) {
      return buildRateLimit429Response(rateLimit);
    }
    if (rateLimit.emergencyPreempted) {
      return NextResponse.json({
        status: "emergency",
        directive: rateLimit.emergencyDirective,
        isEmergency: true,
        redFlagsTriggered: rateLimit.emergencyFlags || [],
        arbiter: {
          esiScore: 1,
          isEmergency: true,
          redFlagsTriggered: rateLimit.emergencyFlags || [],
          specialty: "emergency_medicine",
        },
        preempted: true,
      });
    }

    let upstreamTriage: any = null;
    try {
      // Forward to Python FastAPI backend service if running
      const res = await fetch(`${BACKEND_URL}/api/v1/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, patient_id, patient_name }),
        signal: AbortSignal.timeout(2000),
      });

      if (res.ok) {
        upstreamTriage = await res.json();
      }
    } catch (backendError) {
      // FastAPI backend optional
    }

    // Run deterministic ESI v4 safety arbiter (with structured state & override guarantee)
    const arbiter = evaluateSafetyArbiter({
      rawText: transcript,
      patientAge: patient_age ? Number(patient_age) : undefined,
      structuredState: structured_state,
      facts,
      redFlags: red_flags,
      vitals,
      llmSuggestedLevel: upstreamTriage?.triage?.triage_level,
    });

    // Specialty routing based on detected clinical red flags
    let specialty = "general";
    if (arbiter.redFlagsTriggered.some((r) => r.includes("ACS") || r.includes("CARDIAC"))) {
      specialty = "cardiology";
    } else if (arbiter.redFlagsTriggered.some((r) => r.includes("STROKE") || r.includes("BE_FAST") || r.includes("THUNDERCLAP"))) {
      specialty = "neurology";
    } else if (arbiter.redFlagsTriggered.some((r) => r.includes("RESPIRATORY") || r.includes("AIRWAY") || r.includes("COLLAPSE"))) {
      specialty = "emergency";
    } else if (arbiter.redFlagsTriggered.some((r) => r.includes("PEDIATRIC"))) {
      specialty = "pediatrics";
    } else if (arbiter.isEmergency) {
      specialty = "emergency";
    }

    // Build synthesized clinical voice response
    let spokenResponse = "";
    if (arbiter.isEmergency) {
      if (specialty === "cardiology") {
        spokenResponse = "Emergency alert registered. Acute cardiac distress indicators detected. Please rest, avoid physical exertion, and call 112 or 108 immediately for emergency medical assistance. Do not wait.";
      } else if (specialty === "neurology") {
        spokenResponse = "Critical emergency registered. Acute neurological distress indicators detected. Please remain stationary and call 112 or 108 immediately for an emergency ambulance. Do not wait.";
      } else {
        spokenResponse = `Emergency warning. Your symptoms require immediate emergency medical attention. Please call 112 or 108 immediately. ${arbiter.recommendedAction}`;
      }
    } else if (arbiter.triageLevel === "priority") {
      spokenResponse = `Your symptoms have been logged as priority. We recommend an urgent medical evaluation today. ${arbiter.recommendedAction}`;
    } else {
      spokenResponse = `I've logged your symptoms for routine outpatient review. ${arbiter.recommendedAction}`;
    }

    const objectiveData = vitals && Object.keys(vitals).length > 0
      ? `Measured telemetry vitals: ${Object.entries(vitals).map(([k, v]) => `${k}: ${v}`).join(", ")}`
      : "Not assessed (remote voice consultation; physical vitals unobserved)";
    const soapSummary = `S: Patient reports: "${transcript}". Reported symptoms: ${arbiter.detectedSymptoms.join(", ") || "None"}. O: ${objectiveData}. A: ${arbiter.esiTitle} (ESI ${arbiter.esiScore}, ICD-10: ${arbiter.icd10Codes.join(", ")}). P: ${arbiter.clinicalProtocol}`;

    // Append evaluation to tamper-evident audit ledger
    await logAuditEventAsync({
      actorId: auth.userId,
      actorRole: auth.role,
      action: "TRIAGE_EVALUATION",
      resourceType: "patient",
      resourceId: patient_id,
      status: "SUCCESS",
      metadata: {
        triageLevel: arbiter.triageLevel,
        esiScore: arbiter.esiScore,
        isEmergency: arbiter.isEmergency,
        redFlagsTriggered: arbiter.redFlagsTriggered,
        specialty,
      },
    });

    return NextResponse.json({
      status: "success",
      patient_id,
      patient_name,
      triage: {
        triage_level: arbiter.triageLevel,
        triage_title: arbiter.esiTitle,
        esi_score: arbiter.esiScore,
        is_emergency: arbiter.isEmergency,
        arbiter_override: arbiter.arbiterOverride,
        red_flags_triggered: arbiter.redFlagsTriggered,
        matched_rules: arbiter.matchedRules,
        clinical_protocol: arbiter.clinicalProtocol,
        specialty,
        icd10_codes: arbiter.icd10Codes,
        detected_symptoms: arbiter.detectedSymptoms,
        recommended_action: arbiter.recommendedAction,
        spoken_response: spokenResponse,
        soap_summary: soapSummary,
        latency_ms: arbiter.latencyMs,
      },
    });
  } catch (error: any) {
    console.error("[TriageRouteError]", error);
    return NextResponse.json(
      {
        status: "error",
        message: process.env.NODE_ENV === "production" ? "Internal clinical triage processing error" : (error?.message || "Internal server error"),
      },
      { status: 500 }
    );
  }
}
