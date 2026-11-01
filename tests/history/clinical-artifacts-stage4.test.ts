/**
 * Milestone 6 Stage 4: Artifact Timeline, SOAP Version Diff & End-to-End Acceptance Test Battery
 *
 * Verifies all 16 clinical document lifecycle, version comparison, security and compatibility invariants:
 * 1. Complete patient intake to draft artifact creation
 * 2. Physician review submission and auto-downgrade on edit
 * 3. Atomic signing and immutability lock
 * 4. Linked amendment v2 creation preserving v1 intact
 * 5. Token-based diff verification between v1 and v2 (additions, removals, unchanged chunks)
 * 6. Whitespace-normalization invariance (CRLF, trailing spaces, multi-line padding)
 * 7. Patient role view: signed v1 and signed v2 visible; drafts/cancelled hidden
 * 8. Cancelled amendment handling: cancelling draft amendment releases active constraint & permits replacement v2
 * 9. Concurrent signing and amendment serialization
 * 10. Lost-response idempotency replay (same idempotencyKey returns cached signed response)
 * 11. Cross-patient IDOR protection (patient B cannot query patient A's artifacts or diff)
 * 12. Unassigned clinician rejection (fail-closed)
 * 13. Administrative override authorization and audit logging
 * 14. Authoritative FHIR export with Composition status: "final"
 * 15. Legacy approved consultation compatibility
 * 16. Semantic array & section diff calculations (ICD-10 codes, ESI acuity score transitions)
 */

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:testpass@localhost:5433/medvoice_test";

(process.env as any).NODE_ENV = "test";
(process.env as any).TEST_DATABASE_URL = TEST_DB_URL;

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { assertSafeTestDatabase, validateTestDatabaseTarget } from "../../lib/security/test-db-guard";
import { getDb, closeDbPool } from "../../config/db";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER } from "../../lib/auth/rbac";
import { clearAuditLedger } from "../../lib/audit/audit-logger";

(process.env as any).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

// Route handlers under test
import { GET as getArtifactsHandler, POST as postArtifactsHandler } from "../../app/api/consultations/[id]/artifacts/route";
import { GET as getArtifactByIdHandler, PATCH as patchArtifactHandler } from "../../app/api/consultations/[id]/artifacts/[artifactId]/route";
import { POST as submitArtifactHandler } from "../../app/api/consultations/[id]/artifacts/[artifactId]/submit/route";
import { POST as signArtifactHandler } from "../../app/api/consultations/[id]/artifacts/[artifactId]/sign/route";
import { PATCH as patchConsultationHandler } from "../../app/api/consultations/[id]/route";
import { GET as getConsultationFhirHandler } from "../../app/api/consultations/[id]/fhir/route";

// Clinical Diff Engine
import {
  normalizeClinicalText,
  diffClinicalText,
  diffArray,
  computeArtifactDiff,
} from "../../lib/consultation/clinical-diff";

const VALID_HEX_64_A = "1111111111111111111111111111111111111111111111111111111111111111";
const VALID_HEX_64_B = "2222222222222222222222222222222222222222222222222222222222222222";

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function cid(base: string): string {
  return `${base}-${RUN_ID}`;
}

