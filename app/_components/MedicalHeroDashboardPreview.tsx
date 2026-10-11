"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence, MotionValue, useTransform } from "framer-motion";
import {
  Mic,
  MicOff,
  Volume2,
  Sparkles,
  CheckCircle2,
  User,
  ShieldCheck,
  Calendar,
  Clock,
  ArrowRight,
  Activity,
  HeartPulse,
  Database,
  Lock,
  Globe,
  AlertTriangle,
  Navigation,
  FileText,
  Radio,
  Pill
} from "lucide-react";

export interface HeroCallScenario {
  id: string;
  title: string;
  category: string;
  patientName: string;
  patientDetails: string;
  esiLevel: string;
  esiBadgeStyle: string;
  duration: string;
  waveformColor: string;
  dialogue: {
    speaker: "Patient" | "MedVoice AI";
    text: string;
    time: string;
  }[];
  icd10: { code: string; label: string };
  actionPill: string;
  outcomes: string[];
}

export const HERO_CALL_SCENARIOS: HeroCallScenario[] = [
  {
    id: "emergency",
    title: "Emergency ER Escalation",
    category: "CRITICAL TRIAGE",
    patientName: "Robert Miller (58yo M)",
    patientDetails: "MRN #884920 · Acute Cardiac Presentation",
    esiLevel: "ESI Level 2 · Emergent",
    esiBadgeStyle: "bg-rose-50 text-rose-700 border-rose-200/90 font-bold",
    duration: "00:48",
    waveformColor: "from-rose-500 via-red-400 to-amber-400",
    dialogue: [
      {
        speaker: "Patient",
        text: "I'm having sudden heavy crushing chest pressure radiating to my left arm... cold sweats and shortness of breath...",
        time: "00:08",
      },
      {
        speaker: "MedVoice AI",
        text: "Robert, immediate emergency care is required. ESI Level 2 cardiac protocol activated. Dispatching pre-arrival alert to Vijayawada Level-1 Trauma Cath Lab.",
        time: "00:22",
      },
    ],
    icd10: { code: "ICD-10 R07.9", label: "Acute Chest Pain (Unspecified)" },
    actionPill: "Cath Lab Pre-Arrival Ready (8.4 km · ~16 min)",
    outcomes: [
      "911 Emergency Dispatch Alerted",
      "Direct Warm Transfer to On-Call Cardiologist",
      "Pre-Arrival STEMI Alert Sent to ED",
    ],
  },
  {
    id: "pediatric",
    title: "Same-Day Pediatric Care",
    category: "URGENT INTAKE",
    patientName: "Sarah Vance (for Leo, 4yo)",
    patientDetails: "MRN #394012 · Pediatric Fever & Cough",
    esiLevel: "ESI Level 3 · Urgent",
    esiBadgeStyle: "bg-amber-50 text-amber-700 border-amber-200/90 font-semibold",
    duration: "01:14",
    waveformColor: "from-teal-500 via-cyan-400 to-blue-500",
    dialogue: [
      {
        speaker: "Patient",
        text: "My 4-year-old son Leo has a fever of 102.4°F and a persistent barking cough. He's lethargic but drinking water.",
        time: "00:12",
      },
      {
        speaker: "MedVoice AI",
        text: "Understood Sarah. Since Leo is drinking fluids, I have reserved an urgent same-day pediatric slot with Dr. Vance at 2:30 PM. Sending pediatric fever instructions.",
        time: "00:28",
      },
    ],
    icd10: { code: "ICD-10 J05.0", label: "Acute Laryngotracheitis (Croup)" },
    actionPill: "Same-Day Telehealth Confirmed (2:30 PM)",
    outcomes: [
      "Urgent Same-Day Outpatient Reserved",
      "Pediatric Care Instructions Sent via SMS",
      "SOAP Note Pushed to Epic EHR",
    ],
  },
  {
    id: "cardiac",
    title: "Cardiology Deliberation",
    category: "SPECIALTY CLINICAL",
    patientName: "Anita Sharma (52yo F)",
    patientDetails: "MRN #771204 · Arrhythmia Evaluation",
    esiLevel: "ESI Level 2 · Multi-Agent Board",
    esiBadgeStyle: "bg-cyan-50 text-cyan-800 border-cyan-200/90 font-bold",
    duration: "01:05",
    waveformColor: "from-cyan-500 via-blue-500 to-indigo-500",
    dialogue: [
      {
        speaker: "Patient",
        text: "My heart has been fluttering rapidly at 145 bpm for the past 45 minutes and I feel lightheaded sitting down...",
        time: "00:10",
      },
      {
        speaker: "MedVoice AI",
        text: "Anita, your symptoms match supraventricular tachycardia with hemodynamic symptoms. Cross-specialty board deliberation requested and cardiology team flagged.",
        time: "00:26",
      },
    ],
    icd10: { code: "ICD-10 R00.2", label: "Palpitations / Tachycardia" },
    actionPill: "Arrhythmia Protocol · ECG Ingest",
    outcomes: [
      "Multi-Specialist Clinical Board Convened",
      "Differential Diagnosis Invariant Check Passed",
      "Automated Epic Cardiology Referral",
    ],
  },
  {
    id: "refill",
    title: "Post-Op Medication Refill",
    category: "AMBULATORY CARE",
    patientName: "Elena Rostova (34yo F)",
    patientDetails: "MRN #552109 · Post-Op Oral Surgery",
    esiLevel: "ESI Level 5 · Non-Urgent",
    esiBadgeStyle: "bg-emerald-50 text-emerald-700 border-emerald-200/90 font-semibold",
    duration: "00:52",
    waveformColor: "from-emerald-500 via-teal-400 to-cyan-400",
    dialogue: [
      {
        speaker: "Patient",
        text: "Hi, I had wisdom tooth surgery 3 days ago with Dr. Aris and need a refill on my post-op anti-inflammatory medication.",
        time: "00:10",
      },
      {
        speaker: "MedVoice AI",
        text: "I've verified your procedure history and allergy profile—no contraindications found. Submitting the refill request to CVS Pharmacy for provider e-sign.",
        time: "00:26",
      },
    ],
    icd10: { code: "ICD-10 Z76.0", label: "Repeat Prescription Authorization" },
    actionPill: "Contraindication Check Passed · CVS Queued",
    outcomes: [
      "Allergy & Contraindication Check Cleared",
      "Refill Order Queued for Provider E-Sign",
      "Automated Follow-Up Call Scheduled",
    ],
  },
  {
    id: "telehealth",
    title: "Routine Telehealth Intake",
    category: "GENERAL PRACTICE",
    patientName: "David Chen (41yo M)",
    patientDetails: "MRN #663189 · General Outpatient",
    esiLevel: "ESI Level 4 · Standard",
    esiBadgeStyle: "bg-indigo-50 text-indigo-700 border-indigo-200/90 font-semibold",
    duration: "00:58",
    waveformColor: "from-indigo-500 via-violet-400 to-cyan-400",
    dialogue: [
      {
        speaker: "Patient",
        text: "I've had a dull tension headache for 3 days with neck stiffness after working long hours at computer screens.",
        time: "00:09",
      },
      {
        speaker: "MedVoice AI",
        text: "No neurological red flags detected. Symptoms are consistent with tension-type headache with cervical strain. Booking video consult with Dr. Marcus tomorrow at 10:00 AM.",
        time: "00:24",
      },
    ],
    icd10: { code: "ICD-10 G44.209", label: "Tension-type Headache, Unspecified" },
    actionPill: "Virtual Consult Scheduled (10:00 AM Tomorrow)",
    outcomes: [
      "Clinical Triage Screening Completed",
      "SOAP Encounter Note Compiled",
      "Telehealth Video Link Issued via SMS",
    ],
  },
];

