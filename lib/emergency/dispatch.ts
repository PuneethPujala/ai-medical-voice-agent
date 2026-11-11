import crypto from "crypto";
import { z } from "zod";

export const EmergencyDispatchPayloadSchema = z.object({
  consultationId: z.string(),
  patientId: z.string().default("P-1002"),
  patientName: z.string().default("Anonymous Patient"),
  patientAge: z.union([z.number(), z.string()]).optional(),
  patientGender: z.string().optional(),
  esiScore: z.number().min(1).max(5).optional().nullable(),
  triageLevel: z.enum(["emergency", "priority", "routine"]),
  triageTitle: z.string(),
  redFlagsTriggered: z.array(z.string()).default([]),
  chiefComplaint: z.string(),
  icd10Codes: z.array(z.string()).default([]),
  detectedSymptoms: z.array(z.string()).default([]),
  targetHospitalId: z.string().optional(),
  targetHospitalName: z.string().default("Regional Emergency Trauma & Medical Center"),
  etaMinutes: z.number().default(10),
  timestamp: z.string().default(() => new Date().toISOString()),
});

export type EmergencyDispatchPayload = z.infer<typeof EmergencyDispatchPayloadSchema>;

export interface EmergencyDispatchReceipt {
  dispatchId: string;
  consultationId: string;
  hospitalName: string;
  intakeQueueStatus: "TRANSMITTED" | "ACKNOWLEDGED_BY_ED" | "TRIAGE_BAY_RESERVED";
  assignedHospitalBay: string;
  attendingPhysicianOnCall: string;
  etaMinutes: number;
  auditHash: string;
  tamperVerified: boolean;
  timestamp: string;
  preArrivalDirectives: string[];
}

/**
 * Computes a SHA-256 tamper-evident cryptographic hash for the clinical dispatch
 */
export function computeClinicalAuditHash(payload: {
  consultationId: string;
  patientId: string;
  timestamp: string;
  esiScore?: number | null;
  triageLevel: string;
  icd10Codes: string[];
  chiefComplaint: string;
}): string {
  const canonicalString = [
    payload.consultationId,
    payload.patientId,
    payload.timestamp,
    payload.esiScore ?? "unassessed",
    payload.triageLevel,
    payload.icd10Codes.slice().sort().join(","),
    payload.chiefComplaint.trim().toLowerCase(),
  ].join("|");

  return crypto.createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

/**
 * Verifies that a dispatch payload matches its cryptographic audit hash
 */
export function verifyClinicalAuditHash(
  payload: {
    consultationId: string;
    patientId: string;
    timestamp: string;
    esiScore?: number | null;
    triageLevel: string;
    icd10Codes: string[];
    chiefComplaint: string;
  },
  expectedHash: string
): boolean {
  const computed = computeClinicalAuditHash(payload);
  return computed === expectedHash;
}

/**
 * Builds ED pre-arrival clinical directives based on ESI score and red flags
 */
export function generatePreArrivalDirectives(esiScore: number | null | undefined, redFlags: string[]): {
  bay: string;
  physician: string;
  directives: string[];
} {
  const isCardiac = redFlags.some((r) => r.includes("ACS") || r.includes("CARDIAC"));
  const isStroke = redFlags.some((r) => r.includes("STROKE") || r.includes("BE_FAST") || r.includes("THUNDERCLAP"));
  const isAirway = redFlags.some((r) => r.includes("AIRWAY") || r.includes("RESPIRATORY") || r.includes("ANAPHYLAXIS"));

  if (esiScore === 1 || isAirway) {
    return {
      bay: "Resuscitation Bay 1 (Trauma / Critical Airway)",
      physician: "Dr. Rachel Rivera, MD (Chief of Trauma Resuscitation)",
      directives: [
        "Prepare immediate Rapid Sequence Intubation (RSI) tray & high-flow oxygen",
        "Draw emergency STAT ABG, Troponin, CBC, and Coagulation panel",
        "Continuous 12-lead telemetry & IV access x2 large-bore",
        "Alert On-Call Respiratory Therapist and Anesthesia Team",
      ],
    };
  }

  if (isStroke) {
    return {
      bay: "Neuro-Acute Bay 2 (Rapid CT Path)",
      physician: "Dr. Alan Mercer, MD (Stroke Interventionalist)",
      directives: [
        "Clear CT Scanner for immediate emergent non-contrast Head CT",
        "Alert Rapid Response Stroke Team & Teleneurology Attending",
        "Verify last known normal (LKN) time window for IV Thrombolysis (tPA/TNK)",
        "Check blood glucose STAT to rule out hypoglycemic stroke mimic",
      ],
    };
  }

  if (isCardiac) {
    return {
      bay: "Cardiac Care Bay 4 (Cath Lab Fast-Track)",
      physician: "Dr. Marcus Thorne, MD (Interventional Cardiology)",
      directives: [
        "12-Lead ECG within 5 minutes of door arrival",
        "Alert Cardiac Catheterization Lab team for emergent PCI readiness",
        "Administer 325mg chewable aspirin if not taken pre-arrival",
        "Prepare bedside echocardiography and serial high-sensitivity Troponin",
      ],
    };
  }

  if (esiScore === 2) {
    return {
      bay: "Acute Emergency Bay 5",
      physician: "Dr. Karen Diaz, MD (Emergency Medicine Attending)",
      directives: [
        "Immediate nursing triage assessment & continuous vital signs monitor",
        "Targeted diagnostic workup based on presenting complaint",
        "IV line establishment and baseline laboratory panel",
      ],
    };
  }

  return {
    bay: "Urgent Care Ambulatory Bay 8",
    physician: "Dr. James Miller, MD (Staff Physician)",
    directives: [
      "Standard intake vitals registration",
      "Focused physical examination upon room assignment",
      "Symptomatic management as clinically indicated",
    ],
  };
}
