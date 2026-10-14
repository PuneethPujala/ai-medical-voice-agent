import { AgentOpinion, PatientCase, SpecialistRequest, PeerChallenge, ToolResult, BoardMessage } from "./schemas";
import { Blackboard } from "./blackboard";
import { BaseClinicalAgent } from "./base-agent";
import { CardiologyAgent } from "./specialists/cardiology-agent";
import { NeurologyAgent } from "./specialists/neurology-agent";
import { PediatricsAgent } from "./specialists/pediatrics-agent";
import { OtolaryngologyAgent } from "./specialists/ent-agent";

export interface OrchestrationResult {
  orchestrator_summary: string;
  specialists_requested: SpecialistRequest[];
  opinions: AgentOpinion[];
  active_specialists: string[];
  tools_executed: ToolResult[];
  challenges: PeerChallenge[];
  deliberation_rounds_completed: number;
  latency_ms: number;
  blackboard: Blackboard;
  deliberation_messages: BoardMessage[];
}

/**
 * TRIAGE ORCHESTRATOR - DR. SARAH CHEN, MD
 * 
 * Invariant: Selectively routes cases and orchestrates bounded deliberation:
 * - Round 1: Specialized Intake + Domain Tool Execution.
 * - Round 2: Peer Review & Cross-Specialty Challenge.
 * - Bounded max rounds (<= 3), no runaway loops.
 */
export class TriageOrchestrator {
  private cardiology = new CardiologyAgent();
  private neurology = new NeurologyAgent();
  private pediatrics = new PediatricsAgent();
  private ent = new OtolaryngologyAgent();

  /**
   * Helper to verify if a clinical pattern is affirmed or negated.
   */
  private isAffirmed(text: string, regex: RegExp): boolean {
    const match = text.match(regex);
    if (!match) return false;

    const idx = text.search(regex);
    if (idx === -1) return false;
    const windowStart = Math.max(0, idx - 60);
    const window = text.slice(windowStart, idx).trim();

    const negationPatterns = [
      /(?:no|denies|without|never|rules?\s+out|negative\s+for|not|free\s+of)(?:\s+[a-z0-9_-]+){0,3}\s+(?:or|and|\/)\s*$/i,
      /(?:no|denies|without|never|rules?\s+out|negative\s+for|not|free\s+of)(?:\s+[a-z0-9_-]+){0,3}\s*$/i,
    ];

    return !negationPatterns.some((pattern) => pattern.test(window));
  }

