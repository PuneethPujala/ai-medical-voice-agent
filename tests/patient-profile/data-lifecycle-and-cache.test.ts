import { PatientProfile } from "../../lib/clinical-knowledge/types";
import { InMemoryProfileCache, isProfileFormDirty } from "../../lib/patient/profile-cache";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// ============================================================================
// TEST BATTERY
// ============================================================================
async function runTests() {
  console.log("==================================================================");
  console.log("TEST SUITE: PATIENT PROFILE DATA LIFECYCLE & CACHING INTEGRITY");
  console.log("==================================================================");

  const cache = new InMemoryProfileCache();
  const userId = "user_clerk_test_99";

  // Test 1: Cold load state differentiation
  console.log("\n[Test 1] Cold load state differentiation");
  const coldSelf = cache.get(userId, "self");
  assert(coldSelf === undefined, "Cold cache returns undefined, not empty object");
  assert(!cache.hasPendingEdits(userId, "self"), "Cold cache has no pending edits");

  // Test 2: Cache population and relationship scoping
  console.log("\n[Test 2] Cache population and relationship scoping");
  const selfProfile: PatientProfile = {
    id: "profile_self_1",
    name: "Dr. Puneeth",
    relationshipToUser: "self",
    language: "en",
    dateOfBirth: "1990-05-15",
    sexAssignedAtBirth: "male",
    gender: "male",
    knownConditions: ["Asthma"],
    currentMedications: [{ name: "Albuterol", dose: "90mcg", frequency: "as needed" }],
    allergyStatus: "confirmed",
    drugAllergies: [{ drugName: "Penicillin", severity: "severe", reactionType: "allergy", reactionDescription: "Anaphylaxis" }],
    emergencyContact: { name: "Sarah", phone: "+1234567890", relationship: "Spouse" },
    updatedAt: new Date().toISOString(),
  };

  const parentProfile: PatientProfile = {
    id: "profile_parent_1",
    name: "Senior Parent",
    relationshipToUser: "parent",
    language: "hi",
    dateOfBirth: "1960-08-20",
    sexAssignedAtBirth: "female",
    gender: "female",
    knownConditions: ["Hypertension", "Type 2 Diabetes"],
    currentMedications: [{ name: "Metformin", dose: "500mg", frequency: "twice daily" }],
    allergyStatus: "none_known",
    drugAllergies: [],
    updatedAt: new Date().toISOString(),
  };

  cache.set(userId, "self", selfProfile);
  cache.set(userId, "parent", parentProfile);

  const retrievedSelf = cache.get(userId, "self");
  const retrievedParent = cache.get(userId, "parent");
  assert(retrievedSelf?.name === "Dr. Puneeth", "Self profile retrieved accurately");
  assert(retrievedParent?.name === "Senior Parent", "Parent profile retrieved accurately");
  assert(retrievedParent?.knownConditions?.length === 2, "Parent conditions isolated from self");
  assert(cache.get(userId, "child") === undefined, "Unpopulated child relationship returns undefined");

  // Test 3: Dirty-form detection
  console.log("\n[Test 3] Dirty-form detection");
  assert(!isProfileFormDirty(selfProfile, { ...selfProfile }), "Identical profile is not dirty");

  const modifiedSelf = { ...selfProfile, name: "Dr. Puneeth V." };
  assert(isProfileFormDirty(selfProfile, modifiedSelf), "Name edit detected as dirty");

  const modifiedConditions = { ...selfProfile, knownConditions: ["Asthma", "GERD"] };
  assert(isProfileFormDirty(selfProfile, modifiedConditions), "Condition addition detected as dirty");

  const modifiedMeds = {
    ...selfProfile,
    currentMedications: [
      { name: "Albuterol", dose: "90mcg", frequency: "as needed" },
      { name: "Fluticasone", dose: "110mcg", frequency: "daily" }
    ]
  };
  assert(isProfileFormDirty(selfProfile, modifiedMeds), "Medication change detected as dirty");

  // Test 3B: Biological Sex and Gender Identity Dirty Detection
  console.log("\n[Test 3B] Biological Sex & Gender Identity dirty-form detection");
  const modifiedSex = { ...selfProfile, sexAssignedAtBirth: "intersex" as const };
  assert(isProfileFormDirty(selfProfile, modifiedSex), "Biological sex change (male -> intersex) detected as dirty");

  const modifiedSexFemale = { ...selfProfile, sexAssignedAtBirth: "female" as const };
  assert(isProfileFormDirty(selfProfile, modifiedSexFemale), "Biological sex change (male -> female) detected as dirty");

  const modifiedGender = { ...selfProfile, gender: "other" as const };
  assert(isProfileFormDirty(selfProfile, modifiedGender), "Gender identity change (male -> other) detected as dirty");

  const unassignedBaseline: Partial<PatientProfile> = {
    id: "profile_unassigned",
    relationshipToUser: "self",
    language: "en"
  };
  assert(isProfileFormDirty(unassignedBaseline, { ...unassignedBaseline, sexAssignedAtBirth: "male" }), "Setting biological sex on unassigned baseline detected as dirty");
  assert(isProfileFormDirty(unassignedBaseline, { ...unassignedBaseline, gender: "female" }), "Setting gender identity on unassigned baseline detected as dirty");

  // Test 4: Draft preservation on save failure
  console.log("\n[Test 4] Draft preservation on save failure (503 / Network Error)");
  const draftEdits: Partial<PatientProfile> = {
    ...selfProfile,
    sexAssignedAtBirth: "female",
    gender: "female",
    knownConditions: ["Asthma", "Seasonal Allergies"],
    clinicalNotes: "Experiencing mild throat tightness in autumn."
  };

  // User edits and save fails (simulated)
  cache.setDraft(userId, "self", draftEdits);
  assert(cache.hasPendingEdits(userId, "self"), "Draft is marked as pending");

  // Verify draft can be recovered
  const recoveredDraft = cache.getDraft(userId, "self");
  assert(recoveredDraft?.clinicalNotes === "Experiencing mild throat tightness in autumn.", "Unsaved draft content preserved after failed save");
  assert(recoveredDraft?.sexAssignedAtBirth === "female", "Unsaved biological sex edit preserved in draft");
  assert(recoveredDraft?.gender === "female", "Unsaved gender identity edit preserved in draft");

  // Once save succeeds, clearDraft
  cache.set(userId, "self", draftEdits as PatientProfile);
  cache.clearDraft(userId, "self");
  assert(!cache.hasPendingEdits(userId, "self"), "Draft cleared after successful save");

  // Test 5: Re-verification after save
  console.log("\n[Test 5] Re-verification after save");
  const postSaveProfile = cache.get(userId, "self");
  assert(postSaveProfile?.sexAssignedAtBirth === "female", "Saved biological sex verified in active profile");
  assert(postSaveProfile?.gender === "female", "Saved gender identity verified in active profile");
  assert(!isProfileFormDirty(postSaveProfile, { ...postSaveProfile }), "Post-save state is clean / not dirty");

  // Summary
  console.log("\n==================================================================");
  console.log(`SUMMARY: ${passedTests} / ${totalTests} assertions passed (${failedTests} failed)`);
  console.log("==================================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