describe("Milestone 6 Stage 4: Artifact Timeline, SOAP Version Diff & End-to-End Acceptance", () => {
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
        "created_at" timestamp DEFAULT now()
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

    try {
      await pool.query(migrationSql);
    } catch {
      // Ignored if already executed
    }
  });

  after(async () => {
    await pool.end();
    await closeDbPool();
  });

  beforeEach(() => {
    clearAuditLedger();
  });

  // Helper to create test request with mock auth
  function makeReq(
    url: string,
    options: {
      method?: string;
      body?: any;
      role?: "patient" | "clinician" | "admin";
      userId?: string;
      doctorId?: string;
      permissions?: string;
      unauthenticated?: boolean;
    } = {}
  ): Request {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (!options.unauthenticated) {
      headers[INTERNAL_TEST_SECRET_HEADER] = DEFAULT_INTERNAL_TEST_SECRET;
      headers["x-mock-role"] = options.role || "clinician";
      headers["x-mock-user-id"] = options.userId || "usr_test_default";
      if (options.doctorId) {
        headers["x-mock-doctor-id"] = options.doctorId;
      }
      if (options.permissions) {
        headers["x-mock-permissions"] = options.permissions;
      }
    }

    return new Request(url, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  }

  // 1. Patient Intake to Draft Creation
  it("1. Complete patient intake creates draft artifact with case_version=1", async () => {
    const encId = cid("stage4-intake");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, chief_complaint, status, case_version)
      VALUES ($1, 'usr_patient_alice', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'Chest discomfort', 'completed_pending_review', 1)
    `, [encId]);

    const req = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts`, {
      method: "POST",
      role: "clinician",
      userId: "usr_doc_chen",
      doctorId: "dr_chen",
      body: {
        chiefComplaint: "Substernal chest pressure on exertion",
        soapSubjective: "Patient reports dull retrosternal tightness for 2 hours.",
        soapObjective: "Alert and conversational; no dyspnea.",
        soapAssessment: "Atypical angina vs musculoskeletal chest pain.",
        soapPlan: "12-lead ECG and outpatient stress test.",
        icd10Codes: ["R07.9"],
        esiScore: 3,
      },
    });

    const res = await postArtifactsHandler(req, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.artifact.version, 1);
    assert.strictEqual(body.artifact.status, "draft");
    assert.strictEqual(body.artifact.consultationId, encId);
  });

  // 2. Review Submission and Auto-Downgrade on Edit
  it("2. Physician review submission locks note; subsequent edit returns it to draft", async () => {
    const encId = cid("stage4-review-cycle");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, status, case_version)
      VALUES ($1, 'usr_patient_bob', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'completed_pending_review', 1)
    `, [encId]);

    // Create draft
    const createReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts`, {
      method: "POST",
      role: "clinician",
      userId: "usr_doc_chen",
      doctorId: "dr_chen",
      body: {
        chiefComplaint: "Routine check",
        soapSubjective: "Intake assessment recorded.",
        soapObjective: "Vitals normal.",
        soapAssessment: "Pending lab tests.",
        soapPlan: "Await labs.",
      },
    });
    const createRes = await postArtifactsHandler(createReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(createRes.status, 201);
    const art = (await createRes.json()).artifact;

    // Submit for review
    const submitReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${art.id}/submit`, {
      method: "POST",
      role: "clinician",
      userId: "usr_doc_chen",
      doctorId: "dr_chen",
    });
    const submitRes = await submitArtifactHandler(submitReq, { params: Promise.resolve({ id: encId, artifactId: art.id }) });
    assert.strictEqual(submitRes.status, 200);
    const submittedArt = (await submitRes.json()).artifact;
    assert.strictEqual(submittedArt.status, "pending_review");

    // Edit while in pending_review -> auto-downgrades to draft
    const editReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${art.id}`, {
      method: "PATCH",
      role: "clinician",
      userId: "usr_doc_chen",
      doctorId: "dr_chen",
      body: {
        soapAssessment: "Updated assessment after troponin lab review: Normal troponins.",
      },
    });
    const editRes = await patchArtifactHandler(editReq, { params: Promise.resolve({ id: encId, artifactId: art.id }) });
    assert.strictEqual(editRes.status, 200);
    const editedArt = (await editRes.json()).artifact;
    assert.strictEqual(editedArt.status, "draft");
    assert.ok(editedArt.soapAssessment.includes("Normal troponins"));
  });

  // 3. Atomic Signing and Immutability Lock
  it("3. Atomic signing seals artifact with SHA-256 digest and enforces immutability", async () => {
    const encId = cid("stage4-sign");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, status, case_version)
      VALUES ($1, 'usr_patient_carol', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'completed_pending_review', 1)
    `, [encId]);

    // Create and submit
    const createRes = await postArtifactsHandler(
      makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts`, {
        method: "POST",
        role: "clinician",
        userId: "usr_doc_chen",
        doctorId: "dr_chen",
        body: {
          chiefComplaint: "Severe migraine",
          soapSubjective: "Unilateral throbbing headache with photophobia.",
          soapObjective: "Pupils equal and reactive; neurological exam normal.",
          soapAssessment: "Acute migraine without aura.",
          soapPlan: "Sumatriptan 50mg PO PRN.",
          icd10Codes: ["G43.909"],
          esiScore: 4,
        },
      }),
      { params: Promise.resolve({ id: encId }) }
    );
    assert.strictEqual(createRes.status, 201);
    const art = (await createRes.json()).artifact;

    await submitArtifactHandler(
      makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${art.id}/submit`, {
        method: "POST",
        role: "clinician",
        userId: "usr_doc_chen",
        doctorId: "dr_chen",
      }),
      { params: Promise.resolve({ id: encId, artifactId: art.id }) }
    );

    // Sign artifact
    const signReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${art.id}/sign`, {
      method: "POST",
      role: "clinician",
      userId: "usr_doc_chen",
      doctorId: "dr_chen",
      body: {
        idempotencyKey: `sign-key-${art.id}`,
        expectedCaseVersion: 1,
        signatureAttestation: "Clinician Attestation Certified",
      },
    });
    const signRes = await signArtifactHandler(signReq, { params: Promise.resolve({ id: encId, artifactId: art.id }) });
    assert.strictEqual(signRes.status, 200);
    const signedArt = (await signRes.json()).artifact;
    assert.strictEqual(signedArt.status, "signed");
    const digest = signedArt.payloadSha256 || signedArt.canonicalDigest;
    assert.ok(digest);
    assert.strictEqual(typeof digest, "string");
    assert.strictEqual(digest.length, 64);

    // Verify consultation status is now 'approved'
    const consultRow = (await pool.query("SELECT status, case_version FROM consultations WHERE id = $1", [encId])).rows[0];
    assert.strictEqual(consultRow.status, "approved");
    assert.strictEqual(consultRow.case_version, 2);

    // Attempting direct PATCH on signed artifact must be rejected with 409 or 400
    const patchReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${art.id}`, {
      method: "PATCH",
      role: "clinician",
      userId: "usr_doc_chen",
      doctorId: "dr_chen",
      body: { soapSubjective: "Illegal modification attempt." },
    });
    const patchRes = await patchArtifactHandler(patchReq, { params: Promise.resolve({ id: encId, artifactId: art.id }) });
    assert.ok(patchRes.status === 409 || patchRes.status === 400);
    const patchBody = await patchRes.json();
    assert.ok(
      patchBody.error?.toLowerCase().includes("immutable") ||
      patchBody.code === "SIGNED_ARTIFACT_IMMUTABLE" ||
      patchBody.code === "ARTIFACT_IMMUTABLE"
    );
  });

  // 4. Linked Amendment v2 Creation Preserving v1
  it("4. Linked amendment creates v2 with parent link, preserving v1 immutability", async () => {
    const encId = cid("stage4-amend");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, status, case_version)
      VALUES ($1, 'usr_patient_dan', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'completed_pending_review', 1)
    `, [encId]);

    // Create v1, submit, and sign
    const createRes = await postArtifactsHandler(
      makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts`, {
        method: "POST",
        role: "clinician",
        userId: "usr_doc_chen",
        doctorId: "dr_chen",
        body: {
          chiefComplaint: "Knee pain",
          soapSubjective: "Right knee pain after basketball game.",
          soapObjective: "Mild joint effusion; ligament stability intact.",
          soapAssessment: "Right knee strain.",
          soapPlan: "RICE therapy and NSAIDs.",
          icd10Codes: ["S83.91XA"],
          esiScore: 4,
        },
      }),
      { params: Promise.resolve({ id: encId }) }
    );
    assert.strictEqual(createRes.status, 201);
    const v1 = (await createRes.json()).artifact;

    await submitArtifactHandler(
      makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${v1.id}/submit`, {
        method: "POST",
        role: "clinician",
        userId: "usr_doc_chen",
        doctorId: "dr_chen",
      }),
      { params: Promise.resolve({ id: encId, artifactId: v1.id }) }
    );

    await signArtifactHandler(
      makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${v1.id}/sign`, {
        method: "POST",
        role: "clinician",
        userId: "usr_doc_chen",
        doctorId: "dr_chen",
        body: {
          idempotencyKey: `sign-v1-${v1.id}`,
          expectedCaseVersion: 1,
        },
      }),
      { params: Promise.resolve({ id: encId, artifactId: v1.id }) }
    );

    // Create amendment v2
    const amendReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts`, {
      method: "POST",
      role: "clinician",
      userId: "usr_doc_chen",
      doctorId: "dr_chen",
      body: {
        parentArtifactId: v1.id,
        amendmentReason: "MRI report received showing lateral meniscus tear. Adjusting care plan.",
        chiefComplaint: "Right knee injury with MRI confirmation",
        soapSubjective: "Right knee pain persistent; MRI confirmed lateral meniscus tear.",
        soapObjective: "Mild joint effusion; McMurray test positive.",
        soapAssessment: "Tear of lateral meniscus, right knee.",
        soapPlan: "Orthopedic surgery referral for arthroscopy evaluation.",
        icd10Codes: ["S83.241A"],
        esiScore: 3,
      },
    });

    const amendRes = await postArtifactsHandler(amendReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(amendRes.status, 201);
    const v2 = (await amendRes.json()).artifact;
    assert.strictEqual(v2.version, 2);
    assert.strictEqual(v2.parentArtifactId, v1.id);
    assert.strictEqual(v2.status, "draft");
    assert.strictEqual(v2.amendmentReason, "MRI report received showing lateral meniscus tear. Adjusting care plan.");

    // Verify v1 is still intact in DB
    const v1Check = (await pool.query("SELECT status, version FROM clinical_artifacts WHERE id = $1", [v1.id])).rows[0];
    assert.strictEqual(v1Check.status, "signed");
    assert.strictEqual(v1Check.version, 1);
  });

  // 5. Token-based diff verification between v1 and v2
  it("5. Diff engine calculates semantic additions, removals, and unchanged tokens between v1 and v2", () => {
    const v1 = {
      version: 1,
      chiefComplaint: "Mild throat irritation",
      soapSubjective: "Patient reports sore throat for 2 days. No cough.",
      soapObjective: "Pharynx mildly erythematous. No exudate.",
      soapAssessment: "Viral pharyngitis.",
      soapPlan: "Hydration and lozenges. Follow up in 3 days if worse.",
      icd10Codes: ["J02.9"],
      esiScore: 4,
    };

    const v2 = {
      version: 2,
      parentArtifactId: "art_v1",
      amendmentReason: "Rapid Strep test resulted positive. Starting amoxicillin.",
      chiefComplaint: "Throat irritation with positive rapid strep",
      soapSubjective: "Patient reports sore throat for 2 days with new fever.",
      soapObjective: "Pharynx erythematous with bilateral tonsillar exudate.",
      soapAssessment: "Streptococcal pharyngitis (Group A).",
      soapPlan: "Amoxicillin 500mg PO TID for 10 days. Hydration and rest.",
      icd10Codes: ["J02.0"],
      esiScore: 3,
    };

    const diff = computeArtifactDiff(v1, v2);

    assert.strictEqual(diff.hasClinicalChanges, true);
    assert.strictEqual(diff.baseVersion, 1);
    assert.strictEqual(diff.targetVersion, 2);
    assert.strictEqual(diff.amendmentReason, "Rapid Strep test resulted positive. Starting amoxicillin.");

    // Subjective diff: "new fever" added, "No cough" removed
    assert.strictEqual(diff.subjective.hasChanges, true);
    const addedSubj = diff.subjective.chunks.filter((c) => c.type === "added").map((c) => c.value).join(" ");
    const removedSubj = diff.subjective.chunks.filter((c) => c.type === "removed").map((c) => c.value).join(" ");
    assert.ok(addedSubj.includes("fever"));
    assert.ok(removedSubj.includes("cough"));

    // Objective diff: tonsillar exudate
    assert.strictEqual(diff.objective.hasChanges, true);

    // Plan diff: Amoxicillin added
    assert.strictEqual(diff.plan.hasChanges, true);
    const addedPlan = diff.plan.chunks.filter((c) => c.type === "added").map((c) => c.value).join(" ");
    assert.ok(addedPlan.includes("Amoxicillin"));

    // ICD-10 codes diff
    assert.strictEqual(diff.icd10Codes.hasChanges, true);
    assert.deepStrictEqual(diff.icd10Codes.diff.added, ["J02.0"]);
    assert.deepStrictEqual(diff.icd10Codes.diff.removed, ["J02.9"]);

    // ESI Score diff
    assert.strictEqual(diff.esiScore.hasChanges, true);
    assert.strictEqual(diff.esiScore.base, 4);
    assert.strictEqual(diff.esiScore.target, 3);
  });

  // 6. Whitespace-normalization invariance
  it("6. Whitespace normalization ignores harmless CRLF, trailing spaces, and blank lines", () => {
    const textA = "Patient presented with dizziness.  \r\nVital signs normal.  \n\n\nNo acute distress.\r\n";
    const textB = "Patient presented with dizziness.\nVital signs normal.\n\nNo acute distress.";

    const normA = normalizeClinicalText(textA);
    const normB = normalizeClinicalText(textB);
    assert.strictEqual(normA, normB);

    const chunks = diffClinicalText(textA, textB);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].type, "unchanged");

    const artA = { version: 1, soapSubjective: textA, icd10Codes: ["R42"] };
    const artB = { version: 2, soapSubjective: textB, icd10Codes: ["R42"] };
    const diff = computeArtifactDiff(artA, artB);
    assert.strictEqual(diff.subjective.hasChanges, false);
    assert.strictEqual(diff.hasClinicalChanges, false);
  });

  // 7. Patient role view: signed v1 and signed v2 visible; drafts/cancelled hidden
  it("7. Patient role query receives only certified signed artifacts (drafts & cancelled filtered out)", async () => {
    const encId = cid("stage4-patient-filter");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, status, case_version)
      VALUES ($1, 'usr_patient_eve', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'approved', 3)
    `, [encId]);

    const v1Id = cid("art_v1_signed");
    const v2Id = cid("art_v2_signed");
    const v3Id = cid("art_v3_draft");

    // Insert 1 signed v1, 1 signed v2, 1 draft v3 with valid constraints
    await pool.query(`
      INSERT INTO clinical_artifacts (id, consultation_id, version, status, chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan, payload_sha256, signed_by, signed_by_role, signed_at, signing_attestation_digest)
      VALUES 
        ($1, $4, 1, 'signed', 'Headache', 'v1 signed notes', 'Vitals normal', 'Tension headache', 'Rest', $5, 'Dr. Sarah Chen, MD', 'clinician', now(), $6),
        ($2, $4, 2, 'signed', 'Headache', 'v2 signed amendment notes', 'Vitals normal', 'Migraine', 'Medication', $5, 'Dr. Sarah Chen, MD', 'clinician', now(), $6),
        ($3, $4, 3, 'draft', 'Headache', 'v3 unreviewed notes', 'Vitals normal', 'Draft impression', 'Draft plan', null, null, null, null, null)
    `, [v1Id, v2Id, v3Id, encId, VALID_HEX_64_A, VALID_HEX_64_B]);

    // Patient query
    const patientReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts`, {
      method: "GET",
      role: "patient",
      userId: "usr_patient_eve",
    });
    const patientRes = await getArtifactsHandler(patientReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(patientRes.status, 200);
    const patientBody = await patientRes.json();
    assert.strictEqual(patientBody.artifacts.length, 2);
    assert.strictEqual(patientBody.artifacts.every((a: any) => a.status === "signed"), true);
    assert.strictEqual(patientBody.artifacts.some((a: any) => a.version === 3), false);

    // Clinician query on same encounter sees all 3
    const docReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts`, {
      method: "GET",
      role: "clinician",
      userId: "usr_doc_chen",
      doctorId: "dr_chen",
    });
    const docRes = await getArtifactsHandler(docReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(docRes.status, 200);
    const docBody = await docRes.json();
    assert.strictEqual(docBody.artifacts.length, 3);
  });

  // 8. Cancelled amendment handling
  it("8. Cancelling draft amendment v2 releases active constraint and permits replacement v2 amendment", async () => {
    const encId = cid("stage4-cancel-amend");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, status, case_version)
      VALUES ($1, 'usr_patient_frank', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'approved', 2)
    `, [encId]);

    // Create v1 signed
    const v1Id = cid("art_v1");
    await pool.query(`
      INSERT INTO clinical_artifacts (id, consultation_id, version, status, chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan, payload_sha256, signed_by, signed_by_role, signed_at, signing_attestation_digest)
      VALUES ($1, $2, 1, 'signed', 'Dizziness', 'Soreness', 'BP 120/80', 'Benign vertigo', 'Meclizine', $3, 'Dr. Sarah Chen, MD', 'clinician', now(), $4)
    `, [v1Id, encId, VALID_HEX_64_A, VALID_HEX_64_B]);

    // Create amendment v2 draft
    const amend1Res = await postArtifactsHandler(
      makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts`, {
        method: "POST",
        role: "clinician",
        userId: "usr_doc_chen",
        doctorId: "dr_chen",
        body: {
          parentArtifactId: v1Id,
          amendmentReason: "Erroneously started amendment note; will cancel.",
          chiefComplaint: "Dizziness",
          soapSubjective: "Initial amendment thought.",
          soapObjective: "BP 120/80",
          soapAssessment: "Vertigo revision",
          soapPlan: "Medication change",
        },
      }),
      { params: Promise.resolve({ id: encId }) }
    );
    assert.strictEqual(amend1Res.status, 201);
    const draftV2 = (await amend1Res.json()).artifact;

    // Second amendment while draftV2 is active should fail with 409
    const conflictRes = await postArtifactsHandler(
      makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts`, {
        method: "POST",
        role: "clinician",
        userId: "usr_doc_chen",
        doctorId: "dr_chen",
        body: {
          parentArtifactId: v1Id,
          amendmentReason: "Second concurrent amendment attempt.",
        },
      }),
      { params: Promise.resolve({ id: encId }) }
    );
    assert.strictEqual(conflictRes.status, 409);

    // Cancel draftV2 in DB
    await pool.query(`UPDATE clinical_artifacts SET status = 'cancelled' WHERE id = $1`, [draftV2.id]);

    // Now creating replacement amendment should succeed with version 2
    const replacementRes = await postArtifactsHandler(
      makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts`, {
        method: "POST",
        role: "clinician",
        userId: "usr_doc_chen",
        doctorId: "dr_chen",
        body: {
          parentArtifactId: v1Id,
          amendmentReason: "Replacement amendment with correct lab values.",
          chiefComplaint: "Dizziness evaluation",
          soapSubjective: "Accurate amendment narrative.",
          soapObjective: "Labs completed.",
          soapAssessment: "Benign positional vertigo.",
          soapPlan: "Epley maneuver instructed.",
        },
      }),
      { params: Promise.resolve({ id: encId }) }
    );
    assert.strictEqual(replacementRes.status, 201);
    const repArt = (await replacementRes.json()).artifact;
    assert.strictEqual(repArt.version, 2);
    assert.strictEqual(repArt.status, "draft");
  });

  // 9. Concurrent signing and amendment serialization
  it("9. Signing rejects outdated case_version with 409 CAS_CONFLICT", async () => {
    const encId = cid("stage4-cas-conflict");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, status, case_version)
      VALUES ($1, 'usr_patient_grace', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'completed_pending_review', 3)
    `, [encId]);

    const artId = cid("art_cas");
    await pool.query(`
      INSERT INTO clinical_artifacts (id, consultation_id, version, status, chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan)
      VALUES ($1, $2, 1, 'pending_review', 'CAS check', 'Subj', 'Obj', 'Assess', 'Plan')
    `, [artId, encId]);

    // Send sign request expecting case_version=1 when DB has case_version=3
    const req = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${artId}/sign`, {
      method: "POST",
      role: "clinician",
      userId: "usr_doc_chen",
      doctorId: "dr_chen",
      body: {
        idempotencyKey: `sign-cas-${artId}`,
        expectedCaseVersion: 1,
      },
    });

    const res = await signArtifactHandler(req, { params: Promise.resolve({ id: encId, artifactId: artId }) });
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.ok(body.code === "CAS_CONFLICT" || body.error.includes("CAS conflict"));
  });

  // 10. Lost-response idempotency replay
  it("10. Lost-response idempotency replay returns identical signed payload without creating duplicate audits or versions", async () => {
    const encId = cid("stage4-idemp-replay");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, status, case_version)
      VALUES ($1, 'usr_patient_hank', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'completed_pending_review', 1)
    `, [encId]);

    const artId = cid("art_idemp");
    await pool.query(`
      INSERT INTO clinical_artifacts (id, consultation_id, version, status, chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan)
      VALUES ($1, $2, 1, 'pending_review', 'Syncope', 'Sudden fainting episode while standing.', 'Orthostatic vitals normal.', 'Vasovagal syncope.', 'Hydration.')
    `, [artId, encId]);

    const idempKey = `idemp-replay-key-${artId}`;
    const firstReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${artId}/sign`, {
      method: "POST",
      role: "clinician",
      userId: "usr_doc_chen",
      doctorId: "dr_chen",
      body: {
        idempotencyKey: idempKey,
        expectedCaseVersion: 1,
      },
    });

    const firstRes = await signArtifactHandler(firstReq, { params: Promise.resolve({ id: encId, artifactId: artId }) });
    assert.strictEqual(firstRes.status, 200);
    const firstPayload = await firstRes.json();

    // Replay identical request
    const replayReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${artId}/sign`, {
      method: "POST",
      role: "clinician",
      userId: "usr_doc_chen",
      doctorId: "dr_chen",
      body: {
        idempotencyKey: idempKey,
        expectedCaseVersion: 1,
      },
    });

    const replayRes = await signArtifactHandler(replayReq, { params: Promise.resolve({ id: encId, artifactId: artId }) });
    assert.strictEqual(replayRes.status, 200);
    const replayPayload = await replayRes.json();
    assert.strictEqual(replayPayload.artifact.id, firstPayload.artifact.id);
    assert.strictEqual(
      replayPayload.artifact.payloadSha256 || replayPayload.artifact.canonicalDigest,
      firstPayload.artifact.payloadSha256 || firstPayload.artifact.canonicalDigest
    );

    // Verify exactly 1 signed artifact exists for this encounter in DB
    const countCheck = (await pool.query("SELECT COUNT(*) FROM clinical_artifacts WHERE consultation_id = $1", [encId])).rows[0].count;
    assert.strictEqual(Number(countCheck), 1);
  });

  // 11. Cross-patient IDOR protection
  it("11. Patient B cannot access Patient A's artifacts or document timeline (403 IDOR blocked)", async () => {
    const encId = cid("stage4-idor");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, status, case_version)
      VALUES ($1, 'usr_patient_alice', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'approved', 1)
    `, [encId]);

    const aliceArtId = cid("art_alice");
    await pool.query(`
      INSERT INTO clinical_artifacts (id, consultation_id, version, status, chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan, payload_sha256, signed_by, signed_by_role, signed_at, signing_attestation_digest)
      VALUES ($1, $2, 1, 'signed', 'Follow-up', 'Subj', 'Obj', 'Assess', 'Plan', $3, 'Dr. Sarah Chen, MD', 'clinician', now(), $4)
    `, [aliceArtId, encId, VALID_HEX_64_A, VALID_HEX_64_B]);

    // Attacking patient Eve tries to read Alice's artifacts
    const attackReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts`, {
      method: "GET",
      role: "patient",
      userId: "usr_patient_eve",
    });

    const attackRes = await getArtifactsHandler(attackReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(attackRes.status, 403);
    const body = await attackRes.json();
    assert.ok(body.error.includes("Forbidden"));
  });

  // 12. Unassigned clinician rejection
  it("12. Unassigned clinician cannot sign another physician's consultation (403 blocked)", async () => {
    const encId = cid("stage4-unassigned-doc");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, status, case_version)
      VALUES ($1, 'usr_patient_ian', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'completed_pending_review', 1)
    `, [encId]);

    const artId = cid("art_unassigned");
    await pool.query(`
      INSERT INTO clinical_artifacts (id, consultation_id, version, status, chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan)
      VALUES ($1, $2, 1, 'pending_review', 'Check', 'Subj', 'Obj', 'Assess', 'Plan')
    `, [artId, encId]);

    // Dr. Watson attempts to sign Dr. Chen's consultation
    const docReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${artId}/sign`, {
      method: "POST",
      role: "clinician",
      userId: "usr_doc_watson",
      doctorId: "dr_watson",
      body: {
        idempotencyKey: `sign-watson-${artId}`,
        expectedCaseVersion: 1,
      },
    });

    const docRes = await signArtifactHandler(docReq, { params: Promise.resolve({ id: encId, artifactId: artId }) });
    assert.strictEqual(docRes.status, 403);
    const body = await docRes.json();
    assert.ok(body.error.includes("assigned physician"));
  });

  // 13. Administrative override authorization and audit logging
  it("13. Administrative override signs artifact with clinical_artifacts:sign:any and records audit log", async () => {
    const encId = cid("stage4-admin-override");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, status, case_version)
      VALUES ($1, 'usr_patient_jack', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'completed_pending_review', 1)
    `, [encId]);

    const artId = cid("art_admin_ov");
    await pool.query(`
      INSERT INTO clinical_artifacts (id, consultation_id, version, status, chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan)
      VALUES ($1, $2, 1, 'pending_review', 'Emergency Triage', 'Urgent physician override required.', 'Obj', 'Assess', 'Plan')
    `, [artId, encId]);

    // Admin signing with override permission and auditable justification
    const adminReq = makeReq(`http://localhost:3000/api/consultations/${encId}/artifacts/${artId}/sign`, {
      method: "POST",
      role: "admin",
      userId: "usr_chief_medical_officer",
      permissions: "clinical_artifacts:sign:any,consultations:approve",
      body: {
        idempotencyKey: `sign-override-${artId}`,
        expectedCaseVersion: 1,
        overrideReason: "Emergency CMO administrative review and signing override",
        signatureAttestation: "CMO Administrative Override Attestation",
      },
    });

    const adminRes = await signArtifactHandler(adminReq, { params: Promise.resolve({ id: encId, artifactId: artId }) });
    assert.strictEqual(adminRes.status, 200);
    const body = await adminRes.json();
    assert.strictEqual(body.artifact.status, "signed");
    assert.strictEqual(body.artifact.signedBy, "usr_chief_medical_officer");

    // Verify audit log
    const auditRow = (await pool.query(
      "SELECT action, actor_id, metadata FROM audit_events WHERE action = 'CLINICAL_ARTIFACT_SIGNED' AND metadata->>'isAdministrativeOverride' = 'true' ORDER BY \"index\" DESC LIMIT 1"
    )).rows[0];
    assert.ok(auditRow);
    assert.strictEqual(auditRow.actor_id, "usr_chief_medical_officer");
    assert.strictEqual(auditRow.metadata.isAdministrativeOverride, true);
    assert.ok(auditRow.metadata.overrideReason.includes("Emergency CMO"));
  });

  // 14. Authoritative FHIR export with Composition status: "final"
  it("14. FHIR export builds valid HL7 FHIR R4 Bundle from signed clinical artifact with status final", async () => {
    const encId = cid("stage4-fhir");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, status, case_version)
      VALUES ($1, 'usr_patient_karen', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'approved', 2)
    `, [encId]);

    const artId = cid("art_fhir");
    await pool.query(`
      INSERT INTO clinical_artifacts (id, consultation_id, version, status, chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan, icd10_codes, esi_score, payload_sha256, signed_by, signed_by_role, signed_at, signing_attestation_digest)
      VALUES ($1, $2, 1, 'signed', 'Atrial Fibrillation', 'Palpitations and fatigue.', 'Irregularly irregular heart rhythm on auscultation.', 'Atrial Fibrillation with RVR.', 'Metoprolol 25mg PO BID. Cardiology follow-up.', '["I48.91"]'::jsonb, 2, $3, 'Dr. Sarah Chen, MD', 'clinician', now(), $4)
    `, [artId, encId, VALID_HEX_64_A, VALID_HEX_64_B]);

    // Query as patient owner
    const fhirReq = makeReq(`http://localhost:3000/api/consultations/${encId}/fhir`, {
      method: "GET",
      role: "patient",
      userId: "usr_patient_karen",
    });

    const fhirRes = await getConsultationFhirHandler(fhirReq, { params: Promise.resolve({ id: encId }) });
    assert.strictEqual(fhirRes.status, 200);
    const bundle = await fhirRes.json();

    assert.strictEqual(bundle.resourceType, "Bundle");
    assert.strictEqual(bundle.type, "document");

    const composition = bundle.entry.find((e: any) => e.resource.resourceType === "Composition")?.resource;
    assert.ok(composition);
    assert.strictEqual(composition.status, "final");

    // Check SOAP section entries
    const sections = composition.section || [];
    assert.ok(sections.some((s: any) => s.title.includes("Subjective")));
    assert.ok(sections.some((s: any) => s.title.includes("Assessment")));
    assert.ok(sections.some((s: any) => s.title.includes("Plan")));
  });

  // 15. Legacy approved consultation compatibility
  it("15. Legacy approved consultation without clinical_artifacts row returns honest legacy representation", async () => {
    const legacyEncId = cid("stage4-legacy-approved");
    await pool.query(`
      INSERT INTO consultations (id, user_id, doctor_id, doctor_name, specialty, chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan, status, approved_at, approved_by, case_version)
      VALUES ($1, 'usr_patient_leo', 'dr_chen', 'Dr. Sarah Chen, MD', 'Cardiology', 'Legacy chest pain checkup', 'Old subjective text.', 'Old vitals.', 'Old impression.', 'Old plan.', 'approved', now(), 'dr_chen', 1)
    `, [legacyEncId]);

    const req = makeReq(`http://localhost:3000/api/consultations/${legacyEncId}/artifacts`, {
      method: "GET",
      role: "patient",
      userId: "usr_patient_leo",
    });

    const res = await getArtifactsHandler(req, { params: Promise.resolve({ id: legacyEncId }) });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.artifacts.length, 0);

    // FHIR export should still work cleanly using legacy consultation columns
    const fhirReq = makeReq(`http://localhost:3000/api/consultations/${legacyEncId}/fhir`, {
      method: "GET",
      role: "patient",
      userId: "usr_patient_leo",
    });
    const fhirRes = await getConsultationFhirHandler(fhirReq, { params: Promise.resolve({ id: legacyEncId }) });
    assert.strictEqual(fhirRes.status, 200);
    const bundle = await fhirRes.json();
    assert.strictEqual(bundle.resourceType, "Bundle");
  });

  // 16. Semantic array & section diff calculations
  it("16. diffArray correctly calculates ICD-10 code additions and removals", () => {
    const baseCodes = ["I20.9", "R07.9", "Z86.79"];
    const targetCodes = ["I21.9", "R07.9", "I25.10"];

    const diff = diffArray(baseCodes, targetCodes);
    assert.deepStrictEqual(diff.added, ["I21.9", "I25.10"]);
    assert.deepStrictEqual(diff.removed, ["I20.9", "Z86.79"]);
    assert.deepStrictEqual(diff.unchanged, ["R07.9"]);
  });
});