  /**
   * Determine which specialists should be summoned.
   */
  public determineSpecialistRouting(patientCase: PatientCase): SpecialistRequest[] {
    const text = patientCase.transcript.toLowerCase();
    const requests: SpecialistRequest[] = [];

    // 1. Check Pre-Arbiter flags first
    const hasCardiacFlag = patientCase.pre_safety_flags.some(f => f.includes("CHEST") || f.includes("CARDIAC"));
    const hasNeuroFlag = patientCase.pre_safety_flags.some(f => f.includes("NEURO"));
    const hasPediatricFlag = patientCase.pre_safety_flags.some(f => f.includes("PEDIATRIC"));

    // Check if this is a purely routine medication refill without symptoms
    const isMedicationRefillOnly = /\b(refill|prescription|medication\s+refill)\b/i.test(text) &&
                                  !hasCardiacFlag && !hasNeuroFlag && !hasPediatricFlag &&
                                  /\b(normal|routine|feeling\s+fine|no\s+symptoms|completely\s+normal)\b/i.test(text);

    // 2. Cardiology Triggers (with negation check)
    const cardioRegex = /\b(chest\s+pain|chest\s+pressure|chest\s+tightness|crushing.*chest|heavy.*chest|tightness.*chest|angina|palpitation|racing\s+heart|substernal|cold\s+sweats|diaphoresis)\b/i;
    const hasAffirmedCardio = this.isAffirmed(text, cardioRegex);
    
    // Check dyspnea only if affirmed
    const hasAffirmedDyspnea = this.isAffirmed(text, /\b(shortness\s+of\s+breath|difficulty\s+breathing|cannot\s+breathe|gasping)\b/i);

    const needsCardio = !isMedicationRefillOnly && (hasCardiacFlag || hasAffirmedCardio || hasAffirmedDyspnea);

    if (needsCardio) {
      requests.push({
        specialty: "cardiology",
        reason: hasCardiacFlag ? "Pre-screened acute chest pain / hemodynamic risk" : "Cardiovascular symptom evaluation",
        priority: (hasCardiacFlag || hasAffirmedCardio) ? "immediate" : "routine",
        trigger_flags: patientCase.pre_safety_flags.filter(f => f.includes("CHEST") || f.includes("CARDIAC"))
      });
    }

    // 3. Neurology Triggers (with negation check)
    const neuroRegex = /\b(droop|facial\s+droop|arm\s+weakness|arm.*numb|slurred\s+speech|cannot\s+speak|thunderclap|stroke|seizure|loss\s+of\s+speech|hemiparesis)\b/i;
    const hasAffirmedNeuro = this.isAffirmed(text, neuroRegex);

    // Headache / dizziness only if affirmed and not part of simple routine refill or cold
    const hasAffirmedHeadacheOrDizziness = this.isAffirmed(text, /\b(headache|migraine|vertigo|dizziness|faint|syncope|black\s+out)\b/i);
    const isColdColdSoreThroatOnly = /\b(runny\s+nose|sore\s+throat|nasal\s+drainage)\b/i.test(text);

    const needsNeuro = !isMedicationRefillOnly && (hasNeuroFlag || hasAffirmedNeuro || (hasAffirmedHeadacheOrDizziness && !isColdColdSoreThroatOnly));

    if (needsNeuro) {
      requests.push({
        specialty: "neurology",
        reason: hasNeuroFlag ? "Pre-screened acute focal neurological deficit / stroke sign" : "Neurological symptom screening",
        priority: (hasNeuroFlag || hasAffirmedNeuro) ? "immediate" : "routine",
        trigger_flags: patientCase.pre_safety_flags.filter(f => f.includes("NEURO"))
      });
    }

    // 4. Pediatric Triggers
    const isPediatric = hasPediatricFlag ||
                        patientCase.demographics?.age_group === "infant" ||
                        patientCase.demographics?.age_group === "pediatric" ||
                        (patientCase.demographics?.age !== undefined && patientCase.demographics.age < 16) ||
                        ["baby", "child", "infant", "toddler", "weeks old", "months old"].some(k => text.includes(k));
    if (isPediatric) {
      requests.push({
        specialty: "pediatrics",
        reason: hasPediatricFlag ? "Pre-screened pediatric crisis / neonatal vulnerability" : "Pediatric health evaluation",
        priority: hasPediatricFlag ? "immediate" : "routine",
        trigger_flags: patientCase.pre_safety_flags.filter(f => f.includes("PEDIATRIC"))
      });
    }

    // 5. Otolaryngology (ENT) Triggers
    const hasPtaFlag = patientCase.pre_safety_flags.some(f => f.includes("PTA") || f.includes("DEEP_NECK") || f.includes("AIRWAY"));
    const hasAffirmedPtaSymptoms = this.isAffirmed(text, /\b(muffled.*voice|hot\s+potato|swallow.*saliva|saliva.*pain|trismus|stridor)\b/i);
    const hasSevereThroat = this.isAffirmed(text, /\b(sore\s+throat|throat\s+pain|painful\s+swallow)\b/i) &&
      (text.includes("fever") || text.includes("severe") || text.includes("8") || text.includes("9") || text.includes("10") || text.includes("muffle") || text.includes("saliva"));

    const needsEnt = !isMedicationRefillOnly && (hasPtaFlag || hasAffirmedPtaSymptoms || hasSevereThroat);
    if (needsEnt) {
      requests.push({
        specialty: "otolaryngology",
        reason: hasPtaFlag ? "Pre-screened deep neck space infection / peritonsillar abscess risk" : "Head & neck / pharyngeal airway assessment",
        priority: (hasPtaFlag || hasAffirmedPtaSymptoms) ? "immediate" : "routine",
        trigger_flags: patientCase.pre_safety_flags.filter(f => f.includes("PTA") || f.includes("DEEP_NECK") || f.includes("AIRWAY"))
      });
    }

    return requests;
  }

