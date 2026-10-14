"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
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
  AlertTriangle,
  Radio,
  ChevronRight,
  Plus,
  Minus,
  Stethoscope,
  Check,
  ExternalLink
} from "lucide-react";
import { AppFooter } from "./_components/AppFooter";
import { CursorGrid } from "@/components/CursorGrid";
import { MedicalHeroDashboardPreview } from "./_components/MedicalHeroDashboardPreview";
import { SpotlightCard } from "@/components/motion/SpotlightCard";
import Stepper, { Step } from "@/components/Stepper";
import AnimatedContent from "@/components/AnimatedContent";
import ScrollReveal from "@/components/ScrollReveal";
import { OptionWheel, OptionWheelItem } from "@/components/navigation/OptionWheel";
import StarBorder from "@/components/ui/StarBorder";
import { AuroraRibbonBackground } from "@/components/hero/AuroraRibbonBackground";


// Clinical Scenarios for OptionWheel
const HERO_SCENARIOS: OptionWheelItem[] = [
  {
    id: "emergency",
    label: "Emergency ER Escalation",
    category: "CRITICAL TRIAGE",
    badge: "ESI Level 1-2",
    badgeStyle: "bg-slate-950 text-white border-slate-900",
  },
  {
    id: "pediatric",
    label: "Same-Day Pediatric Care",
    category: "URGENT INTAKE",
    badge: "Priority Outpatient",
    badgeStyle: "bg-slate-900 text-white border-slate-800",
  },
  {
    id: "cardiac",
    label: "Cardiology Deliberation",
    category: "SPECIALTY CLINICAL",
    badge: "Multi-Agent Board",
    badgeStyle: "bg-slate-950 text-white border-slate-900",
  },
  {
    id: "refill",
    label: "Post-Op Rx Medication Refill",
    category: "AMBULATORY CARE",
    badge: "Automated Verification",
    badgeStyle: "bg-slate-900 text-white border-slate-800",
  },
  {
    id: "telehealth",
    label: "Routine Telehealth Intake",
    category: "GENERAL PRACTICE",
    badge: "Standard ESI 4-5",
    badgeStyle: "bg-slate-950 text-white border-slate-900",
  },
];

// Clinical Stage Card Interface
interface ClinicalStageCard {
  step: string;
  tag: string;
  title: string;
  description: string;
  highlightBadge: string;
  badgeColor: string;
  metric?: string;
  content: React.ReactNode;
}

// Four Dedicated Clinical Stages for Stepper & AnimatedContent
const CLINICAL_STAGE_CARDS: ClinicalStageCard[] = [
  {
    step: "01",
    tag: "LISTEN",
    title: "Local Whisper Speech Intake",
    description: "Captures natural patient speech via MediaRecorder and transcribes it locally using Whisper base.en. Background room acoustics and conversational hesitation are handled in transient memory with zero audio persistence.",
    highlightBadge: "Local base.en Engine · Ephemeral Buffer",
    badgeColor: "text-slate-900 bg-slate-100 border-slate-200",
    metric: "Local Whisper ASR (1.68s on CPU)",
    content: (
      <div className="space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-slate-500">
          <span>PATIENT CALL: #9042</span>
          <span className="text-emerald-600 font-bold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
            STREAM ACTIVE
          </span>
        </div>
        <p className="text-slate-900 italic font-sans text-sm font-medium leading-relaxed">
          &quot;I&apos;ve had severe crushing chest discomfort since morning radiating to my left arm with cold sweats and shortness of breath...&quot;
        </p>
        <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-900">
          <Radio className="w-3.5 h-3.5 animate-pulse text-slate-950" />
          <span>Local Whisper ASR · Ephemeral Audio Scrub · In-Memory Buffer</span>
        </div>
      </div>
    ),
  },
  {
    step: "02",
    tag: "UNDERSTAND",
    title: "Structured Symptom & ICD-10 Extraction",
    description: "As dialogue unfolds, the clinical evidence extractor parses chief complaints, duration, severity, and explicit patient denials, cross-referencing candidate symptoms against standardized ICD-10-CM concepts.",
    highlightBadge: "ICD-10-Assisted Coding · Clause Negation Preservation",
    badgeColor: "text-slate-900 bg-slate-100 border-slate-200",
    metric: "Multi-Clause Extraction Bus",
    content: (
      <div className="space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-slate-500">
          <span>CLINICAL EVIDENCE BUS</span>
          <span className="text-slate-950 font-bold">ICD-10-CM MAPPED</span>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <span className="px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200 font-bold">
            R07.9 Chest Pain (Acute)
          </span>
          <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-900 border border-slate-200 font-bold">
            R61 Diaphoresis
          </span>
          <span className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-bold">
            R06.02 Dyspnea
          </span>
        </div>
        <p className="text-[11px] text-slate-600 font-sans">
          Chief complaint duration: 6 hours · Radiation: Left arm · Onset: Acute · Denies trauma
        </p>
      </div>
    ),
  },
  {
    step: "03",
    tag: "ASSESS",
    title: "Deterministic ESI Urgency Stratification",
    description: "Evaluates clinical presentations against the 5-level Emergency Severity Index. Separates life-threatening cardiac, stroke, and airway red flags from routine outpatient cases with mathematical safety precedence.",
    highlightBadge: "ESI Level 1-5 · Deterministic Safety Arbiter",
    badgeColor: "text-rose-800 bg-rose-50 border-rose-200",
    metric: "ESI Level 2 · Emergent Resuscitation",
    content: (
      <div className="space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
          <span className="text-slate-500">TRIAGE CLASSIFICATION</span>
          <span className="text-rose-700 font-bold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            HIGH RISK CHEST PAIN
          </span>
        </div>
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 font-sans space-y-1.5">
          <div className="text-xs font-bold uppercase font-mono text-rose-700">
            ESI LEVEL 2 — EMERGENT RESUSCITATION
          </div>
          <p className="text-xs text-rose-800 leading-relaxed">
            High-risk acute coronary syndrome presentation with radiating chest discomfort and diaphoresis. Immediate emergency dispatch protocol engaged.
          </p>
        </div>
      </div>
    ),
  },
  {
    step: "04",
    tag: "ACT",
    title: "Emergency Care Network & ED Dispatch",
    description: "Filters regional medical centers by verified medical capabilities (such as 24/7 Level-1 Trauma or STEMI Cath Lab) and calculates canonical road travel times to coordinate pre-arrival notification.",
    highlightBadge: "Level-1 Trauma Routing · OSRM Road Reachability",
    badgeColor: "text-slate-900 bg-slate-100 border-slate-200",
    metric: "8.4 km · ~16 min ETA",
    content: (
      <div className="space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-slate-500">
          <span>CARE NETWORK COORDINATION</span>
          <span className="text-slate-950 font-bold">PRE-ARRIVAL TELEMETRY ACTIVE</span>
        </div>
        <div className="space-y-1.5 font-sans">
          <div className="text-xs font-bold text-slate-950">
            Regional Level-1 Emergency & Trauma Center
          </div>
          <p className="text-xs text-slate-600 font-mono">
            Vijayawada Hub · 24/7 STEMI Cath Lab & Comprehensive Stroke Center
          </p>
          <div className="flex items-center gap-2 pt-1 font-mono text-[11px] text-slate-900">
            <Navigation className="w-3.5 h-3.5 text-slate-950" />
            <span>Canonical Road Distance: 8.4 km (~16 min drive time)</span>
          </div>
        </div>
      </div>
    ),
  },
];

