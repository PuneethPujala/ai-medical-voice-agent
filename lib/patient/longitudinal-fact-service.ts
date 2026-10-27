import { randomUUID } from "crypto";
import { getDb } from "@/config/db";
import { patientLongitudinalFactsTable, patientProfilesTable } from "@/config/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { PatientProfileService, memoryProfiles } from "./patient-profile-service";
import {
  LongitudinalPatientFact,
  RecordFactParams,
  SupersedeFactParams,
  RetractFactParams,
  QueryFactsOptions,
} from "./longitudinal-fact-types";

export class ConsentRequiredError extends Error {
  constructor(message = "Patient consent has not been granted for longitudinal data processing.") {
    super(message);
    this.name = "ConsentRequiredError";
  }
}

export class ProfileNotFoundError extends Error {
  constructor(message = "Target patient profile not found or does not belong to authorized user.") {
    super(message);
    this.name = "ProfileNotFoundError";
  }
}

export class FactNotFoundError extends Error {
  constructor(message = "Target longitudinal fact not found.") {
    super(message);
    this.name = "FactNotFoundError";
  }
}

export class LongitudinalDatabaseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LongitudinalDatabaseError";
  }
}

function shouldEnforceDatabase(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.DATABASE_URL);
}

// In-memory backing store for tests and offline/local development
export const memoryLongitudinalFacts = new Map<string, LongitudinalPatientFact>();

export function resetLongitudinalFactStore(): void {
  memoryLongitudinalFacts.clear();
}

/**
 * Maps a database row (from either Drizzle ORM camelCase or PostgreSQL raw SQL snake_case)
 * to the typed LongitudinalPatientFact interface.
 */
function mapRowToFact(row: any): LongitudinalPatientFact {
  const reportedAtRaw = row.reportedAt || row.reported_at;
  const recordedAtRaw = row.recordedAt || row.recorded_at;
  const lastReviewedAtRaw = row.lastReviewedAt || row.last_reviewed_at;
  const supersededAtRaw = row.supersededAt || row.superseded_at;
  const numValRaw =
    row.numericValue !== undefined && row.numericValue !== null
      ? row.numericValue
      : (row.numeric_value !== undefined && row.numeric_value !== null ? row.numeric_value : null);

  return {
    id: row.id,
    userId: row.userId || row.user_id,
    patientProfileId: row.patientProfileId || row.patient_profile_id,
    category: row.category,
    concept: row.concept,
    reportedValue: row.reportedValue || row.reported_value,
    numericValue: numValRaw !== null && numValRaw !== undefined ? Number(numValRaw) : null,
    unit: row.unit || null,
    temporalScope: row.temporalScope || row.temporal_scope,
    lifecycle: row.lifecycle,
    verification: row.verification,
    sourceType: row.sourceType || row.source_type,
    sourceConsultationId: row.sourceConsultationId || row.source_consultation_id,
    sourceTurnId: row.sourceTurnId || row.source_turn_id,
    reportedAt: reportedAtRaw instanceof Date ? reportedAtRaw.toISOString() : new Date(reportedAtRaw).toISOString(),
    recordedAt: recordedAtRaw instanceof Date ? recordedAtRaw.toISOString() : new Date(recordedAtRaw).toISOString(),
    lastReviewedAt: lastReviewedAtRaw ? (lastReviewedAtRaw instanceof Date ? lastReviewedAtRaw.toISOString() : new Date(lastReviewedAtRaw).toISOString()) : null,
    supersedesFactId: row.supersedesFactId || row.supersedes_fact_id || null,
    supersededByFactId: row.supersededByFactId || row.superseded_by_fact_id || null,
    supersededAt: supersededAtRaw ? (supersededAtRaw instanceof Date ? supersededAtRaw.toISOString() : new Date(supersededAtRaw).toISOString()) : null,
  };
}

export class LongitudinalFactService {
  /**
   * Validates profile existence, tenant ownership, and consent status.
   */
  private static async validateProfileAndConsent(
    userId: string,
    patientProfileId: string,
    requireConsent = true
  ): Promise<any> {
    const profile = await PatientProfileService.getProfileById(patientProfileId, userId);
    if (!profile) {
      throw new ProfileNotFoundError(`Profile '${patientProfileId}' not found for user '${userId}'.`);
    }

    if (requireConsent && !profile.consentGiven) {
      throw new ConsentRequiredError(
        `Longitudinal operations require patient consent. Profile '${patientProfileId}' consentGiven is false.`
      );
    }

    return profile;
  }

