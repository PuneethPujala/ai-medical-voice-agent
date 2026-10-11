"use client";

import React, { useState, useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform, useSpring } from "motion/react";
import {
  Mic,
  ArrowRight,
  ShieldCheck,
  Zap,
  FileText,
  Lock,
  Clock,
  Activity,
  HeartPulse,
  Database,
  Building2,
  Navigation,
  CheckCircle2,
  PhoneCall,
  Sparkles,
  ChevronRight,
  Plus,
  Minus,
  AlertTriangle,
  Radio,
  Sliders,
  Check,
  ExternalLink,
  Flame,
  Stethoscope
} from "lucide-react";
import { Navbar } from "./_components/Navbar";
import { AppFooter } from "./_components/AppFooter";
import { CursorGrid } from "@/components/CursorGrid";
import { MedicalHeroDashboardPreview } from "./_components/MedicalHeroDashboardPreview";
import RotatingText from "@/components/RotatingText";
import CountUp from "@/components/CountUp";
import { SpotlightCard } from "@/components/motion/SpotlightCard";
import { MovingBorder } from "@/components/motion/MovingBorder";
import { ScrollStack, ScrollStackCard } from "@/components/motion/ScrollStack";
import { OptionWheel, OptionWheelItem } from "@/components/navigation/OptionWheel";
import { ClinicalFlipCard } from "@/components/clinical/ClinicalFlipCard";
import { ClinicalStepper, StepItem } from "@/components/clinical/ClinicalStepper";
import PremiumButton from "@/components/PremiumButton";
import GlowCursor from "@/components/ui/GlowCursor";
import StarBorder from "@/components/ui/StarBorder";
import SplitText from "@/components/ui/SplitText";
import GradientText from "@/components/ui/GradientText";

const ROTATING_TOPICS = [
  "Emergency Triage",
  "SOAP Note Charting",
  "Hospital ED Routing",
  "Pediatric Consults",
  "Cardiology Intake",
];

