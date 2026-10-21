"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  Mic,
  ArrowRight,
  ShieldCheck,
  Lock,
  Database,
  Navigation,
  Activity,
  Plus,
  Minus,
  Check,
  PhoneCall,
  Sparkles,
  Stethoscope,
  Clock,
  HeartPulse,
  Radio,
  FileText
} from "lucide-react";
import { SmoothScrollProvider } from "@/components/motion/SmoothScrollProvider";
import { LandingFloatingNavbar } from "./_components/LandingFloatingNavbar";
import { SculpturalRibbonCanvas } from "./_components/SculpturalRibbonCanvas";
import { OrchestratedClinicalJourney } from "./_components/OrchestratedClinicalJourney";
import { CareNetworkCommand } from "./_components/CareNetworkCommand";
import { BaselineArchitecturalCapabilities } from "./_components/BaselineArchitecturalCapabilities";
import { ArchitecturalBrandLedgerFooter } from "./_components/ArchitecturalBrandLedgerFooter";

const CLINICAL_GOVERNANCE_FAQS = [
  {
    q: "How does the deterministic safety arbiter prevent clinical hallucination?",
    a: "MedVoice separates natural conversational dialogue from clinical safety decisions. While language models handle conversational fluency, critical red-flag indicators (such as acute chest pain with radiation or sudden focal neurological deficits) are evaluated by a deterministic, rule-based arbitration engine following Emergency Severity Index (ESI v4) protocols. When criteria are met, the safety arbiter immediately overrides generative dialogue and activates emergency pathways.",
  },
  {
    q: "How is patient audio handled in terms of ephemeral memory retention?",
    a: "Audio is captured ephemerally in transient memory solely to extract acoustic features and generate transcription via Whisper. Once the turn completes and clinical entities are mined into structured form, the raw audio buffer is permanently scrubbed. No audio recordings are written to persistent object storage or disk.",
  },
  {
    q: "How are hospital travel times and facility reachability calculated?",
    a: "MedVoice interfaces with an Open Source Routing Machine (OSRM) engine with canonical road geometry. It filters regional facilities by certified medical capabilities (such as 24/7 STEMI Cath Lab or Level-1 Trauma accreditation) and calculates accurate driving distance and ETA, rather than simple straight-line estimates.",
  },
  {
    q: "How does MedVoice format data for hospital Electronic Health Record (EHR) ingestion?",
    a: "Completed consultation records are compiled into standardized HL7 FHIR R4 Encounter and Condition JSON resource schemas, paired with a structured SOAP note for clinician review and EHR export.",
  },
];

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <SmoothScrollProvider>
      <div className="relative min-h-screen bg-[#FAF9F6] text-slate-900 font-sans flex flex-col justify-between selection:bg-teal-500 selection:text-white overflow-x-clip">
        
        {/* Floating Pill Navbar with Centered Navigation and Profile Menu */}
        <LandingFloatingNavbar />

        <main className="w-full flex-1">
          
          {/* ================================================================ */}
          {/* ================================================================ */}
          {/* 1. HERO SECTION: BASELINE EDITORIAL ACOUSTIC ARCHITECTURE        */}
          {/* ================================================================ */}
          <section className="relative pt-32 sm:pt-40 lg:pt-48 pb-24 sm:pb-32 overflow-hidden border-b border-slate-200/80 bg-[#FAF9F6]">
            {/* Signature Sculptural Acoustic Ribbon (Fluid Pearl-Chrome Architecture) */}
            <SculpturalRibbonCanvas />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
              
              {/* Asymmetric Editorial Hero Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-start">
                
                {/* Left Column (Span 7): Confident Oversized Editorial Typography */}
                <div className="lg:col-span-7 space-y-8 text-left">
                  
                  {/* Refined Eyebrow */}
                  <div className="inline-flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-slate-500 uppercase">
                    <span className="w-2 h-2 rounded-full bg-[#B7FF72] shadow-[0_0_8px_#B7FF72] animate-pulse" />
                    <span>CLINICAL ACOUSTIC LABS · EPHEMERAL INTAKE</span>
                  </div>

                  {/* Confident Stacked Display Headline in Ink Black (#05070F) */}
                  <h1 className="text-5xl sm:text-7xl lg:text-[76px] font-black text-[#05070F] tracking-tight leading-[0.98]">
                    <span className="block">The voice interface</span>
                    <span className="block">for deterministic</span>
                    <span className="block text-[#18251D]">clinical triage.</span>
                  </h1>

                  {/* Editorial Explanatory Copy */}
                  <p className="text-base sm:text-xl text-slate-600 leading-relaxed font-normal max-w-xl">
                    MedVoice replaces rigid digital forms with real-time acoustic dialogue. We stream 16kHz patient voice into verified ICD-10 ontology, enforcing mathematical Emergency Severity Index preemption before connecting to regional care.
                  </p>

                  {/* Primary Action Row with Baseline Spring Motion */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-2">
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    >
                      <Link
                        href="/consult"
                        className="inline-flex items-center justify-center gap-3 rounded-full bg-[#18251D] hover:bg-[#223529] border border-[#18251D] hover:border-[#B7FF72]/40 text-white px-8 py-4 text-sm font-bold shadow-xl shadow-[#18251D]/25 hover:shadow-[0_0_22px_rgba(183,255,114,0.22)] active:scale-[0.98] transition-all cursor-pointer group"
                      >
                        <Mic className="w-4 h-4 text-[#B7FF72] group-hover:scale-110 transition-transform" />
                        <span>Launch Voice Consult Room</span>
                        <ArrowRight className="w-4 h-4 text-white/70 group-hover:text-[#B7FF72] group-hover:translate-x-1 transition-transform" />
                      </Link>
                    </motion.div>

                    <Link
                      href="/care"
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-white hover:bg-slate-50 text-slate-900 border border-slate-300 px-7 py-4 text-sm font-semibold shadow-2xs active:scale-[0.98] transition-all cursor-pointer group"
                    >
                      <Navigation className="w-4 h-4 text-slate-500 group-hover:rotate-12 transition-transform" />
                      <span>Explore Care Network</span>
                    </Link>
                  </div>

                  {/* Crisis Telephone Anchor */}
                  <div className="pt-2 flex items-center gap-3 text-xs font-mono text-slate-500">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    <span>Emergency in Crisis: Dial 108 / 112 immediately</span>
                  </div>

                </div>

                {/* Right Column (Span 5): Ethereal Acoustic Instrument Telemetry */}
                <div className="lg:col-span-5 w-full pt-4 lg:pt-8">
                  <div className="p-6 rounded-2xl bg-white/85 backdrop-blur-xl border border-slate-200/90 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.06)] space-y-4">
                    
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3 text-xs font-mono">
                      <div className="flex items-center gap-2 text-teal-800 font-bold">
                        <Radio className="w-3.5 h-3.5 text-teal-600 animate-pulse" />
                        <span>ACOUSTIC SIGNAL MEMBRANE</span>
                      </div>
                      <span className="text-slate-500 font-medium">16kHz PCM</span>
                    </div>

                    {/* Procedural Audio Waveform Membrane */}
                    <div className="h-28 w-full flex items-center justify-center bg-gradient-to-b from-teal-50/30 to-slate-50/50 rounded-xl px-4 overflow-hidden border border-slate-100">
                      <svg viewBox="0 0 500 120" className="w-full h-full" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id="heroWaveTeal" x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#0d9488" stopOpacity="0.2" />
                            <stop offset="50%" stopColor="#0d9488" stopOpacity="0.9" />
                            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.2" />
                          </linearGradient>
                        </defs>
                        <path
                          d="M 0,60 C 50,20 100,100 150,60 C 200,20 250,100 300,60 C 350,30 400,90 500,60"
                          fill="none"
                          stroke="url(#heroWaveTeal)"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                        <path
                          d="M 0,60 C 60,90 120,30 180,60 C 240,90 300,30 360,60 C 420,80 460,40 500,60"
                          fill="none"
                          stroke="#06b6d4"
                          strokeWidth="1.5"
                          strokeOpacity="0.4"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>

                    {/* Live Ambient Transcript Snippet */}
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[11px] font-mono text-slate-500 uppercase tracking-wide">
                        Continuous Turn Ingestion
                      </div>
                      <p className="text-xs font-serif italic text-slate-800 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200/70">
                        &ldquo;Pressure right in the center of chest, radiating to jaw...&rdquo;
                      </p>
                    </div>

                    {/* Instrument Status Tokens */}
                    <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px] font-mono">
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/60">
                        <div className="text-slate-400 text-[9px]">ONTOLOGY</div>
                        <div className="font-bold text-slate-900 truncate">ICD-10 R07.9</div>
                      </div>
                      <div className="p-2 rounded-lg bg-rose-50 border border-rose-200/60">
                        <div className="text-rose-600 text-[9px]">ARBITER GATE</div>
                        <div className="font-bold text-rose-950 truncate">ESI-2 Emergent</div>
                      </div>
                    </div>

                  </div>
                </div>

              </div>

            </div>
          </section>

          {/* ================================================================ */}
          {/* 2. ORCHESTRATED CLINICAL STORYTELLING JOURNEY (GSAP + ScrollTrigger) */}
          {/* ================================================================ */}
          <OrchestratedClinicalJourney />

          {/* ================================================================ */}
          {/* 3. BASELINE ARCHITECTURAL CAPABILITIES & CLINICAL DEMONSTRATION  */}
          {/* ================================================================ */}
          <BaselineArchitecturalCapabilities />

          {/* ================================================================ */}
          {/* 4. CARE NETWORK COMMAND: HOSPITAL REACHABILITY & DRIVE TIMES      */}
          {/* ================================================================ */}
          <CareNetworkCommand />

          {/* ================================================================ */}
          {/* 5. CLINICAL GOVERNANCE & TRANSPARENCY FAQ                         */}
          {/* ================================================================ */}
          <section id="faq" className="pt-24 pb-28 sm:pt-32 sm:pb-40 lg:pb-52 bg-[#FAF9F6] border-b border-slate-200/80 relative overflow-hidden">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-12 relative z-10">
              
              <div className="text-center space-y-3">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-500">
                  CLINICAL TRANSPARENCY & EVIDENCE
                </span>
                <h2 className="text-3xl sm:text-4xl font-bold text-slate-950 tracking-tight">
                  Frequently Asked Questions
                </h2>
                <p className="text-base text-slate-600 max-w-xl mx-auto">
                  Transparent answers regarding algorithmic safety precedence, acoustic privacy, and hospital interoperability.
                </p>
              </div>

              <div className="divide-y divide-slate-200 bg-white rounded-2xl sm:rounded-3xl p-6 sm:p-8 shadow-[0_16px_40px_-10px_rgba(15,23,42,0.06)] border border-slate-200/90">
                {CLINICAL_GOVERNANCE_FAQS.map((item, i) => {
                  const isOpen = openFaq === i;
                  return (
                    <div key={item.q} className="py-5 first:pt-2 last:pb-2">
                      <button
                        onClick={() => setOpenFaq(isOpen ? null : i)}
                        className="w-full flex items-start justify-between gap-6 text-left cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded-xl"
                        aria-expanded={isOpen}
                      >
                        <span className="flex items-start gap-3.5">
                          <span className="font-mono text-xs font-bold text-slate-400 pt-1 tracking-wider shrink-0">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="text-base sm:text-lg font-bold text-slate-950 group-hover:text-teal-700 transition-colors">
                            {item.q}
                          </span>
                        </span>
                        <span className="shrink-0 pt-1 text-slate-400 group-hover:text-slate-700 transition-colors">
                          {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4 text-teal-600" />}
                        </span>
                      </button>
                      {isOpen && (
                        <p className="mt-3 ml-8 text-sm sm:text-base text-slate-600 leading-relaxed font-normal">
                          {item.a}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

            </div>
          </section>

        </main>

        {/* Signature Architectural Brand Ledger Footer */}
        <ArchitecturalBrandLedgerFooter />
      </div>
    </SmoothScrollProvider>
  );
}