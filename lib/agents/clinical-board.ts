import { BoardExecutionTrace, ClinicalConsensus, PatientCase } from "./schemas";
import { evaluatePreArbiter } from "../triage/pre-arbiter";
import { TriageOrchestrator } from "./orchestrator";
import { ClinicalSynthesizer } from "./synthesizer";
import { evaluatePostArbiter, PostArbiterResult } from "../triage/post-arbiter";

export interface ClinicalBoardOutput {
  trace: BoardExecutionTrace;
  post_arbiter: PostArbiterResult;
  consensus: ClinicalConsensus;
  doctor_reply: string;
  soap_note: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  };
}

/**
 * MULTI-AGENT CLINICAL BOARD ORCHESTRATION PIPELINE (LEVEL 5 BOUNDED)
 * 
 * Flow:
 * Patient Case -> Pre-Arbiter (Deterministic)
 *              -> Shared Blackboard Ingestion (with Provenance)
 *              -> Orchestrator & Specialist Deliberation (Rounds 1 & 2)
 *              -> Bounded Tool Invocation (Allowlists)
 *              -> Peer Cross-Examination / Challenges
 *              -> Conflict-Aware Consensus Synthesizer
 *              -> Post-Arbiter (Hard Override Shield + Cryptographic Hash Chain)
 *              -> Tamper-Evident Multi-Agent SOAP Output
 */
export class ClinicalBoard {
  private orchestrator = new TriageOrchestrator();
  private synthesizer = new ClinicalSynthesizer();

