-- Migration 0006: Add Clinical Artifacts, Snapshots, Audit Chain Heads, and Signing Idempotency Keys
-- Enforces true immutability, singleton audit serialization, composite lineage, active versioning, and durable signing idempotency.

-- ============================================================================
-- 1. Singleton Audit Chain Heads Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "audit_chain_heads" (
  "chain_id" varchar(64) PRIMARY KEY,
  "last_event_index" integer NOT NULL,
  "last_event_hash" varchar(64) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Historical verification and safe head initialization
DO $$
DECLARE
  v_count integer;
  v_max_index integer;
  v_genesis_hash varchar(64);
  v_last_index integer;
  v_last_hash varchar(64);
  C_GENESIS_HASH CONSTANT varchar(64) := '0000000000000000000000000000000000000000000000000000000000000000';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "audit_chain_heads" WHERE "chain_id" = 'main') THEN
    SELECT COUNT(*), MAX("index") INTO v_count, v_max_index FROM "audit_events";

    IF v_count = 0 THEN
      INSERT INTO "audit_chain_heads" ("chain_id", "last_event_index", "last_event_hash", "updated_at")
      VALUES ('main', -1, C_GENESIS_HASH, now());
    ELSE
      IF v_count <> (v_max_index + 1) THEN
        RAISE EXCEPTION 'AUDIT_CHAIN_INTEGRITY_VIOLATION: Non-contiguous indices detected in audit_events. Count: %, Max Index: %',
          v_count, v_max_index;
      END IF;

      SELECT "previous_hash" INTO v_genesis_hash FROM "audit_events" WHERE "index" = 0;
      IF v_genesis_hash <> C_GENESIS_HASH THEN
        RAISE EXCEPTION 'AUDIT_CHAIN_INTEGRITY_VIOLATION: Index 0 previous_hash is not genesis hash (found: %)', v_genesis_hash;
      END IF;

      SELECT "index", "event_hash" INTO v_last_index, v_last_hash
      FROM "audit_events"
      ORDER BY "index" DESC
      LIMIT 1;

      INSERT INTO "audit_chain_heads" ("chain_id", "last_event_index", "last_event_hash", "updated_at")
      VALUES ('main', v_last_index, v_last_hash, now());
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 2. Consultation Snapshots Table (Append-Only Recovery Checkpoints)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "consultation_snapshots" (
  "id" varchar(128) PRIMARY KEY,
  "consultation_id" varchar(128) NOT NULL REFERENCES "consultations"("id") ON DELETE RESTRICT,
  "case_version" integer NOT NULL,
  "snapshot_schema_version" integer NOT NULL DEFAULT 2,
  "trigger_reason" varchar(64) NOT NULL,
  "interview_state" jsonb NOT NULL,
  "transcript_turn_count" integer NOT NULL,
  "transcript_hash_boundary" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "idx_consultation_snapshot_case_version_unique" UNIQUE ("consultation_id", "case_version")
);

CREATE INDEX IF NOT EXISTS "idx_snapshots_consultation_lookup"
ON "consultation_snapshots" ("consultation_id", "case_version" DESC);

-- Snapshot Immutability Trigger (Reject any UPDATE or DELETE)
CREATE OR REPLACE FUNCTION trg_enforce_consultation_snapshot_immutability()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'CONSULTATION_SNAPSHOT_IMMUTABLE: Snapshots are append-only recovery checkpoints and cannot be modified or deleted (Consultation: %, CaseVersion: %)',
    OLD.consultation_id, OLD.case_version;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_consultation_snapshots_immutability ON "consultation_snapshots";
CREATE TRIGGER trg_consultation_snapshots_immutability
BEFORE UPDATE OR DELETE ON "consultation_snapshots"
FOR EACH ROW EXECUTE FUNCTION trg_enforce_consultation_snapshot_immutability();

