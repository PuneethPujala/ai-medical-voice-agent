import { PatientProfile } from "@/lib/clinical-knowledge/types";

/**
 * In-memory client-side profile cache scoped by userId and relationship.
 * Sensitive PHI is kept strictly in-memory (no localStorage) for HIPAA compliance.
 */
export interface RelationshipProfileCache {
  get(userId: string, relationship: string): PatientProfile | undefined;
  set(userId: string, relationship: string, profile: PatientProfile): void;
  getDraft(userId: string, relationship: string): Partial<PatientProfile> | undefined;
  setDraft(userId: string, relationship: string, draft: Partial<PatientProfile>): void;
  clearDraft(userId: string, relationship: string): void;
  hasPendingEdits(userId: string, relationship: string): boolean;
  clear(): void;
}

export class InMemoryProfileCache implements RelationshipProfileCache {
  private profiles = new Map<string, PatientProfile>();
  private drafts = new Map<string, Partial<PatientProfile>>();

  private makeKey(userId: string, relationship: string): string {
    return `${userId}:${(relationship || "self").toLowerCase().trim()}`;
  }

  get(userId: string, relationship: string): PatientProfile | undefined {
    return this.profiles.get(this.makeKey(userId, relationship));
  }

  set(userId: string, relationship: string, profile: PatientProfile): void {
    this.profiles.set(this.makeKey(userId, relationship), { ...profile });
  }

  getDraft(userId: string, relationship: string): Partial<PatientProfile> | undefined {
    return this.drafts.get(this.makeKey(userId, relationship));
  }

  setDraft(userId: string, relationship: string, draft: Partial<PatientProfile>): void {
    this.drafts.set(this.makeKey(userId, relationship), { ...draft });
  }

  clearDraft(userId: string, relationship: string): void {
    this.drafts.delete(this.makeKey(userId, relationship));
  }

  hasPendingEdits(userId: string, relationship: string): boolean {
    return this.drafts.has(this.makeKey(userId, relationship));
  }

  clear(): void {
    this.profiles.clear();
    this.drafts.clear();
  }
}

// Global in-memory cache singleton for client session
export const clientProfileCache = new InMemoryProfileCache();

/**
 * Robust dirty form detection comparing saved baseline against current form state
 */
export function isProfileFormDirty(
  baseline: Partial<PatientProfile> | null | undefined,
  current: Partial<PatientProfile>
): boolean {
  if (!baseline) {
    return Boolean(
      current.name?.trim() ||
      current.dateOfBirth ||
      (current.age !== undefined && current.age !== null) ||
      current.sexAssignedAtBirth ||
      current.gender ||
      current.bloodGroup ||
      (current.pregnancyStatus && current.pregnancyStatus !== "not_applicable") ||
      (current.smokingStatus && current.smokingStatus !== "unknown") ||
      (current.allergyStatus && current.allergyStatus !== "unassessed") ||
      (current.knownConditions && current.knownConditions.length > 0) ||
      (current.currentMedications && current.currentMedications.length > 0) ||
      (current.drugAllergies && current.drugAllergies.length > 0) ||
      (current.surgicalHistory && current.surgicalHistory.length > 0) ||
      current.clinicalNotes?.trim() ||
      current.emergencyContact?.name?.trim() ||
      current.emergencyContact?.phone?.trim()
    );
  }

  const baseName = baseline.name?.trim() || "";
  const curName = current.name?.trim() || "";
  if (baseName !== curName) return true;

  if ((baseline.dateOfBirth || "") !== (current.dateOfBirth || "")) return true;
  if ((baseline.age ?? undefined) !== (current.age ?? undefined)) return true;
  if ((baseline.sexAssignedAtBirth || "") !== (current.sexAssignedAtBirth || "")) return true;
  if ((baseline.gender || "") !== (current.gender || "")) return true;
  if ((baseline.bloodGroup || "") !== (current.bloodGroup || "")) return true;
  if ((baseline.language || "en") !== (current.language || "en")) return true;
  if ((baseline.pregnancyStatus || "not_applicable") !== (current.pregnancyStatus || "not_applicable")) return true;
  if ((baseline.smokingStatus || "unknown") !== (current.smokingStatus || "unknown")) return true;
  if ((baseline.allergyStatus || "unassessed") !== (current.allergyStatus || "unassessed")) return true;
  if ((baseline.clinicalNotes || "") !== (current.clinicalNotes || "")) return true;

  // Compare arrays
  const baseConds = (baseline.knownConditions || []).slice().sort().join(",");
  const curConds = (current.knownConditions || []).slice().sort().join(",");
  if (baseConds !== curConds) return true;

  const baseMeds = (baseline.currentMedications || []).map(m => `${m.name}:${m.dose}:${m.frequency}`).sort().join(";");
  const curMeds = (current.currentMedications || []).map(m => `${m.name}:${m.dose}:${m.frequency}`).sort().join(";");
  if (baseMeds !== curMeds) return true;

  const baseAllergies = (baseline.drugAllergies || []).map(a => `${a.drugName}:${a.severity}`).sort().join(";");
  const curAllergies = (current.drugAllergies || []).map(a => `${a.drugName}:${a.severity}`).sort().join(";");
  if (baseAllergies !== curAllergies) return true;

  const baseSurg = (baseline.surgicalHistory || []).slice().sort().join(",");
  const curSurg = (current.surgicalHistory || []).slice().sort().join(",");
  if (baseSurg !== curSurg) return true;

  const baseEmerg = `${baseline.emergencyContact?.name || ""}:${baseline.emergencyContact?.phone || ""}:${baseline.emergencyContact?.relationship || ""}`;
  const curEmerg = `${current.emergencyContact?.name || ""}:${current.emergencyContact?.phone || ""}:${current.emergencyContact?.relationship || ""}`;
  if (baseEmerg !== curEmerg) return true;

  const baseAccess = `${baseline.accessibilityPreferences?.communicationStyle || ""}:${baseline.accessibilityPreferences?.notes || ""}`;
  const curAccess = `${current.accessibilityPreferences?.communicationStyle || ""}:${current.accessibilityPreferences?.notes || ""}`;
  if (baseAccess !== curAccess) return true;

  return false;
}
