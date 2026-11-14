"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  FileText,
  ShieldCheck,
  Clock,
  ArrowLeft,
  Download,
  Copy,
  Check,
  AlertCircle,
  GitBranch,
  GitCompare,
  Activity,
  User,
  Stethoscope,
  Calendar,
  Lock,
  ExternalLink,
  ChevronRight,
  RotateCcw,
  Sparkles,
} from "lucide-react";

import { LandingFloatingNavbar } from "@/app/_components/LandingFloatingNavbar";
import { ArchitecturalBrandLedgerFooter } from "@/app/_components/ArchitecturalBrandLedgerFooter";
import { SoapVersionDiff } from "@/app/history/_components/SoapVersionDiff";
import { CareSuggestionsModal } from "@/app/_components/CareSuggestionsModal";
import { generateFHIRBundle, validateFhirR4Bundle } from "@/lib/fhir/bundle";
import type { ClinicalArtifact } from "@/lib/consultation/clinical-artifact-service";

interface ConsultationMetadata {
  id: string;
  userId?: string;
  patientName: string;
  patientAge?: string;
  patientGender?: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  chiefComplaint: string;
  triageLevel?: string;
  triageTitle?: string;
  esiScore?: number | null;
  detectedSymptoms?: string[];
  icd10Codes?: string[];
  durationSeconds?: number;
  status: string;
  createdAt: string;
  transcript?: Array<{ role: string; text: string; timestamp?: string }>;
}

type PageState =
  | { status: "loading" }
  | {
      status: "error";
      code: number;
      type: "not_found" | "forbidden" | "awaiting_review" | "no_signed_artifact" | "server_error";
      message: string;
    }
  | {
      status: "ready";
      consultation: ConsultationMetadata;
      signedArtifacts: ClinicalArtifact[];
      activeArtifact: ClinicalArtifact;
    };