interface Props {
  activeScenarioId?: string;
  onScenarioChange?: (id: string) => void;
  scrollProgress?: MotionValue<number>;
}

export function MedicalHeroDashboardPreview({
  activeScenarioId = "emergency",
  onScenarioChange,
  scrollProgress,
}: Props) {
  const [internalId, setInternalId] = useState<string>(activeScenarioId);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  useEffect(() => {
    if (activeScenarioId) {
      setInternalId(activeScenarioId);
    }
  }, [activeScenarioId]);

  const handleSelectScenario = (id: string) => {
    setInternalId(id);
    onScenarioChange?.(id);
  };

  const scenario =
    HERO_CALL_SCENARIOS.find((s) => s.id === internalId) ||
    HERO_CALL_SCENARIOS[0];

  const defaultProgress = new MotionValue(0);
  const effectiveProgress = scrollProgress || defaultProgress;
  const dialogueOpacity = useTransform(effectiveProgress, [0, 0.2, 0.45], [0.88, 0.96, 1]);

  return (
    <div className="w-full bg-white text-slate-900 font-sans rounded-2xl border border-slate-200/90 overflow-hidden flex flex-col shadow-xs">
      {/* ===================== 1. BROWSER SIMULATOR HEADER ===================== */}
      <div className="bg-slate-50/90 px-4 py-3 border-b border-slate-200/80 flex items-center justify-between gap-3 flex-wrap">
        {/* Left: Window Controls + URL Bar */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
            <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
          </div>
          <div className="h-4 w-px bg-slate-200 mx-1 hidden sm:block" />
          <div className="hidden sm:flex items-center gap-1.5 bg-white border border-slate-200/90 px-3 py-1 rounded-lg shadow-2xs font-mono text-[11px] text-slate-500">
            <Lock className="w-3 h-3 text-emerald-600" />
            <span>medvoice.ai/app/live-triage</span>
          </div>
        </div>

        {/* Right: Interactive Scenario Selector Buttons */}
        <div className="flex items-center gap-1 bg-slate-200/60 p-1 rounded-xl">
          {HERO_CALL_SCENARIOS.map((s) => {
            const isActive = s.id === internalId;
            return (
              <button
                key={s.id}
                onClick={() => handleSelectScenario(s.id)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  isActive
                    ? "bg-white text-slate-950 font-bold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {s.title.split(" ")[0]}
              </button>
            );
          })}
        </div>
      </div>

      {/* ===================== 2. MAIN ACTIVE CLINICAL BOARD ===================== */}
      <div className="p-5 sm:p-7 flex flex-col gap-5 bg-gradient-to-b from-white via-slate-50/30 to-slate-50/70">
        
        {/* CALLER PROFILE & STATUS BAR */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-2xs">
              <User className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-base text-slate-950 tracking-tight">{scenario.patientName}</h3>
                <span className={`text-[11px] px-2.5 py-0.5 rounded-full border ${scenario.esiBadgeStyle}`}>
                  {scenario.esiLevel}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                  Synthetic Simulation
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">{scenario.patientDetails}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsMuted(!isMuted)}
              aria-label={isMuted ? "Unmute audio stream" : "Mute audio stream"}
              className={`p-2 rounded-xl border transition-all cursor-pointer ${
                isMuted
                  ? "bg-rose-50 border-rose-200 text-rose-600"
                  : "bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200/60"
              }`}
            >
              {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-50 border border-cyan-200/90 text-cyan-900 text-xs font-semibold shadow-2xs">
              <Volume2 className="w-4 h-4 text-cyan-600 animate-pulse" />
              <span>Voice Stream Active ({scenario.duration})</span>
            </div>
          </div>
        </div>

        {/* AI VOICE WAVEFORM VISUALIZER ORB */}
        <div className="relative py-6 bg-gradient-to-b from-slate-50/80 via-cyan-50/25 to-slate-100/70 rounded-2xl p-6 shadow-2xs flex flex-col items-center justify-center gap-4 overflow-hidden border border-slate-200/90">
          {/* Subtle Ambient Radial Glow */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.12),transparent_70%)] pointer-events-none" />

          {/* Dynamic Audio Waveform Bars */}
          <div className="flex items-center justify-center gap-1.5 h-16 w-full max-w-md px-4">
            {[40, 75, 95, 60, 85, 100, 70, 90, 50, 80, 65, 95, 45, 80, 55, 90, 35].map((h, i) => (
              <motion.div
                key={i}
                animate={{
                  height: isMuted
                    ? "8px"
                    : [`${Math.max(15, h * 0.35)}%`, `${h}%`, `${Math.max(20, h * 0.55)}%`],
                }}
                transition={{
                  duration: 0.6 + (i % 4) * 0.1,
                  repeat: Infinity,
                  repeatType: "reverse",
                  ease: "easeInOut",
                }}
                className={`w-2 rounded-full bg-gradient-to-t ${scenario.waveformColor}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-600 font-mono">
            <Radio className="w-3.5 h-3.5 text-cyan-600 animate-pulse" />
            <span className="font-semibold text-slate-700">Local Whisper base.en ASR · Kokoro-82M Neural Synthesis</span>
          </div>
        </div>

        {/* ===================== 3. SPATIAL CLINICAL BRANCHING TELEMETRY ===================== */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Node 1: ESI Severity */}
          <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 mb-1">
              <span>TRIAGE URGENCE</span>
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            </div>
            <div className="text-xs font-bold text-slate-900">{scenario.esiLevel}</div>
            <div className="text-[11px] text-slate-500 mt-1">Deterministic ESI v4 Invariant</div>
          </div>

          {/* Node 2: ICD-10 Resolution */}
          <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 mb-1">
              <span>ICD-10 ENTITY</span>
              <Activity className="w-3.5 h-3.5 text-cyan-600" />
            </div>
            <div className="text-xs font-bold text-cyan-900 font-mono">{scenario.icd10.code}</div>
            <div className="text-[11px] text-slate-500 truncate mt-1">{scenario.icd10.label}</div>
          </div>

          {/* Node 3: Dispatch / Routing */}
          <div className="p-3.5 rounded-xl bg-white border border-slate-200/90 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 mb-1">
              <span>NETWORK ROUTING</span>
              <Navigation className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-xs font-bold text-slate-900 truncate">{scenario.actionPill}</div>
            <div className="text-[11px] text-slate-500 mt-1">Real-time canonical road travel</div>
          </div>
        </div>

        {/* ===================== 4. NATURAL SPEECH TRANSCRIPT ===================== */}
        <motion.div style={{ opacity: dialogueOpacity }} className="flex flex-col gap-3">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">
            Live Speech Transcript
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={scenario.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="space-y-2.5"
            >
              {scenario.dialogue.map((item, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-xl text-sm leading-relaxed ${
                    item.speaker === "Patient"
                      ? "bg-white border border-slate-200/90 text-slate-800 shadow-2xs"
                      : "bg-cyan-50/70 border border-cyan-200/70 text-slate-900 font-medium"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-xs font-bold flex items-center gap-1.5 ${
                        item.speaker === "Patient" ? "text-slate-700" : "text-cyan-800"
                      }`}
                    >
                      {item.speaker === "Patient" ? (
                        <User className="w-3.5 h-3.5 text-slate-500" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5 text-cyan-600" />
                      )}
                      {item.speaker === "Patient" ? scenario.patientName.split(" ")[0] : "MedVoice AI"}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">{item.time}</span>
                  </div>
                  <p>{item.text}</p>
                </div>
              ))}
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {/* ===================== 5. AUTOMATED OUTCOMES SUMMARY ===================== */}
        <div className="pt-2 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">Actions Triggered:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {scenario.outcomes.map((outcome, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                {outcome}
              </span>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

export default MedicalHeroDashboardPreview;
