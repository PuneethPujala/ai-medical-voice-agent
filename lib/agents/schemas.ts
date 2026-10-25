import { z } from "zod";

/**
 * PATIENT DEMOGRAPHICS SCHEMA
 */
export const DemographicsSchema = z.object({
  age: z.number().optional(),
  age_group: z.enum(["infant", "pediatric", "young_adult", "adult", "older_adult"]).default("adult"),
  gender: z.enum(["male", "female", "other"]).optional(),
});
export type Demographics = z.infer<typeof DemographicsSchema>;

/**
 * SPEECH & PARALINGUISTIC FEATURES SCHEMA
 * Structured as measured signals and observed acoustic characteristics.
 */
export const SpeechFeaturesSchema = z.object({
  speech_pause_ratio: z.number().min(0).max(1).nullable().optional(),
  mean_pause_duration_ms: z.number().nonnegative().nullable().optional(),
  speech_rate_wpm: z.number().nonnegative().nullable().optional(),
  voice_energy_variability: z.number().min(0).max(1).nullable().optional(),
  pitch_variability: z.number().min(0).max(1).nullable().optional(),
  // Nominal speaking pace configuration for conversational pacing when acoustic telemetry is absent.
  // Not an estimate of the patient's biological speech.
  dialogue_pacing_wpm: z.number().nonnegative().optional(),
  observations: z.array(z.string()).default([]),
  clinical_relevance: z.object({
    respiratory_distress_signal: z.enum(["unlikely", "possible", "probable", "severe"]).default("unlikely"),
    vocal_instability_signal: z.enum(["none", "mild", "pronounced"]).default("none"),
    confidence: z.number().min(0).max(1).default(0.5),
  }).default({
    respiratory_distress_signal: "unlikely",
    vocal_instability_signal: "none",
    confidence: 0.5,
  }),
});
export type SpeechFeatures = z.infer<typeof SpeechFeaturesSchema>;

/**
 * EVIDENCE PROVENANCE & SEMANTICS
 * Distinguishes patient-reported vs device-measured vs tool-derived vs agent-inferred vs deterministic.
 */
export const EvidenceProvenanceSourceSchema = z.enum([
  "patient_reported",
  "device_measured",
  "tool_derived",
  "agent_inferred",
  "ai_inferred",
  "deterministic_pre_arbiter",
  "not_assessed",
]);
export type EvidenceProvenanceSource = z.infer<typeof EvidenceProvenanceSourceSchema>;

export const ConfidenceSemanticsSchema = z.enum([
  "deterministic_flag",
  "tool_calibrated",
  "uncalibrated_model_score",
  "patient_statement",
  "unassessed"
]);
export type ConfidenceSemantics = z.infer<typeof ConfidenceSemanticsSchema>;

