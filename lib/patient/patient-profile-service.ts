import crypto from "crypto";
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "@/config/db";
import { patientProfilesTable } from "@/config/schema";
import {
  PatientProfile,
  PopulationTag,
  calculateAgeFromDOB,
} from "../clinical-knowledge/types";
import { PatientProfileManager } from "./profile";

/**
 * In-memory fallback profile store for automated testing (NODE_ENV === 'test').
 * In production/staging, in-memory fallback is disabled for HIPAA compliance.
 */
export const memoryProfiles = new Map<string, PatientProfile>();

export class PatientProfileDatabaseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PatientProfileDatabaseError';
  }
}

export class CannotReclassifyDependentProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CannotReclassifyDependentProfileError';
  }
}

function shouldEnforceDatabase(): boolean {
  return process.env.NODE_ENV === "production" || (Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== "test");
}

export class PatientProfileService {
  /**
   * Normalize DB record or raw JSON into a typed PatientProfile.
   */
  public static mapToPatientProfile(row: any): PatientProfile {
    return {
      id: row.id,
      name: row.name || undefined,
      userId: row.userId,
      relationshipToUser: (row.relationshipToUser || "self") as any,
      language: row.preferredLanguage || "en",
      yearOfBirth: row.yearOfBirth ?? undefined,
      dateOfBirth: row.dateOfBirth || undefined,
      age: row.age ?? undefined,
      ageGroup: (row.ageGroup || "adult") as PopulationTag,
      sexAssignedAtBirth: row.sexAssignedAtBirth || undefined,
      gender: row.gender || undefined,
      pregnancyStatus: row.pregnancyStatus || "not_applicable",
      knownConditions: Array.isArray(row.knownConditions) ? row.knownConditions : [],
      currentMedications: Array.isArray(row.currentMedications) ? row.currentMedications : [],
      allergyStatus: row.allergyStatus || "unassessed",
      drugAllergies: Array.isArray(row.drugAllergies) ? row.drugAllergies : [],
      surgicalHistory: Array.isArray(row.surgicalHistory) ? row.surgicalHistory : [],
      smokingStatus: row.smokingStatus || "unknown",
      bloodGroup: row.bloodGroup || undefined,
      emergencyContact: row.emergencyContact || undefined,
      accessibilityPreferences: row.accessibilityPreferences || undefined,
      clinicalNotes: row.clinicalNotes || undefined,
      consentGiven: Boolean(row.consentGiven),
      consentTimestamp: row.consentTimestamp ? new Date(row.consentTimestamp).toISOString() : undefined,
      isDeleted: Boolean(row.isDeleted),
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    };
  }

  /**
   * Retrieve all non-deleted profiles belonging to a user (e.g. self, child, parent).
   */
  public static async listProfiles(userId: string): Promise<PatientProfile[]> {
    if (!userId || userId === "unauthenticated") {
      return [];
    }

    const dbClient = getDb();
    if (dbClient) {
      try {
        const rows = await dbClient
          .select()
          .from(patientProfilesTable)
          .where(
            and(
              eq(patientProfilesTable.userId, userId),
              eq(patientProfilesTable.isDeleted, false)
            )
          )
          .orderBy(desc(patientProfilesTable.updatedAt));

        // Authoritative database result: return persisted profiles (empty array if none exist)
        return (rows || []).map((r) => this.mapToPatientProfile(r));
      } catch (err) {
        console.warn("[PatientProfileService] DB query failed:", err);
        if (shouldEnforceDatabase()) {
          throw new PatientProfileDatabaseError("Failed to list patient profiles from database. In-memory fallback is disabled in production.", err);
        }
      }
    } else if (shouldEnforceDatabase()) {
      throw new PatientProfileDatabaseError("Database client unavailable. In-memory fallback is disabled in production.");
    }

    // Memory fallback (used strictly in test runner when DB is offline)
    const list: PatientProfile[] = [];
    for (const p of memoryProfiles.values()) {
      if (p.userId === userId && !p.isDeleted) {
        list.push(p);
      }
    }
    return list;
  }

