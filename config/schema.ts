import { integer, serial, pgTable, varchar, text, doublePrecision, boolean, timestamp, jsonb, json, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AttributedClinicalFactV3, UnmappedObservation, DeliveredTurnRecord } from "@/lib/agents/schemas";
import type { ClinicalInterviewState } from "@/lib/triage/conversation-manager";

export const usersTable = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  email: varchar({ length: 255 }).notNull().unique(),
  credits: integer()
});

/**
 * Production Healthcare Facility Schema
 * Separates Government Source Facts (ABDM HFR / OGD), External Enrichment (Ratings / Maps), and MedVoice Derived Metadata.
 */
export const hospitalsTable = pgTable("hospitals", {
  // 1. PRIMARY IDENTITY & GOVERNMENT SOURCE FACTS (ABDM HFR / OGD National Hospital Directory)
  id: varchar("id", { length: 128 }).primaryKey(),
  hfrId: varchar("hfr_id", { length: 128 }), // Ayushman Bharat Digital Mission (ABDM) HFR Registry ID
  ogdId: varchar("ogd_id", { length: 128 }), // Government of India OGD Directory ID
  name: text("name").notNull(),
  facilityType: varchar("facility_type", { length: 128 }), // e.g. "Tertiary Care Hospital", "Medical College"
  ownership: varchar("ownership", { length: 128 }), // e.g. "Public / Govt", "Private Trust"
  address: text("address").notNull(),
  city: varchar("city", { length: 128 }).notNull(),
  state: varchar("state", { length: 128 }).notNull(),
  pincode: varchar("pincode", { length: 32 }),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  phone: varchar("phone", { length: 64 }),
  emergencyPhone: varchar("emergency_phone", { length: 64 }),
  isEmergency24x7: boolean("is_emergency_24x7").default(true),
  officialSpecialties: jsonb("official_specialties").$type<string[]>(),

  // 2. EXTERNAL ENRICHMENT (Google Places API / OpenStreetMap / Accreditation Bodies)
  rating: doublePrecision("rating"),
  ratingSource: varchar("rating_source", { length: 128 }), // e.g. "Google Places Commercial API"
  accreditations: jsonb("accreditations").$type<string[]>(), // e.g. ["NABH", "JCI", "NABL"]
  mapGeometrySource: varchar("map_geometry_source", { length: 128 }).default("OpenStreetMap / Overpass"),

  // 3. MEDVOICE DERIVED CLINICAL METADATA
  capabilities: jsonb("capabilities").$type<string[]>(), // e.g. ["emergency", "cardiology", "pci", "trauma"]
  verificationStatus: varchar("verification_status", { length: 64 }).default("verified"), // 🟢 "verified" | 🔵 "enriched" | 🟡 "unverified"
  source: varchar("source", { length: 128 }).default("ABDM HFR / OGD India Directory"),
  lastVerifiedAt: timestamp("last_verified_at").defaultNow()
});

/**
 * Doctor Profiles & AI Specialist Personas
 */
export const doctorProfilesTable = pgTable("doctor_profiles", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  specialty: varchar("specialty", { length: 128 }).notNull(),
  title: varchar("title", { length: 128 }).notNull(),
  experience: varchar("experience", { length: 64 }),
  avatarUrl: text("avatar_url"),
  voiceName: varchar("voice_name", { length: 64 }),
  systemPrompt: text("system_prompt"),
  badgeColor: varchar("badge_color", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow()
});

/**
 * Patient Voice Consultation & SOAP Clinical Report Records
 */
