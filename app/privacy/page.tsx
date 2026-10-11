"use client";

import React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, ShieldCheck, Lock, CheckCircle2, FileText, Key, Activity } from "lucide-react";
import { AppFooter } from "../_components/AppFooter";
import { ScrollExpand, ExpandItem } from "@/components/motion/ScrollExpand";
import { ClinicalFlipCard } from "@/components/clinical/ClinicalFlipCard";
import SplitText from "@/components/ui/SplitText";
import GradientText from "@/components/ui/GradientText";
import { AmbientPageBackground } from "@/components/ui/AmbientPageBackground";

const ClinicalDataLifecycle3D = dynamic(
  () => import("@/components/clinical/ClinicalDataLifecycle3D"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[480px] rounded-3xl bg-[#090D16] border border-slate-800 p-8 flex flex-col items-center justify-center gap-4 animate-pulse">
        <div className="w-10 h-10 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
        <span className="font-mono text-xs text-slate-400">Initializing 3D Data Lifecycle Instrument...</span>
      </div>
    ),
  }
);

const EXPAND_SAFEGUARDS: ExpandItem[] = [
  {
    id: "retention",
    num: "01",
    tag: "EPHEMERAL VOICE",
    title: "Ephemeral Voice Audio Lifecycle",
    headline: "Spoken patient audio is processed locally for Whisper transcription and clinical synthesis, with temporary files scrubbed immediately.",
    complianceBadge: "Data Minimization Safeguard",
    pipelineFlow: [
      { label: "Microphone Audio", sub: "MediaRecorder Audio Blob" },
      { label: "Next.js Bridge", sub: "In-Memory FormData" },
      { label: "FastAPI Engine", sub: "Local Whisper base.en" },
      { label: "Temp Scrub", sub: "Deleted in finally: block" },
      { label: "Persisted Data", sub: "Structured Text Only" },
    ],
    summary: "Voice recordings are not saved to disk or persistent storage by the application.",
  },
  {
    id: "encryption",
    num: "02",
    tag: "TRANSMISSION",
    title: "Secure Transport & HSTS Directives",
    headline: "All voice telemetry and clinical consultation endpoints enforce HTTPS with HSTS preloading (max-age=63072000) and strict cache controls.",
    complianceBadge: "45 CFR § 164.312(e)(1)",
    pipelineFlow: [
      { label: "Client Browser", sub: "Microphone Audio" },
      { label: "HTTPS / HSTS", sub: "Encrypted Transport" },
      { label: "Local Whisper", sub: "base.en Engine" },
      { label: "PostgreSQL DB", sub: "Durable Ledger" },
      { label: "Audit Chain", sub: "SHA-256 Digest" },
    ],
    summary: "Transmission security is enforced via TLS over web connections with strict HTTP headers preventing proxy caching.",
  },
  {
    id: "access",
    num: "03",
    tag: "AUTHORIZATION",
    title: "Granular Role-Based Access Controls (RBAC)",
    headline: "Strict Clerk server-side session authentication ensures patients can only access their own records, with full audit trail on unauthorized attempts.",
    complianceBadge: "45 CFR § 164.312(a)(1)",
    pipelineFlow: [
      { label: "Clerk Session", sub: "Server-Side Token" },
      { label: "Identity Check", sub: "Authoritative Role" },
      { label: "IDOR Check", sub: "Ownership Validation" },
      { label: "Session Token", sub: "Single Encounter" },
      { label: "Record Unlocked", sub: "Audit Entry Created" },
    ],
    summary: "IDOR boundaries prevent patients from querying other patients' clinical consultations or FHIR exports.",
  },
  {
    id: "audit",
    num: "04",
    tag: "AUDIT TRAIL",
    title: "SHA-256 Hash-Chained Audit Ledger",
    headline: "Every consultation creation, access attempt, access denial, and emergency dispatch creates a tamper-evident SHA-256 chained audit record.",
    complianceBadge: "45 CFR § 164.312(b)",
    pipelineFlow: [
      { label: "Clinical Action", sub: "Intake / Dispatch" },
      { label: "Payload Encoded", sub: "Canonical JSON" },
      { label: "SHA-256 Hash", sub: "Cryptographic Digest" },
      { label: "Timestamp Signed", sub: "UTC Clock" },
      { label: "Postgres Ledger", sub: "Durable Persistence" },
    ],
    summary: "Backed by PostgreSQL persistence with automated cryptographic tamper-verification routines.",
  },
];

