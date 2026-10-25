-- Migration: 0003_add_turn_idempotency_keys.sql
-- Description: Add turn_idempotency_keys ledger table and commit_consultation_turn coordination function.

-- 1. Create turn_idempotency_keys table
CREATE TABLE IF NOT EXISTS "turn_idempotency_keys" (
  "id" VARCHAR(128) PRIMARY KEY,
  "user_id" VARCHAR(128) NOT NULL,
  "encounter_id" VARCHAR(128) NOT NULL,
  "turn_id" VARCHAR(128) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "lease_expires_at" TIMESTAMP NOT NULL,
  "claim_generation" INTEGER NOT NULL DEFAULT 1,
  "case_version" INTEGER,
  "response_payload" JSONB,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2. Create unique index on (user_id, encounter_id, turn_id)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_turn_idempotency_scope_unique"
ON "turn_idempotency_keys" ("user_id", "encounter_id", "turn_id");

-- 3. Create atomic commit_consultation_turn stored function
CREATE OR REPLACE FUNCTION commit_consultation_turn(
  p_user_id VARCHAR,
  p_encounter_id VARCHAR,
  p_turn_id VARCHAR,
  p_claim_generation INTEGER,
  p_expected_case_version INTEGER,
  p_next_case_version INTEGER,
  p_interview_state JSONB,
  p_delivered_turn_records JSONB,
  p_attributed_facts JSONB,
  p_unmapped_observations JSONB,
  p_response_payload JSONB
) RETURNS JSONB AS $$
DECLARE
  v_locked_turn_id VARCHAR;
  v_updated_consultation_id VARCHAR;
BEGIN
  -- Phase 1: Lock idempotency row and verify claim generation & pending status
  SELECT turn_id INTO v_locked_turn_id
  FROM turn_idempotency_keys
  WHERE user_id = p_user_id
    AND encounter_id = p_encounter_id
    AND turn_id = p_turn_id
    AND claim_generation = p_claim_generation
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FENCING_CONFLICT',
      'message', 'Claim generation is stale or turn is not in pending status.'
    );
  END IF;

  -- Phase 2: Execute consultation CAS update
  UPDATE consultations
  SET interview_state = p_interview_state,
      delivered_turn_records = p_delivered_turn_records,
      attributed_facts = p_attributed_facts,
      unmapped_observations = p_unmapped_observations,
      case_version = p_next_case_version
  WHERE id = p_encounter_id
    AND case_version = p_expected_case_version
    AND (user_id = p_user_id OR p_user_id = 'anon-user')
  RETURNING id INTO v_updated_consultation_id;

  IF NOT FOUND THEN
    -- Case version mismatch: mark idempotency row as 'conflict' so it does not remain pending
    UPDATE turn_idempotency_keys
    SET status = 'conflict',
        updated_at = NOW()
    WHERE user_id = p_user_id
      AND encounter_id = p_encounter_id
      AND turn_id = p_turn_id;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'CONCURRENT_MODIFICATION_CONFLICT',
      'message', 'Encounter caseVersion mismatch. State was modified concurrently.'
    );
  END IF;

  -- Phase 3: Mark idempotency completed with response payload
  UPDATE turn_idempotency_keys
  SET status = 'completed',
      case_version = p_next_case_version,
      response_payload = p_response_payload,
      updated_at = NOW()
  WHERE user_id = p_user_id
    AND encounter_id = p_encounter_id
    AND turn_id = p_turn_id;

  RETURN jsonb_build_object(
    'success', true,
    'caseVersion', p_next_case_version
  );
END;
$$ LANGUAGE plpgsql;
