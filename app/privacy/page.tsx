"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Lock,
  CheckCircle2,
  FileText,
  Key,
  Activity,
  ArrowRight,
  Shield,
  Database,
  Cpu,
  ChevronDown,
  Plus,
  Minus,
  Check,
  Sparkles,
  ExternalLink,
  RefreshCw,
  Terminal,
  AlertCircle,
  Eye,
  Layers,
  Server,
  Hash,
} from "lucide-react";
import { SmoothScrollProvider } from "@/components/motion/SmoothScrollProvider";
import { LandingFloatingNavbar } from "../_components/LandingFloatingNavbar";
import { ArchitecturalBrandLedgerFooter } from "../_components/ArchitecturalBrandLedgerFooter";
import { ImmersivePrivacyStoryScene } from "./_components/ImmersivePrivacyStoryScene";
import { ClinicalFlipCard } from "@/components/clinical/ClinicalFlipCard";

const COMPLIANCE_FAQS = [
  {
    q: "What is MedVoice's statutory HIPAA stance and BAA status?",
    a: "MedVoice implements prototype technical safeguards conforming to 45 CFR § 164.312 (access control, transmission security, data integrity, and audit controls). For full institutional deployment in covered healthcare entities, formal Business Associate Agreements (BAAs) and institutional governance policies are established.",
  },
  {
    q: "What clinical context is transmitted to cloud APIs, and when does voice audio leave local infrastructure?",
    a: "Speech-to-text processing operates in a dual-path architecture: when GROQ_API_KEY is provisioned, /api/voice/stt sends recorded audio to Groq Cloud Whisper (whisper-large-v3-turbo) for high-speed transcription. When cloud transcription fails or the key is unset, processing falls back to the local FastAPI Whisper container. Consequently, spoken audio leaves local infrastructure when the cloud STT route is active. Under Groq's published developer documentation, inputs and outputs may be retained in logs for up to 30 days for reliability and security monitoring unless an organization has verified and configured Zero Data Retention (ZDR); customer data is not used for model training unless explicitly agreed. For LLM dialogue generation, only de-identified clinical text slots (symptoms, duration, triage indicators) are transmitted to cloud inference endpoints (Groq or NVIDIA NIM).",
  },
  {
    q: "Can patient audio waveforms ever be reconstructed from the database?",
    a: "No. Reconstruction is mathematically and physically impossible because raw acoustic waveforms are never written to disk or relational databases. Temporary audio files are unlinked immediately inside Python's explicit finally: os.remove() block upon completion of the speech recognition pass.",
  },
  {
    q: "How does the SHA-256 cryptographic audit ledger guarantee data integrity?",
    a: "Every clinical event (intake creation, symptom screening, emergency dispatch, record access) computes a SHA-256 hash using the previous event's hash, canonical JSON payload, and UTC timestamp. The resulting blockchain-like hash chain guarantees that any modification to historical clinical rows immediately invalidates subsequent digests.",
  },
  {
    q: "How are patient identities isolated across consultations?",
    a: "MedVoice validates identity using server-authoritative Clerk JSON Web Tokens (JWT). Database queries for encounters, SOAP notes, and patient records enforce ownership validation checks on every transaction, preventing unauthorized cross-tenant data leakage.",
  },
];

