"use client";

import React from "react";
import {
  Clock,
  MessageSquare,
  CheckCircle,
  ChevronRight,
  Stethoscope,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
} from "lucide-react";

interface SymptomChronologyProps {
  encounterId?: string;
  transcript?: Array<{ id?: string; role: string; text: string; timestamp?: string }>;
  detectedSymptoms?: string[];
  slots?: Record<string, any>;
  patientCorrections?: any[];
  historicalSymptoms?: string[];
}

export function SymptomChronology({
  encounterId,
  transcript = [],
  detectedSymptoms = [],
  slots = {},
  patientCorrections = [],
  historicalSymptoms = [],
}: SymptomChronologyProps) {
  const hasEstablishedOnset = Boolean(slots.onset || slots.onset_time);
  const establishedOnsetText = slots.onset || slots.onset_time || "Unknown / Not specified";

  // Dialogue events with strict separation between recordedAt and occurredAt
  const dialogueEvents = React.useMemo(() => {
    const events: Array<{
      id: string;
      role: string;
      text: string;
      recordedAt?: string;
      occurredAt: string;
      turnIndex: number;
      isAddendum: boolean;
      highlight?: string;
      isHistorical?: boolean;
    }> = [];

    transcript.forEach((t, idx) => {
      const isAddendum =
        t.text.startsWith("[Patient Addendum") ||
        t.text.startsWith("[Patient Correction") ||
        t.text.includes("Correction ·");

      // Check if turn references any detected or historical symptoms
      let highlight: string | undefined;
      let isHistorical = false;

      for (const sym of detectedSymptoms) {
        if (t.text.toLowerCase().includes(sym.toLowerCase())) {
          highlight = sym;
          isHistorical = false;
          break;
        }
      }

      if (!highlight) {
        for (const sym of historicalSymptoms) {
          if (t.text.toLowerCase().includes(sym.toLowerCase())) {
            highlight = sym;
            isHistorical = true;
            break;
          }
        }
      }

      // Event onset time is NEVER inferred from recordedAt timestamp!
      const occurredAt = hasEstablishedOnset
        ? establishedOnsetText
        : "Unknown / Not specified (prior to intake statement)";

      events.push({
        id: t.id || `turn-${idx}`,
        role: t.role,
        text: t.text,
        recordedAt: t.timestamp || "Timestamp not captured",
        occurredAt,
        turnIndex: idx + 1,
        isAddendum,
        highlight,
        isHistorical,
      });
    });

    return events;
  }, [transcript, detectedSymptoms, historicalSymptoms, hasEstablishedOnset, establishedOnsetText]);

  return (
    <div className="space-y-4">
      {/* 1. Temporal Invariant Banner: Separating Statement Recording Time from Actual Symptom Onset Time */}
      <div className="rounded-2xl bg-white border border-slate-200/90 p-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-700" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Dialogue Chronology & Temporal Separation
            </h4>
          </div>
          {encounterId && (
            <span className="text-[11px] font-mono text-slate-400">
              Encounter: {encounterId}
            </span>
          )}
        </div>

        <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
              Symptom Event Onset (occurredAt):
            </span>
            {hasEstablishedOnset ? (
              <div className="flex items-center gap-1.5 text-slate-900 font-semibold">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{establishedOnsetText}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-amber-900 font-medium bg-amber-50/80 px-2.5 py-1 rounded-lg border border-amber-200/60">
                <HelpCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>Unknown / Not specified</span>
              </div>
            )}
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
              Clinical Guardrail:
            </span>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Message timestamps indicate when a statement was <strong>recorded</strong> (recordedAt), never when the symptom began (occurredAt).
            </p>
          </div>
        </div>
      </div>

      {/* 2. Chronological Dialogue Statements */}
      {dialogueEvents.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200/90 p-5 shadow-2xs text-center">
          <p className="text-xs text-slate-400">
            No dialogue turns recorded yet in this consultation.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-slate-200/90 p-5 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
            <div className="flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-emerald-700" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Dialogue Chronology (Recorded Statements)
              </h3>
            </div>
            <span className="text-xs font-medium text-slate-400">
              {dialogueEvents.length} dialogue turn{dialogueEvents.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
            {dialogueEvents.map((event) => (
              <div key={event.id} className="relative group">
                {/* Timeline node */}
                <span
                  className={`absolute -left-6 top-1 w-3 h-3 rounded-full border-2 border-white shadow-2xs ${
                    event.isAddendum
                      ? "bg-amber-500 ring-2 ring-amber-200"
                      : event.role === "doctor"
                      ? "bg-slate-900"
                      : "bg-emerald-500"
                  }`}
                />

                <div
                  className={`p-3 rounded-xl border text-xs leading-relaxed ${
                    event.isAddendum
                      ? "bg-amber-50/70 border-amber-200/80 text-amber-950 font-medium"
                      : event.role === "doctor"
                      ? "bg-slate-50/70 border-slate-200/70 text-slate-700"
                      : "bg-white border-slate-200/90 text-slate-900 font-medium shadow-2xs"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {event.role === "doctor"
                        ? "Attending Clinician"
                        : event.isAddendum
                        ? "Patient Correction / Addendum"
                        : "Patient"}{" "}
                      · Turn {event.turnIndex}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      recordedAt: {event.recordedAt}
                    </span>
                  </div>

                  <p>{event.text}</p>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 text-[10px]">
                    {event.highlight && (
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold border ${
                          event.isHistorical
                            ? "bg-amber-50 text-amber-800 border-amber-200/60"
                            : "bg-emerald-50 text-emerald-800 border-emerald-200/60"
                        }`}
                      >
                        <CheckCircle className="w-2.5 h-2.5 text-emerald-600" />
                        {event.highlight} {event.isHistorical && "(Prior Visit)"}
                      </span>
                    )}

                    <span className="text-slate-400 italic">
                      occurredAt: {event.occurredAt}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
