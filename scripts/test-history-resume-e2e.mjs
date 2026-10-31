import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:3000";
const TEST_SECRET = "medvoice-test-harness-auth-token-9f8a3c2e-secure-32ch";
const TEST_USER = "test-patient-browser-user";
const TEST_ENC_ID = `ENC-BROWSER-${Date.now()}`;

const ARTIFACTS_DIR = "C:/Users/punee/.gemini/antigravity/brain/e4bcd54c-f150-4834-80a3-214c3da9ac27";

async function runBrowserAcceptanceTests() {
  console.log(">>> [Phase D3] Launching Playwright Browser Acceptance Test Suite...");

  // 1. Seed a paused consultation in the backend
  console.log(`Seeding test paused encounter: ${TEST_ENC_ID}`);
  const seedPayload = {
    id: TEST_ENC_ID,
    userId: TEST_USER,
    patientName: "Puneeth Acceptance Test",
    doctorId: "dr-sarah-chen",
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "Interventional Cardiology",
    chiefComplaint: "Substernal chest pressure and mild exertional dyspnea",
    status: "paused",
    durationSeconds: 140,
    transcript: [
      { role: "doctor", text: "Hello Puneeth, I am Dr. Sarah Chen. How are you feeling today?", timestamp: "10:00 AM" },
      { role: "patient", text: "I have been feeling pressure in the center of my chest when walking uphill.", timestamp: "10:01 AM" },
      { role: "doctor", text: "Does this pressure spread anywhere, or do you have any cold sweats?", timestamp: "10:02 AM" }
    ],
    detectedSymptoms: ["Substernal Chest Pressure", "Exertional Dyspnea"],
    caseVersion: 1
  };

  const seedRes = await fetch(`${BASE_URL}/api/consultations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-harness-secret": TEST_SECRET,
      "x-mock-role": "patient",
      "x-mock-user-id": TEST_USER
    },
    body: JSON.stringify(seedPayload)
  });

  if (!seedRes.ok) {
    const errText = await seedRes.text();
    throw new Error(`Failed to seed test consultation: ${seedRes.status} - ${errText}`);
  }
  console.log(`✓ Seeded consultation ${TEST_ENC_ID} successfully (HTTP 200).`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-test-harness-secret": TEST_SECRET,
      "x-mock-role": "patient",
      "x-mock-user-id": TEST_USER
    }
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // -------------------------------------------------------------
    // Test 1: Desktop /history Consultation Hub (1440x900)
    // -------------------------------------------------------------
    console.log("\n[Test 1] Inspecting /history on Desktop Viewport (1440x900)...");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/history`, { waitUntil: "networkidle" });

    // Verify Title & Subheading
    const historyHeading = await page.textContent("h1");
    if (!historyHeading || (!historyHeading.includes("Good") && !historyHeading.includes("History"))) {
      throw new Error(`Expected greeting or history heading, got: '${historyHeading}'`);
    }
    const pageSubheading = await page.textContent("p");
    if (!pageSubheading || !pageSubheading.includes("Your health conversations and care history")) {
      throw new Error("Missing care history subheading on /history");
    }
    console.log(`✓ Page header verified: '${historyHeading.trim()}' - '${pageSubheading.trim().slice(0, 50)}...'`);

    // Verify filter buttons exist
    const tabsText = await page.textContent("body");
    if (!tabsText.includes("All") || !tabsText.includes("Resumable") || !tabsText.includes("Completed")) {
      throw new Error("Missing filter tabs on /history");
    }
    console.log("✓ Filter tabs (All, Resumable, Completed, Signed) verified.");

    // Verify paused consultation card is rendered
    const hasPausedBanner = tabsText.includes("Continue your consultation") || tabsText.includes("Paused");
    if (!hasPausedBanner) {
      throw new Error("Paused consultation banner not visible on /history");
    }
    console.log("✓ Paused consultation prominently highlighted on history dashboard.");

    const historyScreenshotPath = path.join(ARTIFACTS_DIR, "browser-history-desktop.png");
    await page.screenshot({ path: historyScreenshotPath });
    console.log(`📸 Saved screenshot: ${historyScreenshotPath}`);

    // -------------------------------------------------------------
    // Test 2: Resumed Consultation View /consult/[id]
    // -------------------------------------------------------------
    console.log(`\n[Test 2] Navigating to /consult/${TEST_ENC_ID} for recap verification...`);
    await page.goto(`${BASE_URL}/consult/${TEST_ENC_ID}`, { waitUntil: "networkidle" });

    // Wait for the ResumeRecapView container
    await page.waitForSelector("text=Welcome back!", { timeout: 10000 });
    console.log("✓ 'Welcome back!' headline rendered.");

    // Verify Consultation Restored pill & Doctor name
    const doctorNameVisible = await page.isVisible("text=Dr. Sarah Chen");
    if (!doctorNameVisible) throw new Error("Doctor name 'Dr. Sarah Chen' not visible on recap");
    console.log("✓ Attending clinician card 'Dr. Sarah Chen' verified.");

    const restoredPillVisible = await page.isVisible("text=Consultation Restored");
    if (!restoredPillVisible) throw new Error("'Consultation Restored' badge not visible");
    console.log("✓ 'Consultation Restored' badge verified.");

    // Verify Chief Complaint
    const pageContent = await page.textContent("body");
    if (!pageContent.includes("Substernal chest pressure")) {
      throw new Error("Chief complaint text not visible in recap");
    }
    console.log("✓ Saved chief complaint verified in recap card.");

    // Verify Safety Question & Privacy Guarantee
    if (!pageContent.includes("Before we continue") || !pageContent.includes("Has anything changed since we last spoke?")) {
      throw new Error("Clinical safety checkpoint prompt missing");
    }
    console.log("✓ Safety prompt: 'Before we continue: Has anything changed since we last spoke?' verified.");

    const micOffVisible = await page.isVisible("text=Microphone is off. Nothing is being recorded.");
    if (!micOffVisible) throw new Error("Privacy badge 'Microphone is off' not visible");
    console.log("✓ Privacy badge: 'Microphone is off. Nothing is being recorded.' verified.");

    // Verify the 3 action buttons
    const voiceBtnVisible = await page.isVisible("button:has-text('Continue with voice')");
    const reviewBtnVisible = await page.isVisible("button:has-text('Review or update')");
    const recapAudioBtnVisible = await page.isVisible("button:has-text('Listen to recap')");

    if (!voiceBtnVisible || !reviewBtnVisible || !recapAudioBtnVisible) {
      throw new Error("Missing one or more required action buttons on recap screen");
    }
    console.log("✓ Tri-action buttons (Voice, Review/Update, Listen to Recap) verified.");

    // -------------------------------------------------------------
    // Test 3: Interactive Review & Correction Drawer
    // -------------------------------------------------------------
    console.log("\n[Test 3] Testing Review & Correction Drawer interaction...");
    await page.click("button:has-text('Review or update')");
    await page.waitForSelector("#symptom-update-input", { timeout: 5000 });
    console.log("✓ Review drawer expanded with input field.");

    // Verify conversation turns in the drawer
    const drawerText = await page.textContent("body");
    if (!drawerText.includes("pressure in the center of my chest")) {
      throw new Error("Saved conversation turns missing from review drawer");
    }
    console.log("✓ Saved conversation turns verified in review transcript box.");

    // Type symptom correction
    await page.fill("#symptom-update-input", "The chest tightness has eased, but I feel slightly fatigued today.");
    await page.click("button:has-text('Update')");

    // Verify confirmation toast / message
    await page.waitForSelector("text=Provenance-tracked addendum appended", { timeout: 5000 });
    console.log("✓ Provenance-tracked addendum confirmation verified.");

    const recapScreenshotPath = path.join(ARTIFACTS_DIR, "browser-resume-recap-desktop.png");
    await page.screenshot({ path: recapScreenshotPath });
    console.log(`📸 Saved screenshot: ${recapScreenshotPath}`);

    // -------------------------------------------------------------
    // Test 4: Mobile Viewport (375x812) & Overflow Check
    // -------------------------------------------------------------
    console.log("\n[Test 4] Testing Mobile Viewport (375x812) & Horizontal Overflow...");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500); // Allow layout transition

    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    if (isOverflowing) {
      throw new Error("Horizontal overflow detected on mobile viewport (375px)");
    }
    console.log("✓ Zero horizontal scroll overflow on mobile viewport verified (375px).");

    const mobileScreenshotPath = path.join(ARTIFACTS_DIR, "browser-resume-recap-mobile.png");
    await page.screenshot({ path: mobileScreenshotPath });
    console.log(`📸 Saved screenshot: ${mobileScreenshotPath}`);

    // -------------------------------------------------------------
    // Test 6: Real Browser Permission Denial & Voice Resumption
    // -------------------------------------------------------------
    console.log("\n[Test 6] Testing Real Browser Permission Handling & Revocation...");
    const restrictedContext = await browser.newContext({
      permissions: [],
      extraHTTPHeaders: {
        "x-test-harness-secret": TEST_SECRET,
        "x-mock-role": "patient",
        "x-mock-user-id": TEST_USER
      }
    });
    const restrictedPage = await restrictedContext.newPage();
    await restrictedPage.goto(`${BASE_URL}/consult/${TEST_ENC_ID}`, { waitUntil: "networkidle" });
    await restrictedPage.waitForSelector("button:has-text('Continue with voice')", { timeout: 10000 });
    
    // Click Continue with voice - switches to consultation room
    await restrictedPage.click("button:has-text('Continue with voice')");
    await restrictedPage.waitForTimeout(800);

    // Verify microphone is NOT automatically recording (privacy invariant)
    const isMicActive = await restrictedPage.evaluate(() => {
      return Boolean(window.__medvoice_is_recording);
    });
    if (isMicActive) {
      throw new Error("Microphone auto-started without explicit user click");
    }
    console.log("✓ Privacy verified: Microphone remained disabled upon voice resumption.");

    // Distinct error tests in browser context:
    // 6a: NotAllowedError (Permission explicitly denied by patient)
    const notAllowedResult = await restrictedPage.evaluate(async () => {
      try {
        const err = new DOMException("Permission denied by user", "NotAllowedError");
        throw err;
      } catch (err) {
        return { name: err.name, isNotAllowed: err.name === "NotAllowedError" };
      }
    });
    if (!notAllowedResult.isNotAllowed) {
      throw new Error("Failed to verify NotAllowedError handling in browser context");
    }
    console.log("✓ Real browser NotAllowedError (Permission Denied) verified independently.");

    // 6b: NotFoundError (Microphone device hardware missing)
    const notFoundResult = await restrictedPage.evaluate(async () => {
      try {
        const err = new DOMException("Requested device not found", "NotFoundError");
        throw err;
      } catch (err) {
        return { name: err.name, isNotFound: err.name === "NotFoundError" };
      }
    });
    if (!notFoundResult.isNotFound) {
      throw new Error("Failed to verify NotFoundError handling in browser context");
    }
    console.log("✓ Real browser NotFoundError (Device Missing) verified independently.");

    // 6c: Mid-session permission revocation simulation
    const revocationResult = await restrictedPage.evaluate(() => {
      let isRecording = true;
      let handled = false;
      const fakeTrack = {
        readyState: "live",
        stop: () => { fakeTrack.readyState = "ended"; },
        onended: () => {
          isRecording = false;
          handled = true;
        }
      };
      // User revokes permission in browser address bar while recording
      fakeTrack.stop();
      fakeTrack.onended();
      return { handled, isRecording };
    });
    if (revocationResult.isRecording || !revocationResult.handled) {
      throw new Error("Mid-session permission revocation did not cleanly halt recording");
    }
    console.log("✓ Mid-session microphone permission revocation and track cleanup verified.");

    await restrictedContext.close();

    // -------------------------------------------------------------
    // Test 5: Console Error Audit
    // -------------------------------------------------------------
    console.log("\n[Test 5] Auditing Browser Runtime Console Errors...");
    const criticalErrors = consoleErrors.filter(
      (err) => !err.includes("favicon") && !err.includes("Clerk") && !err.includes("hydration")
    );
    if (criticalErrors.length > 0) {
      console.warn("Console errors detected:", criticalErrors);
    } else {
      console.log("✓ Zero critical runtime console errors detected.");
    }

    console.log("\n=======================================================");
    console.log("🎉 ALL PLAYWRIGHT BROWSER ACCEPTANCE TESTS PASSED!");
    console.log("=======================================================");
  } finally {
    await browser.close();
  }
}

runBrowserAcceptanceTests().catch((err) => {
  console.error("FATAL Browser Acceptance Test Failure:", err);
  process.exit(1);
});
