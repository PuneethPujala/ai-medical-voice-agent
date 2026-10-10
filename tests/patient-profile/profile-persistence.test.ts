/**
 * MedVoice Patient Profile Persistence & Tenant Isolation Test Battery
 * 
 * Verifies:
 * 1. Partial Profile creation (optional fields permitted, no forced fields)
 * 2. Cross-session persistence and incremental updates
 * 3. Strict tenant isolation (User A cannot access or mutate User B's records)
 * 4. Multi-patient separation under a single account (Self vs Parent vs Child)
 * 5. Dynamic age calculation from Date of Birth
 * 6. DPDP Act compliance (soft-delete, consent tracking)
 *
 * Execution:
 *   npx tsx tests/patient-profile/profile-persistence.test.ts
 */

import { PatientProfileService, memoryProfiles } from "../../lib/patient/patient-profile-service";
import { calculateAgeFromDOB } from "../../lib/clinical-knowledge/types";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    passedCount++;
    console.log(`  ✓ PASS: ${testName}`);
  } else {
    failedCount++;
    console.error(`  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`);
  }
}

async function runProfilePersistenceTests() {
  console.log("==================================================================");
  console.log("TEST SUITE 1: PATIENT PROFILE PERSISTENCE & MULTI-PATIENT ISOLATION");
  console.log("==================================================================");

  // Clear memory cache before starting
  memoryProfiles.clear();

  const userAlice = "user_alice_test_001";
  const userBob = "user_bob_test_002";
  const userCaregiver = "user_caregiver_test_003";

  // -----------------------------------------------------------------------------
  // Test 1: Partial Profile Creation (Optional Data Discipline)
  // -----------------------------------------------------------------------------
  console.log("\n[Group 1] Partial Profile Creation (Optional Data Discipline)");
  try {
    const partialProfile = await PatientProfileService.upsertProfile(userAlice, {
      name: "Alice Smith",
      relationshipToUser: "self",
      knownConditions: ["Hypertension"],
      consentGiven: true,
      // Leaving dateOfBirth, currentMedications, drugAllergies, emergencyContact blank
    });

    assert(Boolean(partialProfile.id), "Partial profile generates valid UUID");
    assert(partialProfile.name === "Alice Smith", "Name is correctly persisted");
    assert((partialProfile.knownConditions || []).length === 1 && partialProfile.knownConditions?.[0] === "Hypertension", "Condition is persisted");
    assert((partialProfile.currentMedications || []).length === 0, "Omitted medications default to empty array");
    assert((partialProfile.drugAllergies || []).length === 0, "Omitted allergies default to empty array");
    assert(partialProfile.dateOfBirth === undefined, "Omitted DOB remains undefined without throwing");
    assert(partialProfile.emergencyContact === undefined, "Omitted emergency contact remains undefined");
    assert(partialProfile.consentGiven === true, "DPDP consent flag recorded");
  } catch (err: any) {
    assert(false, "Partial profile creation should succeed without requiring questionnaire", err.message);
  }

  // -----------------------------------------------------------------------------
  // Test 2: Persistence and Incremental Updates Across Sessions
  // -----------------------------------------------------------------------------
  console.log("\n[Group 2] Persistence and Incremental Updates");
  try {
    const aliceProfile = await PatientProfileService.getProfileByRelationship(userAlice, "self");
    assert(aliceProfile !== null, "Alice's profile can be retrieved across simulated sessions");
    assert(aliceProfile?.name === "Alice Smith", "Alice's retrieved name matches stored state");

    // Incrementally add medication and allergy without wiping knownConditions
    const updatedAlice = await PatientProfileService.upsertProfile(userAlice, {
      id: aliceProfile?.id,
      relationshipToUser: "self",
      currentMedications: [
        { name: "Lisinopril", dose: "10mg", frequency: "daily" }
      ],
      allergyStatus: "confirmed",
      drugAllergies: [
        { drugName: "Penicillin", severity: "severe", reactionType: "allergy", reactionDescription: "Anaphylaxis" }
      ]
    });

    assert(Boolean(updatedAlice.knownConditions?.includes("Hypertension")), "Existing condition preserved during partial update");
    assert((updatedAlice.currentMedications || []).length === 1 && updatedAlice.currentMedications?.[0].name === "Lisinopril", "New medication persisted");
    assert((updatedAlice.drugAllergies || []).length === 1 && updatedAlice.drugAllergies?.[0].drugName === "Penicillin", "Drug allergy persisted");
    assert(updatedAlice.allergyStatus === "confirmed", "Allergy status updated to confirmed");
  } catch (err: any) {
    assert(false, "Incremental profile update failed", err.message);
  }

  // -----------------------------------------------------------------------------
  // Test 3: Strict Tenant Isolation & Anti-Tampering
  // -----------------------------------------------------------------------------
  console.log("\n[Group 3] Tenant Isolation (Cross-User Data Protection)");
  try {
    const aliceProfile = await PatientProfileService.getProfileByRelationship(userAlice, "self");
    const aliceProfileId = aliceProfile!.id;

    // Bob tries to read Alice's profile by ID
    const bobAccessAttempt = await PatientProfileService.getProfileById(aliceProfileId, userBob);
    assert(bobAccessAttempt === null, "Bob cannot read Alice's profile by ID (isolated)");

    // Bob tries to delete Alice's profile
    const bobDeleteAttempt = await PatientProfileService.deleteProfile(aliceProfileId, userBob);
    assert(bobDeleteAttempt === false, "Bob cannot delete Alice's profile (forbidden)");

    // Verify Alice's profile is still intact
    const verifyAliceStillIntact = await PatientProfileService.getProfileById(aliceProfileId, userAlice);
    assert(verifyAliceStillIntact !== null && !verifyAliceStillIntact.isDeleted, "Alice's profile remains untouched after foreign delete attempt");

    // Bob listing profiles sees only his own profiles (0 currently)
    const bobProfiles = await PatientProfileService.listProfiles(userBob);
    assert(bobProfiles.length === 0, "Bob profile list contains zero records from Alice");
  } catch (err: any) {
    assert(false, "Tenant isolation test threw unexpected error", err.message);
  }

  // -----------------------------------------------------------------------------
  // Test 4: Multi-Patient Representation (Caregiver managing Self, Parent, Child)
  // -----------------------------------------------------------------------------
  console.log("\n[Group 4] Multi-Patient Separation Under Single Caregiver Account");
  try {
    // 1. Caregiver Self Profile
    const caregiverSelf = await PatientProfileService.upsertProfile(userCaregiver, {
      name: "Marcus Vance",
      relationshipToUser: "self",
      age: 42,
      sexAssignedAtBirth: "male",
      knownConditions: []
    });

    // 2. Caregiver's Elderly Mother (Parent)
    const caregiverMother = await PatientProfileService.upsertProfile(userCaregiver, {
      name: "Eleanor Vance",
      relationshipToUser: "parent",
      dateOfBirth: "1948-03-12",
      sexAssignedAtBirth: "female",
      knownConditions: ["Osteoarthritis", "Type 2 Diabetes"],
      currentMedications: [{ name: "Metformin", dose: "500mg", frequency: "twice daily" }]
    });

    // 3. Caregiver's Child
    const caregiverChild = await PatientProfileService.upsertProfile(userCaregiver, {
      name: "Leo Vance",
      relationshipToUser: "child",
      dateOfBirth: "2019-07-22",
      sexAssignedAtBirth: "male",
      knownConditions: ["Pediatric Asthma"],
      drugAllergies: [{ drugName: "Amoxicillin", severity: "moderate", reactionType: "allergy" }]
    });

    const allCaregiverProfiles = await PatientProfileService.listProfiles(userCaregiver);
    assert(allCaregiverProfiles.length === 3, "Caregiver has exactly 3 separate profiles registered");

    assert(caregiverSelf.id !== caregiverMother.id, "Self and Mother profiles have distinct IDs");
    assert(caregiverMother.id !== caregiverChild.id, "Mother and Child profiles have distinct IDs");

    // Verify queries by relationship return correct distinct identities
    const retrievedMother = await PatientProfileService.getProfileByRelationship(userCaregiver, "parent");
    assert(retrievedMother?.name === "Eleanor Vance", "Retrieved parent profile matches mother");
    assert(retrievedMother?.knownConditions?.includes("Type 2 Diabetes") === true, "Mother profile retains diabetic history");

    const retrievedChild = await PatientProfileService.getProfileByRelationship(userCaregiver, "child");
    assert(retrievedChild?.name === "Leo Vance", "Retrieved child profile matches Leo");
    assert(retrievedChild?.knownConditions?.includes("Pediatric Asthma") === true, "Child profile retains pediatric asthma");

    // Modifying Child profile does not affect Mother or Self
    await PatientProfileService.upsertProfile(userCaregiver, {
      id: caregiverChild.id,
      relationshipToUser: "child",
      clinicalNotes: "Uses salbutamol inhaler before exercise"
    });

    const refreshedMother = await PatientProfileService.getProfileById(caregiverMother.id, userCaregiver);
    assert(refreshedMother?.clinicalNotes === undefined, "Mother profile was not mutated by child update");
  } catch (err: any) {
    assert(false, "Multi-patient representation test threw error", err.message);
  }

  // -----------------------------------------------------------------------------
  // Test 5: Dynamic Age Computation & Population Tagging
  // -----------------------------------------------------------------------------
  console.log("\n[Group 5] Dynamic Age Computation & Population Tagging");
  try {
    const fixedNow = new Date("2026-10-10T12:00:00Z");

    const adultCalc = calculateAgeFromDOB("1980-05-20", fixedNow);
    assert(adultCalc.years === 46, "DOB 1980-05-20 on 2026-10-10 computes to exactly 46 years");

    const childCalc = calculateAgeFromDOB("2020-04-10", fixedNow);
    assert(childCalc.years === 6, "DOB 2020-04-10 computes to 6 years");

    const infantCalc = calculateAgeFromDOB("2026-06-10", fixedNow);
    assert(infantCalc.years === 0 && infantCalc.months === 4, "DOB 2026-06-10 computes to 0 years, 4 months");

    // Upserting with child DOB automatically sets age and ageGroup
    const babyProfile = await PatientProfileService.upsertProfile("user_baby_001", {
      name: "Baby Maya",
      relationshipToUser: "child",
      dateOfBirth: "2026-06-10"
    });
    assert(babyProfile.age === 0, "Baby age dynamically set to 0");
    assert(babyProfile.ageGroup === "infant", "Baby ageGroup automatically categorized as infant");
  } catch (err: any) {
    assert(false, "Dynamic age computation test failed", err.message);
  }

  // -----------------------------------------------------------------------------
  // Test 6: DPDP Compliance & Soft Deletion
  // -----------------------------------------------------------------------------
  console.log("\n[Group 6] DPDP Compliance & Soft Deletion");
  try {
    const testProfile = await PatientProfileService.upsertProfile("user_dpdp_test", {
      name: "Temp Profile",
      relationshipToUser: "self",
      consentGiven: true
    });

    const deleted = await PatientProfileService.deleteProfile(testProfile.id, "user_dpdp_test");
    assert(deleted === true, "Delete operation returns true");

    const postDeleteFetch = await PatientProfileService.getProfileById(testProfile.id, "user_dpdp_test");
    assert(postDeleteFetch === null, "Soft-deleted profile is excluded from active getProfileById");

    const activeList = await PatientProfileService.listProfiles("user_dpdp_test");
    assert(activeList.length === 0, "Soft-deleted profile is excluded from active profile listings");
  } catch (err: any) {
    assert(false, "DPDP compliance & soft-delete failed", err.message);
  }

  // -----------------------------------------------------------------------------
  // Final Reconciliation
  // -----------------------------------------------------------------------------
  console.log("\n==================================================================");
  console.log(`SUMMARY: ${passedCount} passed, ${failedCount} failed`);
  console.log("==================================================================");

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runProfilePersistenceTests().catch((err) => {
  console.error("Test execution fatal crash:", err);
  process.exit(1);
});
