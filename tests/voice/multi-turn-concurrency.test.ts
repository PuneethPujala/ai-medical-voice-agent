/**
 * Comprehensive Multi-Turn Live Consultation & Concurrency Invariant Verification
 *
 * Directly executes the Next.js API route handlers:
 * - `POST /api/consultations` (app/api/consultations/route.ts)
 * - `POST /api/voice/chat` (app/api/voice/chat/route.ts)
 *
 * Verifies:
 * 1. Initial encounter registration (version 1)
 * 2. Turn 1 (Chief complaint: gradual onset) -> Groq LLM deliberation -> caseVersion advances to 2 -> Persist to 3
 * 3. Turn 2 (Character & associated symptoms) -> dialogue state evolution -> caseVersion advances to 4 -> Persist to 5
 * 4. Turn 3 (Location & timeline) -> dialogue state evolution -> caseVersion advances to 6 -> Persist to 7
 * 5. Injected 409 Concurrency Conflict (submitting version 6 <= datastore version 7) -> server strictly rejects with 409
 * 6. Server communicates currentVersion: 7 in 409 response -> client synchronizes ref and retries with version 8 -> succeeds with HTTP 200
 * 7. Verification that consultation history contains all turns and is never truncated or corrupted.
 */

import assert from "assert";
import { POST as postConsultation } from "../../app/api/consultations/route";
import { POST as postVoiceChat } from "../../app/api/voice/chat/route";
import { INTERNAL_TEST_SECRET_HEADER, DEFAULT_INTERNAL_TEST_SECRET } from "../../lib/auth/rbac";

// Set test environment for authorized internal harness execution
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

function createHeaders(userId: string = "patient-david-101"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-mock-role": "patient",
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
  };
}

