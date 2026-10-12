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
 * In-memory fallback profile store for local development, demo sessions,
 * or when the database connection is offline/testing.
 */
export const memoryProfiles = new Map<string, PatientProfile>();

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

        if (rows && rows.length > 0) {
          return rows.map((r) => this.mapToPatientProfile(r));
        }
      } catch (err) {
        console.warn("[PatientProfileService] DB query failed, falling back to memory store:", err);
      }
    }

    // Memory fallback
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
      } catch (err) {
        console.warn("[PatientProfileService] DB query failed, falling back to memory store:", err);
      }
    }

    const cached = memoryProfiles.get(profileId);
    if (cached && cached.userId === userId && !cached.isDeleted) {
      return cached;
    }

    return null;
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
      } catch (err) {
        console.warn("[PatientProfileService] DB query failed, falling back to memory store:", err);
      }
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
      consentGiven: data.consentGiven !== undefined ? data.consentGiven : (existing?.consentGiven ?? true),
      consentTimestamp: data.consentTimestamp || existing?.consentTimestamp || now.toISOString(),
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
          consentGiven: updatedProfile.consentGiven ?? true,
          consentTimestamp: new Date(updatedProfile.consentTimestamp || now.toISOString()),
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
        console.warn("[PatientProfileService] DB write failed, saving to memory cache:", err);
      }
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
      }
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
   * Resolves the target patient profile based on caller utterance and optional explicit inputs.
   * Ensures caller vs patient identity separation (e.g. son discussing mother).
   */
  public static async resolveTargetPatientProfile(
    userId?: string,
    callerUtterance: string = "",
    requestedPatientId?: string,
    requestedRelationship?: string
  ): Promise<{
    profile: PatientProfile | null;
    inferredSubject: "self" | "mother" | "child" | "third_party";
  }> {
    // 1. Determine inferred subject from explicit request or acoustic speech cues
    let inferredSubject: "self" | "mother" | "child" | "third_party" = "self";

    if (requestedRelationship) {
      const rel = requestedRelationship.toLowerCase();
      if (rel === "mother" || rel === "parent") inferredSubject = "mother";
      else if (rel === "child" || rel === "son" || rel === "daughter" || rel === "baby") inferredSubject = "child";
      else if (rel === "other" || rel === "spouse") inferredSubject = "third_party";
      else inferredSubject = "self";
    } else {
      const text = callerUtterance.toLowerCase();
      if (/\b(?:my\s+mother|my\s+mom|her\s+chest|she\s+has|she\s+is\s+having|my\s+mum)\b/i.test(text)) {
        inferredSubject = "mother";
      } else if (/\b(?:my\s+child|my\s+baby|my\s+son|my\s+daughter|he\s+is\s+having\s+fever|she\s+fell)\b/i.test(text)) {
        inferredSubject = "child";
      } else if (/\b(?:my\s+father|my\s+dad|my\s+husband|my\s+wife|my\s+friend|he\s+has)\b/i.test(text)) {
        inferredSubject = "third_party";
      }
    }

    if (!userId || userId === "unauthenticated") {
      return { profile: null, inferredSubject };
    }

    // 2. Fetch specific profile if requested
    if (requestedPatientId) {
      const profile = await this.getProfileById(requestedPatientId, userId);
      if (profile) {
        return { profile, inferredSubject };
      }
    }

    // 3. Resolve by subject relationship
    if (inferredSubject === "mother") {
      const motherProfile =
        (await this.getProfileByRelationship(userId, "mother")) ||
        (await this.getProfileByRelationship(userId, "parent"));
      if (motherProfile) {
        return { profile: motherProfile, inferredSubject };
      }
    } else if (inferredSubject === "child") {
      const childProfile = await this.getProfileByRelationship(userId, "child");
      if (childProfile) {
        return { profile: childProfile, inferredSubject };
      }
    }

    // Default to self profile
    const selfProfile = await this.getProfileByRelationship(userId, "self");
    return { profile: selfProfile, inferredSubject };
  }
}
