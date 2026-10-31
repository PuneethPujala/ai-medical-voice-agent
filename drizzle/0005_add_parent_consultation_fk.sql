-- Migration 0005: Self-Referencing Foreign Key on parent_consultation_id
-- Ensures relational integrity for longitudinal follow-up consultations.
-- Note: Drafted for schema completeness; do not execute against production without maintenance window.

DO $$ BEGIN
  ALTER TABLE "consultations" 
  ADD CONSTRAINT "consultations_parent_consultation_id_consultations_id_fk" 
  FOREIGN KEY ("parent_consultation_id") 
  REFERENCES "consultations"("id") 
  ON DELETE set null 
  ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
