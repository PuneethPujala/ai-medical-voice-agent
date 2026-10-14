import { generateFHIRBundle, validateFhirR4Bundle } from "../../lib/fhir/bundle";

function runFHIRValidation() {
  console.log("==============================================================================");
  console.log("       HL7 FHIR R4 INTEROPERABILITY ENGINE TEST & CONFORMANCE SUITE          ");
  console.log("==============================================================================");

  const mockEmergencyRecord = {
    id: "MED-TEST-9921",
    patientName: "Johnathan Doe",
    patientGender: "male",
    patientAge: 58,
    doctorId: "dr-sarah-chen",
    doctorName: "Dr. Sarah Chen, MD",
    specialty: "Interventional Cardiology",
    chiefComplaint: "Crushing chest pain radiating to left arm with diaphoresis",
    triageLevel: "emergency" as const,
    triageTitle: "ESI LEVEL 2: EMERGENT — SUSPECTED ACUTE CORONARY SYNDROME (ACS)",
    esiScore: 2,
    icd10Codes: ["I20.9", "I21.9", "R07.9"],
    detectedSymptoms: ["Substernal chest pressure", "Pain radiating to left arm", "Diaphoresis / cold sweats"],
    soapSubjective: "58yo male presents with 45 minutes of acute crushing substernal chest pressure.",
    soapObjective: "Diaphoretic, pale. Arbiter detected high-risk ischemic cardiac features.",
    soapAssessment: "Suspected Acute Coronary Syndrome (ACS) / NSTEMI vs STEMI.",
    soapPlan: "Immediate EMS transfer to nearest 24/7 Cardiac Cath Lab facility. 325mg chewable aspirin.",
    recommendedAction: "Proceed immediately to Emergency Department with PCI Cath Lab.",
    createdAt: new Date("2026-09-04T12:00:00Z"),
  };

  const bundle = generateFHIRBundle(mockEmergencyRecord);

  // Assertions
  console.log(`\n[1/6] Validating Bundle Root Structure:`);
  if (bundle.resourceType !== "Bundle") throw new Error("Root resourceType must be 'Bundle'");
  if (bundle.type !== "document") throw new Error("Bundle type must be 'document'");
  if (!bundle.entry || bundle.entry.length === 0) throw new Error("Bundle must contain entries");
  console.log(`  ✓ Bundle ID: ${bundle.id}`);
  console.log(`  ✓ Bundle Type: ${bundle.type} (Profile: ${bundle.meta.profile[0]})`);
  console.log(`  ✓ Total Resource Entries: ${bundle.entry.length}`);

  // Composition validation (Rule: FHIR document bundle MUST start with Composition)
  console.log(`\n[2/6] Validating Composition (Document Header):`);
  const firstResource = bundle.entry[0].resource;
  if (firstResource.resourceType !== "Composition") {
    throw new Error("First entry in a FHIR document bundle must be a Composition resource");
  }
  if (firstResource.type.coding[0].code !== "11488-4") {
    throw new Error("Composition type LOINC must be 11488-4 (Consultation note)");
  }
  if (firstResource.section.length !== 4) {
    throw new Error(`Expected 4 SOAP sections, found ${firstResource.section.length}`);
  }
  console.log(`  ✓ Composition Status: ${firstResource.status}`);
  console.log(`  ✓ Document Type: ${firstResource.type.coding[0].display} (LOINC: ${firstResource.type.coding[0].code})`);
  console.log(`  ✓ SOAP Sections Verified: ${firstResource.section.map((s: any) => s.title.split(" ")[0]).join(", ")}`);

  // Patient resource validation
  console.log(`\n[3/6] Validating Patient Demographics Resource:`);
  const patientEntry = bundle.entry.find((e) => e.resource.resourceType === "Patient");
  if (!patientEntry) throw new Error("Missing Patient resource");
  if (patientEntry.resource.name[0].text !== "Johnathan Doe") throw new Error("Patient name mismatch");
  if (patientEntry.resource.gender !== "male") throw new Error("Patient gender mismatch");
  console.log(`  ✓ Patient: ${patientEntry.resource.name[0].text}, Gender: ${patientEntry.resource.gender}`);

  // Encounter resource validation
  console.log(`\n[4/6] Validating Encounter & Emergency Classification:`);
  const encounterEntry = bundle.entry.find((e) => e.resource.resourceType === "Encounter");
  if (!encounterEntry) throw new Error("Missing Encounter resource");
  if (encounterEntry.resource.class.code !== "EMER") throw new Error("Emergency encounter must have class 'EMER'");
  console.log(`  ✓ Encounter Class: ${encounterEntry.resource.class.code} (${encounterEntry.resource.class.display})`);
  console.log(`  ✓ Encounter Priority: ${encounterEntry.resource.priority.coding[0].code}`);

  // Observation (ESI Score) validation
  console.log(`\n[5/6] Validating ESI Triage Observation:`);
  const obsEntry = bundle.entry.find((e) => e.resource.resourceType === "Observation");
  if (!obsEntry) throw new Error("Missing Observation resource");
  if (obsEntry.resource.code.coding[0].code !== "75636-1") throw new Error("Expected LOINC 75636-1 for ESI score");
  if (obsEntry.resource.valueInteger !== 2) throw new Error("Expected ESI score valueInteger: 2");
  console.log(`  ✓ Observation Code: ${obsEntry.resource.code.coding[0].code} (${obsEntry.resource.code.coding[0].display})`);
  console.log(`  ✓ ESI Score Value: ${obsEntry.resource.valueInteger}`);

  // Condition (ICD-10) validation
  console.log(`\n[6/6] Validating Condition Diagnosis Resources:`);
  const conditions = bundle.entry.filter((e) => e.resource.resourceType === "Condition");
  if (conditions.length !== 3) throw new Error(`Expected 3 conditions, found ${conditions.length}`);
  conditions.forEach((c) => {
    const code = c.resource.code.coding[0].code;
    const display = c.resource.code.coding[0].display;
    console.log(`  ✓ ICD-10 Condition: [${code}] ${display}`);
  });

  // 7. Deterministic validateFhirR4Bundle Engine Verification
  console.log(`\n[7/7] Validating with validateFhirR4Bundle Validator Engine:`);
  const validationResult = validateFhirR4Bundle(bundle as unknown as Record<string, unknown>);
  if (!validationResult.valid) {
    throw new Error(`Generated bundle unexpectedly failed validator: ${JSON.stringify(validationResult.issues)}`);
  }
  console.log(`  ✓ Valid Bundle: PASS (0 errors)`);

  // Negative Invariant 1: Invalid resourceType
  const badTypeResult = validateFhirR4Bundle({ ...bundle, resourceType: "Patient" } as any);
  if (badTypeResult.valid || !badTypeResult.issues.some((i) => i.location === "Bundle.resourceType")) {
    throw new Error("Failed to catch invalid Bundle.resourceType");
  }
  console.log(`  ✓ Reject Non-Bundle Root: PASS`);

  // Negative Invariant 2: Invalid bundle type
  const badBundleTypeResult = validateFhirR4Bundle({ ...bundle, type: "searchset" } as any);
  if (badBundleTypeResult.valid || !badBundleTypeResult.issues.some((i) => i.location === "Bundle.type")) {
    throw new Error("Failed to catch invalid Bundle.type");
  }
  console.log(`  ✓ Reject Unsupported Bundle Type: PASS`);

  // Negative Invariant 3: Empty entry array
  const emptyEntryResult = validateFhirR4Bundle({ ...bundle, entry: [] } as any);
  if (emptyEntryResult.valid || !emptyEntryResult.issues.some((i) => i.location === "Bundle.entry")) {
    throw new Error("Failed to catch empty Bundle.entry");
  }
  console.log(`  ✓ Reject Empty Entry Array: PASS`);

  // Negative Invariant 4: Missing Patient resource
  const noPatientResult = validateFhirR4Bundle({
    ...bundle,
    entry: bundle.entry.filter((e) => e.resource.resourceType !== "Patient"),
  } as any);
  if (noPatientResult.valid || !noPatientResult.issues.some((i) => i.diagnostics.includes("Patient resource"))) {
    throw new Error("Failed to catch missing Patient resource");
  }
  console.log(`  ✓ Reject Missing Patient Resource: PASS`);

  // Negative Invariant 5: Resource missing logical id
  const noIdResult = validateFhirR4Bundle({
    ...bundle,
    entry: [
      {
        fullUrl: "urn:uuid:test-1",
        resource: { resourceType: "Patient" },
      },
    ],
  } as any);
  if (noIdResult.valid || !noIdResult.issues.some((i) => i.diagnostics.includes("missing mandatory logical id"))) {
    throw new Error("Failed to catch resource missing logical id");
  }
  console.log(`  ✓ Reject Resource Without Logical Id: PASS`);

  console.log("\n==============================================================================");
  console.log("✅ ALL HL7 FHIR R4 SPECIFICATION & CONFORMANCE TESTS PASSED (100% VALID)");
  console.log("==============================================================================\n");
}

runFHIRValidation();