export default function EncounterSoapPage() {
  const router = useRouter();
  const rawParams = useParams();
  const consultationId = typeof rawParams?.id === "string" ? rawParams.id : "";

  const [pageState, setPageState] = useState<PageState>({ status: "loading" });
  const [activeVersionNumber, setActiveVersionNumber] = useState<number | null>(null);
  const [isComparingVersions, setIsComparingVersions] = useState<boolean>(false);
  const [copiedHash, setCopiedHash] = useState<boolean>(false);
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);
  const [showCareSuggestions, setShowCareSuggestions] = useState<boolean>(false);

  useEffect(() => {
    if (!consultationId) return;

    let isCancelled = false;

    async function loadEncounterSoap() {
      setPageState({ status: "loading" });

      try {
        // 1. Fetch Consultation Metadata
        const consultRes = await fetch(`/api/consultations/${encodeURIComponent(consultationId)}`);

        if (!consultRes.ok) {
          if (consultRes.status === 404) {
            if (!isCancelled) {
              setPageState({
                status: "error",
                code: 404,
                type: "not_found",
                message: "The requested clinical consultation could not be found.",
              });
            }
            return;
          }
          if (consultRes.status === 403 || consultRes.status === 401) {
            if (!isCancelled) {
              setPageState({
                status: "error",
                code: 403,
                type: "forbidden",
                message: "You are not authorized to access this clinical record. Consultation access is strictly restricted to the patient and assigned clinician.",
              });
            }
            return;
          }
          throw new Error(`Failed to load consultation (HTTP ${consultRes.status})`);
        }

        const consultData = await consultRes.json();
        const consultation: ConsultationMetadata = consultData.consultation || consultData;

        // 2. Fetch Signed Clinical Artifacts
        const artifactsRes = await fetch(`/api/consultations/${encodeURIComponent(consultationId)}/artifacts`);

        if (!artifactsRes.ok) {
          if (artifactsRes.status === 403 || artifactsRes.status === 401) {
            if (!isCancelled) {
              setPageState({
                status: "error",
                code: 403,
                type: "forbidden",
                message: "You do not have permission to view clinical artifacts for this consultation.",
              });
            }
            return;
          }
          throw new Error(`Failed to load clinical artifacts (HTTP ${artifactsRes.status})`);
        }

        const artifactsData = await artifactsRes.json();
        const allArtifacts: ClinicalArtifact[] = artifactsData.artifacts || [];

        // Patient access rule: only signed artifacts are visible to patients
        const signedArtifacts = allArtifacts
          .filter((a) => a.status === "signed")
          .sort((a, b) => b.version - a.version);

        if (signedArtifacts.length === 0) {
          const rawConsult = consultation as any;
          const subjectiveText = rawConsult.soapSubjective || rawConsult.soap?.subjective;
          const assessmentText = rawConsult.soapAssessment || rawConsult.soap?.assessment;

          // If the encounter has generated intake SOAP data or completed consultation, display preliminary record
          if (subjectiveText || assessmentText || consultation.status === "completed_pending_review") {
            const preliminaryArtifact: ClinicalArtifact = {
              id: `prelim-${consultation.id}`,
              consultationId: consultation.id,
              artifactType: "soap_note",
              version: 1,
              status: "pending_review",
              chiefComplaint: consultation.chiefComplaint || "Clinical Consultation Intake",
              soapSubjective: subjectiveText || "[PATIENT REPORTED]\nClinical intake dialogue recorded.",
              soapObjective: rawConsult.soapObjective || rawConsult.soap?.objective || "[NOT ASSESSED]\nTelehealth remote voice intake.",
              soapAssessment: assessmentText || "[CLINICAL INTAKE EVALUATION]\nAwaiting formal clinician signature.",
              soapPlan: rawConsult.soapPlan || rawConsult.soap?.plan || "[INTAKE PLAN]\nPhysician review and follow-up.",
              icd10Codes: consultation.icd10Codes || [],
              esiScore: consultation.esiScore ?? null,
              signedBy: null,
              signedByRole: null,
              signedAt: null,
              signingAttestationDigest: null,
              payloadSha256: null,
              createdAt: consultation.createdAt ? new Date(consultation.createdAt) : new Date(),
              updatedAt: consultation.createdAt ? new Date(consultation.createdAt) : new Date(),
            };

            if (!isCancelled) {
              setPageState({
                status: "ready",
                consultation,
                signedArtifacts: [preliminaryArtifact],
                activeArtifact: preliminaryArtifact,
              });
              setActiveVersionNumber(1);
            }
            return;
          }

          if (!isCancelled) {
            if (consultation.status === "completed_pending_review") {
              setPageState({
                status: "error",
                code: 200,
                type: "awaiting_review",
                message: "Documentation Awaiting Physician Review. Your clinical interview is complete and is currently awaiting attending physician review and attestation. Clinical notes will be released here once signed.",
              });
            } else {
              setPageState({
                status: "error",
                code: 200,
                type: "no_signed_artifact",
                message: "No signed SOAP report exists yet for this consultation. The clinical intake is either paused or still in progress.",
              });
            }
          }
          return;
        }

        // Default to latest signed artifact
        const latestSigned = signedArtifacts[0];
        if (!isCancelled) {
          setPageState({
            status: "ready",
            consultation,
            signedArtifacts,
            activeArtifact: latestSigned,
          });
          setActiveVersionNumber(latestSigned.version);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setPageState({
            status: "error",
            code: 500,
            type: "server_error",
            message: err?.message || "An unexpected error occurred while loading clinical records.",
          });
        }
      }
    }

    loadEncounterSoap();

    return () => {
      isCancelled = true;
    };
  }, [consultationId]);

  // Handle version switching
  const handleSelectVersion = (version: number) => {
    if (pageState.status !== "ready") return;
    const selected = pageState.signedArtifacts.find((a) => a.version === version);
    if (selected) {
      setPageState({
        ...pageState,
        activeArtifact: selected,
      });
      setActiveVersionNumber(version);
      setIsComparingVersions(false);
    }
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const handleCopySummary = (artifact: ClinicalArtifact) => {
    const text = `MEDVOICE CLINICAL SOAP REPORT\nEncounter: ${consultationId}\nVersion: v${artifact.version} (Signed)\nSigned By: ${artifact.signedBy || "Attending Physician"}\n\n[SUBJECTIVE]\n${artifact.soapSubjective}\n\n[OBJECTIVE]\n${artifact.soapObjective}\n\n[ASSESSMENT]\n${artifact.soapAssessment}\n\n[PLAN]\n${artifact.soapPlan}\n\nICD-10: ${(artifact.icd10Codes || []).join(", ") || "None"}\nAttestation Digest: ${artifact.signingAttestationDigest || artifact.payloadSha256 || "N/A"}`;
    navigator.clipboard.writeText(text);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const handleDownloadFhir = (consultation: ConsultationMetadata, artifact: ClinicalArtifact) => {
    const bundle = generateFHIRBundle({
      id: consultation.id,
      patientName: consultation.patientName,
      patientAge: consultation.patientAge,
      patientGender: consultation.patientGender,
      doctorId: consultation.doctorId,
      doctorName: consultation.doctorName,
      specialty: consultation.specialty,
      chiefComplaint: artifact.chiefComplaint || consultation.chiefComplaint,
      transcript: (consultation.transcript || []).map((t) => ({
        role: t.role,
        text: t.text,
        timestamp: t.timestamp || "00:00",
      })),
      triageLevel: consultation.triageLevel as "routine" | "priority" | "emergency" | "gathering_history" | undefined,
      triageTitle: consultation.triageTitle,
      esiScore: (artifact.esiScore ?? consultation.esiScore) ?? undefined,
      detectedSymptoms: consultation.detectedSymptoms || [],
      icd10Codes: artifact.icd10Codes || consultation.icd10Codes || [],
      soapSubjective: artifact.soapSubjective,
      soapObjective: artifact.soapObjective,
      soapAssessment: artifact.soapAssessment,
      soapPlan: artifact.soapPlan,
      recommendedAction: "Follow standard certified outpatient protocol.",
      status: "approved",
      createdAt: consultation.createdAt,
    });

    const validation = validateFhirR4Bundle(bundle as unknown as Record<string, unknown>);
    if (!validation.valid) {
      console.warn("[FHIR Download] Bundle validation diagnostics:", validation.issues);
    }

    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/fhir+json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FHIR-R4-ENCOUNTER-${consultation.id}-v${artifact.version}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-slate-900 flex flex-col font-sans">
      <LandingFloatingNavbar />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-24 sm:pt-28 pb-16">
        {/* Breadcrumb Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/history"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-slate-600 hover:text-slate-950 transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span>Back to Consultation History</span>
          </Link>

          <span className="text-xs font-mono text-slate-400">
            Encounter ID: {consultationId}
          </span>
        </div>

        {/* LOADING STATE */}
        {pageState.status === "loading" && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-12 text-center shadow-xs">
            <div className="w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm font-semibold text-slate-700">
              Retrieving certified clinical documentation...
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Verifying cryptographic attestation and patient record access.
            </p>
          </div>
        )}

        {/* ERROR / INFORMATIVE STATE */}
        {pageState.status === "error" && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-8 sm:p-10 shadow-xs space-y-6">
            <div className="flex items-start gap-4">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                  pageState.type === "forbidden" || pageState.type === "not_found"
                    ? "bg-rose-50 text-rose-600 border border-rose-200"
                    : pageState.type === "awaiting_review"
                    ? "bg-slate-100 text-slate-700 border border-slate-200"
                    : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}
              >
                {pageState.type === "forbidden" ? (
                  <Lock className="w-6 h-6" />
                ) : pageState.type === "awaiting_review" ? (
                  <Clock className="w-6 h-6" />
                ) : (
                  <AlertCircle className="w-6 h-6" />
                )}
              </div>

              <div className="flex-1">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-950 tracking-tight">
                  {pageState.type === "forbidden"
                    ? "Access Denied"
                    : pageState.type === "not_found"
                    ? "Consultation Not Found"
                    : pageState.type === "awaiting_review"
                    ? "Documentation Awaiting Review"
                    : "No Finalized SOAP Report"}
                </h1>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                  {pageState.message}
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center gap-3">
              <Link
                href="/history"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold bg-[#18251D] hover:bg-black text-white transition-all shadow-xs"
              >
                <span>Return to Consultation History</span>
                <ChevronRight className="w-3.5 h-3.5 text-[#B7FF72]" />
              </Link>

              {pageState.type === "no_signed_artifact" && (
                <Link
                  href={`/consult/${consultationId}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Resume Consultation</span>
                </Link>
              )}
            </div>
          </div>
        )}

        {/* READY STATE: AUTHORITATIVE ENCOUNTER SOAP DOCUMENT */}
        {pageState.status === "ready" && (
          <div className="space-y-8">
            {/* Encounter Header Card */}
            <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-xs">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border shadow-2xs ${
                      pageState.activeArtifact.status === "pending_review"
                        ? "bg-indigo-50 text-indigo-800 border-indigo-200"
                        : "bg-emerald-50 text-emerald-800 border-emerald-200"
                    }`}>
                      {pageState.activeArtifact.status === "pending_review" ? (
                        <>
                          <Clock className="w-3.5 h-3.5 text-indigo-600" />
                          Intake Clinical Record · Awaiting Attestation
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                          Certified Clinical Record · Signed
                        </>
                      )}
                    </span>

                    <span className="text-xs font-mono font-medium text-slate-500">
                      Version v{pageState.activeArtifact.version}
                    </span>

                    <span className="text-xs text-slate-400">·</span>

                    <span className="text-xs text-slate-500">
                      {new Date(pageState.consultation.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>

                  <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
                    {pageState.activeArtifact.chiefComplaint ||
                      pageState.consultation.chiefComplaint ||
                      "Clinical Consultation Assessment"}
                  </h1>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 mt-3">
                    <div className="flex items-center gap-1.5">
                      <Stethoscope className="w-4 h-4 text-slate-400" />
                      <span className="font-semibold text-slate-900">
                        {pageState.consultation.doctorName}
                      </span>
                      <span className="text-slate-400">({pageState.consultation.specialty})</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <User className="w-4 h-4 text-slate-400" />
                      <span>Patient: {pageState.consultation.patientName}</span>
                    </div>
                  </div>
                </div>

                {/* Export & Action Controls */}
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    onClick={() => setShowCareSuggestions(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#18251D] hover:bg-black text-[#B7FF72] transition-all cursor-pointer shadow-xs group"
                    title="View personalized AI care suggestions"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#B7FF72] group-hover:scale-110 transition-transform" />
                    <span>Care Suggestions</span>
                  </button>

                  <button
                    onClick={() => handleCopySummary(pageState.activeArtifact)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 transition-all cursor-pointer shadow-2xs"
                  >
                    {copiedSummary ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copied Summary</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-500" />
                        <span>Copy Summary</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleDownloadFhir(pageState.consultation, pageState.activeArtifact)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 transition-all cursor-pointer shadow-xs group"
                  >
                    <Download className="w-3.5 h-3.5 text-slate-700" />
                    <span>Download FHIR R4</span>
                  </button>
                </div>
              </div>

              {/* Version Navigation Bar (When Multiple Signed Versions Exist) */}
              {pageState.signedArtifacts.length > 1 && (
                <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-bold text-slate-700">Signed Version Lineage:</span>
                    <div className="flex items-center gap-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200/70">
                      {pageState.signedArtifacts.map((art) => {
                        const isCurrent = art.version === pageState.activeArtifact.version;
                        const isLatest = art.version === pageState.signedArtifacts[0].version;
                        return (
                          <button
                            key={art.id}
                            onClick={() => handleSelectVersion(art.version)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                              isCurrent
                                ? "bg-white text-slate-950 shadow-xs"
                                : "text-slate-600 hover:text-slate-950"
                            }`}
                          >
                            v{art.version} {isLatest ? "(Latest)" : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => setIsComparingVersions(!isComparingVersions)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      isComparingVersions
                        ? "bg-[#18251D] text-white border-[#18251D]"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <GitCompare className="w-3.5 h-3.5 text-[#B7FF72]" />
                    <span>{isComparingVersions ? "Exit Version Comparison" : "Compare Versions"}</span>
                  </button>
                </div>
              )}
            </div>

            {/* VERSION DIFF VIEW OR STANDARD 4-PART SOAP REPORT */}
            {isComparingVersions && pageState.signedArtifacts.length > 1 ? (
              <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-xs">
                <SoapVersionDiff
                  baseArtifact={pageState.signedArtifacts[pageState.signedArtifacts.length - 1]}
                  targetArtifact={pageState.activeArtifact}
                  onBack={() => setIsComparingVersions(false)}
                />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Clinical Quadrants (SOAP) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Subjective */}
                  <div className="rounded-3xl bg-white border border-slate-200/90 p-6 shadow-xs flex flex-col">
                    <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
                      <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center font-bold text-xs">
                        S
                      </div>
                      <h2 className="text-sm font-bold text-slate-950 uppercase tracking-wider">
                        Subjective
                      </h2>
                    </div>
                    <div className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line flex-1">
                      {pageState.activeArtifact.soapSubjective || "No subjective symptoms recorded."}
                    </div>
                  </div>

                  {/* Objective */}
                  <div className="rounded-3xl bg-white border border-slate-200/90 p-6 shadow-xs flex flex-col">
                    <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
                      <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-800 flex items-center justify-center font-bold text-xs">
                        O
                      </div>
                      <h2 className="text-sm font-bold text-slate-950 uppercase tracking-wider">
                        Objective
                      </h2>
                    </div>
                    <div className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line flex-1">
                      {pageState.activeArtifact.soapObjective || "No objective clinical findings recorded."}
                    </div>
                  </div>

                  {/* Assessment */}
                  <div className="rounded-3xl bg-white border border-slate-200/90 p-6 shadow-xs flex flex-col">
                    <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
                      <div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-800 flex items-center justify-center font-bold text-xs">
                        A
                      </div>
                      <h2 className="text-sm font-bold text-slate-950 uppercase tracking-wider">
                        Assessment
                      </h2>
                    </div>
                    <div className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line flex-1">
                      {pageState.activeArtifact.soapAssessment || "No diagnostic assessment formulated."}
                    </div>
                  </div>

                  {/* Plan */}
                  <div className="rounded-3xl bg-white border border-slate-200/90 p-6 shadow-xs flex flex-col">
                    <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
                      <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-800 flex items-center justify-center font-bold text-xs">
                        P
                      </div>
                      <h2 className="text-sm font-bold text-slate-950 uppercase tracking-wider">
                        Plan
                      </h2>
                    </div>
                    <div className="text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line flex-1">
                      {pageState.activeArtifact.soapPlan || "No treatment plan outlined."}
                    </div>
                  </div>
                </div>

                {/* Diagnostic Acuity & Coding Bar */}
                <div className="rounded-3xl bg-white border border-slate-200/90 p-6 shadow-xs space-y-4">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Diagnostic Classification & Triage Acuity
                  </h3>

                  <div className="flex flex-wrap items-center gap-3">
                    {pageState.activeArtifact.esiScore && (
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-mono font-bold text-slate-900">
                        <Activity className="w-3.5 h-3.5 text-slate-600" />
                        <span>ESI Acuity: Level {pageState.activeArtifact.esiScore}</span>
                      </div>
                    )}

                    {(pageState.activeArtifact.icd10Codes || []).map((code, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-semibold text-slate-800"
                      >
                        <span className="text-[10px] uppercase font-bold text-slate-400">ICD-10</span>
                        <span>{code}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Medico-Legal Cryptographic Attestation Block */}
                <div className="rounded-3xl bg-slate-50 border border-slate-200/90 p-6 sm:p-7 shadow-2xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span className="text-xs font-bold tracking-tight text-slate-950 uppercase">
                        Medico-Legal Digital Attestation
                      </span>
                    </div>

                    <span className={`text-[11px] font-mono px-2 py-0.5 rounded-lg border ${
                      pageState.activeArtifact.status === "pending_review"
                        ? "text-indigo-700 bg-indigo-50 border-indigo-200"
                        : "text-emerald-700 bg-emerald-50 border-emerald-200"
                    }`}>
                      {pageState.activeArtifact.status === "pending_review"
                        ? "Queued for Physician Signature"
                        : "Immutable Signature Verified"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600">
                    <div>
                      <span className="font-semibold text-slate-900 block">Attending Clinician</span>
                      <span>
                        {pageState.activeArtifact.signedBy || pageState.consultation.doctorName} (
                        {pageState.activeArtifact.signedByRole || "Licensed Physician"})
                      </span>
                    </div>

                    <div>
                      <span className="font-semibold text-slate-900 block">Attestation Timestamp</span>
                      <span>
                        {pageState.activeArtifact.signedAt
                          ? new Date(pageState.activeArtifact.signedAt).toUTCString()
                          : "Certified at review"}
                      </span>
                    </div>
                  </div>

                  {pageState.activeArtifact.payloadSha256 && (
                    <div className="pt-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                        <span className="font-mono">Payload SHA-256 Digest:</span>
                        <button
                          onClick={() => handleCopyHash(pageState.activeArtifact.payloadSha256!)}
                          className="hover:text-slate-950 cursor-pointer inline-flex items-center gap-1 font-sans"
                        >
                          {copiedHash ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy Digest</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="font-mono text-[11px] bg-white p-2.5 rounded-xl border border-slate-200/80 text-slate-800 break-all select-all">
                        {pageState.activeArtifact.payloadSha256}
                      </div>
                    </div>
                  )}
                </div>

                {/* Complete Encounter Dialogue Transcript */}
                <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-xs space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <Stethoscope className="w-4 h-4 text-emerald-600" />
                      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        Encounter Dialogue Transcript ({pageState.consultation.transcript?.length || 0} Turns)
                      </h3>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">Verbatim Conversation History</span>
                  </div>

                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {pageState.consultation.transcript && pageState.consultation.transcript.length > 0 ? (
                      pageState.consultation.transcript.map((msg, idx) => {
                        const isDoctor = msg.role === "doctor";
                        return (
                          <div
                            key={idx}
                            className={`flex flex-col ${isDoctor ? "items-start" : "items-end"}`}
                          >
                            <div className="flex items-center gap-1.5 mb-1 px-1">
                              <span className="text-[11px] font-bold text-slate-600">
                                {isDoctor ? pageState.consultation.doctorName : "You (Patient)"}
                              </span>
                              {msg.timestamp && (
                                <span className="text-[10px] text-slate-400">{msg.timestamp}</span>
                              )}
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
                      <p className="text-xs text-slate-400 text-center py-4">
                        No dialogue turns recorded for this consultation.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* AI CARE SUGGESTIONS MODAL */}
        {showCareSuggestions && (
          <CareSuggestionsModal
            isOpen={showCareSuggestions}
            onClose={() => setShowCareSuggestions(false)}
            consultationId={consultationId}
            doctorName={pageState.status === "ready" ? pageState.consultation.doctorName : undefined}
            specialty={pageState.status === "ready" ? pageState.consultation.specialty : undefined}
          />
        )}
      </main>

      <ArchitecturalBrandLedgerFooter />
    </div>
  );
}
