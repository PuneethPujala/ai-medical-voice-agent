import { spawnSync } from "child_process";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env" });
}

export interface TestSuiteDefinition {
  id: string;
  file: string;
  description: string;
  requiresDatabase?: boolean;
}

export const CANONICAL_TEST_BATTERY: TestSuiteDefinition[] = [
  // 1. Zero-Trust Security, Auth RBAC, and Identity
  { id: "test:security", file: "tests/security-eval/cors-rbac-audit.test.ts", description: "Zero-Trust Security, RBAC & CORS Audit" },
  { id: "test:chat-isolation", file: "tests/security-eval/chat-identity-isolation.test.ts", description: "Chat Identity & Tenant Isolation" },
  { id: "test:profile-persistence", file: "tests/patient-profile/profile-persistence.test.ts", description: "Patient Profile Persistence & DPDP Compliance" },
  { id: "test:context-chat", file: "tests/patient-profile/context-aware-chat.test.ts", description: "Context-Aware Chat & Profile Ingestion" },
  { id: "test:consultation-lifecycle", file: "tests/security-eval/consultation-lifecycle.test.ts", description: "Consultation Lifecycle & Signing Invariants" },
  { id: "test:voice-telemetry", file: "tests/security-eval/voice-telemetry-lifecycle.test.ts", description: "Voice Telemetry Isolation & RBAC Lifecycle" },

  // 2. Concurrency, Durability, and Persistence
  { id: "test:concurrency-durable", file: "tests/security-eval/optimistic-concurrency-durable-state.test.ts", description: "Optimistic Concurrency & Case Versioning" },
    { id: "test:persistence-audit", file: "tests/verification/persistence-and-audit-integrity.test.ts", description: "Clinical Evidence Ledger, Audit Chaining & Failure-Path Safety" },
  { id: "test:atomic-concurrency", file: "tests/security-eval/atomic-concurrency-idempotency.test.ts", description: "Atomic CAS & Unique Idempotency", requiresDatabase: true },
  { id: "test:durable-audit", file: "tests/security-eval/durable-audit.test.ts", description: "Durable SHA-256 Chained Audit Ledger", requiresDatabase: true },
  { id: "test:turn-idempotency", file: "tests/security-eval/turn-idempotency-defense.test.ts", description: "Finding 7: Turn Idempotency Defense & Atomic Fencing Battery" },

  // 3. Clinical Safety, Arbiters & Red Flags
  { id: "test:safetyarbiter", file: "scripts/test-safety-arbiter-decision.ts", description: "Deterministic Safety Arbiter & Urgency Invariants" },
  { id: "test:safetyintegration", file: "scripts/test-clinical-safety-integration.ts", description: "Clinical Safety Integration & Red-Flag Escalation" },
  { id: "test:remediations", file: "scripts/test-clinical-safety-remediations.ts", description: "Clinical Safety Remediation Invariants" },
  { id: "test:severity", file: "scripts/test-severity-and-nondeniable.ts", description: "Severity & Non-Deniable Symptom Guards" },
  { id: "test:independence", file: "scripts/test-classifier-independence.ts", description: "Universal Red-Flag & Classifier Independence" },
  { id: "test:false-dispatch", file: "tests/triage/false-dispatch-prevention.test.ts", description: "False Dispatch Prevention & Non-Emergency Controls" },
  { id: "test:headache", file: "scripts/test-headache-compound-regression.ts", description: "Headache Compound Extraction & Question Validation" },
  { id: "test:adversarial-red-flags", file: "tests/adversarial-red-flags.ts", description: "102-Case Adversarial Red-Flag Recall Invariants" },

  // 4. Conversational Dialogue & State Reasoning
  { id: "test:route-dialogue", file: "tests/triage/route-voice-chat-dialogue.test.ts", description: "Route-Level /api/voice/chat Multi-Turn State Contract" },
  { id: "test:dialogue-reasoning", file: "tests/triage/dialogue-reasoning-eval.ts", description: "LLM-First Dialogue Reasoning & State Contract" },
  { id: "test:clarify-dialogue", file: "tests/triage/clarify-natural-dialogue.test.ts", description: "Conversational Clarification & Natural Dialogue" },
  { id: "test:question-state", file: "tests/triage/question-state-repetition.test.ts", description: "Question State Tracking & Anti-Repetition" },
  { id: "test:fact-reconciliation", file: "tests/triage/structured-fact-reconciliation.test.ts", description: "Structured Fact Reconciliation & Negation Tracking" },
  { id: "test:loss-aware-context", file: "tests/triage/loss-aware-context-assembler.test.ts", description: "Loss-Aware Context Assembler & Windowing" },
  { id: "test:unknown-age", file: "tests/triage/unknown-age-pediatric.test.ts", description: "Unknown Age Handling & Pediatric Fallbacks" },
  { id: "test:goldendialogue", file: "scripts/test-golden-clinical-dialogue.ts", description: "11-Turn Golden Clinical Dialogue Benchmark" },

  // 5. Clinical State, Provenance & Decision Engine
  { id: "test:subfield", file: "scripts/test-subfield-clinical-state.ts", description: "Subfield Clinical State Tracking" },
  { id: "test:multiclause", file: "scripts/test-multi-clause-clinical-state.ts", description: "Multi-Clause Compound Clinical Input" },
  { id: "test:interpreter", file: "scripts/test-conversation-interpreter.ts", description: "Conversation Interpreter & Slot Filling" },
  { id: "test:planner", file: "scripts/test-response-planner-scenarios.ts", description: "Response Planner Clinical Scenarios" },
  { id: "test:engine", file: "scripts/test-clinical-conversation-engine.ts", description: "Clinical Conversation Engine Orchestration" },
  { id: "test:adversarial", file: "scripts/test-clinical-adversarial-scenarios.ts", description: "Clinical Adversarial & Boundary Scenarios" },
  { id: "test:provenance", file: "scripts/test-provenance-soap.ts", description: "SOAP Note Provenance & Evidence Attribution" },
  { id: "test:manager", file: "scripts/test-conversational-manager.ts", description: "Conversational Manager State Machine" },

  // 6. Clinical Knowledge & Retrieval
  { id: "test:rag", file: "scripts/test-clinical-rag.ts", description: "Deterministic Clinical RAG Engine" },
  { id: "test:context-rag", file: "scripts/test-context-aware-retrieval.ts", description: "Context-Aware Retrieval & Ranking" },
  { id: "test:presentation", file: "scripts/test-presentation-context.ts", description: "Presentation Context & Disease Matching" },
  { id: "test:medication-safety", file: "tests/triage/medication-safety-engine.test.ts", description: "Deterministic Medication Safety & Contraindication Engine" },
  { id: "test:explanatory", file: "scripts/test-explanatory-clinical-reasoning.ts", description: "Explanatory Clinical Reasoning & Provenance" },

  // 7. Multi-Agent Clinical Board
  { id: "test:board", file: "scripts/run-multi-agent-eval.ts", description: "Bounded Multi-Specialist Clinical Board" },
  { id: "test:clinical", file: "scripts/run-clinical-eval.ts", description: "Lead Internist Clinical Intake Evaluation" },
  { id: "test:interview", file: "scripts/test-clinical-interview.ts", description: "Clinical Interview Turn-Taking & Protocol" },
  { id: "test:discussion", file: "scripts/test-cardioneuro-discussion.ts", description: "Cardio-Neurology Multi-Agent Discussion" },

  // 8. Voice Lifecycle, Barge-In & Speech Pipeline
  { id: "test:voicestate", file: "scripts/test-voice-state-lifecycle.ts", description: "Voice State Machine Lifecycle & Discard" },
  { id: "test:bargein", file: "scripts/test-bargein.ts", description: "Barge-in Interruption & Playback Invalidation" },
  { id: "test:acceptance", file: "scripts/test-bargein-acceptance.ts", description: "Browser Barge-In End-to-End Acceptance" },
  { id: "test:safety-streaming", file: "tests/streaming/safety-gated-streaming-and-bargein.test.ts", description: "Safety-Gated Voice Streaming & Deterministic Barge-In Battery" },
  { id: "test:voice-intelligence", file: "tests/voice/conversation-intelligence.test.ts", description: "Multi-Clause Temporal Progression & Non-Destructive Ledger" },
  { id: "test:voice-intake", file: "tests/voice/voice-intake-review.test.ts", description: "Voice Intake State Machine & Transcript Review Safety" },
  { id: "test:stt-recovery", file: "tests/stt/empty-transcript-recovery.test.ts", description: "Empty-Transcript STT Fallback & Patient Recovery" },
  { id: "test:multi-turn-concurrency", file: "tests/voice/multi-turn-concurrency.test.ts", description: "Multi-Turn Concurrency & Optimistic Version Synchronization" },
  { id: "test:whole-conversation-stress", file: "tests/voice/whole-conversation-stress.test.ts", description: "Whole-Conversation 4-Layer Context Behavioral Stress" },

  // 9. Healthcare Standards & Emergency Dispatch
  { id: "test:fhir", file: "tests/fhir-eval/fhir.test.ts", description: "HL7 FHIR R4 Bundle Validation & Conformance" },
  { id: "test:fhir-paralinguistic", file: "tests/fhir/paralinguistic-observation.test.ts", description: "HL7 FHIR R4 Paralinguistic Acoustic Observation Conformance" },
  { id: "test:fhir-temporal-utils", file: "tests/fhir/temporal-utils.test.ts", description: "FHIR Temporal Provenance & Normalization Utilities" },
  { id: "test:fhir-condition-temporal", file: "tests/fhir/condition-temporal-provenance.test.ts", description: "FHIR Condition Temporal Decoupling & Provenance" },
  { id: "test:dispatch", file: "tests/emergency-eval/dispatch.test.ts", description: "Emergency Pre-Arrival Dispatch & Audit Hash" },
];