export default function PrivacyPolicyPage() {
  return (
    <AmbientPageBackground>
      <div>
        {/* HERO HEADER */}
        <section className="pt-16 pb-12 px-6 max-w-4xl mx-auto space-y-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-slate-950 bg-white hover:bg-slate-50 border border-slate-200/90 hover:border-slate-300 px-3.5 py-1.5 rounded-xl shadow-2xs transition-all w-fit cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Home</span>
          </Link>

          <div className="space-y-2 pt-2">
            <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-slate-900 bg-slate-100 border border-slate-200 px-3.5 py-1 rounded-full inline-block">
              SECURITY & COMPLIANCE ARCHITECTURE
            </span>
            <div className="space-y-1">
              <SplitText
                text="Privacy Policy & Technical Safeguards"
                tag="h1"
                className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-950 leading-tight"
              />
              <div className="pt-0.5">
                <GradientText
                  colors={["#0891b2", "#06b6d4", "#0e7490"]}
                  className="text-xs sm:text-sm font-bold uppercase tracking-wider font-mono"
                >
                  Zero Voice Retention & Cryptographic Audit Trails
                </GradientText>
              </div>
            </div>
            <p className="text-base text-slate-600 font-normal leading-relaxed max-w-2xl">
              MedVoice AI is engineered around strict zero voice-retention policies, end-to-end encryption, and verifiable cryptographic compliance logs.
            </p>
          </div>
        </section>

        {/* 3D INTERACTIVE DATA LIFECYCLE INSTRUMENT */}
        <section className="pb-16 px-4 sm:px-6 max-w-5xl lg:max-w-6xl mx-auto space-y-5">
          <div className="space-y-1">
            <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-slate-900 block">
              SYSTEM ARCHITECTURE & DATA FLOW
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
              Clinical Data Lifecycle & Boundary Visualization
            </h2>
            <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
              Inspect where raw audio is processed locally, where cloud LLM reasoning begins, how transient memory buffers are purged, and how cryptographic audit metadata is generated separately.
            </p>
          </div>

          <ClinicalDataLifecycle3D />
        </section>

        {/* PROGRESSIVE DISCLOSURE: SCROLL EXPAND SAFEGUARDS */}
        <section className="pb-16 px-6 max-w-5xl mx-auto">
          <ScrollExpand items={EXPAND_SAFEGUARDS} />
        </section>

        {/* FLIP CARD SECTION: TECHNICAL SCHEMAS & BAA VERIFICATION */}
        <section className="pb-24 px-6 max-w-5xl mx-auto space-y-8">
          <div className="space-y-2">
            <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-slate-400 block">
              TECHNICAL VERIFICATION · FLIP TO INSPECT
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
              Architectural Safeguards & Technical Specifications
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ClinicalFlipCard
              category="REGULATORY FRAMEWORK"
              title="HIPAA Security Rule (45 CFR § 164.312)"
              frontSnippet="MedVoice architecture implements technical safeguard requirements under 45 CFR § 164.312 for electronic protected health information (ePHI)."
              frontBadge="45 CFR § 164.312 Aligned"
              frontIcon={<ShieldCheck className="w-5 h-5" />}
              backTitle="SAFEGUARD SPECIFICATION"
              backItems={[
                { label: "ACCESS CONTROL (§ 164.312(a))", value: "Unique user identification, strict RBAC, and IDOR protection" },
                { label: "TRANSMISSION SECURITY (§ 164.312(e))", value: "HTTPS/HSTS transport and no-store API cache controls" },
                { label: "INTEGRITY CONTROL (§ 164.312(c))", value: "SHA-256 cryptographic chaining of clinical transactions" },
                { label: "AUDIT CONTROLS (§ 164.312(b))", value: "PostgreSQL-backed tamper-evident access and denial ledger" },
              ]}
              backNote="Prototype implementation of technical safeguards. Formal institutional compliance requires organizational policies and BAAs."
            />

            <ClinicalFlipCard
              category="DATA SOVEREIGNTY"
              title="Zero Voice Audio Retention Architecture"
              frontSnippet="Spoken conversational audio streams exist solely in volatile RAM ring-buffers during real-time transcription and are never written to persistent disk storage."
              frontBadge="Ephemeral Lifecycle Verified"
              frontIcon={<Lock className="w-5 h-5" />}
              backTitle="MEMORY LIFECYCLE AUDIT"
              backItems={[
                { label: "STREAM INGEST", value: "16kHz PCM chunks allocated in isolated volatile RAM" },
                { label: "TRANSCRIPTION PASS", value: "Real-time acoustic tokenization & entity extraction" },
                { label: "MEMORY CLEAR", value: "Explicit buffer zeroization upon socket turn closure" },
                { label: "PERSISTED DATA", value: "Only the structured text SOAP note and ICD-10 codes" },
              ]}
              backNote="Audited to ensure zero residual voice waveforms remain on servers after call termination."
            />
          </div>
        </section>
      </div>

      <AppFooter />
    </AmbientPageBackground>
  );
}