export const consultationsTable = pgTable("consultations", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }), // Clerk user ID or anonymous session
  patientName: varchar("patient_name", { length: 128 }).default("Anonymous Patient"),
  patientAge: varchar("patient_age", { length: 32 }),
  patientGender: varchar("patient_gender", { length: 32 }),
  
  doctorId: varchar("doctor_id", { length: 64 }).notNull(),
  doctorName: varchar("doctor_name", { length: 128 }).notNull(),
  specialty: varchar("specialty", { length: 128 }).notNull(),
  
  chiefComplaint: text("chief_complaint"),
  transcript: jsonb("transcript").$type<Array<{ role: "patient" | "doctor" | "system"; text: string; timestamp: string }>>(),
  
  triageLevel: varchar("triage_level", { length: 64 }).default("routine"), // "emergency" | "priority" | "routine"
  triageTitle: varchar("triage_title", { length: 255 }),
  icd10Codes: jsonb("icd10_codes").$type<string[]>(),
  detectedSymptoms: jsonb("detected_symptoms").$type<string[]>(),
  
  soapSubjective: text("soap_subjective"),
  soapObjective: text("soap_objective"),
  soapAssessment: text("soap_assessment"),
  soapPlan: text("soap_plan"),
  
  recommendedSpecialists: jsonb("recommended_specialists").$type<string[]>(),
  recommendedAction: text("recommended_action"),
  
  durationSeconds: integer("duration_seconds").default(0),
  status: varchar("status", { length: 64 }).default("completed_pending_review"), // "in_progress" | "completed_pending_review" | "approved"
  approvedAt: timestamp("approved_at"),
  approvedBy: varchar("approved_by", { length: 128 }),
  createdAt: timestamp("created_at").defaultNow(),

  // Server-Authoritative Durable Encounter State & Optimistic Concurrency
  interviewState: jsonb("interview_state").$type<ClinicalInterviewState>(),
  deliveredTurnRecords: jsonb("delivered_turn_records").$type<DeliveredTurnRecord[]>(),
  attributedFacts: jsonb("attributed_facts").$type<AttributedClinicalFactV3[]>(),
  unmappedObservations: jsonb("unmapped_observations").$type<UnmappedObservation[]>(),
  caseVersion: integer("case_version").default(1),
  idempotencyKey: varchar("idempotency_key", { length: 128 })
}, (table) => [
  uniqueIndex("idx_consultations_user_idempotency_unique")
    .on(table.userId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`)
]);

/**
 * Turn Idempotency Keys & Lease Reservation Ledger
 * Coordinates multi-worker concurrency, request fingerprinting, fencing tokens,
 * and deterministic cached replay across voice consultation dialogue turns.
 */
export const turnIdempotencyKeysTable = pgTable("turn_idempotency_keys", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  encounterId: varchar("encounter_id", { length: 128 }).notNull(),
  turnId: varchar("turn_id", { length: 128 }).notNull(),
  requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"), // pending | completed | conflict | failed
  leaseExpiresAt: timestamp("lease_expires_at").notNull(),
  claimGeneration: integer("claim_generation").notNull().default(1),
  caseVersion: integer("case_version"),
  responsePayload: jsonb("response_payload").$type<any>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_turn_idempotency_scope_unique")
    .on(table.userId, table.encounterId, table.turnId),
]);

/**
 * Tamper-Evident Cryptographic SHA-256 Audit Chain Ledger
 */
export const auditEventsTable = pgTable("audit_events", {
  index: integer("index").notNull().unique(),
  id: varchar("id", { length: 128 }).primaryKey(),
  timestamp: varchar("timestamp", { length: 64 }).notNull(),
  actorId: varchar("actor_id", { length: 128 }).notNull(),
  actorRole: varchar("actor_role", { length: 64 }).notNull(),
  action: varchar("action", { length: 128 }).notNull(),
  resourceType: varchar("resource_type", { length: 64 }).notNull(),
  resourceId: varchar("resource_id", { length: 255 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  clientIp: varchar("client_ip", { length: 64 }),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  previousHash: varchar("previous_hash", { length: 64 }).notNull(),
  eventHash: varchar("event_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").defaultNow()
});
import { PatientMedication, DrugAllergy } from "../lib/clinical-knowledge/types";

/**
 * Patient Health Records & Context Profile Table
 * Persists longitudinal clinical history (conditions, medications, allergies, demographics)
 * supporting multi-patient management per caregiver with DPDP Act privacy compliance.
 */
export const patientProfilesTable = pgTable("patient_profiles", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  relationshipToUser: varchar("relationship_to_user", { length: 32 }).default("self"), // self | child | parent | spouse | other

  // Demographics (minimizing sensitive data: yearOfBirth preferred over exact DOB)
  name: varchar("name", { length: 128 }),
  preferredLanguage: varchar("preferred_language", { length: 32 }).default("en"),
  yearOfBirth: integer("year_of_birth"),
  dateOfBirth: varchar("date_of_birth", { length: 32 }),
  age: integer("age"),
  ageGroup: varchar("age_group", { length: 32 }).notNull().default("adult"),
  sexAssignedAtBirth: varchar("sex_assigned_at_birth", { length: 16 }),
  gender: varchar("gender", { length: 32 }),
  bloodGroup: varchar("blood_group", { length: 8 }),
  pregnancyStatus: varchar("pregnancy_status", { length: 32 }).default("not_applicable"),

  // Clinical History
  knownConditions: jsonb("known_conditions").$type<string[]>().default([]),
  currentMedications: jsonb("current_medications").$type<PatientMedication[]>().default([]),
  allergyStatus: varchar("allergy_status", { length: 32 }).default("unassessed"), // unassessed | none_known | confirmed
  drugAllergies: jsonb("drug_allergies").$type<DrugAllergy[]>().default([]),
  surgicalHistory: jsonb("surgical_history").$type<string[]>().default([]),
  smokingStatus: varchar("smoking_status", { length: 16 }).default("unknown"),

  // Emergency & Accessibility (Optional)
  emergencyContact: jsonb("emergency_contact").$type<{ name?: string; phone?: string; relationship?: string }>(),
  accessibilityPreferences: jsonb("accessibility_preferences").$type<{ communicationStyle?: string; visualAccommodations?: boolean; hearingAccommodations?: boolean; notes?: string }>(),
  clinicalNotes: text("clinical_notes"),

  // DPDP Act (India) Compliance
  consentGiven: boolean("consent_given").default(false).notNull(),
  consentTimestamp: timestamp("consent_timestamp"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
  deletedAt: timestamp("deleted_at"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * Clinical Knowledge Passages Table (MedlinePlus & Guidelines Hybrid Store)
 * Stores ingested medical guideline passages and optional dense vector embeddings.
 */
export const clinicalKnowledgePassagesTable = pgTable("clinical_knowledge_passages", {
  id: serial("id").primaryKey(),
  passageId: varchar("passage_id", { length: 128 }).notNull().unique(),
  topicId: varchar("topic_id", { length: 128 }).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  section: varchar("section", { length: 256 }),
  text: text("text").notNull(),
  url: varchar("url", { length: 1024 }),
  keywords: json("keywords").$type<string[]>().default([]),
  embedding: json("embedding").$type<number[]>(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
