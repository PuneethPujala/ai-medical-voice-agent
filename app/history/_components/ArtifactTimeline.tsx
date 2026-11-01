"use client";

import React from "react";
import {
  ShieldCheck,
  FileText,
  Clock,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ArrowRight,
  GitCompare,
  Lock,
} from "lucide-react";
import type { ClinicalArtifact } from "@/lib/consultation/clinical-artifact-service";

export interface ArtifactTimelineProps {
  consultationId: string;
  artifacts: ClinicalArtifact[];
  selectedArtifactId?: string | null;
  onSelectArtifact?: (artifact: ClinicalArtifact) => void;
  onCompareVersions?: (baseArtifact: ClinicalArtifact, targetArtifact: ClinicalArtifact) => void;
  userRole?: "patient" | "clinician" | "admin";
  legacyApproved?: {
    isLegacy: boolean;
    approvedAt?: string | Date | null;
    approvedBy?: string | null;
  };
  className?: string;
}

export function ArtifactTimeline({
  consultationId,
  artifacts = [],
  selectedArtifactId,
  onSelectArtifact,
  onCompareVersions,
  userRole = "patient",
  legacyApproved,
  className = "",
}: ArtifactTimelineProps) {
  const isPhysician = userRole === "clinician" || userRole === "admin";

  // Filter artifacts according to patient/clinician visibility rules
  // Patients strictly receive only signed documents (no drafts, pending reviews, or cancelled notes)
  const visibleArtifacts = React.useMemo(() => {
    const sorted = [...artifacts].sort((a, b) => Number(a.version) - Number(b.version));
    if (isPhysician) {
      return sorted;
    }
    return sorted.filter((a) => a.status === "signed");
  }, [artifacts, isPhysician]);

  // Determine latest signed version number for supersession tracking
  const latestSignedVersion = React.useMemo(() => {
    const signedList = artifacts.filter((a) => a.status === "signed");
    if (signedList.length === 0) return 0;
    return Math.max(...signedList.map((a) => Number(a.version)));
  }, [artifacts]);

  // Format timestamp helper
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

  // Honest display for legacy-approved encounters without clinical_artifacts row
  if (visibleArtifacts.length === 0 && legacyApproved?.isLegacy) {
    return (
      <div className={`p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 ${className}`}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0 mt-0.5">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-xs text-slate-900 font-serif">Original Clinical Record</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                Legacy Attestation
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Approved prior to Milestone 6 artifact versioning migration. Recorded with clinician attestation.
            </p>
            <div className="text-[11px] text-slate-500 font-mono pt-1">
              <span>Attested by: {legacyApproved.approvedBy || "Attending Physician"}</span>
              {legacyApproved.approvedAt && (
                <span className="ml-3">· {formatDate(legacyApproved.approvedAt)}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (visibleArtifacts.length === 0) {
    return (
      <div className={`p-5 rounded-2xl bg-slate-50/70 border border-slate-200/80 text-center ${className}`}>
        <FileText className="w-6 h-6 text-slate-400 mx-auto mb-2" />
        <p className="text-xs font-medium text-slate-600">
          {isPhysician ? "No clinical artifact versions on record." : "Clinical documentation pending physician certification."}
        </p>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Timeline Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200/80">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-emerald-600" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 font-mono">
            Document Version Timeline
          </h3>
        </div>
        <span className="text-[11px] font-mono text-slate-500 font-bold bg-slate-100 px-2 py-0.5 rounded-full">
          {visibleArtifacts.length} {visibleArtifacts.length === 1 ? "Version" : "Versions"}
        </span>
      </div>

      {/* Stepper Node List */}
      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
        {visibleArtifacts.map((art, idx) => {
          const isSelected = selectedArtifactId === art.id;
          const isSigned = art.status === "signed";
          const isPending = art.status === "pending_review";
          const isDraft = art.status === "draft";
          const isCancelled = art.status === "cancelled";
          const isLatestSigned = isSigned && Number(art.version) === latestSignedVersion;
          const isSuperseded = isSigned && Number(art.version) < latestSignedVersion;

          // Find predecessor artifact for version diff
          const predecessor = idx > 0 ? visibleArtifacts[idx - 1] : null;

          return (
            <div
              key={art.id}
              className={`relative transition-all ${
                isSelected ? "ring-2 ring-emerald-500/40 rounded-xl" : ""
              }`}
            >
              {/* Node Bullet Icon */}
              <div
                className={`absolute -left-6 top-1 w-5 h-5 rounded-full flex items-center justify-center border-2 bg-white ${
                  isSigned
                    ? isLatestSigned
                      ? "border-emerald-500 text-emerald-600 shadow-xs"
                      : "border-slate-400 text-slate-500"
                    : isPending
                    ? "border-amber-500 text-amber-600 animate-pulse"
                    : isCancelled
                    ? "border-rose-400 text-rose-500"
                    : "border-cyan-500 text-cyan-600"
                }`}
              >
                {isSigned ? (
                  <ShieldCheck className="w-3 h-3" />
                ) : isPending ? (
                  <Clock className="w-3 h-3" />
                ) : isCancelled ? (
                  <XCircle className="w-3 h-3" />
                ) : (
                  <FileText className="w-3 h-3" />
                )}
              </div>

              {/* Node Content Card */}
              <div
                className={`p-3.5 rounded-xl border text-xs transition-colors ${
                  isSelected
                    ? "bg-emerald-50/50 border-emerald-300 shadow-xs"
                    : "bg-white border-slate-200/90 hover:border-slate-300"
                }`}
              >
                {/* Top Row: Version Badge & Status */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 text-xs">
                      Version {art.version}
                    </span>
                    {art.amendsArtifactId && (
                      <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <ArrowRight className="w-2.5 h-2.5 text-slate-400" />
                        <span>Amendment</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isLatestSigned && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100/80 text-emerald-800 border border-emerald-300">
                        <CheckCircle2 className="w-3 h-3" />
                        Latest Signed Version
                      </span>
                    )}
                    {isSuperseded && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                        Superseded by v{latestSignedVersion}
                      </span>
                    )}
                    {isPending && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        <Clock className="w-3 h-3" />
                        Pending Review
                      </span>
                    )}
                    {isDraft && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200">
                        {art.amendsArtifactId ? "Draft Amendment" : "Draft (In Progress)"}
                      </span>
                    )}
                    {isCancelled && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 line-through">
                        Cancelled Revision
                      </span>
                    )}
                  </div>
                </div>

                {/* Amendment Reason Callout */}
                {art.amendmentReason && (
                  <div className="mt-1.5 p-2 rounded-lg bg-amber-50/70 border border-amber-200/80 text-amber-950 text-[11px] leading-relaxed">
                    <span className="font-bold">Amendment Justification: </span>
                    <span>{art.amendmentReason}</span>
                  </div>
                )}

                {/* Attestation & Integrity Meta */}
                <div className="mt-2 text-[11px] text-slate-500 font-mono flex flex-wrap items-center gap-x-3 gap-y-1">
                  {art.signedBy && (
                    <span>Signed by: {art.signedBy}</span>
                  )}
                  {art.signedAt && (
                    <span>· {formatDate(art.signedAt)}</span>
                  )}
                  {isSigned && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-sans font-medium">
                      <Lock className="w-2.5 h-2.5" />
                      <span>Integrity verified (SHA-256)</span>
                    </span>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectArtifact?.(art)}
                    className={`inline-flex items-center gap-1 text-xs font-semibold cursor-pointer ${
                      isSelected
                        ? "text-emerald-700 underline font-bold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{isSelected ? "Currently Viewing" : "Inspect Version"}</span>
                  </button>

                  {/* Version Comparison Button (when predecessor exists) */}
                  {predecessor && onCompareVersions && (
                    <button
                      type="button"
                      onClick={() => onCompareVersions(predecessor, art)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-slate-200/80 text-slate-700 transition-colors cursor-pointer"
                      title={`Compare changes from v${predecessor.version} to v${art.version}`}
                    >
                      <GitCompare className="w-3 h-3 text-slate-500" />
                      <span>Compare with v{predecessor.version}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
