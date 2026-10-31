"use client";

import React, { useEffect, useState, useRef } from "react";
import { AlertCircle, Lock, RefreshCw, ShieldAlert, ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  migrateInterviewState,
  InterviewStateMigrationResult,
  RecoverableClinicalData,
} from "@/lib/triage/interview-state-migration";
import type { ClinicalInterviewState } from "@/lib/triage/conversation-manager";
import { getDoctorById, DoctorProfile } from "@/config/doctors";

export interface RestoredConsultationPayload {
  encounterId: string;
  interviewState: ClinicalInterviewState;
  transcript: Array<{ role: "patient" | "doctor" | "system"; text: string; timestamp?: string }>;
  deliveredTurnRecords: any[];
  attributedFacts: any[];
  unmappedObservations: any[];
  detectedSymptoms: string[];
  chiefComplaint?: string;
  caseVersion: number;
  durationSeconds: number;
  doctor: DoctorProfile | null;
  status: string;
  isLocked: boolean;
  rawRecord: any;
}

export interface ResumeStateRestorerProps {
  encounterId: string;
  onRestored: (payload: RestoredConsultationPayload) => void;
  onLocked?: (record: any) => void;
  onMigrationFailure?: (result: InterviewStateMigrationResult) => void;
  children?: React.ReactNode;
}

