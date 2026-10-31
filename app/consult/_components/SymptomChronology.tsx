"use client";

import React from "react";
import { Clock, MessageSquare, CheckCircle, ChevronRight, Stethoscope } from "lucide-react";

interface SymptomChronologyProps {
  transcript?: Array<{ role: string; text: string; timestamp?: string }>;
  detectedSymptoms?: string[];
  slots?: Record<string, any>;
}

export function SymptomChronology({
  transcript = [],
  detectedSymptoms = [],
  slots = {},
}: SymptomChronologyProps) {
  // Extract turns where patient described symptoms or answers were given
  const clinicalEvents = React.useMemo(() => {
    const events: Array<{
      id: string;
      role: string;
      text: string;
      timestamp?: string;
      turnIndex: number;
      isAddendum: boolean;
      highlight?: string;
    }> = [];

    transcript.forEach((t, idx) => {
      const isAddendum =
        t.text.startsWith("[Patient Addendum") ||
        t.text.startsWith("[Patient Correction") ||
        t.text.includes("Correction ·");

      // Check if turn references any detected symptoms
      let highlight: string | undefined;
      for (const sym of detectedSymptoms) {
        if (t.text.toLowerCase().includes(sym.toLowerCase())) {
          highlight = sym;
          break;
        }
      }

      events.push({
        id: `turn-${idx}`,
        role: t.role,
        text: t.text,
        timestamp: t.timestamp,
        turnIndex: idx + 1,
        isAddendum,
        highlight,
      });
    });

    return events;
  }, [transcript, detectedSymptoms]);

  if (clinicalEvents.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200/90 p-5 shadow-2xs text-center">
        <p className="text-xs text-slate-400">
          No dialogue turns recorded yet in this consultation.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white border border-slate-200/90 p-5 shadow-2xs">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-600" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Symptom Chronology & Dialogue Flow
          </h3>
        </div>
        <span className="text-xs font-medium text-slate-400">
          {clinicalEvents.length} dialogue event{clinicalEvents.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
        {clinicalEvents.map((event) => (
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
                  {event.role === "doctor" ? "Attending Clinician" : "Patient"} · Turn {event.turnIndex}
                </span>
                {event.timestamp && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    {event.timestamp}
                  </span>
                )}
              </div>

              <p>{event.text}</p>

              {event.highlight && (
                <div className="mt-2 flex items-center gap-1.5 pt-1.5 border-t border-slate-100">
                  <span className="text-[10px] text-slate-400">Elicited symptom:</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/60">
                    <CheckCircle className="w-2.5 h-2.5 text-emerald-600" />
                    {event.highlight}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
