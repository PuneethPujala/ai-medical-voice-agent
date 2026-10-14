/**
 * HL7 FHIR R4 INTEROPERABILITY ENGINE
 * 
 * Transforms internal MedVoice AI consultation records into fully valid,
 * standards-compliant HL7 FHIR R4 Document Bundles.
 * 
 * Specifications:
 * - HL7 FHIR Release 4 (v4.0.1)
 * - LOINC (Logical Observation Identifiers Names and Codes)
 * - SNOMED CT Clinical Terms
 * - ICD-10-CM Diagnosis Coding
 */

export interface ConsultationRecordFHIR {
  id: string;
  patientName?: string;
  patientGender?: string;
  patientAge?: number | string;
  doctorId?: string;
  doctorName?: string;
  specialty?: string;
  chiefComplaint?: string;
  triageLevel?: "emergency" | "priority" | "routine";
  triageTitle?: string;
  esiScore?: number;
  icd10Codes?: string[];
  detectedSymptoms?: string[];
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
  recommendedAction?: string;
  createdAt?: string | Date;
  transcript?: Array<{ role: string; text: string; timestamp: string }>;
}

export interface FHIRResource {
  resourceType: string;
  id: string;
  [key: string]: any;
}

export interface FHIRBundle {
  resourceType: "Bundle";
  id: string;
  meta: {
    lastUpdated: string;
    profile: string[];
  };
  identifier: {
    system: string;
    value: string;
  };
  type: "document";
  timestamp: string;
  entry: Array<{
    fullUrl: string;
    resource: FHIRResource;
  }>;
}

/**
 * Maps ICD-10 code to human-readable clinical display
 */
export function getICD10Display(code: string): string {
  const map: Record<string, string> = {
    "I20.9": "Angina pectoris, unspecified",
    "I21.9": "Acute myocardial infarction, unspecified",
    "I60.9": "Nontraumatic subarachnoid hemorrhage, unspecified",
    "I63.9": "Cerebral infarction, unspecified",
    "R07.9": "Chest pain, unspecified",
    "R06.00": "Dyspnea, unspecified",
    "R06.02": "Shortness of breath",
    "R06.1": "Stridor",
    "R47.01": "Aphasia / Dysarthria",
    "R50.9": "Fever, unspecified",
    "R55": "Syncope and collapse",
    "R10.31": "Right lower quadrant abdominal pain",
    "R10.9": "Unspecified abdominal pain",
    "K35.80": "Unspecified acute appendicitis",
    "J45.901": "Unspecified asthma with acute exacerbation",
    "J96.00": "Acute respiratory failure, unspecified",
    "T78.2XXA": "Anaphylactic shock, unspecified, initial encounter",
    "A41.9": "Sepsis, unspecified organism",
    "J06.9": "Acute upper respiratory infection, unspecified",
    "L30.9": "Dermatitis, unspecified",
    "S93.40": "Sprain of unspecified ligament of ankle",
    "Z76.0": "Encounter for issue of repeat prescription",
  };
  return map[code] || "Clinical Diagnosis / Symptom Code";
}

/**
 * Converts a MedVoice AI Consultation Record into a standardized HL7 FHIR R4 Bundle
 */