  /**
   * Retrieve a specific profile by ID, enforcing strict tenant isolation.
   */
  public static async getProfileById(profileId: string, userId: string): Promise<PatientProfile | null> {
    if (!profileId || !userId) return null;

    const dbClient = getDb();
    if (dbClient) {
      try {
        const rows = await dbClient
          .select()
          .from(patientProfilesTable)
          .where(
            and(
              eq(patientProfilesTable.id, profileId),
              eq(patientProfilesTable.userId, userId),
              eq(patientProfilesTable.isDeleted, false)
            )
          )
          .limit(1);

        if (rows && rows.length > 0) {
          return this.mapToPatientProfile(rows[0]);
        }
        // Authoritative DB execution returned 0 rows: profile does not exist in DB for this user
        return null;
      } catch (err) {
        console.warn("[PatientProfileService] DB query failed:", err);
        if (shouldEnforceDatabase()) {
          throw new PatientProfileDatabaseError("Failed to retrieve profile from database. In-memory fallback is disabled in production.", err);
        }
      }
    } else if (shouldEnforceDatabase()) {
      throw new PatientProfileDatabaseError("Database client unavailable. In-memory fallback is disabled in production.");
    }

    const cached = memoryProfiles.get(profileId);
    if (cached && cached.userId === userId && !cached.isDeleted) {
      return cached;
    }

    return null;
  }

  /**
   * Retrieve the user's primary self profile (Single-Patient MVP Model).
   * Invariant: Never fall back to an arbitrary dependent profile (e.g. parent/child).
   * If no self-profile exists, returns null so a dedicated self-profile can be created.
   */
  public static async getSelfProfile(userId: string): Promise<PatientProfile | null> {
    if (!userId || userId === "unauthenticated") return null;
    const profile = await this.getProfileByRelationship(userId, "self");
    if (profile) return profile;
    const profiles = await this.listProfiles(userId);
    return profiles.find((p) => p.relationshipToUser === "self") || null;
  }

  /**
   * Retrieve a profile for a user by relationship (e.g. "self", "mother", "child").
   */
  public static async getProfileByRelationship(
    userId: string,
    relationship: "self" | "child" | "parent" | "spouse" | "other" | string = "self"
  ): Promise<PatientProfile | null> {
    if (!userId || userId === "unauthenticated") return null;

    const normalizedRel = relationship.toLowerCase();
    const dbClient = getDb();
    if (dbClient) {
      try {
        const rows = await dbClient
          .select()
          .from(patientProfilesTable)
          .where(
            and(
              eq(patientProfilesTable.userId, userId),
              eq(patientProfilesTable.relationshipToUser, normalizedRel),
              eq(patientProfilesTable.isDeleted, false)
            )
          )
          .orderBy(desc(patientProfilesTable.updatedAt))
          .limit(1);

        if (rows && rows.length > 0) {
          return this.mapToPatientProfile(rows[0]);
        }
        // Authoritative DB execution returned 0 rows: relationship profile does not exist in DB
        return null;
      } catch (err) {
        console.warn("[PatientProfileService] DB query failed:", err);
        if (shouldEnforceDatabase()) {
          throw new PatientProfileDatabaseError("Failed to retrieve profile by relationship from database. In-memory fallback is disabled in production.", err);
        }
      }
    } else if (shouldEnforceDatabase()) {
      throw new PatientProfileDatabaseError("Database client unavailable. In-memory fallback is disabled in production.");
    }

    for (const p of memoryProfiles.values()) {
      if (
        p.userId === userId &&
        (p.relationshipToUser || "self").toLowerCase() === normalizedRel &&
        !p.isDeleted
      ) {
        return p;
      }
    }

    return null;
  }

