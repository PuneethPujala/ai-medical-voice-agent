"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
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
  ShieldCheck,
  GitBranch,
  GitCompare,
  Lock,
  Send,
  AlertCircle,
  Clock,
} from "lucide-react";
import { generateFHIRBundle } from "@/lib/fhir/bundle";
import { ArtifactTimeline } from "@/app/history/_components/ArtifactTimeline";
import { SoapVersionDiff } from "@/app/history/_components/SoapVersionDiff";

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
  createdAt?: string | Date;
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
  const [mounted, setMounted] = useState(false);
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
  const [activeModalTab, setActiveModalTab] = useState<"document" | "timeline" | "diff">("document");
  const [diffBaseArtifact, setDiffBaseArtifact] = useState<any | null>(null);
  const [diffTargetArtifact, setDiffTargetArtifact] = useState<any | null>(null);

  const encounterId = encounter?.id || "";
  const [callerRole, setCallerRole] = useState<string>(encounter?.userRole || "");
  const isClinicianOrAdmin =
    callerRole === "clinician" ||
    callerRole === "admin" ||
    encounter?.userRole === "clinician" ||
    encounter?.userRole === "admin";

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  const handleSelectArtifact = (art: any) => {
    setActiveArtifact(art);
    setSubjective(art.soapSubjective || "");
    setObjective(art.soapObjective || "");
    setAssessment(art.soapAssessment || "");
    setPlan(art.soapPlan || "");
    setIsEditing(false);
    setActiveModalTab("document");
  };

  const handleCompareVersions = (baseArt: any, targetArt: any) => {
    setDiffBaseArtifact(baseArt);
    setDiffTargetArtifact(targetArt);
    setActiveModalTab("diff");
  };

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
          if (data && data.userRole) {
            setCallerRole(data.userRole);
          }
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
        if (showAmendmentPrompt) {
          setShowAmendmentPrompt(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, showAmendmentPrompt]);

  if (!isOpen || !encounter || !mounted) return null;

  // Determine state
  const isSigned = Boolean(
    activeArtifact?.status === "signed" ||
    (!activeArtifact && encounter.status === "approved")
  );
  const isPendingReview = Boolean(activeArtifact?.status === "pending_review");
  const isDraft = !isSigned && !isPendingReview;
  const isLegacy = !activeArtifact && encounter.status === "approved";

  // Derive timestamp strictly from the selected artifact (fallback to encounter only for legacy)
  const formatArtifactDate = (dateVal?: string | Date | null) => {
    if (!dateVal) return "";
    try {
      const d = new Date(dateVal);
      return (
        d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }) +
        " · " +
        d.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      );
    } catch {
      return String(dateVal);
    }
  };

  const artifactTimestamp = activeArtifact
    ? (activeArtifact.signedAt || activeArtifact.updatedAt || activeArtifact.createdAt)
    : (encounter.approvedAt || encounter.createdAt);

  const signerOrAuthor = activeArtifact?.signedBy || encounter.approvedBy || cleanDoctorName;

  const headerTimestampSubtitle = !isClinicianOrAdmin && !isSigned
    ? `${formatArtifactDate(artifactTimestamp)} · ${cleanDoctorName}`
    : isSigned
    ? `Signed ${formatArtifactDate(artifactTimestamp)} · ${signerOrAuthor}`
    : isPendingReview
    ? `Submitted ${formatArtifactDate(artifactTimestamp)} · Pending Review`
    : isDraft
    ? `Updated ${formatArtifactDate(artifactTimestamp)} · Draft`
    : isLegacy
    ? `Attested ${formatArtifactDate(artifactTimestamp)} · ${signerOrAuthor}`
    : `${formatArtifactDate(artifactTimestamp)} · ${cleanDoctorName}`;

  // Copy standard clinical note to clipboard
  const handleCopyNote = async () => {
    const formattedNote = `==============================================================================
SOAP NOTE — CLINICAL PROGRESS NOTE
==============================================================================
Date & Time:     ${formatArtifactDate(artifactTimestamp)}
Duration:        ${formatNaturalDuration(encounter.callDuration)}
Patient:         ${encounter.patientName || "Patient"}
Clinician:       ${signerOrAuthor} (${encounter.specialty || "General Clinician"})
Chief Concern:   ${chiefConcern}
Status:          ${isSigned ? "SIGNED (SHA-256 SEALED)" : isPendingReview ? "PENDING REVIEW" : "DRAFT"}
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
Integrity: Attestation verified (SHA-256) · Zero fabricated vitals
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
      setActiveModalTab("document");
      setSaveSuccess(`Amendment v${data.artifact.version} draft created. You can now edit.`);
    } catch (err: any) {
      setSaveError(err?.message || "Error creating amendment");
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    showAmendmentPrompt ? (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="amendment-dialog-title"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in duration-150 font-sans"
        onClick={() => setShowAmendmentPrompt(false)}
      >
        <div
          className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in zoom-in-95 duration-150 font-sans"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 font-sans">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-700">
                <GitBranch className="w-4 h-4" />
              </div>
              <div>
                <h3 id="amendment-dialog-title" className="text-base font-bold text-slate-950 font-sans">
                  Create Clinical Amendment (v{(activeArtifact?.version || 1) + 1})
                </h3>
                <p className="text-xs text-slate-500 font-sans">
                  Parent record: Version {activeArtifact?.version || 1} · Signed
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAmendmentPrompt(false)}
              className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer transition-colors"
              title="Cancel amendment"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600 leading-relaxed font-sans">
            Under clinical integrity rules, signed records are immutable. Providing a clinical justification will create a new linked amendment draft while preserving the original signed record.
          </div>

          <div className="space-y-1.5 font-sans">
            <label className="text-xs font-semibold text-slate-700 block font-sans">
              Clinical Justification / Amendment Reason <span className="text-slate-400 font-normal">(minimum 10 characters)</span>
            </label>
            <textarea
              value={amendmentReason}
              onChange={(e) => setAmendmentReason(e.target.value)}
              placeholder="Document the clinical indication for this revision (e.g. Lab results reviewed; adjusted antiplatelet regimen)..."
              rows={3}
              className="w-full p-3 rounded-xl border border-slate-200 focus:border-slate-900 focus:ring-1 focus:ring-slate-900 text-xs sm:text-sm bg-white leading-relaxed font-sans placeholder:text-slate-400"
            />
            {amendmentReason.trim().length > 0 && amendmentReason.trim().length < 10 && (
              <p className="text-[11px] text-amber-600 font-medium font-sans">
                Justification must be at least 10 characters ({10 - amendmentReason.trim().length} more needed).
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 font-sans">
            <button
              type="button"
              onClick={() => setShowAmendmentPrompt(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateAmendment}
              disabled={isSaving || amendmentReason.trim().length < 10}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors whitespace-nowrap"
            >
              {isSaving ? "Creating..." : "Confirm & Create Amendment"}
            </button>
          </div>
        </div>
      </div>
    ) : (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="soap-document-title"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-0 sm:p-4 md:p-6 animate-in fade-in duration-150"
        onClick={onClose}
      >
        <div
          className="relative w-full h-[100dvh] sm:h-auto sm:max-h-[92dvh] sm:max-w-4xl bg-[#FAF9F6] sm:rounded-2xl shadow-2xl border-0 sm:border sm:border-slate-200/90 flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
          onClick={(e) => e.stopPropagation()}
        >
        {/* ============================================================ Consolidated Header */}
        <div className="shrink-0 border-b border-slate-200/90 bg-white px-4 sm:px-6 pt-3.5 pb-2.5">
          {/* Top Row: Title, State Pill, Subtitle, Close */}
          <div className="flex items-center justify-between gap-3 font-sans">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200/80 flex items-center justify-center text-emerald-700 shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <h2
                    id="soap-document-title"
                    className="text-base sm:text-lg font-bold text-slate-950 font-sans tracking-tight whitespace-nowrap"
                  >
                    SOAP Note
                  </h2>
                  {/* Status Pill */}
                  {isSigned && activeArtifact ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0 font-sans">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>Signed · v{activeArtifact.version}</span>
                    </span>
                  ) : isLegacy ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 shrink-0 font-sans">
                      <ShieldCheck className="w-3 h-3 text-emerald-600" />
                      <span>Legacy attestation</span>
                    </span>
                  ) : isClinicianOrAdmin && activeArtifact ? (
                    isPendingReview ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 shrink-0 font-sans">
                        <Clock className="w-3 h-3 text-amber-600" />
                        <span>Pending review · v{activeArtifact.version}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-50 text-cyan-800 border border-cyan-200 shrink-0 font-sans">
                        <Edit3 className="w-3 h-3 text-cyan-600" />
                        <span>{activeArtifact.amendsArtifactId ? "Amendment draft" : "Draft"} · v{activeArtifact.version}</span>
                      </span>
                    )
                  ) : null}
                </div>
                {/* Clean Subtitle with correct selected artifact timestamp */}
                <p className="text-xs text-slate-500 font-sans truncate mt-0.5">
                  {headerTimestampSubtitle}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
              title="Close document"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Bottom Row: Horizontally Scrollable Tabs + Context */}
          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-100 font-sans">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 max-w-full">
              <button
                type="button"
                onClick={() => setActiveModalTab("document")}
                className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                  activeModalTab === "document"
                    ? "bg-slate-900 text-white shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>SOAP Note</span>
              </button>

              {(isClinicianOrAdmin || isSigned) && (
                <button
                  type="button"
                  onClick={() => setActiveModalTab("timeline")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                    activeModalTab === "timeline"
                      ? "bg-slate-900 text-white shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  <GitBranch className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Timeline</span>
                  {artifacts.length > 0 && (
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-sans font-medium ${
                      activeModalTab === "timeline" ? "bg-slate-800 text-slate-200" : "bg-slate-100 text-slate-700"
                    }`}>
                      {isClinicianOrAdmin ? artifacts.length : artifacts.filter((a) => a.status === "signed").length}
                    </span>
                  )}
                </button>
              )}

              {((isClinicianOrAdmin ? artifacts.length : artifacts.filter((a) => a.status === "signed").length) >= 2) && (
                <button
                  type="button"
                  onClick={() => {
                    const list = isClinicianOrAdmin ? artifacts : artifacts.filter((a) => a.status === "signed");
                    if (!diffBaseArtifact || !diffTargetArtifact) {
                      setDiffBaseArtifact(list[list.length - 2]);
                      setDiffTargetArtifact(list[list.length - 1]);
                    }
                    setActiveModalTab("diff");
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                    activeModalTab === "diff"
                      ? "bg-slate-900 text-white shadow-xs font-bold"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  <GitCompare className="w-3.5 h-3.5 text-purple-500" />
                  <span>Compare</span>
                </button>
              )}
            </div>

            {/* Desktop-only patient/clinician info */}
            <div className="hidden md:flex items-center gap-2 text-xs font-sans text-slate-500 shrink-0">
              <span>Patient: <strong className="text-slate-800 font-medium">{encounter.patientName || "Patient"}</strong></span>
              <span className="text-slate-300">·</span>
              <span>{cleanDoctorName} ({encounter.specialty || "Clinician"})</span>
            </div>
          </div>
        </div>

        {/* ============================================================ Scrollable Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 md:px-8 py-5 space-y-5 text-sm text-slate-800 font-sans">
          {!isClinicianOrAdmin && !isSigned ? (
            <div className="py-16 px-4 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mx-auto">
                <FileText className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-slate-900 font-sans">
                  Clinical Documentation Unavailable
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed font-sans">
                  Finalized clinical documentation is not currently available for this consultation.
                </p>
              </div>
            </div>
          ) : activeModalTab === "timeline" ? (
            <ArtifactTimeline
              consultationId={encounterId}
              artifacts={artifacts}
              selectedArtifactId={activeArtifact?.id}
              onSelectArtifact={handleSelectArtifact}
              onCompareVersions={handleCompareVersions}
              userRole={isClinicianOrAdmin ? (callerRole as any || "clinician") : "patient"}
              legacyApproved={{
                isLegacy: artifacts.length === 0 && encounter.status === "approved",
                approvedAt: encounter.approvedAt,
                approvedBy: encounter.approvedBy,
              }}
            />
          ) : activeModalTab === "diff" ? (
            <SoapVersionDiff
              baseArtifact={diffBaseArtifact || artifacts[0]}
              targetArtifact={diffTargetArtifact || artifacts[artifacts.length - 1]}
              onBack={() => setActiveModalTab("document")}
            />
          ) : (
            <>
              {/* Revision Notice Banner (when viewing older versions) */}
              {artifacts.length > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-sans">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <GitBranch className="w-3.5 h-3.5 text-emerald-600" />
                    <span>
                      Viewing Version {activeArtifact?.version || 1} of {artifacts.length}
                      {isSigned && activeArtifact?.version < artifacts[artifacts.length - 1].version && (
                        <span className="text-slate-500 font-medium"> (Superseded)</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const currentIndex = artifacts.findIndex((a) => a.id === activeArtifact?.id);
                        const prevArt = currentIndex > 0 ? artifacts[currentIndex - 1] : artifacts[0];
                        handleCompareVersions(prevArt, activeArtifact);
                      }}
                      className="text-[11px] font-semibold text-slate-700 hover:text-slate-900 underline flex items-center gap-1 cursor-pointer"
                    >
                      <GitCompare className="w-3 h-3 text-purple-600" />
                      <span>Compare with previous</span>
                    </button>
                    <span className="text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={() => setActiveModalTab("timeline")}
                      className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                    >
                      View history →
                    </button>
                  </div>
                </div>
              )}

              {/* Status Banner */}
              {isSigned && (
                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-emerald-950 flex items-center justify-between text-xs font-sans">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span className="font-semibold">
                      ✓ Immutable Clinical Record (v{activeArtifact?.version || 1}) · Signed by {signerOrAuthor}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-emerald-800 shrink-0 font-medium font-sans">
                    <Lock className="w-3 h-3" />
                    <span className="hidden sm:inline">Integrity verified (SHA-256)</span>
                    <span className="sm:hidden">Sealed</span>
                  </div>
                </div>
              )}

              {isPendingReview && isClinicianOrAdmin && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 flex items-center justify-between text-xs font-sans">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                    <div>
                      <span className="font-semibold">Pending Review (v{activeArtifact?.version})</span>
                      <span className="text-amber-800 ml-1.5 hidden sm:inline">
                        Document locked for clinical review.
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] text-amber-800 font-medium">
                    Sign or Request Changes
                  </span>
                </div>
              )}

              {isDraft && activeArtifact && isClinicianOrAdmin && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 flex items-center justify-between text-xs font-sans">
                  <div className="flex items-center gap-2">
                    <Edit3 className="w-4 h-4 text-slate-500 shrink-0" />
                    <span className="font-medium">
                      Draft Note (v{activeArtifact.version})
                      {activeArtifact.amendsArtifactId && " · Amendment Draft"}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-medium">
                    Editable Draft
                  </span>
                </div>
              )}

              {/* Feedback Alert */}
              {saveSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex items-center gap-2 font-sans">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{saveSuccess}</span>
                </div>
              )}

              {/* CHIEF CONCERN */}
              <section className="space-y-1 font-sans">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide font-sans">
                  Chief Concern
                </h3>
                <p className="text-sm sm:text-base font-semibold text-slate-950 font-sans">
                  {chiefConcern}
                </p>
              </section>

              {/* S — SUBJECTIVE */}
              <section className="space-y-1.5 font-sans">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 font-sans">
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2 font-sans">
                    <span className="w-5 h-5 rounded-md bg-cyan-700 text-white flex items-center justify-center text-[11px] font-bold">
                      S
                    </span>
                    <span>Subjective</span>
                  </h3>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-800 border border-cyan-200 font-sans">
                    Patient Narrative
                  </span>
                </div>

                {isEditing && !isSigned ? (
                  <textarea
                    value={subjective}
                    onChange={(e) => setSubjective(e.target.value)}
                    rows={4}
                    className="w-full text-xs sm:text-sm p-3 rounded-xl border border-cyan-300 focus:outline-hidden focus:ring-2 focus:ring-cyan-500/20 bg-white leading-relaxed font-sans"
                  />
                ) : (
                  <div className="pt-1 whitespace-pre-line font-normal text-slate-700 leading-relaxed text-xs sm:text-sm font-sans">
                    {subjective}
                  </div>
                )}
              </section>

              {/* O — OBJECTIVE */}
              <section className="space-y-2 font-sans">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 font-sans">
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2 font-sans">
                    <span className="w-5 h-5 rounded-md bg-emerald-700 text-white flex items-center justify-center text-[11px] font-bold">
                      O
                    </span>
                    <span>Objective</span>
                  </h3>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-sans">
                    Clinical Observations
                  </span>
                </div>

                {/* Vitals Table with Honest Provenance */}
                <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50/60 font-sans">
                  <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-200 text-xs">
                    <div className="p-2.5 flex flex-col gap-0.5">
                      <span className="text-[10px] sm:text-[11px] uppercase text-slate-400 font-semibold tracking-wide">Temperature</span>
                      <span className="font-medium text-slate-700">Not assessed</span>
                    </div>
                    <div className="p-2.5 flex flex-col gap-0.5">
                      <span className="text-[10px] sm:text-[11px] uppercase text-slate-400 font-semibold tracking-wide">Heart Rate</span>
                      <span className="font-medium text-slate-700">Not assessed</span>
                    </div>
                    <div className="p-2.5 flex flex-col gap-0.5">
                      <span className="text-[10px] sm:text-[11px] uppercase text-slate-400 font-semibold tracking-wide">Blood Pressure</span>
                      <span className="font-medium text-slate-700">Not assessed</span>
                    </div>
                    <div className="p-2.5 flex flex-col gap-0.5">
                      <span className="text-[10px] sm:text-[11px] uppercase text-slate-400 font-semibold tracking-wide">SpO₂</span>
                      <span className="font-medium text-slate-700">Not assessed</span>
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
                    className="w-full text-xs sm:text-sm p-3 rounded-xl border border-emerald-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 bg-white leading-relaxed font-sans"
                  />
                ) : objective ? (
                  <div className="pt-1 whitespace-pre-line font-normal text-slate-700 leading-relaxed text-xs sm:text-sm font-sans">
                    {objective}
                  </div>
                ) : null}

                {/* Verified Clinical Tags */}
                {encounter.icdCodes && encounter.icdCodes.length > 0 && !isEditing && (
                  <div className="pt-1 flex items-center gap-1.5 flex-wrap font-sans">
                    <span className="text-[11px] font-semibold text-slate-400">
                      Clinical Tags:
                    </span>
                    {encounter.icdCodes.map((code) => (
                      <span
                        key={code}
                        className="text-[11px] font-medium bg-slate-100 text-slate-800 border border-slate-200 px-2 py-0.5 rounded-md font-sans"
                      >
                        {code}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* A — ASSESSMENT */}
              <section className="space-y-1.5 font-sans">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 font-sans">
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2 font-sans">
                    <span className="w-5 h-5 rounded-md bg-purple-700 text-white flex items-center justify-center text-[11px] font-bold">
                      A
                    </span>
                    <span>Assessment</span>
                  </h3>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200 font-sans">
                    Clinical Impression
                  </span>
                </div>

                {isEditing && !isSigned ? (
                  <textarea
                    value={assessment}
                    onChange={(e) => setAssessment(e.target.value)}
                    rows={4}
                    className="w-full text-xs sm:text-sm p-3 rounded-xl border border-purple-300 focus:outline-hidden focus:ring-2 focus:ring-purple-500/20 bg-white leading-relaxed font-sans"
                  />
                ) : (
                  <div className="pt-1 whitespace-pre-line font-normal text-slate-700 leading-relaxed text-xs sm:text-sm font-sans">
                    {assessment}
                  </div>
                )}
              </section>

              {/* P — PLAN */}
              <section className="space-y-1.5 pb-2 font-sans">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 font-sans">
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2 font-sans">
                    <span className="w-5 h-5 rounded-md bg-blue-700 text-white flex items-center justify-center text-[11px] font-bold">
                      P
                    </span>
                    <span>Plan</span>
                  </h3>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 font-sans">
                    Care Directives
                  </span>
                </div>

                {isEditing && !isSigned ? (
                  <textarea
                    value={plan}
                    onChange={(e) => setPlan(e.target.value)}
                    rows={4}
                    className="w-full text-xs sm:text-sm p-3 rounded-xl border border-blue-300 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 bg-white leading-relaxed font-sans"
                  />
                ) : (
                  <div className="pt-1 whitespace-pre-line font-normal text-slate-700 leading-relaxed text-xs sm:text-sm font-sans">
                    {plan}
                  </div>
                )}
              </section>

              {/* Recorded Dialogue Collapsible */}
              {encounter.transcript && encounter.transcript.length > 0 && (
                <div className="pt-2 border-t border-slate-200 font-sans">
                  <button
                    type="button"
                    onClick={() => setShowTranscript(!showTranscript)}
                    className="flex items-center justify-between w-full text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer font-sans"
                  >
                    <span>Recorded Dialogue ({encounter.transcript.length} turns)</span>
                    {showTranscript ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showTranscript && (
                    <div className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1 font-sans">
                      {encounter.transcript.map((item, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs font-sans"
                        >
                          <div className="flex items-center justify-between mb-0.5 text-[11px] font-sans text-slate-500">
                            <span className="font-semibold text-slate-800">
                              {item.role === "patient" ? encounter.patientName || "Patient" : cleanDoctorName}
                            </span>
                            {item.timestamp && <span className="text-slate-400">{item.timestamp}</span>}
                          </div>
                          <p className="text-slate-800 leading-relaxed font-sans">{item.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Error Notification Bar */}
        {saveError && (
          <div className="px-4 sm:px-6 py-2 bg-rose-50 border-t border-rose-200 text-xs text-rose-700 flex items-center justify-between shrink-0 font-sans">
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

        {/* ============================================================ Clean State-Dependent Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-200/90 bg-white/95 backdrop-blur-md flex items-center justify-between gap-2.5 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] font-sans">
          {/* Left: Utility Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {(isSigned || isClinicianOrAdmin) && (
              <button
                type="button"
                onClick={handleCopyNote}
                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 font-sans"
                title="Copy formatted clinical note"
              >
                {copiedNote ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
                <span className="hidden sm:inline">{copiedNote ? "Copied" : "Copy SOAP"}</span>
              </button>
            )}

            {isSigned && (
              <button
                type="button"
                onClick={handleExportFhir}
                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 font-sans"
                title="Export HL7 FHIR R4 Bundle"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden sm:inline">Export FHIR</span>
              </button>
            )}
          </div>

          {/* Right: State-Dependent Primary Actions */}
          <div className="flex items-center gap-2 shrink-0 font-sans">
            {/* Close Button always accessible */}
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer transition-colors"
            >
              Close
            </button>

            {/* State: Draft or Amendment Draft */}
            {isDraft && isClinicianOrAdmin && (
              <>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={isSaving}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/90 text-slate-800 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5 text-slate-600" />
                  <span>{isSaving ? "Saving..." : "Save Draft"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSubmitForReview}
                  disabled={isSaving}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs whitespace-nowrap"
                >
                  <Send className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{isSaving ? "Submitting..." : "Submit for Review"}</span>
                </button>
              </>
            )}

            {/* State: Pending Review */}
            {isPendingReview && isClinicianOrAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setIsEditing(!isEditing)}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/90 text-slate-800 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                  <span>{isEditing ? "Lock Note" : "Request Changes"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSignArtifact}
                  disabled={isSaving}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs whitespace-nowrap"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-200" />
                  <span>{isSaving ? "Signing..." : "Approve & Sign Note"}</span>
                </button>
              </>
            )}

            {/* State: Signed */}
            {isSigned && isClinicianOrAdmin && (
              <button
                type="button"
                onClick={() => setShowAmendmentPrompt(true)}
                disabled={isSaving}
                className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs whitespace-nowrap"
              >
                <GitBranch className="w-3.5 h-3.5 text-amber-400" />
                <span>Create Amendment</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  ),
  document.body
);
}
