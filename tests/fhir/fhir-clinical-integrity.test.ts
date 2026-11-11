import { generateFHIRBundle, escapeXhtml, validateFhirR4Bundle } from "@/lib/fhir/bundle";

async function runTests() {
  console.log("================================================================================");
  console.log("       FHIR R4 CLINICAL INTEGRITY & DOCUMENT CONFORMANCE TEST SUITE            ");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc}`);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: Incomplete encounter must have status "preliminary" and NO attester
  // --------------------------------------------------------------------------
  console.log(">>> TEST 1: Incomplete encounter status and attestation");
  const incompleteBundle = generateFHIRBundle({
    id: "ENC-TEST-INCOMPLETE-01",
    patientName: "John Doe",
    doctorId: "dr-sarah-chen",
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "General Physician",
    chiefComplaint: "Mild headache",
    triageLevel: "gathering_history",
    status: "incomplete_intake",
    createdAt: new Date().toISOString(),
  });

  const composition1 = incompleteBundle.entry?.find(
    (e: any) => e.resource?.resourceType === "Composition"
  )?.resource;

  assert(composition1 !== undefined, "Composition resource is present");
  assert(composition1?.status === "preliminary", "Incomplete composition has status 'preliminary'");
  assert(!composition1?.attester || composition1.attester.length === 0, "Preliminary composition has NO attester block");

  // --------------------------------------------------------------------------
  // TEST 2: Missing ESI score must NOT fabricate an ESI Observation (no ESI-4 fallback)
  // --------------------------------------------------------------------------
  console.log("\n>>> TEST 2: Missing ESI score does not fabricate Observation");
  const esiObservations = incompleteBundle.entry?.filter(
    (e: any) =>
      e.resource?.resourceType === "Observation" &&
      e.resource?.code?.coding?.some((c: any) => c.code === "75636-1" || c.display?.includes("Emergency Severity Index"))
  );
  assert(esiObservations.length === 0, "Zero ESI Observation resources created when esiScore is undefined");

  // --------------------------------------------------------------------------
  // TEST 3: Missing ICD-10 codes must NOT fabricate Condition (no Z76.0 fallback)
  // --------------------------------------------------------------------------
  console.log("\n>>> TEST 3: Missing ICD-10 codes does not fabricate Condition");
  const conditions = incompleteBundle.entry?.filter(
    (e: any) => e.resource?.resourceType === "Condition"
  );
  assert(conditions.length === 0, "Zero Condition resources created when icd10Codes is empty");

  // --------------------------------------------------------------------------
  // TEST 4: Legitimate explicit Z76.0 is preserved when assigned
  // --------------------------------------------------------------------------
  console.log("\n>>> TEST 4: Explicit Z76.0 preservation");
  const legitZ76Bundle = generateFHIRBundle({
    id: "ENC-TEST-LEGIT-Z76",
    patientName: "Jane Smith",
    doctorId: "dr-sarah-chen",
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "General Physician",
    chiefComplaint: "Need repeat prescription for maintenance inhaler",
    icd10Codes: ["Z76.0"],
    esiScore: 4,
    status: "approved",
  });

  const z76Conditions = legitZ76Bundle.entry?.filter(
    (e: any) => e.resource?.resourceType === "Condition"
  );
  assert(z76Conditions.length === 1, "Exactly 1 Condition created for explicit Z76.0");
  assert(
    z76Conditions[0]?.resource?.code?.coding?.[0]?.code === "Z76.0",
    "Preserved explicit Z76.0 code"
  );

  const approvedComp = legitZ76Bundle.entry?.find(
    (e: any) => e.resource?.resourceType === "Composition"
  )?.resource;
  assert(approvedComp?.status === "final", "Approved composition has status 'final'");
  assert(approvedComp?.attester?.length === 1, "Approved composition has clinician attester");

  const approvedEsiObs = legitZ76Bundle.entry?.find(
    (e: any) =>
      e.resource?.resourceType === "Observation" &&
      e.resource?.code?.coding?.some((c: any) => c.code === "75636-1")
  )?.resource;
  assert(approvedEsiObs !== undefined, "ESI Observation generated when esiScore is explicitly provided");
  assert(approvedEsiObs?.status === "final", "Approved ESI Observation has status 'final'");
  assert(approvedEsiObs?.valueInteger === 4, "ESI Observation valueInteger matches provided score (4)");

  // --------------------------------------------------------------------------
  // TEST 5: XHTML narrative sanitization and escaping
  // --------------------------------------------------------------------------
  console.log("\n>>> TEST 5: XHTML narrative escaping in Section text");
  assert(escapeXhtml("Patient says <pain> & 'dizziness' \"severe\"") === "Patient says &lt;pain&gt; &amp; &apos;dizziness&apos; &quot;severe&quot;", "escapeXhtml correctly escapes <, >, &, ', and \"");

  const xssBundle = generateFHIRBundle({
    id: "ENC-TEST-XSS",
    patientName: "Alex <Alert> Jones",
    doctorId: "dr-sarah-chen",
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "General Physician",
    chiefComplaint: "Heart pain <script>alert(1)</script> & shortness of breath",
    soapSubjective: "Patient stated: \"I feel like I'm having a heart attack <A> & <B>\"",
    soapObjective: "Vitals: BP < 120/80 & HR > 60",
    soapAssessment: "Differential: Angina vs Costochondritis & GERD",
    soapPlan: "Plan: ECG & Troponin I < 0.04",
  });

  const compSections = xssBundle.entry?.find(
    (e: any) => e.resource?.resourceType === "Composition"
  )?.resource?.section;

  for (const sec of compSections || []) {
    const div: string = sec.text?.div || "";
    assert(!div.includes("<script>"), `Section '${sec.title}' does not contain unescaped script tag`);
    assert(!div.includes("<Alert>"), `Section '${sec.title}' does not contain unescaped Alert tag`);
    assert(!div.includes("<A>"), `Section '${sec.title}' does not contain unescaped <A> tag`);
    assert(div.startsWith('<div xmlns="http://www.w3.org/1999/xhtml">'), `Section '${sec.title}' has valid XHTML div prefix`);
    assert(div.endsWith('</div>'), `Section '${sec.title}' has valid XHTML div suffix`);
  }

  // --------------------------------------------------------------------------
  // TEST 6: Structural validation on all generated bundles
  // --------------------------------------------------------------------------
  console.log("\n>>> TEST 6: Structural R4 Bundle Validation");
  const val1 = validateFhirR4Bundle(incompleteBundle as unknown as Record<string, unknown>);
  assert(val1.valid, "Incomplete bundle passes FHIR R4 structural validator");

  const val2 = validateFhirR4Bundle(legitZ76Bundle as unknown as Record<string, unknown>);
  assert(val2.valid, "Approved Z76 bundle passes FHIR R4 structural validator");

  const val3 = validateFhirR4Bundle(xssBundle as unknown as Record<string, unknown>);
  assert(val3.valid, "Escaped XHTML bundle passes FHIR R4 structural validator");

  console.log("\n================================================================================");
  console.log(`TOTAL RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner threw uncaught error:", err);
  process.exit(1);
});
