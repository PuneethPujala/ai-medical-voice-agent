-- ==============================================================================
-- Migration: 0004_longitudinal_patient_context
-- Purpose: Schema, indexes, and atomic function for Longitudinal Patient Context
-- ==============================================================================

-- 1. Add patient_profile_id to consultations table if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consultations' AND column_name = 'patient_profile_id'
  ) THEN
    ALTER TABLE consultations ADD COLUMN patient_profile_id VARCHAR(128);
    CREATE INDEX IF NOT EXISTS idx_consultations_patient_profile_id ON consultations(patient_profile_id);
  END IF;
END $$;

-- 2. Create patient_longitudinal_facts table
CREATE TABLE IF NOT EXISTS patient_longitudinal_facts (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  patient_profile_id VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  concept VARCHAR(128) NOT NULL,
  reported_value TEXT NOT NULL,
  numeric_value DOUBLE PRECISION,
  unit VARCHAR(32),
  temporal_scope VARCHAR(32) NOT NULL DEFAULT 'baseline',
  lifecycle VARCHAR(32) NOT NULL DEFAULT 'active',
  verification VARCHAR(32) NOT NULL DEFAULT 'unverified',
  source_type VARCHAR(32) NOT NULL DEFAULT 'patient',
  source_consultation_id VARCHAR(128) NOT NULL,
  source_turn_id VARCHAR(128) NOT NULL,
  reported_at TIMESTAMP WITH TIME ZONE NOT NULL,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_reviewed_at TIMESTAMP WITH TIME ZONE,
  supersedes_fact_id VARCHAR(128),
  superseded_by_fact_id VARCHAR(128),
  superseded_at TIMESTAMP WITH TIME ZONE
);

-- 3. Indexes for efficient lookup & idempotency
CREATE INDEX IF NOT EXISTS idx_longitudinal_facts_lookup
  ON patient_longitudinal_facts(user_id, patient_profile_id, concept, lifecycle);

CREATE UNIQUE INDEX IF NOT EXISTS idx_longitudinal_facts_idempotency_unique
  ON patient_longitudinal_facts(patient_profile_id, source_consultation_id, source_turn_id, concept);

-- 4. Atomic record-or-supersede function
\i migrations/record_or_supersede_patient_longitudinal_fact.sql
