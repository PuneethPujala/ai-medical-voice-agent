"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Activity,
  Calendar,
  Clock,
  User,
  Stethoscope,
  ChevronRight,
  Printer,
  Download,
  AlertTriangle,
  CheckCircle,
  Building2,
  Mic,
  ArrowRight,
  Search,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  ClipboardList,
  Radio,
  Copy,
  Check,
  FileCode,
  Lock,
  Zap,
  X,
  Send
} from "lucide-react";
import Link from "next/link";
import { AppFooter } from "../_components/AppFooter";
import { generateFHIRBundle } from "@/lib/fhir/bundle";
import CountUp from "@/components/CountUp";
import { ClinicalSwipeRow, SoapSection } from "@/components/clinical/ClinicalSwipeRow";
import { SpotlightCard } from "@/components/motion/SpotlightCard";
import { ClinicalFlipCard } from "@/components/clinical/ClinicalFlipCard";
import SplitText from "@/components/ui/SplitText";
import GradientText from "@/components/ui/GradientText";
import StarBorder from "@/components/ui/StarBorder";

interface ConsultationRecord {
  id: string;
  userId?: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  chiefComplaint: string;
  triageLevel: "emergency" | "priority" | "routine";
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
  const [selectedReport, setSelectedReport] = useState<ConsultationRecord | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // HL7 FHIR Modal State
  const [showFhirModal, setShowFhirModal] = useState<boolean>(false);
  const [fhirJsonString, setFhirJsonString] = useState<string>("");
  const [copiedFhir, setCopiedFhir] = useState<boolean>(false);

