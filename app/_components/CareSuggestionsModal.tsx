"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Clock,
  HeartPulse,
  Coffee,
  Droplets,
  Activity,
  FileText,
  Pill,
  Sparkles,
  Printer,
  Copy,
  Check,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Info,
  Calendar,
  Stethoscope,
  RefreshCw,
  HelpCircle,
} from "lucide-react";
import { CareSuggestionsResponse } from "@/lib/care-suggestions/care-suggestion-service";

interface CareSuggestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  consultationId?: string;
  careSuggestions?: CareSuggestionsResponse | null;
  isLoading?: boolean;
  onRetry?: () => void;
  error?: string | null;
  doctorName?: string;
  specialty?: string;
}

export function CareSuggestionsModal({
  isOpen,
  onClose,
  consultationId,
  careSuggestions: propCareSuggestions,
  isLoading = false,
  onRetry,
  error = null,
  doctorName = "Attending Clinician",
  specialty = "Clinical Consultation",
}: CareSuggestionsModalProps) {
  const [copied, setCopied] = useState(false);
  const [internalData, setInternalData] = useState<CareSuggestionsResponse | null>(null);
  const [internalLoading, setInternalLoading] = useState<boolean>(false);
  const [internalError, setInternalError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (propCareSuggestions) {
      setInternalData(propCareSuggestions);
      return;
    }
    if (consultationId && !internalData) {
      let isSubscribed = true;
      setInternalLoading(true);
      setInternalError(null);

      fetch(`/api/consultations/${encodeURIComponent(consultationId)}/care-suggestions`)
        .then((res) => res.json())
        .then((data) => {
          if (!isSubscribed) return;
          if (data.success && data.hasSavedSuggestions && data.careSuggestions) {
            setInternalData(data.careSuggestions);
            setInternalLoading(false);
          } else {
            // Not yet generated: auto-generate via POST
            return fetch(`/api/consultations/${encodeURIComponent(consultationId)}/care-suggestions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ doctorName, specialty }),
            })
              .then((res) => res.json())
              .then((postData) => {
                if (!isSubscribed) return;
                if (postData.success && postData.careSuggestions) {
                  setInternalData(postData.careSuggestions);
                } else {
                  setInternalError(postData.error || "Unable to generate care suggestions.");
                }
                setInternalLoading(false);
              });
          }
        })
        .catch((err) => {
          if (!isSubscribed) return;
          setInternalError(err.message || "Failed to load care suggestions.");
          setInternalLoading(false);
        });

      return () => {
        isSubscribed = false;
      };
    }
  }, [isOpen, consultationId, propCareSuggestions, internalData, doctorName, specialty]);

  const handleInternalRetry = () => {
    if (onRetry) {
      onRetry();
      return;
    }
    if (!consultationId) return;
    setInternalLoading(true);
    setInternalError(null);
    fetch(`/api/consultations/${encodeURIComponent(consultationId)}/care-suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctorName, specialty }),
    })
      .then((res) => res.json())
      .then((postData) => {
        if (postData.success && postData.careSuggestions) {
          setInternalData(postData.careSuggestions);
        } else {
          setInternalError(postData.error || "Unable to generate care suggestions.");
        }
        setInternalLoading(false);
      })
      .catch((err) => {
        setInternalError(err.message || "Failed to generate care suggestions.");
        setInternalLoading(false);
      });
  };

  const careSuggestions = propCareSuggestions || internalData;
  const activeLoading = isLoading || internalLoading;
  const activeError = error || internalError;

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!careSuggestions) return;
    const text = `MEDVOICE AI CLINICAL CARE SUGGESTIONS
Encounter ID: ${careSuggestions.consultationId}
Source: ${careSuggestions.sourceDisplay}
Status: Pending Clinician Review

[CLINICAL SUMMARY]
${careSuggestions.clinicalSummary}

[WARNING SIGNS]
Emergency (Immediate Medical Care):
${careSuggestions.warningSigns.emergency.map((s) => `• ${s}`).join("\n") || "None specified"}

Urgent Evaluation:
${careSuggestions.warningSigns.urgent.map((s) => `• ${s}`).join("\n") || "None specified"}

Routine Monitoring:
${careSuggestions.warningSigns.routine.map((s) => `• ${s}`).join("\n") || "None specified"}

[REST & RECOVERY]
${careSuggestions.restAndRecovery.map((s) => `• ${s}`).join("\n")}

[DIETARY RECOMMENDATIONS]
Suitable Foods:
${careSuggestions.dietRecommendations.suitable.map((s) => `• ${s}`).join("\n")}
Foods to Avoid / Limit:
${careSuggestions.dietRecommendations.avoidOrLimit.map((s) => `• ${s}`).join("\n")}

[HYDRATION]
${careSuggestions.hydrationGuidance.map((s) => `• ${s}`).join("\n")}

[PRECAUTIONS & SELF-CARE]
${careSuggestions.precautions.map((s) => `• ${s}`).join("\n")}

[MEDICATION ANALYSIS & SAFETY CHECKS]
1. Existing Medications:
${careSuggestions.medicationInformation.existingMedications?.reported.map((m) => `• ${m}`).join("\n") || "None reported"}

2. Potential OTC Medication Education:
${
  careSuggestions.medicationInformation.potentialOtcEducation &&
  careSuggestions.medicationInformation.potentialOtcEducation.length > 0
    ? careSuggestions.medicationInformation.potentialOtcEducation
        .map(
          (otc) =>
            `• ${otc.genericName} (${otc.tradeNames.join(", ")}): Used for ${otc.commonlyUsedFor}. Precaution: ${otc.precautions[0]}. Requires: ${otc.approvalRequirement}`
        )
        .join("\n")
    : careSuggestions.medicationInformation.clinicalClarification?.rationaleIfNoMedicationAppropriate ||
      "No OTC medication education recommended without physical examination."
}

3. Medication Safety & Precautions:
${
  (
    careSuggestions.medicationInformation.safetyAndPrecautions?.contraindicationsDetected ||
    careSuggestions.medicationInformation.contraindicationsDetected ||
    []
  )
    .map((c) => `• Alert: ${c}`)
    .join("\n") || "No critical contraindications flagged"
}

4. Clinical Clarification & Key Questions:
${
  careSuggestions.medicationInformation.clinicalClarification?.followUpQuestions &&
  careSuggestions.medicationInformation.clinicalClarification.followUpQuestions.length > 0
    ? careSuggestions.medicationInformation.clinicalClarification.followUpQuestions
        .map((q) => `• ${q}`)
        .join("\n")
    : "Standard outpatient physical examination required."
}

[FOLLOW-UP]
${careSuggestions.followUpRecommendations.map((s) => `• ${s}`).join("\n")}

DISCLAIMER: ${careSuggestions.disclaimer}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/60 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0"
      />

      <div className="relative w-full max-w-4xl max-h-[92vh] bg-white rounded-3xl shadow-2xl border border-slate-200/90 overflow-hidden z-10 flex flex-col font-sans">
        {/* ==================== HEADER ==================== */}
        <div className="px-6 py-5 border-b border-slate-100 bg-[#FAF9F6] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#18251D] text-[#B7FF72] flex items-center justify-center shadow-xs">
              <Sparkles className="w-5 h-5 text-[#B7FF72]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-black text-slate-950 tracking-tight">
                  Personalized Care Suggestions
                </h2>

                {careSuggestions && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider border ${
                      careSuggestions.source === "soap_and_transcript"
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-indigo-50 text-indigo-800 border-indigo-200"
                    }`}
                  >
                    <FileText className="w-3 h-3" />
                    <span>{careSuggestions.sourceDisplay}</span>
                  </span>
                )}

                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                  <Clock className="w-3 h-3 text-amber-600" />
                  <span>Pending Clinician Review</span>
                </span>
              </div>

              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                {doctorName} · {specialty} {careSuggestions?.consultationId ? `· ID: ${careSuggestions.consultationId}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {careSuggestions && (
              <>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                  title="Copy care suggestions text"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700 font-bold">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handlePrint}
                  className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                  title="Print care plan"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-500" />
                  <span>Print</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ==================== BODY ==================== */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Loading State */}
          {activeLoading && (
            <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-3 border-slate-200 border-t-[#18251D] animate-spin" />
                <Sparkles className="w-5 h-5 text-[#B7FF72] absolute inset-0 m-auto animate-pulse" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900">
                  Synthesizing Personalized Care Suggestions…
                </p>
                <p className="text-xs text-slate-500 max-w-sm">
                  Analyzing consultation dialogue, MedlinePlus clinical guidelines, and safety contraindications.
                </p>
              </div>
            </div>
          )}

          {/* Error State */}
          {!activeLoading && activeError && (
            <div className="p-6 rounded-3xl bg-amber-50/70 border border-amber-200 text-amber-900 space-y-3">
              <div className="flex items-center gap-2 font-bold text-sm">
                <AlertCircle className="w-5 h-5 text-amber-600" />
                <span>Care Suggestions Generation Notice</span>
              </div>
              <p className="text-xs text-amber-800 leading-relaxed">
                {activeError}
              </p>
              <button
                type="button"
                onClick={handleInternalRetry}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-amber-800 text-white hover:bg-amber-900 transition-all cursor-pointer shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Care Suggestions</span>
              </button>
            </div>
          )}

          {/* Success Content */}
          {!activeLoading && !activeError && careSuggestions && (
            <>
              {/* SOURCE BANNER (Transparent Citation) */}
              <div
                className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-xs ${
                  careSuggestions.source === "soap_and_transcript"
                    ? "bg-emerald-50/60 border-emerald-200 text-emerald-950"
                    : "bg-indigo-50/70 border-indigo-200 text-indigo-950"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Info className="w-4 h-4 text-emerald-700 shrink-0" />
                  <div>
                    <span className="font-bold">Generated from: </span>
                    <span className="font-medium">
                      {careSuggestions.source === "soap_and_transcript"
                        ? "Structured SOAP Clinical Record & Full Dialogue Transcript"
                        : "Full Consultation Dialogue Transcript (SOAP Unavailable Fallback)"}
                    </span>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
                  {careSuggestions.sources.length} clinical references verified
                </span>
              </div>

              {/* 1. CLINICAL SUMMARY */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-2">
                <div className="flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-[#18251D]" />
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono">
                    Clinical Encounter Summary
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-slate-800 leading-relaxed font-normal">
                  {careSuggestions.clinicalSummary}
                </p>
              </div>

              {/* 2. WARNING SIGNS (THREE TIERS) */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono">
                    Warning Signs & Clinical Precautions
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Emergency Tier */}
                  <div className="p-4 rounded-2xl bg-rose-50/80 border border-rose-200 text-rose-950 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold font-mono text-rose-800 uppercase tracking-wider">
                        🚨 Emergency (Immediate)
                      </span>
                      <span className="text-[10px] font-bold text-white bg-rose-700 px-2 py-0.5 rounded-full">
                        Call 112 / 108
                      </span>
                    </div>
                    <ul className="space-y-1.5 text-xs text-rose-900">
                      {careSuggestions.warningSigns.emergency.map((sign, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 leading-snug font-medium">
                          <span className="text-rose-600 font-bold shrink-0">•</span>
                          <span>{sign}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Urgent Tier */}
                  <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 text-amber-950 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold font-mono text-amber-800 uppercase tracking-wider">
                        ⚠️ Urgent Outpatient
                      </span>
                      <span className="text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full">
                        Within 24-48 hrs
                      </span>
                    </div>
                    <ul className="space-y-1.5 text-xs text-amber-900">
                      {careSuggestions.warningSigns.urgent.map((sign, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 leading-snug font-medium">
                          <span className="text-amber-600 font-bold shrink-0">•</span>
                          <span>{sign}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Routine Tier */}
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold font-mono text-slate-700 uppercase tracking-wider">
                        ℹ️ Routine Monitoring
                      </span>
                      <span className="text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                        Track at Home
                      </span>
                    </div>
                    <ul className="space-y-1.5 text-xs text-slate-700">
                      {careSuggestions.warningSigns.routine.map((sign, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 leading-snug">
                          <span className="text-slate-400 font-bold shrink-0">•</span>
                          <span>{sign}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* 3. MEDICATION EDUCATION & SAFETY (FOUR DISTINCT CLINICAL PILLARS) */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Pill className="w-4 h-4 text-[#18251D]" />
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono">
                      Medication Analysis & Safety Checks
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-slate-500 uppercase bg-slate-100 px-2 py-0.5 rounded w-fit">
                    Decision Support Only · Not a Prescription
                  </span>
                </div>

                {/* PILLAR 1: EXISTING MEDICATIONS */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                      1. Existing Patient Medications
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {(
                        careSuggestions.medicationInformation.existingMedications?.reported ||
                        careSuggestions.medicationInformation.patientReportedMedications
                      ).filter((m) => !m.includes("None reported")).length}{" "}
                      Reported / Active
                    </span>
                  </div>

                  {careSuggestions.medicationInformation.existingMedications ? (
                    <div className="p-3.5 rounded-xl bg-slate-50/90 border border-slate-200/80 space-y-2 text-xs">
                      <p className="text-slate-700 font-medium text-[11px]">
                        {careSuggestions.medicationInformation.existingMedications.statusSummary}
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {careSuggestions.medicationInformation.existingMedications.reported.map((m, idx) => (
                          <span
                            key={idx}
                            className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold ${
                              m.includes("None reported")
                                ? "bg-slate-100 text-slate-600 border border-slate-200"
                                : "bg-blue-50 text-blue-900 border border-blue-200"
                            }`}
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                      {careSuggestions.medicationInformation.patientReportedMedications.length > 0
                        ? careSuggestions.medicationInformation.patientReportedMedications.join(", ")
                        : "No existing medications reported."}
                    </div>
                  )}
                </div>

                {/* PILLAR 2: POTENTIAL OTC MEDICATION EDUCATION */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      2. Potential Over-The-Counter (OTC) Education
                    </span>
                    <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                      Symptom-Grounded Support
                    </span>
                  </div>

                  {careSuggestions.medicationInformation.potentialOtcEducation &&
                  careSuggestions.medicationInformation.potentialOtcEducation.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {careSuggestions.medicationInformation.potentialOtcEducation.map((otc, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-2 text-xs flex flex-col justify-between"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-bold text-slate-950 text-xs">{otc.genericName}</span>
                              <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50/80 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0">
                                OTC Education
                              </span>
                            </div>
                            {otc.tradeNames && otc.tradeNames.length > 0 && (
                              <div className="text-[10px] font-mono text-slate-500">
                                <span className="font-semibold text-slate-700">Common brands: </span>
                                {otc.tradeNames.join(", ")}
                              </div>
                            )}
                            <div className="text-[11px] text-slate-700 leading-snug">
                              <span className="font-semibold text-slate-900">Commonly used for: </span>
                              {otc.commonlyUsedFor}
                            </div>
                            {otc.precautions && otc.precautions.length > 0 && (
                              <div className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-200/70 space-y-0.5">
                                <span className="font-bold text-slate-800 block text-[10px] uppercase tracking-wider">
                                  Important Precautions:
                                </span>
                                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                                  {otc.precautions.map((p, pIdx) => (
                                    <li key={pIdx}>{p}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {otc.contraindicationsAndInteractions && otc.contraindicationsAndInteractions.length > 0 && (
                              <div className="text-[11px] text-amber-900 bg-amber-50/80 p-2 rounded-lg border border-amber-200 space-y-0.5">
                                <span className="font-bold text-amber-950 block text-[10px] uppercase tracking-wider">
                                  Contraindications & Interactions:
                                </span>
                                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                                  {otc.contraindicationsAndInteractions.map((c, cIdx) => (
                                    <li key={cIdx}>{c}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex flex-col gap-1 text-[10px] text-slate-500">
                            <span className="text-slate-700 font-medium">
                              ⚖️ <span className="font-semibold">Review Requirement:</span> {otc.approvalRequirement}
                            </span>
                            <span className="italic font-mono text-slate-400">Source: {otc.source}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
                      <p className="font-medium text-slate-800">
                        {careSuggestions.medicationInformation.clinicalClarification?.rationaleIfNoMedicationAppropriate ||
                          "No over-the-counter medication education is currently recommended for this encounter without in-person examination."}
                      </p>
                    </div>
                  )}
                </div>

                {/* PILLAR 3: MEDICATION SAFETY & PRECAUTIONS */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      3. Medication Safety and Precautions
                    </span>
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                      Zero Autonomous Prescribing
                    </span>
                  </div>

                  {/* Detected Contraindications if any */}
                  {(
                    careSuggestions.medicationInformation.safetyAndPrecautions?.contraindicationsDetected ||
                    careSuggestions.medicationInformation.contraindicationsDetected ||
                    []
                  ).length > 0 && (
                    <div className="p-3.5 rounded-xl bg-rose-50/80 border border-rose-200 text-rose-950 text-xs space-y-1.5">
                      <span className="font-bold text-rose-900 block text-[11px] uppercase tracking-wider">
                        ⚠️ Identified Contraindications & Safety Alerts:
                      </span>
                      <ul className="list-disc list-inside space-y-1 text-rose-900 text-[11px] font-medium">
                        {(
                          careSuggestions.medicationInformation.safetyAndPrecautions?.contraindicationsDetected ||
                          careSuggestions.medicationInformation.contraindicationsDetected ||
                          []
                        ).map((c, idx) => (
                          <li key={idx}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* General Safety Invariants */}
                  <div className="text-[11px] text-slate-600 bg-[#FAF9F6] p-3 rounded-xl border border-slate-200/80 space-y-1">
                    <span className="font-bold text-slate-800 block">Medication Safety Standards:</span>
                    <ul className="space-y-0.5 list-disc list-inside">
                      <li>Never alter, stop, or initiate prescription therapies without direct physician oversight.</li>
                      <li>MedVoice AI does not autonomously prescribe, dose, or dispense pharmaceuticals.</li>
                      <li>Check labels diligently to avoid duplicate paracetamol intake across multiple cold remedies.</li>
                    </ul>
                  </div>
                </div>

                {/* PILLAR 4: INFORMATION REQUIRING CLINICAL CLARIFICATION */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider font-mono flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                      4. Information Requiring Clinical Clarification
                    </span>
                    <span className="text-[10px] font-mono text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded">
                      Physician & Patient Questions
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-purple-50/60 border border-purple-200/90 text-purple-950 text-xs space-y-2">
                    {careSuggestions.medicationInformation.clinicalClarification?.rationaleIfNoMedicationAppropriate && (
                      <div className="p-2.5 rounded-lg bg-white border border-purple-200 text-purple-900 font-medium text-[11px]">
                        <span className="font-bold text-purple-950">Clinical Note: </span>
                        {careSuggestions.medicationInformation.clinicalClarification.rationaleIfNoMedicationAppropriate}
                      </div>
                    )}

                    {careSuggestions.medicationInformation.clinicalClarification?.followUpQuestions &&
                    careSuggestions.medicationInformation.clinicalClarification.followUpQuestions.length > 0 ? (
                      <div className="space-y-1">
                        <span className="font-bold text-purple-900 block text-[11px]">
                          Key Clinical Questions for In-Person Evaluation:
                        </span>
                        <ul className="list-disc list-inside space-y-1 text-[11px] text-purple-900">
                          {careSuggestions.medicationInformation.clinicalClarification.followUpQuestions.map((q, idx) => (
                            <li key={idx}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-[11px] text-purple-900">
                        Standard outpatient vitals telemetry and physical examination will be conducted by your attending physician.
                      </p>
                    )}

                    {careSuggestions.medicationInformation.clinicalClarification?.missingSafetyInformation &&
                    careSuggestions.medicationInformation.clinicalClarification.missingSafetyInformation.length > 0 && (
                      <div className="pt-1.5 border-t border-purple-200/70 text-[10px] font-mono text-purple-800">
                        <span className="font-bold">Missing Telemetry: </span>
                        {careSuggestions.medicationInformation.clinicalClarification.missingSafetyInformation.join(" · ")}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 4. REST & RECOVERY + DIET & HYDRATION (2 COLS) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Rest & Recovery */}
                <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-700" />
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono">
                      Rest & Physical Recovery
                    </h3>
                  </div>
                  <ul className="space-y-2 text-xs text-slate-700">
                    {careSuggestions.restAndRecovery.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 leading-relaxed">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Diet & Hydration */}
                <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-3">
                  <div className="flex items-center gap-2">
                    <Coffee className="w-4 h-4 text-amber-700" />
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono">
                      Diet & Hydration Recommendations
                    </h3>
                  </div>
                  <div className="space-y-2 text-xs text-slate-700">
                    <div>
                      <span className="font-bold text-slate-900 block text-[11px] mb-1">Suitable Choices:</span>
                      <ul className="space-y-1">
                        {careSuggestions.dietRecommendations.suitable.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-1.5 leading-snug">
                            <span className="text-emerald-600 font-bold">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {careSuggestions.dietRecommendations.avoidOrLimit.length > 0 && (
                      <div className="pt-1">
                        <span className="font-bold text-slate-900 block text-[11px] mb-1">Foods to Limit:</span>
                        <ul className="space-y-1">
                          {careSuggestions.dietRecommendations.avoidOrLimit.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-1.5 leading-snug text-slate-600">
                              <span className="text-rose-500 font-bold">•</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="pt-1">
                      <span className="font-bold text-slate-900 block text-[11px] mb-1">Hydration Guidance:</span>
                      <ul className="space-y-1">
                        {careSuggestions.hydrationGuidance.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-1.5 leading-snug text-slate-700">
                            <Droplets className="w-3 h-3 text-cyan-600 shrink-0 mt-0.5" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              {/* 5. PRECAUTIONS & FOLLOW-UP (2 COLS) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Precautions */}
                <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-indigo-700" />
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono">
                      Precautions & Self-Care
                    </h3>
                  </div>
                  <ul className="space-y-2 text-xs text-slate-700">
                    {careSuggestions.precautions.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 leading-relaxed">
                        <span className="text-indigo-600 font-bold shrink-0">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Follow-up */}
                <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-800" />
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider font-mono">
                      Clinical Follow-Up Recommendations
                    </h3>
                  </div>
                  <ul className="space-y-2 text-xs text-slate-700">
                    {careSuggestions.followUpRecommendations.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 leading-relaxed font-medium">
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* 6. MISSING INFORMATION & UNASSESSED CLINICAL DATA */}
              {careSuggestions.missingInformation.length > 0 && (
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-slate-800 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <HelpCircle className="w-4 h-4 text-slate-500" />
                    <span>Unassessed Clinical Elements & Missing Context</span>
                  </div>
                  <ul className="space-y-1 list-disc list-inside text-slate-600">
                    {careSuggestions.missingInformation.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 7. CLINICAL SOURCES & GROUNDED CITATIONS */}
              <div className="p-4 rounded-2xl bg-[#FAF9F6] border border-slate-200 text-xs text-slate-600 space-y-2">
                <span className="font-bold text-slate-900 uppercase tracking-wider font-mono text-[11px] block">
                  Clinical Evidence Grounding Sources:
                </span>
                <div className="flex flex-wrap gap-2">
                  {careSuggestions.sources.map((src, idx) => (
                    <a
                      key={idx}
                      href={src.url || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-800 hover:text-emerald-700 text-[11px] font-medium transition-colors"
                    >
                      <span>{src.title}</span>
                      <ExternalLink className="w-3 h-3 text-slate-400" />
                    </a>
                  ))}
                </div>
              </div>

              {/* 8. LEGAL & CLINICAL GOVERNANCE DISCLAIMER */}
              <div className="p-3.5 rounded-xl bg-slate-100/70 border border-slate-200 text-center">
                <p className="text-[11px] text-slate-500 leading-relaxed font-sans">
                  {careSuggestions.disclaimer}
                </p>
              </div>
            </>
          )}
        </div>

        {/* ==================== FOOTER ==================== */}
        <div className="px-6 py-4 border-t border-slate-100 bg-[#FAF9F6] flex items-center justify-between">
          <div className="text-xs text-slate-500 font-medium">
            MedVoice Clinical Decision Support · Grounded Guidance
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#18251D] hover:bg-black text-white transition-all shadow-xs cursor-pointer"
            >
              Close Care Plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