// Regional Presets for Care Network
const REGIONAL_HUBS = [
  {
    city: "Vijayawada",
    center: "Regional Level-1 Emergency & Trauma Center",
    specialty: "24/7 STEMI Cath Lab & Trauma Resuscitation",
    distance: "8.4 km",
    eta: "~16 min",
  },
  {
    city: "Guntur",
    center: "Government General Hospital & Emergency Unit",
    specialty: "Comprehensive Acute Stroke & Resuscitation Center",
    distance: "12.1 km",
    eta: "~22 min",
  },
  {
    city: "Hyderabad",
    center: "NIMS Apex Medical Center",
    specialty: "Cardiovascular ICU & Level-1 Poly-Trauma",
    distance: "6.2 km",
    eta: "~14 min",
  },
  {
    city: "Bengaluru",
    center: "Victoria Hospital Emergency Wing",
    specialty: "Advanced Burn & Pediatric Trauma Hub",
    distance: "9.5 km",
    eta: "~19 min",
  },
  {
    city: "Mumbai",
    center: "KEM Hospital Emergency Medical Services",
    specialty: "Comprehensive 24/7 Emergency Medicine",
    distance: "5.8 km",
    eta: "~13 min",
  },
  {
    city: "Delhi NCR",
    center: "AIIMS Apex Trauma Center",
    specialty: "National Level-1 Trauma & Critical Care",
    distance: "7.3 km",
    eta: "~15 min",
  },
];

// FAQs with Rigorous Clinical & Technical Governance
const FAQS = [
  {
    q: "Is MedVoice a replacement for a licensed physician or emergency services?",
    a: "No. MedVoice is an investigational clinical decision-support and triage assistant. It is designed to streamline intake, extract structured symptoms, and route patients to appropriate care faster. In any medical emergency, callers are instructed to dial 112, 108, or 911 immediately.",
  },
  {
    q: "How does MedVoice safeguard patient voice audio and data privacy?",
    a: "MedVoice enforces an ephemeral voice processing architecture. Audio streams are transcribed in-memory via local Whisper ASR to extract clinical entities and SOAP notes; the raw audio recording is discarded immediately after transcription.",
  },
  {
    q: "Can clinical encounters be exported to hospital EHR systems (Epic / Cerner)?",
    a: "Yes. Completed encounters automatically generate standardized HL7 FHIR R4 bundles, incorporating Encounter, Condition (ICD-10-CM), Observation, and DocumentReference resources with cryptographic SHA-256 audit hashes.",
  },
  {
    q: "How are hospital emergency routing destinations calculated?",
    a: "Facilities are filtered by verified clinical capability (such as 24/7 Level-1 Trauma or Comprehensive Stroke Center accreditation). Travel times are calculated using canonical road network routing engines (OSRM) rather than straight-line approximations.",
  },
  {
    q: "What happens if a caller describes life-threatening symptoms?",
    a: "The deterministic clinical safety arbiter immediately preempts conversational dialogue, activates the emergency escalation protocol, directs the caller to emergency phone numbers, and coordinates pre-arrival notification.",
  },
];

