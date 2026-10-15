-- Migration: 0001_add_consultation_durable_state.sql
-- Description: Add server-authoritative durable encounter state and optimistic concurrency columns to consultations table.
-- Backward Compatibility: All columns are nullable or have safe defaults (case_version default 1), ensuring 100% compatibility with existing records.

ALTER TABLE "consultations"
  ADD COLUMN IF NOT EXISTS "interview_state" jsonb,
  ADD COLUMN IF NOT EXISTS "delivered_turn_records" jsonb,
  ADD COLUMN IF NOT EXISTS "attributed_facts" jsonb,
  ADD COLUMN IF NOT EXISTS "unmapped_observations" jsonb,
  ADD COLUMN IF NOT EXISTS "case_version" integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(128);

-- Backfill case_version for any legacy rows that were created before version tracking
UPDATE "consultations"
SET "case_version" = 1
WHERE "case_version" IS NULL;

-- High-performance query indexes for optimistic concurrency checks and tenant lookup
CREATE INDEX IF NOT EXISTS "idx_consultations_idempotency_key" ON "consultations"("idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_consultations_case_version" ON "consultations"("case_version");
CREATE INDEX IF NOT EXISTS "idx_consultations_user_id" ON "consultations"("user_id");
