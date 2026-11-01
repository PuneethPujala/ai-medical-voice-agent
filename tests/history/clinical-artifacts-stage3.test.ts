/**
 * Milestone 6 Stage 3: Clinical Artifact APIs, Physician Review & Integration Battery
 *
 * Verifies all 18 required Stage 3 integration & security invariants:
 * 1. Unauthenticated artifact access (401)
 * 2. Patient access to another patient's artifacts (403 IDOR)
 * 3. Assigned clinician access (200)
 * 4. Unassigned clinician rejection (403)
 * 5. Doctor-profile / user-ID mapping (Clerk userId mapped to doctorId)
 * 6. Generic admin rejection without explicit override permission (403)
 * 7. Authorized admin override with audit evidence (200 + audit metadata)
 * 8. Draft creation and editing (201 & 200)
 * 9. Pending-review downgrade and resubmission
 * 10. Signed artifact read-only enforcement (409 SIGNED_ARTIFACT_IMMUTABLE)
 * 11. Amendment creation and lineage (v2 linked to v1, requires clinical reason)
 * 12. Duplicate signing request (idempotent replay)
 * 13. Idempotency-key mismatch (409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH)
 * 14. Concurrent signing serialization
 * 15. Case-version conflict (409 CAS_CONFLICT)
 * 16. Generic PATCH SOAP mutation rejection (400 SOAP_DIRECT_MUTATION_PROHIBITED)
 * 17. FHIR export from authoritative signed artifacts (status: "final")
 * 18. Legacy approved consultation compatibility
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { assertSafeTestDatabase, validateTestDatabaseTarget } from "../../lib/security/test-db-guard";
import { getDb, closeDbPool } from "../../config/db";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER, getAuthContext } from "../../lib/auth/rbac";
import { clearAuditLedger } from "../../lib/audit/audit-logger";

// Route handlers under test
import { GET as getArtifactsHandler, POST as postArtifactsHandler } from "../../app/api/consultations/[id]/artifacts/route";
import { GET as getArtifactByIdHandler, PATCH as patchArtifactHandler } from "../../app/api/consultations/[id]/artifacts/[artifactId]/route";
import { POST as submitArtifactHandler } from "../../app/api/consultations/[id]/artifacts/[artifactId]/submit/route";
import { POST as signArtifactHandler } from "../../app/api/consultations/[id]/artifacts/[artifactId]/sign/route";
import { PATCH as patchConsultationHandler } from "../../app/api/consultations/[id]/route";
import { GET as getConsultationFhirHandler } from "../../app/api/consultations/[id]/fhir/route";

(process.env as any).NODE_ENV = "test";
(process.env as any).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:testpass@localhost:5433/medvoice_test";

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function cid(base: string): string {
  return `${base}-${RUN_ID}`;
}

describe("Milestone 6 Stage 3: Clinical Artifact APIs & Physician Review Battery", () => {
  let pool: Pool;
  let drizzleDb: any;

  before(async () => {
    assertSafeTestDatabase(TEST_DB_URL);
    validateTestDatabaseTarget(TEST_DB_URL);

    pool = new Pool({ connectionString: TEST_DB_URL });
    drizzleDb = getDb();

    // Ensure schema migration 0006 is applied on isolated test DB
    const migrationPath = path.resolve(process.cwd(), "drizzle", "0006_add_clinical_artifacts.sql");
    const migrationSql = fs.readFileSync(migrationPath, "utf-8");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "consultations" (
        "id" varchar(128) PRIMARY KEY,
        "user_id" varchar(128),
        "patient_profile_id" varchar(128),
        "parent_consultation_id" varchar(128),
        "patient_name" varchar(128) DEFAULT 'Anonymous Patient',
        "patient_age" varchar(32),
        "patient_gender" varchar(32),
        "doctor_id" varchar(64),
        "doctor_name" varchar(128) DEFAULT 'Dr. Sarah Chen, MD',
        "specialty" varchar(128) NOT NULL DEFAULT 'General Medicine',
        "chief_complaint" text,
        "transcript" jsonb,
        "triage_level" varchar(64) DEFAULT 'routine',
        "triage_title" varchar(255),
        "icd10_codes" jsonb,
        "detected_symptoms" jsonb,
        "soap_subjective" text,
        "soap_objective" text,
        "soap_assessment" text,
        "soap_plan" text,
        "recommended_specialists" jsonb,
        "recommended_action" text,
        "duration_seconds" integer DEFAULT 0,
        "status" varchar(64) DEFAULT 'completed_pending_review',
        "approved_at" timestamp,
        "approved_by" varchar(128),
        "case_version" integer DEFAULT 1,
        "idempotency_key" varchar(128),
        "interview_state" jsonb,
        "delivered_turn_records" jsonb,
        "attributed_facts" jsonb,
        "unmapped_observations" jsonb,
        "created_at" timestamp DEFAULT NOW()
      );
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_profile_id" varchar(128);
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "parent_consultation_id" varchar(128);
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_name" varchar(128) DEFAULT 'Anonymous Patient';
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_age" varchar(32);
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_gender" varchar(32);
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "triage_level" varchar(64) DEFAULT 'routine';
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "triage_title" varchar(255);
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "detected_symptoms" jsonb;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "recommended_specialists" jsonb;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "recommended_action" text;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "duration_seconds" integer DEFAULT 0;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(128);
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "interview_state" jsonb;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "delivered_turn_records" jsonb;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "attributed_facts" jsonb;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "unmapped_observations" jsonb;
    `);

    await pool.query(migrationSql);
  });

  after(async () => {
    await pool.end();
    await closeDbPool();
  });

  beforeEach(async () => {
    clearAuditLedger();
  });

  // Helper to create test request with mock auth
  function makeRequest(
    url: string,
    method: string,
    body?: any,
    authOptions?: {
      role?: string;
      userId?: string;
      doctorId?: string;
      permissions?: string;
      unauthenticated?: boolean;
    }
  ): Request {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (!authOptions?.unauthenticated) {
      headers[INTERNAL_TEST_SECRET_HEADER] = DEFAULT_INTERNAL_TEST_SECRET;
      if (authOptions?.role) headers["x-mock-role"] = authOptions.role;
      if (authOptions?.userId) headers["x-mock-user-id"] = authOptions.userId;
      if (authOptions?.doctorId) headers["x-mock-doctor-id"] = authOptions.doctorId;
      if (authOptions?.permissions) headers["x-mock-permissions"] = authOptions.permissions;
    }

    return new Request(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // Helper to seed consultation
  async function seedConsultation(
    id: string,
    options: {
      userId?: string;
      doctorId?: string | null;
      status?: string;
      caseVersion?: number;
      soapSubjective?: string;
    } = {}
  ): Promise<void> {
    await pool.query(
      `INSERT INTO consultations (
        id, user_id, doctor_id, doctor_name, case_version, status, chief_complaint, soap_subjective, created_at
      ) VALUES ($1, $2, $3, 'Dr. Sarah Chen, MD', $4, $5, 'Acute cough and mild dyspnea', $6, NOW())
      ON CONFLICT (id) DO UPDATE SET
        user_id = $2, doctor_id = $3, case_version = $4, status = $5, soap_subjective = $6`,
      [
        id,
        options.userId || "patient-alice-01",
        options.doctorId === undefined ? "dr-sarah-chen" : options.doctorId,
        options.caseVersion || 1,
        options.status || "completed_pending_review",
        options.soapSubjective || "Patient reports dry cough for 3 days.",
      ]
    );
  }

  // --------------------------------------------------------------------------
  // Test 1: Unauthenticated Artifact Access (401)
  // --------------------------------------------------------------------------
  it("Test 1: unauthenticated access to artifacts endpoint is rejected with 401", async () => {
    const id = cid("c-unauth");
    await seedConsultation(id);

    const req = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "GET", undefined, {
      unauthenticated: true,
    });
    const res = await getArtifactsHandler(req, { params: Promise.resolve({ id }) });

    assert.strictEqual(res.status, 401);
    const json = await res.json();
    assert.strictEqual(json.code, "UNAUTHORIZED");
  });

  // --------------------------------------------------------------------------
  // Test 2: Patient Access to Another Patient's Artifacts (403 IDOR)
  // --------------------------------------------------------------------------
  it("Test 2: patient accessing another patient's consultation artifacts is rejected with 403", async () => {
    const id = cid("c-idor");
    await seedConsultation(id, { userId: "patient-alice-01" });

    // Bob tries to access Alice's records
    const req = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "GET", undefined, {
      role: "patient",
      userId: "patient-bob-02",
    });
    const res = await getArtifactsHandler(req, { params: Promise.resolve({ id }) });

    assert.strictEqual(res.status, 403);
    const json = await res.json();
    assert.strictEqual(json.code, "FORBIDDEN");
  });

  // --------------------------------------------------------------------------
  // Test 3: Assigned Clinician Access (200)
  // --------------------------------------------------------------------------
  it("Test 3: assigned clinician accessing their patient's consultation artifacts succeeds with 200", async () => {
    const id = cid("c-assigned-doc");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    const req = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "GET", undefined, {
      role: "clinician",
      userId: "dr-sarah-chen",
    });
    const res = await getArtifactsHandler(req, { params: Promise.resolve({ id }) });

    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
    assert.ok(Array.isArray(json.artifacts));
  });

  // --------------------------------------------------------------------------
  // Test 4: Unassigned Clinician Rejection (403)
  // --------------------------------------------------------------------------
  it("Test 4: unassigned clinician attempting to access consultation artifacts is rejected with 403", async () => {
    const id = cid("c-unassigned-doc");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // Dr. Marcus Vance attempts to access Dr. Sarah Chen's consultation
    const req = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "GET", undefined, {
      role: "clinician",
      userId: "dr-marcus-vance",
    });
    const res = await getArtifactsHandler(req, { params: Promise.resolve({ id }) });

    assert.strictEqual(res.status, 403);
    const json = await res.json();
    assert.strictEqual(json.code, "FORBIDDEN");
  });

  // --------------------------------------------------------------------------
  // Test 5: Doctor-Profile / User-ID Mapping
  // --------------------------------------------------------------------------
  it("Test 5: clinician authenticated with Clerk userId mapped to doctorId is authorized", async () => {
    const id = cid("c-mapping");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // Authenticated user has Clerk ID 'user_clerk_chen_88' but doctorId 'dr-sarah-chen'
    const req = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "GET", undefined, {
      role: "clinician",
      userId: "user_clerk_chen_88",
      doctorId: "dr-sarah-chen",
    });
    const res = await getArtifactsHandler(req, { params: Promise.resolve({ id }) });

    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.success, true);
  });

  // --------------------------------------------------------------------------
  // Test 6: Generic Admin Rejection Without Explicit Override Permission (403)
  // --------------------------------------------------------------------------
  it("Test 6: generic admin without explicit clinical signing override permission is rejected with 403", async () => {
    const id = cid("c-generic-admin");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // 1. Create draft and submit for review as assigned doctor
    const createReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      chiefComplaint: "Sore throat",
      soapSubjective: "Pain swallowing",
      soapObjective: "Erythema",
      soapAssessment: "Pharyngitis",
      soapPlan: "Supportive care",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const createRes = await postArtifactsHandler(createReq, { params: Promise.resolve({ id }) });
    const createJson = await createRes.json();
    const artifactId = createJson.artifact.id;

    const submitReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/submit`,
      "POST",
      {},
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    await submitArtifactHandler(submitReq, { params: Promise.resolve({ id, artifactId }) });

    // 2. Generic admin tries to sign WITHOUT clinical_artifacts:sign:any permission
    const signReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`,
      "POST",
      {
        idempotencyKey: "key-admin-no-perm",
        expectedCaseVersion: 1,
      },
      { role: "admin", userId: "admin-user-01" } // No permissions header passed
    );
    const signRes = await signArtifactHandler(signReq, { params: Promise.resolve({ id, artifactId }) });

    assert.strictEqual(signRes.status, 403);
    const signJson = await signRes.json();
    assert.strictEqual(signJson.code, "FORBIDDEN");
  });

  // --------------------------------------------------------------------------
  // Test 7: Authorized Admin Override With Audit Evidence
  // --------------------------------------------------------------------------
  it("Test 7: authorized admin with override permission and reason signs encounter with audit evidence", async () => {
    const id = cid("c-admin-override");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // 1. Create draft and submit for review
    const createReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      chiefComplaint: "Pneumonia ICU transfer",
      soapSubjective: "Hypoxemic respiratory failure",
      soapObjective: "Bilateral infiltrates",
      soapAssessment: "Severe CAP",
      soapPlan: "ICU transfer and broad-spectrum antibiotics",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const createRes = await postArtifactsHandler(createReq, { params: Promise.resolve({ id }) });
    const createJson = await createRes.json();
    const artifactId = createJson.artifact.id;

    const submitReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/submit`,
      "POST",
      {},
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    await submitArtifactHandler(submitReq, { params: Promise.resolve({ id, artifactId }) });

    // 2. Admin with explicit permission AND valid override reason signs
    const signReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`,
      "POST",
      {
        idempotencyKey: "key-admin-override-ok",
        expectedCaseVersion: 1,
        overrideReason: "Chief Medical Officer emergency critical care review and signing",
      },
      {
        role: "admin",
        userId: "admin-cmo-01",
        permissions: "clinical_artifacts:sign:any",
      }
    );
    const signRes = await signArtifactHandler(signReq, { params: Promise.resolve({ id, artifactId }) });

    assert.strictEqual(signRes.status, 200);
    const signJson = await signRes.json();
    assert.strictEqual(signJson.success, true);
    assert.strictEqual(signJson.artifact.status, "signed");
    assert.strictEqual(signJson.artifact.signedBy, "admin-cmo-01");

    // 3. Verify audit event contains override metadata
    const auditRes = await pool.query(
      `SELECT metadata FROM audit_events WHERE resource_id = $1 AND action = 'CLINICAL_ARTIFACT_SIGNED'`,
      [artifactId]
    );
    assert.strictEqual(auditRes.rows.length, 1);
    assert.strictEqual(auditRes.rows[0].metadata.isAdministrativeOverride, true);
    assert.strictEqual(auditRes.rows[0].metadata.overrideReason, "Chief Medical Officer emergency critical care review and signing");
    assert.strictEqual(auditRes.rows[0].metadata.assignedDoctorId, "dr-sarah-chen");
  });

  // --------------------------------------------------------------------------
  // Test 8: Draft Creation and Editing
  // --------------------------------------------------------------------------
  it("Test 8: creates draft artifact via POST and updates content via PATCH", async () => {
    const id = cid("c-draft-edit");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // POST initial draft
    const postReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      chiefComplaint: "Headache",
      soapSubjective: "Tension headache since morning",
      soapObjective: "Normotensive",
      soapAssessment: "Tension-type headache",
      soapPlan: "Hydration and rest",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const postRes = await postArtifactsHandler(postReq, { params: Promise.resolve({ id }) });

    assert.strictEqual(postRes.status, 201);
    const postJson = await postRes.json();
    const artifactId = postJson.artifact.id;
    assert.strictEqual(postJson.artifact.version, 1);
    assert.strictEqual(postJson.artifact.status, "draft");

    // PATCH draft with updated clinical note
    const patchReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}`,
      "PATCH",
      {
        soapPlan: "Hydration, rest, and ibuprofen 400mg PRN",
      },
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const patchRes = await patchArtifactHandler(patchReq, { params: Promise.resolve({ id, artifactId }) });

    assert.strictEqual(patchRes.status, 200);
    const patchJson = await patchRes.json();
    assert.strictEqual(patchJson.artifact.soapPlan, "Hydration, rest, and ibuprofen 400mg PRN");
  });

  // --------------------------------------------------------------------------
  // Test 9: Pending-Review Downgrade and Resubmission
  // --------------------------------------------------------------------------
  it("Test 9: editing pending_review artifact automatically downgrades to draft, requiring resubmission", async () => {
    const id = cid("c-downgrade");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // 1. Create draft
    const postReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      chiefComplaint: "Allergic rhinitis",
      soapSubjective: "Sneezing and itchy eyes",
      soapObjective: "Clear nasal discharge",
      soapAssessment: "Seasonal allergic rhinitis",
      soapPlan: "Antihistamine daily",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const postRes = await postArtifactsHandler(postReq, { params: Promise.resolve({ id }) });
    const postJson = await postRes.json();
    const artifactId = postJson.artifact.id;

    // 2. Submit for review
    const submitReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/submit`,
      "POST",
      {},
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const submitRes = await submitArtifactHandler(submitReq, { params: Promise.resolve({ id, artifactId }) });
    const submitJson = await submitRes.json();
    assert.strictEqual(submitJson.artifact.status, "pending_review");

    // 3. Edit content: must automatically downgrade to draft!
    const patchReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}`,
      "PATCH",
      {
        soapSubjective: "Sneezing, itchy eyes, and mild throat irritation",
      },
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const patchRes = await patchArtifactHandler(patchReq, { params: Promise.resolve({ id, artifactId }) });
    const patchJson = await patchRes.json();
    assert.strictEqual(patchJson.artifact.status, "draft");

    // 4. Resubmit for review
    const resubmitReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/submit`,
      "POST",
      {},
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const resubmitRes = await submitArtifactHandler(resubmitReq, { params: Promise.resolve({ id, artifactId }) });
    const resubmitJson = await resubmitRes.json();
    assert.strictEqual(resubmitJson.artifact.status, "pending_review");
  });

  // --------------------------------------------------------------------------
  // Test 10: Signed Artifact Read-Only Enforcement
  // --------------------------------------------------------------------------
  it("Test 10: attempting to modify a signed artifact returns 409 SIGNED_ARTIFACT_IMMUTABLE", async () => {
    const id = cid("c-readonly");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // 1. Create, submit, sign
    const postReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      chiefComplaint: "Knee pain",
      soapSubjective: "Twisted knee while jogging",
      soapObjective: "Mild effusion",
      soapAssessment: "Patellar strain",
      soapPlan: "RICE therapy",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const postRes = await postArtifactsHandler(postReq, { params: Promise.resolve({ id }) });
    const artifactId = (await postRes.json()).artifact.id;

    const submitReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/submit`,
      "POST",
      {},
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    await submitArtifactHandler(submitReq, { params: Promise.resolve({ id, artifactId }) });

    const signReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`,
      "POST",
      { idempotencyKey: "key-readonly-sign", expectedCaseVersion: 1 },
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    await signArtifactHandler(signReq, { params: Promise.resolve({ id, artifactId }) });

    // 2. Attempt to PATCH signed artifact
    const patchReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}`,
      "PATCH",
      { soapPlan: "Mutated plan after signature" },
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const patchRes = await patchArtifactHandler(patchReq, { params: Promise.resolve({ id, artifactId }) });

    assert.strictEqual(patchRes.status, 409);
    const patchJson = await patchRes.json();
    assert.strictEqual(patchJson.code, "SIGNED_ARTIFACT_IMMUTABLE");
  });

  // --------------------------------------------------------------------------
  // Test 11: Amendment Creation and Lineage
  // --------------------------------------------------------------------------
  it("Test 11: creates linked amendment v2 preserving parent v1, requiring justification", async () => {
    const id = cid("c-amend-lineage");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // 1. Create, submit, sign v1
    const postReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      chiefComplaint: "Stomach ache",
      soapSubjective: "Abdominal cramping",
      soapObjective: "Soft, non-tender",
      soapAssessment: "Gastritis",
      soapPlan: "Antacids",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const v1Id = (await (await postArtifactsHandler(postReq, { params: Promise.resolve({ id }) })).json()).artifact.id;

    await submitArtifactHandler(
      makeRequest(`http://localhost/api/consultations/${id}/artifacts/${v1Id}/submit`, "POST", {}, { role: "clinician", userId: "dr-sarah-chen" }),
      { params: Promise.resolve({ id, artifactId: v1Id }) }
    );

    await signArtifactHandler(
      makeRequest(`http://localhost/api/consultations/${id}/artifacts/${v1Id}/sign`, "POST", { idempotencyKey: "key-v1-sign", expectedCaseVersion: 1 }, { role: "clinician", userId: "dr-sarah-chen" }),
      { params: Promise.resolve({ id, artifactId: v1Id }) }
    );

    // 2. Reject amendment with missing or short reason (<10 chars)
    const shortReasonReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      parentArtifactId: v1Id,
      amendmentReason: "Short",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const shortRes = await postArtifactsHandler(shortReasonReq, { params: Promise.resolve({ id }) });
    assert.strictEqual(shortRes.status, 400);

    // 3. Create valid amendment v2
    const amendReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      parentArtifactId: v1Id,
      amendmentReason: "H. Pylori stool antigen test returned positive; adding triple therapy.",
      soapPlan: "Triple therapy: PPI, Clarithromycin, Amoxicillin for 14 days",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const amendRes = await postArtifactsHandler(amendReq, { params: Promise.resolve({ id }) });

    assert.strictEqual(amendRes.status, 201);
    const amendJson = await amendRes.json();
    assert.strictEqual(amendJson.artifact.version, 2);
    assert.strictEqual(amendJson.artifact.parentArtifactId, v1Id);
    assert.strictEqual(amendJson.artifact.status, "draft");
    assert.strictEqual(amendJson.artifact.amendmentReason, "H. Pylori stool antigen test returned positive; adding triple therapy.");
  });

  // --------------------------------------------------------------------------
  // Test 12: Duplicate Signing Request (Idempotent Replay)
  // --------------------------------------------------------------------------
  it("Test 12: duplicate signing request with same idempotency key returns 200 with original signed artifact", async () => {
    const id = cid("c-idemp-replay");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // Create & submit
    const postReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      chiefComplaint: "Back spasm",
      soapSubjective: "Lumbar pain",
      soapObjective: "Paraspinal tenderness",
      soapAssessment: "Acute lumbar strain",
      soapPlan: "Heat pack and stretching",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const artifactId = (await (await postArtifactsHandler(postReq, { params: Promise.resolve({ id }) })).json()).artifact.id;

    await submitArtifactHandler(
      makeRequest(`http://localhost/api/consultations/${id}/artifacts/${artifactId}/submit`, "POST", {}, { role: "clinician", userId: "dr-sarah-chen" }),
      { params: Promise.resolve({ id, artifactId }) }
    );

    // Sign first time
    const sign1Req = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`,
      "POST",
      { idempotencyKey: "key-idemp-replay-100", expectedCaseVersion: 1 },
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const sign1Res = await signArtifactHandler(sign1Req, { params: Promise.resolve({ id, artifactId }) });
    assert.strictEqual(sign1Res.status, 200);
    const sign1Json = await sign1Res.json();
    assert.strictEqual(sign1Json.isIdempotentRetry, false);

    // Retry with identical idempotency key
    const sign2Req = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`,
      "POST",
      { idempotencyKey: "key-idemp-replay-100", expectedCaseVersion: 1 },
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const sign2Res = await signArtifactHandler(sign2Req, { params: Promise.resolve({ id, artifactId }) });
    assert.strictEqual(sign2Res.status, 200);
    const sign2Json = await sign2Res.json();
    assert.strictEqual(sign2Json.isIdempotentRetry, true);
    assert.strictEqual(sign2Json.artifact.id, sign1Json.artifact.id);

    // Verify exactly one audit event was written
    const auditRes = await pool.query(
      `SELECT count(*) FROM audit_events WHERE resource_id = $1 AND action = 'CLINICAL_ARTIFACT_SIGNED'`,
      [artifactId]
    );
    assert.strictEqual(Number(auditRes.rows[0].count), 1);
  });

  // --------------------------------------------------------------------------
  // Test 13: Idempotency-Key Mismatch (409)
  // --------------------------------------------------------------------------
  it("Test 13: reusing idempotency key with different payload returns 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH", async () => {
    const id = cid("c-idemp-mismatch");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // Create & submit
    const postReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      chiefComplaint: "Rash",
      soapSubjective: "Itchy erythematous rash on arm",
      soapObjective: "Maculopapular rash",
      soapAssessment: "Contact dermatitis",
      soapPlan: "Hydrocortisone cream",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const artifactId = (await (await postArtifactsHandler(postReq, { params: Promise.resolve({ id }) })).json()).artifact.id;

    await submitArtifactHandler(
      makeRequest(`http://localhost/api/consultations/${id}/artifacts/${artifactId}/submit`, "POST", {}, { role: "clinician", userId: "dr-sarah-chen" }),
      { params: Promise.resolve({ id, artifactId }) }
    );

    // Sign first time
    await signArtifactHandler(
      makeRequest(
        `http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`,
        "POST",
        { idempotencyKey: "key-mismatch-shared", expectedCaseVersion: 1 },
        { role: "clinician", userId: "dr-sarah-chen" }
      ),
      { params: Promise.resolve({ id, artifactId }) }
    );

    // Replay with same key but different attestation / expectedCaseVersion
    const replayReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`,
      "POST",
      { idempotencyKey: "key-mismatch-shared", expectedCaseVersion: 99 },
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const replayRes = await signArtifactHandler(replayReq, { params: Promise.resolve({ id, artifactId }) });

    assert.strictEqual(replayRes.status, 409);
    const replayJson = await replayRes.json();
    assert.strictEqual(replayJson.code, "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
  });

  // --------------------------------------------------------------------------
  // Test 14: Concurrent Signing Serialization
  // --------------------------------------------------------------------------
  it("Test 14: serializes concurrent signing requests, committing exactly one signature", async () => {
    const id = cid("c-concurrent");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // Create & submit
    const postReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      chiefComplaint: "Fever and chills",
      soapSubjective: "Tmax 101.5F",
      soapObjective: "Flushed, febrile",
      soapAssessment: "Viral syndrome",
      soapPlan: "Acetaminophen and rest",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const artifactId = (await (await postArtifactsHandler(postReq, { params: Promise.resolve({ id }) })).json()).artifact.id;

    await submitArtifactHandler(
      makeRequest(`http://localhost/api/consultations/${id}/artifacts/${artifactId}/submit`, "POST", {}, { role: "clinician", userId: "dr-sarah-chen" }),
      { params: Promise.resolve({ id, artifactId }) }
    );

    // Dispatch 2 concurrent signing requests with different keys
    const signPromise1 = signArtifactHandler(
      makeRequest(`http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`, "POST", { idempotencyKey: "key-concurrent-1", expectedCaseVersion: 1 }, { role: "clinician", userId: "dr-sarah-chen" }),
      { params: Promise.resolve({ id, artifactId }) }
    );
    const signPromise2 = signArtifactHandler(
      makeRequest(`http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`, "POST", { idempotencyKey: "key-concurrent-2", expectedCaseVersion: 1 }, { role: "clinician", userId: "dr-sarah-chen" }),
      { params: Promise.resolve({ id, artifactId }) }
    );

    const [res1, res2] = await Promise.all([signPromise1, signPromise2]);

    const statuses = [res1.status, res2.status];
    assert.ok(statuses.includes(200), "At least one concurrent request must succeed with 200");
    assert.ok(statuses.includes(409), "Competing request must receive 409 conflict");

    // Verify artifact is signed exactly once
    const artRes = await pool.query(`SELECT status FROM clinical_artifacts WHERE id = $1`, [artifactId]);
    assert.strictEqual(artRes.rows[0].status, "signed");
  });

  // --------------------------------------------------------------------------
  // Test 15: Case-Version Conflict (409 CAS_CONFLICT)
  // --------------------------------------------------------------------------
  it("Test 15: signing with drifted expectedCaseVersion is rejected with 409 CAS_CONFLICT", async () => {
    const id = cid("c-cas");
    await seedConsultation(id, { doctorId: "dr-sarah-chen", caseVersion: 3 });

    const postReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      chiefComplaint: "Ankle sprain",
      soapSubjective: "Stepped in pothole",
      soapObjective: "Lateral ankle edema",
      soapAssessment: "Anterior talofibular ligament sprain",
      soapPlan: "Ankle brace and ice",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const artifactId = (await (await postArtifactsHandler(postReq, { params: Promise.resolve({ id }) })).json()).artifact.id;

    await submitArtifactHandler(
      makeRequest(`http://localhost/api/consultations/${id}/artifacts/${artifactId}/submit`, "POST", {}, { role: "clinician", userId: "dr-sarah-chen" }),
      { params: Promise.resolve({ id, artifactId }) }
    );

    // Expected caseVersion is 1, but datastore case_version is 3
    const signReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`,
      "POST",
      { idempotencyKey: "key-cas-stale", expectedCaseVersion: 1 },
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const signRes = await signArtifactHandler(signReq, { params: Promise.resolve({ id, artifactId }) });

    assert.strictEqual(signRes.status, 409);
    const signJson = await signRes.json();
    assert.strictEqual(signJson.code, "CAS_CONFLICT");
  });

  // --------------------------------------------------------------------------
  // Test 16: Generic PATCH SOAP Mutation Rejection
  // --------------------------------------------------------------------------
  it("Test 16: generic PATCH to /api/consultations/[id] containing SOAP fields is rejected with 400", async () => {
    const id = cid("c-patch-guard");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    const patchReq = makeRequest(
      `http://localhost/api/consultations/${id}`,
      "PATCH",
      {
        soapPlan: "Directly mutating SOAP plan via generic PATCH endpoint",
      },
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const patchRes = await patchConsultationHandler(patchReq, { params: Promise.resolve({ id }) });

    assert.strictEqual(patchRes.status, 400);
    const patchJson = await patchRes.json();
    assert.strictEqual(patchJson.code, "SOAP_DIRECT_MUTATION_PROHIBITED");
    assert.ok(patchJson.error.includes("Direct mutation of clinical artifact fields"));
  });

  // --------------------------------------------------------------------------
  // Test 16b: Generic PATCH Rejection Across ALL Artifact-Managed Clinical Fields
  // --------------------------------------------------------------------------
  it("Test 16b: generic PATCH rejects independent mutations for every artifact-managed field", async () => {
    const id = cid("c-patch-all-fields");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    const blockedPayloads: Array<{ field: string; body: any }> = [
      { field: "soapSubjective", body: { soapSubjective: "Injected subjective narrative" } },
      { field: "soapObjective", body: { soapObjective: "Injected objective narrative" } },
      { field: "soapAssessment", body: { soapAssessment: "Injected assessment narrative" } },
      { field: "soapPlan", body: { soapPlan: "Injected plan narrative" } },
      { field: "soap", body: { soap: { subjective: "Nested SOAP injection" } } },
      { field: "chiefComplaint", body: { chiefComplaint: "Direct mutation of chief complaint" } },
      { field: "icd10Codes", body: { icd10Codes: ["I10", "E11.9"] } },
      { field: "icdCodes", body: { icdCodes: ["I10"] } },
      { field: "esiScore", body: { esiScore: 1 } },
    ];

    for (const testCase of blockedPayloads) {
      const patchReq = makeRequest(
        `http://localhost/api/consultations/${id}`,
        "PATCH",
        testCase.body,
        { role: "clinician", userId: "dr-sarah-chen" }
      );
      const patchRes = await patchConsultationHandler(patchReq, { params: Promise.resolve({ id }) });
      assert.strictEqual(
        patchRes.status,
        400,
        `Expected field '${testCase.field}' to be rejected with 400 from generic PATCH`
      );
      const json = await patchRes.json();
      assert.strictEqual(json.code, "SOAP_DIRECT_MUTATION_PROHIBITED");
    }
  });

  // --------------------------------------------------------------------------
  // Test 17: FHIR Export From Signed Artifacts
  // --------------------------------------------------------------------------
  it("Test 17: FHIR export reads authoritative signed artifact with Composition status final", async () => {
    const id = cid("c-fhir-signed");
    await seedConsultation(id, {
      doctorId: "dr-sarah-chen",
      soapSubjective: "Old intake subjective narrative",
    });

    // 1. Author and sign authoritative clinical artifact
    const postReq = makeRequest(`http://localhost/api/consultations/${id}/artifacts`, "POST", {
      chiefComplaint: "Hypertension follow-up",
      soapSubjective: "Authoritative signed subjective note: feeling well, BP 120/80 at home.",
      soapObjective: "In-clinic BP 122/82 mmHg.",
      soapAssessment: "Essential hypertension well controlled.",
      soapPlan: "Continue Lisinopril 10mg daily.",
    }, { role: "clinician", userId: "dr-sarah-chen" });
    const artifactId = (await (await postArtifactsHandler(postReq, { params: Promise.resolve({ id }) })).json()).artifact.id;

    await submitArtifactHandler(
      makeRequest(`http://localhost/api/consultations/${id}/artifacts/${artifactId}/submit`, "POST", {}, { role: "clinician", userId: "dr-sarah-chen" }),
      { params: Promise.resolve({ id, artifactId }) }
    );

    await signArtifactHandler(
      makeRequest(`http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`, "POST", { idempotencyKey: "key-fhir-sign", expectedCaseVersion: 1 }, { role: "clinician", userId: "dr-sarah-chen" }),
      { params: Promise.resolve({ id, artifactId }) }
    );

    // 2. Export FHIR bundle
    const fhirReq = makeRequest(`http://localhost/api/consultations/${id}/fhir`, "GET", undefined, {
      role: "patient",
      userId: "patient-alice-01",
    });
    const fhirRes = await getConsultationFhirHandler(fhirReq, { params: Promise.resolve({ id }) });

    assert.strictEqual(fhirRes.status, 200);
    const bundle = await fhirRes.json();
    assert.strictEqual(bundle.resourceType, "Bundle");

    // 3. Inspect Composition resource
    const composition = bundle.entry.find((e: any) => e.resource.resourceType === "Composition")?.resource;
    assert.ok(composition, "FHIR Bundle must contain Composition resource");
    assert.strictEqual(composition.status, "final");

    // Verify sections contain authoritative signed artifact content, not old consultation fields
    const subjectiveSection = composition.section.find((s: any) => s.title.includes("Subjective"));
    assert.ok(subjectiveSection.text.div.includes("Authoritative signed subjective note"));
  });

  // --------------------------------------------------------------------------
  // Test 18: Legacy Approved Consultation Compatibility
  // --------------------------------------------------------------------------
  it("Test 18: legacy approved consultation without clinical_artifacts row exports valid FHIR and maintains compatibility", async () => {
    const id = cid("c-legacy-approved");
    // Legacy encounter from prior milestone: status is approved, but no row in clinical_artifacts table
    await seedConsultation(id, {
      doctorId: "dr-sarah-chen",
      status: "approved",
      soapSubjective: "Legacy approved patient narrative before M6 migration.",
    });

    const fhirReq = makeRequest(`http://localhost/api/consultations/${id}/fhir`, "GET", undefined, {
      role: "patient",
      userId: "patient-alice-01",
    });
    const fhirRes = await getConsultationFhirHandler(fhirReq, { params: Promise.resolve({ id }) });

    assert.strictEqual(fhirRes.status, 200);
    const bundle = await fhirRes.json();
    const composition = bundle.entry.find((e: any) => e.resource.resourceType === "Composition")?.resource;
    assert.ok(composition);
    assert.strictEqual(composition.status, "final");
    assert.ok(composition.section[0].text.div.includes("Legacy approved patient narrative"));
  });

  // --------------------------------------------------------------------------
  // Test 19: Individual Artifact Read Authorization (GET /.../artifacts/[artifactId])
  // --------------------------------------------------------------------------
  it("Test 19: individual artifact read endpoint enforces strict patient unsigned-note blocking and care relationship", async () => {
    const id = cid("c-single-art-auth");
    await seedConsultation(id, { userId: "patient-alice-01", doctorId: "dr-sarah-chen" });

    // 1. Create Draft Artifact
    const postReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts`,
      "POST",
      {
        chiefComplaint: "Severe migraine",
        soapSubjective: "Throbbing unilateral headache with photophobia",
        soapObjective: "Neurological exam grossly intact",
        soapAssessment: "Acute migraine without aura",
        soapPlan: "Sumatriptan 50mg, dark quiet room",
      },
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const draftArtifact = (await (await postArtifactsHandler(postReq, { params: Promise.resolve({ id }) })).json()).artifact;
    const artifactId = draftArtifact.id;

    // Subtest A: Patient requesting their OWN draft artifact -> MUST be rejected with 403
    const patDraftReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}`,
      "GET",
      undefined,
      { role: "patient", userId: "patient-alice-01" }
    );
    const patDraftRes = await getArtifactByIdHandler(patDraftReq, { params: Promise.resolve({ id, artifactId }) });
    assert.strictEqual(patDraftRes.status, 403, "Patient must not access draft clinical artifact");
    const patDraftJson = await patDraftRes.json();
    assert.ok(patDraftJson.error.includes("visible"), "Error must explain clinical notes are only visible once signed");

    // Subtest B: Assigned Clinician requesting draft artifact -> 200
    const docDraftReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}`,
      "GET",
      undefined,
      { role: "clinician", userId: "dr-sarah-chen" }
    );
    const docDraftRes = await getArtifactByIdHandler(docDraftReq, { params: Promise.resolve({ id, artifactId }) });
    assert.strictEqual(docDraftRes.status, 200);

    // Subtest C: Unassigned clinician requesting artifact -> 403
    const unassignedReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}`,
      "GET",
      undefined,
      { role: "clinician", userId: "dr-unassigned-stranger" }
    );
    const unassignedRes = await getArtifactByIdHandler(unassignedReq, { params: Promise.resolve({ id, artifactId }) });
    assert.strictEqual(unassignedRes.status, 403, "Unassigned clinician must be rejected with 403");

    // Subtest D: Transition to pending_review
    await submitArtifactHandler(
      makeRequest(`http://localhost/api/consultations/${id}/artifacts/${artifactId}/submit`, "POST", {}, { role: "clinician", userId: "dr-sarah-chen" }),
      { params: Promise.resolve({ id, artifactId }) }
    );

    // Patient requesting pending_review artifact -> MUST still be rejected with 403
    const patPendingReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}`,
      "GET",
      undefined,
      { role: "patient", userId: "patient-alice-01" }
    );
    const patPendingRes = await getArtifactByIdHandler(patPendingReq, { params: Promise.resolve({ id, artifactId }) });
    assert.strictEqual(patPendingRes.status, 403, "Patient must not access pending_review clinical artifact");

    // Subtest E: Sign artifact
    await signArtifactHandler(
      makeRequest(
        `http://localhost/api/consultations/${id}/artifacts/${artifactId}/sign`,
        "POST",
        { idempotencyKey: "key-single-art-sign", expectedCaseVersion: 1 },
        { role: "clinician", userId: "dr-sarah-chen" }
      ),
      { params: Promise.resolve({ id, artifactId }) }
    );

    // Subtest F: Patient requesting their SIGNED artifact -> MUST succeed with 200
    const patSignedReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}`,
      "GET",
      undefined,
      { role: "patient", userId: "patient-alice-01" }
    );
    const patSignedRes = await getArtifactByIdHandler(patSignedReq, { params: Promise.resolve({ id, artifactId }) });
    assert.strictEqual(patSignedRes.status, 200, "Patient must be able to view their own signed clinical artifact");
    const patSignedJson = await patSignedRes.json();
    assert.strictEqual(patSignedJson.artifact.status, "signed");
    assert.strictEqual(patSignedJson.artifact.id, artifactId);

    // Subtest G: Another patient requesting Alice's signed artifact -> MUST be rejected with 403 IDOR
    const strangerPatReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts/${artifactId}`,
      "GET",
      undefined,
      { role: "patient", userId: "patient-bob-intruder" }
    );
    const strangerPatRes = await getArtifactByIdHandler(strangerPatReq, { params: Promise.resolve({ id, artifactId }) });
    assert.strictEqual(strangerPatRes.status, 403, "Stranger patient accessing another encounter must receive 403");
  });

  // --------------------------------------------------------------------------
  // Test 20: Doctor Identity Mapping & Production Mock Header Isolation
  // --------------------------------------------------------------------------
  it("Test 20: verifies doctor identity mapping semantics and that mock headers cannot grant permissions in production", async () => {
    const id = cid("c-doctor-id-mapping");
    await seedConsultation(id, { doctorId: "dr-sarah-chen" });

    // 1. Clinician with matching doctorId in metadata is accepted
    const matchedReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts`,
      "GET",
      undefined,
      { role: "clinician", userId: "clerk-user-001", doctorId: "dr-sarah-chen" }
    );
    const matchedRes = await getArtifactsHandler(matchedReq, { params: Promise.resolve({ id }) });
    assert.strictEqual(matchedRes.status, 200, "Clinician with matching doctorId must be authorized");

    // 2. Clinician with mismatched doctorId in metadata is rejected
    const mismatchedReq = makeRequest(
      `http://localhost/api/consultations/${id}/artifacts`,
      "GET",
      undefined,
      { role: "clinician", userId: "clerk-user-002", doctorId: "dr-marcus-vance" }
    );
    const mismatchedRes = await getArtifactsHandler(mismatchedReq, { params: Promise.resolve({ id }) });
    assert.strictEqual(mismatchedRes.status, 403, "Clinician with mismatched doctorId must be rejected with 403");

    // 3. Strict production security invariant: In NODE_ENV === 'production', mock identity headers fail closed
    const originalEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = "production";

      const mockSpoofReq = new Request("http://localhost/api/test-secure", {
        headers: {
          [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
          "x-mock-role": "admin",
          "x-mock-user-id": "evil-attacker",
          "x-mock-doctor-id": "dr-sarah-chen",
          "x-mock-permissions": "clinical_artifacts:sign:any",
        },
      });

      const prodAuth = await getAuthContext(mockSpoofReq);
      assert.strictEqual(
        prodAuth.userId,
        "unauthenticated",
        "In production mode, mock headers must never establish an authenticated user"
      );
      assert.strictEqual(
        prodAuth.role,
        "patient",
        "In production mode, mock role headers must fail closed to default guest role"
      );
      assert.strictEqual(
        prodAuth.doctorId,
        undefined,
        "In production mode, mock doctorId must be ignored"
      );
      assert.deepStrictEqual(
        prodAuth.permissions,
        undefined,
        "In production mode, mock permissions must be completely ignored"
      );
    } finally {
      (process.env as any).NODE_ENV = originalEnv;
    }
  });
});
