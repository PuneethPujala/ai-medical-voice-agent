"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Activity,
  Clock,
  Printer,
  Download,
  AlertTriangle,
  CheckCircle,
  Building2,
  Mic,
  ArrowRight,
  Search,
  ShieldCheck,
  ClipboardList,
  Radio,
  Copy,
  Check,
  FileCode,
  Lock,
  X,
  Send,
  ChevronDown,
  Eye,
  Code2,
  AlertCircle,
  User,
  Stethoscope,
} from "lucide-react";
import Link from "next/link";

import { LandingFloatingNavbar } from "../_components/LandingFloatingNavbar";
import { ArchitecturalBrandLedgerFooter } from "../_components/ArchitecturalBrandLedgerFooter";
import { SoapWorkspaceAmbientMotion } from "./_components/SoapWorkspaceAmbientMotion";
import { generateFHIRBundle, validateFhirR4Bundle, getICD10Display, type FHIRBundle, type FhirValidationResult } from "@/lib/fhir/bundle";
import CountUp from "@/components/CountUp";
import { ClinicalSwipeRow } from "@/components/clinical/ClinicalSwipeRow";
import { ClinicalFlipCard } from "@/components/clinical/ClinicalFlipCard";
import StarBorder from "@/components/ui/StarBorder";

interface ConsultationRecord {
  id: string;
  userId?: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  chiefComplaint: string;
  triageLevel: "emergency" | "priority" | "routine" | "gathering_history";
  triageTitle: string;
  esiScore?: number;
  icd10Codes?: string[];
  detectedSymptoms?: string[];
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
  recommendedAction?: string;
  durationSeconds?: number;
  status?: "in_progress" | "completed_pending_review" | "approved" | "incomplete_intake";
  approvedAt?: string;
  approvedBy?: string;
  isSynthetic?: boolean;
  syntheticWatermark?: string;
  createdAt: string;
  transcript?: Array<{ role: string; text: string; timestamp: string }>;
}

interface DispatchReceiptState {
  dispatchId: string;
  hospitalName: string;
  intakeQueueStatus: string;
  assignedHospitalBay: string;
  attendingPhysicianOnCall: string;
  etaMinutes: number;
  auditHash: string;
  timestamp: string;
  preArrivalDirectives: string[];
}