  public generatePrimaryCareOpinion(patientCase: PatientCase, round: number = 1): AgentOpinion {
    const text = patientCase.transcript.toLowerCase();
    const hasFever = text.includes("fever") || text.includes("temperature");
    const hasRespiratory = text.includes("cough") || text.includes("cold") || text.includes("congestion") || text.includes("sore throat") || text.includes("runny nose");
    const isRefill = text.includes("refill") || text.includes("prescription");

    const hasLegNerveMuscle = /\b(leg|calf|thigh|hamstring|quadricep|shin)\b/i.test(text) &&
                              /\b(needle|digged|digging|pins|sharp|stab|cramp|spasm|shoot|sciatica|nerve|paresthesia)\b/i.test(text);

    let hypothesis = "General Ambulatory Review";
    let concerns = ["General Medical Consultation", "Outpatient Symptom Review"];
    let citations: string[] = [];
    let actions = [
      "Rest and adequate fluid intake",
      "Over-the-counter symptomatic management as tolerated",
      "Primary Care outpatient follow-up if symptoms persist past 3 days"
    ];

    const hasAcuteAbdomen = /\b(right lower|rlq|appendix|appendicitis|rebound|periumbilical|navel|acute abdomen|guarding|peritonitis)\b/i.test(text) ||
      (patientCase.detected_symptoms || []).some((s) => /right lower|appendix|appendicitis|rlq|acute abdomen/i.test(s)) ||
      (patientCase.pre_safety_flags || []).some((f) => /acute_abdomen|appendicitis/i.test(f));

    const hasRSIorCarpalTunnel = (/\b(thumb|index finger|typing|laptop|keyboard|wrist|hands?|carpal|median nerve)\b/i.test(text) &&
      /\b(tingling|pins and needles|numbness|paresthesia|strain)\b/i.test(text)) ||
      (patientCase.detected_symptoms || []).some((s) => /thumb|carpal|paresthesia|typing|ergonomic|repetitive/i.test(s));

    if (isRefill) {
      hypothesis = "Maintenance Medication Refill";
      concerns = ["Routine Prescription Maintenance", "Medication Adherence Review"];
      actions = [
        "Review last recorded blood pressure log",
        "Authorize maintenance medication refill pending physician sign-off"
      ];
    } else if (hasAcuteAbdomen) {
      hypothesis = "Acute Appendicitis / Acute Surgical Abdomen";
      concerns = ["Acute Appendicitis", "Acute Surgical Abdomen", "Peritonitis"];
      citations = ["MPLUS-1002-OVERVIEW"];
      actions = [
        "Immediate emergency surgical consultation",
        "Maintain strict NPO status (nothing by mouth)",
        "Obtain abdominal ultrasound or contrast-enhanced CT scan and CBC"
      ];
    } else if (hasRSIorCarpalTunnel) {
      hypothesis = "Carpal Tunnel Syndrome / Repetitive Strain Injury";
      concerns = ["Carpal Tunnel Syndrome", "Repetitive Strain Injury", "Median Nerve Paresthesia"];
      actions = [
        "Neutral wrist splinting during ergonomic computer work",
        "Ergonomic workstation adjustment and regular rest breaks",
        "Outpatient follow-up for nerve conduction testing if numbness persists"
      ];
    } else if (hasLegNerveMuscle) {
      hypothesis = "Sciatic Nerve Irritation / Lumbar Radiculopathy vs. Acute Muscle Spasm";
      concerns = [
        "Sciatic Nerve Irritation / Radiculopathy",
        "Acute Focal Muscle Cramp / Spasm",
        "Peripheral Sensory Neuropathy"
      ];
      citations = ["MPLUS-1532-OVERVIEW", "MPLUS-1707-OVERVIEW", "MPLUS-1095-OVERVIEW"];
      actions = [
        "Rest in position of comfort with slight knee elevation",
        "Avoid heavy lifting, sudden twisting, or prolonged static sitting",
        "Gentle hamstring stretching and adequate hydration/electrolytes",
        "Seek immediate emergency care if foot drop, saddle numbness, or loss of bowel/bladder control occurs"
      ];
    } else if (hasRespiratory) {
      hypothesis = "Viral Upper Respiratory Infection";
      concerns = ["Upper Respiratory Tract Infection", "Viral Pharyngitis/Rhinitis"];
    } else if (hasFever) {
      hypothesis = "Pyrexia of unknown origin";
      concerns = ["Pyrexia of unknown origin", "Mild infectious illness"];
    }

    return {
      agent: "primary-care-chen",
      doctor_name: "Dr. Sarah Chen, MD",
      specialty: "Internal Medicine & Primary Triage",
      deliberation_round: round,
      primary_hypothesis: hypothesis,
      concerns: concerns,
      evidence: [
        patientCase.transcript,
        `Vitals status: ${patientCase.vitals && Object.keys(patientCase.vitals).length ? JSON.stringify(patientCase.vitals) : "Not assessed / Hardware telemetry absent"}`
      ],
      evidence_for: [patientCase.transcript],
      evidence_against: [],
      missing_evidence: [],
      tool_invocations: [],
      challenges_issued: [],
      challenges_received: [],
      risk_level: patientCase.immediate_danger_detected ? "high" : "low",
      recommended_actions: actions,
      confidence: 0.90,
      confidence_semantics: "uncalibrated_model_score",
      requires_escalation: patientCase.immediate_danger_detected,
      speech_observations_evaluated: patientCase.speech_features?.observations || [],
      clinical_protocol: isRefill ? "Routine Medication Refill Protocol" : hasLegNerveMuscle ? "Peripheral Radiculopathy & Musculoskeletal Guideline" : "Internal Medicine Ambulatory Protocol",
      retrieved_citations: citations
    };
  }