export function ResumeStateRestorer({
  encounterId,
  onRestored,
  onLocked,
  onMigrationFailure,
  children,
}: ResumeStateRestorerProps) {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [lockedRecord, setLockedRecord] = useState<any>(null);
  const [migrationFailure, setMigrationFailure] = useState<InterviewStateMigrationResult | null>(null);

  const hasFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!encounterId) {
      setIsLoading(false);
      return;
    }

    if (hasFetchedRef.current === encounterId) {
      return;
    }
    hasFetchedRef.current = encounterId;

    const controller = new AbortController();
    let isMounted = true;

    async function loadAuthoritativeEncounter() {
      setIsLoading(true);
      setFetchError(null);
      setMigrationFailure(null);
      setIsLocked(false);

      try {
        const res = await fetch(`/api/consultations/${encounterId}`, {
          signal: controller.signal,
          headers: {
            "Cache-Control": "no-cache",
          },
        });

        if (!isMounted) return;

        if (!res.ok) {
          if (res.status === 404) {
            setFetchError("Consultation encounter not found. The record may have expired or been removed.");
          } else if (res.status === 403) {
            setFetchError("Forbidden: You are not authorized to access this clinical encounter.");
          } else {
            setFetchError("Unable to restore clinical consultation record.");
          }
          setIsLoading(false);
          return;
        }

        const data = await res.json();
        const record = data.consultation;

        if (!record) {
          setFetchError("Clinical datastore returned empty encounter record.");
          setIsLoading(false);
          return;
        }

        // 1. Signed Record Invariant: Locked against active resume
        if (record.status === "approved") {
          setIsLocked(true);
          setLockedRecord(record);
          setIsLoading(false);
          if (onLocked) onLocked(record);
          return;
        }

        // 2. Versioned Interview State Migration & Validation
        const migration = migrateInterviewState(record.interviewState);

        if (migration.status === "unsupported_version" || migration.status === "corrupted") {
          console.error(
            `[ResumeStateRestorer] Encounter ${encounterId} state migration failed (${migration.status}):`,
            migration.error
          );
          setMigrationFailure(migration);
          setIsLoading(false);
          if (onMigrationFailure) onMigrationFailure(migration);
          return;
        }

        // 3. Build single authoritative restoration payload
        const doctorProfile = record.doctorId ? getDoctorById(record.doctorId) || null : null;

        const payload: RestoredConsultationPayload = {
          encounterId: record.id,
          interviewState: migration.state!,
          transcript: Array.isArray(record.transcript) ? record.transcript : [],
          deliveredTurnRecords: Array.isArray(record.deliveredTurnRecords)
            ? record.deliveredTurnRecords
            : [],
          attributedFacts: Array.isArray(record.attributedFacts) ? record.attributedFacts : [],
          unmappedObservations: Array.isArray(record.unmappedObservations)
            ? record.unmappedObservations
            : [],
          detectedSymptoms: Array.isArray(record.detectedSymptoms) ? record.detectedSymptoms : [],
          chiefComplaint: record.chiefComplaint || undefined,
          caseVersion: Number(record.caseVersion || 1),
          durationSeconds: Number(record.durationSeconds || 0),
          doctor: doctorProfile,
          status: record.status,
          isLocked: false,
          rawRecord: record,
        };

        setIsLoading(false);
        onRestored(payload);
      } catch (err: any) {
        if (err.name === "AbortError") return;
        if (isMounted) {
          console.error("[ResumeStateRestorer] Network/Restore error:", err);
          setFetchError(err?.message || "Failed to connect to consultation datastore.");
          setIsLoading(false);
        }
      }
    }

    loadAuthoritativeEncounter();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [encounterId, onRestored, onLocked, onMigrationFailure]);

  // Loading Screen
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-6 text-center">
        <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm font-semibold text-slate-800">Restoring clinical encounter...</p>
        <p className="text-xs text-slate-400 mt-1">
          Validating state integrity and conversation turns ({encounterId})
        </p>
      </div>
    );
  }

  // Error Screen
  if (fetchError) {
    return (
      <div className="max-w-lg mx-auto my-12 p-6 rounded-3xl bg-rose-50 border border-rose-200 text-center">
        <AlertCircle className="w-8 h-8 text-rose-600 mx-auto mb-3" />
        <h3 className="text-base font-bold text-rose-950 mb-1">Restoration Failed</h3>
        <p className="text-xs sm:text-sm text-rose-700 mb-6">{fetchError}</p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/history"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-white text-rose-900 border border-rose-200 hover:bg-rose-100/50 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to History</span>
          </Link>
          <button
            onClick={() => {
              hasFetchedRef.current = null;
              setIsLoading(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-rose-700 text-white hover:bg-rose-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      </div>
    );
  }

  // Signed Record Locked Screen
  if (isLocked) {
    return (
      <div className="max-w-lg mx-auto my-12 p-8 rounded-3xl bg-white border border-slate-200 shadow-xl text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4 border border-emerald-200">
          <Lock className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-950 mb-2">Physician-Signed Record</h3>
        <p className="text-xs sm:text-sm text-slate-600 mb-6 leading-relaxed">
          This consultation has been officially signed and finalized by{" "}
          <strong className="text-slate-900">{lockedRecord?.doctorName || "the attending physician"}</strong>.
          Signed clinical documentation cannot be resumed or modified.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/history"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            View in Consultation History
          </Link>
          <Link
            href="/consult"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
          >
            Start New Consultation
          </Link>
        </div>
      </div>
    );
  }

  // Migration Failure Recoverable Screen
  if (migrationFailure) {
    const recoverable = migrationFailure.recoverableData || {};
    const turnsCount = recoverable.transcript?.length || 0;

    return (
      <div className="max-w-xl mx-auto my-12 p-8 rounded-3xl bg-amber-50/80 border border-amber-200 shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <ShieldAlert className="w-7 h-7 text-amber-700 shrink-0" />
          <div>
            <h3 className="text-base font-bold text-amber-950">
              Encounter Schema Recovery Mode
            </h3>
            <p className="text-xs text-amber-800">
              Encounter state requires review ({migrationFailure.status})
            </p>
          </div>
        </div>

        <p className="text-xs sm:text-sm text-amber-900 leading-relaxed mb-4">
          The internal state schema for this consultation cannot be automatically migrated to the
          current system version. To protect your medical record,{" "}
          <strong>no data has been cleared or overwritten</strong>. All recorded symptoms and dialogue
          turns are securely preserved below.
        </p>

        {/* Recoverable clinical summary */}
        <div className="p-4 rounded-2xl bg-white/90 border border-amber-200/80 text-xs text-slate-700 space-y-2 mb-6">
          <div>
            <strong className="text-slate-900">Chief Complaint:</strong>{" "}
            {recoverable.chiefComplaint || "Not specified"}
          </div>
          <div>
            <strong className="text-slate-900">Recorded Turns:</strong> {turnsCount} conversation turns
          </div>
          {recoverable.detectedSymptoms && recoverable.detectedSymptoms.length > 0 && (
            <div>
              <strong className="text-slate-900">Reported Symptoms:</strong>{" "}
              {recoverable.detectedSymptoms.join(", ")}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-end gap-3">
          <Link
            href="/history"
            className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-amber-300 text-amber-900 hover:bg-amber-100/50 text-center transition-colors"
          >
            Return to History
          </Link>
          <Link
            href={`/consult?followUpFrom=${encounterId}`}
            className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-bold bg-amber-700 text-white hover:bg-amber-800 text-center transition-colors"
          >
            Start Linked Follow-Up
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