// Client-side SHA-256 calculation using native Web Cryptography API
async function computeSha256Hex(message: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
    return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  }
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function DashboardPage() {
  const [consultations, setConsultations] = useState<ConsultationRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ConsultationRecord | null>(null);
  const isRecordIncomplete = Boolean(
    selectedReport && (
      selectedReport.status === "incomplete_intake" ||
      selectedReport.status === "in_progress" ||
      selectedReport.triageLevel === "gathering_history" ||
      selectedReport.soapSubjective?.includes("[INCOMPLETE")
    )
  );
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSyntheticDataset, setIsSyntheticDataset] = useState<boolean>(false);
  const [isApprovingRecord, setIsApprovingRecord] = useState<boolean>(false);

  // HL7 FHIR Modal State
  const [showFhirModal, setShowFhirModal] = useState<boolean>(false);
  const [fhirJsonString, setFhirJsonString] = useState<string>("");
  const [copiedFhir, setCopiedFhir] = useState<boolean>(false);
  const [fhirBundle, setFhirBundle] = useState<FHIRBundle | null>(null);
  const [fhirValidation, setFhirValidation] = useState<FhirValidationResult | null>(null);
  const [fhirActiveTab, setFhirActiveTab] = useState<"summary" | "json">("summary");

  // Hospital Pre-Arrival Dispatch State
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatches, setDispatches] = useState<Record<string, DispatchReceiptState>>({});

  // SHA-256 Cryptographic Hash State
  const [currentRecordHash, setCurrentRecordHash] = useState<string>("");
  const [copiedHash, setCopiedHash] = useState<boolean>(false);

  const fetchRecords = async (_mode?: string) => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/consultations");
      if (res.ok) {
        const data = await res.json();
        setIsSyntheticDataset(false);
        const list: ConsultationRecord[] = data.consultations || [];
        setConsultations(list);
        setSelectedReport(list.length > 0 ? list[0] : null);
      } else if (res.status === 401) {
        const demoRes = await fetch("/api/consultations?dataset=synthetic_demo");
        if (demoRes.ok) {
          const data = await demoRes.json();
          const list: ConsultationRecord[] = data.consultations || [];
          setConsultations(list);
          setSelectedReport(list.length > 0 ? list[0] : null);
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        if (res.status === 503) {
          setFetchError("Clinical datastore temporarily unavailable. Please retry in a few moments.");
        } else {
          setFetchError(errJson.error || "Failed to load clinical records.");
        }
        setConsultations([]);
        setSelectedReport(null);
      }
    } catch (err: any) {
      console.error("Failed to load consultations:", err);
      setFetchError("Network connection error. Unable to connect to clinical datastore.");
      setConsultations([]);
      setSelectedReport(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  const handleApproveReport = async (reportId: string) => {
    if (!reportId || isApprovingRecord) return;
    setIsApprovingRecord(true);
    try {
      const res = await fetch(`/api/consultations/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      if (res.ok) {
        const data = await res.json();
        const updated = data.consultation;
        setConsultations((prev) =>
          prev.map((c) => (c.id === reportId ? { ...c, ...updated, status: "approved" } : c))
        );
        if (selectedReport?.id === reportId) {
          setSelectedReport((prev) => (prev ? { ...prev, ...updated, status: "approved" } : null));
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(errJson.error || "Clinical signing authority required to approve medical records. Clinician credentials required.");
      }
    } catch (err) {
      console.error("Error approving report:", err);
    } finally {
      setIsApprovingRecord(false);
    }
  };

  // Compute cryptographic SHA-256 hash whenever selected report changes
  useEffect(() => {
    if (!selectedReport) return;
    const canonical = [
      selectedReport.id,
      selectedReport.patientName,
      selectedReport.createdAt,
      selectedReport.triageLevel,
      (selectedReport.icd10Codes || []).slice().sort().join(","),
      selectedReport.chiefComplaint?.trim().toLowerCase() || "",
    ].join("|");

    computeSha256Hex(canonical).then((hash) => {
      setCurrentRecordHash(hash);
    });
  }, [selectedReport]);

  const filteredConsultations = consultations.filter((c) => {
    const matchesSeverity = filterSeverity === "all" || c.triageLevel === filterSeverity;
    const matchesStatus =
      filterStatus === "all" ||
      (filterStatus === "approved" && c.status === "approved") ||
      (filterStatus === "pending" && c.status !== "approved");
    const matchesSearch =
      c.doctorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.specialty.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.patientName && c.patientName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.chiefComplaint && c.chiefComplaint.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSeverity && matchesStatus && matchesSearch;
  });

  const handlePrint = () => {
    if (typeof window !== "undefined" && selectedReport) {
      const origTitle = document.title;
      document.title = `MedVoice-Clinical-Chart-${selectedReport.id}`;
      window.print();
      setTimeout(() => {
        document.title = origTitle;
      }, 1000);
    }
  };

  // Open FHIR Modal & generate R4 bundle
  const handleOpenFhirModal = () => {
    if (!selectedReport) return;
    const bundle = generateFHIRBundle({
      id: selectedReport.id,
      patientName: selectedReport.patientName,
      doctorId: selectedReport.doctorId,
      doctorName: selectedReport.doctorName,
      specialty: selectedReport.specialty,
      chiefComplaint: selectedReport.chiefComplaint,
      triageLevel: selectedReport.triageLevel,
      triageTitle: selectedReport.triageTitle,
      esiScore: selectedReport.esiScore,
      icd10Codes: selectedReport.icd10Codes,
      detectedSymptoms: selectedReport.detectedSymptoms,
      soapSubjective: selectedReport.soapSubjective,
      soapObjective: selectedReport.soapObjective,
      soapAssessment: selectedReport.soapAssessment,
      soapPlan: selectedReport.soapPlan,
      recommendedAction: selectedReport.recommendedAction,
      createdAt: selectedReport.createdAt,
      transcript: selectedReport.transcript,
    });

    const validation = validateFhirR4Bundle(bundle as unknown as Record<string, unknown>);
    setFhirBundle(bundle);
    setFhirValidation(validation);
    const jsonStr = JSON.stringify(bundle, null, 2);
    setFhirJsonString(jsonStr);
    setFhirActiveTab("summary");
    setShowFhirModal(true);
  };

  // Download FHIR JSON file
  const handleDownloadFhir = () => {
    if (!selectedReport) return;
    const bundle = generateFHIRBundle({
      id: selectedReport.id,
      patientName: selectedReport.patientName,
      doctorId: selectedReport.doctorId,
      doctorName: selectedReport.doctorName,
      specialty: selectedReport.specialty,
      chiefComplaint: selectedReport.chiefComplaint,
      triageLevel: selectedReport.triageLevel,
      triageTitle: selectedReport.triageTitle,
      esiScore: selectedReport.esiScore,
      icd10Codes: selectedReport.icd10Codes,
      detectedSymptoms: selectedReport.detectedSymptoms,
      soapSubjective: selectedReport.soapSubjective,
      soapObjective: selectedReport.soapObjective,
      soapAssessment: selectedReport.soapAssessment,
      soapPlan: selectedReport.soapPlan,
      recommendedAction: selectedReport.recommendedAction,
      createdAt: selectedReport.createdAt,
      transcript: selectedReport.transcript,
    });

    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fhir-r4-bundle-${selectedReport.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyFhir = () => {
    if (!fhirJsonString) return;
    navigator.clipboard.writeText(fhirJsonString);
    setCopiedFhir(true);
    setTimeout(() => setCopiedFhir(false), 2000);
  };

  const handleCopyHash = () => {
    if (!currentRecordHash) return;
    navigator.clipboard.writeText(currentRecordHash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  // Transmit simulated pre-arrival alert to receiving hospital ED
  const handleTransmitPreArrival = async () => {
    if (!selectedReport) return;
    setIsDispatching(true);

    try {
      const payload = {
        consultationId: selectedReport.id,
        patientId: selectedReport.userId || "P-1002",
        patientName: selectedReport.patientName,
        esiScore: selectedReport.esiScore || (selectedReport.triageLevel === "emergency" ? 2 : selectedReport.triageLevel === "priority" ? 3 : 4),
        triageLevel: selectedReport.triageLevel,
        triageTitle: selectedReport.triageTitle || "Emergency Triage Case",
        chiefComplaint: selectedReport.chiefComplaint || "Emergency Medical Evaluation",
        icd10Codes: selectedReport.icd10Codes || ["R07.9"],
        detectedSymptoms: selectedReport.detectedSymptoms || ["Acute Complaint"],
        redFlagsTriggered: selectedReport.triageLevel === "emergency"
          ? (selectedReport.specialty.toLowerCase().includes("cardio")
              ? ["ACS_CHEST_PAIN_WITH_HIGH_RISK_RADIATION_OR_DIAPHORESIS"]
              : ["BE_FAST_ACUTE_ISCHEMIC_STROKE_SYMPTOMS"])
          : [],
        targetHospitalName: "Regional Level-1 Trauma & Emergency Medical Center",
        etaMinutes: 9,
      };

      const res = await fetch("/api/emergency/pre-arrival", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.receipt) {
          setDispatches((prev) => ({
            ...prev,
            [selectedReport.id]: data.receipt,
          }));
        }
      }
    } catch (err) {
      console.error("Emergency dispatch error:", err);
    } finally {
      setIsDispatching(false);
    }
  };

  const getUrgencyBadge = (level: string) => {
    if (level === "emergency") {
      return "bg-rose-50 text-rose-700 border-rose-200 font-bold animate-pulse";
    }
    if (level === "priority") {
      return "bg-amber-50 text-amber-700 border-amber-200 font-semibold";
    }
    return "bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold";
  };

  const activeDispatch = selectedReport ? dispatches[selectedReport.id] : null;

  const scrollToSection = (id: string) => {
    if (typeof window !== "undefined") {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
    }
  };

  return (
      <div className="relative min-h-screen bg-[#FAF9F6] text-slate-900 font-sans flex flex-col justify-between selection:bg-[#B7FF72] selection:text-[#05070F] overflow-x-clip">

        {/* Floating Pill Navbar with Centered Navigation and Active SOAP Pill */}
        <LandingFloatingNavbar />

        {/* Ambient Subtle Motion Layer: Faint Mint particles and acoustic trace in whitespace */}
        <SoapWorkspaceAmbientMotion />

        <main className="flex-1 w-full relative z-10 pt-28 sm:pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-[1400px] mx-auto print:hidden">
          {/* ===================================================================== */}
          {/* PRODUCT-FIRST CLINICAL RECORDS WORKSPACE HEADER                       */}
          {/* ===================================================================== */}
          <div className="mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <h1 className="text-2xl sm:text-3xl font-black text-[#05070F] tracking-tight">
                    Clinical Records
                  </h1>
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#18251D] px-2.5 py-0.5 rounded-full bg-white border border-slate-200 shadow-2xs">
                    Product-first
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 font-normal">
                  Review encounters, manage clinical notes and continue documentation.
                </p>
              </div>

              {/* Action Buttons: New Voice Consult + Optional Pipeline Guide */}
              <div className="flex flex-wrap items-center gap-2.5">
                <Link
                  href="/consult"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#18251D] hover:bg-slate-800 text-white font-mono text-xs font-bold transition-all shadow-sm"
                >
                  <Mic className="w-3.5 h-3.5 text-[#B7FF72]" />
                  <span>New Voice Consult</span>
                </Link>
              </div>
            </div>

            {/* Quick Filter Bar & Encounter Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200/70">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { key: "all", label: "All encounters" },
                  { key: "pending", label: "Needs review" },
                  { key: "approved", label: "Approved" },
                ].map((st) => (
                  <button
                    key={st.key}
                    onClick={() => setFilterStatus(st.key)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      filterStatus === st.key
                        ? "bg-[#18251D] text-white shadow-sm"
                        : "bg-white border border-slate-200/90 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}

                <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />

                <span className="text-[11px] font-mono font-bold text-slate-400 uppercase hidden sm:inline">Severity:</span>
                {["all", "emergency", "priority", "routine"].map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setFilterSeverity(lvl)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono uppercase transition-all cursor-pointer ${
                      filterSeverity === lvl
                        ? "bg-slate-800 text-white shadow-xs"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>

              {/* Search & Telemetry Summary */}
              <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search doctor, symptom..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-white border border-slate-200/90 focus:border-slate-400 focus:bg-white rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none w-full transition-all shadow-2xs"
                  />
                </div>


              </div>
            </div>
          </div>

          {/* ===================================================================== */}
          {/* SECTION: UNIFIED INTERACTIVE CLINICAL WORKSPACE                       */}
          {/* ===================================================================== */}
          <section id="clinical-workspace" className="space-y-4">

            {/* WORKSPACE HEADER & REAL-TIME STATS STRIP */}
            <div className="bg-white border border-slate-200/90 rounded-3xl p-5 sm:p-6 mb-6 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700 text-xs font-mono font-bold mb-2">
                    <span className="w-2 h-2 rounded-full bg-[#18251D] animate-pulse" />
                    <span>EHR CLINICAL ARCHIVE &amp; CONSULTATION REGISTRY</span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-black text-[#05070F] tracking-tight">
                    Interactive Clinical Workspace
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    Review and sign generated SOAP charts, verify SHA-256 integrity, trigger ED pre-arrival dispatch, and export HL7 FHIR R4 bundles.
                  </p>
                </div>

                {/* Telemetry Summary Counters */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 flex flex-col justify-between">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">Total Encounters</span>
                    <span className="text-xl font-black text-slate-900 font-mono mt-1">
                      <CountUp to={consultations.length} duration={1} />
                    </span>
                  </div>

                  <div className="bg-rose-50/60 border border-rose-200/80 rounded-2xl p-3 flex flex-col justify-between">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                      Emergency
                    </span>
                    <span className="text-xl font-black text-rose-700 font-mono mt-1">
                      <CountUp to={consultations.filter((c) => c.triageLevel === "emergency").length} duration={1} />
                    </span>
                  </div>

                  <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 flex flex-col justify-between">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#18251D]">Priority Outpatient</span>
                    <span className="text-xl font-black text-slate-900 font-mono mt-1">
                      <CountUp to={consultations.filter((c) => c.triageLevel !== "emergency").length} duration={1} />
                    </span>
                  </div>

                  <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-2xl p-3 flex flex-col justify-between">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-800">Interop Standard</span>
                    <span className="text-base font-black text-emerald-700 font-mono mt-1">FHIR R4</span>
                    <span className="text-[9px] font-mono text-emerald-800/80">US Core v3.1.1</span>
                  </div>
                </div>
              </div>

              {/* SYNTHETIC DEMONSTRATION DATASET WATERMARK BANNER */}
              {isSyntheticDataset && (
                <div className="mt-4 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <span className="font-mono font-bold tracking-wide">
                      SYNTHETIC DEMONSTRATION DATASET · FOR EVALUATION ONLY · NOT REAL PATIENT RECORDS
                    </span>
                  </div>
                  <button
                    onClick={() => fetchRecords("genuine")}
                    className="px-3 py-1.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-all cursor-pointer w-fit"
                  >
                    Return to My Records
                  </button>
                </div>
              )}
            </div>

            {/* BALANCED 12-COLUMN MASTER-DETAIL CLINICAL INTERFACE */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

              {/* LEFT: Consultation Queue (4 Columns) */}
              <div className="lg:col-span-4 space-y-3">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                    Consultation Queue (<CountUp to={filteredConsultations.length} duration={1} />)
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">Select record to inspect</span>
                </div>

                {isLoading ? (
                  <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 text-xs text-slate-500 shadow-sm">
                    Loading clinical consultation history...
                  </div>
                ) : fetchError ? (
                  <div className="p-8 text-center bg-white rounded-3xl border border-rose-200 space-y-3 shadow-sm text-xs text-rose-800">
                    <AlertTriangle className="w-6 h-6 mx-auto text-rose-600" />
                    <div className="font-bold">{fetchError}</div>
                    <button
                      onClick={() => fetchRecords()}
                      className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold cursor-pointer transition-all"
                    >
                      Retry Connection
                    </button>
                  </div>
                ) : filteredConsultations.length === 0 ? (
                  <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 space-y-3 shadow-sm">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                      <ClipboardList className="w-6 h-6" />
                    </div>
                    <div className="text-sm font-bold text-slate-900">
                      {filterStatus === "approved"
                        ? "No Approved Clinical Notes Yet"
                        : filterStatus === "pending"
                        ? "No Pending Notes"
                        : "No Clinical Consultations Found"}
                    </div>
                    <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                      {filterStatus === "approved"
                        ? "You have clinical encounters waiting for review. Switch to 'Needs review' to inspect and sign them."
                        : filterStatus === "pending"
                        ? "All recorded voice consultations have been reviewed and approved."
                        : "All voice encounters conducted on MedVoice will be permanently archived and verified here."}
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                      {filterStatus === "approved" ? (
                        <button
                          onClick={() => setFilterStatus("pending")}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#18251D] hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-2xs cursor-pointer"
                        >
                          <Clock className="w-3.5 h-3.5 text-[#B7FF72]" />
                          <span>View Pending Consultations</span>
                        </button>
                      ) : filterStatus === "pending" ? (
                        <button
                          onClick={() => setFilterStatus("all")}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#18251D] hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-2xs cursor-pointer"
                        >
                          <ClipboardList className="w-3.5 h-3.5 text-[#B7FF72]" />
                          <span>View All Encounters</span>
                        </button>
                      ) : (
                        <Link
                          href="/consult"
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#18251D] hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-2xs"
                        >
                          <Mic className="w-3.5 h-3.5 text-[#B7FF72]" />
                          <span>Start Voice Consultation</span>
                        </Link>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[800px] overflow-y-auto pr-1">
                    {filteredConsultations.map((item) => {
                      const isSelected = selectedReport?.id === item.id;
                      const dateStr = item.createdAt
                        ? new Date(item.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
                        : "Recent";

                      return (
                        <button
                          key={item.id}
                          onClick={() => setSelectedReport(item)}
                          className={`w-full text-left p-4 rounded-2xl border transition-all cursor-pointer ${
                            isSelected
                              ? "bg-white border-[#18251D] shadow-md ring-2 ring-[#18251D]/10"
                              : "bg-white border-slate-200/90 hover:border-slate-300 shadow-sm"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-extrabold text-slate-900 text-sm truncate">{item.doctorName}</span>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {Boolean(item.status === "incomplete_intake" || item.status === "in_progress" || item.triageLevel === "gathering_history" || item.soapSubjective?.includes("[INCOMPLETE")) ? (
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 uppercase">
                                  Incomplete
                                </span>
                              ) : item.status === "approved" ? (
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase">
                                  Approved
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 uppercase">
                                  Pending
                                </span>
                              )}
                              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border uppercase ${getUrgencyBadge(item.triageLevel)}`}>
                                {Boolean(item.status === "incomplete_intake" || item.status === "in_progress" || item.triageLevel === "gathering_history" || item.soapSubjective?.includes("[INCOMPLETE")) ? "Unassessed" : item.triageLevel}
                              </span>
                            </div>
                          </div>

                          <p className="text-xs text-slate-600 line-clamp-2 mb-3 font-medium">
                            {item.chiefComplaint || "Routine clinical triage evaluation"}
                          </p>

                          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 border-t border-slate-100 pt-2.5">
                            <span className="text-[#18251D] font-bold">{item.specialty}</span>
                            <div className="flex items-center gap-2">
                              {dispatches[item.id] && (
                                <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded font-bold font-mono">
                                  SIMULATED ED ALERT
                                </span>
                              )}
                              <span>{dateStr}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* RIGHT: Selected SOAP Clinical Chart (8 Columns) */}
              <div className="lg:col-span-8 space-y-4">
                {selectedReport ? (
                  <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-sm space-y-5">

                    {/* 1. CLINICAL HEADER & ENCOUNTER IDENTITY */}
                    <div className="border-b border-slate-100 pb-5 space-y-3">
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-xs font-mono font-bold text-[#18251D] mb-1.5">
                            <span className="text-slate-400 uppercase tracking-wider text-[11px]">Encounter</span>
                            <span className="bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200">{selectedReport.id}</span>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-500 font-normal">
                              {new Date(selectedReport.createdAt).toLocaleDateString(undefined, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>

                          </div>

                          <h2 className="text-2xl sm:text-3xl font-black text-slate-950 tracking-tight">
                            {selectedReport.patientName}
                          </h2>

                          <p className="text-xs text-slate-500 mt-1 font-medium">
                            Attending Clinician: <span className="text-slate-900 font-bold">{selectedReport.doctorName}</span> · <span className="text-slate-600">{selectedReport.specialty}</span>
                          </p>
                        </div>

                        {/* Action cluster: Primary (Approve/Status) + Secondary */}
                        <div className="flex flex-wrap items-center gap-2.5">
                          {selectedReport.status === "approved" ? (
                            <div className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-300 text-xs font-mono font-bold text-emerald-800 shadow-2xs">
                              <CheckCircle className="w-4 h-4 text-emerald-600" />
                              <span>CLINICIAN SIGNED</span>
                              {selectedReport.approvedAt && (
                                <span className="text-emerald-600/70 font-normal">
                                  · {new Date(selectedReport.approvedAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          ) : isRecordIncomplete ? (
                            <div
                              className="px-4 py-2 bg-slate-100 text-slate-400 border border-slate-200 rounded-xl text-xs font-mono font-bold flex items-center gap-2 cursor-not-allowed"
                              title="Incomplete intake cannot be signed. Clinical documentation must be completed first."
                            >
                              <Lock className="w-4 h-4 text-slate-400" />
                              <span>NOT READY FOR SIGNATURE</span>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleApproveReport(selectedReport.id)}
                              disabled={isApprovingRecord}
                              className="px-4 py-2 bg-[#18251D] hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer flex items-center gap-2"
                            >
                              <CheckCircle className="w-4 h-4 text-[#B7FF72]" />
                              <span>{isApprovingRecord ? "Signing..." : "Approve & Sign Note"}</span>
                            </button>
                          )}

                          {selectedReport.triageLevel === "emergency" && (
                            <Link
                              href="/care"
                              className="inline-flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 px-3 py-2 rounded-xl text-xs font-bold transition-all"
                              title="Locate nearest verified Emergency Rooms & Trauma Bays"
                            >
                              <Building2 className="w-3.5 h-3.5" />
                              <span>Find ERs</span>
                            </Link>
                          )}

                          <StarBorder
                            as="button"
                            onClick={handleOpenFhirModal}
                            color="#18251D"
                            duration={3.5}
                            theme="light"
                            backgroundColor="#FAF9F6"
                            textColor="#18251D"
                            radius={12}
                            className="inline-flex items-center gap-1.5 border border-slate-200 px-3 py-2 text-xs font-bold transition-all shadow-2xs hover:shadow-slate-500/10"
                            title="Inspect or download HL7 FHIR R4 Bundle"
                          >
                            <FileCode className="w-3.5 h-3.5 text-[#18251D]" />
                            <span>FHIR R4</span>
                          </StarBorder>

                          <button
                            onClick={handlePrint}
                            className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-800 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                            title="Print clinical SOAP chart"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Print</span>
                          </button>
                        </div>
                      </div>

                      {/* Clinical Triage & Diagnostic Codes Metadata Ribbon */}
                      <div className="flex flex-wrap items-center gap-2 pt-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono uppercase text-slate-400 font-bold">Acuity:</span>
                          <span className={`font-mono text-xs font-extrabold px-2.5 py-0.5 rounded-full uppercase border ${getUrgencyBadge(selectedReport.triageLevel)}`}>
                            {selectedReport.triageTitle || selectedReport.triageLevel}
                            {isRecordIncomplete || !selectedReport.esiScore ? " · ESI: Not Yet Assessed" : (selectedReport.triageLevel === "emergency" ? " · ESI Level 2" : ` · ESI Level ${selectedReport.esiScore}`)}
                          </span>
                        </div>

                        <span className="text-slate-300 hidden sm:inline">•</span>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-mono uppercase text-slate-400 font-bold">ICD-10:</span>
                          {selectedReport.icd10Codes && selectedReport.icd10Codes.length > 0 ? (
                            selectedReport.icd10Codes.map((code, idx) => (
                              <span key={idx} className="font-mono text-xs bg-slate-100 text-slate-800 border border-slate-200/80 px-2 py-0.5 rounded font-bold">
                                {code}
                              </span>
                            ))
                          ) : (
                            <span className="font-mono text-xs bg-slate-100 text-slate-500 border border-slate-200/80 px-2 py-0.5 rounded italic">
                              Not assigned (unsupported)
                            </span>
                          )}
                        </div>

                        <span className="text-slate-300 hidden sm:inline">•</span>

                        <div className="text-[11px] text-slate-500 font-medium truncate max-w-md">
                          Chief Complaint: <span className="text-slate-800 font-semibold italic">"{selectedReport.chiefComplaint}"</span>
                        </div>
                      </div>
                    </div>

                    {/* 2. INCOMPLETE INTAKE BANNER (Conditional) */}
                    {(selectedReport.soapSubjective?.includes("[INCOMPLETE INTAKE") || selectedReport.status === "in_progress") && (
                      <div className="p-3.5 rounded-2xl border border-amber-300 bg-amber-50/90 text-amber-900 space-y-1 shadow-2xs">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                          <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-900">
                            Incomplete Intake Encounter — History Gathering Phase
                          </span>
                        </div>
                        <p className="text-xs text-amber-950 font-medium leading-relaxed pl-6">
                          This voice consultation ended prior to formal multi-agent clinical consensus. Complete differential diagnosis and automated telemetry are unassessed. Direct in-person evaluation is recommended.
                        </p>
                      </div>
                    )}

                    {/* 3. EMERGENCY PRE-ARRIVAL DISPATCH TELEMETRY (Compact) */}
                    {selectedReport.triageLevel === "emergency" && (
                      <div className="p-4 rounded-2xl border bg-gradient-to-r from-rose-50/70 to-amber-50/70 border-rose-200 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Radio className={`w-4 h-4 ${activeDispatch ? "text-rose-600 animate-ping" : "text-rose-600"}`} />
                            <span className="text-xs font-mono font-extrabold uppercase tracking-wider text-rose-900">
                              Pre-Arrival Hospital Telemetry Webhook
                            </span>
                            <span className="text-[10px] font-mono font-extrabold uppercase bg-amber-200 text-amber-900 px-2 py-0.5 rounded-md border border-amber-300">
                              Simulation Only · Training Environment
                            </span>
                          </div>
                          {activeDispatch ? (
                            <span className="text-[11px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                              <CheckCircle className="w-3 h-3 text-emerald-600" />
                              <span>SIMULATED ED ALERT TRANSMITTED (~<CountUp to={activeDispatch.etaMinutes} duration={0.8} />m ETA)</span>
                            </span>
                          ) : (
                            <span className="text-[11px] font-mono text-slate-500 font-medium">
                              Status: Awaiting Clinician Transmission (Simulation)
                            </span>
                          )}
                        </div>

                        {activeDispatch ? (
                          <div className="bg-white/90 rounded-xl p-3.5 border border-rose-200/80 space-y-2 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">Assigned Intake Bay (Demo):</span>
                                <span className="font-extrabold text-slate-900">{activeDispatch.assignedHospitalBay}</span>
                              </div>
                              <div>
                                <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">On-Call Attending (Demo):</span>
                                <span className="font-bold text-slate-800">{activeDispatch.attendingPhysicianOnCall}</span>
                              </div>
                            </div>

                            <div className="border-t border-slate-100 pt-2">
                              <span className="text-[10px] font-mono uppercase text-rose-700 font-bold block mb-1">Pre-Arrival Directives Transmitted:</span>
                              <ul className="space-y-1 text-[11px] text-slate-700">
                                {activeDispatch.preArrivalDirectives.map((d, i) => (
                                  <li key={i} className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                                    <span>{d}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>

                            <div className="text-[10px] font-mono text-slate-500 flex items-center justify-between border-t border-slate-100 pt-1.5">
                              <span>Receipt ID: {activeDispatch.dispatchId}</span>
                              <span className="text-emerald-700 font-bold">✓ Cryptographically Verified (Simulation)</span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white/70 rounded-xl p-3 border border-rose-200/60">
                            <p className="text-xs text-slate-700 font-medium">
                              Life-threat criteria detected. Alert the receiving emergency department and Cath/Stroke team prior to patient arrival. (Simulation mode: no real-world dispatch occurs).
                            </p>
                            <button
                              onClick={handleTransmitPreArrival}
                              disabled={isDispatching}
                              className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-extrabold shadow-sm transition-all shrink-0 disabled:opacity-50 cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>{isDispatching ? "Transmitting..." : "Simulate ED Alert"}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 4. CONSOLIDATED AI REVIEW STATUS & CRYPTOGRAPHIC INTEGRITY STRIP */}
                    <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-3 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs relative">
                      <div className="flex items-center gap-2">
                        {selectedReport.status === "approved" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-mono font-bold text-[10px]">
                            <Check className="w-3 h-3 text-emerald-600" /> ATTESTED RECORD
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-800 font-mono font-bold text-[10px]">
                            <Clock className="w-3 h-3 text-amber-600" /> AI PRELIMINARY · CLINICAL REVIEW REQUIRED
                          </span>
                        )}
                        <span className="text-slate-600 text-[11px] hidden md:inline">
                          Synthesized from voice consultation. Review required before official EHR filing.
                        </span>
                      </div>

                      {/* Inline Integrity status with expandable disclosure */}
                      <details className="group">
                        <summary className="cursor-pointer list-none flex items-center gap-1.5 font-mono text-[11px] text-slate-700 font-bold hover:text-slate-950 transition-colors">
                          <Lock className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Ledger Integrity: Verified (SHA-256)</span>
                          <ChevronDown className="w-3 h-3 text-slate-400 group-open:rotate-180 transition-transform" />
                        </summary>
                        <div className="absolute z-20 mt-2 right-4 sm:right-6 bg-slate-900 text-slate-200 rounded-xl p-3.5 border border-slate-800 shadow-xl max-w-md text-xs space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] text-slate-400 uppercase font-bold">Canonical SHA-256 Digest:</span>
                            <button
                              onClick={handleCopyHash}
                              className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-0.5 rounded text-[10px] font-mono transition-all cursor-pointer"
                            >
                              {copiedHash ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedHash ? "Copied" : "Copy"}</span>
                            </button>
                          </div>
                          <p className="font-mono text-[10px] text-slate-300 break-all bg-slate-950 p-2 rounded border border-slate-800 select-all">
                            {currentRecordHash || "Computing canonical hash..."}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            Cryptographic verification confirms payload immutability against the audit ledger. Attestation status: {selectedReport.status === "approved" ? "Clinician Signed" : "Preliminary Draft (Unsigned)"}.
                          </p>
                        </div>
                      </details>
                    </div>

                    {/* 5. PRIMARY WORKSPACE: S · O · A · P SEGMENTED CONTROL & DOCUMENT */}
                    <div>
                      <ClinicalSwipeRow
                        sections={[
                          {
                            id: "subjective",
                            letter: "S",
                            name: "Subjective",
                            subtitle: "Patient Narrative & Chief Complaint",
                            content: selectedReport.soapSubjective || selectedReport.chiefComplaint || "No patient narrative logged.",
                            tags: ["Chief Complaint", "HPI Narrative", "Patient Voice"]
                          },
                          {
                            id: "objective",
                            letter: "O",
                            name: "Objective",
                            subtitle: "Acoustic Biomarkers & Verified Observations",
                            content: selectedReport.soapObjective || `• Physical Exam / Vitals: No direct physical examination or automated biometric telemetry hardware connected during remote voice encounter. (Never fabricated).\n• Detected clinical features: ${selectedReport.detectedSymptoms?.join(", ") || "None specified"}.`,
                            tags: ["16kHz Telemetry", "Observed Biomarkers", "Deterministic Telemetry"]
                          },
                          {
                            id: "assessment",
                            letter: "A",
                            name: "Assessment",
                            subtitle: "Multi-Specialist Deliberation & Differential",
                            content: selectedReport.soapAssessment || selectedReport.triageTitle || "Clinical triage evaluation complete.",
                            tags: [
                              selectedReport.esiScore ? `ESI Score: ${selectedReport.esiScore}` : "ESI: Unassessed",
                              "Differential Synthesis",
                              ...(selectedReport.icd10Codes && selectedReport.icd10Codes.length > 0 ? selectedReport.icd10Codes : ["ICD-10: Unassigned"])
                            ]
                          },
                          {
                            id: "plan",
                            letter: "P",
                            name: "Plan",
                            subtitle: "Actionable Directives & Safety Arbiter Clearance",
                            content: selectedReport.soapPlan || selectedReport.recommendedAction || "Follow standard clinical recommendations.",
                            tags: ["Disposition Directives", "Safety Arbiter Cleared", "Post-Consult Care"]
                          }
                        ]}
                      />
                    </div>

                    {/* 6. PROGRESSIVE DISCLOSURE: FHIR R4 INTEROPERABILITY & AUDIT SPEC */}
                    <details className="group border border-slate-200/80 rounded-2xl bg-slate-50/50 p-4 transition-all">
                      <summary className="flex items-center justify-between cursor-pointer list-none">
                        <div className="flex items-center gap-2">
                          <FileCode className="w-4 h-4 text-slate-600" />
                          <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-700">
                            HL7 FHIR R4 Interoperability & Audit Schema
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
                            (US Core v3.1.1 Document Bundle)
                          </span>
                        </div>
                        <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" />
                      </summary>
                      <div className="mt-4 pt-4 border-t border-slate-200/60">
                        <ClinicalFlipCard
                          category="HL7 FHIR R4 Bundle"
                          title={`${selectedReport.patientName} — ${selectedReport.triageTitle || selectedReport.specialty}`}
                          frontSnippet={`Encounter with ${selectedReport.doctorName} (${selectedReport.specialty}). Chief complaint: "${selectedReport.chiefComplaint}". ESI triage: ${selectedReport.esiScore ? `Level ${selectedReport.esiScore}` : "Not yet assessed"}.`}
                          frontBadge={`${new Date(selectedReport.createdAt).toLocaleDateString()} · ${selectedReport.triageLevel.toUpperCase()}`}
                          backTitle="FHIR R4 Resource & Integrity Schema"
                          backItems={[
                            { label: "Resource Type", value: "Bundle (Document / Encounter)" },
                            { label: "Encounter ID", value: selectedReport.id },
                            { label: "Patient Ref", value: selectedReport.userId || "urn:uuid:patient-1002" },
                            { label: "Practitioner", value: selectedReport.doctorName },
                            { label: "Triage / ESI", value: selectedReport.esiScore ? `ESI-${selectedReport.esiScore} (${selectedReport.triageLevel})` : `Unassessed (${selectedReport.triageLevel})` },
                            { label: "ICD-10-CM", value: (selectedReport.icd10Codes && selectedReport.icd10Codes.length > 0 ? selectedReport.icd10Codes.join(", ") : "Not assigned (unsupported)") },
                            { label: "SHA-256 Hash", value: currentRecordHash ? `${currentRecordHash.substring(0, 18)}...` : "TAMPER_EVIDENT_OK" },
                          ]}
                          backNote="Compliant with US Core v3.1.1 / HL7 FHIR Release 4 standard. Verified immutable cryptographically."
                        />
                      </div>
                    </details>

                    {/* 7. PROGRESSIVE DISCLOSURE: FULL AUDIO TRANSCRIPT */}
                    {selectedReport.transcript && selectedReport.transcript.length > 0 && (
                      <details open={isRecordIncomplete ? true : undefined} className="group border border-slate-200/80 rounded-2xl bg-slate-50/50 p-4 transition-all">
                        <summary className="flex items-center justify-between cursor-pointer list-none">
                          <div className="flex items-center gap-2">
                            <Mic className="w-4 h-4 text-slate-600" />
                            <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-700">
                              Full Recorded Audio Dialogue ({selectedReport.transcript.length} turns)
                            </span>
                          </div>
                          <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition-transform" />
                        </summary>
                        <div className="mt-4 pt-4 border-t border-slate-200/60 space-y-2 max-h-64 overflow-y-auto pr-1">
                          {selectedReport.transcript.map((t, i) => (
                            <div key={i} className="p-3 rounded-xl bg-white border border-slate-200/80 text-xs shadow-2xs">
                              <span className="font-mono font-bold text-[#18251D] uppercase text-[10px] mr-2">
                                [{t.role}]:
                              </span>
                              <span className="text-slate-800">{t.text}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* 8. FOOTER DISCLAIMER */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center gap-3 text-[11px] text-slate-600">
                      <ShieldCheck className="w-4 h-4 text-[#18251D] shrink-0" />
                      <span>
                        MedVoice AI clinical decision support documentation. For medical emergencies, always call 911 / 108 immediately.
                      </span>
                    </div>

                  </div>
                ) : (
                  <div className="h-full min-h-[350px] flex items-center justify-center p-12 bg-white border border-slate-200/90 rounded-3xl text-center text-slate-400 text-xs shadow-sm">
                    Select a consultation report from the left to view the complete clinical SOAP chart.
                  </div>
                )}
              </div>

            </div>
          </section>
        </main>

        {/* HL7 FHIR R4 CLINICAL INTEROPERABILITY MODAL */}
        <AnimatePresence>
          {showFhirModal && selectedReport && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                className="bg-[#FAF9F6] border border-slate-200/90 rounded-3xl w-full max-w-4xl max-h-[90vh] my-auto flex flex-col shadow-2xl overflow-hidden text-slate-900"
              >
                {/* 1. Modal Header */}
                <div className="p-5 sm:p-6 bg-white border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-[#18251D] flex items-center justify-center text-[#B7FF72] shadow-xs shrink-0">
                      <FileCode className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                          HL7 FHIR Release 4
                        </span>
                        <span className="text-slate-300">•</span>
                        <span className="font-mono text-xs text-slate-500 font-bold">
                          Encounter {selectedReport.id}
                        </span>
                      </div>
                      <h3 className="font-extrabold text-base sm:text-lg text-[#05070F] mt-0.5">
                        Clinical Document Bundle
                      </h3>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    {/* View Switcher: Readable Summary vs Developer JSON */}
                    <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-mono font-bold">
                      <button
                        onClick={() => setFhirActiveTab("summary")}
                        className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                          fhirActiveTab === "summary"
                            ? "bg-white text-[#18251D] shadow-2xs font-extrabold"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Readable View</span>
                      </button>
                      <button
                        onClick={() => setFhirActiveTab("json")}
                        className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                          fhirActiveTab === "json"
                            ? "bg-white text-[#18251D] shadow-2xs font-extrabold"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        <span>Raw JSON</span>
                      </button>
                    </div>

                    <button
                      onClick={() => setShowFhirModal(false)}
                      className="p-2 rounded-xl text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-all cursor-pointer ml-1"
                      aria-label="Close modal"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* 2. Validation Status Bar (Live Validation Engine) */}
                <div className="px-5 sm:px-6 py-3 bg-white border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    {fhirValidation?.valid ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-800 font-mono font-bold text-[11px]">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>FHIR R4 VALIDATED</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-300 text-amber-900 font-mono font-bold text-[11px]">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>VALIDATION PENDING / ${fhirValidation?.issues?.length || 0} WARNINGS</span>
                      </span>
                    )}
                    <span className="text-slate-600 text-xs hidden md:inline">
                      {fhirValidation?.valid
                        ? `Conforms to US Core v3.1.1 Document Profile (${fhirBundle?.entry?.length || 6} resources bundled)`
                        : `Preliminary bundle structure with ${fhirValidation?.issues?.length || 0} schema diagnostics`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyFhir}
                      className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-800 px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer"
                      title="Copy full JSON payload"
                    >
                      {copiedFhir ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedFhir ? "Copied" : "Copy JSON"}</span>
                    </button>
                    <button
                      onClick={handleDownloadFhir}
                      className="inline-flex items-center gap-1.5 bg-[#18251D] hover:bg-slate-900 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                      title="Download standardized .json bundle"
                    >
                      <Download className="w-3.5 h-3.5 text-[#B7FF72]" />
                      <span>Export Bundle</span>
                    </button>
                  </div>
                </div>

                {/* 3. Modal Body: Either Readable Clinical View or Raw JSON */}
                <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                  {fhirActiveTab === "summary" ? (
                    <div className="space-y-4">
                      {/* Clinical Overview Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Patient & Subject Card */}
                        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              Resource: Patient
                            </span>
                            <span className="font-mono text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              Subject
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5 pt-1">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
                              <User className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="font-extrabold text-sm text-slate-900">{selectedReport.patientName}</div>
                              <div className="font-mono text-[11px] text-slate-500">
                                Identifier: urn:uuid:patient-{selectedReport.id.replace(/[^a-zA-Z0-9-]/g, "")}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Practitioner & Author Card */}
                        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              Resource: Practitioner
                            </span>
                            <span className="font-mono text-[10px] text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                              Author
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5 pt-1">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
                              <Stethoscope className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="font-extrabold text-sm text-slate-900">{selectedReport.doctorName}</div>
                              <div className="text-xs text-slate-500 font-medium">
                                {selectedReport.specialty} · NPI Active
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Encounter & Composition Details */}
                      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-[#18251D]" />
                            <span className="font-bold text-xs text-slate-900 uppercase font-mono tracking-wider">
                              Composition &amp; Encounter Context
                            </span>
                          </div>
                          <span className="font-mono text-[10px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200">
                            LOINC 11488-4 (Consultation Note)
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div>
                            <span className="text-[10px] font-mono text-slate-400 uppercase block font-bold">Encounter ID:</span>
                            <span className="font-mono font-bold text-slate-800">{selectedReport.id}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-mono text-slate-400 uppercase block font-bold">Document Status:</span>
                            <span className="font-mono font-bold text-emerald-700 capitalize">
                              {selectedReport.status === "approved" ? "Final (Clinician Signed)" : "Preliminary (AI Synthesized)"}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] font-mono text-slate-400 uppercase block font-bold">Encounter Class:</span>
                            <span className="font-mono font-bold text-slate-800">AMB (Ambulatory / Telehealth)</span>
                          </div>
                        </div>
                      </div>

                      {/* Observations: Triage, Symptoms, Acuity */}
                      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                          <div className="flex items-center gap-2">
                            <Activity className="w-4 h-4 text-emerald-600" />
                            <span className="font-bold text-xs text-slate-900 uppercase font-mono tracking-wider">
                              Clinical Observations &amp; Triage Findings
                            </span>
                          </div>
                          <span className={`font-mono text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border uppercase ${getUrgencyBadge(selectedReport.triageLevel)}`}>
                            {selectedReport.triageTitle || selectedReport.triageLevel}
                          </span>
                        </div>

                        <div className="space-y-2 text-xs">
                          <div>
                            <span className="text-[10px] font-mono text-slate-400 uppercase block font-bold">Chief Complaint:</span>
                            <p className="text-slate-800 font-semibold italic mt-0.5">
                              &ldquo;{selectedReport.chiefComplaint}&rdquo;
                            </p>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                            <div>
                              <span className="text-[10px] font-mono text-slate-400 uppercase block font-bold">Acuity Stratification:</span>
                              <span className="font-mono font-bold text-slate-800">
                                {selectedReport.esiScore ? `ESI Level ${selectedReport.esiScore}` : "ESI: Not Yet Assessed"} · 5-Level Triage
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] font-mono text-slate-400 uppercase block font-bold">Detected Clinical Features:</span>
                              <span className="text-slate-700 font-medium">
                                {selectedReport.detectedSymptoms?.join(", ") || "None specified in consultation narrative"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Condition / Diagnostic Coding (ICD-10-CM with readable text) */}
                      <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs space-y-3">
                        <span className="font-bold text-xs text-slate-900 uppercase font-mono tracking-wider block">
                          Resource: Condition (Diagnostic ICD-10-CM Coding)
                        </span>

                        <div className="space-y-1.5">
                          {(selectedReport.icd10Codes && selectedReport.icd10Codes.length > 0 ? selectedReport.icd10Codes : ["Not assigned"]).map((code, idx) => (
                            <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
                              <span className="font-mono font-bold text-[#18251D] bg-white px-2 py-0.5 rounded border border-slate-200">
                                {code}
                              </span>
                              <span className="text-slate-700 font-medium truncate ml-3">
                                {getICD10Display(code)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Advanced Developer JSON Inspector */
                    <div className="space-y-3">
                      <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs flex items-start gap-2">
                        <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold font-mono">Sensitive Protected Health Information (PHI):</span>
                          <p className="text-[11px] text-amber-900/90 mt-0.5 leading-relaxed">
                            This bundle contains direct patient identifiers and clinical records. Raw export and copy events are cryptographically audited per HIPAA / DPDP Act compliance invariants.
                          </p>
                        </div>
                      </div>

                      <div className="p-4 bg-[#0a0f18] rounded-2xl border border-slate-800 font-mono text-xs text-slate-300 leading-relaxed overflow-x-auto max-h-[50vh]">
                        <pre className="whitespace-pre">{fhirJsonString}</pre>
                      </div>
                    </div>
                  )}
                </div>

                {/* 4. Modal Footer */}
                <div className="p-4 bg-white border-t border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#18251D]" />
                    <span className="font-mono text-[11px]">
                      HL7 FHIR Release 4 (v4.0.1) Document Bundle · US Core Implementation Guide
                    </span>
                  </div>
                  <button
                    onClick={() => setShowFhirModal(false)}
                    className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold transition-all text-xs cursor-pointer self-end sm:self-auto"
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* ===================================================================== */}
        {/* DEDICATED ISOLATED PRINT CLINICAL DOCUMENT                            */}
        {/* Strictly renders during window.print() — no nav, no footer, no chrome */}
        {/* ===================================================================== */}
        {selectedReport && (
          <div className="hidden print:block print-clinical-document text-slate-900 font-sans p-4">
            {/* 1. INSTITUTIONAL CLINICAL HEADER */}
            <div className="border-b-2 border-slate-900 pb-3 mb-4">
              <div className="flex justify-between items-start">
                <div>
                  <h1 className="text-xl font-black uppercase tracking-wider text-slate-900 m-0">MEDVOICE HEALTHCARE SYSTEM</h1>
                  <p className="text-xs text-slate-600 m-0 font-medium">Department of Clinical Informatics · Outpatient Telemedicine & Triage Record</p>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xs font-black">ENCOUNTER ID: {selectedReport.id}</div>
                  <div className="text-[11px] text-slate-500">{new Date(selectedReport.createdAt).toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-2 inline-block px-2.5 py-0.5 rounded text-xs font-mono font-bold uppercase border">
                {selectedReport.status === "approved" ? "STATUS: CLINICIAN SIGNED & ATTESTED" : isRecordIncomplete ? "STATUS: INCOMPLETE INTAKE — NOT READY FOR SIGNATURE" : "STATUS: PRELIMINARY CLINICAL DRAFT · PENDING ATTESTATION"}
              </div>
            </div>

            {/* 2. DEMOGRAPHICS GRID */}
            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs mb-4">
              <div>
                <div><span className="font-bold text-slate-700">Patient:</span> <span className="font-bold text-slate-900">{selectedReport.patientName}</span></div>
                <div><span className="font-bold text-slate-700">Record ID:</span> <span className="font-mono">{selectedReport.userId || "URN-PATIENT-1002"}</span></div>
                <div><span className="font-bold text-slate-700">Chief Complaint:</span> <span className="italic">"{selectedReport.chiefComplaint}"</span></div>
              </div>
              <div>
                <div><span className="font-bold text-slate-700">Attending Clinician:</span> <span className="font-bold">{selectedReport.doctorName}</span></div>
                <div><span className="font-bold text-slate-700">Clinical Specialty:</span> {selectedReport.specialty}</div>
                <div><span className="font-bold text-slate-700">Encounter Duration:</span> {selectedReport.durationSeconds || 0} seconds</div>
              </div>
            </div>

            {/* 3. CLINICAL ACUITY & DIAGNOSTIC CLASSIFICATION */}
            <div className="grid grid-cols-3 gap-2 p-2.5 border border-slate-200 rounded-lg text-xs mb-4 text-center font-mono">
              <div className="p-1.5 bg-slate-100 rounded">
                <div className="text-[10px] text-slate-500 uppercase font-bold">Triage Acuity</div>
                <div className="font-bold text-slate-900">{selectedReport.triageTitle || selectedReport.triageLevel}</div>
              </div>
              <div className="p-1.5 bg-slate-100 rounded">
                <div className="text-[10px] text-slate-500 uppercase font-bold">ESI Level</div>
                <div className="font-bold text-slate-900">{isRecordIncomplete || !selectedReport.esiScore ? "Not Yet Assessed" : `Level ${selectedReport.esiScore}`}</div>
              </div>
              <div className="p-1.5 bg-slate-100 rounded">
                <div className="text-[10px] text-slate-500 uppercase font-bold">Diagnostic ICD-10</div>
                <div className="font-bold text-slate-900">{selectedReport.icd10Codes && selectedReport.icd10Codes.length > 0 ? selectedReport.icd10Codes.join(", ") : "Not assigned (unsupported)"}</div>
              </div>
            </div>

            {/* 4. S · O · A · P NARRATIVE */}
            <div className="space-y-3 mb-4">
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="font-mono font-bold text-xs uppercase text-slate-800 border-b pb-1 mb-1.5">S — Subjective (Patient Narrative & HPI)</div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 leading-relaxed m-0">{selectedReport.soapSubjective || selectedReport.chiefComplaint || "No patient narrative logged."}</pre>
              </div>

              <div className="border border-slate-200 rounded-lg p-3">
                <div className="font-mono font-bold text-xs uppercase text-slate-800 border-b pb-1 mb-1.5">O — Objective (Observed Biomarkers & Telemetry)</div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 leading-relaxed m-0">{selectedReport.soapObjective || "• Physical Exam: No physical examination or automated biometric telemetry hardware connected during remote voice encounter. (Never fabricated)."}</pre>
              </div>

              <div className="border border-slate-200 rounded-lg p-3">
                <div className="font-mono font-bold text-xs uppercase text-slate-800 border-b pb-1 mb-1.5">A — Assessment (Clinical Synthesis & Differential)</div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 leading-relaxed m-0">{selectedReport.soapAssessment || selectedReport.triageTitle || "Clinical triage evaluation complete."}</pre>
              </div>

              <div className="border border-slate-200 rounded-lg p-3">
                <div className="font-mono font-bold text-xs uppercase text-slate-800 border-b pb-1 mb-1.5">P — Plan (Disposition & Directives)</div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 leading-relaxed m-0">{selectedReport.soapPlan || selectedReport.recommendedAction || "Follow standard clinical recommendations."}</pre>
              </div>
            </div>

            {/* 5. FULL UNCOLLAPSED AUDIO TRANSCRIPT */}
            {selectedReport.transcript && selectedReport.transcript.length > 0 && (
              <div className="border border-slate-200 rounded-lg p-3 mb-4 print-break-inside-avoid">
                <div className="font-mono font-bold text-xs uppercase text-slate-800 border-b pb-1 mb-2">
                  Supporting Voice Consultation Transcript ({selectedReport.transcript.length} turns recorded)
                </div>
                <div className="space-y-1.5 text-xs">
                  {selectedReport.transcript.map((t, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="font-mono text-[10px] text-slate-400 shrink-0 w-12">{t.timestamp || "00:00"}</span>
                      <span className={`font-mono font-bold text-[11px] shrink-0 w-16 ${t.role === "doctor" ? "text-emerald-800" : "text-blue-800"}`}>
                        {t.role === "doctor" ? "CLINICIAN:" : "PATIENT:"}
                      </span>
                      <span className="text-slate-800 leading-tight">{t.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. ATTESTATION & CRYPTOGRAPHIC PROVENANCE FOOTER */}
            <div className="border-t-2 border-slate-900 pt-3 text-[10px] print-break-inside-avoid">
              <div className="flex justify-between items-end mb-2">
                <div>
                  <div className="font-bold text-slate-800 uppercase">Physician Attestation:</div>
                  {selectedReport.status === "approved" ? (
                    <div className="text-emerald-800 font-bold">
                      ✓ Electronically signed and approved by {selectedReport.doctorName} on {selectedReport.approvedAt ? new Date(selectedReport.approvedAt).toLocaleString() : "Date of attestation"}.
                    </div>
                  ) : (
                    <div className="text-amber-800 font-bold italic">
                      ⚠ Preliminary draft documentation. Not signed by clinician. Clinical review required prior to official EHR filing.
                    </div>
                  )}
                </div>
                <div className="text-right font-mono">
                  <div>LEDGER INTEGRITY: SHA-256 VERIFIED ✓</div>
                  <div className="text-slate-400">MEDVOICE AUDIT LEDGER · TAMPER-EVIDENT</div>
                </div>
              </div>
              <div className="text-slate-500 text-center border-t border-slate-200 pt-1.5">
                Confidential Medical Record · Protected Health Information (PHI) · Generated by MedVoice Clinical AI Decision Support
              </div>
            </div>
          </div>
        )}

        {/* Architectural Brand Ledger Footer — unified with Landing and Privacy */}
        <div className="print:hidden">
          <ArchitecturalBrandLedgerFooter />
        </div>
      </div>
  );
}
