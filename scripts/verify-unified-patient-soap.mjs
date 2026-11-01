import { chromium } from "playwright";
import path from "path";

const BASE_URL = "http://localhost:3000";
const ARTIFACTS_DIR = "C:/Users/punee/.gemini/antigravity/brain/e4bcd54c-f150-4834-80a3-214c3da9ac27";

const MOCK_SIGNED_CONSULTATION = {
  id: "ENC-2026-CARD-9011",
  userId: "user_puneeth_pujala",
  patientName: "Pujala Puneeth",
  patientAge: "26",
  patientGender: "male",
  doctorId: "dr-sarah-chen",
  doctorName: "Dr. Sarah Chen, MD",
  specialty: "Interventional Cardiology",
  chiefComplaint: "Substernal chest tightness and mild exertional dyspnea",
  status: "approved",
  triageLevel: "priority",
  triageTitle: "CARDIOPULMONARY EVALUATION",
  esiScore: 3,
  icd10Codes: ["I20.9", "R06.02"],
  detectedSymptoms: ["Substernal Chest Tightness", "Exertional Dyspnea"],
  durationSeconds: 340,
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  transcript: [
    { role: "doctor", text: "Hello Puneeth, I'm Dr. Sarah Chen. What brings you in today?", timestamp: "10:00 AM" },
    { role: "patient", text: "I have had pressure in my chest when climbing stairs for the past two weeks.", timestamp: "10:01 AM" },
    { role: "doctor", text: "Does the sensation radiate to your neck, shoulder, or jaw?", timestamp: "10:02 AM" },
    { role: "patient", text: "Sometimes slightly to my left shoulder, and it goes away when I stop to rest.", timestamp: "10:03 AM" },
  ],
  soapSummary: {
    hasSignedArtifact: true,
    status: "signed",
    latestSignedArtifactId: "art-card-9011-v1",
    latestSignedVersion: 1,
    signedAt: new Date(Date.now() - 1800000).toISOString(),
    signedBy: "Dr. Sarah Chen, MD",
    signedByRole: "Attending Interventional Cardiologist",
    totalSignedVersions: 1,
  },
};

const MOCK_MULTI_VERSION_CONSULTATION = {
  id: "ENC-2026-CARD-9022",
  userId: "user_puneeth_pujala",
  patientName: "Pujala Puneeth",
  patientAge: "26",
  patientGender: "male",
  doctorId: "dr-sarah-chen",
  doctorName: "Dr. Sarah Chen, MD",
  specialty: "Interventional Cardiology",
  chiefComplaint: "Post-treadmill stress testing follow-up and medication titration",
  status: "approved",
  triageLevel: "priority",
  triageTitle: "CARDIOPULMONARY EVALUATION",
  esiScore: 3,
  icd10Codes: ["I25.10", "I20.9"],
  detectedSymptoms: ["Exertional Angina", "Ischemic ST Changes"],
  durationSeconds: 420,
  createdAt: new Date(Date.now() - 86400000).toISOString(),
  transcript: [
    { role: "doctor", text: "Welcome back, Puneeth. We have your stress test results.", timestamp: "2:00 PM" },
    { role: "patient", text: "I completed the test yesterday morning. How did it look?", timestamp: "2:01 PM" },
  ],
  caseVersion: 2,
  soapSummary: {
    hasSignedArtifact: true,
    status: "signed",
    latestSignedArtifactId: "art-card-9022-v2",
    latestSignedVersion: 2,
    signedAt: new Date(Date.now() - 3600000).toISOString(),
    signedBy: "Dr. Sarah Chen, MD",
    signedByRole: "Attending Interventional Cardiologist",
    totalSignedVersions: 2,
  },
};

