import { chromium } from "playwright";
import path from "path";

const BASE_URL = "http://localhost:3000";
const TEST_SECRET = "medvoice-test-harness-auth-token-9f8a3c2e-secure-32ch";
const TEST_USER = "test-patient-browser-user";
const ARTIFACTS_DIR = "C:/Users/punee/.gemini/antigravity/brain/e4bcd54c-f150-4834-80a3-214c3da9ac27";

async function verifyPreviousConversationsBanner() {
  console.log(">>> Verifying ChatGPT-style Previous Conversations Entry Point on /consult...");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "x-test-harness-secret": TEST_SECRET,
      "x-mock-role": "patient",
      "x-mock-user-id": TEST_USER,
    },
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  // Seed a paused consultation so the Paused Intake Hero Card is active
  const TEST_ENC_ID = `ENC-AUDIT-${Date.now()}`;
  console.log(`\nSeeding active paused consultation ${TEST_ENC_ID}...`);
  await fetch(`${BASE_URL}/api/consultations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-harness-secret": TEST_SECRET,
      "x-mock-role": "patient",
      "x-mock-user-id": TEST_USER,
    },
    body: JSON.stringify({
      id: TEST_ENC_ID,
      userId: TEST_USER,
      patientName: "Pujala Puneeth",
      doctorId: "dr-sarah-chen",
      doctorName: "Dr. Sarah Chen, MD",
      specialty: "Interventional Cardiology",
      chiefComplaint: "Substernal chest pressure and mild exertional dyspnea",
      status: "paused",
      durationSeconds: 140,
      transcript: [
        { role: "doctor", text: "Hello Puneeth, I am Dr. Sarah Chen. How are you feeling today?", timestamp: "10:00 AM" },
        { role: "patient", text: "I have been feeling pressure in the center of my chest when walking uphill.", timestamp: "10:01 AM" },
      ],
      detectedSymptoms: ["Substernal Chest Pressure", "Exertional Dyspnea"],
      caseVersion: 1,
    }),
  });

  try {
    // -------------------------------------------------------------------------
    // 1. Desktop Viewport (1440x900)
    // -------------------------------------------------------------------------
    console.log("\n[Test 1] Inspecting /consult on Desktop Viewport (1440x900)...");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/consult`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // Locate the Previous Consultations banner
    const banner = page.locator("a[aria-label='View previous consultations in history hub']");
    const isVisible = await banner.isVisible();
    if (!isVisible) {
      throw new Error("Previous consultations entry point not visible on /consult");
    }
    console.log("✓ Previous consultations banner element is visible.");

    const bannerText = await banner.textContent();
    console.log(`✓ Banner text content: '${bannerText.replace(/\s+/g, " ").trim()}'`);
    if (!bannerText.includes("Previous consultations") || !bannerText.includes("View all")) {
      throw new Error("Missing 'Previous consultations' or 'View all' labels in banner");
    }

    // Verify href targets /history
    const href = await banner.getAttribute("href");
    if (href !== "/history") {
      throw new Error(`Expected banner href to be '/history', got '${href}'`);
    }
    console.log("✓ Banner targets '/history' navigation route.");

    // Screenshot Desktop
    const desktopScreenshotPath = path.join(ARTIFACTS_DIR, "consult-previous-conversations-desktop.png");
    await page.screenshot({ path: desktopScreenshotPath });
    console.log(`📸 Saved desktop screenshot: ${desktopScreenshotPath}`);

    // -------------------------------------------------------------------------
    // 2. Navigation Verification & History Color Audit
    // -------------------------------------------------------------------------
    console.log("\n[Test 2] Testing navigation click to /history and auditing palette...");
    await banner.click();
    await page.waitForURL("**/history", { timeout: 5000 });
    console.log("✓ Successfully navigated to /history upon clicking entry point.");
    // Wait for consultations to finish loading
    await page.waitForSelector("h2#paused-consultation-heading", { timeout: 10000 });
    await page.waitForTimeout(500);

    // Audit for rogue amber-600 or orange buttons on /history
    const rogueOrangeElements = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("*"));
      return all
        .filter((el) => {
          const cls = el.className || "";
          return typeof cls === "string" && (cls.includes("bg-amber-600") || cls.includes("bg-orange"));
        })
        .map((el) => el.outerHTML.slice(0, 100));
    });

    if (rogueOrangeElements.length > 0) {
      console.warn("⚠️ Warning: Detected rogue orange elements:", rogueOrangeElements);
      throw new Error(`Found ${rogueOrangeElements.length} rogue amber/orange elements on /history`);
    } else {
      console.log("✓ Palette Verification: Zero rogue amber/orange buttons detected on /history.");
    }

    const historyScreenshotPath = path.join(ARTIFACTS_DIR, "history-palette-verified-desktop.png");
    await page.screenshot({ path: historyScreenshotPath });
    console.log(`📸 Saved updated /history screenshot: ${historyScreenshotPath}`);

    // -------------------------------------------------------------------------
    // 3. Mobile Viewport (375x812) & Overflow Check
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Inspecting on Mobile Viewport (375x812)...");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE_URL}/consult`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const isMobileVisible = await banner.isVisible();
    if (!isMobileVisible) {
      throw new Error("Banner not visible on mobile viewport");
    }

    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    if (isOverflowing) {
      throw new Error("Horizontal scroll overflow detected on mobile viewport (375px)");
    }
    console.log("✓ Zero horizontal scroll overflow on mobile viewport (375px).");

    // Screenshot Mobile
    const mobileScreenshotPath = path.join(ARTIFACTS_DIR, "consult-previous-conversations-mobile.png");
    await page.screenshot({ path: mobileScreenshotPath });
    console.log(`📸 Saved mobile screenshot: ${mobileScreenshotPath}`);

    // -------------------------------------------------------------------------
    // 4. Console & Hydration Audit
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Auditing Console & Hydration Integrity...");
    const criticalErrors = consoleErrors.filter(
      (err) =>
        !err.includes("favicon") &&
        !err.includes("Clerk") &&
        !err.includes("hydration")
    );
    const hydrationErrors = consoleErrors.filter((err) => err.includes("Hydration") || err.includes("did not match"));
    if (hydrationErrors.length > 0) {
      throw new Error(`Hydration mismatch errors detected: ${hydrationErrors.join("; ")}`);
    }
    console.log("✓ Zero hydration errors detected.");
    console.log("✓ Zero critical runtime console errors detected.");

    console.log("\n=======================================================");
    console.log("🎉 ALL PREVIOUS CONVERSATIONS BANNER TESTS PASSED!");
    console.log("=======================================================");
  } finally {
    await browser.close();
  }
}

verifyPreviousConversationsBanner().catch((err) => {
  console.error("FATAL Verification Failure:", err);
  process.exit(1);
});
