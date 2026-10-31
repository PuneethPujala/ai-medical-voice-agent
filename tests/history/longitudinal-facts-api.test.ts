import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_INTERNAL_TEST_SECRET } from "@/lib/auth/rbac";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

import { GET as getLongitudinalFacts } from "@/app/api/patient/longitudinal-facts/route";
import { PatientProfileService } from "@/lib/patient/patient-profile-service";
import { LongitudinalFactService } from "@/lib/patient/longitudinal-fact-service";

function makePatientHeaders(userId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": "patient",
    "x-mock-user-id": userId,
  };
}

describe("Longitudinal Health Facts & DPDP Consent Gate Invariants", () => {
  const patientUnconsentedId = `patient-unconsented-${Date.now()}`;
  const patientConsentedId = `patient-consented-${Date.now()}`;
  let consentedProfileId: string;

  it("1. Unauthenticated request is rejected with 401 Unauthorized", async () => {
    const req = new Request("http://localhost:3000/api/patient/longitudinal-facts", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const res = await getLongitudinalFacts(req);
    assert.strictEqual(res.status, 401, "Unauthenticated access must return 401");
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, "UNAUTHORIZED");
  });

  it("2. User without a profile returns consentNotice: true and empty facts", async () => {
    const newUserId = `patient-no-profile-${Date.now()}`;
    const req = new Request("http://localhost:3000/api/patient/longitudinal-facts", {
      method: "GET",
      headers: makePatientHeaders(newUserId),
    });

    const res = await getLongitudinalFacts(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.consentNotice, true);
    assert.strictEqual(data.facts.length, 0);
    assert.strictEqual(data.profileSummary, null);
    assert.ok(data.categorized.uncollected.length > 0, "Must list uncollected baseline domains");
  });

  it("3. DPDP Consent Gate: Withholds facts and returns consentNotice: true when consentGiven is false", async () => {
    // Create profile with consentGiven: false
    const profile = await PatientProfileService.upsertProfile(patientUnconsentedId, {
      name: "Unconsented Patient",
      relationshipToUser: "self",
      consentGiven: false,
      knownConditions: ["Hypertension"],
      allergyStatus: "none_known",
    });

    const req = new Request("http://localhost:3000/api/patient/longitudinal-facts", {
      method: "GET",
      headers: makePatientHeaders(patientUnconsentedId),
    });

    const res = await getLongitudinalFacts(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.consentNotice, true, "Must flag consentNotice as true");
    assert.strictEqual(data.facts.length, 0, "Zero clinical facts must be returned without consent");
    assert.strictEqual(data.profileSummary.consentGiven, false);
  });

  it("4. Consented Profile: Returns active facts categorized into grounded clinical domains", async () => {
    // Create profile with consentGiven: true
    const profile = await PatientProfileService.upsertProfile(patientConsentedId, {
      name: "Consented Test Patient",
      relationshipToUser: "self",
      consentGiven: true,
      consentTimestamp: new Date().toISOString(),
      knownConditions: ["Asthma", "Mild GERD"],
      currentMedications: [
        {
          drugName: "Albuterol Inhaler",
          dosage: "90mcg",
          frequency: "PRN",
          route: "inhalation",
          isActive: true,
        } as any,
      ],
      allergyStatus: "none_known",
      smokingStatus: "never",
    });
    consentedProfileId = profile.id;

    // Record a clinician-confirmed vital fact
    await LongitudinalFactService.recordFact(patientConsentedId, {
      patientProfileId: profile.id,
      category: "vital_reading",
      concept: "resting_blood_pressure",
      reportedValue: "120/80 mmHg",
      temporalScope: "baseline",
      sourceType: "clinician",
      sourceConsultationId: "ENC-SEED-1",
      sourceTurnId: "turn-1",
      verification: "clinician_confirmed",
    });

    // Record a patient-reported lifestyle fact
    await LongitudinalFactService.recordFact(patientConsentedId, {
      patientProfileId: profile.id,
      category: "lifestyle_sleep",
      concept: "usual_sleep_duration",
      reportedValue: "7 hours",
      temporalScope: "baseline",
      sourceType: "patient",
      sourceConsultationId: "ENC-SEED-1",
      sourceTurnId: "turn-2",
      verification: "patient_confirmed",
    });

    const req = new Request("http://localhost:3000/api/patient/longitudinal-facts", {
      method: "GET",
      headers: makePatientHeaders(patientConsentedId),
    });

    const res = await getLongitudinalFacts(req);
    assert.strictEqual(res.status, 200);

    // Verify cache control headers
    const cacheControl = res.headers.get("Cache-Control");
    assert.ok(cacheControl?.includes("private"), "Cache-Control must be private");
    assert.ok(cacheControl?.includes("no-store"), "Cache-Control must be no-store");

    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.consentNotice, false, "Consent notice must be false when consented");
    assert.strictEqual(data.facts.length, 2, "Must return recorded facts");

    // Verify categorization
    assert.strictEqual(data.categorized.clinicianConfirmed.length, 1);
    assert.strictEqual(data.categorized.clinicianConfirmed[0].concept, "resting_blood_pressure");

    assert.strictEqual(data.categorized.patientReported.length, 1);
    assert.strictEqual(data.categorized.patientReported[0].concept, "usual_sleep_duration");

    // Verify confirmedNone (NKDA & Never smoker)
    const confirmedNoneDomains = data.categorized.confirmedNone.map((c: any) => c.domain);
    assert.ok(confirmedNoneDomains.includes("Drug Allergies"), "Must include NKDA in confirmedNone");
    assert.ok(confirmedNoneDomains.includes("Tobacco Use"), "Must include Tobacco Use in confirmedNone");

    // Profile summary verification
    assert.strictEqual(data.profileSummary.profileId, profile.id);
    assert.strictEqual(data.profileSummary.consentGiven, true);
    assert.strictEqual(data.profileSummary.knownConditions.length, 2);
  });

  it("5. Tenant Isolation: Patient B cannot access Patient A's longitudinal facts", async () => {
    const maliciousUserB = `patient-attacker-${Date.now()}`;
    const req = new Request("http://localhost:3000/api/patient/longitudinal-facts", {
      method: "GET",
      headers: makePatientHeaders(maliciousUserB),
    });

    const res = await getLongitudinalFacts(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    // User B has no profile and no consent, cannot see User A's data
    assert.strictEqual(data.facts.length, 0, "Patient B must see zero facts belonging to Patient A");
    assert.notStrictEqual(data.profileSummary?.profileId, consentedProfileId);
  });
});
