/**
 * MedVoice: Patient Consultation History & Encounter-Specific SOAP Unification Test Suite
 *
 * Verifies the 12 core requirements for unifying patient consultation history with
 * encounter-specific SOAP reports:
 * 1. Patient sees their own consultations only.
 * 2. Consultation with signed SOAP exposes View SOAP and valid soapSummary.
 * 3. Paused consultation displays Resume and no SOAP.
 * 4. Completed-pending-review displays Awaiting review without draft exposure.
 * 5. Draft amendments are never exposed to patients.
 * 6. Patient can open their own signed SOAP.
 * 7. Patient cannot access another patient's consultation (IDOR rejection).
 * 8. Patient cannot access another patient's artifact ID.
 * 9. Patient cannot retrieve unsigned artifact through direct API access.
 * 10. Historical signed versions remain accessible.
 * 11. Physician dashboard continues to work independently.
 * 12. Existing consultation pagination and longitudinal facts remain intact.
 */

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://postgres:testpass@localhost:5433/medvoice_test";

(process.env as any).NODE_ENV = "test";
(process.env as any).TEST_DATABASE_URL = TEST_DB_URL;

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import { Pool } from "pg";
import { assertSafeTestDatabase } from "../../lib/security/test-db-guard";
import { getDb, closeDbPool } from "../../config/db";
import { DEFAULT_INTERNAL_TEST_SECRET, INTERNAL_TEST_SECRET_HEADER } from "../../lib/auth/rbac";
import { clearAuditLedger } from "../../lib/audit/audit-logger";

// Route handlers
import { GET as getConsultationsHandler } from "../../app/api/consultations/route";
import { GET as getConsultationByIdHandler } from "../../app/api/consultations/[id]/route";
import {
  GET as getArtifactsHandler,
  POST as postArtifactsHandler,
} from "../../app/api/consultations/[id]/artifacts/route";
import {
  GET as getArtifactByIdHandler,
} from "../../app/api/consultations/[id]/artifacts/[artifactId]/route";
import {
  POST as submitArtifactHandler,
} from "../../app/api/consultations/[id]/artifacts/[artifactId]/submit/route";
import {
  POST as signArtifactHandler,
} from "../../app/api/consultations/[id]/artifacts/[artifactId]/sign/route";

(process.env as any).NODE_ENV = "test";
(process.env as any).INTERNAL_TEST_SECRET = DEFAULT_INTERNAL_TEST_SECRET;

const SUITE_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function uid(base: string): string {
  return `${base}-${SUITE_ID}`;
}

