-- ==============================================================================
-- Function: record_or_supersede_patient_longitudinal_fact
-- Atomically writes a new longitudinal patient observation or supersedes an
-- existing baseline for the authorized user and profile.
-- ==============================================================================

CREATE OR REPLACE FUNCTION record_or_supersede_patient_longitudinal_fact(
  p_id VARCHAR(128),
  p_user_id VARCHAR(128),
  p_patient_profile_id VARCHAR(128),
  p_category VARCHAR(64),
  p_concept VARCHAR(128),
  p_reported_value TEXT,
  p_numeric_value DOUBLE PRECISION,
  p_unit VARCHAR(32),
  p_temporal_scope VARCHAR(32),
  p_verification VARCHAR(32),
  p_source_type VARCHAR(32),
  p_source_consultation_id VARCHAR(128),
  p_source_turn_id VARCHAR(128),
  p_reported_at TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE (
  id VARCHAR(128),
  user_id VARCHAR(128),
  patient_profile_id VARCHAR(128),
  category VARCHAR(64),
  concept VARCHAR(128),
  reported_value TEXT,
  numeric_value DOUBLE PRECISION,
  unit VARCHAR(32),
  temporal_scope VARCHAR(32),
  lifecycle VARCHAR(32),
  verification VARCHAR(32),
  source_type VARCHAR(32),
  source_consultation_id VARCHAR(128),
  source_turn_id VARCHAR(128),
  reported_at TIMESTAMP WITH TIME ZONE,
  recorded_at TIMESTAMP WITH TIME ZONE,
  last_reviewed_at TIMESTAMP WITH TIME ZONE,
  supersedes_fact_id VARCHAR(128),
  superseded_by_fact_id VARCHAR(128),
  superseded_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_consent_given BOOLEAN;
  v_existing_id VARCHAR(128);
  v_superseded_id VARCHAR(128) := NULL;
  v_now TIMESTAMP WITH TIME ZONE := NOW();
BEGIN
  -- 1. Verify Profile Ownership & Consent
  SELECT consent_given INTO v_consent_given
  FROM patient_profiles
  WHERE patient_profiles.id = p_patient_profile_id
    AND patient_profiles.user_id = p_user_id
    AND patient_profiles.is_deleted = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile % not found for authorized user %', p_patient_profile_id, p_user_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_consent_given THEN
    RAISE EXCEPTION 'Longitudinal patient operations require affirmative consent'
      USING ERRCODE = '55000';
  END IF;

  -- 2. Advisory Transaction Lock (Serializes baseline mutations per profile + concept)
  IF p_temporal_scope = 'baseline' THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_patient_profile_id || ':' || p_concept));
  END IF;

  -- 3. Idempotency Check: (patient_profile_id, source_consultation_id, source_turn_id, concept)
  SELECT plf.id INTO v_existing_id
  FROM patient_longitudinal_facts plf
  WHERE plf.patient_profile_id = p_patient_profile_id
    AND plf.source_consultation_id = p_source_consultation_id
    AND plf.source_turn_id = p_source_turn_id
    AND plf.concept = p_concept;

  IF FOUND THEN
    RETURN QUERY
    SELECT plf.id, plf.user_id, plf.patient_profile_id, plf.category, plf.concept,
           plf.reported_value, plf.numeric_value, plf.unit, plf.temporal_scope,
           plf.lifecycle, plf.verification, plf.source_type, plf.source_consultation_id,
           plf.source_turn_id, plf.reported_at, plf.recorded_at, plf.last_reviewed_at,
           plf.supersedes_fact_id, plf.superseded_by_fact_id, plf.superseded_at
    FROM patient_longitudinal_facts plf
    WHERE plf.id = v_existing_id;
    RETURN;
  END IF;

  -- 4. If Baseline: find and lock previous active baseline to supersede
  IF p_temporal_scope = 'baseline' THEN
    SELECT plf.id INTO v_superseded_id
    FROM patient_longitudinal_facts plf
    WHERE plf.patient_profile_id = p_patient_profile_id
      AND plf.user_id = p_user_id
      AND plf.concept = p_concept
      AND plf.temporal_scope = 'baseline'
      AND plf.lifecycle = 'active'
    FOR UPDATE;

    IF FOUND THEN
      UPDATE patient_longitudinal_facts
      SET lifecycle = 'superseded',
          superseded_by_fact_id = p_id,
          superseded_at = v_now
      WHERE patient_longitudinal_facts.id = v_superseded_id;
    END IF;
  END IF;

  -- 5. Insert new fact
  INSERT INTO patient_longitudinal_facts (
    id, user_id, patient_profile_id, category, concept,
    reported_value, numeric_value, unit, temporal_scope,
    lifecycle, verification, source_type, source_consultation_id,
    source_turn_id, reported_at, recorded_at, supersedes_fact_id
  ) VALUES (
    p_id, p_user_id, p_patient_profile_id, p_category, p_concept,
    p_reported_value, p_numeric_value, p_unit, p_temporal_scope,
    'active', COALESCE(p_verification, 'unverified'), COALESCE(p_source_type, 'patient'),
    p_source_consultation_id, p_source_turn_id, p_reported_at, v_now, v_superseded_id
  );

  -- 6. Return inserted row
  RETURN QUERY
  SELECT plf.id, plf.user_id, plf.patient_profile_id, plf.category, plf.concept,
         plf.reported_value, plf.numeric_value, plf.unit, plf.temporal_scope,
         plf.lifecycle, plf.verification, plf.source_type, plf.source_consultation_id,
         plf.source_turn_id, plf.reported_at, plf.recorded_at, plf.last_reviewed_at,
         plf.supersedes_fact_id, plf.superseded_by_fact_id, plf.superseded_at
  FROM patient_longitudinal_facts plf
  WHERE plf.id = p_id;
END;
$$ LANGUAGE plpgsql;