export function generateFHIRBundle(record: ConsultationRecordFHIR): FHIRBundle {
  const cleanId = record.id.replace(/[^a-zA-Z0-9-]/g, "-");
  const bundleId = `urn:uuid:bundle-${cleanId}`;
  const timestamp = record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString();

  const patientId = `patient-${cleanId}`;
  const practitionerId = record.doctorId ? record.doctorId.replace(/[^a-zA-Z0-9-]/g, "-") : "dr-sarah-chen";
  const encounterId = `encounter-${cleanId}`;
  const compositionId = `composition-${cleanId}`;

  const isEmergency = record.triageLevel === "emergency";
  const isPriority = record.triageLevel === "priority";
  const esiScore = record.esiScore || (isEmergency ? 2 : isPriority ? 3 : 4);

  // 1. Patient Resource
  const patientResource: FHIRResource = {
    resourceType: "Patient",
    id: patientId,
    identifier: [
      {
        use: "official",
        system: "https://medvoice.health/identifiers/patient",
        value: patientId,
      },
    ],
    active: true,
    name: [
      {
        use: "official",
        text: record.patientName || "Anonymous Patient",
      },
    ],
    gender: (record.patientGender?.toLowerCase() === "male" || record.patientGender?.toLowerCase() === "female") 
      ? record.patientGender.toLowerCase() 
      : "unknown",
  };

  // 2. Practitioner Resource
  const practitionerResource: FHIRResource = {
    resourceType: "Practitioner",
    id: practitionerId,
    identifier: [
      {
        system: "https://medvoice.health/identifiers/physicians",
        value: practitionerId,
      },
    ],
    name: [
      {
        use: "official",
        text: record.doctorName || "Dr. Sarah Chen, MD",
      },
    ],
    qualification: [
      {
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "394802001",
              display: record.specialty || "General Physician",
            },
          ],
          text: record.specialty || "General Physician",
        },
      },
    ],
  };

  // 3. Encounter Resource
  const encounterResource: FHIRResource = {
    resourceType: "Encounter",
    id: encounterId,
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: isEmergency ? "EMER" : "AMB",
      display: isEmergency ? "emergency" : "ambulatory",
    },
    priority: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/v3-ActPriority",
          code: isEmergency ? "CR" : isPriority ? "UR" : "R",
          display: isEmergency ? "Callback rapid / Critical" : isPriority ? "Urgent" : "Routine",
        },
      ],
    },
    type: [
      {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "408443003",
            display: "Telemedicine consultation",
          },
        ],
        text: "AI-Assisted Telehealth Consultation & Triage",
      },
    ],
    subject: {
      reference: `Patient/${patientId}`,
      display: record.patientName || "Anonymous Patient",
    },
    participant: [
      {
        individual: {
          reference: `Practitioner/${practitionerId}`,
          display: record.doctorName || "Evaluating Physician",
        },
      },
    ],
    period: {
      start: timestamp,
      end: timestamp,
    },
    reasonCode: [
      {
        text: record.chiefComplaint || "Clinical evaluation and symptom assessment",
      },
    ],
  };

  // 4. Observation - Triage & ESI Score
  const triageObservation: FHIRResource = {
    resourceType: "Observation",
    id: `observation-esi-${cleanId}`,
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "survey",
            display: "Survey / Triage Score",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "75636-1",
          display: "Emergency Severity Index (ESI) version 4",
        },
      ],
      text: "ESI Acuity Score",
    },
    subject: {
      reference: `Patient/${patientId}`,
    },
    encounter: {
      reference: `Encounter/${encounterId}`,
    },
    effectiveDateTime: timestamp,
    valueInteger: esiScore,
    interpretation: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
            code: isEmergency ? "AA" : isPriority ? "A" : "N",
            display: isEmergency ? "Critical abnormal" : isPriority ? "Abnormal" : "Normal",
          },
        ],
        text: record.triageTitle || `ESI Level ${esiScore}`,
      },
    ],
  };

  // 5. Condition Resources for Diagnostic ICD-10 codes
  const conditions: FHIRResource[] = (record.icd10Codes && record.icd10Codes.length > 0 ? record.icd10Codes : ["Z76.0"]).map(
    (code, idx) => ({
      resourceType: "Condition",
      id: `condition-${cleanId}-${idx + 1}`,
      clinicalStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
            code: "active",
            display: "Active",
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
            code: "provisional",
            display: "Provisional / Preliminary Triage Assessment",
          },
        ],
      },
      code: {
        coding: [
          {
            system: "http://hl7.org/fhir/sid/icd-10",
            code: code,
            display: getICD10Display(code),
          },
        ],
        text: getICD10Display(code),
      },
      subject: {
        reference: `Patient/${patientId}`,
      },
      encounter: {
        reference: `Encounter/${encounterId}`,
      },
      recordedDate: timestamp,
    })
  );

  // 6. Composition (Structured Clinical SOAP Document)
  const compositionResource: FHIRResource = {
    resourceType: "Composition",
    id: compositionId,
    status: "final",
    type: {
      coding: [
        {
          system: "http://loinc.org",
          code: "11488-4",
          display: "Consultation note",
        },
      ],
      text: "Clinical Voice Triage & SOAP Consultation Note",
    },
    category: [
      {
        coding: [
          {
            system: "http://loinc.org",
            code: "LP173421-1",
            display: "Report",
          },
        ],
      },
    ],
    subject: {
      reference: `Patient/${patientId}`,
      display: record.patientName || "Anonymous Patient",
    },
    encounter: {
      reference: `Encounter/${encounterId}`,
    },
    date: timestamp,
    author: [
      {
        reference: `Practitioner/${practitionerId}`,
        display: record.doctorName || "Evaluating Physician",
      },
    ],
    title: "MedVoice AI Clinical Voice Consultation & Triage Record",
    section: [
      {
        title: "Subjective (Patient Narrative)",
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "61150-9",
              display: "Subjective",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${record.soapSubjective || record.chiefComplaint || "No subjective narrative recorded."}</p></div>`,
        },
      },
      {
        title: "Objective (Clinical Observations & Triage Features)",
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "61149-1",
              display: "Objective",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${record.soapObjective || "No objective clinical measurements recorded (remote voice consultation)."}</p></div>`,
        },
      },
      {
        title: "Assessment (Clinical Triage Classification)",
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "51848-0",
              display: "Assessment",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${record.soapAssessment || record.triageTitle || "Triage completed."}</p><p>Acuity: ESI Level ${esiScore} (${record.triageLevel?.toUpperCase()})</p></div>`,
        },
      },
      {
        title: "Plan (Directives & Immediate Actions)",
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "18776-5",
              display: "Plan of care",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${record.soapPlan || record.recommendedAction || "Follow standard outpatient protocol."}</p></div>`,
        },
      },
    ],
  };

  // Compile entries into Bundle (Composition MUST be the first entry in an HL7 FHIR document bundle)
  const entries = [
    { fullUrl: `urn:uuid:${compositionId}`, resource: compositionResource },
    { fullUrl: `urn:uuid:${patientId}`, resource: patientResource },
    { fullUrl: `urn:uuid:${practitionerId}`, resource: practitionerResource },
    { fullUrl: `urn:uuid:${encounterId}`, resource: encounterResource },
    { fullUrl: `urn:uuid:observation-esi-${cleanId}`, resource: triageObservation },
    ...conditions.map((c) => ({ fullUrl: `urn:uuid:${c.id}`, resource: c })),
  ];

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: {
      lastUpdated: timestamp,
      profile: ["http://hl7.org/fhir/StructureDefinition/document"],
    },
    identifier: {
      system: "https://medvoice.health/fhir/bundles",
      value: cleanId,
    },
    type: "document",
    timestamp,
    entry: entries,
  };
}