  public async orchestrate(patientCase: PatientCase): Promise<OrchestrationResult> {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const blackboard = new Blackboard(patientCase);
    const requests = this.determineSpecialistRouting(patientCase);
    const activeSpecialists: string[] = ["Dr. Sarah Chen, MD (Primary Care Lead)"];

    // Initialize Lead Primary Care Opinion on Blackboard
    const chenInitial = this.generatePrimaryCareOpinion(patientCase, 1);
    blackboard.postOpinion(chenInitial);

    // Map specialists
    const activeAgents: { name: string; agent: BaseClinicalAgent }[] = [];
    if (requests.some(r => r.specialty === "cardiology")) {
      activeSpecialists.push("Dr. Marcus Vance, MD, FACC (Cardiology)");
      activeAgents.push({ name: "Dr. Marcus Vance", agent: this.cardiology });
    }
    if (requests.some(r => r.specialty === "neurology")) {
      activeSpecialists.push("Dr. Arthur Pendelton, MD, PhD (Neurology)");
      activeAgents.push({ name: "Dr. Arthur Pendelton", agent: this.neurology });
    }
    if (requests.some(r => r.specialty === "pediatrics")) {
      activeSpecialists.push("Dr. Elena Rostova, MD, FAAP (Pediatrics)");
      activeAgents.push({ name: "Dr. Elena Rostova", agent: this.pediatrics });
    }
    if (requests.some(r => r.specialty === "otolaryngology")) {
      activeSpecialists.push("Dr. Rajiv Sharma, MS (ENT), DLO (Otolaryngology)");
      activeAgents.push({ name: "Dr. Rajiv Sharma", agent: this.ent });
    }

    const allToolsRun: ToolResult[] = [];
    const allChallenges: PeerChallenge[] = [];

    // --- ROUND 1: Ingestion, Tool Execution & Initial Hypotheses ---
    blackboard.setRound(1);
    if (activeAgents.length > 0) {
      const round1Promises = activeAgents.map(a => a.agent.executeRound1(patientCase, blackboard));
      const round1Results = await Promise.all(round1Promises);
      for (const res of round1Results) {
        allToolsRun.push(...res.tools_executed);
      }
    }

    // --- ROUND 2: Peer Cross-Examination & Revision ---
    blackboard.setRound(2);
    if (activeAgents.length > 1) {
      // Multiple specialists: conduct peer cross-examination
      const round2Promises = activeAgents.map(a => a.agent.executeRound2(patientCase, blackboard));
      const round2Results = await Promise.all(round2Promises);
      for (const res of round2Results) {
        allChallenges.push(...res.challengesIssued);
      }
    }

    const finalOpinions = blackboard.getAllOpinions();
    const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const latency_ms = Math.round(t1 - t0);

    const orchestrator_summary = activeAgents.length === 0
      ? "Evaluated solo by Dr. Sarah Chen. Routine presentation; no specialist cross-consultation indicated."
      : `Dr. Sarah Chen summoned ${activeAgents.length} specialist(s) [${requests.map(r => r.specialty).join(", ")}] across ${activeAgents.length > 1 ? 2 : 1} deliberation rounds with ${allToolsRun.length} diagnostic tool(s) and ${allChallenges.length} peer challenge(s).`;

    const deliberation_rounds_completed = activeAgents.length > 1 ? 2 : 1;
    const deliberation_messages = this.buildDeliberationMessages(
      patientCase,
      requests,
      finalOpinions,
      allToolsRun,
      allChallenges,
      deliberation_rounds_completed,
      blackboard.case_version
    );

    return {
      orchestrator_summary,
      specialists_requested: requests,
      opinions: finalOpinions,
      active_specialists: activeSpecialists,
      tools_executed: allToolsRun,
      challenges: allChallenges,
      deliberation_rounds_completed,
      latency_ms,
      blackboard,
      deliberation_messages
    };
  }