export default function HomePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [selectedScenario, setSelectedScenario] = useState<string>("emergency");
  const [selectedHub, setSelectedHub] = useState<string>("Vijayawada");
  const [activeStageStep, setActiveStageStep] = useState<number>(1);

  const isProgrammaticScrollRef = React.useRef(false);
  const scrollTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const cardRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  const handleStageStepChange = (newStep: number) => {
    setActiveStageStep(newStep);
    const targetCard = cardRefs.current[newStep - 1];
    if (targetCard) {
      isProgrammaticScrollRef.current = true;
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
      const rect = targetCard.getBoundingClientRect();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const targetY = scrollTop + rect.top - 120;
      window.scrollTo({
        top: targetY,
        behavior: "smooth",
      });
      scrollTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 850);
    }
  };

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    let rafId: number | null = null;

    const updateActiveStep = () => {
      if (isProgrammaticScrollRef.current) return;

      const cards = cardRefs.current.filter(Boolean) as HTMLDivElement[];
      if (cards.length === 0) return;

      // Focal activation line below the floating navbar (~180px)
      const focalLine = 180;
      let activeIdx = 0;

      for (let i = 0; i < cards.length; i++) {
        const rect = cards[i].getBoundingClientRect();
        if (rect.top <= focalLine && rect.bottom >= focalLine) {
          activeIdx = i;
          break;
        }
        if (i === 0 && rect.top > focalLine) {
          activeIdx = 0;
          break;
        }
        if (rect.bottom < focalLine) {
          activeIdx = i;
        }
      }

      const targetStep = activeIdx + 1;
      setActiveStageStep((prev) => (prev !== targetStep ? targetStep : prev));
    };

    const handleScroll = () => {
      if (isProgrammaticScrollRef.current) return;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateActiveStep();
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });

    // Initial evaluation
    updateActiveStep();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  const currentHubData = REGIONAL_HUBS.find((h) => h.city === selectedHub) || REGIONAL_HUBS[0];

  return (
    <div className="relative min-h-screen bg-[#FAF9F6] text-slate-900 font-sans flex flex-col justify-between selection:bg-cyan-500 selection:text-white">
      
      <main className="w-full flex-1">
        {/* ================================================================ */}
        {/* 1. HERO SECTION: EDITORIAL COMPOSITION & CLINICAL PREVIEW       */}
        {/* ================================================================ */}
        <section style={{ paddingTop: '130px' }} className="relative pb-20 sm:pb-28 overflow-hidden">
          {/* Mathematically Periodic Procedural Aurora Ribbon Background */}
          <AuroraRibbonBackground mode="auto" />

          {/* Distinctive Geometric CursorGrid Background */}
          <div className="absolute inset-0 z-0 pointer-events-auto">
            <CursorGrid
              cellSize={68}
              colors={["#00F0FF", "#3B82F6", "#8B5CF6", "#D946EF"]}
              radius={150}
              falloff="smooth"
              holdTime={400}
              fadeDuration={800}
              lineWidth={1.2}
              maxOpacity={0.8}
              fillOpacity={0.05}
              gridOpacity={0.03}
              cellRadius={0}
              clickPulse
              pulseSpeed={600}
            />
          </div>

          {/* Vibrant Ambient Gradient Glows */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-gradient-to-tr from-cyan-400/12 via-indigo-400/10 to-purple-400/8 blur-[120px] rounded-full pointer-events-none -z-10" />

          <div className="relative z-10 max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-12 text-center pointer-events-none">
            
            {/* Super-title Badge */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-950 text-white shadow-xs mb-6 pointer-events-auto"
            >
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-white">
                MEDVOICE · CLINICAL VOICE AI
              </span>
            </motion.div>

            {/* Stable Headline: High-impact typography with vibrant cyan/blue/indigo/violet gradient accent */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="text-3xl sm:text-5xl lg:text-[68px] font-bold text-slate-950 tracking-tight leading-[1.14] max-w-4xl mx-auto px-2 sm:px-0"
            >
              Empathetic Voice AI for{" "}
              <span
                style={{
                  backgroundImage: "linear-gradient(90deg, #0891b2 0%, #2563eb 50%, #7c3aed 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
                className="inline-block max-w-full font-bold"
              >
                Immediate Clinical Triage
              </span>
            </motion.h1>

            {/* Concise Supporting Description */}
            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.22 }}
              className="mt-6 text-base sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed font-normal px-2 sm:px-0"
            >
              Transform conversational patient intake into continuous ICD-10 extraction, deterministic ESI urgency stratification, and automated SOAP documentation in real time.
            </motion.p>

            {/* Technical Trust Metadata Badges */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.28 }}
              className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 pt-6 pb-8"
            >
              <span className="font-mono text-[11px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-slate-800 bg-white/90 border border-slate-200/90 px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 shadow-2xs">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-950 shrink-0" />
                DETERMINISTIC ESI ARBITER
              </span>
              <span className="font-mono text-[11px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-slate-800 bg-white/90 border border-slate-200/90 px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 shadow-2xs">
                <Zap className="w-3.5 h-3.5 text-slate-950 shrink-0" />
                LOCAL WHISPER ASR
              </span>
              <span className="font-mono text-[11px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-slate-800 bg-white/90 border border-slate-200/90 px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 shadow-2xs">
                <FileText className="w-3.5 h-3.5 text-slate-950 shrink-0" />
                HL7 FHIR R4 READY
              </span>
              <span className="font-mono text-[11px] sm:text-xs font-semibold uppercase tracking-[0.08em] text-slate-800 bg-white/90 border border-slate-200/90 px-3.5 py-1.5 rounded-full inline-flex items-center gap-1.5 shadow-2xs">
                <Lock className="w-3.5 h-3.5 text-slate-950 shrink-0" />
                EPHEMERAL AUDIO SCRUB
              </span>
            </motion.div>

            {/* Deliberate Primary & Secondary CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.34 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-2 pb-14 pointer-events-auto w-full sm:w-auto"
            >
              <StarBorder
                as={Link}
                href="/consult"
                color="#0f172a"
                duration={3.5}
                theme="light"
                backgroundColor="linear-gradient(135deg, #090d16 0%, #0f172a 50%, #1e293b 100%)"
                textColor="#ffffff"
                borderColor="rgba(255, 255, 255, 0.25)"
                radius={16}
                className="cursor-pointer shadow-lg shadow-slate-950/20 hover:scale-[1.01] transition-all border border-slate-800 w-full sm:w-auto"
              >
                <div className="flex items-center justify-center gap-2.5 text-sm font-bold text-white tracking-wide py-1">
                  <div className="w-6 h-6 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center">
                    <Mic className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span>Start a Voice Consultation</span>
                  <ArrowRight className="w-4 h-4 text-slate-300 ml-0.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </StarBorder>

              <Link
                href="/care"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-900 hover:text-slate-950 px-6 py-3.5 text-sm font-semibold shadow-xs hover:border-slate-300 transition-all cursor-pointer"
              >
                <Navigation className="w-4 h-4 text-slate-950" />
                <span>Explore Care Network</span>
              </Link>
            </motion.div>

            {/* Restrained Clinical Interface Deck */}
            <div className="w-full max-w-6xl mx-auto pt-2 pointer-events-auto">
              <div className="flex flex-col lg:flex-row items-center lg:items-start gap-8 justify-center">
                
                {/* Left: Option Wheel Scenario Selector */}
                <div className="flex flex-col items-center lg:items-start space-y-3 lg:w-72 flex-shrink-0">
                  <div className="flex items-center gap-2 text-left font-mono">
                    <span className="w-2 h-2 rounded-full bg-slate-950" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-900">
                      Select Clinical Scenario
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 text-left font-sans leading-relaxed">
                    Rotate through patient intake scenarios to see live AI triage, symptom extraction, and hospital reachability.
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
                    spotlightColor="rgba(6, 182, 212, 0.14)"
                    spotlightRadius={380}
                    className="bg-white/95 border border-slate-200/90 rounded-3xl p-3 sm:p-5 shadow-[0_20px_60px_-15px_rgba(15,23,42,0.08)] backdrop-blur-xl"
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
        {/* 2. PRODUCT DEMONSTRATION: EDITORIAL STATEMENT & VALUE PIPELINE   */}
        {/* ================================================================ */}
        <section id="product-demo" className="py-24 sm:py-32 border-y border-slate-200/80 bg-gradient-to-b from-white via-cyan-50/20 to-white relative overflow-hidden">
          {/* Vibrant Accent Gradient Mesh */}
          <div className="absolute top-0 right-1/4 w-[500px] h-[300px] bg-gradient-to-bl from-blue-300/10 via-indigo-300/10 to-transparent blur-[100px] pointer-events-none" />

          <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-12 relative z-10">
            
            <div className="max-w-3xl mx-auto text-center mb-16 space-y-4">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-slate-900 bg-slate-100 border border-slate-200 px-3.5 py-1 rounded-full inline-block">
                FROM SPOKEN COMPLAINT TO CLINICAL CONTEXT
              </span>
              <h2 className="text-3xl sm:text-5xl font-bold text-slate-950 tracking-tight leading-tight">
                How spoken clinical complaints become{" "}
                <span
                  style={{
                    backgroundImage: "linear-gradient(90deg, #0891b2 0%, #2563eb 50%, #7c3aed 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                  className="font-bold inline-block"
                >
                  structured context.
                </span>
              </h2>
              <p className="text-base sm:text-lg text-slate-600 leading-relaxed font-normal">
                Every spoken clinical turn passes through local in-memory transcription, multi-clause concept mining, deterministic urgency stratification, and standardized EHR formatting.
              </p>
            </div>

            {/* Split Demonstration Architecture */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
              
              {/* Step A: Live Spoken Turn Input */}
              <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-7 flex flex-col justify-between shadow-[0_12px_36px_-8px_rgba(15,23,42,0.06)] hover:border-slate-300 transition-all">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-slate-900">01 / SPOKEN INTAKE</span>
                    <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-950">
                    Unstructured Voice Stream
                  </h3>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/90 text-slate-800 font-sans text-xs italic leading-relaxed">
                    &quot;I have severe crushing chest pressure that started while walking, radiating to my jaw, with cold sweating...&quot;
                  </div>
                </div>
                <div className="pt-6 border-t border-slate-100 space-y-1 font-mono text-[11px] text-slate-500">
                  <div className="flex justify-between">
                    <span>Engine:</span>
                    <span className="text-slate-900 font-semibold">Local Whisper ASR</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Acoustic Memory:</span>
                    <span className="text-emerald-700 font-semibold">Ephemeral in-memory scrub</span>
                  </div>
                </div>
              </div>

              {/* Step B: Structured Extraction */}
              <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-7 flex flex-col justify-between shadow-[0_12px_36px_-8px_rgba(15,23,42,0.06)] hover:border-slate-300 transition-all">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-slate-900">02 / ENTITY MINING</span>
                    <Activity className="w-4 h-4 text-slate-950" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-950">
                    Continuous ICD-10 Parsing
                  </h3>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200 font-mono text-xs font-bold">
                        R07.9 Chest Pain
                      </span>
                      <span className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-900 border border-slate-200 font-mono text-xs font-bold">
                        R61 Diaphoresis
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 font-sans leading-relaxed pt-1">
                      Radiation: Left jaw/arm · Onset: Acute exertional · Denies fever or trauma.
                    </div>
                  </div>
                </div>
                <div className="pt-6 border-t border-slate-100 space-y-1 font-mono text-[11px] text-slate-500">
                  <div className="flex justify-between">
                    <span>Negation Handling:</span>
                    <span className="text-slate-900 font-semibold">Clause-bound preserved</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Taxonomy:</span>
                    <span className="text-blue-700 font-semibold">ICD-10-CM Standard</span>
                  </div>
                </div>
              </div>

              {/* Step C: Deterministic Urgency & Dispatch */}
              <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-7 flex flex-col justify-between shadow-[0_12px_36px_-8px_rgba(15,23,42,0.06)] hover:border-rose-200 transition-all">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-rose-700">03 / ARBITRATION</span>
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-950">
                    Deterministic ESI Action
                  </h3>
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 space-y-1 text-xs">
                    <div className="font-mono font-bold text-rose-700 uppercase">
                      ESI Level 2 · Emergent
                    </div>
                    <p className="text-rose-800 leading-relaxed font-sans">
                      Acute Coronary Syndrome red flag triggered. Immediate EMS notification & Cath Lab pre-arrival routing.
                    </p>
                  </div>
                </div>
                <div className="pt-6 border-t border-slate-100 space-y-1 font-mono text-[11px] text-slate-500">
                  <div className="flex justify-between">
                    <span>Trauma Destination:</span>
                    <span className="text-slate-900 font-semibold">8.4 km (~16 min drive)</span>
                  </div>
                  <div className="flex justify-between">
                    <span>EHR Bundle:</span>
                    <span className="text-emerald-700 font-semibold">HL7 FHIR R4 Ready</span>
                  </div>
                </div>
              </div>

            </div>

            <div className="mt-8 text-center">
              <span className="font-mono text-[11px] text-slate-400 uppercase tracking-widest">
                [SYNTHETIC PATIENT SIMULATION · FOR DEMONSTRATION ONLY · NEVER REAL PATIENT DATA]
              </span>
            </div>

          </div>
        </section>

        {/* ================================================================ */}
        {/* 3. FOUR CLINICAL STAGES: STEPPER & ANIMATED CONTENT PIPELINE     */}
        {/* ================================================================ */}
        <section id="clinical-stages" className="py-24 sm:py-32 bg-[#FAF9F6] border-b border-slate-200/80 relative overflow-hidden">
          {/* Soft Ambient Radial Gradient */}
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-r from-cyan-400/8 via-blue-400/8 to-indigo-400/8 blur-[120px] pointer-events-none" />

          <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-12 text-center relative z-10">
            
            <div className="max-w-3xl mx-auto mb-14 space-y-4">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-slate-900 bg-slate-100 border border-slate-200 px-3.5 py-1 rounded-full inline-block">
                PROGRESSIVE CLINICAL PIPELINE
              </span>

              <ScrollReveal
                baseRotation={0}
                blurStrength={3}
                enableBlur={true}
                containerClassName="mx-auto my-0"
                textClassName="text-3xl sm:text-5xl font-bold text-slate-950 tracking-tight leading-tight"
              >
                Four deterministic stages,{" "}
                <span
                  style={{
                    backgroundImage: "linear-gradient(90deg, #0891b2 0%, #2563eb 50%, #7c3aed 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                  className="font-bold inline-block"
                >
                  every call.
                </span>
              </ScrollReveal>

              <p className="text-base sm:text-lg text-slate-600 font-normal leading-relaxed">
                As you scroll, observe each layer of the clinical decision process: from streaming speech intake to ICD-10 mining, deterministic ESI triage, and hospital network routing.
              </p>
            </div>

            {/* Official React Bits Stepper Navigation Bar */}
            <div className="max-w-xl mx-auto mb-14">
              <Stepper
                step={activeStageStep}
                onStepChange={handleStageStepChange}
                theme="light"
                accentColor="#0f172a"
                width="100%"
                hideContent
                className="w-full shadow-xs"
              >
                <Step title="Listen" />
                <Step title="Understand" />
                <Step title="Assess" />
                <Step title="Act" />
              </Stepper>
            </div>

            {/* Vertically Scrolling Clinical Stage Cards wrapped in AnimatedContent */}
            <div className="space-y-8 sm:space-y-10 max-w-4xl mx-auto text-left pb-16 sm:pb-24">
              {CLINICAL_STAGE_CARDS.map((card, index) => (
                <div
                  key={card.step}
                  id={`stage-card-${index + 1}`}
                  ref={(el) => {
                    cardRefs.current[index] = el;
                  }}
                  className="scroll-mt-28"
                >
                  <AnimatedContent
                    distance={28}
                    duration={0.6}
                    threshold={0.15}
                    ease="power3.out"
                    className="w-full"
                  >
                    <div className="w-full rounded-3xl min-h-[340px] sm:min-h-[360px] p-6 sm:p-9 bg-white border border-slate-200/90 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.08)]">
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center h-full">
                        {/* Left Information Side */}
                        <div className="lg:col-span-6 space-y-4 text-left">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-400">
                              {card.step}
                            </span>
                            <span className="text-slate-400">/</span>
                            <span
                              className={`font-mono text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border ${card.badgeColor}`}
                            >
                              {card.tag}
                            </span>
                          </div>

                          <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight text-slate-950">
                            {card.title}
                          </h3>

                          <p className="text-sm sm:text-base leading-relaxed font-normal text-slate-600">
                            {card.description}
                          </p>

                          <div className="pt-2 flex flex-wrap items-center gap-3">
                            <span className="font-mono text-xs font-semibold px-3 py-1.5 rounded-xl inline-block border text-slate-900 bg-slate-100 border-slate-200">
                              {card.highlightBadge}
                            </span>
                            {card.metric && (
                              <span className="font-mono text-xs font-medium text-slate-500">
                                {card.metric}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right Visual Clinical Slate */}
                        <div className="lg:col-span-6 w-full">
                          <div className="w-full rounded-2xl p-5 font-mono text-xs shadow-2xs border bg-slate-50 border-slate-200/90 text-slate-800">
                            {card.content}
                          </div>
                        </div>
                      </div>
                    </div>
                  </AnimatedContent>
                </div>
              ))}
            </div>

          </div>
        </section>

        {/* ================================================================ */}
        {/* 4. CAPABILITY STORIES: VARIED EDITORIAL LAYOUTS                   */}
        {/* ================================================================ */}
        <section id="capabilities" className="py-24 sm:py-32 bg-white border-b border-slate-200/80 relative overflow-hidden">
          {/* Vibrant Gradient Background Mesh */}
          <div className="absolute top-1/4 right-0 w-[600px] h-[500px] bg-gradient-to-bl from-cyan-400/8 via-violet-400/6 to-transparent blur-[110px] pointer-events-none" />
          <div className="absolute bottom-10 left-0 w-[500px] h-[400px] bg-gradient-to-tr from-blue-400/8 via-indigo-400/6 to-transparent blur-[110px] pointer-events-none" />

          <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-12 space-y-24 relative z-10">
            
            {/* Header */}
            <div className="max-w-3xl space-y-3">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-slate-900 bg-slate-100 border border-slate-200 px-3.5 py-1 rounded-full inline-block">
                CORE CLINICAL CAPABILITIES
              </span>
              <h2 className="text-3xl sm:text-5xl font-bold text-slate-950 tracking-tight leading-tight">
                Engineered for{" "}
                <span
                  style={{
                    backgroundImage: "linear-gradient(90deg, #0891b2 0%, #2563eb 50%, #7c3aed 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                  className="font-bold inline-block"
                >
                  medical precision
                </span>
                , privacy, and speed.
              </h2>
              <p className="text-base sm:text-lg text-slate-600 font-normal leading-relaxed">
                Replacing brittle monolithic assistants with modular clinical reasoning, mathematical safety guarantees, and automated documentation.
              </p>
            </div>

            {/* Layout 1: Split Text-Led Feature (Acoustic Privacy & In-Memory Scrub) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-6 space-y-4">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-900">
                  ACOUSTIC PRIVACY & ZERO PERSISTENCE
                </span>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-950 tracking-tight">
                  Audio processed in transient memory, discarded immediately.
                </h3>
                <p className="text-slate-600 leading-relaxed text-sm sm:text-base">
                  When a call terminates, the raw audio buffer is permanently scrubbed
                  from RAM within milliseconds. No human listens to call recordings, and
                  no audio files are ever persisted to disk or cloud object storage.
                </p>
                <div className="pt-2">
                  <Link
                    href="/privacy"
                    className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-slate-900 hover:text-slate-700 transition-colors"
                  >
                    <span>Read Acoustic Invariant Whitepaper</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>

              <div className="lg:col-span-6">
                <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 space-y-5 shadow-[0_12px_36px_-8px_rgba(15,23,42,0.06)]">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 font-mono text-xs text-slate-500">
                    <span>SECURITY INVARIANT</span>
                    <span className="text-emerald-600 font-bold">VERIFIED SECURE</span>
                  </div>
                  <div className="space-y-3 font-mono text-xs">
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                      <span className="text-slate-600">Raw Audio Buffer:</span>
                      <span className="text-rose-600 font-bold">PURGED POST-TRANSCRIPTION</span>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                      <span className="text-slate-600">Session Audit Hash:</span>
                      <span className="text-slate-950 font-bold">SHA-256 IMMUTABLE</span>
                    </div>
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                      <span className="text-slate-600">Storage Footprint:</span>
                      <span className="text-emerald-600 font-bold">ZERO PERSISTENT VOICE DATA</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Layout 2: Split Visual-Led Feature (Deterministic Safety Arbiter) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-6 order-2 lg:order-1">
                <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 space-y-5 shadow-[0_12px_36px_-8px_rgba(15,23,42,0.06)]">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 font-mono text-xs text-slate-500">
                    <span>DETERMINISTIC SAFETY ARBITER</span>
                    <span className="text-rose-600 font-bold">PREEMPTION HARNESS</span>
                  </div>
                  <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 space-y-2 text-rose-950 text-xs">
                    <div className="font-mono font-bold text-rose-700">
                      SAFETY PRECEDENCE INVARIANT
                    </div>
                    <p className="font-sans text-rose-800 leading-relaxed">
                      Life-threat indicators strictly override conversational flow. When acute criteria are satisfied, generative turns are preempted and callers are directed to emergency helplines.
                    </p>
                  </div>
                  <div className="space-y-2 font-mono text-[11px] text-slate-700">
                    <div className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Universal Red Flags across ACS, Stroke, and Pediatric Sepsis</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Non-deniable life-threat safety overrides</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Zero hallucinated diagnostic claims</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-6 space-y-4 order-1 lg:order-2">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-rose-700">
                  MATHEMATICAL SAFETY GOVERNANCE
                </span>
                <h3 className="text-2xl sm:text-3xl font-bold text-slate-950 tracking-tight">
                  Deterministic clinical safety, free from generative hallucination.
                </h3>
                <p className="text-sm sm:text-base text-slate-600 leading-relaxed font-normal">
                  Generative language models are helpful for natural dialogue, but clinical triage requires mathematical predictability. MedVoice couples natural voice conversation with a strictly deterministic safety arbiter that runs independently of LLM candidate tokens.
                </p>
                <div className="pt-2 flex flex-wrap gap-2">
                  <span className="font-mono text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl">
                    ESI v4 Algorithmic Alignment
                  </span>
                  <span className="font-mono text-xs font-semibold text-slate-900 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl">
                    100% Deterministic Safety Invariants
                  </span>
                </div>
              </div>
            </div>

            {/* Layout 3: 3-Column Capabilities Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
              
              <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-7 space-y-4 shadow-[0_12px_36px_-8px_rgba(15,23,42,0.06)] hover:border-slate-300 transition-all">
                <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200/80 w-fit text-slate-950">
                  <FileText className="w-5 h-5" />
                </div>
                <h4 className="text-lg font-bold text-slate-950">
                  Automated SOAP Charting
                </h4>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal">
                  Synthesizes Subjective history, Objective reported vitals, Assessment urgency, and Plan next steps formatted in standard clinical documentation.
                </p>
              </div>

              <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-7 space-y-4 shadow-[0_12px_36px_-8px_rgba(15,23,42,0.06)] hover:border-slate-300 transition-all">
                <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200/80 w-fit text-slate-950">
                  <Database className="w-5 h-5" />
                </div>
                <h4 className="text-lg font-bold text-slate-950">
                  HL7 FHIR R4 Bundles
                </h4>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal">
                  Compiles clinical dialogues into standardized FHIR JSON documents ready for direct ingestion into Epic, Cerner, or hospital EHR systems.
                </p>
              </div>

              <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-7 space-y-4 shadow-[0_12px_36px_-8px_rgba(15,23,42,0.06)] hover:border-slate-300 transition-all">
                <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200/80 w-fit text-slate-950">
                  <Stethoscope className="w-5 h-5" />
                </div>
                <h4 className="text-lg font-bold text-slate-950">
                  Specialist Board Reasoning
                </h4>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal">
                  Modular clinical personas (Emergency Medicine, Cardiology, Pediatrics, General Practice) that deliberate on complex multi-clause presentations.
                </p>
              </div>

            </div>

          </div>
        </section>

        {/* ================================================================ */}
        {/* 5. CARE NETWORK PREVIEW: REGIONAL REACHABILITY & TRAVEL TIMES    */}
        {/* ================================================================ */}
        <section id="care" className="py-24 sm:py-32 bg-[#FAF9F6] border-b border-slate-200/80 relative overflow-hidden">
          {/* Vibrant Cyan-Blue Gradient Mesh */}
          <div className="absolute top-1/2 left-1/3 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-r from-cyan-400/8 via-blue-400/8 to-transparent blur-[110px] pointer-events-none" />

          <div className="max-w-[1440px] mx-auto px-6 sm:px-8 lg:px-12 space-y-12 relative z-10">
            
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
              <div className="max-w-2xl space-y-3">
                <span className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-slate-900 bg-slate-100 border border-slate-200 px-3.5 py-1 rounded-full inline-block">
                  CARE NETWORK COORDINATION
                </span>
                <h2 className="text-3xl sm:text-5xl font-bold text-slate-950 tracking-tight leading-tight">
                  Verified hospital coordination and{" "}
                  <span
                    style={{
                      backgroundImage: "linear-gradient(90deg, #0891b2 0%, #2563eb 50%, #7c3aed 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                    className="font-bold inline-block"
                  >
                    travel times.
                  </span>
                </h2>
                <p className="text-base sm:text-lg text-slate-600 font-normal leading-relaxed">
                  Real-time routing to accredited Level-1 trauma centers and specialty emergency departments, calculated using canonical road network travel times.
                </p>
              </div>

              <Link
                href="/care"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 hover:bg-slate-800 text-white px-6 py-3.5 text-sm font-bold shadow-xs active:scale-[0.98] transition-all cursor-pointer shrink-0 border border-slate-900"
              >
                <Navigation className="w-4 h-4 text-white" />
                <span>Open Full Interactive Map →</span>
              </Link>
            </div>

            {/* City Preset Interactive Preview Surface */}
            <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-[0_16px_40px_-10px_rgba(15,23,42,0.08)] flex flex-col lg:flex-row items-center justify-between gap-8">
              
              <div className="space-y-4 max-w-xl text-left">
                <div className="flex items-center gap-2 text-xs font-mono text-slate-900 bg-slate-100 border border-slate-200 px-3 py-1 rounded-full inline-flex">
                  <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />
                  <span>24/7 VERIFIED EMERGENCY CAPABILITIES</span>
                </div>
                <h3 className="text-2xl font-bold text-slate-950">
                  {currentHubData.center}
                </h3>
                <p className="text-sm text-slate-700 font-mono font-medium">
                  {currentHubData.specialty}
                </p>
                <div className="flex items-center gap-4 pt-1 font-mono text-xs text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Navigation className="w-3.5 h-3.5 text-slate-950" />
                    <span>Canonical Road Distance: <strong className="text-slate-950">{currentHubData.distance}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-950" />
                    <span>Est. Drive Time: <strong className="text-slate-950">{currentHubData.eta}</strong></span>
                  </div>
                </div>
              </div>

              {/* City Preset Pills */}
              <div className="flex flex-wrap items-center gap-2 justify-start lg:justify-end max-w-md" role="radiogroup" aria-label="Regional Hospital Hubs">
                {REGIONAL_HUBS.map((hub) => {
                  const isActive = hub.city === selectedHub;
                  return (
                    <button
                      key={hub.city}
                      onClick={() => setSelectedHub(hub.city)}
                      role="radio"
                      aria-checked={isActive}
                      className={`font-mono text-xs px-4 py-2 rounded-xl border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 active:scale-[0.97] ${
                        isActive
                          ? "bg-slate-950 text-white border-slate-950 shadow-xs font-bold"
                          : "bg-white/80 text-slate-700 border-slate-200/80 hover:bg-slate-100 hover:text-slate-950 font-semibold shadow-2xs"
                      }`}
                    >
                      {hub.city}
                    </button>
                  );
                })}
              </div>

            </div>

          </div>
        </section>

        {/* ================================================================ */}
        {/* 6. FAQ ACCORDION: GOVERNANCE, SAFETY & EHR INTEROPERABILITY       */}
        {/* ================================================================ */}
        <section id="faq" className="py-24 sm:py-32 bg-white border-b border-slate-200/80 relative overflow-hidden">
          <div className="max-w-4xl mx-auto px-6 sm:px-8 space-y-12 relative z-10">
            
            <div className="text-center space-y-3">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-slate-500 block">
                FREQUENTLY ASKED QUESTIONS
              </span>
              <h2 className="text-3xl sm:text-5xl font-bold text-slate-950 tracking-tight">
                Your questions,{" "}
                <span
                  style={{
                    backgroundImage: "linear-gradient(90deg, #0891b2 0%, #2563eb 50%, #7c3aed 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                  className="font-bold inline-block"
                >
                  answered.
                </span>
              </h2>
              <p className="text-base text-slate-600 max-w-xl mx-auto">
                Transparent guidance on clinical governance, patient privacy, and algorithmic safety.
              </p>
            </div>

            <div className="divide-y divide-slate-100 bg-white rounded-3xl p-6 sm:p-8 shadow-[0_16px_40px_-10px_rgba(15,23,42,0.08)] border border-slate-200/90">
              {FAQS.map((item, i) => {
                const isOpen = openFaq === i;
                return (
                  <div key={item.q} className="py-5 first:pt-2 last:pb-2">
                    <button
                      onClick={() => setOpenFaq(isOpen ? null : i)}
                      className="w-full flex items-start justify-between gap-6 text-left cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded-xl"
                      aria-expanded={isOpen}
                      aria-controls={`faq-ans-${i}`}
                    >
                      <span className="flex items-start gap-3.5">
                        <span className="font-mono text-xs font-bold text-slate-900 pt-1 tracking-widest shrink-0">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-base sm:text-lg font-bold text-slate-950 group-hover:text-slate-700 transition-colors">
                          {item.q}
                        </span>
                      </span>
                      <span className="shrink-0 pt-1 text-slate-900 group-hover:text-slate-700 transition-colors">
                        {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      </span>
                    </button>
                    {isOpen && (
                      <p id={`faq-ans-${i}`} role="region" className="mt-3 ml-8 text-sm sm:text-base text-slate-600 leading-relaxed font-normal">
                        {item.a}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
        </section>

        {/* ================================================================ */}
        {/* 7. SIGNATURE CLOSING CTA: GEOMETRIC TILE GRID & ACTIONS          */}
        {/* ================================================================ */}
        <section id="cta" className="relative border-b border-slate-200/80 bg-gradient-to-b from-[#FAF9F6] via-white to-cyan-50/30 py-24 sm:py-32 px-6 text-center overflow-hidden">
          {/* Interactive CursorGrid Tile Background */}
          <div className="absolute inset-0 z-0">
            <CursorGrid
              cellSize={70}
              colors={["#00F0FF", "#3B82F6", "#8B5CF6", "#D946EF"]}
              radius={150}
              falloff="smooth"
              holdTime={400}
              fadeDuration={800}
              lineWidth={1.2}
              maxOpacity={0.8}
              fillOpacity={0.05}
              gridOpacity={0.03}
              cellRadius={0}
              clickPulse
              pulseSpeed={600}
            />
          </div>

          {/* Vibrant Ambient Glow behind CTA */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-gradient-to-r from-cyan-400/10 via-indigo-400/10 to-violet-400/10 blur-[100px] pointer-events-none" />

          <div className="relative z-10 max-w-3xl mx-auto space-y-6 pointer-events-none">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-900 bg-slate-100 border border-slate-200 px-3.5 py-1 rounded-full inline-block">
              LISTEN · UNDERSTAND · ASSESS · ACT
            </span>
            <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-950 tracking-tight leading-tight">
              Start a{" "}
              <span
                style={{
                  backgroundImage: "linear-gradient(90deg, #0891b2 0%, #2563eb 50%, #7c3aed 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
                className="font-extrabold inline-block"
              >
                Voice Consultation
              </span>
            </h2>
            <p className="text-base sm:text-lg text-slate-600 max-w-xl mx-auto font-normal leading-relaxed">
              Experience instant medical voice triage, continuous ICD-10 extraction, and automated SOAP clinical documentation.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Link
                href="/consult"
                style={{
                  background: "linear-gradient(90deg, #0891b2 0%, #2563eb 50%, #7c3aed 100%)",
                }}
                className="pointer-events-auto inline-flex items-center gap-2 rounded-2xl text-white px-8 py-4 text-sm font-bold shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:scale-[1.01] transition-all cursor-pointer"
              >
                <span>Launch Voice Consult Room →</span>
              </Link>
              <Link
                href="/care"
                className="pointer-events-auto inline-flex items-center gap-2 text-slate-700 hover:text-slate-950 px-6 py-4 text-sm font-semibold transition-all cursor-pointer rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 shadow-xs"
              >
                <span>Explore Care Network</span>
              </Link>
            </div>
          </div>
        </section>

      </main>

      {/* ================================================================ */}
      {/* 8. UNIFIED SHARED APPLICATION FOOTER                             */}
      {/* ================================================================ */}
      <AppFooter />
    </div>
  );
}