const MOCK_AWAITING_REVIEW_CONSULTATION = {
  id: "ENC-2026-AMB-9033",
  userId: "user_puneeth_pujala",
  patientName: "Pujala Puneeth",
  patientAge: "26",
  patientGender: "male",
  doctorId: "dr-sarah-chen",
  doctorName: "Dr. Sarah Chen, MD",
  specialty: "Internal Medicine & General Practice",
  chiefComplaint: "Orthostatic dizziness and episodic post-exertional fatigue",
  status: "completed_pending_review",
  triageLevel: "routine",
  triageTitle: "AMBULATORY CLINICAL INTAKE",
  esiScore: 4,
  icd10Codes: ["R42", "R53.83"],
  durationSeconds: 260,
  createdAt: new Date(Date.now() - 7200000).toISOString(),
  transcript: [
    { role: "doctor", text: "Hello Puneeth. Let us review the dizziness you have been experiencing.", timestamp: "11:00 AM" },
    { role: "patient", text: "I feel dizzy primarily when standing up quickly after working at my desk.", timestamp: "11:01 AM" },
  ],
  soapSummary: {
    hasSignedArtifact: false,
    status: "awaiting_review",
    latestSignedArtifactId: null,
    latestSignedVersion: null,
    totalSignedVersions: 0,
  },
};

const MOCK_PAUSED_CONSULTATION = {
  id: "ENC-519722-88Q",
  userId: "user_puneeth_pujala",
  patientName: "Pujala Puneeth",
  patientAge: "26",
  patientGender: "male",
  doctorId: "dr-sarah-chen",
  doctorName: "Dr. Sarah Chen, MD",
  specialty: "Internal Medicine & General Practice",
  chiefComplaint: "Well hey",
  status: "paused",
  triageLevel: "gathering_history",
  triageTitle: "CLINICAL HISTORY GATHERING",
  durationSeconds: 120,
  createdAt: new Date(Date.now() - 14400000).toISOString(),
  transcript: [
    { role: "patient", text: "Well hey", timestamp: "6:02 PM" },
    { role: "doctor", text: "Hello Puneeth, I am Dr. Sarah Chen. How are you feeling today?", timestamp: "6:02 PM" },
  ],
  soapSummary: {
    hasSignedArtifact: false,
    status: "none",
    latestSignedArtifactId: null,
    latestSignedVersion: null,
    totalSignedVersions: 0,
  },
};

const MOCK_ARTIFACT_9011_V1 = {
  id: "art-card-9011-v1",
  consultationId: "ENC-2026-CARD-9011",
  artifactType: "soap_note",
  version: 1,
  status: "signed",
  chiefComplaint: "Substernal chest tightness and mild exertional dyspnea",
  soapSubjective:
    "Patient presents with a 2-week history of substernal chest tightness and exertional shortness of breath provoked by uphill walking. Episodes typically resolve within 3 to 5 minutes of rest. Denies radiation to jaw or back, nausea, or diaphoresis.",
  soapObjective:
    "Vital Signs: BP 126/80 mmHg, Pulse 72 bpm regular, Respiratory Rate 16/min, SpO2 98% room air.\nPhysical Exam: Well-appearing, conversing without distress. Normal S1/S2 without murmurs, rubs, or gallops. Lungs clear to bilateral auscultation.",
  soapAssessment:
    "1. Stable angina pectoris (CCS Class II) - High pre-test probability of ischemic heart disease.\n2. Exertional dyspnea, secondary to cardiac etiology.\n3. Differential diagnosis includes gastroesophageal reflux, costochondritis, and anxiety.",
  soapPlan:
    "1. Prescription: Sublingual Nitroglycerin 0.4 mg PRN for acute chest discomfort.\n2. Diagnostics: Scheduled Bruce-protocol graded treadmill exercise tolerance test.\n3. Labs: Comprehensive metabolic panel, lipid profile, and high-sensitivity Troponin.\n4. Red flags: Immediate emergency department presentation if pain becomes prolonged (>10 min) or rest-onset.",
  icd10Codes: ["I20.9", "R06.02"],
  esiScore: 3,
  payloadSha256: "9f8a3c2e7b1a4d6f8e2c0b5a3d7e1f4a9b8c2d6e0f1a3b5c7d9e1f3a5b7c9d1e",
  signedBy: "Dr. Sarah Chen, MD",
  signedByRole: "Attending Interventional Cardiologist",
  signedAt: new Date(Date.now() - 1800000).toISOString(),
  signingAttestationDigest: "4a7b2c9d1e3f5a8b6c0d2e4f7a9b1c3d5e8f0a2b4c6d8e1f3a5b7c9d1e2f4a6b",
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  updatedAt: new Date(Date.now() - 1800000).toISOString(),
};