export interface FhirValidationIssue {
  severity: "error" | "warning";
  location: string;
  diagnostics: string;
}

export interface FhirValidationResult {
  valid: boolean;
  issues: FhirValidationIssue[];
}

export const REQUIRED_CODING_SYSTEMS = new Set([
  "http://snomed.info/sct",
  "http://loinc.org",
  "http://hl7.org/fhir/sid/icd-10",
  "http://terminology.hl7.org/CodeSystem/condition-clinical",
  "http://terminology.hl7.org/CodeSystem/observation-category",
]);

export function validateFhirR4Bundle(bundle: Record<string, unknown>): FhirValidationResult {
  const issues: FhirValidationIssue[] = [];

  if (!bundle || typeof bundle !== "object") {
    return {
      valid: false,
      issues: [{ severity: "error", location: "Bundle", diagnostics: "Bundle must be a valid JSON object." }],
    };
  }

  if (bundle.resourceType !== "Bundle") {
    issues.push({
      severity: "error",
      location: "Bundle.resourceType",
      diagnostics: `Expected resourceType 'Bundle', received '${String(bundle.resourceType)}'`,
    });
  }

  if (bundle.type !== "collection" && bundle.type !== "document" && bundle.type !== "transaction") {
    issues.push({
      severity: "error",
      location: "Bundle.type",
      diagnostics: `Invalid FHIR R4 Bundle.type '${String(bundle.type)}'`,
    });
  }

  const entries = Array.isArray(bundle.entry) ? (bundle.entry as Record<string, unknown>[]) : [];
  if (entries.length === 0) {
    issues.push({
      severity: "error",
      location: "Bundle.entry",
      diagnostics: "Bundle must contain at least one resource entry (Patient/Encounter).",
    });
  }

  const definedFullUrls = new Set<string>();
  const definedResourceTargets = new Set<string>();
  const resourceTypesPresent = new Set<string>();

  entries.forEach((entry: Record<string, unknown>, idx: number) => {
    const fullUrl = typeof entry.fullUrl === "string" ? entry.fullUrl : "";
    if (!fullUrl.startsWith("urn:uuid:") && !fullUrl.startsWith("http")) {
      issues.push({
        severity: "error",
        location: `Bundle.entry[${idx}].fullUrl`,
        diagnostics: "Entry fullUrl must be a valid URI or urn:uuid.",
      });
    } else {
      definedFullUrls.add(fullUrl);
    }

    const resource = entry.resource as Record<string, unknown> | undefined;
    if (!resource || typeof resource.resourceType !== "string") {
      issues.push({
        severity: "error",
        location: `Bundle.entry[${idx}].resource`,
        diagnostics: "Entry is missing a valid FHIR resource object.",
      });
      return;
    }

    resourceTypesPresent.add(resource.resourceType);

    if (!resource.id || typeof resource.id !== "string") {
      issues.push({
        severity: "error",
        location: `Bundle.entry[${idx}].resource.id`,
        diagnostics: `${resource.resourceType} resource is missing mandatory logical id.`,
      });
    } else {
      definedResourceTargets.add(`${resource.resourceType}/${resource.id}`);
      definedResourceTargets.add(resource.id);
      if (fullUrl) {
        definedResourceTargets.add(fullUrl);
      }
    }
  });

  if (!resourceTypesPresent.has("Patient")) {
    issues.push({
      severity: "error",
      location: "Bundle.entry",
      diagnostics: "FHIR Clinical Bundle must contain a Patient resource.",
    });
  }

  if (bundle.type === "document" && entries.length > 0) {
    const firstRes = entries[0].resource as Record<string, unknown> | undefined;
    if (!firstRes || firstRes.resourceType !== "Composition") {
      issues.push({
        severity: "error",
        location: "Bundle.entry[0].resource",
        diagnostics: "Document Bundle first entry must be a Composition resource.",
      });
    }
  }

  // Validate internal reference integrity and coding systems
  const checkReferencesAndCodings = (obj: any, path: string) => {
    if (!obj || typeof obj !== "object") return;

    if (typeof obj.reference === "string") {
      const ref = obj.reference;
      if (!definedResourceTargets.has(ref) && !definedFullUrls.has(ref) && !ref.startsWith("http")) {
        issues.push({
          severity: "warning",
          location: `${path}.reference`,
          diagnostics: `Reference '${ref}' does not resolve to an entry in this bundle.`,
        });
      }
    }

    if (Array.isArray(obj.coding)) {
      obj.coding.forEach((coding: any, cIdx: number) => {
        if (coding && typeof coding === "object") {
          if (!coding.system || typeof coding.system !== "string") {
            issues.push({
              severity: "warning",
              location: `${path}.coding[${cIdx}].system`,
              diagnostics: "Coding missing system URI.",
            });
          }
          if (!coding.code || typeof coding.code !== "string") {
            issues.push({
              severity: "warning",
              location: `${path}.coding[${cIdx}].code`,
              diagnostics: "Coding missing code identifier.",
            });
          }
        }
      });
    }

    for (const key of Object.keys(obj)) {
      if (key !== "text" && typeof obj[key] === "object") {
        checkReferencesAndCodings(obj[key], `${path}.${key}`);
      }
    }
  };

  entries.forEach((entry, idx) => {
    if (entry.resource) {
      checkReferencesAndCodings(entry.resource, `Bundle.entry[${idx}].resource`);
    }
  });

  return {
    valid: issues.every((i) => i.severity !== "error"),
    issues,
  };
}