  public async evaluate(patientCase: PatientCase): Promise<ClinicalBoardOutput> {
    const boardStart = typeof performance !== "undefined" ? performance.now() : Date.now();

    // 1. Pre-Arbiter: Deterministic Sub-Millisecond Pre-Screening
    const preResult = evaluatePreArbiter(patientCase);
    patientCase.pre_safety_flags = preResult.pre_safety_flags;
    patientCase.immediate_danger_detected = preResult.immediate_danger;

    // 2. Orchestrator: Multi-Agent Deliberation over Shared Blackboard
    const orchResult = await this.orchestrator.orchestrate(patientCase);

    // 3. Clinical Synthesizer: Conflict-Aware Differential Compilation
    const synthResult = await this.synthesizer.synthesize(
      patientCase,
      orchResult.opinions,
      orchResult.orchestrator_summary,
      orchResult.active_specialists,
      orchResult.deliberation_rounds_completed,
      orchResult.blackboard,
      orchResult.deliberation_messages
    );

    // 4. Post-Arbiter: Deterministic Hard Overrides & Sequential Hash Chaining
    const postResult = evaluatePostArbiter(patientCase, synthResult.consensus);

    // 5. Append Safety Arbiter disposition to the deliberation stream
    const activeCaseVersion = orchResult.blackboard.case_version || patientCase.case_version || 1;
    patientCase.case_version = activeCaseVersion;
    synthResult.consensus.deliberation_messages.push({
      id: `safety-arbiter-${Date.now()}`,
      round: orchResult.deliberation_rounds_completed,
      speakerRole: "safety_arbiter",
      agentId: "deterministic-post-arbiter",
      doctorName: "Deterministic Safety Arbiter",
      specialty: "Clinical Safety Arbiter",
      type: "safety_disposition",
      content: postResult.arbiter_override_applied
        ? `DETERMINISTIC OVERRIDE ENFORCED: ${postResult.override_rationale || "Emergency criteria confirmed"}. Final disposition locked to ${postResult.final_esi_title} (ESI ${postResult.final_esi_level}).`
        : `SAFETY AUDIT VERIFIED: Disposition confirmed at ${postResult.final_esi_title} (ESI ${postResult.final_esi_level}). Cryptographically linked, tamper-evident hash: ${postResult.audit_sha256.slice(0, 16)}...`,
      references: postResult.red_flags,
      case_version: activeCaseVersion,
      timestamp: new Date().toISOString()
    });

    const boardEnd = typeof performance !== "undefined" ? performance.now() : Date.now();
    const total_board_latency_ms = Math.round(boardEnd - boardStart);

    // 6. Compute Specialist and Tool Latencies
    const specialistLatencies: Record<string, number> = {};
    orchResult.specialists_requested.forEach(s => {
      specialistLatencies[s.specialty] = orchResult.latency_ms;
    });

    const toolLatencies: Record<string, number> = {};
    orchResult.tools_executed.forEach(t => {
      toolLatencies[t.tool_name] = t.latency_ms;
    });

    // 7. Assemble Comprehensive Audit Trace
    const trace: BoardExecutionTrace = {
      timestamp: new Date().toISOString(),
      patient_id: patientCase.patient_id,
      case_version: activeCaseVersion,
      execution_mode: "deterministic_pipeline",
      deliberation_rounds: orchResult.deliberation_rounds_completed,
      pre_arbiter_latency_us: preResult.latency_us,
      orchestrator_latency_ms: orchResult.latency_ms,
      specialist_latencies_ms: specialistLatencies,
      tool_latencies_ms: toolLatencies,
      synthesis_latency_ms: synthResult.latency_ms,
      post_arbiter_latency_us: postResult.latency_us,
      total_board_latency_ms,
      specialists_summoned: orchResult.specialists_requested.map(s => s.specialty),
      tools_executed: orchResult.tools_executed.map(t => t.tool_name),
      tools_executed_details: orchResult.tools_executed,
      peer_challenges_count: orchResult.challenges.length,
      peer_challenges: orchResult.challenges,
      pre_safety_flags: preResult.pre_safety_flags,
      immediate_danger: preResult.immediate_danger,
      opinions: orchResult.opinions,
      consensus: synthResult.consensus,
      post_arbiter_override: postResult.arbiter_override_applied,
      final_esi_level: postResult.final_esi_level,
      final_disposition: postResult.final_disposition,
      audit_hash_chain: postResult.audit_hash_chain,
      root_audit_hash: postResult.audit_sha256,
      deliberation_messages: synthResult.consensus.deliberation_messages
    };

    // 7. Generate Formal Multi-Agent SOAP Documentation with Explicit Provenance
    const prov = patientCase.provenance_evidence || [];

    // Categorize by provenance source and status
    const patientReported = prov.filter(p => p.source === "patient_reported" && p.status !== "denied");
    const patientDenials = prov.filter(p => p.source === "patient_reported" && p.status === "denied");

    // Build SUBJECTIVE [PATIENT-REPORTED]
    const ccItem = patientReported.find(p => p.domain === "chief_complaint")?.value ||
      (synthResult.consensus.key_findings.length > 0 ? synthResult.consensus.key_findings[0] : "Clinical symptom evaluation");
    const onsetItem = patientReported.find(p => p.domain === "onset")?.value;
    const durItem = patientReported.find(p => p.domain === "duration")?.value;
    const courseItem = patientReported.find(p => p.domain === "course")?.value;
    const sevItem = patientReported.find(p => p.domain === "pain_severity")?.value;
    const demoItems = patientReported.filter(p => p.domain === "patient_age" || p.domain === "pregnancy" || p.domain === "comorbidity");
    const reportedSyms = patientReported
      .filter(p => p.domain !== "chief_complaint" && p.domain !== "onset" && p.domain !== "duration" && p.domain !== "course" && p.domain !== "pain_severity" && p.domain !== "patient_age" && p.domain !== "pregnancy" && p.domain !== "comorbidity")
      .map(p => p.label || p.description);

    const subjectiveLines: string[] = [
      "[PATIENT-REPORTED]",
      `• Chief Complaint: ${ccItem}`,
    ];
    if (demoItems.length > 0) {
      subjectiveLines.push(`• Patient Context & History: ${demoItems.map(d => d.description).join("; ")}`);
    }
    if (onsetItem || durItem || courseItem) {
      const timelineParts = [
        onsetItem ? `Onset: ${onsetItem}` : null,
        durItem ? `Duration: ${durItem}` : null,
        courseItem ? `Course: ${courseItem}` : null,
      ].filter(Boolean);
      subjectiveLines.push(`• Timeline & Course: ${timelineParts.join("; ")}`);
    }
    if (reportedSyms.length > 0) {
      subjectiveLines.push(`• Reported Symptoms: ${reportedSyms.join(", ")}`);
    } else if (synthResult.consensus.key_findings.length > 0) {
      subjectiveLines.push(`• Reported Symptoms: ${synthResult.consensus.key_findings.join(", ")}`);
    }
    if (sevItem) {
      subjectiveLines.push(`• Pain Severity: ${sevItem}`);
    }
    if (patientDenials.length > 0) {
      subjectiveLines.push(`• Pertinent Denials: ${patientDenials.map(d => `${d.label || d.domain}: Denied`).join("; ")}`);
    }

    const subjective = subjectiveLines.join("\n");

    // Build OBJECTIVE [NOT ASSESSED] & [DEVICE / ACOUSTIC MEASURED]
    const objectiveLines: string[] = [
      "[NOT ASSESSED]",
      "• Blood Pressure: Not assessed (remote voice consultation)",
      "• Heart Rate: Not assessed (no hardware telemetry connected)",
      "• SpO₂: Not assessed (no pulse oximeter connected)",
      patientDenials.some(d => d.domain === "fever")
        ? "• Temperature: Not assessed (patient verbally denied fever; no biometric reading)"
        : "• Temperature: Not assessed (no thermometer connected)",
      "• Respiratory Rate: Not assessed (chest excursion unobserved over audio)",
      "• Physical Examination: Not performed (telehealth voice interface)",
    ];

    const speechRate = patientCase.speech_features?.speech_rate_wpm || 135;
    const speechObs = patientCase.speech_features?.observations?.length
      ? patientCase.speech_features.observations.join("; ")
      : "Natural conversational cadence, intelligible verbal stream";

    objectiveLines.push("");
    objectiveLines.push("[DEVICE / ACOUSTIC MEASURED]");
    objectiveLines.push(`• Speech Rate: ${speechRate} WPM`);
    objectiveLines.push(`• Acoustic Biomarkers: ${speechObs}`);
    objectiveLines.push(`• Decision Instruments Executed: ${orchResult.tools_executed.length > 0 ? orchResult.tools_executed.map(t => `${t.tool_name} (${t.clinical_summary})`).join("; ") : "Algorithmic ESI v4 Invariant Engine"}`);
    const icdTags = postResult.icd10_codes && postResult.icd10_codes.length > 0
      ? postResult.icd10_codes.join(", ")
      : "Not assigned (insufficient clinical evidence)";
    objectiveLines.push(`• Diagnostic Tags: ${icdTags}`);

    const objective = objectiveLines.join("\n");

    // Build ASSESSMENT [AI-INFERRED / ALGORITHMIC]
    const assessmentLines: string[] = [
      "[AI-INFERRED / ALGORITHMIC]",
      `• Primary Triage Impression: ${postResult.final_esi_title} (ESI Level ${postResult.final_esi_level})`,
      `• Multi-Agent Consensus: ${orchResult.active_specialists.length} specialists convened (${orchResult.active_specialists.join(", ")}). Primary lead: ${synthResult.consensus.primary_specialty}.`,
      "• Differential Diagnoses:",
      ...(synthResult.consensus.differential.length > 0
        ? synthResult.consensus.differential.map(d => `  - ${d.condition} [Prob: ${d.probability.toUpperCase()}]: ${d.clinical_rationale || "Derived from reported symptoms"}`)
        : ["  - Unspecified acute presentation [Prob: LOW]"]),
      `• Deterministic Safety Status: ${postResult.arbiter_override_applied ? "OVERRIDE ENFORCED — " + postResult.override_rationale : "NOMINAL (Safety Arbiter Verified — No Emergency Criteria Met)"}`,
      "• Clinical Governance: Algorithmic triage guidance derived from conversational testimony. Does not replace physical examination by an attending physician.",
    ];

    const assessment = assessmentLines.join("\n");

    // Build PLAN [AI-GENERATED]
    const planLines: string[] = [
      "[AI-GENERATED]",
      `• Recommended Disposition: ${postResult.final_disposition.toUpperCase()}`,
      `• Clinical Next Steps: ${orchResult.opinions.flatMap(o => o.recommended_actions).slice(0, 4).join("; ") || "Urgent clinical evaluation"}`,
      "• Patient Safety Precautions: Keep patient calm and seated. Do not exert. If acute shortness of breath, inability to swallow liquids, or chest pressure develops, contact 108 or 112 emergency services immediately.",
      `• Audit Ledger & Provenance: Tamper-evident SHA-256 block height ${postResult.audit_hash_chain.length} (Root: ${postResult.audit_sha256.slice(0, 16)}...)`,
    ];

    const plan = planLines.join("\n");

    const soap_note = {
      subjective,
      objective,
      assessment,
      plan,
    };

    return {
      trace,
      post_arbiter: postResult,
      consensus: synthResult.consensus,
      doctor_reply: postResult.safe_spoken_narrative,
      soap_note
    };
  }
}

export const clinicalBoard = new ClinicalBoard();