const MOCK_ARTIFACT_9022_V1 = {
  id: "art-card-9022-v1",
  consultationId: "ENC-2026-CARD-9022",
  artifactType: "soap_note",
  version: 1,
  status: "signed",
  chiefComplaint: "Initial evaluation of exertional chest pain",
  soapSubjective: "Patient reports exertional chest pressure during moderate aerobic activities.",
  soapObjective: "BP 132/84 mmHg, HR 74 bpm regular.",
  soapAssessment: "Suspected exertional angina. Exercise stress test requested.",
  soapPlan: "Outpatient treadmill stress testing ordered.",
  icd10Codes: ["I20.9"],
  esiScore: 3,
  payloadSha256: "1111111111111111111111111111111111111111111111111111111111111111",
  signedBy: "Dr. Sarah Chen, MD",
  signedByRole: "Attending Interventional Cardiologist",
  signedAt: new Date(Date.now() - 86400000).toISOString(),
  signingAttestationDigest: "2222222222222222222222222222222222222222222222222222222222222222",
  createdAt: new Date(Date.now() - 86400000).toISOString(),
  updatedAt: new Date(Date.now() - 86400000).toISOString(),
};

const MOCK_ARTIFACT_9022_V2 = {
  id: "art-card-9022-v2",
  consultationId: "ENC-2026-CARD-9022",
  artifactType: "soap_note",
  version: 2,
  status: "signed",
  chiefComplaint: "Post-treadmill stress testing follow-up and medication titration",
  soapSubjective:
    "Patient reports mild exertional tightness during treadmill stress test; otherwise symptomatically stable on initial therapy.",
  soapObjective:
    "Exercise treadmill test completed: 1.5mm horizontal ST segment depression in inferolateral leads at 8.4 METs. Peak BP 168/90 mmHg, peak HR 148 bpm.",
  soapAssessment:
    "Documented exercise-induced myocardial ischemia consistent with coronary artery disease.",
  soapPlan:
    "1. Initiate Metoprolol Succinate 50mg daily.\n2. Continue Aspirin 81mg daily.\n3. Referral for elective coronary angiography.",
  icd10Codes: ["I25.10", "I20.9"],
  esiScore: 3,
  payloadSha256: "3333333333333333333333333333333333333333333333333333333333333333",
  signedBy: "Dr. Sarah Chen, MD",
  signedByRole: "Attending Interventional Cardiologist",
  signedAt: new Date(Date.now() - 3600000).toISOString(),
  signingAttestationDigest: "4444444444444444444444444444444444444444444444444444444444444444",
  amendsArtifactId: "art-card-9022-v1",
  amendmentReason: "Updated post-exercise treadmill test with objective ST-segment findings and beta-blocker titration.",
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  updatedAt: new Date(Date.now() - 3600000).toISOString(),
};