-- ============================================================================
-- 3. Clinical Artifacts Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "clinical_artifacts" (
  "id" varchar(128) PRIMARY KEY,
  "consultation_id" varchar(128) NOT NULL REFERENCES "consultations"("id") ON DELETE RESTRICT,
  "artifact_type" varchar(64) NOT NULL DEFAULT 'soap_note',
  "version" integer NOT NULL DEFAULT 1,
  "status" varchar(32) NOT NULL DEFAULT 'draft',

  -- Clinical Content
  "chief_complaint" text NOT NULL,
  "soap_subjective" text NOT NULL,
  "soap_objective" text NOT NULL,
  "soap_assessment" text NOT NULL,
  "soap_plan" text NOT NULL,
  "icd10_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "esi_score" integer,

  -- Integrity & Attestation
  "payload_sha256" varchar(64),
  "signed_by" varchar(128),
  "signed_by_role" varchar(64),
  "signed_at" timestamp with time zone,
  "signing_attestation_digest" varchar(64),

  -- Amendment Lineage
  "amends_artifact_id" varchar(128),
  "amendment_reason" text,

  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "idx_clinical_artifacts_id_consultation" UNIQUE ("id", "consultation_id"),
  CONSTRAINT "idx_clinical_artifacts_composite_identity" UNIQUE ("id", "consultation_id", "artifact_type"),
  CONSTRAINT "chk_clinical_artifacts_status" CHECK (status IN ('draft', 'pending_review', 'signed', 'cancelled')),
  CONSTRAINT "chk_clinical_artifacts_type" CHECK (artifact_type = 'soap_note'),
  CONSTRAINT "chk_signed_artifact_metadata_complete" CHECK (
    status != 'signed' OR (
      signed_by IS NOT NULL AND
      signed_by_role IS NOT NULL AND
      signed_at IS NOT NULL AND
      payload_sha256 IS NOT NULL AND
      signing_attestation_digest IS NOT NULL
    )
  ),
  CONSTRAINT "chk_draft_unsealed" CHECK (status != 'draft' OR (signed_at IS NULL AND signing_attestation_digest IS NULL)),
  CONSTRAINT "chk_digest_lengths" CHECK (
    (payload_sha256 IS NULL OR (length(payload_sha256) = 64 AND payload_sha256 ~ '^[0-9a-f]{64}$')) AND
    (signing_attestation_digest IS NULL OR (length(signing_attestation_digest) = 64 AND signing_attestation_digest ~ '^[0-9a-f]{64}$'))
  )
);

-- Composite Foreign Key enforcing consultation & artifact-type ownership on amendments
DO $$ BEGIN
  ALTER TABLE "clinical_artifacts"
  ADD CONSTRAINT "fk_clinical_artifacts_amendment_lineage"
  FOREIGN KEY ("amends_artifact_id", "consultation_id", "artifact_type")
  REFERENCES "clinical_artifacts"("id", "consultation_id", "artifact_type")
  ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Partial unique index on ACTIVE version (cancelled drafts do not block active replacement versions)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_clinical_artifacts_active_version"
ON "clinical_artifacts" ("consultation_id", "artifact_type", "version")
WHERE "status" <> 'cancelled';

-- Partial unique index: Exactly one active successor per parent artifact
CREATE UNIQUE INDEX IF NOT EXISTS "idx_one_active_amendment_successor"
ON "clinical_artifacts" ("amends_artifact_id")
WHERE "status" IN ('draft', 'pending_review', 'signed') AND "amends_artifact_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_clinical_artifacts_lookup"
ON "clinical_artifacts" ("consultation_id", "artifact_type", "version" DESC);

-- Clinical Artifact Immutability Trigger
CREATE OR REPLACE FUNCTION trg_enforce_clinical_artifact_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'signed' THEN
      RAISE EXCEPTION 'CLINICAL_ARTIFACT_IMMUTABLE: Signed clinical artifacts cannot be deleted (ID: %, Version: %)', OLD.id, OLD.version;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'signed' THEN
      RAISE EXCEPTION 'CLINICAL_ARTIFACT_IMMUTABLE: Signed clinical artifacts cannot be modified (ID: %, Version: %)', OLD.id, OLD.version;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clinical_artifacts_immutability ON "clinical_artifacts";
CREATE TRIGGER trg_clinical_artifacts_immutability
BEFORE UPDATE OR DELETE ON "clinical_artifacts"
FOR EACH ROW EXECUTE FUNCTION trg_enforce_clinical_artifact_immutability();

-- ============================================================================
-- 4. Durable Signing Idempotency Keys Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS "signing_idempotency_keys" (
  "idempotency_key" varchar(128) NOT NULL,
  "consultation_id" varchar(128) NOT NULL REFERENCES "consultations"("id") ON DELETE RESTRICT,
  "artifact_id" varchar(128) NOT NULL,
  "actor_id" varchar(128) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "result_artifact_id" varchar(128) NOT NULL REFERENCES "clinical_artifacts"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pk_signing_idempotency_keys" PRIMARY KEY ("consultation_id", "artifact_id", "actor_id", "idempotency_key"),
  CONSTRAINT "fk_signing_idempotency_artifact_consultation" FOREIGN KEY ("artifact_id", "consultation_id")
    REFERENCES "clinical_artifacts"("id", "consultation_id") ON DELETE RESTRICT,
  CONSTRAINT "chk_request_hash_sha256" CHECK (length(request_hash) = 64 AND request_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS "idx_signing_idempotency_lookup"
ON "signing_idempotency_keys" ("consultation_id", "artifact_id", "actor_id", "idempotency_key");
