import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  stripProvenance,
  sampleBlindSubset,
  type SampleItem,
  type BlindReviewPrompt,
  type SecretMappingRecord,
} from "../../eval/src/harness/human-review-sampler";

async function main() {
  console.log("================================================================================");
  console.log("MEDVOICE CLINICAL EVALUATION: HUMAN REVIEW SAMPLER TEST SUITE");
  console.log("================================================================================\n");

  const tmpDir = path.join(process.cwd(), "eval", ".tmp", "sampler-test");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // Suite 1: Strict Provenance Stripping
  console.log("[Suite 1: Strict Provenance Stripping]");
  {
    const rawAiText = "  Dr. Sarah Chen: You have reported chest pain. MedVoice advises immediate care.  ";
    const strippedAi = stripProvenance(rawAiText);
    assert.strictEqual(
      strippedAi.includes("Dr. Sarah Chen"),
      false,
      "Must strip doctor persona name"
    );
    assert.strictEqual(
      strippedAi.includes("MedVoice"),
      false,
      "Must strip system/product name"
    );
    assert.strictEqual(
      strippedAi.startsWith(" ") || strippedAi.endsWith(" "),
      false,
      "Must normalize surrounding whitespace"
    );
    console.log("  ✓ PASS: Strips doctor personas and system branding");

    const rawDoctorText = "Physician: Take two tablets of paracetamol. \n\nDoctor: Follow up in 3 days.";
    const strippedDoc = stripProvenance(rawDoctorText);
    assert.strictEqual(
      strippedDoc.includes("Physician:") || strippedDoc.includes("Doctor:"),
      false,
      "Must strip physician prefixes"
    );
    console.log("  ✓ PASS: Strips physician/doctor prefixes");

    const quotesText = '“Patient reported ‘dizziness’ and nausea.”';
    const strippedQuotes = stripProvenance(quotesText);
    assert.strictEqual(
      strippedQuotes.includes("“") || strippedQuotes.includes("”") || strippedQuotes.includes("’"),
      false,
      "Must normalize curly quotes to standard quotes"
    );
    console.log("  ✓ PASS: Normalizes curly quotes and typographic characters");
  }

  // Suite 2: Stratified Sampling & Balanced Blinding
  console.log("\n[Suite 2: Stratified Sampling & Balanced Blinding]");
  {
    // Generate 20 synthetic sample items across 2 domains
    const syntheticItems: SampleItem[] = [];
    const domains = ["cardiovascular", "respiratory"];
    for (let i = 0; i < 20; i++) {
      const d = domains[i % 2];
      syntheticItems.push({
        id: `pair_${i + 1}`,
        domain: d,
        patient_query: `Patient query ${i + 1} regarding ${d}`,
        agent_response: `Dr. Sarah Chen: Agent clinical response for case ${i + 1}`,
        reference_response: `Doctor: Physician clinical response for case ${i + 1}`,
      });
    }

    const blindFile = path.join(tmpDir, "blind_sample_test.jsonl");
    const secretFile = path.join(tmpDir, "secret_mapping_test.json");

    const result = sampleBlindSubset(syntheticItems, {
      sampleSize: 10,
      seed: 42,
      stratifyByDomain: true,
      outputBlindedPath: blindFile,
      outputSecretPath: secretFile,
    });

    assert.strictEqual(result.blindedSample.length, 10, "Should sample exactly 10 items");
    assert.strictEqual(result.secretMapping.length, 10, "Secret mapping should match sample size");

    // Check files written
    assert.strictEqual(fs.existsSync(blindFile), true, "Blinded sample file must exist");
    assert.strictEqual(fs.existsSync(secretFile), true, "Secret mapping file must exist");

    // Check blinding purity: blindedSample must NOT leak provenance
    for (const item of result.blindedSample) {
      assert.strictEqual(
        (item as any).agent_response === undefined,
        true,
        "Blinded sample must not contain agent_response property"
      );
      assert.strictEqual(
        (item as any).reference_response === undefined,
        true,
        "Blinded sample must not contain reference_response property"
      );
      assert.strictEqual(
        item.response_a.includes("Dr. Sarah Chen") || item.response_a.includes("Doctor:"),
        false,
        "Response A must be stripped of provenance"
      );
      assert.strictEqual(
        item.response_b.includes("Dr. Sarah Chen") || item.response_b.includes("Doctor:"),
        false,
        "Response B must be stripped of provenance"
      );
    }
    console.log("  ✓ PASS: Blinded export contains zero provenance leakage");

    // Check domain stratification
    const domainCounts = result.blindedSample.reduce((acc, curr) => {
      acc[curr.domain] = (acc[curr.domain] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    assert.strictEqual(domainCounts["cardiovascular"], 5, "Stratification should balance domains (5 cardio)");
    assert.strictEqual(domainCounts["respiratory"], 5, "Stratification should balance domains (5 resp)");
    console.log("  ✓ PASS: Preserves balanced domain stratification");

    // Check coin flip balance in secret mapping
    const agentIsA = result.secretMapping.filter((m) => m.response_a_provenance === "agent").length;
    const agentIsB = result.secretMapping.filter((m) => m.response_b_provenance === "agent").length;
    assert.strictEqual(agentIsA + agentIsB, 10, "Every case must allocate agent to either A or B");
    assert.strictEqual(agentIsA > 0 && agentIsB > 0, true, "Coin flip must randomize both A and B allocations");
    console.log(`  ✓ PASS: Balanced coin flip allocates provenance (Agent as A: ${agentIsA}, Agent as B: ${agentIsB})`);
  }

  // Suite 3: Deterministic Reproducibility
  console.log("\n[Suite 3: Deterministic Reproducibility]");
  {
    const syntheticItems: SampleItem[] = [];
    for (let i = 0; i < 10; i++) {
      syntheticItems.push({
        id: `repro_${i}`,
        domain: "general_medicine",
        patient_query: `Query ${i}`,
        agent_response: `Agent ${i}`,
        reference_response: `Physician ${i}`,
      });
    }

    const run1 = sampleBlindSubset(syntheticItems, { sampleSize: 6, seed: 12345 });
    const run2 = sampleBlindSubset(syntheticItems, { sampleSize: 6, seed: 12345 });

    assert.deepStrictEqual(
      run1.blindedSample.map((x) => x.sample_id),
      run2.blindedSample.map((x) => x.sample_id),
      "Sample IDs must match exactly with identical seed"
    );
    assert.deepStrictEqual(
      run1.secretMapping.map((x) => x.response_a_provenance),
      run2.secretMapping.map((x) => x.response_a_provenance),
      "A/B provenance allocations must match exactly with identical seed"
    );
    console.log("  ✓ PASS: Seeded sampler produces 100% deterministic outputs");
  }

  // Cleanup tmpDir
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  console.log("\n================================================================================");
  console.log("ALL HUMAN REVIEW SAMPLER TESTS COMPLETED SUCCESSFULLY");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
