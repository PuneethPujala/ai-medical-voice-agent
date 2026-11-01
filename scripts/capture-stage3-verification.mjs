import { chromium } from "playwright";
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";

const ARTIFACTS_DIR = "C:\\Users\\punee\\.gemini\\antigravity\\brain\\c8f4153d-1a2a-4a34-991e-d1b1a97a14e3";
const TEST_SECRET = "medvoice-test-harness-auth-token-9f8a3c2e-secure-32ch";
const DB_URL = "postgresql://postgres:testpass@localhost:5433/medvoice_test";

const clinicianHeaders = {
  "Content-Type": "application/json",
  "x-test-harness-secret": TEST_SECRET,
  "x-mock-role": "clinician",
  "x-mock-user-id": "dr-sarah-chen",
  "x-mock-doctor-id": "dr-sarah-chen",
};

const patientHeaders = {
  "Content-Type": "application/json",
  "x-test-harness-secret": TEST_SECRET,
  "x-mock-role": "patient",
  "x-mock-user-id": "user_patient_arthur",
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

  // Delete previous test encounters
  await pool.query("DELETE FROM clinical_artifacts WHERE consultation_id LIKE 'ENC-M6-%'");
  await pool.query("DELETE FROM consultations WHERE id LIKE 'ENC-M6-%'");

  const workflowEncounterId = `ENC-M6-FLOW-TEST`;
  const draftOnlyEncounterId = `ENC-M6-DRAFT-TEST`;

  // 1. Seed Encounter 1: Full review and signing workflow
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
      workflowEncounterId,
      "user_patient_arthur",
      "Arthur Dent",
      "dr-sarah-chen",
      "Dr. Sarah Chen, MD",
      "Interventional Cardiology",
      "Substernal chest pressure and dyspnea on exertion",
      "completed_pending_review",
      240,
      1,
      "priority",
      "CARDIOPULMONARY EVALUATION",
      "Patient reports progressive anterior chest pressure over 3 days, exacerbated by walking uphill.",
      "Remote voice evaluation. Speech alert, breathing rhythmic without audible stridor.",
      "Suspected stable angina / coronary insufficiency with exertion-related symptoms.",
      "Order emergent outpatient stress myocardial perfusion imaging, initiate Aspirin 81mg and sublingual Nitroglycerin PRN.",
      JSON.stringify([
        { role: "doctor", text: "Good morning Mr. Dent, please describe what you are feeling.", timestamp: "10:00 AM" },
        { role: "patient", text: "I have had tight pressure in the center of my chest when walking uphill.", timestamp: "10:01 AM" },
        { role: "doctor", text: "Any dizziness, nausea, or sweating with the discomfort?", timestamp: "10:02 AM" },
        { role: "patient", text: "Mild shortness of breath, but no radiating pain down my arm.", timestamp: "10:03 AM" },
      ]),
      JSON.stringify(["Chest pressure", "Dyspnea on exertion"]),
    ]
  );
  console.log(`Seeded workflow encounter: ${workflowEncounterId}`);

  // 2. Seed Encounter 2: Draft only (for patient blocking verification)
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
      $17::jsonb, $18::jsonb, NOW() - INTERVAL '1 hour'
    )`,
    [
      draftOnlyEncounterId,
      "user_patient_arthur",
      "Arthur Dent",
      "dr-sarah-chen",
      "Dr. Sarah Chen, MD",
      "General Medicine",
      "Seasonal rhinitis and nasal congestion",
      "completed_pending_review",
      120,
      1,
      "routine",
      "ROUTINE ALLERGY INTAKE",
      "Unsigned clinician draft: 4-day history of nasal congestion.",
      "Voice intake completed.",
      "Allergic rhinitis.",
      "Cetirizine 10mg daily.",
      JSON.stringify([
        { role: "doctor", text: "Hello Arthur, how can I assist with your allergy symptoms?", timestamp: "11:00 AM" },
        { role: "patient", text: "Sneezing and runny nose for the past 4 days.", timestamp: "11:01 AM" },
      ]),
      JSON.stringify(["Rhinitis", "Congestion"]),
    ]
  );
  console.log(`Seeded draft-only encounter: ${draftOnlyEncounterId}`);

  // Create an unsigned draft artifact on Encounter 2 via API
  const draftArtRes = await fetch(`http://localhost:3000/api/consultations/${draftOnlyEncounterId}/artifacts`, {
    method: "POST",
    headers: clinicianHeaders,
    body: JSON.stringify({
      chiefComplaint: "Seasonal rhinitis and nasal congestion",
      soapSubjective: "CONFIDENTIAL CLINICIAN DRAFT: patient reports 4-day history of seasonal allergic rhinitis.",
      soapObjective: "Remote voice evaluation. No acute respiratory distress.",
      soapAssessment: "Mild allergic rhinitis.",
      soapPlan: "Cetirizine 10mg PO daily PRN.",
    }),
  });
  console.log(`Created draft artifact on Encounter 2: ${draftArtRes.status}`);

  await pool.end();

  console.log("=== Step 2: Launching Playwright browser ===");
  const browser = await chromium.launch({ headless: true });

  // --------------------------------------------------------------------------
  // WORKFLOW A: Clinician Desktop (1440px)
  // --------------------------------------------------------------------------
  console.log("=== Step 3: Clinician Review & Signing Workflow (Desktop 1440px) ===");
  const docContext = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    extraHTTPHeaders: clinicianHeaders,
  });
  const docPage = await docContext.newPage();

  // Navigate to history
  await docPage.goto("http://localhost:3000/history", { waitUntil: "domcontentloaded" });
  await docPage.waitForTimeout(2000);

  // Click on the SOAP Report button for workflowEncounterId
  console.log(`Locating SOAP Report button for ${workflowEncounterId}...`);
  const encounterCard = docPage.locator(`div:has-text("${workflowEncounterId}")`).filter({ has: docPage.locator('button:has-text("SOAP Report")') }).last();
  const soapBtn = encounterCard.locator('button:has-text("SOAP Report")');
  await soapBtn.click();
  await docPage.waitForTimeout(2000);

  // Capture View 1: Initial Draft View
  console.log("Capturing View 1: Clinician Draft View...");
  const saveDraftBtn = docPage.locator('button:has-text("Save Draft")').first();
  await saveDraftBtn.click();
  await docPage.waitForTimeout(1000);
  await docPage.screenshot({ path: "scripts/m6-stage3-1-draft-desktop.png" });
  await copyToArtifacts("m6-stage3-1-draft-desktop.png");

  // Capture View 2: Pending Review View
  console.log("Submitting note for review...");
  const submitReviewBtn = docPage.locator('button:has-text("Submit for Review")').first();
  await submitReviewBtn.click();
  await docPage.waitForTimeout(1500);
  await docPage.screenshot({ path: "scripts/m6-stage3-2-pending-review-desktop.png" });
  await copyToArtifacts("m6-stage3-2-pending-review-desktop.png");

  // Capture View 3: Signed & Immutable Record View
  console.log("Approving & Signing note transactionally...");
  const signBtn = docPage.locator('button:has-text("Approve & Sign Note")').first();
  await signBtn.click();
  await docPage.waitForTimeout(2000);
  await docPage.screenshot({ path: "scripts/m6-stage3-3-signed-desktop.png" });
  await copyToArtifacts("m6-stage3-3-signed-desktop.png");

  // Capture View 4: Amendment Creation Drawer & v2
  console.log("Opening Amendment Creation prompt...");
  const amendBtn = docPage.locator('button:has-text("Create Amendment"), [role="button"]:has-text("Create Amendment")').first();
  await amendBtn.click();
  await docPage.waitForTimeout(1000);

  const reasonTextarea = docPage.locator('textarea[placeholder*="Follow-up lab results"]').first();
  await reasonTextarea.fill("Follow-up lipid panel & stress test completed; adding Atorvastatin 20mg daily.");
  await docPage.waitForTimeout(500);
  await docPage.screenshot({ path: "scripts/m6-stage3-4-amendment-drawer-desktop.png" });
  await copyToArtifacts("m6-stage3-4-amendment-drawer-desktop.png");

  const confirmAmendBtn = docPage.locator('button:has-text("Confirm & Create Amendment")').first();
  await confirmAmendBtn.click();
  await docPage.waitForTimeout(2000);
  await docPage.screenshot({ path: "scripts/m6-stage3-4-amendment-v2-desktop.png" });
  await copyToArtifacts("m6-stage3-4-amendment-v2-desktop.png");

  // --------------------------------------------------------------------------
  // WORKFLOW B: Clinician Mobile (375px)
  // --------------------------------------------------------------------------
  console.log("=== Step 4: Clinician Mobile Layout Verification (375px) ===");
  const mobileDocContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    extraHTTPHeaders: clinicianHeaders,
  });
  const mobileDocPage = await mobileDocContext.newPage();
  await mobileDocPage.goto("http://localhost:3000/history", { waitUntil: "domcontentloaded" });
  await mobileDocPage.waitForTimeout(2000);

  const mobileCard = mobileDocPage.locator(`div:has-text("${workflowEncounterId}")`).filter({ has: mobileDocPage.locator('button:has-text("SOAP Report")') }).last();
  await mobileCard.locator('button:has-text("SOAP Report")').click();
  await mobileDocPage.waitForTimeout(2000);
  await mobileDocPage.screenshot({ path: "scripts/m6-stage3-mobile-signed-375.png" });
  await copyToArtifacts("m6-stage3-mobile-signed-375.png");

  // --------------------------------------------------------------------------
  // WORKFLOW C: Patient Verification (Signed Accessible vs Unsigned Blocked)
  // --------------------------------------------------------------------------
  console.log("=== Step 5: Patient Access Verification in Browser ===");
  const patContext = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    extraHTTPHeaders: patientHeaders,
  });
  const patPage = await patContext.newPage();
  await patPage.goto("http://localhost:3000/history", { waitUntil: "domcontentloaded" });
  await patPage.waitForTimeout(2000);

  // Patient clicks signed encounter: should see certified record
  const patSignedCard = patPage.locator(`div:has-text("${workflowEncounterId}")`).filter({ has: patPage.locator('button:has-text("SOAP Report")') }).last();
  await patSignedCard.locator('button:has-text("SOAP Report")').click();
  await patPage.waitForTimeout(2000);
  await patPage.screenshot({ path: "scripts/m6-stage3-5-patient-signed-desktop.png" });
  await copyToArtifacts("m6-stage3-5-patient-signed-desktop.png");

  // Close modal
  const closeBtn = patPage.locator('button[title="Close document"]').first();
  await closeBtn.click();
  await patPage.waitForTimeout(500);

  // Patient clicks unsigned draft encounter: draft must NOT be exposed
  const patDraftCard = patPage.locator(`div:has-text("${draftOnlyEncounterId}")`).filter({ has: patPage.locator('button:has-text("SOAP Report")') }).last();
  await patDraftCard.locator('button:has-text("SOAP Report")').click();
  await patPage.waitForTimeout(2000);
  await patPage.screenshot({ path: "scripts/m6-stage3-6-patient-unsigned-blocked-desktop.png" });
  await copyToArtifacts("m6-stage3-6-patient-unsigned-blocked-desktop.png");

  await browser.close();
  console.log("=== All browser verification steps completed successfully! ===");
}

run().catch((err) => {
  console.error("Playwright verification error:", err);
  process.exit(1);
});