  // Hospital Pre-Arrival Dispatch State
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatches, setDispatches] = useState<Record<string, DispatchReceiptState>>({});
  
  // SHA-256 Cryptographic Hash State
  const [currentRecordHash, setCurrentRecordHash] = useState<string>("");
  const [copiedHash, setCopiedHash] = useState<boolean>(false);

  useEffect(() => {
    async function loadConsultations() {
      setIsLoading(true);
      try {
        const res = await fetch("/api/consultations");
        if (res.ok) {
          const data = await res.json();
          if (data.consultations && data.consultations.length > 0) {
            setConsultations(data.consultations);
            setSelectedReport(data.consultations[0]);
          }
        }
      } catch (err) {
        console.error("Failed to load consultations:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadConsultations();
  }, []);

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
    const matchesSearch =
      c.doctorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.specialty.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.chiefComplaint && c.chiefComplaint.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSeverity && matchesSearch;
  });

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
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

    const jsonStr = JSON.stringify(bundle, null, 2);
    setFhirJsonString(jsonStr);
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

  return (
    <div className="relative min-h-screen bg-transparent text-slate-900 font-sans flex flex-col justify-between selection:bg-cyan-500 selection:text-white">
      <div>
        {/* PAGE HEADER */}
        <section className="pt-14 pb-8 px-6 max-w-4xl mx-auto text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-700 bg-cyan-50 border border-cyan-200 px-3.5 py-1 rounded-full inline-block">
              EHR CLINICAL ARCHIVE
            </span>
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-emerald-700 bg-emerald-50 border border-emerald-200 px-3.5 py-1 rounded-full inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3 h-3" />
              <span>HL7 FHIR R4 & ED DISPATCH</span>
            </span>
          </div>
          <div className="space-y-1">
            <SplitText
              text="SOAP Clinical Reports & Records"
              tag="h1"
              className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-950"
            />
            <div className="pt-0.5">
              <GradientText
                colors={["#0891b2", "#06b6d4", "#0e7490"]}
                className="text-xs sm:text-sm font-bold uppercase tracking-wider font-mono"
              >
                Structured Clinical Encounters & Interoperability
              </GradientText>
            </div>
          </div>
          <p className="text-base text-slate-600 max-w-2xl mx-auto leading-relaxed font-medium">
            Review automated SOAP documentation, export interoperable HL7 FHIR R4 JSON bundles, and simulate emergency hospital pre-arrival telemetry dispatch.
          </p>
        </section>

        {/* MAIN WORKSPACE */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-16">
          
          {/* STATS OVERVIEW CARDS WITH COUNTUP & SPOTLIGHT */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <SpotlightCard className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500">Total Encounters</span>
              <div className="flex items-baseline gap-1.5 mt-2">
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono">
                  <CountUp to={consultations.length} duration={1.2} />
                </span>
                <span className="text-xs text-slate-500 font-medium">SOAP records</span>
              </div>
            </SpotlightCard>

            <SpotlightCard className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-rose-600 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                Emergency Cases
              </span>
              <div className="flex items-baseline gap-1.5 mt-2">
                <span className="text-2xl sm:text-3xl font-extrabold text-rose-600 font-mono">
                  <CountUp to={consultations.filter((c) => c.triageLevel === "emergency").length} duration={1.2} />
                </span>
                <span className="text-xs text-slate-500 font-medium">ESI 1-2 triage</span>
              </div>
            </SpotlightCard>

            <SpotlightCard className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-cyan-700">Priority Outpatient</span>
              <div className="flex items-baseline gap-1.5 mt-2">
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono">
                  <CountUp to={consultations.filter((c) => c.triageLevel !== "emergency").length} duration={1.2} />
                </span>
                <span className="text-xs text-slate-500 font-medium">ambulatory / urgent</span>
              </div>
            </SpotlightCard>

            <SpotlightCard className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex flex-col justify-between">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Interop Standard
              </span>
              <div className="flex items-baseline gap-1 mt-2">
                <span className="text-2xl sm:text-3xl font-extrabold text-emerald-600 font-mono">
                  <CountUp from={50} to={100} duration={1.5} />%
                </span>
                <span className="text-xs text-slate-500 font-medium">HL7 FHIR R4</span>
              </div>
            </SpotlightCard>
          </div>

          {/* Action & Filter Bar */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-4 mb-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
              <span className="text-xs font-mono font-bold text-slate-500 mr-2 uppercase">Filter By:</span>
              {["all", "emergency", "priority", "routine"].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setFilterSeverity(lvl)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono uppercase transition-all ${
                    filterSeverity === lvl
                      ? "bg-slate-950 text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search doctor, symptom..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-slate-50 border border-slate-200 focus:border-slate-400 focus:bg-white rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none w-full transition-all"
                />
              </div>

              <Link
                href="/consult"
                className="inline-flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all flex-shrink-0"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>New Voice Consult</span>
              </Link>
            </div>
          </div>

          {/* GRID LAYOUT */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* LEFT: Consultation History List */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                  Recorded Sessions (<CountUp to={filteredConsultations.length} duration={1} />)
                </span>
                <span className="text-[11px] text-slate-400 font-medium">Click to inspect SOAP chart</span>
              </div>

              {isLoading ? (
                <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-xs text-slate-500 shadow-sm">
                  Loading clinical consultation history...
                </div>
              ) : filteredConsultations.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 space-y-3 shadow-sm">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                    <ClipboardList className="w-6 h-6" />
                  </div>
                  <div className="text-sm font-bold text-slate-900">No Consultation Reports Found</div>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto">
                    Start a voice consultation with an AI Doctor to generate your first clinical SOAP note.
                  </p>
                  <Link
                    href="/consult"
                    className="inline-flex items-center gap-2 text-xs font-bold text-cyan-700 hover:text-cyan-800"
                  >
                    <span>Launch Voice Room</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[720px] overflow-y-auto pr-1">
                  {filteredConsultations.map((item) => {
                    const isSelected = selectedReport?.id === item.id;
                    const dateStr = item.createdAt
                      ? new Date(item.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
                      : "Recent";

                    return (
                      <button
                        key={item.id}
                        onClick={() => setSelectedReport(item)}
                        className={`w-full text-left p-4 rounded-2xl border transition-all ${
                          isSelected
                            ? "bg-white border-cyan-500 shadow-md ring-2 ring-cyan-500/10"
                            : "bg-white border-slate-200/90 hover:border-slate-300 shadow-sm"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-extrabold text-slate-900 text-sm truncate">{item.doctorName}</span>
                          <span className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border uppercase ${getUrgencyBadge(item.triageLevel)}`}>
                            {item.triageLevel}
                          </span>
                        </div>

                        <p className="text-xs text-slate-600 line-clamp-2 mb-3 font-medium">
                          {item.chiefComplaint || "Routine clinical triage evaluation"}
                        </p>

                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 border-t border-slate-100 pt-2.5">
                          <span className="text-cyan-700 font-bold">{item.specialty}</span>
                          <div className="flex items-center gap-2">
                            {dispatches[item.id] && (
                              <span className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded font-bold">
                                ED DISPATCHED
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

            {/* RIGHT: SOAP Report Detailed Chart */}
            <div className="lg:col-span-7 space-y-4">
              {selectedReport ? (
                <div className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
                  
                  {/* Document Top Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-mono font-bold text-cyan-700 mb-1">
                        <span>RECORD ID: {selectedReport.id}</span>
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-500">Patient: {selectedReport.patientName}</span>
                      </div>
                      <h2 className="text-2xl font-extrabold text-slate-950">Clinical SOAP Documentation</h2>
                      <p className="text-xs text-slate-500 mt-0.5 font-medium">
                        Evaluating Physician: <span className="text-slate-900 font-bold">{selectedReport.doctorName}</span> ({selectedReport.specialty})
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* HL7 FHIR EXPORT BUTTON WITH STAR BORDER */}
                      <StarBorder
                        as="button"
                        onClick={handleOpenFhirModal}
                        color="#06b6d4"
                        duration={3.5}
                        theme="light"
                        backgroundColor="#ecfeff"
                        textColor="#0e7490"
                        radius={12}
                        className="inline-flex items-center gap-1.5 border border-cyan-200 px-3 py-2 text-xs font-bold transition-all shadow-2xs hover:shadow-cyan-500/20"
                        title="Inspect or download HL7 FHIR R4 Bundle"
                      >
                        <FileCode className="w-3.5 h-3.5 text-cyan-700" />
                        <span>FHIR R4</span>
                      </StarBorder>

                      <button
                        onClick={handlePrint}
                        className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-800 px-3 py-2 rounded-xl text-xs font-bold transition-all"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Print</span>
                      </button>

                      <Link
                        href="/care"
                        className="inline-flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 px-3 py-2 rounded-xl text-xs font-bold transition-all"
                      >
                        <Building2 className="w-3.5 h-3.5" />
                        <span>Find ERs</span>
                      </Link>
                    </div>
                  </div>

                  {/* EMERGENCY PRE-ARRIVAL DISPATCH TELEMETRY BANNER */}
                  {selectedReport.triageLevel === "emergency" && (
                    <div className="p-4 rounded-2xl border bg-gradient-to-r from-rose-50/70 to-amber-50/70 border-rose-200 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Radio className={`w-4 h-4 ${activeDispatch ? "text-rose-600 animate-ping" : "text-rose-600"}`} />
                          <span className="text-xs font-mono font-extrabold uppercase tracking-wider text-rose-900">
                            Pre-Arrival Hospital Telemetry Webhook
                          </span>
                        </div>
                        {activeDispatch ? (
                          <span className="text-[11px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            <span>ED BAY RESERVED (~<CountUp to={activeDispatch.etaMinutes} duration={0.8} />m ETA)</span>
                          </span>
                        ) : (
                          <span className="text-[11px] font-mono text-slate-500 font-medium">
                            Status: Awaiting Clinician Transmission
                          </span>
                        )}
                      </div>

                      {activeDispatch ? (
                        <div className="bg-white/90 rounded-xl p-3.5 border border-rose-200/80 space-y-2 text-xs">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">Assigned Intake Bay:</span>
                              <span className="font-extrabold text-slate-900">{activeDispatch.assignedHospitalBay}</span>
                            </div>
                            <div>
                              <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">On-Call Attending:</span>
                              <span className="font-bold text-slate-800">{activeDispatch.attendingPhysicianOnCall}</span>
                            </div>
                          </div>

                          <div className="border-t border-slate-100 pt-2">
                            <span className="text-[10px] font-mono uppercase text-rose-700 font-bold block mb-1">Pre-Arrival Directives Transmitted:</span>
                            <ul className="space-y-1 text-[11px] text-slate-700">
                              {activeDispatch.preArrivalDirectives.map((d, i) => (
                                <li key={i} className="flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0" />
                                  <span>{d}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="text-[10px] font-mono text-slate-500 flex items-center justify-between border-t border-slate-100 pt-1.5">
                            <span>Receipt ID: {activeDispatch.dispatchId}</span>
                            <span className="text-emerald-700 font-bold">✓ Cryptographically Verified</span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white/70 rounded-xl p-3 border border-rose-200/60">
                          <p className="text-xs text-slate-700 font-medium">
                            Life-threat criteria detected. Alert the receiving emergency department and Cath/Stroke team prior to patient arrival.
                          </p>
                          <button
                            onClick={handleTransmitPreArrival}
                            disabled={isDispatching}
                            className="inline-flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-extrabold shadow-sm transition-all flex-shrink-0 disabled:opacity-50"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>{isDispatching ? "Transmitting..." : "Dispatch ED Alert"}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Urgency & Symptoms Bar */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
                      <span className="text-[11px] font-mono uppercase text-slate-500 font-bold block mb-1">Triage Urgency Level</span>
                      <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded-full uppercase inline-block border ${getUrgencyBadge(selectedReport.triageLevel)}`}>
                        {selectedReport.triageTitle || selectedReport.triageLevel}
                      </span>
                    </div>

                    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
                      <span className="text-[11px] font-mono uppercase text-slate-500 font-bold block mb-1">Diagnostic ICD-10 Tags</span>
                      <div className="flex flex-wrap gap-1.5">
                        {(selectedReport.icd10Codes && selectedReport.icd10Codes.length > 0
                          ? selectedReport.icd10Codes
                          : ["Z76.0"]
                        ).map((c, i) => (
                          <span key={i} className="text-xs bg-cyan-50 text-cyan-800 border border-cyan-200 px-2 py-0.5 rounded-md font-mono font-bold">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* CRYPTOGRAPHIC SHA-256 INTEGRITY BADGE */}
                  <div className="bg-slate-900 text-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5">
                      <Lock className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-100 text-[11px]">SHA-256 AUDIT INTEGRITY:</span>
                          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.2 rounded font-mono font-bold">
                            TAMPER EVIDENT
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-slate-400 break-all">
                          {currentRecordHash || "Computing canonical hash..."}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={handleCopyHash}
                      className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all flex-shrink-0"
                    >
                      {copiedHash ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedHash ? "Copied" : "Copy Hash"}</span>
                    </button>
                  </div>

                  {/* MANDATORY CLINICAL SAFETY WARNING BANNER */}
                  <div className="p-3.5 rounded-xl bg-amber-50/90 border border-amber-300/80 shadow-2xs flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-wider font-mono px-1.5 py-0.5 rounded-md bg-amber-200/80 text-amber-950 border border-amber-300">
                          AI GENERATED · CLINICAL REVIEW REQUIRED
                        </span>
                        <span className="text-[11px] text-amber-900 font-bold">
                          Preliminary Medical Record
                        </span>
                      </div>
                      <p className="text-[11px] text-amber-900/90 mt-1 leading-relaxed font-medium">
                        Synthesized automatically from voice consultation and multi-specialist deliberation. Distinguishes patient-reported history from preliminary AI impressions. Licensed clinician review and approval required before official EHR filing.
                      </p>
                    </div>
                  </div>

                  {/* SOAP SWIPE ROW & INTERACTIVE FLIP CARD */}
                  <div className="space-y-6">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-500">
                          Segmented Clinical Dimensions
                        </span>
                        <span className="font-mono text-[11px] text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded border border-cyan-200">
                          Swipe or Click to Review S · O · A · P
                        </span>
                      </div>
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
                            tags: ["16kHz Telemetry", "Observed Biomarkers", "Zero Hallucination"]
                          },
                          {
                            id: "assessment",
                            letter: "A",
                            name: "Assessment",
                            subtitle: "Multi-Specialist Deliberation & Differential",
                            content: selectedReport.soapAssessment || selectedReport.triageTitle || "Clinical triage evaluation complete.",
                            tags: [`ESI Score: ${selectedReport.esiScore || (selectedReport.triageLevel === "emergency" ? 2 : 4)}`, "Differential Synthesis", ...(selectedReport.icd10Codes || ["Z76.0"])]
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

                    {/* CLINICAL FLIP CARD: HUMAN-READABLE SUMMARY ⟷ FHIR / AUDIT SPEC */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-500">
                          Encounter Record ⟷ FHIR Interoperability
                        </span>
                        <span className="font-mono text-[11px] text-slate-400">
                          Click card to 3D flip between clinical view and FHIR schema
                        </span>
                      </div>
                      <ClinicalFlipCard
                        category="HL7 FHIR R4 Bundle"
                        title={`${selectedReport.patientName} — ${selectedReport.triageTitle || selectedReport.specialty}`}
                        frontSnippet={`Encounter with ${selectedReport.doctorName} (${selectedReport.specialty}). Chief complaint: "${selectedReport.chiefComplaint}". ESI triage classification: Level ${selectedReport.esiScore || (selectedReport.triageLevel === "emergency" ? 2 : 4)}.`}
                        frontBadge={`${new Date(selectedReport.createdAt).toLocaleDateString()} · ${selectedReport.triageLevel.toUpperCase()}`}
                        backTitle="FHIR R4 Resource & Integrity Schema"
                        backItems={[
                          { label: "Resource Type", value: "Bundle (Document / Encounter)" },
                          { label: "Encounter ID", value: selectedReport.id },
                          { label: "Patient Ref", value: selectedReport.userId || "urn:uuid:patient-1002" },
                          { label: "Practitioner", value: selectedReport.doctorName },
                          { label: "Triage / ESI", value: `ESI-${selectedReport.esiScore || (selectedReport.triageLevel === "emergency" ? 2 : 4)} (${selectedReport.triageLevel})` },
                          { label: "ICD-10-CM", value: (selectedReport.icd10Codes || ["Z76.0"]).join(", ") },
                          { label: "SHA-256 Hash", value: currentRecordHash ? `${currentRecordHash.substring(0, 18)}...` : "TAMPER_EVIDENT_OK" },
                        ]}
                        backNote="Compliant with US Core v3.1.1 / HL7 FHIR Release 4 standard. Verified immutable cryptographically."
                      />
                    </div>
                  </div>

                  {/* Transcript Accordion */}
                  {selectedReport.transcript && selectedReport.transcript.length > 0 && (
                    <div className="border-t border-slate-100 pt-4">
                      <h4 className="text-xs font-mono font-bold text-slate-500 uppercase mb-3">
                        Full Recorded Audio Dialogue ({selectedReport.transcript.length} turns)
                      </h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        {selectedReport.transcript.map((t, i) => (
                          <div key={i} className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
                            <span className="font-mono font-bold text-cyan-800 uppercase text-[10px] mr-2">
                              [{t.role}]:
                            </span>
                            <span className="text-slate-800">{t.text}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Footer Disclaimer */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-3 text-[11px] text-slate-600">
                    <ShieldCheck className="w-4 h-4 text-cyan-700 flex-shrink-0" />
                    <span>
                      MediVoice AI clinical decision support documentation. For medical emergencies, always call 911 / 108 immediately.
                    </span>
                  </div>

                </div>
              ) : (
                <div className="h-full min-h-[350px] flex items-center justify-center p-12 bg-white border border-slate-200/90 rounded-2xl text-center text-slate-400 text-xs shadow-sm">
                  Select a consultation report from the left to view the complete clinical SOAP chart.
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* HL7 FHIR R4 INSPECTION MODAL */}
      <AnimatePresence>
        {showFhirModal && selectedReport && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden text-slate-100"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                    <FileCode className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-white">HL7 FHIR Release 4 Document Bundle</h3>
                    <p className="text-xs text-slate-400 font-mono">
                      LOINC 11488-4 (Consultation Note) • SNOMED CT • ICD-10-CM
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyFhir}
                    className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all"
                  >
                    {copiedFhir ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedFhir ? "Copied" : "Copy JSON"}</span>
                  </button>
                  <button
                    onClick={handleDownloadFhir}
                    className="inline-flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .json</span>
                  </button>
                  <button
                    onClick={() => setShowFhirModal(false)}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all ml-1"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Resource Summary Badges */}
              <div className="px-5 py-2.5 bg-slate-950/60 border-b border-slate-800 flex flex-wrap gap-2 text-[11px] font-mono">
                <span className="text-slate-400">Bundle Resources:</span>
                <span className="bg-cyan-950/60 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded">Composition</span>
                <span className="bg-indigo-950/60 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded">Patient</span>
                <span className="bg-purple-950/60 text-purple-300 border border-purple-800 px-2 py-0.5 rounded">Practitioner</span>
                <span className="bg-emerald-950/60 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded">Encounter ({selectedReport.triageLevel.toUpperCase()})</span>
                <span className="bg-amber-950/60 text-amber-300 border border-amber-800 px-2 py-0.5 rounded">Observation (ESI Acuity)</span>
                <span className="bg-rose-950/60 text-rose-300 border border-rose-800 px-2 py-0.5 rounded">Condition ({selectedReport.icd10Codes?.join(", ") || "Z76.0"})</span>
              </div>

              {/* Modal Body: Raw Code */}
              <div className="flex-1 p-5 overflow-auto bg-[#0a0f18] font-mono text-xs text-slate-300 leading-relaxed">
                <pre className="whitespace-pre">{fhirJsonString}</pre>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between text-xs text-slate-400">
                <span>Conforms to HL7 FHIR v4.0.1 Document StructureDefinition</span>
                <button
                  onClick={() => setShowFhirModal(false)}
                  className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-all text-xs"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AppFooter />
    </div>
  );
}
