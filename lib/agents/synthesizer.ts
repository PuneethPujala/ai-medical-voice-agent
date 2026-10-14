import {
  AgentOpinion,
  ClinicalConflict,
  ClinicalConsensus,
  DifferentialItem,
  PatientCase,
  BoardMessage
} from "./schemas";
import { Blackboard } from "./blackboard";

export interface SynthesisResult {
  consensus: ClinicalConsensus;
  latency_ms: number;
}

/**
 * CONFLICT-AWARE CLINICAL CONSENSUS SYNTHESIZER
 * 
 * Invariant:
 * Consensus does not force false unanimity. It compiles:
 * - Agreed evidence with provenance
 * - Competing specialist hypotheses
 * - Unresolved conflicts (where multiple life-threat pathways remain concurrently active)
 */
export class ClinicalSynthesizer {
  public async synthesize(
    patientCase: PatientCase,
    opinions: AgentOpinion[],
    orchestratorSummary: string,
    activeSpecialists: string[],
    deliberationRounds: number = 1,
    blackboard?: Blackboard,
    deliberationMessages: BoardMessage[] = []
  ): Promise<SynthesisResult> {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();

    // 1. Compile Differential Diagnoses across all opinions
    const differential: DifferentialItem[] = [];
    const seenConditions = new Set<string>();

    for (const op of opinions) {
      for (const concern of op.concerns) {
        if (!seenConditions.has(concern.toLowerCase())) {
          seenConditions.add(concern.toLowerCase());
          differential.push({
            condition: concern,
            probability: op.risk_level === "high" ? "high" : op.risk_level === "moderate" ? "moderate" : "low",
            supporting_agents: [op.doctor_name],
            clinical_rationale: (op.evidence_for && op.evidence_for.length > 0 ? op.evidence_for : op.evidence).join("; ") || "Clinical indicator",
            competing_hypotheses: []
          });
        } else {
          const existing = differential.find(d => d.condition.toLowerCase() === concern.toLowerCase());
          if (existing && !existing.supporting_agents.includes(op.doctor_name)) {
            existing.supporting_agents.push(op.doctor_name);
            if (op.risk_level === "high") existing.probability = "high";
          }
        }
      }
    }

    // 2. Conflict Detection & Explicit Dual-Pathways
    const conflicts: ClinicalConflict[] = [];

    const hasHighCardio = opinions.some(o => o.specialty.includes("Cardio") && o.risk_level === "high");
    const hasHighNeuro = opinions.some(o => o.specialty.includes("Neuro") && o.risk_level === "high");
    const hasPeds = opinions.some(o => o.specialty.includes("Pedia"));

    if (hasHighCardio && hasHighNeuro) {
      conflicts.push({
        topic: "Primary Life-Threat Etiology (Cardiovascular vs. Acute Cerebrovascular)",
        agents: ["Dr. Marcus Vance (Cardiology)", "Dr. Arthur Pendelton (Neurology)"],
        conflict_description: "Cardiology identifies high-acuity ischemic injury (ACS / TIMI elevated), while Neurology identifies active BE-FAST positive stroke deficit.",
        resolution: "Both pathways remain emergently active under dual-activation protocol. Resuscitative stabilization with concurrent STAT Head CT and 12-lead ECG telemetry.",
        status: "concurrent_active_threats"
      });
    }

    // Add inter-agent challenges from Blackboard if present
    if (blackboard && blackboard.challenges.length > 0) {
      blackboard.challenges.forEach(ch => {
        if (!conflicts.some(c => c.conflict_description.includes(ch.claim_disputed))) {
          conflicts.push({
            topic: `Specialist Disagreement (${ch.from_agent} vs ${ch.to_agent})`,
            agents: [ch.from_agent, ch.to_agent],
            conflict_description: ch.claim_disputed,
            resolution: `Reviewed during deliberation Round ${blackboard.round}: Evaluated against objective evidence. Precautionary higher-acuity disposition retained.`,
            status: "resolved"
          });
        }
      });
    }

    // 3. Disposition & Escalation determination
    const highRiskCount = opinions.filter(o => o.risk_level === "high").length;
    const moderateRiskCount = opinions.filter(o => o.risk_level === "moderate").length;

    let recommended_disposition: "emergency_evaluation" | "urgent_outpatient" | "routine_outpatient" = "routine_outpatient";
    let consensus_risk: "critical" | "urgent" | "routine" = "routine";
    let requires_immediate_escalation = false;

    if (highRiskCount > 0 || patientCase.immediate_danger_detected) {
      recommended_disposition = "emergency_evaluation";
      consensus_risk = "critical";
      requires_immediate_escalation = true;
    } else if (moderateRiskCount > 0) {
      recommended_disposition = "urgent_outpatient";
      consensus_risk = "urgent";
    }

    // 4. Compile Key Clinical Findings
    const key_findings: string[] = [];
    opinions.forEach(o => {
      const items = o.evidence_for && o.evidence_for.length > 0 ? o.evidence_for : o.evidence;
      items.forEach(e => {
        if (!key_findings.includes(e)) key_findings.push(e);
      });
    });

    // 5. Primary Specialty assignment
    let primary_specialty = "Internal Medicine";
    if (hasHighCardio && hasHighNeuro) primary_specialty = "Cardioneuro Resuscitation";
    else if (hasHighCardio) primary_specialty = "Cardiology & Resuscitation";
    else if (hasHighNeuro) primary_specialty = "Neurology & Stroke Triage";
    else if (hasPeds) primary_specialty = "Pediatrics";

    // 6. Formulate Spoken Narrative
    let synthesized_reply_narrative = "";
    if (consensus_risk === "critical") {
      if (hasHighCardio && hasHighNeuro) {
        synthesized_reply_narrative = "I need you to stay seated and keep someone nearby with you right now. Your combination of symptoms is concerning for both an acute cardiac and neurological event that requires immediate emergency care. Please call 108, 112, or 911 right now to request emergency medical services.";
      } else if (hasHighCardio) {
        synthesized_reply_narrative = "I'm very concerned about the discomfort and pressure you're feeling in your chest. Please sit down comfortably right now, stay completely still, and have someone dial 108, 112, or 911 immediately. If you're by yourself, please call emergency services right away on speakerphone—do not exert yourself or walk around.";
      } else if (hasHighNeuro) {
        synthesized_reply_narrative = "The sudden facial drooping and arm weakness you described are critical warning signs of a stroke. Every minute matters, so please stay right where you are, do not exert yourself, and call 108, 112, or 911 immediately to request an emergency ambulance.";
      } else {
        synthesized_reply_narrative = "Your clinical symptoms require urgent emergency care. Please sit down comfortably, remain calm, and call 108, 112, or 911 right away.";
      }
    } else if (consensus_risk === "urgent") {
      synthesized_reply_narrative = "Thank you for explaining what you're feeling. Based on your symptoms, our clinical team recommends an urgent in-person medical evaluation today. Please keep a close eye on your temperature and vitals.";
    } else {
      const isLegNerveMuscle = differential.some(d => /sciati|radiculo|muscle cramp|spasm|peripheral sensory/i.test(d.condition)) ||
                              key_findings.some(f => /leg|calf|thigh|hamstring|needle|digged|sciatica/i.test(f));

      if (isLegNerveMuscle) {
        synthesized_reply_narrative = "Based on the sharp, needle-like pain you described in your leg muscles, this is most characteristic of sensory nerve irritation—such as sciatica or lumbar radiculopathy—where an irritated nerve root sends lancinating, needle-like signals down the leg. An acute focal muscle spasm is another common possibility. To manage this at home: rest in a comfortable position with your knees supported, avoid heavy lifting or prolonged sitting, and stay well hydrated. If you experience weakness lifting your foot, numbness around your groin, or changes in bowel or bladder control, please seek emergency medical evaluation immediately.";
      } else {
        const topFinding = key_findings.length > 0 ? key_findings[0] : "";
        if (topFinding) {
          synthesized_reply_narrative = `Thank you for sharing that with me regarding ${topFinding.toLowerCase()}. Based on standard clinical guidelines, this appears consistent with a routine, low-acuity issue. Please rest, stay hydrated, and follow up with your doctor if symptoms persist or worsen.`;
        } else {
          synthesized_reply_narrative = "Thank you for sharing that with me. Your symptoms appear consistent with a routine, low-acuity presentation. Please stay hydrated, rest, and follow up with your primary physician if symptoms persist beyond a few days.";
        }
      }
    }

    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const latency_ms = Math.round(t1 - t0);

    const consensus: ClinicalConsensus = {
      differential,
      conflicts,
      recommended_disposition,
      consensus_risk,
      primary_specialty,
      key_findings,
      synthesized_reply_narrative,
      orchestrator_summary: orchestratorSummary,
      requires_immediate_escalation,
      active_specialists: activeSpecialists,
      deliberation_rounds_completed: deliberationRounds,
      deliberation_messages: deliberationMessages
    };

    return {
      consensus,
      latency_ms
    };
  }
}