async function verifyUnifiedPatientSoap() {
  console.log(">>> Starting Unified Patient History & Encounter SOAP Visual Verification...");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-test-harness-secret": "medvoice-test-harness-auth-token-9f8a3c2e-secure-32ch",
      "x-mock-role": "patient",
      "x-mock-user-id": "user_puneeth_pujala",
    },
  });
  const page = await context.newPage();

  // Route interception for deterministic UI testing
  await page.route("**/api/consultations**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;

    // 1. GET /api/consultations
    if (pathname === "/api/consultations") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          consultations: [
            MOCK_SIGNED_CONSULTATION,
            MOCK_MULTI_VERSION_CONSULTATION,
            MOCK_AWAITING_REVIEW_CONSULTATION,
            MOCK_PAUSED_CONSULTATION,
          ],
          hasMore: false,
          nextCursor: null,
          isSyntheticDataset: false,
        }),
      });
    }

    // 2. GET /api/consultations/ENC-2026-CARD-9011
    if (pathname === "/api/consultations/ENC-2026-CARD-9011") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          consultation: MOCK_SIGNED_CONSULTATION,
        }),
      });
    }

    // 3. GET /api/consultations/ENC-2026-CARD-9011/artifacts
    if (pathname === "/api/consultations/ENC-2026-CARD-9011/artifacts") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          artifacts: [MOCK_ARTIFACT_9011_V1],
          userRole: "patient",
        }),
      });
    }

    // 4. GET /api/consultations/ENC-2026-CARD-9022
    if (pathname === "/api/consultations/ENC-2026-CARD-9022") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          consultation: MOCK_MULTI_VERSION_CONSULTATION,
        }),
      });
    }

    // 5. GET /api/consultations/ENC-2026-CARD-9022/artifacts
    if (pathname === "/api/consultations/ENC-2026-CARD-9022/artifacts") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          artifacts: [MOCK_ARTIFACT_9022_V2, MOCK_ARTIFACT_9022_V1],
          userRole: "patient",
        }),
      });
    }

    // Default continue for other endpoints
    await route.continue();
  });

  try {
    // -----------------------------------------------------------------------
    // 1. Desktop Viewport (1440x900) - History Hub
    // -----------------------------------------------------------------------
    console.log("\n[Step 1] Inspecting /history on Desktop Viewport (1440x900)...");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/history`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Verify presence of View SOAP Report buttons
    const viewSoapButtons = page.locator("a:has-text('View SOAP Report')");
    const soapBtnCount = await viewSoapButtons.count();
    console.log(`✓ Found ${soapBtnCount} 'View SOAP Report' buttons for signed consultations.`);
    if (soapBtnCount === 0) {
      throw new Error("Expected at least one 'View SOAP Report' action on /history");
    }

    // Verify first View SOAP button targets /history/[id]/soap
    const soapHref = await viewSoapButtons.first().getAttribute("href");
    console.log(`✓ First 'View SOAP Report' targets route: '${soapHref}'`);
    if (!soapHref || !soapHref.includes("/history/") || !soapHref.endsWith("/soap")) {
      throw new Error(`Expected soap URL to match '/history/[id]/soap', got: ${soapHref}`);
    }

    // Verify card states on /history
    const awaitingBadge = page.locator("text=Awaiting physician review").first();
    const hasAwaitingBadge = await awaitingBadge.isVisible();
    console.log(`✓ Consultation awaiting review badge visible: ${hasAwaitingBadge}`);

    const pausedHero = page.locator("h2#paused-consultation-heading");
    const hasPausedHero = await pausedHero.isVisible();
    console.log(`✓ Paused consultation card visible: ${hasPausedHero}`);

    // Screenshot Desktop History Hub
    const historyDesktopPath = path.join(ARTIFACTS_DIR, "history-unified-patient-desktop.png");
    await page.screenshot({ path: historyDesktopPath, fullPage: true });
    console.log(`📸 Saved Desktop History screenshot: ${historyDesktopPath}`);

    // -----------------------------------------------------------------------
    // 2. Desktop Viewport - Dedicated Encounter SOAP Route
    // -----------------------------------------------------------------------
    console.log(`\n[Step 2] Navigating to encounter SOAP route: ${soapHref}...`);
    await page.goto(`${BASE_URL}${soapHref}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Verify SOAP quadrants are rendered
    const subjective = page.locator("h2:has-text('Subjective')");
    const objective = page.locator("h2:has-text('Objective')");
    const assessment = page.locator("h2:has-text('Assessment')");
    const plan = page.locator("h2:has-text('Plan')");

    await subjective.waitFor({ state: "visible", timeout: 5000 });
    await objective.waitFor({ state: "visible", timeout: 5000 });
    await assessment.waitFor({ state: "visible", timeout: 5000 });
    await plan.waitFor({ state: "visible", timeout: 5000 });
    console.log("✓ All 4 clinical SOAP quadrants (Subjective, Objective, Assessment, Plan) verified visible.");

    // Verify Attestation card
    const attestationHeading = page.locator("text=Medico-Legal Digital Attestation");
    await attestationHeading.waitFor({ state: "visible", timeout: 5000 });
    console.log("✓ Medico-Legal Digital Attestation card verified.");

    const soapDesktopPath = path.join(ARTIFACTS_DIR, "history-encounter-soap-desktop.png");
    await page.screenshot({ path: soapDesktopPath, fullPage: true });
    console.log(`📸 Saved Encounter SOAP Desktop screenshot: ${soapDesktopPath}`);

    // -----------------------------------------------------------------------
    // 3. Multi-Version Encounter SOAP & Revision Comparison
    // -----------------------------------------------------------------------
    console.log("\n[Step 3] Navigating to multi-version encounter SOAP route...");
    await page.goto(`${BASE_URL}/history/ENC-2026-CARD-9022/soap`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // Look for Compare Versions button
    const compareBtn = page.locator("button:has-text('Compare Versions')");
    const hasCompareBtn = await compareBtn.isVisible();
    console.log(`✓ Compare Versions button visible: ${hasCompareBtn}`);
    if (hasCompareBtn) {
      await compareBtn.click();
      await page.waitForTimeout(800);

      const diffPath = path.join(ARTIFACTS_DIR, "history-soap-version-diff-desktop.png");
      await page.screenshot({ path: diffPath, fullPage: true });
      console.log(`📸 Saved SOAP Version Diff screenshot: ${diffPath}`);
    }

    // -----------------------------------------------------------------------
    // 4. Mobile Viewport (375x812) - History & SOAP Document
    // -----------------------------------------------------------------------
    console.log("\n[Step 4] Inspecting Mobile Viewport (375x812)...");
    await page.setViewportSize({ width: 375, height: 812 });

    // Mobile History
    await page.goto(`${BASE_URL}/history`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    let isHistoryOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`✓ Mobile History overflow check: ${isHistoryOverflowing ? "OVERFLOW" : "CLEAN (Zero Overflow)"}`);
    if (isHistoryOverflowing) {
      throw new Error("Horizontal overflow detected on mobile /history");
    }

    const historyMobilePath = path.join(ARTIFACTS_DIR, "history-unified-patient-mobile.png");
    await page.screenshot({ path: historyMobilePath, fullPage: true });
    console.log(`📸 Saved Mobile History screenshot: ${historyMobilePath}`);

    // Mobile SOAP Document
    await page.goto(`${BASE_URL}${soapHref}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    let isSoapOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`✓ Mobile SOAP overflow check: ${isSoapOverflowing ? "OVERFLOW" : "CLEAN (Zero Overflow)"}`);
    if (isSoapOverflowing) {
      throw new Error("Horizontal overflow detected on mobile /history/[id]/soap");
    }

    const soapMobilePath = path.join(ARTIFACTS_DIR, "history-encounter-soap-mobile.png");
    await page.screenshot({ path: soapMobilePath, fullPage: true });
    console.log(`📸 Saved Mobile Encounter SOAP screenshot: ${soapMobilePath}`);

    console.log("\n🎉 ALL VISUAL VERIFICATIONS COMPLETED SUCCESSFULLY!");
  } finally {
    await browser.close();
  }
}

verifyUnifiedPatientSoap().catch((err) => {
  console.error("FATAL Visual Verification Error:", err);
  process.exit(1);
});
