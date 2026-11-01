"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  Calendar,
  Stethoscope,
  FileText,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCcw,
  Plus,
  Search,
  Filter,
  ArrowRight,
  ShieldCheck,
  ChevronRight,
  User,
  HeartPulse,
  Activity,
  Layers,
  Sparkles,
  ExternalLink,
  MessageSquare,
  Lock,
  PauseCircle,
  X,
  FileCheck,
} from "lucide-react";

import { LandingFloatingNavbar } from "../_components/LandingFloatingNavbar";
import { ArchitecturalBrandLedgerFooter } from "../_components/ArchitecturalBrandLedgerFooter";
import { SoapReportModal } from "../_components/SoapReportModal";
import { DOCTOR_PROFILES, getDoctorById } from "@/config/doctors";
import { TimelineGroup, groupConsultationsByPeriod } from "./_components/TimelineGroup";
import { PaginationControls } from "./_components/PaginationControls";
import { LongitudinalSidebar } from "./_components/LongitudinalSidebar";

export interface ConsultationItem {
  id: string;
  userId?: string;
  patientName: string;
  patientAge?: string;
  patientGender?: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  chiefComplaint?: string;
  triageLevel?: "emergency" | "priority" | "routine" | "gathering_history";
  triageTitle?: string;
  esiScore?: number;
  icd10Codes?: string[];
  detectedSymptoms?: string[];
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
  recommendedAction?: string;
  durationSeconds?: number;
  status: "in_progress" | "paused" | "incomplete_intake" | "completed_pending_review" | "approved" | "cancelled" | "abandoned";
  approvedAt?: string;
  approvedBy?: string;
  createdAt: string;
  transcript?: Array<{ role: "patient" | "doctor" | "system"; text: string; timestamp: string }>;
  interviewState?: any;
}

type FilterTab = "all" | "resumable" | "completed" | "approved";