export default function PrivacyPolicyPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <SmoothScrollProvider>
      <div className="relative min-h-screen bg-[#FAF9F6] text-slate-900 font-sans flex flex-col justify-between selection:bg-[#B7FF72] selection:text-[#05070F] overflow-x-clip">

        {/* Floating Pill Navbar with Centered Navigation and Active Privacy Indicator */}
        <LandingFloatingNavbar />

        <main className="flex-1 w-full">
          {/* ===================================================================== */}
          {/* STAGE 1: EDITORIAL PRIVACY HERO                                       */}
          {/* ===================================================================== */}
          <section className="relative pt-32 sm:pt-36 lg:pt-40 pb-12 sm:pb-16 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto">
            {/* Subtle atmospheric Acid Mint ambient glow */}
            <div className="absolute top-12 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-[#B7FF72]/10 blur-[120px] rounded-full pointer-events-none -z-10" />

            <div className="space-y-6 max-w-4xl">
              {/* Category Metadata Badge */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-slate-200/90 shadow-2xs">
                <span className="w-2 h-2 rounded-full bg-[#B7FF72] shadow-[0_0_8px_#B7FF72]" />
                <span className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-[#18251D]">
                  MEDVOICE / CLINICAL DATA GOVERNANCE & PRIVACY
                </span>
              </div>

              {/* Monumental Editorial Heading */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#05070F] leading-[1.08]">
                Your clinical data has an immutable, transparent path.
              </h1>

              {/* Editorial Lead Paragraph */}
              <p className="text-base sm:text-lg lg:text-xl text-slate-600 font-normal leading-relaxed max-w-3xl">
                Explore how voice streams, neural models, cloud boundaries, and cryptographic ledgers protect patient sovereignty from initial speech to EHR export.
              </p>

              {/* 4 Architectural Safeguard Key Stat Pills */}
              <div className="pt-4 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs hover:border-[#18251D]/30 transition-all">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#B7FF72]" />
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      AUDIO RETENTION
                    </span>
                  </div>
                  <div className="text-sm sm:text-base font-extrabold text-[#05070F]">
                    0-Byte Waveform
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    Volatile RAM scrubbed
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs hover:border-[#18251D]/30 transition-all">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#B7FF72]" />
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      REGULATORY
                    </span>
                  </div>
                  <div className="text-sm sm:text-base font-extrabold text-[#05070F]">
                    45 CFR § 164.312
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    HIPAA safeguards aligned
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs hover:border-[#18251D]/30 transition-all">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#B7FF72]" />
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      INTEGRITY LEDGER
                    </span>
                  </div>
                  <div className="text-sm sm:text-base font-extrabold text-[#05070F]">
                    SHA-256 Digest
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    Chained PostgreSQL log
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs hover:border-[#18251D]/30 transition-all">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#B7FF72]" />
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      ENCOUNTER ACCESS
                    </span>
                  </div>
                  <div className="text-sm sm:text-base font-extrabold text-[#05070F]">
                    Authoritative RBAC
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    Clerk session verified
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ===================================================================== */}
          {/* STAGE 2: IMMERSIVE PINNED DATA-LIFECYCLE STORY SCENE                  */}
          {/* ===================================================================== */}
          <ImmersivePrivacyStoryScene />

          {/* ===================================================================== */}
          {/* STAGE 3: REGULATORY SPECIFICATIONS & MEMORY AUDIT (FLIP CARDS)        */}
          {/* ===================================================================== */}
          <section id="regulatory-specs-section" className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto border-t border-slate-200/60">
            <div className="max-w-3xl mb-12 space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200/90 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-[#B7FF72]" />
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#18251D]">
                  TECHNICAL VERIFICATION · FLIP TO INSPECT
                </span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-[#05070F] tracking-tight">
                Architectural Safeguards & Technical Specifications
              </h2>
              <p className="text-base sm:text-lg text-slate-600 leading-relaxed font-normal">
                Flip each verification card to review code-level implementation details, regulatory citations, and memory zeroization invariants.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
              <ClinicalFlipCard
                category="REGULATORY FRAMEWORK"
                title="HIPAA Security Rule (45 CFR § 164.312)"
                frontSnippet="MedVoice architecture implements technical safeguard requirements under 45 CFR § 164.312 for electronic protected health information (ePHI)."
                frontBadge="45 CFR § 164.312 Aligned"
                frontIcon={<ShieldCheck className="w-5 h-5 text-[#18251D]" />}
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
                frontIcon={<Lock className="w-5 h-5 text-[#18251D]" />}
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

          {/* ===================================================================== */}
          {/* STAGE 4: STATUTORY GOVERNANCE & FAQ ACCORDION                         */}
          {/* ===================================================================== */}
          <section id="compliance-faq-section" className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto border-t border-slate-200/60">
            <div className="max-w-3xl mb-12 space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200/90 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-[#B7FF72]" />
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#18251D]">
                  GOVERNANCE & AUDIT INQUIRIES
                </span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-[#05070F] tracking-tight">
                Statutory Inquiries & Compliance Disclosures
              </h2>
              <p className="text-base sm:text-lg text-slate-600 leading-relaxed font-normal">
                Direct answers regarding Business Associate Agreements, cloud model boundaries, persistent storage schemas, and tamper detection.
              </p>
            </div>

            <div className="space-y-4 max-w-4xl">
              {COMPLIANCE_FAQS.map((faq, index) => {
                const isOpen = openFaq === index;
                return (
                  <div
                    key={index}
                    className="rounded-3xl bg-white border border-slate-200/90 overflow-hidden shadow-2xs transition-all hover:border-[#18251D]/30"
                  >
                    <button
                      onClick={() => toggleFaq(index)}
                      className="w-full py-5 px-6 sm:px-8 text-left flex items-center justify-between gap-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#18251D]"
                      aria-expanded={isOpen}
                    >
                      <span className="text-base sm:text-lg font-bold text-[#05070F] tracking-tight">
                        {faq.q}
                      </span>
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border transition-all duration-200 ${
                          isOpen
                            ? "bg-[#18251D] text-white border-[#18251D]"
                            : "bg-[#FAF9F6] text-slate-600 border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        {isOpen ? (
                          <Minus className="w-4 h-4 stroke-[2.2]" />
                        ) : (
                          <Plus className="w-4 h-4 stroke-[2.2]" />
                        )}
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-6 sm:px-8 pb-6 pt-2 text-slate-600 text-sm sm:text-base leading-relaxed border-t border-slate-100 bg-[#FAF9F6]/50">
                        <p>{faq.a}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </main>

        {/* ===================================================================== */}
        {/* CLOSING ARCHITECTURAL BRAND LEDGER FOOTER                             */}
        {/* ===================================================================== */}
        <ArchitecturalBrandLedgerFooter />
      </div>
    </SmoothScrollProvider>
  );
}