export const EvidenceItemSchema = z.object({
  id: z.string(),
  domain: z.string().optional(),
  label: z.string().optional(),
  type: z.string(),
  description: z.string(),
  value: z.any().optional(),
  status: z.enum(["present", "absent", "denied", "not_assessed", "inferred", "unknown"]).default("present").optional(),
  source: EvidenceProvenanceSourceSchema,
  confidence: z.number().nullable().default(null),
  confidence_semantics: ConfidenceSemanticsSchema.default("patient_statement"),
  turnId: z.number().optional(),
  timestamp: z.string(),
  raw_payload: z.record(z.string(), z.any()).optional()
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

/**
 * NORMALIZED PATIENT CASE SCHEMA
 * The canonical clinical payload passed from intake into the multi-agent board.
 */
export const PatientCaseSchema = z.object({
  patient_id: z.string().default("ANON-PT"),
  patient_name: z.string().default("Patient"),
  transcript: z.string(),
  conversation_history: z.array(z.object({
    role: z.enum(["doctor", "patient", "system"]),
    text: z.string(),
    timestamp: z.string().optional(),
  })).default([]),
  demographics: DemographicsSchema.default({
    age_group: "adult",
  }),
  detected_symptoms: z.array(z.string()).default([]),
  vitals: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  speech_features: SpeechFeaturesSchema.default({
    speech_pause_ratio: 0.15,
    mean_pause_duration_ms: 350,
    speech_rate_wpm: 130,
    voice_energy_variability: 0.1,
    pitch_variability: 0.12,
    observations: [],
    clinical_relevance: {
      respiratory_distress_signal: "unlikely",
      vocal_instability_signal: "none",
      confidence: 0.5,
    },
  }),
  pre_safety_flags: z.array(z.string()).default([]),
  immediate_danger_detected: z.boolean().default(false),
  provenance_evidence: z.array(EvidenceItemSchema).default([]),
  is_interruption: z.boolean().optional(),
  interrupted_agent: z.string().optional(),
  case_version: z.number().default(1).optional()
});
export type PatientCase = z.infer<typeof PatientCaseSchema>;

/**
 * SPECIALIST INVOCATION REQUEST SCHEMA
 */
export const SpecialistRequestSchema = z.object({
  specialty: z.enum(["cardiology", "neurology", "pediatrics", "otolaryngology"]),
  reason: z.string(),
  priority: z.enum(["immediate", "routine"]).default("routine"),
  trigger_flags: z.array(z.string()).default([]),
});
export type SpecialistRequest = z.infer<typeof SpecialistRequestSchema>;

/**
 * CLINICAL TOOL REQUEST & RESULT SCHEMAS
 */
export const ToolRequestSchema = z.object({
  tool_name: z.string(),
  rationale: z.string(),
  parameters: z.record(z.string(), z.any()).default({})
});
export type ToolRequest = z.infer<typeof ToolRequestSchema>;

export const ToolResultSchema = z.object({
  tool_name: z.string(),
  status: z.enum(["success", "error", "skipped"]),
  output: z.record(z.string(), z.any()),
  clinical_summary: z.string(),
  latency_ms: z.number().default(0)
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

/**
 * PEER CHALLENGE SCHEMA
 */
export const PeerChallengeSchema = z.object({
  from_agent: z.string(),
  to_agent: z.string(),
  claim_disputed: z.string(),
  counter_evidence: z.array(z.string()),
  challenge_rationale: z.string(),
  resolved: z.boolean().default(false),
  response_rationale: z.string().optional()
});
export type PeerChallenge = z.infer<typeof PeerChallengeSchema>;

/**
 * SPECIALIST STRUCTURED CLINICAL OPINION SCHEMA
 */
export const AgentOpinionSchema = z.object({
  agent: z.string(),
  doctor_name: z.string(),
  specialty: z.string(),
  deliberation_round: z.number().default(1),
  primary_hypothesis: z.string().default("General evaluation"),
  concerns: z.array(z.string()),
  evidence: z.array(z.string()).default([]),
  evidence_for: z.array(z.string()).default([]),
  evidence_against: z.array(z.string()).default([]),
  missing_evidence: z.array(z.string()).default([]),
  tool_invocations: z.array(ToolResultSchema).default([]),
  challenges_issued: z.array(PeerChallengeSchema).default([]),
  challenges_received: z.array(PeerChallengeSchema).default([]),
  risk_level: z.enum(["high", "moderate", "low"]),
  recommended_actions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  confidence_semantics: ConfidenceSemanticsSchema.default("uncalibrated_model_score"),
  requires_escalation: z.boolean(),
  speech_observations_evaluated: z.array(z.string()).default([]),
  clinical_protocol: z.string().default("Standard evaluation"),
  retrieved_citations: z.array(z.string()).default([]),
});
export type AgentOpinion = z.infer<typeof AgentOpinionSchema>;

/**
 * DIFFERENTIAL DIAGNOSIS ITEM
 */
export const DifferentialItemSchema = z.object({
  condition: z.string(),
  probability: z.enum(["high", "moderate", "low"]),
  supporting_agents: z.array(z.string()),
  clinical_rationale: z.string(),
  competing_hypotheses: z.array(z.string()).default([])
});
export type DifferentialItem = z.infer<typeof DifferentialItemSchema>;

/**
 * CLINICAL CONFLICT SCHEMA
 */
export const ClinicalConflictSchema = z.object({
  topic: z.string(),
  agents: z.array(z.string()),
  conflict_description: z.string().default(""),
  resolution: z.string(),
  status: z.enum(["resolved", "concurrent_active_threats"]).default("resolved")
});
export type ClinicalConflict = z.infer<typeof ClinicalConflictSchema>;

/**
 * BOARD MESSAGE & CONVERSATIONAL DELIBERATION SCHEMA
 * Represents one discrete, observable event in the multi-agent clinical deliberation.
 */
export const BoardMessageSpeakerRoleSchema = z.enum([
  "lead",
  "specialist",
  "tool",
  "system",
  "safety_arbiter"
]);
export type BoardMessageSpeakerRole = z.infer<typeof BoardMessageSpeakerRoleSchema>;

export const BoardMessageTypeSchema = z.enum([
  "assessment",
  "challenge",
  "response",
  "evidence_request",
  "tool_result",
  "revision",
  "synthesis",
  "safety_disposition"
]);
export type BoardMessageType = z.infer<typeof BoardMessageTypeSchema>;

export const BoardMessageSchema = z.object({
  id: z.string(),
  speakerRole: BoardMessageSpeakerRoleSchema,
  agentId: z.string(),
  doctorName: z.string(),
  specialty: z.string(),
  round: z.number().default(1),
  type: BoardMessageTypeSchema,
  content: z.string(),
  references: z.array(z.string()).optional(),
  tool_data: z.object({
    tool_name: z.string(),
    summary: z.string(),
    status: z.string(),
    latency_ms: z.number().optional(),
    details: z.record(z.string(), z.any()).optional()
  }).optional(),
  case_version: z.number().default(1).optional(),
  timestamp: z.string().default(() => new Date().toISOString())
});
export type BoardMessage = z.infer<typeof BoardMessageSchema>;

/**
 * CLINICAL CONSENSUS SCHEMA
 */
export const ClinicalConsensusSchema = z.object({
  differential: z.array(DifferentialItemSchema),
  conflicts: z.array(ClinicalConflictSchema).default([]),
  recommended_disposition: z.enum([
    "emergency_evaluation",
    "urgent_outpatient",
    "routine_outpatient"
  ]),
  consensus_risk: z.enum(["critical", "urgent", "routine"]),
  primary_specialty: z.string().default("general"),
  key_findings: z.array(z.string()),
  synthesized_reply_narrative: z.string(),
  orchestrator_summary: z.string(),
  requires_immediate_escalation: z.boolean().default(false),
  active_specialists: z.array(z.string()),
  deliberation_rounds_completed: z.number().default(1),
  deliberation_messages: z.array(BoardMessageSchema).default([])
});
export type ClinicalConsensus = z.infer<typeof ClinicalConsensusSchema>;

/**
 * AUDIT HASH CHAIN BLOCK SCHEMA
 */
export interface HashChainBlock {
  block_index: number;
  timestamp: string;
  event_type: "pre_arbiter" | "round_1_hypotheses" | "round_2_challenges" | "consensus_synthesis" | "post_arbiter_override";
  payload_summary: string;
  previous_hash: string;
  current_hash: string;
}

/**
 * FULL BOARD EXECUTION TRACE
 */
export interface BoardExecutionTrace {
  timestamp: string;
  patient_id: string;
  case_version: number;
  execution_mode: "deterministic_pipeline" | "hybrid_llm";
  deliberation_rounds: number;
  pre_arbiter_latency_us: number;
  orchestrator_latency_ms: number;
  specialist_latencies_ms: Record<string, number>;
  tool_latencies_ms: Record<string, number>;
  synthesis_latency_ms: number;
  post_arbiter_latency_us: number;
  total_board_latency_ms: number;
  specialists_summoned: string[];
  tools_executed: string[];
  tools_executed_details?: ToolResult[];
  peer_challenges_count: number;
  peer_challenges?: PeerChallenge[];
  pre_safety_flags: string[];
  immediate_danger: boolean;
  opinions: AgentOpinion[];
  consensus: ClinicalConsensus;
  post_arbiter_override: boolean;
  final_esi_level: number;
  final_disposition: string;
  audit_hash_chain: HashChainBlock[];
  root_audit_hash: string;
  deliberation_messages: BoardMessage[];
}

/**
 * AGENT EVIDENCE & ACTION REQUEST
 * Specialist agents emit structured requests to the Blackboard / Conversation Manager.
 */
export interface AgentRequest {
  id: string;
  fromAgent: "cardiology" | "neurology" | "pediatrics" | "internal_medicine" | "otolaryngology";
  doctorName: string;
  type: "patient_question" | "tool_execution" | "specialist_review";
  targetSlot: string;
  urgency: "critical" | "high" | "normal";
  reason: string;
  suggestedQuestion?: string;
  status: "pending" | "resolved" | "superseded";
  caseVersion: number;
}

/**
 * QUESTION SLOT STATUS SCHEMA
 * Tracks the resolution of individual facts inside single or compound questions.
 */
export interface QuestionSlotStatus {
  slot: string;
  status: "answered" | "explicitly_denied" | "unknown" | "ambiguous" | "pending";
  value?: string;
  resolvedAtTurn?: number;
}

/**
 * PENDING QUESTION SCHEMA
 * The active question posed to the patient by Lead Clinician Dr. Sarah Chen.
 */
export interface PendingQuestion {
  id: string;
  targetSlot: string;
  targetSlots?: string[];
  askedBy: "sarah" | "marcus" | "arthur" | "elena" | "rajiv";
  doctorName: string;
  patientFacingSpeaker: "sarah";
  question: string;
  purpose: string;
  required: boolean;
  priority: "critical" | "high" | "normal";
  status: "pending" | "resolved" | "partially_resolved" | "ambiguous" | "superseded";
  createdAt: string;
  caseVersion: number;
  slotStatuses?: Record<string, QuestionSlotStatus>;
}

/**
 * 6-DIMENSIONAL EPISTEMIC CLINICAL FACT
 * Decouples clinical assertion status from question resolution status.
 */
export type FactAssertionStatus = "present" | "absent" | "uncertain";
export type FactTemporality = "current" | "historical" | "resolved";
export type FactAttribution = "patient" | "third_party" | "caregiver_report";
export type FactAssessmentCoverage = "unassessed" | "partially_assessed" | "assessed";

export interface AttributedClinicalFactV3 {
  id: string;
  concept: string;
  assertionStatus: FactAssertionStatus;
  temporality: FactTemporality;
  attribution: FactAttribution;
  coverage: FactAssessmentCoverage;
  sourceUtterance: string;
  sourceSpeaker: "patient" | "caregiver" | "clinician";
  turnId: number;
  confidence: "deterministic_flag" | "calibrated_score" | "explicit_unknown";
  timestamp: string;
}

/**
 * OPEN-WORLD UNMAPPED OBSERVATION
 * Preserves raw patient descriptions without forcing them into existing slots or promoting them to facts.
 */
export interface UnmappedObservation {
  id: string;
  rawEvidence: string;
  inferredConcept?: string;
  status: "unverified_proposal" | "acknowledged_by_clinician";
  turnId: number;
  timestamp: string;
}

/**
 * QUESTION RESOLUTION STATUS
 */
export type QuestionResolutionStatus =
  | "unanswered"
  | "partially_answered"
  | "answered"
  | "awaiting_clarification"
  | "superseded";

/**
 * CONVERSATIONAL ACTION PALETTE
 */
export type ConversationalActionType =
  | "INQUIRE"
  | "CLARIFY_AMBIGUITY"
  | "EXPLAIN_RATIONALE"
  | "ACKNOWLEDGE_AND_UPDATE"
  | "SUMMARIZE_AND_ALIGN"
  | "CONVENE_BOARD"
  | "EMERGENCY_ESCALATION";

/**
 * DELIVERED TURN RECORD
 * Distinguishes generated response, delivered response, and playback status.
 */
export interface DeliveredTurnRecord {
  turnId: number;
  clientTurnId?: string;
  deliveredText: string;
  conversationalAction: ConversationalActionType;
  intendedTargets: string[];
  targetResolutionStatuses: Record<string, QuestionResolutionStatus>;
  relevantEvidenceRefs: string[];
  caseVersion: number;
  timestamp: string;
  audioDeliveryStatus?: "pending" | "synthesizing" | "delivered" | "interrupted" | "failed";
  audioDeliveryResult?: { playedDurationMs?: number; confirmedAt?: string };
  cachedResponsePayload?: any;
}
