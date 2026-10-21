import assert from "assert";
import { POST as postVoiceChat } from "../../app/api/voice/chat/route";
import { PatientProfileService, memoryProfiles } from "../../lib/patient/patient-profile-service";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, Role } from "../../lib/auth/rbac";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
(process.env as Record<string, string | undefined>).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

function createTestHeaders(role: Role, userId: string, extra: Record<string, string> = {}) {
  return {
    "x-mock-role": role,
    "x-mock-user-id": userId,
    [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
    ...extra,
  };
}

async function runChatIdentityIsolationTests() {
  console.log("================================================================================");
  console.log("  MEDVOICE CHAT API IDENTITY & TENANT ISOLATION SECURITY REGRESSION SUITE       ");
  console.log("================================================================================");

  const victimUserId = `user-victim-${Date.now()}`;
  const attackerUserId = `user-attacker-${Date.now()}`;

  // Seed victim profile in store
  const victimProfile = await PatientProfileService.upsertProfile(victimUserId, {
    name: "Alice Victim",
    relationshipToUser: "self",
    age: 45,
    knownConditions: ["Hypertension", "Type 2 Diabetes"],
    currentMedications: [{ name: "Metformin", dose: "500mg" }],
    consentGiven: true,
  });

  console.log(`\n[Setup] Seeded victim profile ${victimProfile.id} for ${victimUserId}`);

  // Test 1: Cross-account spoofing via request body userId is strictly blocked
  console.log("\n[Test 1] Attacker supplying victim's userId in request body cannot access victim profile");
  {
    const req = new Request("https://medvoice.org/api/voice/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", attackerUserId),
      },
      body: JSON.stringify({
        message: "Can you review my chronic conditions and medications?",
        doctorId: "dr-sarah-chen",
        // Malicious spoof attempt: passing victim's identity in untrusted payload
        userId: victimUserId,
        patientId: victimProfile.id,
      }),
    });

    const res = await postVoiceChat(req);
    assert.strictEqual(res.status, 200, "Chat route returns 200 response");
    const data = await res.json();
    assert(data.doctorReply, "Doctor provides response");

    // Verify victim's private medications are NOT leaked in response
    const replyLower = data.doctorReply.toLowerCase();
    assert(
      !replyLower.includes("metformin"),
      "VIOLATION DETECTED: Attacker was leaked victim's private medication 'Metformin'!"
    );
    console.log("  ✓ PASS: Attacker cannot access foreign profile context via request-body userId");
  }

  // Test 2: Injected client-supplied patientProfile in request body is completely discarded
  console.log("\n[Test 2] Client-supplied patientProfile in request body is discarded and untrusted");
  {
    const fakeInjectedProfile = {
      id: "injected-profile-999",
      userId: attackerUserId,
      name: "Injected Patient",
      age: 88,
      conditions: ["Severe Aortic Stenosis"],
      currentMedications: [{ name: "DangerousExperimentalDrug", dosage: "1000mg" }],
      allergies: [],
    };

    const req = new Request("https://medvoice.org/api/voice/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createTestHeaders("patient", attackerUserId),
      },
      body: JSON.stringify({
        message: "I am having mild throat itching.",
        doctorId: "dr-sarah-chen",
        patientProfile: fakeInjectedProfile,
      }),
    });

    const res = await postVoiceChat(req);
    assert.strictEqual(res.status, 200, "Chat route executes");
    const data = await res.json();

    const replyLower = (data.doctorReply || "").toLowerCase();
    assert(
      !replyLower.includes("dangerousexperimentaldrug"),
      "VIOLATION DETECTED: Injected client patientProfile was trusted by clinical engine!"
    );
    console.log("  ✓ PASS: Untrusted client patientProfile is discarded server-side");
  }

  // Test 3: Unauthenticated caller cannot retrieve or access stored profiles
  console.log("\n[Test 3] Unauthenticated caller cannot bind to stored patient profile by ID");
  {
    const req = new Request("https://medvoice.org/api/voice/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // No auth headers -> resolves to unauthenticated guest
      },
      body: JSON.stringify({
        message: "Hello doctor, what are my prescribed medications?",
        doctorId: "dr-sarah-chen",
        patientId: victimProfile.id,
      }),
    });

    const res = await postVoiceChat(req);
    assert.strictEqual(res.status, 200, "Chat route responds");
    const data = await res.json();
    const replyLower = (data.doctorReply || "").toLowerCase();
    assert(
      !replyLower.includes("metformin"),
      "VIOLATION DETECTED: Unauthenticated caller accessed private patient profile!"
    );
    console.log("  ✓ PASS: Unauthenticated callers cannot access private patient profiles");
  }

  // Test 4: Profile Storage & Consent Semantics: New profile defaults consent to false
  console.log("\n[Test 4] Profile creation defaults consentGiven to false unless explicitly granted");
  {
    const unconsentedUserId = `user-unconsented-${Date.now()}`;
    const newProfile = await PatientProfileService.upsertProfile(unconsentedUserId, {
      name: "Bob ConsentTest",
      relationshipToUser: "self",
      age: 30,
      // consentGiven omitted
    });

    assert.strictEqual(
      newProfile.consentGiven,
      false,
      "New profile must default consentGiven to false!"
    );
    assert.strictEqual(
      newProfile.consentTimestamp,
      undefined,
      "New profile without consent must not have a valid consentTimestamp!"
    );
    console.log("  ✓ PASS: New patient profiles default consentGiven to false");
  }

  // Test 5: Profile Service Empty Query Semantics: Does not leak memory fallback on valid empty DB queries
  console.log("\n[Test 5] Query for non-existent user profile returns empty/null without cross-tenant bleed");
  {
    const nonExistentUserId = `user-ghost-${Date.now()}`;
    const profiles = await PatientProfileService.listProfiles(nonExistentUserId);
    assert.strictEqual(profiles.length, 0, "Query for user with no profiles returns empty array");

    const singleProfile = await PatientProfileService.getProfileById(victimProfile.id, nonExistentUserId);
    assert.strictEqual(singleProfile, null, "Querying foreign profile ID returns null");
    console.log("  ✓ PASS: Empty queries return null/[] without memory store bleed");
  }

  console.log("\n================================================================================");
  console.log("  ALL CHAT API IDENTITY & ISOLATION CHECKS PASSED (5/5)                         ");
  console.log("================================================================================\n");
}

runChatIdentityIsolationTests().catch((err) => {
  console.error("Chat identity isolation test failure:", err);
  process.exit(1);
});