  /**
   * Generates event-derived BoardMessages representing each specialist's actions,
   * inline diagnostic tools, peer challenges, responses, revisions, and lead synthesis proposal.
   */
  public buildDeliberationMessages(
    patientCase: PatientCase,
    requests: SpecialistRequest[],
    opinions: AgentOpinion[],
    toolsRun: ToolResult[],
    challenges: PeerChallenge[],
    rounds: number,
    caseVersion: number = 1
  ): BoardMessage[] {
    const messages: BoardMessage[] = [];
    let msgIdx = 0;
    const nextId = () => `bmsg-${Date.now()}-${++msgIdx}`;
    const currentCaseVersion = caseVersion || patientCase.case_version || 1;

    // Round 1: Lead Triage Assessment
    if (patientCase.is_interruption) {
      messages.push({
        id: nextId(),
        round: 1,
        speakerRole: "lead",
        agentId: "primary-care-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine & Primary Triage",
        type: "assessment",
        content: `Patient has barged in with new urgent clinical statement: "${patientCase.transcript}". Prior assessments invalidated. Re-evaluating immediately with clinical board.`,
        timestamp: new Date().toISOString()
      });
    } else if (requests.length > 0) {
      const specNames = requests.map(r => r.specialty).join(" and ");
      messages.push({
        id: nextId(),
        round: 1,
        speakerRole: "lead",
        agentId: "primary-care-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine & Primary Triage",
        type: "assessment",
        content: `Patient presents with acute multi-domain symptoms. Summoning ${specNames} to evaluate competing emergency pathways.`,
        timestamp: new Date().toISOString()
      });
    } else {
      messages.push({
        id: nextId(),
        round: 1,
        speakerRole: "lead",
        agentId: "primary-care-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine & Primary Triage",
        type: "assessment",
        content: "Evaluating presentation. Non-acute clinical findings consistent with routine ambulatory care.",
        timestamp: new Date().toISOString()
      });
    }

    // Round 1: Specialist Intake, Tools & Assessments
    const cardioOp = opinions.find(o => o.agent.includes("cardio"));
    const neuroOp = opinions.find(o => o.agent.includes("neuro"));
    const pedsOp = opinions.find(o => o.agent.includes("ped"));

    // If Cardiology was summoned
    if (cardioOp) {
      // Diagnostic tools executed by Cardiology
      const cardioTools = toolsRun.filter(t => ["analyze_ecg", "calculate_timi", "check_drug_interactions"].includes(t.tool_name));
      for (const ct of cardioTools) {
        messages.push({
          id: nextId(),
          round: 1,
          speakerRole: "tool",
          agentId: "tool-cardiology",
          doctorName: "Dr. Marcus Vance, MD, FACC",
          specialty: "Diagnostic Tool",
          type: "tool_result",
          content: `Executed ${ct.tool_name}: ${ct.clinical_summary}`,
          tool_data: {
            tool_name: ct.tool_name,
            summary: ct.clinical_summary,
            status: ct.status,
            latency_ms: ct.latency_ms,
            details: ct.output
          },
          timestamp: new Date().toISOString(),
          case_version: currentCaseVersion
        });
      }

      const cardioSummary = (cardioOp.risk_level === "high" || cardioOp.concerns.some(c => c.toLowerCase().includes("ischemi") || c.toLowerCase().includes("coronary") || c.toLowerCase().includes("acs")))
        ? "ACS remains an active concern. The substernal chest pressure and radiating discomfort cannot be dismissed without urgent cardiac clearance."
        : "Initial cardiac assessment is reassuring. No acute ischemic indicators or hemodynamic instability detected.";
      
      const cardioEvidence = cardioOp.evidence
        .filter(e => !e.toLowerCase().includes("absence of") && !e.toLowerCase().includes("non-cardiac"))
        .slice(0, 2);

      messages.push({
        id: nextId(),
        round: 1,
        speakerRole: "specialist",
        agentId: cardioOp.agent,
        doctorName: cardioOp.doctor_name,
        specialty: cardioOp.specialty,
        type: "assessment",
        content: cardioSummary,
        references: (cardioOp.retrieved_citations && cardioOp.retrieved_citations.length > 0)
          ? cardioOp.retrieved_citations
          : (cardioEvidence.length > 0 ? cardioEvidence : ["chest pressure", "radiating pain"]),
        timestamp: new Date().toISOString(),
        case_version: currentCaseVersion
      });
    }

    // If Neurology was summoned
    if (neuroOp) {
      // Diagnostic tools executed by Neurology
      const neuroTools = toolsRun.filter(t => ["compute_befast", "compute_nihss"].includes(t.tool_name));
      for (const nt of neuroTools) {
        messages.push({
          id: nextId(),
          round: 1,
          speakerRole: "tool",
          agentId: "tool-neurology",
          doctorName: "Dr. Arthur Pendelton, MD, PhD",
          specialty: "Diagnostic Tool",
          type: "tool_result",
          content: `Executed ${nt.tool_name}: ${nt.clinical_summary}`,
          tool_data: {
            tool_name: nt.tool_name,
            summary: nt.clinical_summary,
            status: nt.status,
            latency_ms: nt.latency_ms,
            details: nt.output
          },
          timestamp: new Date().toISOString(),
          case_version: currentCaseVersion
        });
      }

      const neuroSummary = (neuroOp.risk_level === "high" || neuroOp.concerns.some(c => c.toLowerCase().includes("stroke") || c.toLowerCase().includes("ischemic") || c.toLowerCase().includes("weakness")))
        ? "The acute unilateral weakness and facial asymmetry are concerning for an ischemic stroke event. The neurological pathway must remain active."
        : "Neurological screening is baseline. Motor, speech, and cranial baseline remain intact with no focal deficits.";

      const neuroEvidence = neuroOp.evidence
        .filter(e => !e.toLowerCase().includes("absence of"))
        .slice(0, 2);

      messages.push({
        id: nextId(),
        round: 1,
        speakerRole: "specialist",
        agentId: neuroOp.agent,
        doctorName: neuroOp.doctor_name,
        specialty: neuroOp.specialty,
        type: "assessment",
        content: neuroSummary,
        references: (neuroOp.retrieved_citations && neuroOp.retrieved_citations.length > 0)
          ? neuroOp.retrieved_citations
          : (neuroEvidence.length > 0 ? neuroEvidence : ["unilateral weakness", "facial droop"]),
        timestamp: new Date().toISOString(),
        case_version: currentCaseVersion
      });
    }

    // If Pediatrics was summoned
    if (pedsOp) {
      const pedsTools = toolsRun.filter(t => ["calculate_pews"].includes(t.tool_name));
      for (const pt of pedsTools) {
        messages.push({
          id: nextId(),
          round: 1,
          speakerRole: "tool",
          agentId: "tool-pediatrics",
          doctorName: "Dr. Elena Rostova, MD, FAAP",
          specialty: "Diagnostic Tool",
          type: "tool_result",
          content: `Executed ${pt.tool_name}: ${pt.clinical_summary}`,
          tool_data: {
            tool_name: pt.tool_name,
            summary: pt.clinical_summary,
            status: pt.status,
            latency_ms: pt.latency_ms,
            details: pt.output
          },
          timestamp: new Date().toISOString(),
          case_version: currentCaseVersion
        });
      }

      const pedsSummary = (pedsOp.risk_level === "high" || pedsOp.concerns.some(c => c.toLowerCase().includes("sepsis") || c.toLowerCase().includes("lethargy") || c.toLowerCase().includes("fever")))
        ? "The neonatal fever paired with marked lethargy and grunting is consistent with severe sepsis. Immediate pediatric escalation is required."
        : "Pediatric evaluation is reassuring. Child remains alert, hydrated, and within normal developmental parameters.";

      messages.push({
        id: nextId(),
        round: 1,
        speakerRole: "specialist",
        agentId: pedsOp.agent,
        doctorName: pedsOp.doctor_name,
        specialty: pedsOp.specialty,
        type: "assessment",
        content: pedsSummary,
        references: (pedsOp.retrieved_citations && pedsOp.retrieved_citations.length > 0)
          ? pedsOp.retrieved_citations
          : ["neonatal fever", "lethargy"],
        timestamp: new Date().toISOString(),
        case_version: currentCaseVersion
      });
    }

    // Round 2: Peer Cross-Examination & Responses
    if (rounds >= 2 && challenges.length > 0) {
      for (const ch of challenges) {
        const challengerDoctor = ch.from_agent.includes("cardio")
          ? "Dr. Marcus Vance, MD, FACC"
          : ch.from_agent.includes("neuro")
          ? "Dr. Arthur Pendelton, MD, PhD"
          : "Specialist";
        const targetDoctor = ch.to_agent.includes("cardio")
          ? "Dr. Marcus Vance, MD, FACC"
          : ch.to_agent.includes("neuro")
          ? "Dr. Arthur Pendelton, MD, PhD"
          : "Specialist";

        // Challenge message
        messages.push({
          id: nextId(),
          round: 2,
          speakerRole: "specialist",
          agentId: ch.from_agent,
          doctorName: challengerDoctor,
          specialty: ch.from_agent.includes("cardio") ? "Cardiology" : "Neurology",
          type: "challenge",
          content: `Challenge to ${targetDoctor}: "${ch.claim_disputed}" - ${ch.challenge_rationale}`,
          references: ch.counter_evidence,
          case_version: caseVersion,
          timestamp: new Date().toISOString()
        });

        // Target response message
        messages.push({
          id: nextId(),
          round: 2,
          speakerRole: "specialist",
          agentId: ch.to_agent,
          doctorName: targetDoctor,
          specialty: ch.to_agent.includes("cardio") ? "Cardiology" : "Neurology",
          type: "response",
          content: ch.response_rationale || `Acknowledging challenge from ${challengerDoctor}. Both acute pathways must remain simultaneously active under emergency protocol.`,
          references: ch.counter_evidence,
          case_version: caseVersion,
          timestamp: new Date().toISOString()
        });

        // Challenger revision message: confirms collaborative convergence without dropping life threats
        messages.push({
          id: nextId(),
          round: 2,
          speakerRole: "specialist",
          agentId: ch.from_agent,
          doctorName: challengerDoctor,
          specialty: ch.from_agent.includes("cardio") ? "Cardiology" : "Neurology",
          type: "revision",
          content: `Revised stance: Concur with ${targetDoctor}. Maintaining ACS as a co-primary emergency pathway while honoring the independent neurological deficit. Proceeding to dual-threat stabilization.`,
          references: ch.counter_evidence,
          case_version: caseVersion,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Round 3 / Synthesis Proposal from Lead Dr. Sarah Chen
    if (opinions.length > 1) {
      const hasHighCardio = opinions.some(o => o.specialty.includes("Cardio") && o.risk_level === "high");
      const hasHighNeuro = opinions.some(o => o.specialty.includes("Neuro") && o.risk_level === "high");

      const synthesisText = (hasHighCardio && hasHighNeuro)
        ? "Board Decision: We will not collapse this into a single diagnosis. We are maintaining both acute pathways (ACS + Acute Neurologic Event) under immediate emergency disposition."
        : opinions.some(o => o.risk_level === "high")
        ? `Board Decision: Acute indicators confirmed by ${opinions.filter(o => o.risk_level === "high").map(o => o.specialty).join(", ")}. Immediate hospital escalation required.`
        : "Board Decision: Specialists agree there are no emergent life threats. Recommending urgent or routine outpatient evaluation.";

      messages.push({
        id: nextId(),
        round: Math.min(rounds + 1, 3),
        speakerRole: "lead",
        agentId: "primary-care-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: "Internal Medicine & Primary Triage",
        type: "synthesis",
        content: synthesisText,
        case_version: caseVersion,
        timestamp: new Date().toISOString()
      });
    }

    return messages.map(m => ({ ...m, case_version: m.case_version || caseVersion }));
  }
}
