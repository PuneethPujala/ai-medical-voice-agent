-- Migration 0007: Add Care Suggestions Table
-- Persists structured evidence-based care suggestions derived from SOAP report + transcript or transcript fallback.

CREATE TABLE IF NOT EXISTS "care_suggestions" (
  "id" varchar(128) PRIMARY KEY,
  "consultation_id" varchar(128) NOT NULL REFERENCES "consultations"("id") ON DELETE CASCADE,
  "soap_artifact_id" varchar(128),
  "user_id" varchar(128),
  "source" varchar(64) NOT NULL,
  "source_display" varchar(128) DEFAULT 'SOAP Report + Consultation Chat' NOT NULL,
  "status" varchar(32) DEFAULT 'completed' NOT NULL,
  "review_status" varchar(64) DEFAULT 'pending_clinician_review' NOT NULL,
  "clinical_summary" text NOT NULL,
  "suggestions" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_care_suggestions_consultation_id" ON "care_suggestions" ("consultation_id");
CREATE INDEX IF NOT EXISTS "idx_care_suggestions_user_id" ON "care_suggestions" ("user_id");
