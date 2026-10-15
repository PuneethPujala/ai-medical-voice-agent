-- Migration: 0002_add_unique_idempotency_key.sql
-- Description: Enforce database-level idempotency uniqueness per authenticated user scope.
-- Multiple null values are permitted for unkeyed/legacy consultations.

-- 1. Drop existing non-unique index on idempotency_key if present
DROP INDEX IF EXISTS "idx_consultations_idempotency_key";

-- 2. Create partial unique index on (user_id, idempotency_key) for all non-null keys
-- Ensures concurrent inserts with identical idempotency keys within the same tenant scope raise 23505
CREATE UNIQUE INDEX IF NOT EXISTS "idx_consultations_user_idempotency_unique" 
ON "consultations"("user_id", "idempotency_key") 
WHERE "idempotency_key" IS NOT NULL;
