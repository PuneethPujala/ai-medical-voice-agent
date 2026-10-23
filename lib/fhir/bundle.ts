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

import { LiveAudioMetrics } from "../acoustic/acoustic-dsp-analyzer";
import { SpeechFeatures } from "../agents/schemas";

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
  audioMetrics?: LiveAudioMetrics | Partial<LiveAudioMetrics>;
  speechFeatures?: SpeechFeatures | Partial<SpeechFeatures>;
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

  // 5b. Paralinguistic Acoustic Telemetry Observation (Optional, only if audio metrics present)
  let acousticObservation: FHIRResource | null = null;
  const audioMetrics = record.audioMetrics;
  const speechFeatures = record.speechFeatures;

  const hasAcousticData = Boolean(
    (audioMetrics && (
      (audioMetrics.durationMs !== undefined && audioMetrics.durationMs > 0) ||
      (audioMetrics.meanF0Hz !== null && audioMetrics.meanF0Hz !== undefined) ||
      (audioMetrics.speechPauseRatio !== undefined)
    )) ||
    (speechFeatures && speechFeatures.speech_rate_wpm !== undefined)
  );

  if (hasAcousticData) {
    const acousticComponents: any[] = [];

    // Component 1: Fundamental Frequency (f0) - strictly only if voiced and valid
    if (audioMetrics?.meanF0Hz !== null && audioMetrics?.meanF0Hz !== undefined && audioMetrics.meanF0Hz > 0) {
      acousticComponents.push({
        code: {
          coding: [
            {
              system: "https://medvoice.health/fhir/CodeSystem/acoustic-metrics",
              code: "mean-f0",
              display: "Mean fundamental frequency (f0)",
            },
          ],
          text: "Mean Fundamental Frequency",
        },
        valueQuantity: {
          value: audioMetrics.meanF0Hz,
          unit: "Hz",
          system: "http://unitsofmeasure.org",
          code: "Hz",
        },
      });
    }

    // Component 2: Speech Rate in Words Per Minute
    if (speechFeatures?.speech_rate_wpm !== undefined && speechFeatures.speech_rate_wpm !== null) {
      acousticComponents.push({
        code: {
          coding: [
            {
              system: "https://medvoice.health/fhir/CodeSystem/acoustic-metrics",
              code: "speech-rate",
              display: "Speech rate in words per minute",
            },
          ],
          text: "Speech Rate",
        },
        valueQuantity: {
          value: speechFeatures.speech_rate_wpm,
          unit: "{words}/min",
          system: "http://unitsofmeasure.org",
          code: "{words}/min",
        },
      });
    }

    // Component 3: Conversational Pause-to-Speech Ratio
    if (audioMetrics?.speechPauseRatio !== undefined && audioMetrics.speechPauseRatio !== null) {
      acousticComponents.push({
        code: {
          coding: [
            {
              system: "https://medvoice.health/fhir/CodeSystem/acoustic-metrics",
              code: "speech-pause-ratio",
              display: "Conversational pause-to-speech ratio",
            },
          ],
          text: "Speech-to-Pause Ratio",
        },
        valueQuantity: {
          value: audioMetrics.speechPauseRatio,
          unit: "{ratio}",
          system: "http://unitsofmeasure.org",
          code: "1",
        },
      });
    }

    // Component 4: Mean Conversational Pause Duration
    if (audioMetrics?.meanPauseDurationMs !== undefined && audioMetrics.meanPauseDurationMs !== null && audioMetrics.meanPauseDurationMs > 0) {
      acousticComponents.push({
        code: {
          coding: [
            {
              system: "https://medvoice.health/fhir/CodeSystem/acoustic-metrics",
              code: "mean-pause-duration",
              display: "Mean conversational pause duration",
            },
          ],
          text: "Mean Pause Duration",
        },
        valueQuantity: {
          value: audioMetrics.meanPauseDurationMs,
          unit: "ms",
          system: "http://unitsofmeasure.org",
          code: "ms",
        },
      });
    }

    // Component 5: Voice Fundamental Frequency Pitch Variability
    if (audioMetrics?.pitchVariance !== undefined && audioMetrics.pitchVariance !== null && audioMetrics.pitchVariance > 0) {
      acousticComponents.push({
        code: {
          coding: [
            {
              system: "https://medvoice.health/fhir/CodeSystem/acoustic-metrics",
              code: "pitch-variability",
              display: "Voice fundamental frequency pitch variability",
            },
          ],
          text: "Pitch Variability (f0 CV)",
        },
        valueQuantity: {
          value: audioMetrics.pitchVariance,
          unit: "{ratio}",
          system: "http://unitsofmeasure.org",
          code: "1",
        },
      });
    }

    // Component 6: Voice RMS Energy Variability
    if (audioMetrics?.energyVariance !== undefined && audioMetrics.energyVariance !== null) {
      acousticComponents.push({
        code: {
          coding: [
            {
              system: "https://medvoice.health/fhir/CodeSystem/acoustic-metrics",
              code: "energy-variability",
              display: "Voice acoustic RMS energy variability",
            },
          ],
          text: "Voice Energy Variability",
        },
        valueQuantity: {
          value: audioMetrics.energyVariance,
          unit: "{ratio}",
          system: "http://unitsofmeasure.org",
          code: "1",
        },
      });
    }

    // Component 7: Total Analyzed Audio Duration
    if (audioMetrics?.durationMs !== undefined && audioMetrics.durationMs !== null && audioMetrics.durationMs > 0) {
      acousticComponents.push({
        code: {
          coding: [
            {
              system: "https://medvoice.health/fhir/CodeSystem/acoustic-metrics",
              code: "analyzed-audio-duration",
              display: "Total duration of speech audio analyzed",
            },
          ],
          text: "Analyzed Audio Duration",
        },
        valueQuantity: {
          value: audioMetrics.durationMs,
          unit: "ms",
          system: "http://unitsofmeasure.org",
          code: "ms",
        },
      });
    }

    acousticObservation = {
      resourceType: "Observation",
      id: `observation-acoustic-${cleanId}`,
      status: "final",
      category: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "exam",
              display: "Exam",
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: "https://medvoice.health/fhir/CodeSystem/acoustic-metrics",
            code: "voice-paralinguistic-panel",
            display: "MedVoice Acoustic & Paralinguistic Speech Telemetry Panel",
          },
        ],
        text: "Acoustic & Speech Paralinguistic Telemetry Panel",
      },
      subject: {
        reference: `Patient/${patientId}`,
      },
      encounter: {
        reference: `Encounter/${encounterId}`,
      },
      effectiveDateTime: timestamp,
      issued: timestamp,
      method: {
        coding: [
          {
            system: "https://medvoice.health/fhir/CodeSystem/measurement-methods",
            code: "in-browser-dsp-autocorrelation",
            display: "Web Audio DSP 25ms Frame Normalized Autocorrelation & RMS Telemetry",
          },
        ],
        text: "Client-side Web Audio DSP (25ms window, 10ms hop, -38 dBFS VAD)",
      },
      device: {
        display: "MedVoice In-Browser DSP Acoustic Telemetry Analyzer v3.1",
      },
      component: acousticComponents,
      note: [
        {
          text: "Clinical Safety Invariant: Acoustic telemetry reflects observational speech characteristics measured over the consultation. It does not establish clinical diagnoses, assign triage acuity, or override clinician judgment.",
        },
      ],
    };
  }

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
          div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${record.soapObjective || "No objective clinical measurements recorded (remote voice consultation)."}</p>${
            acousticObservation
              ? `<p><strong>Paralinguistic Acoustic Telemetry:</strong> Mean f0: ${audioMetrics?.meanF0Hz ? `${audioMetrics.meanF0Hz} Hz` : "unvoiced / not detected"}, Speech Rate: ${speechFeatures?.speech_rate_wpm ? `${speechFeatures.speech_rate_wpm} WPM` : "N/A"}, Pause Ratio: ${audioMetrics?.speechPauseRatio ?? "N/A"} (Ref: Observation/observation-acoustic-${cleanId})</p>`
              : ""
          }</div>`,
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
    ...(acousticObservation ? [{ fullUrl: `urn:uuid:${acousticObservation.id}`, resource: acousticObservation }] : []),
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
  "https://medvoice.health/fhir/CodeSystem/acoustic-metrics",
  "https://medvoice.health/fhir/CodeSystem/measurement-methods",
  "http://unitsofmeasure.org",
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
