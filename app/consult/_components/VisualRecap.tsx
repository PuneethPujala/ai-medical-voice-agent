"use client";

import React from "react";
import {
  FileText,
  Clock,
  History,
  HelpCircle,
  AlertCircle,
  CheckCircle2,
  Stethoscope,
  Sparkles,
  ShieldCheck,
  Link as LinkIcon,
} from "lucide-react";
import {
  GroundedRecapCategories,
  GroundedRecapProvenance,
  extractGroundedRecapCategories,
} from "@/lib/triage/recap-categories";

interface VisualRecapProps {
  consultation: any;
  categories?: GroundedRecapCategories;
}

function ProvenanceBadge({ provenance }: { provenance: GroundedRecapProvenance }) {
  const configs: Record<GroundedRecapProvenance, { label: string; bg: string; text: string; border: string }> = {
    patient_reported: {
      label: "Patient Reported",
      bg: "bg-blue-50/80",
      text: "text-blue-700",
      border: "border-blue-200/60",
    },
    model_extracted: {
      label: "Model Extracted",
      bg: "bg-purple-50/80",
      text: "text-purple-700",
      border: "border-purple-200/60",
    },
    clinician_confirmed: {
      label: "Clinician Confirmed",
      bg: "bg-emerald-50/80",
      text: "text-emerald-700",
      border: "border-emerald-200/60",
    },
    parent_encounter: {
      label: "Prior Encounter",
      bg: "bg-amber-50/80",
      text: "text-amber-800",
      border: "border-amber-200/60",
    },
    historical_record: {
      label: "Longitudinal Record",
      bg: "bg-slate-100",
      text: "text-slate-700",
      border: "border-slate-200",
    },
  };

  const c = configs[provenance] || configs.patient_reported;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${c.bg} ${c.text} ${c.border}`}
    >
      {c.label}
    </span>
  );
}

export function VisualRecap({ consultation, categories }: VisualRecapProps) {
  const recap = categories || extractGroundedRecapCategories(consultation);

  return (
    <div className="space-y-4">
      {/* 4 Grounded Clinical Category Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Category 1: Previously Reported */}
        <div className="rounded-2xl bg-white border border-slate-200/90 p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-slate-600" />
                Previously Reported
              </span>
              <span className="text-[11px] font-medium text-slate-400">
                {recap.previouslyReported.length} baseline item{recap.previouslyReported.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="pt-3 space-y-2.5">
              {recap.previouslyReported.length > 0 ? (
                recap.previouslyReported.map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/60 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-bold text-slate-800">{item.label}</span>
                      <ProvenanceBadge provenance={item.provenance} />
                    </div>
                    {item.value && (
                      <p className="text-slate-600 font-medium leading-relaxed">{item.value}</p>
                    )}
                    {item.sourceEncounterId && (
                      <p className="text-[10px] text-slate-400 font-mono mt-1">
                        Ref: {item.sourceEncounterId}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div className="p-3 rounded-xl bg-slate-50/50 border border-dashed border-slate-200 text-center">
                  <p className="text-xs text-slate-400">
                    No prior longitudinal facts or parent encounter linked.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Category 2: Information Discussed */}
        <div className="rounded-2xl bg-white border border-slate-200/90 p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Stethoscope className="w-3.5 h-3.5 text-emerald-600" />
                Information Discussed
              </span>
              <span className="text-[11px] font-medium text-slate-400">
                {recap.informationDiscussed.length} clinical slot{recap.informationDiscussed.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="pt-3 space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {recap.informationDiscussed.length > 0 ? (
                recap.informationDiscussed.map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/60 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-bold text-slate-800">{item.label}</span>
                      <ProvenanceBadge provenance={item.provenance} />
                    </div>
                    <p className="text-slate-900 font-semibold leading-relaxed">{item.value}</p>
                  </div>
                ))
              ) : (
                <div className="p-3 rounded-xl bg-slate-50/50 border border-dashed border-slate-200 text-center">
                  <p className="text-xs text-slate-400">
                    Consultation was paused before clinical slots were established.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Category 3: Still to Explore */}
        <div className="rounded-2xl bg-white border border-slate-200/90 p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-blue-600" />
                Still to Explore
              </span>
              <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200/60">
                {recap.stillToExplore.length} dimension{recap.stillToExplore.length === 1 ? "" : "s"} pending
              </span>
            </div>

            <div className="pt-3 space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {recap.stillToExplore.length > 0 ? (
                recap.stillToExplore.map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-xl bg-blue-50/40 border border-blue-200/50 text-xs"
                  >
                    <span className="font-bold text-slate-900 block mb-0.5">
                      {item.dimension}
                    </span>
                    <p className="text-slate-600 font-normal leading-relaxed">
                      {item.clinicalRationale}
                    </p>
                  </div>
                ))
              ) : (
                <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-200 text-center">
                  <p className="text-xs text-emerald-800 font-medium">
                    All core triage dimensions have been explored.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Category 4: Changes Since Pause */}
        <div className="rounded-2xl bg-white border border-slate-200/90 p-4 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                Changes Since Pause
              </span>
              {recap.changesSincePause.existingAddenda.length > 0 && (
                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                  {recap.changesSincePause.existingAddenda.length} addendum saved
                </span>
              )}
            </div>

            <div className="pt-3 space-y-2.5">
              <div className="p-2.5 rounded-xl bg-amber-50/60 border border-amber-200/60 text-xs">
                <p className="text-amber-950 font-medium leading-relaxed">
                  {recap.changesSincePause.prompt}
                </p>
              </div>

              {recap.changesSincePause.existingAddenda.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-bold text-slate-500 block uppercase">
                    Saved Patient Amendments:
                  </span>
                  {recap.changesSincePause.existingAddenda.map((addendum) => (
                    <div
                      key={addendum.id}
                      className="p-2 rounded-lg bg-slate-50 border border-slate-200/80 text-[11px] text-slate-700 font-medium"
                    >
                      {addendum.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
