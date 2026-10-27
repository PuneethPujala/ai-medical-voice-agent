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
 * Maps a database row to the typed LongitudinalPatientFact interface.
 */
function mapRowToFact(row: any): LongitudinalPatientFact {
  return {
    id: row.id,
    userId: row.userId,
    patientProfileId: row.patientProfileId,
    category: row.category,
    concept: row.concept,
    reportedValue: row.reportedValue,
    numericValue: row.numericValue !== null && row.numericValue !== undefined ? Number(row.numericValue) : null,
    unit: row.unit || null,
    temporalScope: row.temporalScope,
    lifecycle: row.lifecycle,
    verification: row.verification,
    sourceType: row.sourceType,
    sourceConsultationId: row.sourceConsultationId,
    sourceTurnId: row.sourceTurnId,
    reportedAt: row.reportedAt instanceof Date ? row.reportedAt.toISOString() : new Date(row.reportedAt).toISOString(),
    recordedAt: row.recordedAt instanceof Date ? row.recordedAt.toISOString() : new Date(row.recordedAt).toISOString(),
    lastReviewedAt: row.lastReviewedAt ? (row.lastReviewedAt instanceof Date ? row.lastReviewedAt.toISOString() : new Date(row.lastReviewedAt).toISOString()) : null,
    supersedesFactId: row.supersedesFactId || null,
    supersededByFactId: row.supersededByFactId || null,
    supersededAt: row.supersededAt ? (row.supersededAt instanceof Date ? row.supersededAt.toISOString() : new Date(row.supersededAt).toISOString()) : null,
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
   * If the fact is a baseline and a previous active baseline exists for the same concept, atomically supersedes it within a serial transaction.
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
        // Execute inside an atomic transaction with advisory lock to serialize baseline mutations per (profile, concept)
        const result = await dbClient.transaction(async (tx: any) => {
          // 1. Advisory transaction lock serializes baseline creation/superseding
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${params.patientProfileId} || ':' || ${params.concept}))`
          );

          // 2. Idempotency check: check if this turn already recorded this concept
          const existing = await tx
            .select()
            .from(patientLongitudinalFactsTable)
            .where(
              and(
                eq(patientLongitudinalFactsTable.patientProfileId, params.patientProfileId),
                eq(patientLongitudinalFactsTable.sourceConsultationId, params.sourceConsultationId),
                eq(patientLongitudinalFactsTable.sourceTurnId, params.sourceTurnId),
                eq(patientLongitudinalFactsTable.concept, params.concept)
              )
            )
            .limit(1);

          if (existing && existing.length > 0) {
            return mapRowToFact(existing[0]);
          }

          const newId = `fact_${Date.now()}_${randomUUID().slice(0, 8)}`;

          // 3. If baseline: find existing active baseline to supersede
          let supersededFactId: string | null = null;
          if (params.temporalScope === "baseline") {
            const activeBaselines = await tx
              .select()
              .from(patientLongitudinalFactsTable)
              .where(
                and(
                  eq(patientLongitudinalFactsTable.userId, userId),
                  eq(patientLongitudinalFactsTable.patientProfileId, params.patientProfileId),
                  eq(patientLongitudinalFactsTable.concept, params.concept),
                  eq(patientLongitudinalFactsTable.temporalScope, "baseline"),
                  eq(patientLongitudinalFactsTable.lifecycle, "active")
                )
              )
              .limit(1);

            if (activeBaselines && activeBaselines.length > 0) {
              const targetOldId = activeBaselines[0].id;
              supersededFactId = targetOldId;
              await tx
                .update(patientLongitudinalFactsTable)
                .set({
                  lifecycle: "superseded",
                  supersededByFactId: newId,
                  supersededAt: new Date(recordedAt),
                })
                .where(eq(patientLongitudinalFactsTable.id, targetOldId));
            }
          }

          // 4. Insert new fact
          const insertValues: any = {
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
            reportedAt: new Date(reportedAt),
            recordedAt: new Date(recordedAt),
            supersedesFactId: supersededFactId,
            supersededByFactId: null,
            supersededAt: null,
          };

          const insertedRows = await tx
            .insert(patientLongitudinalFactsTable)
            .values(insertValues)
            .returning();

          return mapRowToFact(insertedRows[0]);
        });

        return result;
      } catch (err: any) {
        if (shouldEnforceDatabase()) {
          throw new LongitudinalDatabaseError("Transactional fact persistence failed. In-memory fallback is disabled in production/configured DB mode.", err);
        }
        console.warn("[LongitudinalFactService] DB insert failed, falling back to in-memory:", err);
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
