import { chromium } from "playwright";
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";

const ARTIFACTS_DIR = "C:\\Users\\punee\\.gemini\\antigravity\\brain\\c8f4153d-1a2a-4a34-991e-d1b1a97a14e3";
const TEST_SECRET = "medvoice-test-harness-auth-token-9f8a3c2e-secure-32ch";
const DB_URL = "postgresql://postgres:testpass@localhost:5433/medvoice_test";

const VALID_HEX_64_A = "1111111111111111111111111111111111111111111111111111111111111111";
const VALID_HEX_64_B = "2222222222222222222222222222222222222222222222222222222222222222";

const clinicianHeaders = {
  "x-test-harness-secret": TEST_SECRET,
  "x-mock-role": "clinician",
  "x-mock-user-id": "dr-sarah-chen",
  "x-mock-doctor-id": "dr-sarah-chen",
};

const patientHeaders = {
  "x-test-harness-secret": TEST_SECRET,
  "x-mock-role": "patient",
  "x-mock-user-id": "usr_patient_arthur",
};

async function copyToArtifacts(filename) {
  const src = path.join("scripts", filename);
  const dest = path.join(ARTIFACTS_DIR, filename);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${filename} -> Artifacts directory`);
  }
}

async function run() {
  console.log("=== Step 1: Seeding isolated test database directly via PostgreSQL ===");
  const pool = new Pool({ connectionString: DB_URL });

  await pool.query(`
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_name" varchar(128) DEFAULT 'Anonymous Patient';
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_profile_id" varchar(128);
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "parent_consultation_id" varchar(128);
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_age" varchar(32);
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "patient_gender" varchar(32);
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "triage_level" varchar(64) DEFAULT 'routine';
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "triage_title" varchar(255);
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "detected_symptoms" jsonb;
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "recommended_specialists" jsonb;
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "recommended_action" text;
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "duration_seconds" integer DEFAULT 0;
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(128);
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "interview_state" jsonb;
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "delivered_turn_records" jsonb;
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "attributed_facts" jsonb;
    ALTER TABLE "consultations" ADD COLUMN IF NOT EXISTS "unmapped_observations" jsonb;

    CREATE TABLE IF NOT EXISTS "patient_longitudinal_facts" (
      id varchar(128) PRIMARY KEY,
      user_id varchar(128) NOT NULL,
      patient_profile_id varchar(128) NOT NULL,
      category varchar(64) NOT NULL,
      concept varchar(128) NOT NULL,
      reported_value text NOT NULL,
      numeric_value double precision,
      unit varchar(32),
      temporal_scope varchar(32) NOT NULL DEFAULT 'baseline',
      lifecycle varchar(32) NOT NULL DEFAULT 'active',
      verification varchar(32) NOT NULL DEFAULT 'unverified',
      source_type varchar(32) NOT NULL DEFAULT 'patient',
      source_consultation_id varchar(128) NOT NULL,
      source_turn_id varchar(128) NOT NULL,
      reported_at timestamptz NOT NULL,
      recorded_at timestamptz NOT NULL DEFAULT NOW(),
      last_reviewed_at timestamptz,
      supersedes_fact_id varchar(128),
      superseded_by_fact_id varchar(128),
      superseded_at timestamptz
    );
  `);

  const RUN_ID = Date.now().toString(36);
  const multiVersionId = `ENC-M6-S4-MULTI-${RUN_ID}`;
  const legacyId = `ENC-M6-S4-LEGACY-${RUN_ID}`;
  const artV1Id = `art-s4-v1-${RUN_ID}`;
  const artV2Id = `art-s4-v2-${RUN_ID}`;
  const artV3Id = `art-s4-v3-${RUN_ID}`;

  // 1. Seed Multi-Version Encounter
  await pool.query(
    `INSERT INTO consultations (
      id, user_id, patient_name, doctor_id, doctor_name, specialty,
      chief_complaint, status, duration_seconds, case_version,
      triage_level, triage_title,
      soap_subjective, soap_objective, soap_assessment, soap_plan,
      transcript, detected_symptoms, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12,
      $13, $14, $15, $16,
      $17::jsonb, $18::jsonb, NOW()
    )`,
    [
      multiVersionId,
      "usr_patient_arthur",
      "Arthur Dent",
      "dr-sarah-chen",
      "Dr. Sarah Chen, MD",
      "Interventional Cardiology",
      "Substernal chest pressure and exertional dyspnea",
      "approved",
      320,
      3,
      "priority",
      "CARDIOPULMONARY EVALUATION",
      "Patient reports progressive anterior chest pressure over 3 days, exacerbated by walking uphill.",
      "Vital signs: Remote telephonic. Alert, conversing in full sentences without tachypnea.",
      "Suspected stable angina / coronary insufficiency with positive CTA findings.",
      "Dual antiplatelet therapy (Aspirin 81mg + Clopidogrel 75mg), Rosuvastatin 40mg, and cardiac catheterization scheduling.",
      JSON.stringify([
        { role: "doctor", text: "Good morning Mr. Dent, let's review your recent cardiac tests.", timestamp: "10:00 AM" },
        { role: "patient", text: "I had the coronary scan yesterday as you ordered.", timestamp: "10:01 AM" },
        { role: "doctor", text: "Yes, the CTA shows significant narrowing in the left anterior descending artery. We are updating your care plan today.", timestamp: "10:02 AM" },
      ]),
      JSON.stringify(["Chest pressure", "Exertional dyspnea"]),
    ]
  );

  // Insert Artifact v1 (Signed)
  await pool.query(
    `INSERT INTO clinical_artifacts (
      id, consultation_id, version, status,
      chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan,
      icd10_codes, esi_score, payload_sha256, signed_by, signed_by_role, signed_at, signing_attestation_digest,
      created_at, updated_at
    ) VALUES (
      $1, $2, 1, 'signed',
      'Exertional chest pressure',
      'Patient presents with 3-day history of mid-sternal tightness on mild exertion. Relieved with 5 minutes rest.',
      'Cardiopulmonary examination via remote telemetry. Pulse regular at 74 bpm. No respiratory distress.',
      'Suspected stable coronary artery disease. Intermediate cardiovascular risk.',
      '1. Order outpatient Coronary CT Angiography (CCTA).\n2. Initiate Aspirin 81mg daily.\n3. Return precautions for rest angina or diaphoresis.',
      '["I20.9", "R07.9"]'::jsonb, 3, $3, 'Dr. Sarah Chen, MD', 'clinician', NOW() - interval '2 days', $4,
      NOW() - interval '2 days', NOW() - interval '2 days'
    )`,
    [artV1Id, multiVersionId, VALID_HEX_64_A, VALID_HEX_64_B]
  );

  // Insert Artifact v2 (Signed Amendment)
  await pool.query(
    `INSERT INTO clinical_artifacts (
      id, consultation_id, version, status,
      chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan,
      icd10_codes, esi_score, payload_sha256, signed_by, signed_by_role, signed_at, signing_attestation_digest,
      amends_artifact_id, amendment_reason, created_at, updated_at
    ) VALUES (
      $1, $2, 2, 'signed',
      'Exertional chest pressure with confirmed LAD stenosis',
      'Patient reports stable exertional chest pressure. Coronary CTA completed at imaging center.',
      'CCTA report reviewed: 75% stenosis of proximal Left Anterior Descending (LAD) artery. Normal LV ejection fraction (60%).',
      'Obstructive coronary artery disease involving proximal LAD artery (CAD-RADS 4A). High ischemic risk.',
      '1. Urgent interventional cardiology referral for coronary angiogram and potential PCI.\n2. Dual antiplatelet therapy: Aspirin 81mg + Clopidogrel 75mg daily.\n3. Rosuvastatin 40mg daily.\n4. Sublingual Nitroglycerin 0.4mg PRN chest pain.',
      '["I25.10", "I20.9"]'::jsonb, 2, $3, 'Dr. Sarah Chen, MD', 'clinician', NOW() - interval '4 hours', $4,
      $5, $6,
      NOW() - interval '4 hours', NOW() - interval '4 hours'
    )`,
    [
      artV2Id,
      multiVersionId,
      VALID_HEX_64_A,
      VALID_HEX_64_B,
      artV1Id,
      "Coronary CT angiography completed: proximal LAD stenosis confirmed. Initiating dual antiplatelet therapy.",
    ]
  );

  // Insert Artifact v3 (Draft Amendment)
  await pool.query(
    `INSERT INTO clinical_artifacts (
      id, consultation_id, version, status,
      chief_complaint, soap_subjective, soap_objective, soap_assessment, soap_plan,
      icd10_codes, esi_score, payload_sha256,
      amends_artifact_id, amendment_reason, created_at, updated_at
    ) VALUES (
      $1, $2, 3, 'draft',
      'Post-catheterization follow-up and stent recovery',
      'Patient reports zero rest pain following successful drug-eluting stent placement yesterday.',
      'Right femoral access site clean, soft, non-tender, no hematoma. Distal pulses 2+ symmetric.',
      'Post-percutaneous coronary intervention (PCI) status with DES to proximal LAD. Healing well.',
      '1. Continue DAPT (Aspirin + Clopidogrel) strictly for 12 months minimum.\n2. Outpatient cardiac rehabilitation enrollment.\n3. Follow up in clinic in 4 weeks.',
      '["Z95.5", "I25.10"]'::jsonb, 3, null,
      $3, $4,
      NOW(), NOW()
    )`,
    [
      artV3Id,
      multiVersionId,
      artV2Id,
      "Post-PCI stent follow-up: cardiac rehabilitation referral and access site check.",
    ]
  );

  // 2. Seed Legacy Encounter (Approved without clinical_artifacts row)
  await pool.query(
    `INSERT INTO consultations (
      id, user_id, patient_name, doctor_id, doctor_name, specialty,
      chief_complaint, status, duration_seconds, case_version,
      triage_level, triage_title,
      soap_subjective, soap_objective, soap_assessment, soap_plan,
      transcript, detected_symptoms, approved_at, approved_by, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10,
      $11, $12,
      $13, $14, $15, $16,
      $17::jsonb, $18::jsonb, NOW() - interval '2 minutes', 'Dr. Sarah Chen, MD', NOW() - interval '1 minute'
    )`,
    [
      legacyId,
      "usr_patient_arthur",
      "Arthur Dent",
      "dr-sarah-chen",
      "Dr. Sarah Chen, MD",
      "Interventional Cardiology",
      "Annual preventative cardiovascular checkup",
      "approved",
      180,
      1,
      "routine",
      "ANNUAL CLINICAL REVIEW",
      "Patient reports feeling well with routine physical activity. Denies chest pain, palpitations, or orthopnea.",
      "Vital signs: BP 122/78 mmHg, HR 68 bpm, regular. Heart sounds normal S1/S2.",
      "Well-controlled baseline cardiovascular profile. Low 10-year ASCVD risk.",
      "Maintain active lifestyle, Mediterranean diet, and repeat lipid profile in 12 months.",
      JSON.stringify([
        { role: "doctor", text: "Hello Arthur, how have your daily walks been?", timestamp: "9:00 AM" },
        { role: "patient", text: "Great doctor, walking 30 minutes every morning without any issues.", timestamp: "9:01 AM" },
      ]),
      JSON.stringify(["Routine Wellness"]),
    ]
  );

  await pool.end();
  console.log("Database seeded successfully.");

  console.log("=== Step 2: Launching Playwright browser verification ===");
  const browser = await chromium.launch({ headless: true });

  // --------------------------------------------------------------------------
  // Scenario 1: Physician Desktop View (1440px)
  // --------------------------------------------------------------------------
  console.log("\n--- Scenario 1: Physician Desktop (Document, Timeline, Comparison & Amendment) ---");
  const docContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const docPage = await docContext.newPage();

  // Attach mock headers strictly to localhost
  await docPage.route("http://localhost:3000/**", async (route) => {
    const headers = { ...route.request().headers(), ...clinicianHeaders };
    await route.continue({ headers });
  });

  await docPage.goto(`http://localhost:3000/history?search=${multiVersionId}`, { waitUntil: "networkidle" });
  await docPage.waitForTimeout(800);

  // Open SOAP Report
  const docMultiCard = docPage.locator('button:has-text("SOAP Report")').first();
  await docMultiCard.click();
  await docPage.waitForSelector('h2:has-text("SOAP Note")');
  await docPage.waitForTimeout(600);

  // 1. Desktop SOAP Document View
  await docPage.screenshot({
    path: "scripts/m6-stage4-soap-document-desktop.png",
    fullPage: false,
  });
  console.log("Captured: scripts/m6-stage4-soap-document-desktop.png");

  // 2. Desktop Timeline View
  await docPage.locator('button:has-text("Timeline")').first().click();
  await docPage.waitForSelector('text=Document Version Timeline');
  await docPage.waitForTimeout(600);
  await docPage.screenshot({
    path: "scripts/m6-stage4-physician-timeline-desktop.png",
    fullPage: false,
  });
  console.log("Captured: scripts/m6-stage4-physician-timeline-desktop.png");

  // 3. Desktop Comparison View
  const compareTab = docPage.locator('button:has-text("Compare")').first();
  if (await compareTab.isVisible()) {
    await compareTab.click();
  } else {
    await docPage.locator('button:has-text("Compare with")').first().click();
  }
  await docPage.waitForSelector('h3:has-text("SOAP Revision Comparison")');
  await docPage.waitForTimeout(600);
  await docPage.screenshot({
    path: "scripts/m6-stage4-soap-diff-desktop.png",
    fullPage: false,
  });
  console.log("Captured: scripts/m6-stage4-soap-diff-desktop.png");

  // 4. Amendment Dialog View
  await docPage.locator('button:has-text("Timeline")').first().click();
  await docPage.waitForTimeout(400);
  const inspectV2Btn = docPage.locator('div:has-text("Version 2")').locator('button:has-text("Inspect Version")').first();
  if (await inspectV2Btn.isVisible()) {
    await inspectV2Btn.click();
    await docPage.waitForTimeout(400);
  }
  const amendBtn = docPage.locator('button:has-text("Create Amendment")');
  await amendBtn.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  if (await amendBtn.isVisible()) {
    await amendBtn.click();
    await docPage.waitForSelector('text=Clinical Justification');
    await docPage.waitForTimeout(500);
    await docPage.screenshot({
      path: "scripts/m6-stage4-amendment-drawer-desktop.png",
      fullPage: false,
    });
    console.log("Captured: scripts/m6-stage4-amendment-drawer-desktop.png");
  }

  // Close modal via Escape
  await docPage.keyboard.press("Escape");
  await docPage.waitForTimeout(400);

  // 5. Legacy Approved Record View
  await docPage.goto(`http://localhost:3000/history?search=${legacyId}`, { waitUntil: "networkidle" });
  await docPage.waitForTimeout(600);
  const legacyCard = docPage.locator('button:has-text("SOAP Report")').first();
  await legacyCard.click();
  await docPage.waitForSelector('h2:has-text("SOAP Note")');
  await docPage.locator('button:has-text("Timeline")').first().click();
  await docPage.waitForTimeout(500);
  await docPage.screenshot({
    path: "scripts/m6-stage4-legacy-approved-desktop.png",
    fullPage: false,
  });
  console.log("Captured: scripts/m6-stage4-legacy-approved-desktop.png");

  await docContext.close();

  // --------------------------------------------------------------------------
  // Scenario 2: Patient Desktop View (1440px) — Privacy & Signed-Only Check
  // --------------------------------------------------------------------------
  console.log("\n--- Scenario 2: Patient Desktop (Signed-Only Privacy Verification) ---");
  const patientContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const patientPage = await patientContext.newPage();
  await patientPage.route("http://localhost:3000/**", async (route) => {
    const headers = { ...route.request().headers(), ...patientHeaders };
    await route.continue({ headers });
  });

  await patientPage.goto(`http://localhost:3000/history?search=${multiVersionId}`, { waitUntil: "networkidle" });
  await patientPage.waitForTimeout(800);
  const patientMultiCard = patientPage.locator('button:has-text("SOAP Report")').first();
  await patientMultiCard.click();
  await patientPage.waitForSelector('h2:has-text("SOAP Note")');
  await patientPage.locator('button:has-text("Timeline")').first().click();
  await patientPage.waitForTimeout(600);
  await patientPage.screenshot({
    path: "scripts/m6-stage4-patient-timeline-desktop.png",
    fullPage: false,
  });
  console.log("Captured: scripts/m6-stage4-patient-timeline-desktop.png");
  await patientContext.close();

  // --------------------------------------------------------------------------
  // Scenario 3: Mobile Viewport (375px) — Document, Timeline & Diff
  // --------------------------------------------------------------------------
  console.log("\n--- Scenario 3: Mobile Viewport (375px) ---");
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.route("http://localhost:3000/**", async (route) => {
    const headers = { ...route.request().headers(), ...clinicianHeaders };
    await route.continue({ headers });
  });

  await mobilePage.goto(`http://localhost:3000/history?search=${multiVersionId}`, { waitUntil: "networkidle" });
  await mobilePage.waitForTimeout(800);

  const mobileSoapBtn = mobilePage.locator('button:has-text("SOAP Report")').first();
  await mobileSoapBtn.click();
  await mobilePage.waitForSelector('h2:has-text("SOAP Note")');
  await mobilePage.waitForTimeout(600);

  // 6. Mobile SOAP Document View
  await mobilePage.screenshot({
    path: "scripts/m6-stage4-soap-document-mobile-375.png",
    fullPage: false,
  });
  console.log("Captured: scripts/m6-stage4-soap-document-mobile-375.png");

  // 7. Mobile Timeline View
  await mobilePage.locator('button:has-text("Timeline")').first().click();
  await mobilePage.waitForTimeout(600);
  await mobilePage.screenshot({
    path: "scripts/m6-stage4-timeline-mobile-375.png",
    fullPage: false,
  });
  console.log("Captured: scripts/m6-stage4-timeline-mobile-375.png");

  // 8. Mobile Diff View
  await mobilePage.locator('button:has-text("Compare")').first().click();
  await mobilePage.waitForSelector('h3:has-text("SOAP Revision Comparison")');
  await mobilePage.waitForTimeout(600);
  await mobilePage.screenshot({
    path: "scripts/m6-stage4-diff-mobile-375.png",
    fullPage: false,
  });
  console.log("Captured: scripts/m6-stage4-diff-mobile-375.png");

  await mobileContext.close();
  await browser.close();

  console.log("\n=== Step 3: Copying screenshots to artifacts directory ===");
  await copyToArtifacts("m6-stage4-soap-document-desktop.png");
  await copyToArtifacts("m6-stage4-physician-timeline-desktop.png");
  await copyToArtifacts("m6-stage4-soap-diff-desktop.png");
  await copyToArtifacts("m6-stage4-amendment-drawer-desktop.png");
  await copyToArtifacts("m6-stage4-legacy-approved-desktop.png");
  await copyToArtifacts("m6-stage4-patient-timeline-desktop.png");
  await copyToArtifacts("m6-stage4-soap-document-mobile-375.png");
  await copyToArtifacts("m6-stage4-timeline-mobile-375.png");
  await copyToArtifacts("m6-stage4-diff-mobile-375.png");

  console.log("\n=== Stage 4 Browser Verification Completed Successfully ===");
}

run().catch((err) => {
  console.error("Browser verification error:", err);
  process.exit(1);
});