  /**
   * Create or update a patient profile with validation and dynamic age computation.
   */
  public static async upsertProfile(
    userId: string,
    data: Partial<PatientProfile>
  ): Promise<PatientProfile> {
    if (!userId || userId === "unauthenticated") {
      throw new Error("Authentication required: Cannot save profile for unauthenticated user.");
    }

    const relationship = (data.relationshipToUser || "self") as any;

    // Look for existing profile if data.id is provided, or find by (userId, relationship)
    let existing: PatientProfile | null = null;
    if (data.id) {
      existing = await this.getProfileById(data.id, userId);
    } else {
      existing = await this.getProfileByRelationship(userId, relationship);
    }

    // Invariant: Never convert or overwrite a legacy dependent profile into a self-profile
    if (existing && existing.relationshipToUser !== "self" && relationship === "self") {
      throw new CannotReclassifyDependentProfileError(
        `Cannot reclassify legacy dependent profile '${existing.id}' (${existing.relationshipToUser}) into a self-profile. Legacy dependent records must remain preserved.`
      );
    }

    const profileId = existing?.id || data.id || crypto.randomUUID();
    const now = new Date();

    // Calculate dynamic age from Date of Birth if present
    let finalAge: number | undefined = data.age ?? existing?.age;
    let finalAgeGroup: PopulationTag = data.ageGroup ?? existing?.ageGroup ?? "adult";
    let finalYearOfBirth: number | undefined = data.yearOfBirth ?? existing?.yearOfBirth;

    if (data.dateOfBirth) {
      const calc = calculateAgeFromDOB(data.dateOfBirth, now);
      finalAge = calc.years;
      const fractionalAge = calc.years + (calc.months / 12);
      finalAgeGroup = PatientProfileManager.computeAgeGroup(fractionalAge);
      const dobDate = new Date(data.dateOfBirth);
      if (!isNaN(dobDate.getFullYear())) {
        finalYearOfBirth = dobDate.getFullYear();
      }
    } else if (finalAge != null && finalAge >= 0) {
      finalAgeGroup = PatientProfileManager.computeAgeGroup(finalAge);
      if (!finalYearOfBirth) {
        finalYearOfBirth = now.getFullYear() - finalAge;
      }
    }

    const updatedProfile: PatientProfile = {
      id: profileId,
      userId,
      name: data.name !== undefined ? data.name : existing?.name,
      relationshipToUser: relationship,
      language: data.language || existing?.language || "en",
      yearOfBirth: finalYearOfBirth,
      dateOfBirth: data.dateOfBirth !== undefined ? data.dateOfBirth : existing?.dateOfBirth,
      age: finalAge,
      ageGroup: finalAgeGroup,
      sexAssignedAtBirth: data.sexAssignedAtBirth !== undefined ? data.sexAssignedAtBirth : existing?.sexAssignedAtBirth,
      gender: data.gender !== undefined ? data.gender : existing?.gender,
      pregnancyStatus: data.pregnancyStatus || existing?.pregnancyStatus || "not_applicable",
      knownConditions: Array.isArray(data.knownConditions)
        ? data.knownConditions
        : existing?.knownConditions || [],
      currentMedications: Array.isArray(data.currentMedications)
        ? data.currentMedications
        : existing?.currentMedications || [],
      allergyStatus: data.allergyStatus || existing?.allergyStatus || "unassessed",
      drugAllergies: Array.isArray(data.drugAllergies)
        ? data.drugAllergies
        : existing?.drugAllergies || [],
      surgicalHistory: Array.isArray(data.surgicalHistory)
        ? data.surgicalHistory
        : existing?.surgicalHistory || [],
      smokingStatus: data.smokingStatus || existing?.smokingStatus || "unknown",
      bloodGroup: data.bloodGroup !== undefined ? data.bloodGroup : existing?.bloodGroup,
      emergencyContact: data.emergencyContact !== undefined ? data.emergencyContact : existing?.emergencyContact,
      accessibilityPreferences: data.accessibilityPreferences !== undefined ? data.accessibilityPreferences : existing?.accessibilityPreferences,
      clinicalNotes: data.clinicalNotes !== undefined ? data.clinicalNotes : existing?.clinicalNotes,
      consentGiven: data.consentGiven !== undefined ? Boolean(data.consentGiven) : (existing?.consentGiven ?? false),
      consentTimestamp: (data.consentGiven !== undefined ? Boolean(data.consentGiven) : (existing?.consentGiven ?? false))
        ? (data.consentTimestamp || existing?.consentTimestamp || now.toISOString())
        : (data.consentGiven === false ? undefined : existing?.consentTimestamp),
      isDeleted: false,
      createdAt: existing?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
    };

    // 1. Try persisting to Neon Postgres via Drizzle
    const dbClient = getDb();
    if (dbClient) {
      try {
        const dbPayload = {
          id: updatedProfile.id,
          userId: updatedProfile.userId!,
          name: updatedProfile.name || null,
          relationshipToUser: updatedProfile.relationshipToUser || "self",
          preferredLanguage: updatedProfile.language || "en",
          yearOfBirth: updatedProfile.yearOfBirth ?? null,
          dateOfBirth: updatedProfile.dateOfBirth || null,
          age: updatedProfile.age ?? null,
          ageGroup: updatedProfile.ageGroup || "adult",
          sexAssignedAtBirth: updatedProfile.sexAssignedAtBirth || null,
          gender: updatedProfile.gender || null,
          bloodGroup: updatedProfile.bloodGroup || null,
          pregnancyStatus: updatedProfile.pregnancyStatus || "not_applicable",
          knownConditions: updatedProfile.knownConditions || [],
          currentMedications: updatedProfile.currentMedications || [],
          allergyStatus: updatedProfile.allergyStatus || "unassessed",
          drugAllergies: updatedProfile.drugAllergies || [],
          surgicalHistory: updatedProfile.surgicalHistory || [],
          smokingStatus: updatedProfile.smokingStatus || "unknown",
          emergencyContact: updatedProfile.emergencyContact || null,
          accessibilityPreferences: updatedProfile.accessibilityPreferences || null,
          clinicalNotes: updatedProfile.clinicalNotes || null,
          consentGiven: updatedProfile.consentGiven ?? false,
          consentTimestamp: updatedProfile.consentTimestamp ? new Date(updatedProfile.consentTimestamp) : null,
          isDeleted: false,
          deletedAt: null,
          updatedAt: now,
        };

        if (existing) {
          await dbClient
            .update(patientProfilesTable)
            .set(dbPayload)
            .where(
              and(
                eq(patientProfilesTable.id, profileId),
                eq(patientProfilesTable.userId, userId)
              )
            );
        } else {
          await dbClient.insert(patientProfilesTable).values({
            ...dbPayload,
            createdAt: now,
          });
        }
      } catch (err) {
        console.warn("[PatientProfileService] DB write failed:", err);
        if (shouldEnforceDatabase()) {
          throw new PatientProfileDatabaseError("Failed to persist patient profile to database. In-memory fallback is disabled in production.", err);
        }
      }
    } else if (shouldEnforceDatabase()) {
      throw new PatientProfileDatabaseError("Database client unavailable. In-memory fallback is disabled in production.");
    }

    // 2. Always maintain memory cache for immediate low-latency read-after-write
    memoryProfiles.set(profileId, updatedProfile);

    return updatedProfile;
  }