async function runMultiTurnSuite() {
  console.log("================================================================================");
  console.log("      MEDVOICE 3-TURN LIVE CONSULTATION & CONCURRENCY VERIFICATION              ");
  console.log("================================================================================\n");

  const encounterId = `ENC-LIVE-VERIFY-${Date.now().toString().slice(-6)}`;
  const userId = "patient-david-101";
  console.log(`[Setup] Target Encounter ID: ${encounterId}`);

  // 1. Initial Encounter Registration
  console.log("\n>>> STAGE 1: Register initial consultation encounter...");
  const initReq = new Request("http://localhost:3000/api/consultations", {
    method: "POST",
    headers: createHeaders(userId),
    body: JSON.stringify({
      id: encounterId,
      patientName: "David Miller",
      patientAge: "38",
      patientGender: "male",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "General Physician",
      chiefComplaint: "Headache consultation",
      transcript: [],
      status: "in_progress",
      caseVersion: 1,
    }),
  });

  const initRes = await postConsultation(initReq);
  const initData = await initRes.json();
  assert.strictEqual(initRes.status, 200, "Initial encounter created successfully");
  let currentCaseVersion = initData.consultation?.caseVersion || 1;
  console.log(`✓ Initial encounter created in datastore. Initial caseVersion: ${currentCaseVersion}`);

  // 2. Turn 1
  console.log("\n>>> STAGE 2: Turn 1 - Spoken Chief Complaint (Gradual Onset)");
  const turn1Msg = "The headache came on gradually over two days.";
  console.log(`[Turn 1] Patient says: "${turn1Msg}"`);

  const chat1Req = new Request("http://localhost:3000/api/voice/chat", {
    method: "POST",
    headers: createHeaders(userId),
    body: JSON.stringify({
      encounterId,
      doctorId: "dr-sarah-chen",
      message: turn1Msg,
      conversationHistory: [
        { role: "patient", text: turn1Msg, timestamp: "10:00 AM" }
      ],
      patientName: "David Miller",
      patientAge: "38",
    }),
  });

  const chat1Res = await postVoiceChat(chat1Req);
  const chat1Data = await chat1Res.json();
  assert.strictEqual(chat1Res.status, 200, "Turn 1 chat succeeded");
  console.log(`✓ Turn 1 Doctor Reply: "${chat1Data.doctorReply?.slice(0, 75)}..."`);
  console.log(`✓ Turn 1 Server-reported caseVersion: ${chat1Data.caseVersion}`);
  assert.ok(chat1Data.caseVersion >= 2, "Server caseVersion advanced after turn 1");
  currentCaseVersion = chat1Data.caseVersion;

  // Persist Turn 1 with next version
  const persist1Req = new Request("http://localhost:3000/api/consultations", {
    method: "POST",
    headers: createHeaders(userId),
    body: JSON.stringify({
      id: encounterId,
      patientName: "David Miller",
      transcript: [
        { role: "patient", text: turn1Msg, timestamp: "10:00 AM" },
        { role: "doctor", text: chat1Data.doctorReply, timestamp: "10:00 AM" }
      ],
      status: "in_progress",
      caseVersion: currentCaseVersion + 1,
    }),
  });

  const persist1Res = await postConsultation(persist1Req);
  const persist1Data = await persist1Res.json();
  assert.strictEqual(persist1Res.status, 200, "Turn 1 persistence succeeded with HTTP 200");
  currentCaseVersion = persist1Data.consultation?.caseVersion;
  console.log(`✓ Turn 1 Persist HTTP 200. Datastore caseVersion: ${currentCaseVersion}`);

  // 3. Turn 2
  console.log("\n>>> STAGE 3: Turn 2 - Character & Associated Symptoms");
  const turn2Msg = "No, breathing is normal, but the pain is dull and constant.";
  console.log(`[Turn 2] Patient says: "${turn2Msg}"`);

  const chat2Req = new Request("http://localhost:3000/api/voice/chat", {
    method: "POST",
    headers: createHeaders(userId),
    body: JSON.stringify({
      encounterId,
      doctorId: "dr-sarah-chen",
      message: turn2Msg,
      conversationHistory: [
        { role: "patient", text: turn1Msg, timestamp: "10:00 AM" },
        { role: "doctor", text: chat1Data.doctorReply, timestamp: "10:00 AM" },
        { role: "patient", text: turn2Msg, timestamp: "10:01 AM" }
      ],
      patientName: "David Miller",
      patientAge: "38",
      interviewState: chat1Data.interviewState,
    }),
  });

  const chat2Res = await postVoiceChat(chat2Req);
  const chat2Data = await chat2Res.json();
  assert.strictEqual(chat2Res.status, 200, "Turn 2 chat succeeded");
  console.log(`✓ Turn 2 Doctor Reply: "${chat2Data.doctorReply?.slice(0, 75)}..."`);
  console.log(`✓ Turn 2 Server-reported caseVersion: ${chat2Data.caseVersion}`);
  assert.ok(chat2Data.caseVersion > currentCaseVersion, "Server caseVersion advanced after turn 2");
  currentCaseVersion = chat2Data.caseVersion;

  const persist2Req = new Request("http://localhost:3000/api/consultations", {
    method: "POST",
    headers: createHeaders(userId),
    body: JSON.stringify({
      id: encounterId,
      patientName: "David Miller",
      transcript: [
        { role: "patient", text: turn1Msg, timestamp: "10:00 AM" },
        { role: "doctor", text: chat1Data.doctorReply, timestamp: "10:00 AM" },
        { role: "patient", text: turn2Msg, timestamp: "10:01 AM" },
        { role: "doctor", text: chat2Data.doctorReply, timestamp: "10:01 AM" }
      ],
      status: "in_progress",
      caseVersion: currentCaseVersion + 1,
    }),
  });

  const persist2Res = await postConsultation(persist2Req);
  const persist2Data = await persist2Res.json();
  assert.strictEqual(persist2Res.status, 200, "Turn 2 persistence succeeded with HTTP 200");
  currentCaseVersion = persist2Data.consultation?.caseVersion;
  console.log(`✓ Turn 2 Persist HTTP 200. Datastore caseVersion: ${currentCaseVersion}`);

  // 4. Turn 3
  console.log("\n>>> STAGE 4: Turn 3 - Location & Progression");
  const turn3Msg = "It is mainly in the back of my head and neck.";
  console.log(`[Turn 3] Patient says: "${turn3Msg}"`);

  const chat3Req = new Request("http://localhost:3000/api/voice/chat", {
    method: "POST",
    headers: createHeaders(userId),
    body: JSON.stringify({
      encounterId,
      doctorId: "dr-sarah-chen",
      message: turn3Msg,
      conversationHistory: [
        { role: "patient", text: turn1Msg, timestamp: "10:00 AM" },
        { role: "doctor", text: chat1Data.doctorReply, timestamp: "10:00 AM" },
        { role: "patient", text: turn2Msg, timestamp: "10:01 AM" },
        { role: "doctor", text: chat2Data.doctorReply, timestamp: "10:01 AM" },
        { role: "patient", text: turn3Msg, timestamp: "10:02 AM" }
      ],
      patientName: "David Miller",
      patientAge: "38",
      interviewState: chat2Data.interviewState,
    }),
  });

  const chat3Res = await postVoiceChat(chat3Req);
  const chat3Data = await chat3Res.json();
  assert.strictEqual(chat3Res.status, 200, "Turn 3 chat succeeded");
  console.log(`✓ Turn 3 Doctor Reply: "${chat3Data.doctorReply?.slice(0, 75)}..."`);
  console.log(`✓ Turn 3 Server-reported caseVersion: ${chat3Data.caseVersion}`);
  currentCaseVersion = chat3Data.caseVersion;

  const persist3Req = new Request("http://localhost:3000/api/consultations", {
    method: "POST",
    headers: createHeaders(userId),
    body: JSON.stringify({
      id: encounterId,
      patientName: "David Miller",
      transcript: [
        { role: "patient", text: turn1Msg, timestamp: "10:00 AM" },
        { role: "doctor", text: chat1Data.doctorReply, timestamp: "10:00 AM" },
        { role: "patient", text: turn2Msg, timestamp: "10:01 AM" },
        { role: "doctor", text: chat2Data.doctorReply, timestamp: "10:01 AM" },
        { role: "patient", text: turn3Msg, timestamp: "10:02 AM" },
        { role: "doctor", text: chat3Data.doctorReply, timestamp: "10:02 AM" }
      ],
      status: "completed_pending_review",
      caseVersion: currentCaseVersion + 1,
    }),
  });

  const persist3Res = await postConsultation(persist3Req);
  const persist3Data = await persist3Res.json();
  assert.strictEqual(persist3Res.status, 200, "Turn 3 persistence succeeded with HTTP 200");
  currentCaseVersion = persist3Data.consultation?.caseVersion;
  console.log(`✓ Turn 3 Persist HTTP 200. Final Datastore caseVersion: ${currentCaseVersion}`);

  // 5. Concurrency Conflict (HTTP 409) & Self-Healing Recovery Test
  console.log("\n>>> STAGE 5: Concurrency Conflict (HTTP 409) & Self-Healing Verification");
  console.log(`[Conflict Injection] Submitting stale version (${currentCaseVersion - 1}) <= datastore version (${currentCaseVersion})...`);

  const conflictReq = new Request("http://localhost:3000/api/consultations", {
    method: "POST",
    headers: createHeaders(userId),
    body: JSON.stringify({
      id: encounterId,
      patientName: "David Miller",
      caseVersion: currentCaseVersion - 1, // Stale!
    }),
  });

  const conflictRes = await postConsultation(conflictReq);
  const conflictData = await conflictRes.json();
  assert.strictEqual(conflictRes.status, 409, "Server strictly rejects stale version with HTTP 409");
  assert.strictEqual(conflictData.code, "CONCURRENCY_CONFLICT", "Reports CONCURRENCY_CONFLICT code");
  assert.strictEqual(conflictData.currentVersion, currentCaseVersion, "Server reports authoritative current datastore version");
  console.log(`✓ Server correctly rejected with HTTP 409 and communicated currentVersion: ${conflictData.currentVersion}`);

  // 6. Client Self-Healing: synchronize to currentVersion and retry with currentVersion + 1
  console.log(`[Self-Healing Recovery] Synchronizing client ref to ${conflictData.currentVersion} and retrying with version ${conflictData.currentVersion + 1}...`);
  const healedVersion = conflictData.currentVersion + 1;
  const healReq = new Request("http://localhost:3000/api/consultations", {
    method: "POST",
    headers: createHeaders(userId),
    body: JSON.stringify({
      id: encounterId,
      patientName: "David Miller",
      status: "completed_pending_review",
      caseVersion: healedVersion,
    }),
  });

  const healRes = await postConsultation(healReq);
  const healData = await healRes.json();
  assert.strictEqual(healRes.status, 200, "Self-healing retry succeeded with HTTP 200");
  const finalVersion = healData.consultation?.caseVersion;
  assert.strictEqual(finalVersion, healedVersion, "Datastore cleanly updated to recovered version");
  console.log(`✓ Self-healing retry succeeded with HTTP 200! New datastore version: ${finalVersion}`);

  // 7. Full History Integrity Audit
  console.log("\n>>> STAGE 6: Full Consultation Transcript & Clinical State Integrity Audit");
  const finalRecord = healData.consultation;
  assert.strictEqual(finalRecord.transcript.length, 6, "All 6 dialogue turns preserved in order");
  assert.strictEqual(finalRecord.transcript[0].text, turn1Msg);
  assert.strictEqual(finalRecord.transcript[2].text, turn2Msg);
  assert.strictEqual(finalRecord.transcript[4].text, turn3Msg);
  console.log(`✓ Complete 6-turn transcript verified with zero dropouts or corruption.`);

  console.log("\n================================================================================");
  console.log("      ALL 3 CONSULTATION TURNS & CONCURRENCY SELF-HEALING PASSED 100%           ");
  console.log("================================================================================\n");
}

runMultiTurnSuite().catch((err) => {
  console.error("Multi-turn suite failed:", err);
  process.exit(1);
});