const HERO_SCENARIOS: OptionWheelItem[] = [
  {
    id: "emergency",
    label: "Emergency ER Escalation",
    category: "CRITICAL TRIAGE",
    badge: "ESI Level 1-2",
    badgeStyle: "bg-rose-50 text-rose-700 border-rose-200",
  },
  {
    id: "pediatric",
    label: "Same-Day Pediatric Care",
    category: "URGENT INTAKE",
    badge: "Priority Outpatient",
    badgeStyle: "bg-amber-50 text-amber-700 border-amber-200",
  },
  {
    id: "cardiac",
    label: "Cardiology Deliberation",
    category: "SPECIALTY CLINICAL",
    badge: "Multi-Agent Board",
    badgeStyle: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
  {
    id: "refill",
    label: "Post-Op Rx Medication Refill",
    category: "AMBULATORY CARE",
    badge: "Automated Verification",
    badgeStyle: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  {
    id: "telehealth",
    label: "Routine Telehealth Intake",
    category: "GENERAL PRACTICE",
    badge: "Standard ESI 4-5",
    badgeStyle: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
];

const METRICS = [
  {
    icon: Zap,
    iconColor: "text-cyan-600 bg-cyan-50 border-cyan-200",
    value: 1.68,
    prefix: "~",
    suffix: "s",
    label: "Local Whisper ASR",
    subtext: "Warm CPU transcription benchmark (base.en)",
  },
  {
    icon: ShieldCheck,
    iconColor: "text-emerald-600 bg-emerald-50 border-emerald-200",
    value: 73,
    suffix: " / 73",
    label: "Adversarial Invariant Pass",
    subtext: "Deterministic ESI v4 life-threat safety arbiter",
  },
  {
    icon: Clock,
    iconColor: "text-indigo-600 bg-indigo-50 border-indigo-200",
    value: 5,
    suffix: " Personas",
    label: "Specialist Board",
    subtext: "General intake + modular specialty clinical reasoning",
  },
  {
    icon: Database,
    iconColor: "text-cyan-700 bg-cyan-50 border-cyan-200",
    value: 100,
    suffix: "%",
    label: "FHIR Conformance Test",
    subtext: "HL7 FHIR R4 Bundle export verified by test harness",
  },
];

const SCROLL_STACK_CARDS: ScrollStackCard[] = [
  {
    step: "01",
    tag: "LISTEN",
    title: "Local Whisper Speech Intake",
    description: "MedVoice captures natural patient speech via MediaRecorder and processes it locally using Whisper base.en. Room acoustics and hesitation are handled while preserving clinical nuance.",
    highlightBadge: "Local base.en Engine · Ephemeral Buffer",
    badgeColor: "text-cyan-700 bg-cyan-50 border-cyan-200",
    metric: "Local Whisper ASR (1.68s on CPU)",
    content: (
      <div className="space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-slate-500">
          <span>PATIENT CALL: #9042</span>
          <span className="text-emerald-600 font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            STREAM ACTIVE
          </span>
        </div>
        <p className="text-slate-800 italic font-sans text-sm font-medium">
          &quot;I&apos;ve had severe crushing chest discomfort since morning radiating to my left arm with cold sweats...&quot;
        </p>
        <div className="flex items-center gap-1.5 pt-1 text-[11px] text-cyan-700">
          <Radio className="w-3.5 h-3.5 animate-pulse" />
          <span>Local Whisper ASR · Ephemeral Audio Scrub</span>
        </div>
      </div>
    ),
  },
  {
    step: "02",
    tag: "UNDERSTAND",
    title: "Structured Symptom & ICD-10 Extraction",
    description: "As the conversation unfolds, the clinical evidence extractor parses chief complaints, duration, severity, and denials, cross-referencing candidate conditions against ICD-10.",
    highlightBadge: "ICD-10-Assisted Coding · ACC/AHA Protocols",
    badgeColor: "text-blue-700 bg-blue-50 border-blue-200",
    metric: "Multi-Clause Extraction",
    content: (
      <div className="space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-slate-500">
          <span>CLINICAL MINING BUS</span>
          <span className="text-cyan-700 font-bold">ACC/AHA VALIDATED</span>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <span className="px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200 font-bold">
            R07.9 Chest Pain (Acute)
          </span>
          <span className="px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-bold">
            R61 Diaphoresis
          </span>
          <span className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold">
            R06.02 Shortness of Breath
          </span>
        </div>
        <p className="text-[11px] text-slate-500 font-sans">
          Chief complaint duration: 6 hours · Radiation: Left arm · Onset: Acute
        </p>
      </div>
    ),
  },
  {
    step: "03",
    tag: "ASSESS",
    title: "Deterministic ESI Urgency Stratification",
    description: "Evaluates patient status against the 5-level Emergency Severity Index. Separates life-threatening cardiac or stroke red flags from routine ambulatory cases.",
    highlightBadge: "ESI Level 1-5 · Pre-Arrival Telemetry",
    badgeColor: "text-rose-700 bg-rose-50 border-rose-200",
    metric: "ESI Level 2 Priority",
    content: (
      <div className="space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <span className="text-slate-500">TRIAGE CLASSIFICATION</span>
          <span className="text-rose-600 font-bold flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            HIGH RISK CHEST PAIN
          </span>
        </div>
        <div className="p-3 rounded-xl bg-rose-50/80 border border-rose-200/90 text-rose-950 font-sans space-y-1">
          <div className="text-xs font-bold uppercase font-mono text-rose-700">
            ESI LEVEL 2 — URGENT RESUSCITATION
          </div>
          <p className="text-xs text-rose-900 leading-relaxed">
            High-risk cardiac presentation with radiating pain and diaphoresis. Immediate EMS notification recommended.
          </p>
        </div>
      </div>
    ),
  },
  {
    step: "04",
    tag: "ACT",
    title: "Emergency Care Network & ED Dispatch",
    description: "Filters regional medical centers by verified trauma capability and calculates real-time road driving times to route the patient to the nearest Cath Lab.",
    highlightBadge: "Level-1 Trauma · OSRM Road Distance",
    badgeColor: "text-emerald-700 bg-emerald-50 border-emerald-200",
    metric: "8.4 km · ~16 min ETA",
    content: (
      <div className="space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-slate-500">
          <span>CARE NETWORK ROUTING</span>
          <span className="text-emerald-600 font-bold">PRE-ARRIVAL DISPATCH READY</span>
        </div>
        <div className="space-y-1.5 font-sans">
          <div className="text-xs font-bold text-slate-900">
            Regional Level-1 Emergency & Trauma Center
          </div>
          <p className="text-xs text-slate-500 font-mono">
            Vijayawada Hub · 24/7 Cath Lab & STEMI Unit Active
          </p>
          <div className="flex items-center gap-2 pt-1 font-mono text-[11px] text-cyan-700">
            <Navigation className="w-3.5 h-3.5" />
            <span>Canonical Road Distance: 8.4 km (~16 min)</span>
          </div>
        </div>
      </div>
    ),
  },
];

const STEPPER_ITEMS: StepItem[] = [
  {
    id: "step-1",
    number: "1",
    label: "LISTEN",
    title: "Continuous Voice Intake",
    description: "Captures natural human dialogue with local Whisper base.en transcription.",
    highlight: "Local Whisper ASR · Ephemeral Audio",
  },
  {
    id: "step-2",
    number: "2",
    label: "UNDERSTAND",
    title: "Symptom & Entity Mining",
    description: "Isolates chief complaints and matches ICD-10 medical codes.",
    highlight: "ICD-10 Mapping · Entity Extraction",
  },
  {
    id: "step-3",
    number: "3",
    label: "ASSESS",
    title: "ESI Urgency Stratification",
    description: "Evaluates patient severity against clinical triage protocols.",
    highlight: "ESI 1-5 Standards · Resuscitation Alert",
  },
  {
    id: "step-4",
    number: "4",
    label: "ACT",
    title: "Hospital Network Dispatch",
    description: "Routes patient to the nearest verified trauma center.",
    highlight: "Real-time Road Routing · ETA Calculation",
  },
];

const FAQS = [
  {
    q: "Is MedVoice a replacement for a licensed physician?",
    a: "No. MedVoice is a clinical decision-support and triage assistant designed to streamline intake, extract structured symptoms, and route patients to the right level of care faster. It does not replace a licensed medical provider. In emergencies, patients are directed to call 911 immediately.",
  },
  {
    q: "How does the system ensure patient voice privacy?",
    a: "MedVoice operates with a strict zero voice-retention policy. Audio streams are transcribed in memory to extract clinical entities and SOAP notes; the raw audio recording is discarded immediately after processing.",
  },
  {
    q: "Can MedVoice export to our hospital EHR (Epic / Cerner)?",
    a: "Yes. Every clinical encounter automatically compiles into a standardized HL7 FHIR R4 Encounter bundle, including Condition (ICD-10), Observation, and DocumentReference resources ready for ingestion.",
  },
  {
    q: "How does the emergency routing determine which hospital to dispatch to?",
    a: "The engine filters facilities by verified medical capability (such as 24/7 Level-1 Trauma or Comprehensive Stroke Center status), then calculates canonical road travel times using real-time routing engines.",
  },
];

export default function HomePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [selectedScenario, setSelectedScenario] = useState<string>("emergency");
  const [activeStep, setActiveStep] = useState<number>(0);

  return (
    <div className="relative min-h-screen bg-[#FAF9F6] text-slate-900 font-sans flex flex-col justify-between selection:bg-cyan-500 selection:text-white">
      {/* React Bits Subtle Interactive Ambient Cursor Glow */}
      <GlowCursor color="rgba(6, 182, 212, 0.14)" size={380} blur={70} opacity={0.75} />

      {/* ------------------------------------------------------------------ */}
      {/* 1. FLOATING CLINICAL HEADER (PILL NAV INTEGRATED)                 */}
      {/* ------------------------------------------------------------------ */}
      <Navbar />

      <main className="w-full flex-1">
        {/* ================================================================ */}
        {/* 2. HERO SECTION WITH OPTION WHEEL & CLINICAL PREVIEW             */}
        {/* ================================================================ */}
        <section className="relative pt-20 pb-16 sm:pt-28 sm:pb-24 overflow-hidden">
          {/* Distinctive geometric CursorGrid hero background */}
          <div className="absolute inset-0 z-0 pointer-events-auto">
            <CursorGrid
              cellSize={68}
              colors={["#00F0FF", "#3B82F6", "#8B5CF6", "#D946EF"]}
              radius={150}
              falloff="smooth"
              holdTime={400}
              fadeDuration={800}
              lineWidth={1.2}
              maxOpacity={0.85}
              fillOpacity={0.05}
              gridOpacity={0.04}
              cellRadius={0}
              clickPulse
              pulseSpeed={600}
            />
          </div>

          <div className="relative z-10 max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-12 text-center pointer-events-none">
            
            {/* Super-title Badge */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-50/90 border border-cyan-200/90 shadow-2xs mb-6 pointer-events-auto"
            >
              <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
              <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-cyan-800">
                MEDVOICE — CLINICAL AI
              </span>
            </motion.div>

            {/* Main Headline (64–72px desktop, font-weight: 650–700) */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="text-4xl sm:text-6xl lg:text-[68px] font-bold text-slate-950 tracking-tight leading-[1.08] max-w-4xl mx-auto"
            >
              Empathetic Medical Voice Assistance for{" "}
              <span className="inline-block mt-2 sm:mt-1">
                <RotatingText
                  texts={ROTATING_TOPICS}
                  mainClassName="inline-flex items-center px-4 py-1.5 bg-cyan-50 border border-cyan-200/90 rounded-2xl text-cyan-700 shadow-2xs font-bold"
                  staggerDuration={0.02}
                  rotationInterval={2800}
                />
              </span>
            </motion.h1>

            {/* Supporting Description (18–20px) */}
            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.22 }}
              className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed font-normal"
            >
              Instant, clinical-grade patient intake through conversational AI. Continuous ICD-10 symptom mining, real-time ESI urgency scoring, and automated EHR SOAP documentation.
            </motion.p>

            {/* Technical Trust Metadata Badges (11–12px, 0.1em letter-spacing) */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.28 }}
              className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 pt-6 pb-8"
            >
              <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-slate-600 bg-white/90 border border-slate-200/90 px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 shadow-2xs">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                TECHNICAL SAFEGUARDS (45 CFR § 164.312)
              </span>
              <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-slate-600 bg-white/90 border border-slate-200/90 px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 shadow-2xs">
                <Zap className="w-3.5 h-3.5 text-cyan-600" />
                LOCAL WHISPER ASR
              </span>
              <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-slate-600 bg-white/90 border border-slate-200/90 px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 shadow-2xs">
                <FileText className="w-3.5 h-3.5 text-indigo-600" />
                HL7 FHIR R4 READY
              </span>
              <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-slate-600 bg-white/90 border border-slate-200/90 px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 shadow-2xs">
                <Lock className="w-3.5 h-3.5 text-emerald-600" />
                EPHEMERAL AUDIO SCRUB
              </span>
            </motion.div>

            {/* Interactive CTAs with StarBorder on Primary Action */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.34 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2 pb-12 pointer-events-auto"
            >
              <StarBorder
                as={Link}
                href="/consult"
                color="#06b6d4"
                duration={4}
                theme="dark"
                backgroundColor="#020617"
                textColor="#ffffff"
                radius={16}
                className="cursor-pointer shadow-lg hover:shadow-cyan-500/20 transition-all border border-slate-800"
              >
                <div className="flex items-center justify-center gap-2.5 text-sm font-bold text-white tracking-wide">
                  <div className="w-6 h-6 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center">
                    <Mic className="w-3.5 h-3.5 text-cyan-300" />
                  </div>
                  <span>Start Voice Consult</span>
                  <ArrowRight className="w-4 h-4 text-cyan-400 ml-0.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </StarBorder>

              <Link
                href="/care"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-900 px-6 py-3.5 text-sm font-bold shadow-xs hover:border-slate-300 transition-all cursor-pointer"
              >
                <Navigation className="w-4 h-4 text-cyan-600" />
                <span>Explore Care Network</span>
              </Link>

              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center gap-2 rounded-2xl text-slate-600 hover:text-slate-950 px-5 py-3.5 text-sm font-semibold transition-all cursor-pointer"
              >
                <FileText className="w-4 h-4 text-slate-400" />
                <span>View SOAP Records</span>
              </Link>
            </motion.div>

            {/* HERO PRODUCT PREVIEW + OPTION WHEEL */}
            <div className="w-full max-w-6xl mx-auto pt-2 pointer-events-auto">
              <div className="flex flex-col lg:flex-row items-center lg:items-start gap-8 justify-center">
                
                {/* Left: Option Wheel Scenario Selector */}
                <div className="flex flex-col items-center lg:items-start space-y-3 lg:w-72 flex-shrink-0">
                  <div className="flex items-center gap-2 text-left font-mono">
                    <span className="w-2 h-2 rounded-full bg-cyan-500" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-900">
                      Select Clinical Scenario
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 text-left font-sans leading-relaxed">
                    Rotate through patient intake scenarios to see live AI triage, symptom extraction, and care routing.
                  </p>
                  <OptionWheel
                    options={HERO_SCENARIOS}
                    selectedId={selectedScenario}
                    onChange={(opt) => setSelectedScenario(opt.id)}
                    className="w-full"
                  />
                </div>

                {/* Right: Dashboard Preview Container */}
                <div className="w-full max-w-4xl flex-1">
                  <SpotlightCard
                    spotlightColor="rgba(6, 182, 212, 0.12)"
                    spotlightRadius={380}
                    className="bg-white/95 border border-slate-200/90 rounded-3xl p-3 sm:p-5 shadow-[0_24px_70px_-15px_rgba(15,23,42,0.07)] backdrop-blur-sm"
                  >
                    <div className="w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
                      <MedicalHeroDashboardPreview
                        activeScenarioId={selectedScenario}
                        onScenarioChange={(id) => setSelectedScenario(id)}
                      />
                    </div>
                  </SpotlightCard>
                </div>

              </div>
            </div>

          </div>
        </section>

        {/* ================================================================ */}
        {/* 3. METRICS RIBBON (COUNTUP + SPOTLIGHTCARD)                     */}
        {/* ================================================================ */}
        <section className="py-12 border-y border-slate-200/80 bg-white/75 backdrop-blur-sm">
          <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-12">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              {METRICS.map((item, idx) => {
                const IconComponent = item.icon;
                return (
                  <SpotlightCard
                    key={idx}
                    spotlightColor="rgba(6, 182, 212, 0.08)"
                    spotlightRadius={220}
                    className="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-7 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-slate-500">
                          {item.label}
                        </span>
                        <div className={`p-2 rounded-xl border ${item.iconColor}`}>
                          <IconComponent className="w-4 h-4" />
                        </div>
                      </div>

                      <div className="text-3xl sm:text-4xl font-extrabold text-slate-950 font-mono tracking-tight">
                        {item.prefix && <span>{item.prefix}</span>}
                        <CountUp to={item.value} duration={1.6} />
                        {item.suffix && <span>{item.suffix}</span>}
                      </div>
                    </div>

                    <p className="mt-3 text-xs sm:text-sm text-slate-500 font-medium leading-relaxed">
                      {item.subtext}
                    </p>
                  </SpotlightCard>
                );
              })}
            </div>
          </div>
        </section>

        {/* ================================================================ */}
        {/* 4. HERO SCROLL STACK: PROGRESSIVE CLINICAL PIPELINE REVEAL       */}
        {/*    Card 01 Listen → Card 02 Understand → Card 03 Assess → Card 04 Act */}
        {/* ================================================================ */}
        <section className="py-20 sm:py-28 bg-[#FAF9F6] border-b border-slate-200/80">
          <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-12 text-center">
            
            <div className="max-w-3xl mx-auto mb-16 space-y-3">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-cyan-800 bg-cyan-50 border border-cyan-200 px-3 py-1 rounded-full inline-block">
                PROGRESSIVE PIPELINE
              </span>
              <SplitText
                text="Watch MedVoice assemble clinical intelligence in real time."
                tag="h2"
                className="text-3xl sm:text-4xl lg:text-[42px] font-bold text-slate-950 tracking-tight leading-tight"
              />
              <p className="text-lg sm:text-xl text-slate-600 font-normal leading-relaxed">
                As you scroll, experience each layer of the clinical decision process: from streaming speech intake to ICD-10 extraction, ESI scoring, and hospital routing.
              </p>
            </div>

            {/* Scroll Stack Container */}
            <ScrollStack cards={SCROLL_STACK_CARDS} className="min-h-[140vh] pb-12" />

          </div>
        </section>

        {/* ================================================================ */}
        {/* 5. CLINICAL WORKFLOW STEPPER                                     */}
        {/* ================================================================ */}
        <section id="how-it-works" className="py-20 sm:py-28 bg-white border-b border-slate-200/80">
          <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-12 space-y-12">
            
            <div className="max-w-2xl space-y-3">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-cyan-800 bg-cyan-50 border border-cyan-200 px-3 py-1 rounded-full inline-block">
                CLINICAL STEPPER
              </span>
              <SplitText
                text="Four deterministic stages, every call."
                tag="h2"
                className="text-3xl sm:text-4xl lg:text-[42px] font-bold text-slate-950 tracking-tight leading-tight"
              />
              <p className="text-lg sm:text-xl text-slate-600 font-normal leading-relaxed">
                Interactive clinical workflow connecting intake, extraction, triage classification, and facility coordination.
              </p>
            </div>

            {/* Shared Clinical Stepper Primitive */}
            <ClinicalStepper
              steps={STEPPER_ITEMS}
              activeStep={activeStep}
              onStepChange={(idx) => setActiveStep(idx)}
              orientation="horizontal"
            />

          </div>
        </section>

        {/* ================================================================ */}
        {/* 6. CLINICAL FLIP CARDS: IN-DEPTH CLINICAL SPECIFICATIONS         */}
        {/* ================================================================ */}
        <section id="capabilities" className="py-20 sm:py-28 bg-[#FAF9F6] border-b border-slate-200/80">
          <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-12 space-y-12">
            
            <div className="max-w-3xl space-y-3">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-cyan-800 bg-cyan-50 border border-cyan-200 px-3 py-1 rounded-full inline-block">
                CLINICAL SPECIFICATIONS · FLIP TO INSPECT
              </span>
              <SplitText
                text="Medical standards engineered with precision."
                tag="h2"
                className="text-3xl sm:text-4xl lg:text-[42px] font-bold text-slate-950 tracking-tight leading-tight"
              />
              <p className="text-lg sm:text-xl text-slate-600 font-normal leading-relaxed">
                Click any card to flip between clinical workflow narrative and underlying data schemas.
              </p>
            </div>

            {/* Flip Card Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
              
              {/* Flip Card 1: ESI Triage */}
              <ClinicalFlipCard
                category="TRIAGE PROTOCOL"
                title="Emergency Severity Index (ESI 1–5)"
                frontSnippet="Classifies clinical urgency using objective criteria. Separates immediate resuscitation emergencies from routine ambulatory cases."
                frontBadge="Validated Protocol"
                frontIcon={<HeartPulse className="w-5 h-5" />}
                backTitle="ESI 1–5 PROTOCOL SCHEMA"
                backItems={[
                  { label: "LEVEL 1 (RESUSCITATION)", value: "Immediate life-threat (cardiac arrest, airway compromise)" },
                  { label: "LEVEL 2 (EMERGENT)", value: "High risk chest pain, stroke symptoms, acute confusion" },
                  { label: "LEVEL 3 (URGENT)", value: "Requires 2+ diagnostic resources, stable vitals" },
                  { label: "LEVEL 4-5 (NON-URGENT)", value: "Ambulatory care, 0-1 diagnostic resource required" },
                ]}
                backNote="MedVoice automatically escalates any ACS or stroke red flag to ESI-1/2 with emergency ED telemetry."
              />

              {/* Flip Card 2: HL7 FHIR R4 */}
              <ClinicalFlipCard
                category="EHR INTEROPERABILITY"
                title="HL7 FHIR R4 Encounter Bundles"
                frontSnippet="Compiles clinical dialogues into standardized FHIR JSON documents ready for direct ingest into Epic, Cerner, or hospital EHR systems."
                frontBadge="FHIR R4 Verified"
                frontIcon={<FileText className="w-5 h-5" />}
                backTitle="FHIR R4 RESOURCE MAPPING"
                backItems={[
                  { label: "ENCOUNTER", value: "Encounter.status = 'finished', class = 'VR' (virtual)" },
                  { label: "CONDITION (ICD-10)", value: "Mapped clinical code with verification status 'confirmed'" },
                  { label: "OBSERVATION", value: "Patient-reported vitals and subjective pain intensity" },
                  { label: "DOCUMENTREFERENCE", value: "Complete structured SOAP clinical note attachment" },
                ]}
                backNote="Includes SHA-256 cryptographic audit hash for immutable record verification."
              />

              {/* Flip Card 3: ICD-10 NLP Mining */}
              <ClinicalFlipCard
                category="NLP ENTITY EXTRACTION"
                title="Continuous Symptom & ICD-10 Mining"
                frontSnippet="Filters background room acoustics and conversational hesitation to isolate chief complaints and duration with local Whisper base.en transcription."
                frontBadge="Whisper base.en"
                frontIcon={<Activity className="w-5 h-5" />}
                backTitle="NLP EXTRACTION PIPELINE"
                backItems={[
                  { label: "AUDIO STREAM", value: "Turn-based MediaRecorder audio capture with noise isolation" },
                  { label: "ENTITY IDENTIFIER", value: "Bi-directional clinical context and symptom duration parser" },
                  { label: "CODE RECONCILIATION", value: "Automated mapping to ICD-10-CM diagnostic categories" },
                  { label: "CONFIDENCE SCORE", value: "Deterministic thresholding (>95% clinical consensus)" },
                ]}
                backNote="Ephemeral voice handling: temporary audio files deleted immediately after transcription."
              />

            </div>

          </div>
        </section>

        {/* ================================================================ */}
        {/* 7. CARE NETWORK TEASER                                           */}
        {/* ================================================================ */}
        <section id="care" className="py-20 sm:py-28 bg-white border-b border-slate-200/80">
          <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-12">
            
            <div className="flex flex-col lg:flex-row lg:items-end justify-between mb-12 gap-6">
              <div className="max-w-2xl space-y-3">
                <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-cyan-800 bg-cyan-50 border border-cyan-200 px-3 py-1 rounded-full inline-block">
                  CARE NETWORK DISPATCH
                </span>
                <h2 className="text-3xl sm:text-4xl lg:text-[42px] font-bold text-slate-950 tracking-tight leading-tight">
                  Intelligent Emergency Hospital Routing.
                </h2>
                <p className="text-lg sm:text-xl text-slate-600 font-normal leading-relaxed">
                  Real-time routing to accredited Level-1 trauma centers and specialty emergency departments, calculated using canonical road network travel times.
                </p>
              </div>

              <Link href="/care">
                <PremiumButton
                  variant="primary"
                  size="md"
                  icon={<Navigation className="w-4 h-4 text-cyan-400" />}
                >
                  Open Full Interactive Map
                </PremiumButton>
              </Link>
            </div>

            {/* City Preset Surface */}
            <div className="bg-[#FAF9F6] border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-3 max-w-xl">
                <div className="flex items-center gap-2 text-xs font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full inline-flex">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>24/7 VERIFIED EMERGENCY CAPABILITIES</span>
                </div>
                <h3 className="text-2xl font-bold text-slate-950">
                  Regional Medical Network Active
                </h3>
                <p className="text-sm sm:text-base text-slate-600 leading-relaxed font-normal">
                  Covering verified trauma facilities across Vijayawada, Guntur, Hyderabad, Bengaluru, Mumbai, and Delhi NCR with automated pre-arrival telemetry.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
                {["Vijayawada", "Guntur", "Hyderabad", "Bengaluru", "Mumbai", "Delhi NCR"].map((city) => (
                  <Link
                    key={city}
                    href="/care"
                    className="font-mono text-xs font-semibold px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-cyan-400 hover:text-cyan-800 transition-colors shadow-2xs"
                  >
                    {city}
                  </Link>
                ))}
              </div>
            </div>

          </div>
        </section>

        {/* ================================================================ */}
        {/* 8. FAQ ACCORDION                                                 */}
        {/* ================================================================ */}
        <section id="faq" className="py-20 sm:py-28 bg-[#FAF9F6]">
          <div className="max-w-4xl mx-auto px-6 sm:px-8 space-y-12">
            
            <div className="text-center space-y-3">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.1em] text-slate-500 block">
                FREQUENTLY ASKED QUESTIONS
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-950 tracking-tight">
                Your questions, answered.
              </h2>
            </div>

            <div className="divide-y divide-slate-200/90 border-t border-b border-slate-200/90 bg-white rounded-3xl p-6 sm:p-8 shadow-xs border">
              {FAQS.map((item, i) => {
                const isOpen = openFaq === i;
                return (
                  <div key={item.q} className="py-5 first:pt-2 last:pb-2">
                    <button
                      onClick={() => setOpenFaq(isOpen ? null : i)}
                      className="w-full flex items-start justify-between gap-6 text-left cursor-pointer group"
                      aria-expanded={isOpen}
                    >
                      <span className="flex items-start gap-3.5">
                        <span className="font-mono text-xs font-bold text-slate-400 pt-1 tracking-widest shrink-0">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-base sm:text-lg font-bold text-slate-950 group-hover:text-cyan-700 transition-colors">
                          {item.q}
                        </span>
                      </span>
                      <span className="shrink-0 pt-1 text-slate-400">
                        {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
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

      {/* ================================================================ */}
      {/* 9. FINAL PAYOFF BANNER (WITH CURSORGRID) & UNIFIED CLINICAL FOOTER */}
      {/* ================================================================ */}
      <section className="relative border-b border-slate-800 bg-[#0B0F17] py-20 sm:py-28 px-6 text-center overflow-hidden">
        {/* Interactive CursorGrid Background */}
        <div className="absolute inset-0 z-0">
          <CursorGrid
            cellSize={70}
            colors={["#00F0FF", "#3B82F6", "#8B5CF6", "#D946EF"]}
            radius={140}
            falloff="smooth"
            holdTime={400}
            fadeDuration={800}
            lineWidth={1.2}
            maxOpacity={1}
            fillOpacity={0.08}
            gridOpacity={0}
            cellRadius={0}
            clickPulse
            pulseSpeed={600}
          />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto space-y-6 pointer-events-none">
          <span className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400">
            LISTEN · UNDERSTAND · ACT
          </span>
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
            Start a Voice Consultation
          </h2>
          <p className="text-base sm:text-lg text-slate-300 max-w-xl mx-auto font-normal leading-relaxed">
            Experience instant medical voice triage, continuous ICD-10 extraction, and automated SOAP clinical documentation.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link
              href="/consult"
              className="pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white px-7 py-3.5 text-sm font-bold shadow-lg transition-all cursor-pointer"
            >
              <span>Launch Voice Consult Room →</span>
            </Link>
            <Link
              href="/care"
              className="pointer-events-auto inline-flex items-center gap-2 text-slate-300 hover:text-white px-5 py-3 text-sm font-semibold transition-all cursor-pointer"
            >
              <span>Explore Care Network</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Unified Application Footer */}
      <AppFooter />
    </div>
  );
}