  /**
   * Soft-delete a profile (DPDP Act compliant).
   */
  public static async deleteProfile(profileId: string, userId: string): Promise<boolean> {
    if (!profileId || !userId) return false;

    // Verify profile exists and belongs to the requesting user
    const existing = await this.getProfileById(profileId, userId);
    if (!existing) {
      return false;
    }

    const dbClient = getDb();
    if (dbClient) {
      try {
        await dbClient
          .update(patientProfilesTable)
          .set({
            isDeleted: true,
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(patientProfilesTable.id, profileId),
              eq(patientProfilesTable.userId, userId)
            )
          );
      } catch (err) {
        console.warn("[PatientProfileService] DB delete failed:", err);
        if (shouldEnforceDatabase()) {
          throw new PatientProfileDatabaseError("Failed to delete patient profile from database. In-memory fallback is disabled in production.", err);
        }
      }
    } else if (shouldEnforceDatabase()) {
      throw new PatientProfileDatabaseError("Database client unavailable. In-memory fallback is disabled in production.");
    }

    const cached = memoryProfiles.get(profileId);
    if (cached && cached.userId === userId) {
      cached.isDeleted = true;
      cached.updatedAt = new Date().toISOString();
      return true;
    }

    return true;
  }

  /**
   * Resolves the target patient profile for clinical consultation.
   * Single-Patient MVP Model:
   * - One account = one patient profile ("self").
   * - The consultation is strictly locked to the authenticated user's self profile.
   * - Utterances mentioning third parties (e.g. "my mother", "my child") do NOT switch
   *   the consultation profile or contaminate the user's longitudinal history.
   */
  public static async resolveTargetPatientProfile(
    userId?: string,
    callerUtterance: string = "",
    _requestedPatientId?: string,
    _requestedRelationship?: string
  ): Promise<{
    profile: PatientProfile | null;
    inferredSubject: "self" | "mother" | "child" | "third_party";
    thirdPartyDetected?: boolean;
    thirdPartyRelation?: "mother" | "child" | "third_party";
  }> {
    // Detect if utterance discusses someone other than the account holder
    const text = callerUtterance.toLowerCase();
    let thirdPartyDetected = false;
    let thirdPartyRelation: "mother" | "child" | "third_party" | undefined = undefined;

    // Comprehensive detection of third-party mentions (parents, grandparents, children, siblings, extended family, partners, third persons)
    if (/\b(?:my\s+(?:mother|mom|mum|mama)|her\s+(?:chest|blood\s*sugar|temperature|symptoms|arm|head|throat)|she\s+(?:has|is\s+having|feels|fell|complained|is\s+complaining))\b/i.test(text)) {
      thirdPartyDetected = true;
      thirdPartyRelation = "mother";
    } else if (/\b(?:my\s+(?:child|baby|infant|toddler|son|daughter|kid|grandchild|grandson|granddaughter)|he\s+is\s+having\s+fever|she\s+fell)\b/i.test(text)) {
      thirdPartyDetected = true;
      thirdPartyRelation = "child";
    } else if (/\b(?:my\s+(?:father|dad|papa|parent|parents|grandmother|grandma|granny|nana|grandfather|grandpa|granddad|grandparent|grandparents|brother|sister|sibling|siblings|uncle|aunt|auntie|aunty|cousin|nephew|niece|husband|wife|spouse|partner|fianc[eé]e?|boyfriend|girlfriend|roommate|flatmate|colleague|coworker|neighbor|friend|patient|client)|(?:his|their)\s+(?:chest|blood\s*sugar|temperature|symptoms|arm|head|throat)|(?:he|they)\s+(?:has|is\s+having|feels|fell|complained|is\s+complaining)|(?:someone\s+else|another\s+person))\b/i.test(text)) {
      thirdPartyDetected = true;
      thirdPartyRelation = "third_party";
    }

    if (!userId || userId === "unauthenticated") {
      return {
        profile: null,
        inferredSubject: "self",
        thirdPartyDetected,
        thirdPartyRelation,
      };
    }

    // Single-Patient Model: Always resolve the user's primary self profile
    const selfProfile = await this.getSelfProfile(userId);

    return {
      profile: selfProfile,
      inferredSubject: "self", // Consultation is locked to self
      thirdPartyDetected,
      thirdPartyRelation,
    };
  }
}

/**
 * Convenience functional exports for single-line profile retrieval & upsert
 */
export async function getPatientProfileById(
  userId: string,
  actorId: string = userId
): Promise<PatientProfile | null> {
  const profiles = await PatientProfileService.listProfiles(userId);
  return profiles.find((p) => p.relationshipToUser === "self") || profiles[0] || null;
}

export async function upsertPatientProfile(
  userId: string,
  payload: Partial<PatientProfile>,
  actorId: string = userId
): Promise<PatientProfile> {
  return PatientProfileService.upsertProfile(userId, payload);
}