  /**
   * Retrieves active longitudinal facts for an authorized patient profile.
   */
  public static async getActiveFacts(
    userId: string,
    patientProfileId: string,
    options?: QueryFactsOptions
  ): Promise<LongitudinalPatientFact[]> {
    await this.validateProfileAndConsent(userId, patientProfileId, true);

    const dbClient = getDb();
    if (dbClient) {
      try {
        const rows = await dbClient
          .select()
          .from(patientLongitudinalFactsTable)
          .where(
            and(
              eq(patientLongitudinalFactsTable.userId, userId),
              eq(patientLongitudinalFactsTable.patientProfileId, patientProfileId),
              eq(patientLongitudinalFactsTable.lifecycle, options?.lifecycle || "active")
            )
          )
          .orderBy(desc(patientLongitudinalFactsTable.reportedAt));

        let facts = rows.map(mapRowToFact);
        if (options?.category) {
          facts = facts.filter((f) => f.category === options.category);
        }
        if (options?.temporalScope) {
          facts = facts.filter((f) => f.temporalScope === options.temporalScope);
        }
        return facts;
      } catch (err: any) {
        if (shouldEnforceDatabase()) {
          throw new LongitudinalDatabaseError("Failed to retrieve active facts from database. In-memory fallback is disabled.", err);
        }
        console.warn("[LongitudinalFactService] DB query failed, using in-memory store:", err);
      }
    } else if (shouldEnforceDatabase()) {
      throw new LongitudinalDatabaseError("Database client unavailable in production/configured database mode.");
    }

    // In-memory evaluation (test & offline dev only)
    const targetLifecycle = options?.lifecycle || "active";
    const matching: LongitudinalPatientFact[] = [];
    for (const fact of memoryLongitudinalFacts.values()) {
      if (
        fact.userId === userId &&
        fact.patientProfileId === patientProfileId &&
        fact.lifecycle === targetLifecycle
      ) {
        if (options?.category && fact.category !== options.category) continue;
        if (options?.temporalScope && fact.temporalScope !== options.temporalScope) continue;
        matching.push({ ...fact });
      }
    }

    return matching.sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());
  }

  /**
   * Retrieves the full chronological audit history for a specific concept.
   */
  public static async getFactHistory(
    userId: string,
    patientProfileId: string,
    concept: string
  ): Promise<LongitudinalPatientFact[]> {
    await this.validateProfileAndConsent(userId, patientProfileId, true);

    const dbClient = getDb();
    if (dbClient) {
      try {
        const rows = await dbClient
          .select()
          .from(patientLongitudinalFactsTable)
          .where(
            and(
              eq(patientLongitudinalFactsTable.userId, userId),
              eq(patientLongitudinalFactsTable.patientProfileId, patientProfileId),
              eq(patientLongitudinalFactsTable.concept, concept)
            )
          )
          .orderBy(desc(patientLongitudinalFactsTable.reportedAt));

        return rows.map(mapRowToFact);
      } catch (err: any) {
        if (shouldEnforceDatabase()) {
          throw new LongitudinalDatabaseError("Failed to retrieve fact history from database. In-memory fallback is disabled.", err);
        }
        console.warn("[LongitudinalFactService] DB history query failed, using in-memory store:", err);
      }
    } else if (shouldEnforceDatabase()) {
      throw new LongitudinalDatabaseError("Database client unavailable in production/configured database mode.");
    }

    const history: LongitudinalPatientFact[] = [];
    for (const fact of memoryLongitudinalFacts.values()) {
      if (
        fact.userId === userId &&
        fact.patientProfileId === patientProfileId &&
        fact.concept === concept
      ) {
        history.push({ ...fact });
      }
    }

    return history.sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime());
  }

  /**
   * Atomically records a new fact or returns the existing record if the exact source event was already processed (Idempotency).
   * In Neon HTTP and PostgreSQL, executes via the atomic PL/pgSQL function record_or_supersede_patient_longitudinal_fact()
   * as a single statement, avoiding interactive transaction driver limitations while preserving advisory locks and atomicity.
   */
  public static async recordFact(
    userId: string,
    params: RecordFactParams
  ): Promise<LongitudinalPatientFact> {
    await this.validateProfileAndConsent(userId, params.patientProfileId, true);

    const reportedAt = params.reportedAt || new Date().toISOString();
    const recordedAt = new Date().toISOString();

    const dbClient = getDb();
    if (dbClient) {
      try {
        const newId = `fact_${Date.now()}_${randomUUID().slice(0, 8)}`;

        // Execute single atomic statement compatible with Neon HTTP driver
        const execResult: any = await dbClient.execute(sql`
          SELECT * FROM record_or_supersede_patient_longitudinal_fact(
            ${newId},
            ${userId},
            ${params.patientProfileId},
            ${params.category},
            ${params.concept},
            ${params.reportedValue},
            ${params.numericValue !== undefined && params.numericValue !== null ? params.numericValue : null},
            ${params.unit || null},
            ${params.temporalScope},
            ${params.verification || "unverified"},
            ${params.sourceType || "patient"},
            ${params.sourceConsultationId},
            ${params.sourceTurnId},
            ${new Date(reportedAt)}::timestamp with time zone
          )
        `);

        const rows = execResult?.rows || (Array.isArray(execResult) ? execResult : []);
        if (rows && rows.length > 0) {
          return mapRowToFact(rows[0]);
        }
        throw new LongitudinalDatabaseError("record_or_supersede_patient_longitudinal_fact returned 0 rows");
      } catch (err: any) {
        if (shouldEnforceDatabase()) {
          throw new LongitudinalDatabaseError("Atomic database fact persistence failed. In-memory fallback is disabled in production/configured DB mode.", err);
        }
        console.warn("[LongitudinalFactService] DB function execution failed, falling back to in-memory:", err);
      }
    } else if (shouldEnforceDatabase()) {
      throw new LongitudinalDatabaseError("Database client unavailable in production/configured database mode.");
    }

    // In-memory branch (test & offline dev only)
    // 1. Idempotency check
    for (const fact of memoryLongitudinalFacts.values()) {
      if (
        fact.patientProfileId === params.patientProfileId &&
        fact.sourceConsultationId === params.sourceConsultationId &&
        fact.sourceTurnId === params.sourceTurnId &&
        fact.concept === params.concept
      ) {
        return { ...fact };
      }
    }

    const newId = `fact_${Date.now()}_${randomUUID().slice(0, 8)}`;
    let supersededFactId: string | null = null;

    // 2. Baseline superseding
    if (params.temporalScope === "baseline") {
      for (const [id, fact] of memoryLongitudinalFacts.entries()) {
        if (
          fact.userId === userId &&
          fact.patientProfileId === params.patientProfileId &&
          fact.concept === params.concept &&
          fact.temporalScope === "baseline" &&
          fact.lifecycle === "active"
        ) {
          supersededFactId = id;
          memoryLongitudinalFacts.set(id, {
            ...fact,
            lifecycle: "superseded",
            supersededByFactId: newId,
            supersededAt: recordedAt,
          });
          break;
        }
      }
    }

    const createdFact: LongitudinalPatientFact = {
      id: newId,
      userId,
      patientProfileId: params.patientProfileId,
      category: params.category,
      concept: params.concept,
      reportedValue: params.reportedValue,
      numericValue: params.numericValue !== undefined ? params.numericValue : null,
      unit: params.unit || null,
      temporalScope: params.temporalScope,
      lifecycle: "active",
      verification: params.verification || "unverified",
      sourceType: params.sourceType || "patient",
      sourceConsultationId: params.sourceConsultationId,
      sourceTurnId: params.sourceTurnId,
      reportedAt,
      recordedAt,
      supersedesFactId: supersededFactId,
      supersededByFactId: null,
      supersededAt: null,
    };

    memoryLongitudinalFacts.set(newId, createdFact);
    return { ...createdFact };
  }

  /**
   * Explicitly supersedes an active fact with an updated value.
   */
  public static async supersedeFact(
    userId: string,
    params: SupersedeFactParams
  ): Promise<LongitudinalPatientFact> {
    return this.recordFact(userId, {
      ...params,
      temporalScope: "baseline",
    });
  }

  /**
   * Retracts a previously recorded fact (e.g. entered in error or patient requested deletion).
   * Note: Retraction is permitted even if consent was subsequently revoked.
   */
  public static async retractFact(
    userId: string,
    params: RetractFactParams
  ): Promise<LongitudinalPatientFact> {
    await this.validateProfileAndConsent(userId, params.patientProfileId, false);

    const now = new Date().toISOString();
    const newLifecycle = params.enteredInError ? "entered_in_error" : "retracted";

    const dbClient = getDb();
    if (dbClient) {
      try {
        const updated = await dbClient
          .update(patientLongitudinalFactsTable)
          .set({
            lifecycle: newLifecycle,
            lastReviewedAt: new Date(now),
          })
          .where(
            and(
              eq(patientLongitudinalFactsTable.id, params.factId),
              eq(patientLongitudinalFactsTable.userId, userId),
              eq(patientLongitudinalFactsTable.patientProfileId, params.patientProfileId)
            )
          )
          .returning();

        if (updated && updated.length > 0) {
          return mapRowToFact(updated[0]);
        }
        throw new FactNotFoundError(`Fact '${params.factId}' not found for retraction.`);
      } catch (err: any) {
        if (err instanceof FactNotFoundError) throw err;
        if (shouldEnforceDatabase()) {
          throw new LongitudinalDatabaseError("Failed to retract fact in database. In-memory fallback is disabled.", err);
        }
        console.warn("[LongitudinalFactService] DB retract failed, falling back to memory:", err);
      }
    } else if (shouldEnforceDatabase()) {
      throw new LongitudinalDatabaseError("Database client unavailable in production/configured database mode.");
    }

    const existing = memoryLongitudinalFacts.get(params.factId);
    if (
      !existing ||
      existing.userId !== userId ||
      existing.patientProfileId !== params.patientProfileId
    ) {
      throw new FactNotFoundError(`Fact '${params.factId}' not found for retraction.`);
    }

    const updatedFact: LongitudinalPatientFact = {
      ...existing,
      lifecycle: newLifecycle,
      lastReviewedAt: now,
    };
    memoryLongitudinalFacts.set(params.factId, updatedFact);
    return { ...updatedFact };
  }
}
