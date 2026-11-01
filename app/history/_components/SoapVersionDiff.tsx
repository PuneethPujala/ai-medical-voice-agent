"use client";

import React, { useState, useMemo } from "react";
import {
  GitCompare,
  ArrowRight,
  ShieldCheck,
  FileText,
  Clock,
  ArrowLeft,
  Activity,
  Layers,
  CheckCircle2,
  AlertCircle,
  Hash,
} from "lucide-react";
import {
  computeArtifactDiff,
  ArtifactDiffReport,
  DiffChunk,
} from "@/lib/consultation/clinical-diff";
import type { ClinicalArtifact } from "@/lib/consultation/clinical-artifact-service";

export interface SoapVersionDiffProps {
  baseArtifact: ClinicalArtifact;
  targetArtifact: ClinicalArtifact;
  onBack?: () => void;
  className?: string;
}

export function SoapVersionDiff({
  baseArtifact,
  targetArtifact,
  onBack,
  className = "",
}: SoapVersionDiffProps) {
  const [diffMode, setDiffMode] = useState<"side-by-side" | "unified">("side-by-side");

  React.useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setDiffMode("unified");
    }
  }, []);

  const diffReport: ArtifactDiffReport = useMemo(() => {
    return computeArtifactDiff(baseArtifact, targetArtifact);
  }, [baseArtifact, targetArtifact]);

  const formatDate = (dateVal?: string | Date | null) => {
    if (!dateVal) return "Date unrecorded";
    try {
      const d = new Date(dateVal);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return String(dateVal);
    }
  };

  const renderDiffChunks = (chunks: DiffChunk[]) => {
    return (
      <div className="font-sans leading-relaxed whitespace-pre-wrap text-xs sm:text-sm text-slate-800">
        {chunks.map((chunk, idx) => {
          if (chunk.type === "added") {
            return (
              <span
                key={idx}
                className="bg-emerald-50 text-emerald-900 font-medium px-1 py-0.5 rounded-xs border-b-2 border-emerald-500/70 mx-0.5"
                title="Added in this revision"
              >
                {chunk.value}
              </span>
            );
          }
          if (chunk.type === "removed") {
            return (
              <span
                key={idx}
                className="bg-rose-50 text-rose-800 line-through px-1 py-0.5 rounded-xs border-b border-rose-300 opacity-80 mx-0.5"
                title="Removed from previous revision"
              >
                {chunk.value}
              </span>
            );
          }
          return <span key={idx}>{chunk.value}</span>;
        })}
      </div>
    );
  };

  const renderSectionSideBySide = (
    title: string,
    sectionKey: "chiefComplaint" | "subjective" | "objective" | "assessment" | "plan",
    badgeLabel?: string
  ) => {
    const sec = diffReport[sectionKey];
    return (
      <section className="space-y-2 border-b border-slate-200/80 pb-4 last:border-b-0 font-sans">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 tracking-normal font-sans">
              {title}
            </h4>
            {badgeLabel && (
              <span className="text-[11px] font-sans px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                {badgeLabel}
              </span>
            )}
          </div>
          {sec.hasChanges ? (
            <span className="text-[11px] font-sans font-semibold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
              Modified
            </span>
          ) : (
            <span className="text-[11px] font-sans text-slate-400">Unchanged</span>
          )}
        </div>

        {diffMode === "unified" || !sec.hasChanges ? (
          <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200">
            {sec.hasChanges ? (
              renderDiffChunks(sec.chunks)
            ) : (
              <p className="text-xs sm:text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {sec.targetText || "(Empty)"}
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Base Version */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1.5 shadow-2xs">
              <span className="text-xs font-semibold text-rose-700 block font-sans">
                v{diffReport.baseVersion} (Previous)
              </span>
              <p className="text-xs sm:text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {sec.baseText || "(Empty)"}
              </p>
            </div>
            {/* Target Version */}
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1.5 shadow-2xs">
              <span className="text-xs font-semibold text-emerald-700 block font-sans">
                v{diffReport.targetVersion} (Revision)
              </span>
              <p className="text-xs sm:text-sm text-slate-800 whitespace-pre-wrap leading-relaxed font-medium">
                {sec.targetText || "(Empty)"}
              </p>
            </div>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Diff Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
              title="Return to note view"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm sm:text-base font-bold text-slate-900 font-sans">
                SOAP Revision Comparison
              </h3>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 font-sans mt-0.5">
              <span>v{diffReport.baseVersion}</span>
              <ArrowRight className="w-3 h-3 text-slate-400" />
              <span>v{diffReport.targetVersion}</span>
              <span className="text-slate-300">|</span>
              <span className="text-emerald-700 font-medium">
                {diffReport.hasClinicalChanges ? "Clinical changes detected" : "Identical clinical content"}
              </span>
            </div>
          </div>
        </div>

        {/* View Toggle */}
        <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-sans">
          <button
            type="button"
            onClick={() => setDiffMode("side-by-side")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
              diffMode === "side-by-side"
                ? "bg-white text-slate-900 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Side-by-Side
          </button>
          <button
            type="button"
            onClick={() => setDiffMode("unified")}
            className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
              diffMode === "unified"
                ? "bg-white text-slate-900 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Inline Highlights
          </button>
        </div>
      </div>

      {/* Amendment Reason Callout */}
      {diffReport.amendmentReason && (
        <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/90 text-amber-950 flex items-start gap-2 text-xs font-sans">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-bold text-amber-900">Amendment Justification: </span>
            <span className="text-amber-800">{diffReport.amendmentReason}</span>
          </div>
        </div>
      )}

      {/* Version Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-sans">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-slate-900">v{baseArtifact.version}</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-200/80 text-slate-700 font-medium">
            {baseArtifact.status}
          </span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500 text-[11px]">
            {baseArtifact.signedBy ? `Signed by ${baseArtifact.signedBy}` : `Created ${formatDate(baseArtifact.createdAt)}`}
          </span>
        </div>

        <ArrowRight className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-emerald-900">v{targetArtifact.version}</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
            {targetArtifact.status}
          </span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-600 text-[11px]">
            {targetArtifact.signedBy ? `Signed by ${targetArtifact.signedBy}` : `Updated ${formatDate(targetArtifact.updatedAt || targetArtifact.createdAt)}`}
          </span>
        </div>
      </div>

      {/* Structured SOAP Sections Diff */}
      <div className="space-y-4">
        {renderSectionSideBySide("Chief Complaint", "chiefComplaint")}
        {renderSectionSideBySide("Subjective", "subjective", "Patient Reported")}
        {renderSectionSideBySide("Objective", "objective", "Clinical Observations")}
        {renderSectionSideBySide("Assessment", "assessment", "Clinical Impression")}
        {renderSectionSideBySide("Plan", "plan", "Care Directives")}
      </div>

      {/* ICD-10 Codes and ESI Score Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 font-sans">
        {/* ICD-10 Tags */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <span className="text-xs font-semibold text-slate-700 block">
            ICD-10 Diagnostic Codes
          </span>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {diffReport.icd10Codes.diff.unchanged.map((c) => (
              <span key={c} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium font-sans">
                {c}
              </span>
            ))}
            {diffReport.icd10Codes.diff.added.map((c) => (
              <span key={c} className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300 text-[11px] font-semibold font-sans">
                + {c}
              </span>
            ))}
            {diffReport.icd10Codes.diff.removed.map((c) => (
              <span key={c} className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 line-through border border-rose-300 text-[11px] font-medium font-sans">
                - {c}
              </span>
            ))}
            {diffReport.icd10Codes.base.length === 0 && diffReport.icd10Codes.target.length === 0 && (
              <span className="text-slate-400 text-xs">No ICD-10 codes recorded</span>
            )}
          </div>
        </div>

        {/* ESI Acuity Score */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <span className="text-xs font-semibold text-slate-700 block">
            ESI Acuity Score
          </span>
          <div className="flex items-center gap-3 text-xs">
            {diffReport.esiScore.hasChanges ? (
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 rounded-md bg-rose-100 text-rose-800 font-semibold font-sans">
                  ESI {diffReport.esiScore.base ?? "N/A"}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="px-2 py-1 rounded-md bg-emerald-100 text-emerald-800 font-semibold font-sans">
                  ESI {diffReport.esiScore.target ?? "N/A"}
                </span>
              </div>
            ) : (
              <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-800 font-semibold font-sans">
                ESI {diffReport.esiScore.target ?? "Unspecified"} (Unchanged)
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
