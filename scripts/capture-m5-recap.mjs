import { chromium } from "playwright";

async function run() {
  const testSecret = "medvoice-test-harness-auth-token-9f8a3c2e-secure-32ch";
  const authHeaders = {
    "Content-Type": "application/json",
    "x-test-harness-secret": testSecret,
    "x-mock-role": "patient",
    "x-mock-user-id": "user_patient_alpha",
  };

  console.log("1. Seeding mock paused consultation for M5 visual verification...");
  const seedPayload = {
    id: "ENC-M5-VERIFY-202",
    patientName: "Jane Doe",
    doctorId: "dr-sarah-chen",
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "Interventional Cardiology",
    chiefComplaint: "Acute anterior chest tightness and shortness of breath",
    status: "paused",
    durationSeconds: 154,
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    transcript: [
      { id: "t1", role: "doctor", text: "Hello Jane, can you describe what brought you in today?", timestamp: "09:00 AM" },
      { id: "t2", role: "patient", text: "I have had severe tightness in the center of my chest since this morning.", timestamp: "09:01 AM" },
      { id: "t3", role: "doctor", text: "Does the tightness spread to your jaw, neck, or left arm?", timestamp: "09:02 AM" },
      { id: "t4", role: "patient", text: "It feels like a heavy weight, mostly centered, but spreading toward my neck.", timestamp: "09:03 AM" },
    ],
    detectedSymptoms: ["Chest tightness", "Shortness of breath"],
    attributedFacts: [
      {
        id: "fact-1",
        category: "chronic_condition",
        factKey: "Essential Hypertension",
        factValue: "Diagnosed in 2022, managed with Lisinopril",
        provenance: "clinician_confirmed",
        isHistoricalContext: true,
      },
      {
        id: "fact-2",
        category: "medication",
        factKey: "Metoprolol Tartrate",
        factValue: "25mg oral daily",
        provenance: "patient_reported",
        isCurrentMedication: false,
        status: "historical",
        isHistoricalContext: true,
      },
    ],
    interviewState: {
      schemaVersion: 2,
      phase: "active_inquiring",
      caseVersion: 2,
      slots: {
        onset: "3 hours ago while at rest",
        onset_pattern: "sudden",
        character: "heavy compressive tightness",
        location: "substernal",
        radiation: "cervical radiation",
        associated_symptoms: ["Shortness of breath"],
      },
      structuredHistory: {
        chiefComplaint: "Acute anterior chest tightness and shortness of breath",
        timeline: { anchor: "3 hours ago", isSudden: true },
        unansweredDimensions: ["radiation_to_back", "diaphoresis", "nausea"],
      },
    },
  };

  const res = await fetch("http://localhost:3000/api/consultations", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(seedPayload),
  });
  console.log("Seed response status:", res.status);

  console.log("2. Launching Playwright browser...");
  const browser = await chromium.launch({ headless: true });

  // A. Desktop Viewport: 1440px
  console.log("3. Capturing Desktop (1440px)...");
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    extraHTTPHeaders: authHeaders,
  });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto("http://localhost:3000/consult/ENC-M5-VERIFY-202", { waitUntil: "networkidle" });
  await desktopPage.waitForTimeout(2500);

  await desktopPage.screenshot({
    path: "scripts/m5-recap-desktop-1440.png",
    fullPage: true,
  });
  console.log("Saved: scripts/m5-recap-desktop-1440.png");

  // B. Mobile Viewport: 375px
  console.log("4. Capturing Mobile (375px)...");
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    extraHTTPHeaders: authHeaders,
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto("http://localhost:3000/consult/ENC-M5-VERIFY-202", { waitUntil: "networkidle" });
  await mobilePage.waitForTimeout(2500);

  await mobilePage.screenshot({
    path: "scripts/m5-recap-mobile-375.png",
    fullPage: true,
  });
  console.log("Saved: scripts/m5-recap-mobile-375.png");

  await browser.close();
  console.log("M5 visual verification capture complete!");
}

run().catch((e) => {
  console.error("Capture failed:", e);
  process.exit(1);
});