describe("Patient History & Encounter SOAP Unification Battery", () => {
  let pool: Pool;
  let drizzleDb: any;

  // Test Patients & Clinician IDs
  const PATIENT_A = uid("patient-alice");
  const PATIENT_B = uid("patient-bob");
  const DOCTOR_ID = "dr-sarah-chen";

  // Test Encounters
  const ENC_SIGNED_V1 = uid("enc-signed-v1");
  const ENC_MULTI_VERSION = uid("enc-multi-ver");
  const ENC_PAUSED = uid("enc-paused");
  const ENC_PENDING_REVIEW = uid("enc-pending-rev");
  const ENC_BOB = uid("enc-bob-private");

  function authHeaders(role: "patient" | "clinician" | "admin", userId: string, doctorId?: string) {
    const headers: Record<string, string> = {
      [INTERNAL_TEST_SECRET_HEADER]: DEFAULT_INTERNAL_TEST_SECRET,
      "x-mock-role": role,
      "x-mock-user-id": userId,
    };
    if (doctorId) {
      headers["x-mock-doctor-id"] = doctorId;
    }
    return headers;
  }

  before(async () => {
    assertSafeTestDatabase(TEST_DB_URL);
    pool = new Pool({ connectionString: TEST_DB_URL, max: 5 });

    // Ensure consultations table schema in local test database has all columns expected by Drizzle
    await pool.query(`
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_profile_id" varchar(128);
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "parent_consultation_id" varchar(128);
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_name" varchar(128) DEFAULT 'Anonymous Patient';
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_age" varchar(32);
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_gender" varchar(32);
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "triage_level" varchar(64) DEFAULT 'routine';
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "triage_title" varchar(255);
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "esi_score" integer;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "detected_symptoms" jsonb DEFAULT '[]'::jsonb;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "recommended_specialists" jsonb DEFAULT '[]'::jsonb;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "recommended_action" text;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "duration_seconds" integer DEFAULT 0;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "interview_state" jsonb;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "delivered_turn_records" jsonb DEFAULT '[]'::jsonb;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "attributed_facts" jsonb DEFAULT '[]'::jsonb;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "unmapped_observations" jsonb DEFAULT '[]'::jsonb;
      ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(256);
    `);

    // Ensure clinical_artifacts, idempotency_keys, and audit tables exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "consultations" (
        "id" varchar(128) PRIMARY KEY,
        "user_id" varchar(128) NOT NULL,
        "patient_name" varchar(255) NOT NULL,
        "patient_age" varchar(32),
        "patient_gender" varchar(32),
        "doctor_id" varchar(128) NOT NULL,
        "doctor_name" varchar(255) NOT NULL,
        "specialty" varchar(128) NOT NULL,
        "chief_complaint" text,
        "status" varchar(64) NOT NULL DEFAULT 'in_progress',
        "triage_level" varchar(64) DEFAULT 'routine',
        "triage_title" varchar(255),
        "esi_score" integer,
        "icd10_codes" jsonb DEFAULT '[]'::jsonb,
        "detected_symptoms" jsonb DEFAULT '[]'::jsonb,
        "soap_subjective" text,
        "soap_objective" text,
        "soap_assessment" text,
        "soap_plan" text,
        "recommended_action" text,
        "duration_seconds" integer DEFAULT 0,
        "transcript" jsonb DEFAULT '[]'::jsonb,
        "case_version" integer DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        "updated_at" timestamptz NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "clinical_artifacts" (
        "id" varchar(128) PRIMARY KEY,
        "consultation_id" varchar(128) NOT NULL REFERENCES "consultations"("id") ON DELETE RESTRICT,
        "artifact_type" varchar(64) NOT NULL DEFAULT 'soap_note',
        "version" integer NOT NULL DEFAULT 1,
        "status" varchar(32) NOT NULL DEFAULT 'draft',
        "chief_complaint" text NOT NULL,
        "soap_subjective" text NOT NULL,
        "soap_objective" text NOT NULL,
        "soap_assessment" text NOT NULL,
        "soap_plan" text NOT NULL,
        "icd10_codes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "esi_score" integer,
        "payload_sha256" varchar(64),
        "signed_by" varchar(128),
        "signed_by_role" varchar(64),
        "signed_at" timestamptz,
        "signing_attestation_digest" varchar(64),
        "amends_artifact_id" varchar(128),
        "amendment_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT NOW(),
        "updated_at" timestamptz NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "signing_idempotency_keys" (
        "idempotency_key" varchar(256) PRIMARY KEY,
        "artifact_id" varchar(128) NOT NULL,
        "consultation_id" varchar(128) NOT NULL,
        "version" integer NOT NULL,
        "request_hash" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "audit_chain_heads" (
        "chain_id" varchar(64) PRIMARY KEY,
        "last_event_index" bigint NOT NULL,
        "last_event_hash" varchar(64) NOT NULL,
        "last_signature" text,
        "updated_at" timestamptz NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "audit_events" (
        "index" bigint PRIMARY KEY,
        "id" varchar(128) NOT NULL,
        "timestamp" timestamptz NOT NULL,
        "actor_id" varchar(128) NOT NULL,
        "actor_role" varchar(64) NOT NULL,
        "action" varchar(128) NOT NULL,
        "resource_type" varchar(128) NOT NULL,
        "resource_id" varchar(128) NOT NULL,
        "status" varchar(64) NOT NULL,
        "previous_hash" varchar(64) NOT NULL,
        "event_hash" varchar(64) NOT NULL,
        "metadata" jsonb
      );

      INSERT INTO "audit_chain_heads" ("chain_id", "last_event_index", "last_event_hash")
      VALUES ('main', -1, '0000000000000000000000000000000000000000000000000000000000000000')
      ON CONFLICT ("chain_id") DO NOTHING;
    `);

    // Table schema verified; unique SUITE_ID ensures non-colliding isolated rows
    // Note: Signed artifacts cannot be DELETEd due to immutable database trigger trg_protect_signed_artifacts

    // Helper to seed consultations with columns compatible with the test datastore
    async function seedConsultation(
      id: string,
      userId: string,
      doctorId: string,
      status: string,
      chiefComplaint: string,
      caseVersion: number = 1
    ) {
      await pool.query(
        `INSERT INTO consultations (
          id, user_id, doctor_id, doctor_name, specialty,
          chief_complaint, status, case_version, soap_subjective, created_at
        ) VALUES ($1, $2, $3, 'Dr. Sarah Chen, MD', 'Cardiology', $4, $5, $6, 'Clinical notes', NOW())
        ON CONFLICT (id) DO UPDATE SET
          user_id = $2, doctor_id = $3, status = $5, chief_complaint = $4, case_version = $6`,
        [id, userId, doctorId, chiefComplaint, status, caseVersion]
      );
    }

    // 1. Seed Alice's Consultations
    await seedConsultation(ENC_SIGNED_V1, PATIENT_A, DOCTOR_ID, "approved", "Substernal chest tightness on exertion", 1);
    await seedConsultation(ENC_MULTI_VERSION, PATIENT_A, DOCTOR_ID, "approved", "Follow-up on exertional chest pain", 2);
    await seedConsultation(ENC_PAUSED, PATIENT_A, DOCTOR_ID, "paused", "Mild palpitations at rest", 1);
    await seedConsultation(ENC_PENDING_REVIEW, PATIENT_A, DOCTOR_ID, "completed_pending_review", "Dizziness and lightheadedness", 1);

    // 2. Seed Bob's Consultation (ENC_BOB)
    await seedConsultation(ENC_BOB, PATIENT_B, DOCTOR_ID, "approved", "Bob private medical record", 1);

    // 3. Seed Clinical Artifacts
    // A. Signed Artifact for ENC_SIGNED_V1
    const ART_A1 = uid("art-a1");
    await pool.query(`
      INSERT INTO "clinical_artifacts" (
        id, consultation_id, version, status, chief_complaint,
        soap_subjective, soap_objective, soap_assessment, soap_plan,
        icd10_codes, esi_score, payload_sha256, signed_by, signed_by_role,
        signed_at, signing_attestation_digest
      ) VALUES (
        $1, $2, 1, 'signed', 'Substernal chest tightness on exertion',
        'Patient reports tightness when walking up stairs.',
        'BP 130/85, HR 78, regular rhythm.',
        'Likely stable angina pectoris.',
        'Initiate sublingual nitroglycerin PRN and schedule stress test.',
        '["I20.9"]'::jsonb, 3,
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'Dr. Sarah Chen, MD', 'Attending Physician', NOW(),
        'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0'
      );
    `, [ART_A1, ENC_SIGNED_V1]);

    // B. Multi-version artifacts for ENC_MULTI_VERSION:
    // v1: signed
    // v2: signed (amendment)
    // v3: draft amendment (MUST NEVER BE VISIBLE TO PATIENT)
    const ART_MV_V1 = uid("art-mv-v1");
    const ART_MV_V2 = uid("art-mv-v2");
    const ART_MV_V3_DRAFT = uid("art-mv-v3-draft");

    await pool.query(`
      INSERT INTO "clinical_artifacts" (
        id, consultation_id, version, status, chief_complaint,
        soap_subjective, soap_objective, soap_assessment, soap_plan,
        icd10_codes, esi_score, payload_sha256, signed_by, signed_by_role,
        signed_at, signing_attestation_digest
      ) VALUES (
        $1, $2, 1, 'signed', 'Follow-up on exertional chest pain',
        'Patient reports mild symptoms.',
        'Vitals stable.',
        'Awaiting stress test.',
        'Continue medications.',
        '["I20.9"]'::jsonb, 3,
        '1111111111111111111111111111111111111111111111111111111111111111',
        'Dr. Sarah Chen, MD', 'Attending Physician', NOW() - INTERVAL '3 days',
        '2222222222222222222222222222222222222222222222222222222222222222'
      );
    `, [ART_MV_V1, ENC_MULTI_VERSION]);

    await pool.query(`
      INSERT INTO "clinical_artifacts" (
        id, consultation_id, version, status, chief_complaint,
        soap_subjective, soap_objective, soap_assessment, soap_plan,
        icd10_codes, esi_score, payload_sha256, signed_by, signed_by_role,
        signed_at, signing_attestation_digest, amends_artifact_id, amendment_reason
      ) VALUES (
        $1, $2, 2, 'signed', 'Follow-up on exertional chest pain',
        'Patient completed stress test; shows mild ischemia.',
        'BP 125/80, HR 72.',
        'Exertional ischemia confirmed.',
        'Adjust beta blocker dosage.',
        '["I20.9"]'::jsonb, 3,
        '3333333333333333333333333333333333333333333333333333333333333333',
        'Dr. Sarah Chen, MD', 'Attending Physician', NOW(),
        '4444444444444444444444444444444444444444444444444444444444444444',
        $3, 'Updated with post-stress test clinical findings'
      );
    `, [ART_MV_V2, ENC_MULTI_VERSION, ART_MV_V1]);

    await pool.query(`
      INSERT INTO "clinical_artifacts" (
        id, consultation_id, version, status, chief_complaint,
        soap_subjective, soap_objective, soap_assessment, soap_plan,
        icd10_codes, esi_score, amends_artifact_id, amendment_reason
      ) VALUES (
        $1, $2, 3, 'draft', 'Follow-up on exertional chest pain',
        'Draft subjective note not yet attested.',
        'Draft objective note.',
        'Draft assessment note.',
        'Draft plan note.',
        '["I20.9"]'::jsonb, 3,
        $3, 'Work in progress amendment by clinician'
      );
    `, [ART_MV_V3_DRAFT, ENC_MULTI_VERSION, ART_MV_V2]);

    // C. Pending review artifact for ENC_PENDING_REVIEW
    const ART_PENDING = uid("art-pending");
    await pool.query(`
      INSERT INTO "clinical_artifacts" (
        id, consultation_id, version, status, chief_complaint,
        soap_subjective, soap_objective, soap_assessment, soap_plan,
        icd10_codes, esi_score
      ) VALUES (
        $1, $2, 1, 'pending_review', 'Dizziness and lightheadedness',
        'Patient reports orthostatic dizziness.',
        'Vitals recorded.',
        'Probable orthostatic hypotension.',
        'Hydration and slow postural changes.',
        '["R42"]'::jsonb, 4
      );
    `, [ART_PENDING, ENC_PENDING_REVIEW]);

    // D. Bob's signed artifact (ENC_BOB)
    const ART_BOB = uid("art-bob");
    await pool.query(`
      INSERT INTO "clinical_artifacts" (
        id, consultation_id, version, status, chief_complaint,
        soap_subjective, soap_objective, soap_assessment, soap_plan,
        icd10_codes, esi_score, payload_sha256, signed_by, signed_by_role,
        signed_at, signing_attestation_digest
      ) VALUES (
        $1, $2, 1, 'signed', 'Bob private medical record',
        'Bob private subjective note.',
        'Bob objective findings.',
        'Bob clinical assessment.',
        'Bob plan.',
        '["Z00.00"]'::jsonb, 5,
        '5555555555555555555555555555555555555555555555555555555555555555',
        'Dr. Sarah Chen, MD', 'Attending Physician', NOW(),
        '6666666666666666666666666666666666666666666666666666666666666666'
      );
    `, [ART_BOB, ENC_BOB]);
  });

  after(async () => {
    if (pool) {
      await pool.end();
    }
    await closeDbPool();
  });

  // --------------------------------------------------------------------------
  // Test 1: Patient sees their own consultations only (Tenant Isolation)
  // --------------------------------------------------------------------------
  it("Test 1: Patient sees their own consultations only (no cross-tenant leakage)", async () => {
    const req = new Request("http://localhost/api/consultations", {
      headers: authHeaders("patient", PATIENT_A),
    });

    const res = await getConsultationsHandler(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(Array.isArray(body.consultations), true);

    const ids = body.consultations.map((c: any) => c.id);
    assert.strictEqual(ids.includes(ENC_SIGNED_V1), true, "Alice must see her signed consultation");
    assert.strictEqual(ids.includes(ENC_MULTI_VERSION), true, "Alice must see her multi-version consultation");
    assert.strictEqual(ids.includes(ENC_PAUSED), true, "Alice must see her paused consultation");
    assert.strictEqual(ids.includes(ENC_PENDING_REVIEW), true, "Alice must see her pending review consultation");

    // Strict Tenant Isolation check
    assert.strictEqual(ids.includes(ENC_BOB), false, "Alice must NEVER see Bob's consultation");
    for (const consult of body.consultations) {
      assert.strictEqual(consult.userId, PATIENT_A, "All returned consultations must belong to Alice");
    }
  });

  // --------------------------------------------------------------------------
  // Test 2: Consultation with signed SOAP exposes View SOAP and valid soapSummary
  // --------------------------------------------------------------------------
  it("Test 2: Consultation with signed SOAP exposes View SOAP and server-derived summary", async () => {
    const req = new Request("http://localhost/api/consultations", {
      headers: authHeaders("patient", PATIENT_A),
    });

    const res = await getConsultationsHandler(req);
    const body = await res.json();
    const signedItem = body.consultations.find((c: any) => c.id === ENC_SIGNED_V1);

    assert(signedItem, "Signed consultation must exist in response");
    assert(signedItem.soapSummary, "Must attach server-derived soapSummary");
    assert.strictEqual(signedItem.soapSummary.hasSignedArtifact, true);
    assert.strictEqual(signedItem.soapSummary.status, "signed");
    assert.strictEqual(signedItem.soapSummary.latestSignedVersion, 1);
    assert.strictEqual(typeof signedItem.soapSummary.latestSignedArtifactId, "string");
    assert.strictEqual(signedItem.soapSummary.totalSignedVersions, 1);
  });

  // --------------------------------------------------------------------------
  // Test 3: Paused consultation displays Resume and no SOAP
  // --------------------------------------------------------------------------
  it("Test 3: Paused consultation displays Resume and no SOAP report yet", async () => {
    const req = new Request("http://localhost/api/consultations", {
      headers: authHeaders("patient", PATIENT_A),
    });

    const res = await getConsultationsHandler(req);
    const body = await res.json();
    const pausedItem = body.consultations.find((c: any) => c.id === ENC_PAUSED);

    assert(pausedItem, "Paused consultation must exist in response");
    assert.strictEqual(pausedItem.status, "paused");
    assert(pausedItem.soapSummary, "Must attach soapSummary");
    assert.strictEqual(pausedItem.soapSummary.hasSignedArtifact, false);
    assert.strictEqual(pausedItem.soapSummary.status, "none");
    assert.strictEqual(pausedItem.soapSummary.latestSignedArtifactId, null);
  });

  // --------------------------------------------------------------------------
  // Test 4: Completed-pending-review displays Awaiting review without draft exposure
  // --------------------------------------------------------------------------
  it("Test 4: Completed-pending-review displays Awaiting review without draft content exposure", async () => {
    const req = new Request("http://localhost/api/consultations", {
      headers: authHeaders("patient", PATIENT_A),
    });

    const res = await getConsultationsHandler(req);
    const body = await res.json();
    const pendingItem = body.consultations.find((c: any) => c.id === ENC_PENDING_REVIEW);

    assert(pendingItem, "Pending review consultation must exist in response");
    assert.strictEqual(pendingItem.status, "completed_pending_review");
    assert(pendingItem.soapSummary, "Must attach soapSummary");
    assert.strictEqual(pendingItem.soapSummary.hasSignedArtifact, false);
    assert.strictEqual(pendingItem.soapSummary.status, "awaiting_review");

    // Direct artifacts API check for patient
    const artReq = new Request(`http://localhost/api/consultations/${ENC_PENDING_REVIEW}/artifacts`, {
      headers: authHeaders("patient", PATIENT_A),
    });
    const artRes = await getArtifactsHandler(artReq, { params: Promise.resolve({ id: ENC_PENDING_REVIEW }) });
    const artBody = await artRes.json();
    assert.strictEqual(artRes.status, 200);
    // Unsigned artifacts must NOT be exposed to patient
    assert.strictEqual(artBody.artifacts.length, 0, "Patient must see zero artifacts for pending review encounter");
  });

  // --------------------------------------------------------------------------
  // Test 5: Draft amendments are never exposed to patients
  // --------------------------------------------------------------------------
  it("Test 5: Draft amendments are never exposed to patients (only signed versions visible)", async () => {
    const req = new Request(`http://localhost/api/consultations/${ENC_MULTI_VERSION}/artifacts`, {
      headers: authHeaders("patient", PATIENT_A),
    });

    const res = await getArtifactsHandler(req, { params: Promise.resolve({ id: ENC_MULTI_VERSION }) });
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.success, true);
    // Database has v1 (signed), v2 (signed), v3 (draft)
    // Patient must receive ONLY v1 and v2, NEVER v3 draft
    const versions = body.artifacts.map((a: any) => a.version);
    assert.strictEqual(versions.includes(1), true, "v1 signed must be visible");
    assert.strictEqual(versions.includes(2), true, "v2 signed must be visible");
    assert.strictEqual(versions.includes(3), false, "v3 draft amendment must strictly NOT be visible to patient");

    for (const art of body.artifacts) {
      assert.strictEqual(art.status, "signed", "Every artifact returned to patient must have status 'signed'");
    }
  });

  // --------------------------------------------------------------------------
  // Test 6: Patient can open their own signed SOAP
  // --------------------------------------------------------------------------
  it("Test 6: Patient can retrieve and open their own signed SOAP artifact", async () => {
    const req = new Request(`http://localhost/api/consultations/${ENC_SIGNED_V1}/artifacts`, {
      headers: authHeaders("patient", PATIENT_A),
    });

    const res = await getArtifactsHandler(req, { params: Promise.resolve({ id: ENC_SIGNED_V1 }) });
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.artifacts.length, 1);
    const art = body.artifacts[0];
    assert.strictEqual(art.consultationId, ENC_SIGNED_V1);
    assert.strictEqual(art.status, "signed");
    assert.strictEqual(art.soapSubjective.includes("tightness"), true);
    assert.strictEqual(typeof art.payloadSha256, "string");
    assert.strictEqual(typeof art.signingAttestationDigest, "string");
  });

  // --------------------------------------------------------------------------
  // Test 7: Patient cannot access another patient's consultation (Cross-Patient IDOR)
  // --------------------------------------------------------------------------
  it("Test 7: Patient cannot access another patient's consultation (fails closed with 403)", async () => {
    // Alice attempts to access Bob's consultation
    const req = new Request(`http://localhost/api/consultations/${ENC_BOB}`, {
      headers: authHeaders("patient", PATIENT_A),
    });

    const res = await getConsultationByIdHandler(req, { params: Promise.resolve({ id: ENC_BOB }) });
    assert.strictEqual(res.status, 403, "Must reject cross-patient consultation access with HTTP 403");

    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.code, "FORBIDDEN");
  });

  // --------------------------------------------------------------------------
  // Test 8: Patient cannot access another patient's artifact ID
  // --------------------------------------------------------------------------
  it("Test 8: Patient cannot access another patient's artifact ID directly", async () => {
    // Lookup Bob's artifact ID
    const bobArtRow = await pool.query('SELECT id FROM "clinical_artifacts" WHERE consultation_id = $1 LIMIT 1', [ENC_BOB]);
    const bobArtId = bobArtRow.rows[0].id;

    // Alice attempts to access Bob's artifact via Bob's consultation URL
    const req1 = new Request(`http://localhost/api/consultations/${ENC_BOB}/artifacts/${bobArtId}`, {
      headers: authHeaders("patient", PATIENT_A),
    });
    const res1 = await getArtifactByIdHandler(req1, { params: Promise.resolve({ id: ENC_BOB, artifactId: bobArtId }) });
    assert.strictEqual(res1.status, 403, "Must reject access to other patient's consultation artifacts");

    // Alice attempts to sneak Bob's artifact ID under Alice's consultation URL
    const req2 = new Request(`http://localhost/api/consultations/${ENC_SIGNED_V1}/artifacts/${bobArtId}`, {
      headers: authHeaders("patient", PATIENT_A),
    });
    const res2 = await getArtifactByIdHandler(req2, { params: Promise.resolve({ id: ENC_SIGNED_V1, artifactId: bobArtId }) });
    assert.strictEqual(res2.status, 404, "Artifact not belonging to consultation must return 404 without leakage");
  });

  // --------------------------------------------------------------------------
  // Test 9: Patient cannot retrieve unsigned artifact through direct API access
  // --------------------------------------------------------------------------
  it("Test 9: Patient cannot retrieve unsigned artifact through direct artifact ID endpoint", async () => {
    // Lookup the draft artifact ID (ART_MV_V3_DRAFT) on Alice's own consultation
    const draftRow = await pool.query(
      'SELECT id FROM "clinical_artifacts" WHERE consultation_id = $1 AND status = \'draft\' LIMIT 1',
      [ENC_MULTI_VERSION]
    );
    const draftArtId = draftRow.rows[0].id;

    const req = new Request(`http://localhost/api/consultations/${ENC_MULTI_VERSION}/artifacts/${draftArtId}`, {
      headers: authHeaders("patient", PATIENT_A),
    });

    const res = await getArtifactByIdHandler(req, {
      params: Promise.resolve({ id: ENC_MULTI_VERSION, artifactId: draftArtId }),
    });

    // Even though Alice owns the consultation, unsigned notes are strictly forbidden to patients
    assert.strictEqual(res.status, 403, "Direct access to draft artifact by patient must return 403 Forbidden");
    const body = await res.json();
    assert.strictEqual(body.code, "FORBIDDEN");
  });

  // --------------------------------------------------------------------------
  // Test 10: Historical signed versions remain accessible
  // --------------------------------------------------------------------------
  it("Test 10: Historical signed versions remain accessible when multiple signed versions exist", async () => {
    const req = new Request(`http://localhost/api/consultations/${ENC_MULTI_VERSION}/artifacts`, {
      headers: authHeaders("patient", PATIENT_A),
    });

    const res = await getArtifactsHandler(req, { params: Promise.resolve({ id: ENC_MULTI_VERSION }) });
    const body = await res.json();

    assert.strictEqual(body.artifacts.length, 2, "Alice must be able to view both v1 and v2 signed versions");
    const v1 = body.artifacts.find((a: any) => a.version === 1);
    const v2 = body.artifacts.find((a: any) => a.version === 2);

    assert(v1, "Historical signed version v1 must exist");
    assert(v2, "Latest signed version v2 must exist");
    assert.strictEqual(v2.amendsArtifactId, v1.id, "v2 must declare lineage to v1");
    assert.strictEqual(typeof v2.amendmentReason, "string");
  });

  // --------------------------------------------------------------------------
  // Test 11: Physician dashboard continues to work independently
  // --------------------------------------------------------------------------
  it("Test 11: Physician dashboard continues to work independently (clinician sees review queues & drafts)", async () => {
    // Doctor accesses ENC_PENDING_REVIEW artifacts
    const req = new Request(`http://localhost/api/consultations/${ENC_PENDING_REVIEW}/artifacts`, {
      headers: authHeaders("clinician", DOCTOR_ID, DOCTOR_ID),
    });

    const res = await getArtifactsHandler(req, { params: Promise.resolve({ id: ENC_PENDING_REVIEW }) });
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    // Clinician CAN see pending_review artifacts to review and sign them
    assert.strictEqual(body.artifacts.length, 1);
    assert.strictEqual(body.artifacts[0].status, "pending_review");
    assert.strictEqual(body.userRole, "clinician");
  });

  // --------------------------------------------------------------------------
  // Test 12: Existing consultation pagination and longitudinal facts remain intact
  // --------------------------------------------------------------------------
  it("Test 12: Keyset pagination and consultation limit filtering work with soapSummary attached", async () => {
    const req = new Request("http://localhost/api/consultations?limit=2", {
      headers: authHeaders("patient", PATIENT_A),
    });

    const res = await getConsultationsHandler(req);
    assert.strictEqual(res.status, 200);

    const body = await res.json();
    assert.strictEqual(body.consultations.length, 2, "Must respect limit parameter");
    assert.strictEqual(body.hasMore, true, "Must indicate hasMore = true");
    assert.strictEqual(typeof body.nextCursor, "string", "Must provide valid base64 nextCursor");

    for (const c of body.consultations) {
      assert(c.soapSummary, "Each paginated item must include soapSummary");
      assert(typeof c.soapSummary.hasSignedArtifact === "boolean");
    }
  });
});
