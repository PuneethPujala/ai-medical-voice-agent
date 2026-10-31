-- Migration 0004: Keyset Pagination Composite Index
-- Optimizes keyset-based cursor traversal for consultation history: WHERE user_id = $1 ORDER BY created_at DESC, id DESC

CREATE INDEX IF NOT EXISTS "idx_consultations_user_created_at_id" 
ON "consultations" ("user_id", "created_at" DESC, "id" DESC);
