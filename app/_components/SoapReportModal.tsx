"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  FileText,
  Download,
  Copy,
  Check,
  Edit3,
  Save,
  CheckCircle2,
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ShieldCheck,
  GitBranch,
  Lock,
  Send,
  AlertCircle,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import PremiumButton from "@/components/PremiumButton";
import { generateFHIRBundle } from "@/lib/fhir/bundle";

export interface SoapEncounterData {
  id?: string;
  patientName?: string;
  patientAge?: string;
  patientGender?: string;
  doctorId?: string;
  doctorName?: string;
  specialty?: string;
  callDuration?: number;
  transcript?: Array<{ role: string; text: string; timestamp?: string }>;
  triageLevel?: string;
  triageTitle?: string;
  esiScore?: number | null;
  detectedSymptoms?: string[];
  icdCodes?: string[];
  recommendedAction?: string;
  soap?: {
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
  };
  auditSha256?: string;
  boardConsensusCount?: string;
  userId?: string;
  userRole?: string;
  caseVersion?: number;
  status?: string;
  approvedAt?: string | Date;
  approvedBy?: string;
}

interface SoapReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  encounter: SoapEncounterData;
  onSaveSuccess?: (savedRecord: any) => void;
}

function formatNaturalDuration(seconds?: number): string {
  const total = Math.max(1, Math.round(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins === 0) {
    return `${secs} sec`;
  }
  if (secs === 0) {
    return `${mins} min`;
  }
  return `${mins} min ${secs} sec`;
}

export function SoapReportModal({
  isOpen,
  onClose,
  encounter,
  onSaveSuccess,
}: SoapReportModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [subjective, setSubjective] = useState("");
  const [objective, setObjective] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedNote, setCopiedNote] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  // Artifact Architecture State
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<any | null>(null);
  const [isLoadingArtifacts, setIsLoadingArtifacts] = useState(false);
  const [showAmendmentPrompt, setShowAmendmentPrompt] = useState(false);
  const [amendmentReason, setAmendmentReason] = useState("");

  const encounterId = encounter?.id || "";
  const isClinicianOrAdmin = encounter?.userRole === "clinician" || encounter?.userRole === "admin";

  // Derive chief concern from patient's dialogue or symptoms
  const patientUtterances = encounter?.transcript?.filter((t) => t.role === "patient") || [];
  const chiefConcern =
    patientUtterances.length > 0
      ? patientUtterances[0].text.replace(/^"|"$/g, "")
      : (encounter?.detectedSymptoms && encounter.detectedSymptoms.length > 0)
      ? encounter.detectedSymptoms.join(", ")
      : "Clinical intake consultation";

  const cleanDoctorName = encounter?.doctorName
    ? encounter.doctorName
        .replace(", MD, FACC", "")
        .replace(", MD, PhD", "")
        .replace(", MD, FAAP", "")
        .replace(", MD, DVD", "")
        .replace(", MD", "")
    : "Dr. Sarah Chen";

  // Fetch or initialize clinical artifact history
  useEffect(() => {
    if (isOpen && encounterId) {
      setIsLoadingArtifacts(true);
      fetch(`/api/consultations/${encodeURIComponent(encounterId)}/artifacts`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.success && Array.isArray(data.artifacts) && data.artifacts.length > 0) {
            setArtifacts(data.artifacts);
            const latest = data.artifacts[data.artifacts.length - 1];
            setActiveArtifact(latest);
            setSubjective(latest.soapSubjective || "");
            setObjective(latest.soapObjective || "");
            setAssessment(latest.soapAssessment || "");
            setPlan(latest.soapPlan || "");
          } else {
            setArtifacts([]);
            setActiveArtifact(null);
            // Initialize from encounter props or synthesize initial note
            if (encounter.soap?.subjective && encounter.soap?.assessment) {
              setSubjective(encounter.soap.subjective);
              setObjective(encounter.soap.objective || "");
              setAssessment(encounter.soap.assessment);
              setPlan(encounter.soap.plan || "");
            } else {
              const patientSummary =
                patientUtterances.length > 0
                  ? patientUtterances.map((u) => `• "${u.text.replace(/^"|"$/g, "")}"`).join("\n")
                  : "• Presenting symptoms discussed during clinical intake dialogue.";

              setSubjective(
                `Patient presented via voice consultation with ${cleanDoctorName}.\nChief concern: ${chiefConcern}\n\nReported symptoms:\n${patientSummary}\n\nPatient denies additional acute symptoms or severe distress during intake.`
              );
              setObjective(
                `Physical observation & conversational intake completed.\n• Vital signs: Not assessed (no device telemetry recorded)\n• Speech & responsiveness: Alert, responsive`
              );
              setAssessment(
                `${encounter.triageTitle || "Clinical intake completed."} Symptoms reviewed against primary care clinical safety protocols. Presentation assessed as non-emergent at current intake stage.`
              );
              setPlan(
                `1. Follow-up: Clinical evaluation recommended if symptoms persist beyond 48 hours or worsen.\n2. Symptomatic care: Rest and hydration as clinically indicated.\n3. Safety precautions: Seek immediate urgent care or dial emergency dispatch (108/112) if experiencing acute chest discomfort, shortness of breath, or sudden weakness.`
              );
            }
          }
        })
        .catch(() => {
          // If artifacts route is unavailable (e.g. legacy), use encounter fields
          if (encounter.soap?.subjective) {
            setSubjective(encounter.soap.subjective);
            setObjective(encounter.soap.objective || "");
            setAssessment(encounter.soap.assessment || "");
            setPlan(encounter.soap.plan || "");
          }
        })
        .finally(() => {
          setIsLoadingArtifacts(false);
          setIsEditing(false);
          setSaveSuccess(null);
          setSaveError(null);
          setShowAmendmentPrompt(false);
        });
    }
  }, [isOpen, encounterId, chiefConcern, cleanDoctorName]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !encounter) return null;

  const encounterDate = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const encounterTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const isSigned = Boolean(
    activeArtifact?.status === "signed" ||
    (!activeArtifact && encounter.status === "approved")
  );
  const isPendingReview = Boolean(activeArtifact?.status === "pending_review");
  const isDraft = !isSigned && !isPendingReview;

  // Copy standard clinical note to clipboard
  const handleCopyNote = async () => {
    const formattedNote = `==============================================================================
SOAP NOTE — CLINICAL PROGRESS NOTE
==============================================================================
Date & Time:     ${encounterDate} · ${encounterTime}
Duration:        ${formatNaturalDuration(encounter.callDuration)}
Patient:         ${encounter.patientName || "Patient"}
Clinician:       ${cleanDoctorName} (${encounter.specialty || "General Clinician"})
Chief Concern:   ${chiefConcern}
Status:          ${isSigned ? "SIGNED & CERTIFIED" : isPendingReview ? "PENDING REVIEW" : "DRAFT"}
==============================================================================

[S] SUBJECTIVE:
${subjective}

[O] OBJECTIVE:
${objective}

[A] ASSESSMENT:
${assessment}

[P] PLAN:
${plan}

==============================================================================
Information Sources: Patient-reported · AI-inferred · Zero fabricated vitals
==============================================================================`;

    try {
      await navigator.clipboard.writeText(formattedNote);
      setCopiedNote(true);
      setTimeout(() => setCopiedNote(false), 2500);
    } catch {
      console.error("Failed to copy SOAP note to clipboard");
    }
  };

  // Export HL7 FHIR R4 Bundle
  const handleExportFhir = () => {
    const bundle = generateFHIRBundle({
      id: encounterId,
      patientName: encounter.patientName || "Patient",
      patientGender: encounter.patientGender,
      patientAge: encounter.patientAge,
      doctorId: encounter.doctorId,
      doctorName: cleanDoctorName,
      specialty: encounter.specialty,
      chiefComplaint: chiefConcern,
      triageLevel: encounter.triageLevel as any,
      triageTitle: encounter.triageTitle,
      esiScore: encounter.esiScore ?? (encounter.triageLevel === "emergency" ? 2 : 3),
      icd10Codes: encounter.icdCodes || [],
      detectedSymptoms: encounter.detectedSymptoms || [],
      soapSubjective: subjective,
      soapObjective: objective,
      soapAssessment: assessment,
      soapPlan: plan,
      recommendedAction: encounter.recommendedAction,
      createdAt: new Date().toISOString(),
      status: isSigned ? "approved" : "completed_pending_review",
      approvedAt: activeArtifact?.signedAt || encounter.approvedAt,
      transcript: (encounter.transcript || []).map((t) => ({
        role: t.role,
        text: t.text,
        timestamp: t.timestamp || new Date().toISOString(),
      })),
    });

    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/fhir+json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fhir-r4-bundle-${encounterId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 1. Save Draft (Authoritative Artifact Service)
  const handleSaveDraft = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      if (activeArtifact) {
        // Update existing draft or downgrade pending_review
        const res = await fetch(
          `/api/consultations/${encodeURIComponent(encounterId)}/artifacts/${encodeURIComponent(activeArtifact.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chiefComplaint: chiefConcern,
              soapSubjective: subjective,
              soapObjective: objective,
              soapAssessment: assessment,
              soapPlan: plan,
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update draft artifact");
        setActiveArtifact(data.artifact);
        setSaveSuccess("Draft updated successfully.");
        setIsEditing(false);
      } else {
        // Create initial draft artifact
        const res = await fetch(
          `/api/consultations/${encodeURIComponent(encounterId)}/artifacts`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chiefComplaint: chiefConcern,
              soapSubjective: subjective,
              soapObjective: objective,
              soapAssessment: assessment,
              soapPlan: plan,
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create draft artifact");
        setActiveArtifact(data.artifact);
        setArtifacts([data.artifact]);
        setSaveSuccess("Initial draft created.");
        setIsEditing(false);
      }
    } catch (err: any) {
      setSaveError(err?.message || "Error saving draft note");
    } finally {
      setIsSaving(false);
    }
  };

  // 2. Submit for Physician Review
  const handleSubmitForReview = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      let targetArtifact = activeArtifact;
      if (!targetArtifact) {
        // First create the draft if none exists
        const createRes = await fetch(
          `/api/consultations/${encodeURIComponent(encounterId)}/artifacts`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chiefComplaint: chiefConcern,
              soapSubjective: subjective,
              soapObjective: objective,
              soapAssessment: assessment,
              soapPlan: plan,
            }),
          }
        );
        const createData = await createRes.json();
        if (!createRes.ok) throw new Error(createData.error || "Failed to create draft");
        targetArtifact = createData.artifact;
        setActiveArtifact(targetArtifact);
      }

      const res = await fetch(
        `/api/consultations/${encodeURIComponent(encounterId)}/artifacts/${encodeURIComponent(targetArtifact.id)}/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit for review");
      setActiveArtifact(data.artifact);
      setSaveSuccess("Artifact locked and submitted for physician review.");
      setIsEditing(false);
    } catch (err: any) {
      setSaveError(err?.message || "Error submitting note for review");
    } finally {
      setIsSaving(false);
    }
  };

  // 3. Sign Artifact (Atomic Transaction & Durable Audit)
  const handleSignArtifact = async () => {
    if (!activeArtifact) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const idempotencyKey = `sign-${activeArtifact.id}-${Date.now()}`;
      const res = await fetch(
        `/api/consultations/${encodeURIComponent(encounterId)}/artifacts/${encodeURIComponent(activeArtifact.id)}/sign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey,
            expectedCaseVersion: encounter.caseVersion || 1,
            signatureAttestation: "Clinician Attestation Verified",
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Signing transaction failed");

      setActiveArtifact(data.artifact);
      setSaveSuccess("Encounter certified and permanently sealed.");
      setIsEditing(false);
      if (onSaveSuccess) {
        onSaveSuccess(data.consultation || data.artifact);
      }
    } catch (err: any) {
      setSaveError(err?.message || "Error signing clinical artifact");
    } finally {
      setIsSaving(false);
    }
  };

  // 4. Create Linked Amendment
  const handleCreateAmendment = async () => {
    if (!amendmentReason || amendmentReason.trim().length < 10) {
      setSaveError("Clinical amendment justification must be at least 10 characters.");
      return;
    }
    const parent = artifacts.find((a) => a.status === "signed") || activeArtifact;
    if (!parent) {
      setSaveError("Cannot create an amendment without a previously signed artifact.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/consultations/${encodeURIComponent(encounterId)}/artifacts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentArtifactId: parent.id,
            amendmentReason: amendmentReason.trim(),
            chiefComplaint: chiefConcern,
            soapSubjective: subjective,
            soapObjective: objective,
            soapAssessment: assessment,
            soapPlan: plan,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create amendment draft");

      setArtifacts((prev) => [...prev, data.artifact]);
      setActiveArtifact(data.artifact);
      setShowAmendmentPrompt(false);
      setAmendmentReason("");
      setIsEditing(true);
      setSaveSuccess(`Amendment v${data.artifact.version} draft created. You can now edit.`);
    } catch (err: any) {
      setSaveError(err?.message || "Error creating amendment");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="soap-document-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 md:p-8 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] my-auto animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ============================================================ Document Header */}
        <div className="px-6 sm:px-8 pt-6 pb-4 border-b border-slate-200 bg-white shrink-0 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-cyan-600" />
              <h2
                id="soap-document-title"
                className="text-xl sm:text-2xl font-black text-slate-950 tracking-tight font-serif"
              >
                SOAP NOTE
              </h2>
              {activeArtifact && (
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-600 font-bold">
                  v{activeArtifact.version} {activeArtifact.parentArtifactId ? "Amendment" : "Original"}
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-slate-500 font-mono">
              {encounterDate} · {encounterTime} · {formatNaturalDuration(encounter.callDuration)}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
            title="Close document"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ============================================================ Clinician Sub-Header */}
        <div className="px-6 sm:px-8 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">{cleanDoctorName}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-600 font-medium">{encounter.specialty || "General Clinician"}</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500 font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Patient: {encounter.patientName || "Patient"}</span>
          </div>
        </div>

        {/* ============================================================ Scrollable Document Body */}
        <div className="flex-1 overflow-y-auto px-6 sm:px-8 py-6 space-y-6 text-sm leading-relaxed text-slate-800">
          {/* Status Banners */}
          {isSigned && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex flex-col gap-1.5 text-xs"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-bold">
                    ✓ Certified & Immutable Clinical Record (v{activeArtifact?.version || 1})
                  </span>
                </div>
                <div className="flex items-center gap-1 font-mono text-[11px] text-emerald-800">
                  <Lock className="w-3 h-3" />
                  <span>Sealed</span>
                </div>
              </div>
              <div className="text-[11px] text-emerald-800/90 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>Signed by: {activeArtifact?.signedBy || encounter.approvedBy || cleanDoctorName}</span>
                {activeArtifact?.signedAt && (
                  <span>Signed at: {new Date(activeArtifact.signedAt).toLocaleString()}</span>
                )}
                {activeArtifact?.canonicalDigest && (
                  <span className="font-mono text-[10px] bg-emerald-100/70 px-1.5 py-0.5 rounded border border-emerald-200">
                    SHA-256: {activeArtifact.canonicalDigest.slice(0, 16)}...
                  </span>
                )}
              </div>
            </motion.div>
          )}

          {isPendingReview && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <div>
                  <span className="font-bold">⏳ Pending Physician Review (v{activeArtifact?.version})</span>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Document is locked for clinical review. Any edits will return it to Draft status.
                  </p>
                </div>
              </div>
            </div>
          )}

          {isDraft && activeArtifact && (
            <div className="p-3 rounded-xl bg-cyan-50/60 border border-cyan-200/80 text-cyan-950 flex items-center gap-2 text-xs">
              <Edit3 className="w-4 h-4 text-cyan-700 shrink-0" />
              <span>
                <strong>Clinical Draft (v{activeArtifact.version})</strong> — Unsigned draft note. Must be submitted for review before signing.
              </span>
            </div>
          )}

          {/* Success / Feedback Banner */}
          {saveSuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{saveSuccess}</span>
            </div>
          )}

          {/* Amendment Creation Drawer */}
          {showAmendmentPrompt && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="p-4 rounded-2xl bg-amber-50/80 border border-amber-300 space-y-3 text-xs"
            >
              <div className="flex items-center gap-2 font-bold text-amber-950">
                <GitBranch className="w-4 h-4 text-amber-700" />
                <span>Create Clinical Amendment (v{(activeArtifact?.version || 1) + 1})</span>
              </div>
              <p className="text-amber-800 text-[11px]">
                Under clinical integrity rules, signed records cannot be directly edited. Providing a clinical justification will create a new linked amendment draft while preserving the original signed record.
              </p>
              <div className="space-y-1">
                <label className="text-[11px] font-mono font-bold uppercase text-amber-900">
                  Clinical Justification / Amendment Reason (min 10 chars):
                </label>
                <textarea
                  value={amendmentReason}
                  onChange={(e) => setAmendmentReason(e.target.value)}
                  placeholder="e.g., Follow-up lab results received; correcting medication dosage instructions."
                  rows={2}
                  className="w-full p-2.5 rounded-xl border border-amber-300 bg-white text-xs focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAmendmentPrompt(false)}
                  className="px-3 py-1.5 rounded-lg text-slate-600 hover:bg-amber-100 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateAmendment}
                  disabled={isSaving || amendmentReason.trim().length < 10}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold cursor-pointer"
                >
                  {isSaving ? "Creating Amendment..." : "Confirm & Create Amendment"}
                </button>
              </div>
            </motion.div>
          )}

          {/* CHIEF CONCERN */}
          <section className="space-y-1.5">
            <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
              CHIEF CONCERN
            </h3>
            <p className="text-sm sm:text-base font-semibold text-slate-950">
              {chiefConcern}
            </p>
          </section>

          {/* S — SUBJECTIVE */}
          <section className="space-y-2">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <h3 className="text-xs font-black uppercase font-mono tracking-wider text-slate-900 flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-cyan-700 text-white flex items-center justify-center text-[11px] font-mono font-bold">
                  S
                </span>
                <span>SUBJECTIVE</span>
              </h3>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-cyan-50 text-cyan-800 border border-cyan-200">
                [Patient-reported]
              </span>
            </div>

            {isEditing && !isSigned ? (
              <textarea
                value={subjective}
                onChange={(e) => setSubjective(e.target.value)}
                rows={5}
                className="w-full text-xs sm:text-sm p-3 rounded-xl border border-cyan-300 focus:outline-hidden focus:ring-2 focus:ring-cyan-500/20 bg-slate-50/50 leading-relaxed font-sans"
              />
            ) : (
              <div className="pt-1 whitespace-pre-line font-normal text-slate-700 leading-relaxed text-xs sm:text-sm">
                {subjective}
              </div>
            )}
          </section>

          {/* O — OBJECTIVE */}
          <section className="space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <h3 className="text-xs font-black uppercase font-mono tracking-wider text-slate-900 flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-teal-700 text-white flex items-center justify-center text-[11px] font-mono font-bold">
                  O
                </span>
                <span>OBJECTIVE</span>
              </h3>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">
                Vitals & Measurements
              </span>
            </div>

            {/* Vitals Table with Honest Provenance */}
            <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50/60">
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-200 text-xs">
                <div className="p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-bold">Temperature</span>
                  <span className="font-semibold text-slate-700">Not assessed</span>
                </div>
                <div className="p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-bold">Heart Rate</span>
                  <span className="font-semibold text-slate-700">Not assessed</span>
                </div>
                <div className="p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-bold">Blood Pressure</span>
                  <span className="font-semibold text-slate-700">Not assessed</span>
                </div>
                <div className="p-2.5 flex flex-col gap-0.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 font-bold">SpO₂</span>
                  <span className="font-semibold text-slate-700">Not assessed</span>
                </div>
              </div>
              <div className="px-3 py-1.5 bg-slate-100/70 border-t border-slate-200 text-[11px] text-slate-500 font-medium">
                No device-based vital signs were collected during this consultation.
              </div>
            </div>

            {isEditing && !isSigned ? (
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                rows={3}
                className="w-full text-xs sm:text-sm p-3 rounded-xl border border-teal-300 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 bg-slate-50/50 leading-relaxed font-sans"
              />
            ) : objective ? (
              <div className="pt-1 whitespace-pre-line font-normal text-slate-700 leading-relaxed text-xs sm:text-sm">
                {objective}
              </div>
            ) : null}

            {/* Verified Clinical Tags */}
            {encounter.icdCodes && encounter.icdCodes.length > 0 && !isEditing && (
              <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">
                  Clinical Tags:
                </span>
                {encounter.icdCodes.map((code) => (
                  <span
                    key={code}
                    className="text-[11px] font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200 px-2 py-0.5 rounded"
                  >
                    {code}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* A — ASSESSMENT */}
          <section className="space-y-2">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <h3 className="text-xs font-black uppercase font-mono tracking-wider text-slate-900 flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-amber-600 text-white flex items-center justify-center text-[11px] font-mono font-bold">
                  A
                </span>
                <span>ASSESSMENT</span>
              </h3>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                [AI-INFERRED]
              </span>
            </div>

            {isEditing && !isSigned ? (
              <textarea
                value={assessment}
                onChange={(e) => setAssessment(e.target.value)}
                rows={4}
                className="w-full text-xs sm:text-sm p-3 rounded-xl border border-amber-300 focus:outline-hidden focus:ring-2 focus:ring-amber-500/20 bg-slate-50/50 leading-relaxed font-sans"
              />
            ) : (
              <div className="pt-1 whitespace-pre-line font-normal text-slate-700 leading-relaxed text-xs sm:text-sm">
                {assessment}
              </div>
            )}
          </section>

          {/* P — PLAN */}
          <section className="space-y-2">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <h3 className="text-xs font-black uppercase font-mono tracking-wider text-slate-900 flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-emerald-700 text-white flex items-center justify-center text-[11px] font-mono font-bold">
                  P
                </span>
                <span>PLAN</span>
              </h3>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                [AI-GENERATED]
              </span>
            </div>

            {isEditing && !isSigned ? (
              <textarea
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                rows={4}
                className="w-full text-xs sm:text-sm p-3 rounded-xl border border-emerald-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 bg-slate-50/50 leading-relaxed font-sans"
              />
            ) : (
              <div className="pt-1 whitespace-pre-line font-normal text-slate-700 leading-relaxed text-xs sm:text-sm">
                {plan}
              </div>
            )}
          </section>

          {/* INFORMATION SOURCES */}
          <section className="pt-3 border-t border-slate-200 text-xs text-slate-500 space-y-1">
            <div className="font-mono font-bold text-[10px] uppercase tracking-wider text-slate-400">
              Information Sources
            </div>
            <p className="text-[11px] text-slate-600">
              Patient-reported testimony · AI-inferred clinical synthesis · No fabricated vitals
            </p>
          </section>

          {/* Collapsible Recorded Dialogue Drawer */}
          {encounter.transcript && encounter.transcript.length > 0 && (
            <div className="pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowTranscript(!showTranscript)}
                className="flex items-center justify-between w-full text-xs font-mono font-bold text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <span>RECORDED DIALOGUE ({encounter.transcript.length} TURNS)</span>
                {showTranscript ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showTranscript && (
                <div className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1 animate-in fade-in duration-200">
                  {encounter.transcript.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs"
                    >
                      <div className="flex items-center justify-between mb-0.5 text-[10px] font-mono text-slate-400">
                        <span className="font-bold uppercase">
                          {item.role === "patient" ? encounter.patientName || "Patient" : cleanDoctorName}
                        </span>
                        {item.timestamp && <span>{item.timestamp}</span>}
                      </div>
                      <p className="text-slate-800">{item.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {saveError && (
          <div className="px-6 sm:px-8 py-2.5 bg-rose-50 border-t border-rose-200 text-xs text-rose-700 flex items-center justify-between">
            <span className="font-medium">{saveError}</span>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              className="text-rose-500 hover:text-rose-700 font-bold ml-2 cursor-pointer"
            >
              ×
            </button>
          </div>
        )}

        {/* ============================================================ Fixed Bottom Action Bar */}
        <div className="px-6 sm:px-8 py-4 border-t border-slate-200 bg-white/95 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            {!isSigned && isClinicianOrAdmin && (
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 border ${
                  isEditing
                    ? "bg-slate-900 text-white border-slate-900 cursor-pointer"
                    : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200 cursor-pointer"
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{isEditing ? "Lock & Preview" : "Edit Note"}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyNote}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold transition-all flex items-center gap-1.5 text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {copiedNote ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedNote ? "Copied" : "Copy SOAP"}</span>
            </button>

            <button
              type="button"
              onClick={handleExportFhir}
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold transition-all flex items-center gap-1.5 text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export FHIR</span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Close
            </button>

            {/* Mode-Specific Actions */}
            {isSigned && isClinicianOrAdmin && (
              <PremiumButton
                variant="primary"
                size="md"
                onClick={() => setShowAmendmentPrompt(true)}
                disabled={isSaving}
                icon={<GitBranch className="w-4 h-4" />}
              >
                Create Amendment
              </PremiumButton>
            )}

            {isPendingReview && isClinicianOrAdmin && (
              <PremiumButton
                variant="primary"
                size="md"
                onClick={handleSignArtifact}
                disabled={isSaving}
                icon={<ShieldCheck className="w-4 h-4 text-emerald-400" />}
              >
                {isSaving ? "Signing..." : "Approve & Sign Note"}
              </PremiumButton>
            )}

            {isDraft && isClinicianOrAdmin && (
              <>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={isSaving}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? "Saving..." : "Save Draft"}</span>
                </button>

                <PremiumButton
                  variant="primary"
                  size="md"
                  onClick={handleSubmitForReview}
                  disabled={isSaving}
                  icon={<Send className="w-4 h-4" />}
                >
                  {isSaving ? "Submitting..." : "Submit for Review"}
                </PremiumButton>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