export async function runTestBattery() {
  console.log("================================================================================");
  console.log("             MEDVOICE DETERMINISTIC TEST BATTERY EXECUTION                      ");
  console.log("================================================================================");

  const enableLiveDb = process.argv.includes("--with-db") && Boolean(process.env.DATABASE_URL);
  const enableLiveLlm = process.argv.includes("--with-live-llm");

  if (!enableLiveDb) {
    console.log("ℹ️  OFFLINE DETERMINISTIC MODE: Isolated from external network & live datastore.");
    console.log("   Suites requiring real PostgreSQL are SKIPPED (not verified in offline mode).");
    console.log("   ⚠️  Live PostgreSQL integration coverage is NOT claimed in this run.");
    console.log("   (Run 'npm run test:all -- --with-db' or 'npm run test:db' with DATABASE_URL configured to verify live database)");
  } else {
    console.log("✅ LIVE DATABASE MODE: Real PostgreSQL integration verification active.");
  }

  if (!enableLiveLlm) {
    console.log("ℹ️  OFFLINE LLM MODE: Third-party cloud LLM API calls disabled for deterministic stability.\n");
  } else {
    console.log("✅ LIVE LLM MODE: Live model dialogue calls enabled.\n");
  }

  const results: Array<{
    suite: TestSuiteDefinition;
    status: "PASS" | "FAIL" | "SKIPPED_DB";
    durationMs: number;
  }> = [];

  const overallStartTime = Date.now();

  for (let i = 0; i < CANONICAL_TEST_BATTERY.length; i++) {
    const suite = CANONICAL_TEST_BATTERY[i];
    const indexLabel = `[${i + 1}/${CANONICAL_TEST_BATTERY.length}]`;
    console.log(`\n${indexLabel} RUNNING ${suite.id} -> ${suite.file}`);
    console.log(`     Description: ${suite.description}`);

    if (suite.requiresDatabase && !enableLiveDb) {
      console.log(`  ℹ️  ${suite.id}: SKIPPED (Real PostgreSQL datastore required; skipped in offline mode).`);
      results.push({ suite, status: "SKIPPED_DB", durationMs: 0 });
      continue;
    }

    const suiteStartTime = Date.now();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
    };

    if (!enableLiveDb) {
      delete env.DATABASE_URL;
      env.MEDVOICE_OFFLINE_TESTS = "1";
    }
    if (!enableLiveLlm) {
      delete env.GROQ_API_KEY;
      delete env.NVIDIA_API_KEY;
      delete env.ASSEMBLYAI_API_KEY;
    }

    const child = spawnSync("npx", ["tsx", suite.file], {
      stdio: "inherit",
      shell: true,
      env,
    });

    const durationMs = Date.now() - suiteStartTime;

    if (child.status !== 0) {
      console.error(`\n❌ FAILED: ${suite.id} (${suite.file}) exited with status code ${child.status}`);
      results.push({ suite, status: "FAIL", durationMs });
      console.error(`\nTest battery aborted due to failure in ${suite.id}.`);
      process.exit(child.status || 1);
    }

    console.log(`  ✓  ${suite.id}: PASSED (${durationMs}ms)`);
    results.push({ suite, status: "PASS", durationMs });
  }

  const totalDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
  const passedCount = results.filter((r) => r.status === "PASS").length;
  const skippedDbCount = results.filter((r) => r.status === "SKIPPED_DB").length;
  const failedCount = results.filter((r) => r.status === "FAIL").length;

  console.log("\n================================================================================");
  console.log("                   MEDVOICE TEST BATTERY SUMMARY                                ");
  console.log("================================================================================");
  console.log(`  Total Suites:                ${CANONICAL_TEST_BATTERY.length}`);
  console.log(`  Fully Verified:              ${passedCount}`);
  console.log(`  Skipped DB-required suites:  ${skippedDbCount}`);
  console.log(`  Failed:                      ${failedCount}`);
  console.log(`  Total Duration:              ${totalDuration}s`);
  if (skippedDbCount > 0) {
    console.log("  ⚠️  Database Status:         SKIPPED (DATABASE_URL unset or --with-db omitted; real PostgreSQL not verified)");
  } else {
    console.log("  ✅  Database Status:         VERIFIED (Real PostgreSQL connected)");
  }
  console.log("================================================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

if (require.main === module || process.argv[1]?.endsWith("run-test-battery.ts")) {
  runTestBattery().catch((err) => {
    console.error("Fatal error running test battery:", err);
    process.exit(1);
  });
}
