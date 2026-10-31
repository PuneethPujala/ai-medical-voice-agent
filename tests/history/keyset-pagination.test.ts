import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_INTERNAL_TEST_SECRET } from "@/lib/auth/rbac";

(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

import { GET as getConsultations, POST as createConsultation } from "@/app/api/consultations/route";
import { PATCH as patchConsultationById } from "@/app/api/consultations/[id]/route";

function makePatientHeaders(userId: string = "patient-keyset-user"): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": "patient",
    "x-mock-user-id": userId,
  };
}

function makeClinicianHeaders(userId: string = "dr-sarah-chen"): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-test-harness-secret": DEFAULT_INTERNAL_TEST_SECRET,
    "x-mock-role": "clinician",
    "x-mock-user-id": userId,
  };
}

describe("Consultation History Keyset Pagination & Server-Side Filtering Invariants", () => {
  const patientId = `patient-keyset-${Date.now()}`;

  // Seed 5 consultations with distinct timestamps and statuses
  const encounterIds = [
    `ENC-KEYSET-1-${Date.now()}`,
    `ENC-KEYSET-2-${Date.now()}`,
    `ENC-KEYSET-3-${Date.now()}`,
    `ENC-KEYSET-4-${Date.now()}`,
    `ENC-KEYSET-5-${Date.now()}`,
  ];

  it("1. Pre-test setup: seeds consultations across various lifecycle states", async () => {
    const statuses = [
      "paused",
      "completed_pending_review",
      "completed_pending_review",
      "paused",
      "completed_pending_review",
    ];

    const complaints = [
      "Intermittent asthma wheezing after exercise",
      "Persistent migraine headache with aura",
      "Acute knee swelling post soccer injury",
      "Mild cough and seasonal allergies",
      "Hypertension monitoring and medication check",
    ];

    for (let i = 0; i < 5; i++) {
      const payload = {
        id: encounterIds[i],
        patientName: "Keyset Test Patient",
        doctorId: "dr-sarah-chen",
        doctorName: "Dr. Sarah Chen, MD",
        specialty: i === 0 ? "Pulmonology" : "Cardiology",
        chiefComplaint: complaints[i],
        status: statuses[i],
        durationSeconds: 80 + i * 10,
        createdAt: new Date(Date.now() - (5 - i) * 100000).toISOString(),
        transcript: [
          { role: "doctor", text: "Hello, what are your symptoms?", timestamp: "10:00 AM" },
          { role: "patient", text: complaints[i], timestamp: "10:01 AM" },
        ],
        caseVersion: 1,
      };

      const req = new Request("http://localhost:3000/api/consultations", {
        method: "POST",
        headers: makePatientHeaders(patientId),
        body: JSON.stringify(payload),
      });

      const res = await createConsultation(req);
      assert.strictEqual(res.status, 200, `Failed to seed consultation ${i}`);
    }

    // Clinician approves consultation index 2 so we have an approved record
    const approveReq = new Request(`http://localhost:3000/api/consultations/${encounterIds[2]}`, {
      method: "PATCH",
      headers: makeClinicianHeaders("dr-sarah-chen"),
      body: JSON.stringify({
        action: "approve",
        status: "approved",
      }),
    });
    const approveRes = await patchConsultationById(approveReq, { params: Promise.resolve({ id: encounterIds[2] }) });
    assert.strictEqual(approveRes.status, 200, "Clinician must successfully sign consultation index 2");
  });

  it("2. Keyset pagination forward traversal with limit=2 returns nextCursor and hasMore=true", async () => {
    const req = new Request(`http://localhost:3000/api/consultations?limit=2`, {
      method: "GET",
      headers: makePatientHeaders(patientId),
    });

    const res = await getConsultations(req);
    assert.strictEqual(res.status, 200);

    // Verify private non-cacheable headers
    const cacheControl = res.headers.get("Cache-Control");
    assert.ok(cacheControl?.includes("private"), "Cache-Control must be private");
    assert.ok(cacheControl?.includes("no-store"), "Cache-Control must contain no-store");

    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.consultations.length, 2, "Page 1 must contain exactly 2 items");
    assert.strictEqual(data.hasMore, true, "Page 1 must report hasMore=true");
    assert.ok(data.nextCursor, "nextCursor must be a valid non-empty string");

    // Decode cursor to verify payload structure
    const decodedCursor = JSON.parse(Buffer.from(data.nextCursor, "base64").toString("utf-8"));
    assert.ok(decodedCursor.createdAt, "Cursor must contain createdAt");
    assert.ok(decodedCursor.id, "Cursor must contain id");
    assert.strictEqual(decodedCursor.id, data.consultations[1].id, "Cursor id must match the last item");

    // Traverse to Page 2
    const reqPage2 = new Request(
      `http://localhost:3000/api/consultations?limit=2&cursor=${encodeURIComponent(data.nextCursor)}`,
      {
        method: "GET",
        headers: makePatientHeaders(patientId),
      }
    );

    const resPage2 = await getConsultations(reqPage2);
    assert.strictEqual(resPage2.status, 200);
    const dataPage2 = await resPage2.json();

    assert.strictEqual(dataPage2.consultations.length, 2, "Page 2 must contain exactly 2 items");
    assert.strictEqual(dataPage2.hasMore, true, "Page 2 must report hasMore=true");
    assert.notStrictEqual(dataPage2.consultations[0].id, data.consultations[0].id, "Page 2 must not repeat Page 1");
    assert.notStrictEqual(dataPage2.consultations[0].id, data.consultations[1].id, "Page 2 must not overlap Page 1");

    // Traverse to Page 3 (Final page)
    const reqPage3 = new Request(
      `http://localhost:3000/api/consultations?limit=2&cursor=${encodeURIComponent(dataPage2.nextCursor)}`,
      {
        method: "GET",
        headers: makePatientHeaders(patientId),
      }
    );

    const resPage3 = await getConsultations(reqPage3);
    assert.strictEqual(resPage3.status, 200);
    const dataPage3 = await resPage3.json();

    assert.strictEqual(dataPage3.consultations.length, 1, "Page 3 must contain remaining 1 item");
    assert.strictEqual(dataPage3.hasMore, false, "Final page must have hasMore=false");
    assert.strictEqual(dataPage3.nextCursor, null, "Final page nextCursor must be null");
  });

  it("3. Rejects malformed cursor parameter with 400 Bad Request", async () => {
    const invalidCursor = Buffer.from(JSON.stringify({ badField: "invalid" })).toString("base64");
    const req = new Request(`http://localhost:3000/api/consultations?cursor=${invalidCursor}`, {
      method: "GET",
      headers: makePatientHeaders(patientId),
    });

    const res = await getConsultations(req);
    assert.strictEqual(res.status, 400, "Malformed cursor payload must be rejected with 400");
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.error.includes("cursor"), "Error message must mention cursor");

    // Non-base64 malformed string
    const garbageReq = new Request(`http://localhost:3000/api/consultations?cursor=%%%not-base64%%%`, {
      method: "GET",
      headers: makePatientHeaders(patientId),
    });

    const garbageRes = await getConsultations(garbageReq);
    assert.strictEqual(garbageRes.status, 400);
  });

  it("4. Server-side search filtering correctly matches chief complaint keywords", async () => {
    const req = new Request(`http://localhost:3000/api/consultations?search=asthma`, {
      method: "GET",
      headers: makePatientHeaders(patientId),
    });

    const res = await getConsultations(req);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.consultations.length >= 1, "Must find at least 1 matching encounter");
    assert.ok(
      data.consultations.every((c: any) =>
        c.chiefComplaint?.toLowerCase().includes("asthma")
      ),
      "All returned items must contain search keyword"
    );
  });

  it("5. Server-side status tab filtering isolates resumable / completed / approved records", async () => {
    // Resumable tab
    const resumableReq = new Request(`http://localhost:3000/api/consultations?statusTab=resumable`, {
      method: "GET",
      headers: makePatientHeaders(patientId),
    });
    const resumableRes = await getConsultations(resumableReq);
    const resumableData = await resumableRes.json();
    assert.strictEqual(resumableRes.status, 200);
    assert.ok(resumableData.consultations.length > 0);
    assert.ok(
      resumableData.consultations.every((c: any) =>
        c.status === "paused" || c.status === "in_progress" || c.status === "incomplete_intake"
      ),
      "Resumable filter must only return paused or in-progress records"
    );

    // Completed tab
    const completedReq = new Request(`http://localhost:3000/api/consultations?statusTab=completed`, {
      method: "GET",
      headers: makePatientHeaders(patientId),
    });
    const completedRes = await getConsultations(completedReq);
    const completedData = await completedRes.json();
    assert.strictEqual(completedRes.status, 200);
    assert.ok(
      completedData.consultations.every((c: any) => c.status === "completed_pending_review"),
      "Completed filter must only return completed_pending_review"
    );

    // Approved tab
    const approvedReq = new Request(`http://localhost:3000/api/consultations?statusTab=approved`, {
      method: "GET",
      headers: makePatientHeaders(patientId),
    });
    const approvedRes = await getConsultations(approvedReq);
    const approvedData = await approvedRes.json();
    assert.strictEqual(approvedRes.status, 200);
    assert.ok(
      approvedData.consultations.every((c: any) => c.status === "approved"),
      "Approved filter must only return approved records"
    );
  });
});
