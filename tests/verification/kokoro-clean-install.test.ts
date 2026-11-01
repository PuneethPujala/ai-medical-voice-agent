/**
 * Kokoro Transformers Patch Clean-Install Verification Suite
 *
 * Verifies that the automated postinstall patch (`scripts/patch-transformers.cjs`)
 * correctly and reproducibly bridges the missing `transformers.node.mjs` export in
 * `@huggingface/transformers` across clean installs without requiring manual developer intervention.
 *
 * Invariants tested:
 * 1. Precondition: @huggingface/transformers is installed and is version 3.x.
 * 2. Simulated Clean Install: When `transformers.node.mjs` is removed (as upstream ships),
 *    Node ESM imports fail with ERR_MODULE_NOT_FOUND.
 * 3. Automated Postinstall: Running `node scripts/patch-transformers.cjs` regenerates the wrapper.
 * 4. Runtime Integrity: KokoroTTS and @huggingface/transformers exports are successfully resolved in Node ESM.
 * 5. Idempotency: Subsequent runs of `postinstall` exit cleanly without clobbering or duplicate overhead.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runKokoroCleanInstallVerification() {
  console.log("\n========================================================");
  console.log("  KOKORO TRANSFORMERS CLEAN-INSTALL COMPATIBILITY TEST");
  console.log("========================================================\n");

  const transformersDir = path.resolve(__dirname, "../../node_modules/@huggingface/transformers");
  const pkgJsonPath = path.join(transformersDir, "package.json");
  const mjsPath = path.join(transformersDir, "dist/transformers.node.mjs");
  const cjsPath = path.join(transformersDir, "dist/transformers.node.cjs");
  const patchScriptPath = path.resolve(__dirname, "../../scripts/patch-transformers.cjs");

  // 1. Verify Preconditions
  console.log("[Step 1] Checking @huggingface/transformers package metadata...");
  assert(fs.existsSync(pkgJsonPath), "@huggingface/transformers package.json exists");
  assert(fs.existsSync(cjsPath), "transformers.node.cjs CommonJS bundle exists");

  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  console.log(`  • Installed version: ${pkg.version}`);
  assert(pkg.version.startsWith("3."), "Installed version matches supported 3.x release line");

  // 2. Backup existing wrapper if present
  let backupContent: string | null = null;
  if (fs.existsSync(mjsPath)) {
    backupContent = fs.readFileSync(mjsPath, "utf8");
  }

  try {
    // -------------------------------------------------------------------------
    // Step 2: Simulate Clean Install (upstream state where .mjs is missing)
    // -------------------------------------------------------------------------
    console.log("\n[Step 2] Simulating fresh clean install by removing transformers.node.mjs...");
    if (fs.existsSync(mjsPath)) {
      fs.unlinkSync(mjsPath);
    }
    assert(!fs.existsSync(mjsPath), "transformers.node.mjs successfully unlinked (unpatched upstream state)");

    // Test that unpatched state fails under Node ESM
    let failedAsExpected = false;
    try {
      execSync('node --input-type=module -e "import { KokoroTTS } from \'kokoro-js\';"', {
        stdio: "pipe",
        encoding: "utf8",
      });
    } catch (err: any) {
      failedAsExpected = true;
      const stderr = err.stderr || err.message;
      assert(
        stderr.includes("ERR_MODULE_NOT_FOUND") || stderr.includes("Cannot find module"),
        `Unpatched ESM load fails with expected ERR_MODULE_NOT_FOUND: ${stderr.slice(0, 80).trim()}...`
      );
    }
    assert(failedAsExpected, "Confirmed: upstream package distribution without patch fails ESM imports");

    // -------------------------------------------------------------------------
    // Step 3: Execute Postinstall Patch
    // -------------------------------------------------------------------------
    console.log("\n[Step 3] Executing postinstall patch: node scripts/patch-transformers.cjs...");
    const patchOutput = execSync(`node "${patchScriptPath}"`, {
      encoding: "utf8",
    });
    console.log(`  • Patch script output: ${patchOutput.trim()}`);

    assert(fs.existsSync(mjsPath), "transformers.node.mjs was successfully created by postinstall");
    const generatedContent = fs.readFileSync(mjsPath, "utf8");
    assert(
      generatedContent.startsWith("// @medvoice/kokoro-esm-compat-wrapper"),
      "Generated file contains authoritative @medvoice compatibility header"
    );
    assert(
      generatedContent.includes("StyleTextToSpeech2Model"),
      "Wrapper exports required Kokoro neural model bindings"
    );

    // -------------------------------------------------------------------------
    // Step 4: Verify Runtime ESM Resolution
    // -------------------------------------------------------------------------
    console.log("\n[Step 4] Verifying Node ESM import of KokoroTTS & Transformers...");
    const esmTestScript = `
      import { KokoroTTS } from "kokoro-js";
      import { AutoTokenizer, StyleTextToSpeech2Model, env } from "@huggingface/transformers";
      if (typeof KokoroTTS !== "function") throw new Error("KokoroTTS is not a function");
      if (!AutoTokenizer || !StyleTextToSpeech2Model) throw new Error("Missing named exports from transformers");
      console.log("ESM_OK: KokoroTTS and transformers exports verified.");
    `;
    const esmOutput = execSync("node --input-type=module", {
      input: esmTestScript,
      encoding: "utf8",
    });
    assert(esmOutput.includes("ESM_OK"), "KokoroTTS and transformers loaded and verified under Node ESM");

    // -------------------------------------------------------------------------
    // Step 5: Test Patch Idempotency
    // -------------------------------------------------------------------------
    console.log("\n[Step 5] Verifying postinstall patch idempotency on re-run...");
    const secondRunOutput = execSync(`node "${patchScriptPath}"`, {
      encoding: "utf8",
    });
    assert(
      secondRunOutput.trim() === "" || secondRunOutput.includes("already exists"),
      "Second execution is idempotent and executes safely without error"
    );

    console.log("\n========================================================");
    console.log("  KOKORO TRANSFORMERS CLEAN-INSTALL TEST PASSED (5/5)");
    console.log("========================================================\n");
  } finally {
    // Restore backup if something went wrong or ensure wrapper is present
    if (!fs.existsSync(mjsPath) && backupContent) {
      fs.writeFileSync(mjsPath, backupContent, "utf8");
    }
  }
}

runKokoroCleanInstallVerification().catch((err) => {
  console.error("Kokoro clean install test failure:", err);
  process.exit(1);
});