export default function ConsultationHistoryPage() {
  const router = useRouter();
  const { user, isLoaded, isSignedIn } = useUser();

  const [consultations, setConsultations] = useState<ConsultationItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");

  // Selected consultation for transcript inspection or SOAP viewing
  const [selectedConsultationForSoap, setSelectedConsultationForSoap] = useState<ConsultationItem | null>(null);
  const [inspectingTranscript, setInspectingTranscript] = useState<ConsultationItem | null>(null);

  // Fetch consultations (initial page or query change)
  const fetchConsultations = useCallback(
    async (cursor?: string | null, append: boolean = false) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setFetchError(null);
      }

      try {
        const params = new URLSearchParams();
        params.set("limit", "20");
        if (activeTab !== "all") {
          params.set("statusTab", activeTab);
        }
        if (searchQuery.trim()) {
          params.set("search", searchQuery.trim());
        }
        if (cursor) {
          params.set("cursor", cursor);
        }

        const res = await fetch(`/api/consultations?${params.toString()}`);

        if (res.ok) {
          const data = await res.json();
          const items: ConsultationItem[] = data.consultations || [];
          setConsultations((prev) => (append ? [...prev, ...items] : items));
          setNextCursor(data.nextCursor || null);
          setHasMore(Boolean(data.hasMore));
        } else if (res.status === 401) {
          // Unauthenticated fallback to synthetic demo
          const demoRes = await fetch("/api/consultations?dataset=synthetic_demo");
          if (demoRes.ok) {
            const demoData = await demoRes.json();
            setConsultations(demoData.consultations || []);
            setNextCursor(null);
            setHasMore(false);
          } else {
            setFetchError("Please sign in to view your consultation history.");
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          setFetchError(errData.error || "Failed to load consultation records.");
        }
      } catch (err: any) {
        setFetchError(err?.message || "Network error loading consultations.");
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [activeTab, searchQuery]
  );

  // Initial load and filter change trigger
  useEffect(() => {
    const handler = setTimeout(() => {
      fetchConsultations(null, false);
    }, 200);

    return () => clearTimeout(handler);
  }, [fetchConsultations]);

  // Load more trigger
  const handleLoadMore = useCallback(() => {
    if (!nextCursor || isLoadingMore) return;
    fetchConsultations(nextCursor, true);
  }, [nextCursor, isLoadingMore, fetchConsultations]);

  // Greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  const patientName = useMemo(() => {
    return user?.firstName || user?.fullName?.split(" ")[0] || "there";
  }, [user]);

  // Separate resumable / paused consultations from completed ones
  const pausedConsultations = useMemo(() => {
    return consultations.filter(
      (c) =>
        c.status === "paused" ||
        c.status === "in_progress" ||
        c.status === "incomplete_intake"
    );
  }, [consultations]);

  // Most prominent unfinished consultation (most recently touched)
  const primaryPausedConsultation = pausedConsultations[0] || null;

  // Filter and search logic (client safety filter)
  const filteredConsultations = useMemo(() => {
    return consultations.filter((c) => {
      if (activeTab === "resumable") {
        if (c.status !== "paused" && c.status !== "in_progress" && c.status !== "incomplete_intake") {
          return false;
        }
      } else if (activeTab === "completed") {
        if (c.status !== "completed_pending_review") {
          return false;
        }
      } else if (activeTab === "approved") {
        if (c.status !== "approved") {
          return false;
        }
      }
      return true;
    });
  }, [consultations, activeTab]);

  const groupedTimeline = useMemo(() => {
    return groupConsultationsByPeriod(filteredConsultations);
  }, [filteredConsultations]);

  // Helper: Format date
  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  // Helper: Format relative timestamp
  const formatTimeRelative = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

      if (diffHrs < 1) return "Just now";
      if (diffHrs < 24 && d.getDate() === now.getDate()) return `Today · ${timeStr}`;
      if (diffDays === 1) return `Yesterday · ${timeStr}`;
      return `${formatDate(dateStr)} · ${timeStr}`;
    } catch {
      return dateStr;
    }
  };

  // Helper: Get SOAP document status label and badge
  const getSoapStatusMeta = (item: ConsultationItem) => {
    if (item.status === "approved") {
      return {
        label: "Signed · Clinician Approved",
        colorClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
        badge: "Signed",
        hasReport: true,
      };
    }
    if (item.status === "completed_pending_review") {
      return {
        label: "SOAP Draft Available · Pending Review",
        colorClass: "bg-slate-50 text-slate-700 border-slate-200",
        badge: "Draft Available",
        hasReport: true,
      };
    }
    return {
      label: "No SOAP report yet",
      colorClass: "bg-slate-50 text-slate-600 border-slate-200",
      badge: "Not Generated",
      hasReport: false,
    };
  };

  // Helper: Get consultation lifecycle status
  const getConsultationStatusMeta = (status: ConsultationItem["status"]) => {
    switch (status) {
      case "in_progress":
        return {
          label: "In Progress",
          badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
          icon: Activity,
        };
      case "paused":
      case "incomplete_intake":
        return {
          label: "Paused",
          badgeClass: "bg-slate-100 text-slate-800 border-slate-200",
          icon: PauseCircle,
        };
      case "completed_pending_review":
        return {
          label: "Intake Completed",
          badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
          icon: CheckCircle2,
        };
      case "approved":
        return {
          label: "Physician Signed",
          badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200",
          icon: FileCheck,
        };
      default:
        return {
          label: "Archived",
          badgeClass: "bg-slate-50 text-slate-700 border-slate-200",
          icon: Clock,
        };
    }
  };

  const renderConsultationCard = (item: ConsultationItem) => {
    const isResumable =
      item.status === "paused" ||
      item.status === "in_progress" ||
      item.status === "incomplete_intake";

    const consultMeta = getConsultationStatusMeta(item.status);
    const soapMeta = getSoapStatusMeta(item);
    const turnsCount = item.transcript?.length || 0;
    const docProfile = getDoctorById(item.doctorId);

    return (
      <div
        key={item.id}
        className="group rounded-2xl bg-white border border-slate-200/90 hover:border-slate-300 p-5 sm:p-6 transition-all hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.06)]"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Left: Metadata & Clinical Summary */}
          <div className="flex-1 min-w-0">
            {/* Badges strip */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${consultMeta.badgeClass}`}
              >
                <consultMeta.icon className="w-3 h-3" />
                {consultMeta.label}
              </span>

              <span
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${soapMeta.colorClass}`}
              >
                <FileText className="w-3 h-3" />
                {soapMeta.label}
              </span>

              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-500 font-medium">
                {formatTimeRelative(item.createdAt)}
              </span>
            </div>

            {/* Title / Chief Complaint */}
            <h3 className="text-base sm:text-lg font-bold text-slate-950 tracking-tight truncate mb-1">
              {item.chiefComplaint || "Routine Health Intake"}
            </h3>

            {/* Narrative description */}
            <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 mb-3">
              {item.soapSubjective
                ? item.soapSubjective
                : isResumable
                ? "Consultation intake paused before completion. All reported symptoms and conversation turns preserved."
                : "Clinical symptoms collected and evaluated."}
            </p>

            {/* Clinician and Turns footer */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                {docProfile?.avatarUrl ? (
                  <img
                    src={docProfile.avatarUrl}
                    alt={item.doctorName}
                    className="w-5 h-5 rounded-full object-cover border border-slate-200"
                  />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center">
                    {item.doctorName.charAt(3) || "D"}
                  </div>
                )}
                <span className="font-semibold text-slate-800">{item.doctorName}</span>
                <span className="text-slate-400">·</span>
                <span>{item.specialty}</span>
              </div>

              <span className="text-slate-300">|</span>

              <div className="flex items-center gap-1">
                <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                <span>{turnsCount} turns</span>
              </div>

              {item.durationSeconds ? (
                <>
                  <span className="text-slate-300">|</span>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{Math.round(item.durationSeconds / 60)} min</span>
                  </div>
                </>
              ) : null}

              <span className="text-slate-300">|</span>
              <span className="font-mono text-[11px] text-slate-400">{item.id}</span>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center pt-2 md:pt-0">
            {isResumable ? (
              <Link
                href={`/consult/${item.id}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#18251D] hover:bg-black text-white transition-all shadow-xs cursor-pointer group"
              >
                <span>Resume</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#B7FF72] group-hover:translate-x-0.5 transition-transform" />
              </Link>
            ) : null}

            <button
              onClick={() => setInspectingTranscript(item)}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200/80 text-slate-700 transition-all cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
              <span>View Dialogue</span>
            </button>

            {soapMeta.hasReport && (
              <button
                onClick={() => setSelectedConsultationForSoap(item)}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white transition-all cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                <span>SOAP Report</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50/60 text-slate-900 flex flex-col font-sans selection:bg-emerald-100 selection:text-emerald-900">
      <LandingFloatingNavbar />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-20">
        {/* ============================================================ HEADER AREA */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10 pb-8 border-b border-slate-200/80">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Patient Health Records
              </span>
              <span className="text-xs text-slate-400 font-mono">· Encrypted & Confidential</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-950">
              {greeting}, {patientName}
            </h1>
            <p className="text-base text-slate-600 mt-1 max-w-2xl">
              Your health conversations and care history, all in one place. Resume active intakes or review certified SOAP documentation.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/consult"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs sm:text-sm font-bold bg-slate-950 text-white hover:bg-slate-800 transition-all shadow-md hover:shadow-lg cursor-pointer group"
            >
              <Plus className="w-4 h-4 text-emerald-400 group-hover:rotate-90 transition-transform" />
              <span>Start New Consultation</span>
            </Link>
          </div>
        </div>

        {/* ============================================================ HERO: PAUSED CONSULTATION BANNER */}
        {primaryPausedConsultation && (
          <section aria-labelledby="paused-consultation-heading" className="mb-12">
            <div className="relative overflow-hidden rounded-3xl bg-[#FAF9F6] border border-slate-200/90 p-6 sm:p-8 shadow-[0_8px_30px_-6px_rgba(0,0,0,0.06)]">
              <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 rounded-full bg-emerald-100/20 blur-3xl pointer-events-none" />

              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2.5 mb-3">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-800 border border-slate-200 shadow-2xs">
                      <PauseCircle className="w-3.5 h-3.5 text-slate-700" />
                      Paused Intake
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      Last saved {formatTimeRelative(primaryPausedConsultation.createdAt)}
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs font-mono font-medium text-slate-500">
                      ID: {primaryPausedConsultation.id}
                    </span>
                  </div>

                  <h2 id="paused-consultation-heading" className="text-xl sm:text-2xl font-bold text-slate-950 tracking-tight mb-2">
                    {primaryPausedConsultation.chiefComplaint || "Initial Symptom Discussion"}
                  </h2>

                  <p className="text-sm text-slate-600 max-w-2xl leading-relaxed mb-4">
                    You started sharing your symptoms with{" "}
                    <span className="font-semibold text-slate-900">{primaryPausedConsultation.doctorName}</span>, and
                    MedVoice was gathering your clinical history when you left. Everything you shared has been securely preserved.
                  </p>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <div className="flex items-center gap-1.5 bg-white/80 px-2.5 py-1 rounded-lg border border-slate-200/60">
                      <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                      <span>{primaryPausedConsultation.transcript?.length || 0} conversation turns saved</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-white/80 px-2.5 py-1 rounded-lg border border-slate-200/60">
                      <Stethoscope className="w-3.5 h-3.5 text-slate-400" />
                      <span>{primaryPausedConsultation.specialty}</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-white/80 px-2.5 py-1 rounded-lg border border-slate-200/60">
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      <span>No SOAP report yet (Preserving intake)</span>
                    </div>
                  </div>
                </div>

                {/* Resume Actions */}
                <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0 lg:min-w-[200px]">
                  <Link
                    href={`/consult/${primaryPausedConsultation.id}`}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-xs sm:text-sm font-bold bg-[#18251D] hover:bg-black text-white transition-all shadow-md hover:shadow-lg cursor-pointer group"
                  >
                    <span>Resume Consultation</span>
                    <ArrowRight className="w-4 h-4 text-[#B7FF72] group-hover:translate-x-1 transition-transform" />
                  </Link>

                  <Link
                    href="/consult"
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/90 transition-all cursor-pointer"
                  >
                    <span>Start a separate consultation</span>
                  </Link>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ============================================================ 2-COLUMN RESPONSIVE LAYOUT */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Main Column: Timeline & Consultation Records */}
          <section aria-labelledby="consultations-history-heading" className="lg:col-span-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 id="consultations-history-heading" className="text-xl font-bold tracking-tight text-slate-950">
                  Recent Consultations
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                  Browse through all clinical interactions, preliminary drafts, and approved records.
                </p>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200/70 overflow-x-auto self-start sm:self-auto">
                <button
                  onClick={() => setActiveTab("all")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === "all"
                      ? "bg-white text-slate-950 shadow-xs"
                      : "text-slate-600 hover:text-slate-950"
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setActiveTab("resumable")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === "resumable"
                      ? "bg-white text-slate-950 shadow-xs"
                      : "text-slate-600 hover:text-slate-950"
                  }`}
                >
                  Resumable
                </button>
                <button
                  onClick={() => setActiveTab("completed")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === "completed"
                      ? "bg-white text-indigo-700 shadow-xs"
                      : "text-slate-600 hover:text-slate-950"
                  }`}
                >
                  Completed
                </button>
                <button
                  onClick={() => setActiveTab("approved")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === "approved"
                      ? "bg-white text-emerald-700 shadow-xs"
                      : "text-slate-600 hover:text-slate-950"
                  }`}
                >
                  Signed
                </button>
              </div>
            </div>

            {/* Search Bar */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by symptom, chief complaint, doctor or specialty..."
                className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white border border-slate-200/90 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-900 transition-all shadow-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  Clear
                </button>
              )}
            </div>

            {/* List Content */}
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-20 rounded-3xl bg-white border border-slate-200/80">
                <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm font-semibold text-slate-700">Loading consultation records...</p>
                <p className="text-xs text-slate-400 mt-1">Verifying cryptographic ledger integrity</p>
              </div>
            ) : fetchError ? (
              <div className="flex flex-col items-center justify-center py-16 rounded-3xl bg-rose-50/50 border border-rose-200 p-6 text-center">
                <AlertCircle className="w-8 h-8 text-rose-600 mb-2" />
                <p className="text-sm font-bold text-rose-900">{fetchError}</p>
                <p className="text-xs text-rose-600 mt-1 mb-4">Please ensure you are authenticated or try again.</p>
                <button
                  onClick={() => fetchConsultations(null, false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 transition-all cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : filteredConsultations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 rounded-3xl bg-white border border-dashed border-slate-300 p-8 text-center">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
                  <Clock className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-1">No consultations found</h3>
                <p className="text-xs sm:text-sm text-slate-500 max-w-md mb-6">
                  {searchQuery
                    ? "No consultations matched your search criteria. Try a different query or reset filters."
                    : "You haven't conducted any consultations yet. Start your first clinical intake with MedVoice."}
                </p>
                <Link
                  href="/consult"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold bg-slate-950 text-white hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-emerald-400" />
                  <span>Start Consultation Now</span>
                </Link>
              </div>
            ) : (
              <div>
                <TimelineGroup
                  title="Today"
                  count={groupedTimeline.today.length}
                  period="today"
                >
                  {groupedTimeline.today.map(renderConsultationCard)}
                </TimelineGroup>

                <TimelineGroup
                  title="Yesterday"
                  count={groupedTimeline.yesterday.length}
                  period="yesterday"
                >
                  {groupedTimeline.yesterday.map(renderConsultationCard)}
                </TimelineGroup>

                <TimelineGroup
                  title="This Week"
                  count={groupedTimeline.this_week.length}
                  period="this_week"
                >
                  {groupedTimeline.this_week.map(renderConsultationCard)}
                </TimelineGroup>

                <TimelineGroup
                  title="Earlier"
                  count={groupedTimeline.earlier.length}
                  period="earlier"
                >
                  {groupedTimeline.earlier.map(renderConsultationCard)}
                </TimelineGroup>

                {/* Keyset Pagination Controls */}
                <PaginationControls
                  hasMore={hasMore}
                  isLoadingMore={isLoadingMore}
                  onLoadMore={handleLoadMore}
                  totalLoaded={consultations.length}
                />
              </div>
            )}
          </section>

          {/* Sidebar Column: Longitudinal Clinical Context */}
          <div className="lg:col-span-4 sticky top-28">
            <LongitudinalSidebar />
          </div>
        </div>
      </main>

      {/* ============================================================ DIALOGUE INSPECTOR DRAWER / MODAL */}
      <AnimatePresence>
        {inspectingTranscript && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setInspectingTranscript(null)}
              className="absolute inset-0"
            />

            <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden z-10 max-h-[85vh] flex flex-col">
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center">
                    <MessageSquare className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-950">
                      Encounter Dialogue Transcript
                    </h3>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {inspectingTranscript.id} · {inspectingTranscript.doctorName}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setInspectingTranscript(null)}
                  className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Turns Scroll Area */}
              <div className="p-6 overflow-y-auto space-y-4 flex-1">
                {inspectingTranscript.transcript && inspectingTranscript.transcript.length > 0 ? (
                  inspectingTranscript.transcript.map((msg, idx) => {
                    const isDoctor = msg.role === "doctor";
                    return (
                      <div
                        key={idx}
                        className={`flex flex-col ${isDoctor ? "items-start" : "items-end"}`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 px-1">
                          <span className="text-[11px] font-bold text-slate-600">
                            {isDoctor ? inspectingTranscript.doctorName : "You (Patient)"}
                          </span>
                          <span className="text-[10px] text-slate-400">{msg.timestamp}</span>
                        </div>
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed ${
                            isDoctor
                              ? "bg-slate-100 text-slate-900 border border-slate-200/80 rounded-tl-xs"
                              : "bg-slate-950 text-white rounded-tr-xs"
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-400 text-center py-8">
                    No conversation turns recorded for this consultation.
                  </p>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {inspectingTranscript.transcript?.length || 0} turns recorded
                </span>
                <div className="flex items-center gap-2">
                  {(inspectingTranscript.status === "paused" ||
                    inspectingTranscript.status === "incomplete_intake" ||
                    inspectingTranscript.status === "in_progress") && (
                    <Link
                      href={`/consult/${inspectingTranscript.id}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#18251D] hover:bg-black text-white transition-all shadow-xs"
                    >
                      <span>Resume Now</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#B7FF72]" />
                    </Link>
                  )}
                  <button
                    onClick={() => setInspectingTranscript(null)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* ============================================================ SOAP REPORT MODAL */}
      {selectedConsultationForSoap && (
        <SoapReportModal
          isOpen={Boolean(selectedConsultationForSoap)}
          onClose={() => setSelectedConsultationForSoap(null)}
          encounter={{
            id: selectedConsultationForSoap.id,
            patientName: selectedConsultationForSoap.patientName || "Anonymous Patient",
            patientAge: selectedConsultationForSoap.patientAge,
            patientGender: selectedConsultationForSoap.patientGender,
            doctorId: selectedConsultationForSoap.doctorId,
            doctorName: selectedConsultationForSoap.doctorName,
            specialty: selectedConsultationForSoap.specialty,
            callDuration: selectedConsultationForSoap.durationSeconds || 0,
            transcript: selectedConsultationForSoap.transcript || [],
            triageLevel: selectedConsultationForSoap.triageLevel || "routine",
            triageTitle: selectedConsultationForSoap.triageTitle || "CLINICAL EVALUATION",
            esiScore: selectedConsultationForSoap.esiScore,
            detectedSymptoms: selectedConsultationForSoap.detectedSymptoms || [],
            icdCodes: selectedConsultationForSoap.icd10Codes || [],
            recommendedAction: selectedConsultationForSoap.recommendedAction || "",
            soap: {
              subjective: selectedConsultationForSoap.soapSubjective || "",
              objective: selectedConsultationForSoap.soapObjective || "",
              assessment: selectedConsultationForSoap.soapAssessment || "",
              plan: selectedConsultationForSoap.soapPlan || "",
            },
            userId: selectedConsultationForSoap.userId,
          }}
        />
      )}

      <ArchitecturalBrandLedgerFooter />
    </div>
  );
}
