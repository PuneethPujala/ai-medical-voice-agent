'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Mic,
  Cpu,
  ShieldCheck,
  Cloud,
  Trash2,
  Database,
  ArrowRight,
  Info,
  CheckCircle2,
  Lock,
  Flame,
  FileText,
  Activity,
  Layers,
} from 'lucide-react';

export interface LifecycleStage {
  id: string;
  stepNum: string;
  name: string;
  shortLabel: string;
  headline: string;
  category: 'ingest' | 'asr' | 'arbiter' | 'cloud' | 'disposal' | 'audit';
  badge: string;
  boundary: string;
  processingLocation: string;
  dataIn: string;
  dataOut: string;
  voiceIsolationDetail: string;
  retentionDetail: string;
  vendorNotice?: string;
  isDisposal?: boolean;
}

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  {
    id: 'audio_buffer',
    stepNum: '01',
    name: 'Audio Capture & Ingest',
    shortLabel: '01 Ingest',
    headline: 'Transient 16kHz PCM audio stream in volatile server RAM buffer',
    category: 'ingest',
    badge: 'CLIENT INGEST',
    boundary: 'Volatile RAM Ring-Buffer',
    processingLocation: 'Browser Client → Local Ingest API',
    dataIn: 'Microphone acoustic waveform (16kHz PCM chunks)',
    dataOut: 'In-memory multipart FormData stream',
    voiceIsolationDetail:
      'Captured via standard MediaRecorder and streamed to /api/voice/stt over HTTPS. Audio is held strictly in volatile server RAM during transcription.',
    retentionDetail:
      'Ephemeral RAM allocation. Never committed to permanent server disk storage or relational database.',
  },
  {
    id: 'local_whisper',
    stepNum: '02',
    name: 'Local Speech Recognition',
    shortLabel: '02 Local ASR',
    headline: 'Neural speech-to-text decoding executes locally on server container',
    category: 'asr',
    badge: 'LOCAL EXECUTION',
    boundary: 'FastAPI Whisper base.en',
    processingLocation: 'Local Server Container (74M-Param Neural Network)',
    dataIn: '16kHz temporary audio buffer',
    dataOut: 'Raw transcript text tokens',
    voiceIsolationDetail:
      'Speech decoding executes 100% locally on the FastAPI container. Voice waveforms are converted to text without streaming audio to external cloud providers.',
    retentionDetail:
      'Temporary audio files are unlinked immediately inside audio_service.py in an explicit finally: os.remove() block.',
  },
  {
    id: 'clinical_context',
    stepNum: '03',
    name: 'Clinical State & Safety Arbiter',
    shortLabel: '03 Arbiter',
    headline: 'Deterministic symptom parsing & emergency acuity screening',
    category: 'arbiter',
    badge: 'LOCAL STATE MACHINE',
    boundary: 'Deterministic Rules Engine',
    processingLocation: 'Local Server (Deterministic Arbiter Engine)',
    dataIn: 'Raw transcript text tokens & prior session state',
    dataOut: 'Structured clinical slots & deterministic ESI priority',
    voiceIsolationDetail:
      'Evaluates strict deterministic safety invariants for ACS, stroke, airway compromise, and pediatric vitals. Emergency acuity states cannot be downgraded.',
    retentionDetail:
      'Encounter state is held in active memory during dialogue and committed to the consultation ledger upon session completion.',
  },
  {
    id: 'cloud_inference',
    stepNum: '04',
    name: 'Clinical Reasoning (LLM)',
    shortLabel: '04 Cloud LLM',
    headline: 'Contextual doctor dialogue synthesized via cloud LLM API',
    category: 'cloud',
    badge: 'CLOUD INFERENCE',
    boundary: 'Groq / NVIDIA NIM Cloud API',
    processingLocation: 'Cloud Model Inference (LLaMA-3.3-70B)',
    dataIn: 'De-identified clinical context prompt & conversation history',
    dataOut: 'Doctor bedside guidance text tokens',
    voiceIsolationDetail:
      'STRICT BOUNDARY: Only structured text prompt is submitted to cloud LLM APIs. Spoken patient voice audio NEVER leaves local server infrastructure.',
    retentionDetail:
      'Ephemeral API request. Clinical prompt context is discarded post-inference.',
    vendorNotice:
      'Pilot Notice: Enterprise zero-retention contracts and dedicated BAA agreements remain under active pilot legal review.',
  },
  {
    id: 'audio_disposal',
    stepNum: '05A',
    name: 'Raw Audio Disposal',
    shortLabel: '05A Purge',
    headline: 'Temporary audio buffers zeroized and unlinked post-ASR',
    category: 'disposal',
    badge: 'MEMORY PURGE',
    boundary: 'Python finally: os.remove()',
    processingLocation: 'Local Server File System',
    dataIn: 'Temporary audio file path on server',
    dataOut: 'Unlinked file descriptor & zeroized memory',
    voiceIsolationDetail:
      'Codebase verification: audio_service.py executes explicit os.remove() in a finally block immediately after the local Whisper pass concludes.',
    retentionDetail:
      'ZERO persistent voice retention on server disk or database after call turn.',
    isDisposal: true,
  },
  {
    id: 'audit_ledger',
    stepNum: '05B',
    name: 'Chained Audit Ledger',
    shortLabel: '05B Ledger',
    headline: 'Tamper-evident SHA-256 hash-chained compliance ledger',
    category: 'audit',
    badge: 'POSTGRESQL LEDGER',
    boundary: 'SHA-256 Hash Digest Chain',
    processingLocation: 'PostgreSQL Database',
    dataIn: 'Clinical encounter events, triage levels & dispatch actions',
    dataOut: 'Cryptographic SHA-256 hash linked to previousHash',
    voiceIsolationDetail:
      'Stores cryptographic verification hashes, caller roles, and UTC timestamps. Does NOT store raw clinical audio.',
    retentionDetail:
      'Durable immutable ledger entries for regulatory compliance and tamper-evident audit verification.',
  },
];

// Helper to get corresponding Lucide icon for each stage
function getStageIcon(stageId: string, className = 'w-6 h-6') {
  switch (stageId) {
    case 'audio_buffer':
      return <Mic className={className} />;
    case 'local_whisper':
      return <Cpu className={className} />;
    case 'clinical_context':
      return <ShieldCheck className={className} />;
    case 'cloud_inference':
      return <Cloud className={className} />;
    case 'audio_disposal':
      return <Trash2 className={className} />;
    case 'audit_ledger':
      return <Database className={className} />;
    default:
      return <Activity className={className} />;
  }
}

// Stage visual metadata
const STAGE_VISUAL_CONFIG: Record<
  string,
  {
    accentColor: string;
    lightBg: string;
    borderColor: string;
    activeRing: string;
    tagLabel: string;
    subLabel: string;
  }
> = {
  audio_buffer: {
    accentColor: '#0891b2', // cyan-600
    lightBg: 'bg-cyan-50/70',
    borderColor: 'border-cyan-300',
    activeRing: 'ring-cyan-400',
    tagLabel: '01 INGEST',
    subLabel: '16kHz Audio',
  },
  local_whisper: {
    accentColor: '#0284c7', // sky-600
    lightBg: 'bg-sky-50/70',
    borderColor: 'border-sky-300',
    activeRing: 'ring-sky-400',
    tagLabel: '02 LOCAL ASR',
    subLabel: 'Neural STT',
  },
  clinical_context: {
    accentColor: '#0d9488', // teal-600
    lightBg: 'bg-teal-50/70',
    borderColor: 'border-teal-300',
    activeRing: 'ring-teal-400',
    tagLabel: '03 ARBITER',
    subLabel: 'Safety Gate',
  },
  cloud_inference: {
    accentColor: '#2563eb', // blue-600
    lightBg: 'bg-blue-50/70',
    borderColor: 'border-blue-300',
    activeRing: 'ring-blue-400',
    tagLabel: '04 CLOUD LLM',
    subLabel: 'Reasoning API',
  },
  audio_disposal: {
    accentColor: '#059669', // emerald-600
    lightBg: 'bg-emerald-50/70',
    borderColor: 'border-emerald-300',
    activeRing: 'ring-emerald-400',
    tagLabel: '05A PURGE',
    subLabel: 'RAM Zeroized',
  },
  audit_ledger: {
    accentColor: '#7c3aed', // violet-600
    lightBg: 'bg-violet-50/70',
    borderColor: 'border-violet-300',
    activeRing: 'ring-violet-400',
    tagLabel: '05B LEDGER',
    subLabel: 'SHA-256 Hash',
  },
};

// ============================================================================
// BRIGHT CLINICAL CIRCULAR INSTRUMENT CANVAS
// ============================================================================
function BrightCircularInstrumentCanvas({
  activeStageId,
  onSelectStageId,
  isPaused = false,
}: {
  activeStageId: string;
  onSelectStageId: (id: string) => void;
  isPaused?: boolean;
}) {
  return (
    <div className="relative w-full h-full min-h-[460px] sm:min-h-[500px] bg-white flex flex-col justify-between p-5 sm:p-7 overflow-hidden select-none">
      {/* Subtle crisp architect dot grid on pure white */}
      <div
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage: `radial-gradient(#cbd5e1 1px, transparent 1px)`,
          backgroundSize: '24px 24px',
        }}
      />

      {/* SVG Connecting Flow Lines (Crisp Vector Data Bus Highways) */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none z-0"
        preserveAspectRatio="none"
      >
        <defs>
          {/* Active Flow Gradient */}
          <linearGradient id="activeCyanFlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="50%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <linearGradient id="purgeGreenFlow" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
          <linearGradient id="ledgerVioletFlow" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0d9488" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
        </defs>

        {/* 1. Main Forward Processing Pipeline (Ingest -> ASR -> Arbiter -> Cloud LLM) */}
        {/* Track Bedding */}
        <line
          x1="16%"
          y1="28%"
          x2="84%"
          y2="28%"
          stroke="#cbd5e1"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        {/* Animated Active Beam along Forward Pipeline */}
        <line
          x1="16%"
          y1="28%"
          x2="84%"
          y2="28%"
          stroke="url(#activeCyanFlow)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray="8 8"
          className={isPaused ? "" : "animate-[pulse_3s_ease-in-out_infinite]"}
        />

        {/* 2. Downward Branch A: Memory Purge (from 02 Local ASR down to 05A Purge) */}
        <path
          d="M 38% 28% L 38% 74%"
          stroke="#cbd5e1"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="6 6"
        />
        <path
          d="M 38% 28% L 38% 74%"
          stroke="url(#purgeGreenFlow)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="6 6"
        />

        {/* 3. Downward Branch B: Cryptographic Audit Ledger (from 03 Arbiter & 04 Cloud LLM down to 05B) */}
        <path
          d="M 62% 28% C 62% 52%, 72% 52%, 72% 74%"
          stroke="#cbd5e1"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="6 6"
        />
        <path
          d="M 84% 28% C 84% 52%, 72% 52%, 72% 74%"
          stroke="#cbd5e1"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="6 6"
        />
        <path
          d="M 62% 28% C 62% 52%, 72% 52%, 72% 74%"
          stroke="url(#ledgerVioletFlow)"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="6 6"
        />
      </svg>

      {/* Top Section Header inside Canvas */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/90 border border-slate-200 shadow-xs">
          <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
          <span className="font-mono text-[11px] font-bold text-slate-700 tracking-wider">
            CLINICAL DATA FLOW · 6 DIRECT NODES
          </span>
        </div>
        <span className="font-mono text-[10px] text-slate-600 bg-white/80 px-2.5 py-1 rounded-lg border border-slate-200">
          SELECT ANY NODE
        </span>
      </div>

      {/* Two-Tier Circular Nodes System */}
      <div className="relative z-10 my-auto flex flex-col gap-10 sm:gap-12 py-3">
        {/* TIER 1: Forward Clinical Dialogue Stream (4 Horizontal Circles) */}
        <div className="grid grid-cols-4 gap-2 sm:gap-4 items-center">
          {LIFECYCLE_STAGES.slice(0, 4).map((stage) => {
            const isSel = activeStageId === stage.id;
            const config = STAGE_VISUAL_CONFIG[stage.id];

            return (
              <div key={stage.id} className="flex flex-col items-center text-center group">
                {/* Circular Button Shape */}
                <button
                  type="button"
                  onClick={() => onSelectStageId(stage.id)}
                  className={`relative w-14 h-14 sm:w-18 sm:h-18 md:w-20 md:h-20 rounded-full flex flex-col items-center justify-center transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                    isSel
                      ? 'bg-slate-950 text-white shadow-xl scale-110 ring-4 ring-cyan-400/80 ring-offset-2'
                      : 'bg-white text-slate-700 border-2 border-slate-200 shadow-md hover:border-slate-400 hover:scale-105 hover:shadow-lg'
                  }`}
                >
                  {/* Subtle active beacon halo */}
                  {isSel && (
                    <span className="absolute -inset-1 rounded-full bg-cyan-400 opacity-20 animate-ping" />
                  )}

                  {/* Lucid Icon */}
                  <div className={`transition-transform duration-200 ${isSel ? 'text-cyan-400 scale-110' : 'text-slate-700 group-hover:text-cyan-600'}`}>
                    {getStageIcon(stage.id, 'w-6 h-6 sm:w-7 sm:h-7')}
                  </div>

                  {/* Micro Step Tag inside circle */}
                  <span
                    className={`font-mono text-[9px] font-bold mt-0.5 tracking-tight ${
                      isSel ? 'text-cyan-300' : 'text-slate-600'
                    }`}
                  >
                    {stage.stepNum}
                  </span>
                </button>

                {/* Text Label Below Circle */}
                <div className="mt-2 space-y-0.5">
                  <span
                    className={`font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-wider block transition-colors ${
                      isSel ? 'text-cyan-700' : 'text-slate-800'
                    }`}
                  >
                    {stage.shortLabel.replace(/^[0-9A-B]+ /, '')}
                  </span>
                  <span className="text-[10px] text-slate-600 hidden sm:block font-medium">
                    {config.subLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* TIER 2: Secondary Governance & Disposal Stream (2 Offset Branch Circles) */}
        <div className="grid grid-cols-4 gap-2 sm:gap-4 items-center">
          {/* Spacer Column 1 */}
          <div className="flex flex-col items-center" />

          {/* Column 2: 05A Audio Purge (Directly under 02 Local ASR) */}
          {(() => {
            const stage = LIFECYCLE_STAGES[4]; // audio_disposal
            const isSel = activeStageId === stage.id;
            const config = STAGE_VISUAL_CONFIG[stage.id];

            return (
              <div className="flex flex-col items-center text-center group">
                <button
                  type="button"
                  onClick={() => onSelectStageId(stage.id)}
                  className={`relative w-14 h-14 sm:w-18 sm:h-18 md:w-20 md:h-20 rounded-full flex flex-col items-center justify-center transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                    isSel
                      ? 'bg-slate-950 text-white shadow-xl scale-110 ring-4 ring-emerald-400/80 ring-offset-2'
                      : 'bg-white text-slate-700 border-2 border-emerald-200 shadow-md hover:border-emerald-400 hover:scale-105 hover:shadow-lg'
                  }`}
                >
                  {isSel && (
                    <span className="absolute -inset-1 rounded-full bg-emerald-400 opacity-20 animate-ping" />
                  )}

                  <div className={`transition-transform duration-200 ${isSel ? 'text-emerald-400 scale-110' : 'text-emerald-700 group-hover:text-emerald-800'}`}>
                    {getStageIcon(stage.id, 'w-6 h-6 sm:w-7 sm:h-7')}
                  </div>

                  <span
                    className={`font-mono text-[9px] font-bold mt-0.5 tracking-tight ${
                      isSel ? 'text-emerald-300' : 'text-emerald-700'
                    }`}
                  >
                    05A
                  </span>
                </button>

                <div className="mt-2 space-y-0.5">
                  <span
                    className={`font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-wider block transition-colors ${
                      isSel ? 'text-emerald-700' : 'text-slate-800'
                    }`}
                  >
                    Audio Purge
                  </span>
                  <span className="text-[10px] text-emerald-700 hidden sm:block font-medium">
                    RAM Zeroized
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Spacer Column 3 (Bridge Area) */}
          <div className="flex flex-col items-center justify-center">
            <div className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-mono text-slate-600">
              <span>SHA-256</span>
              <ArrowRight className="w-3 h-3 text-violet-500" />
            </div>
          </div>

          {/* Column 4: 05B Chained Audit Ledger (Under Arbiter / LLM) */}
          {(() => {
            const stage = LIFECYCLE_STAGES[5]; // audit_ledger
            const isSel = activeStageId === stage.id;
            const config = STAGE_VISUAL_CONFIG[stage.id];

            return (
              <div className="flex flex-col items-center text-center group">
                <button
                  type="button"
                  onClick={() => onSelectStageId(stage.id)}
                  className={`relative w-14 h-14 sm:w-18 sm:h-18 md:w-20 md:h-20 rounded-full flex flex-col items-center justify-center transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                    isSel
                      ? 'bg-slate-950 text-white shadow-xl scale-110 ring-4 ring-violet-400/80 ring-offset-2'
                      : 'bg-white text-slate-700 border-2 border-violet-200 shadow-md hover:border-violet-400 hover:scale-105 hover:shadow-lg'
                  }`}
                >
                  {isSel && (
                    <span className="absolute -inset-1 rounded-full bg-violet-400 opacity-20 animate-ping" />
                  )}

                  <div className={`transition-transform duration-200 ${isSel ? 'text-violet-400 scale-110' : 'text-violet-700 group-hover:text-violet-800'}`}>
                    {getStageIcon(stage.id, 'w-6 h-6 sm:w-7 sm:h-7')}
                  </div>

                  <span
                    className={`font-mono text-[9px] font-bold mt-0.5 tracking-tight ${
                      isSel ? 'text-violet-300' : 'text-violet-700'
                    }`}
                  >
                    05B
                  </span>
                </button>

                <div className="mt-2 space-y-0.5">
                  <span
                    className={`font-mono text-[10px] sm:text-[11px] font-bold uppercase tracking-wider block transition-colors ${
                      isSel ? 'text-violet-700' : 'text-slate-800'
                    }`}
                  >
                    Audit Ledger
                  </span>
                  <span className="text-[10px] text-violet-700 hidden sm:block font-medium">
                    Immutable
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Micro Legend at Bottom of Canvas */}
      <div className="relative z-10 pt-2 border-t border-slate-200/80 flex items-center justify-between text-slate-600 font-mono text-[10px]">
        <span className="truncate">
          FLOW: 16kHz PCM → NEURAL ASR → ARBITER → CLOUD LLM (DOWNWARD PURGE & LEDGER)
        </span>
        <span className="hidden sm:inline font-semibold text-slate-700 shrink-0 pl-2">
          LIVE ISOLATION BOUNDARY
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN CLINICAL DATA LIFECYCLE COMPONENT
// ============================================================================
export function ClinicalDataLifecycle3D({
  className = '',
}: {
  className?: string;
}) {
  // SINGLE AUTHORITATIVE SOURCE OF TRUTH FOR ACTIVE STAGE
  const [activeStageId, setActiveStageId] = useState<string>('audio_buffer');
  const [isVoiceActive, setIsVoiceActive] = useState<boolean>(false);
  const [isDocumentHidden, setIsDocumentHidden] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleVoiceSession = (e: Event) => {
      const customEvent = e as CustomEvent<{ active?: boolean }>;
      setIsVoiceActive(Boolean(customEvent.detail?.active));
    };

    const handleVisibilityChange = () => {
      setIsDocumentHidden(document.visibilityState === 'hidden');
    };

    window.addEventListener('medvoice:voice-session-active', handleVoiceSession);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('medvoice:voice-session-active', handleVoiceSession);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const selectedStage = useMemo(
    () => LIFECYCLE_STAGES.find((s) => s.id === activeStageId) ?? LIFECYCLE_STAGES[0],
    [activeStageId]
  );

  const handleNextStage = () => {
    const curIdx = LIFECYCLE_STAGES.findIndex((s) => s.id === activeStageId);
    const nextIdx = (curIdx + 1) % LIFECYCLE_STAGES.length;
    setActiveStageId(LIFECYCLE_STAGES[nextIdx].id);
  };

  return (
    <div
      className={`relative w-full rounded-2xl sm:rounded-3xl bg-white border border-slate-200/90 text-slate-900 overflow-hidden shadow-xl flex flex-col ${className}`}
    >
      {/* 1. Integrated Minimalist Header & Navigation Bar (Single Authoritative Strip) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between px-6 sm:px-8 py-4 border-b border-slate-200/80 bg-white gap-4">
        <div>
          <span className="font-mono text-[11px] font-bold tracking-widest text-slate-500 uppercase block">
            01 — 06 ARCHITECTURAL PIPELINE
          </span>
          <h2 className="text-lg sm:text-xl font-extrabold text-slate-950 tracking-tight">
            Interactive Clinical Data Lifecycle
          </h2>
        </div>

        {/* Minimalist Segmented Stage Tabs with Active Gliding Underline */}
        <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar pb-1 lg:pb-0">
          {LIFECYCLE_STAGES.map((st) => {
            const isSel = activeStageId === st.id;
            return (
              <button
                key={st.id}
                onClick={() => setActiveStageId(st.id)}
                className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer shrink-0 focus-visible:outline-none ${
                  isSel
                    ? 'text-slate-950 font-semibold bg-slate-100/90'
                    : 'text-slate-600 hover:text-slate-950 hover:bg-slate-100/60'
                }`}
              >
                <span
                  className={`font-mono text-[10px] sm:text-[11px] font-bold ${
                    isSel ? 'text-cyan-600' : 'text-slate-400 group-hover:text-slate-600'
                  }`}
                >
                  {st.stepNum}
                </span>
                <span>{st.shortLabel.replace(/^[0-9A-B]+ /, '')}</span>
                {isSel && (
                  <motion.div
                    layoutId="active-stage-indicator"
                    className="absolute -bottom-1 left-2 right-2 h-[2.5px] bg-cyan-600 rounded-full shadow-[0_0_8px_rgba(8,145,178,0.4)]"
                    transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Coordinated Side-by-Side Architectural Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[500px] lg:min-h-[540px] w-full bg-white">
        {/* Left Column (7-8 cols): Bright Circular Instrument Canvas */}
        <div className="lg:col-span-7 xl:col-span-8 relative border-b lg:border-b-0 lg:border-r border-slate-200/80">
          <BrightCircularInstrumentCanvas
            activeStageId={activeStageId}
            onSelectStageId={setActiveStageId}
            isPaused={isVoiceActive || isDocumentHidden}
          />
        </div>

        {/* Right Column (4-5 cols): Integrated Stage Inspector Panel */}
        <div className="lg:col-span-5 xl:col-span-4 p-6 sm:p-7 bg-slate-50/50 flex flex-col justify-between">
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedStage.id}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
              className="space-y-5"
            >
              {/* Header: Stage Badge & Title */}
              <div className="space-y-1.5 border-b border-slate-200/70 pb-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-cyan-700 tracking-wider">
                    {selectedStage.stepNum} — {selectedStage.badge}
                  </span>
                  <span className="font-mono text-[10px] text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
                    STAGE {selectedStage.stepNum} OF 06
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-extrabold text-slate-950 tracking-tight leading-snug">
                  {selectedStage.name}
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal pt-0.5">
                  {selectedStage.headline}
                </p>
              </div>

              {/* Data In & Data Out Specification */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
                  <span className="font-mono text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    DATA IN
                  </span>
                  <p className="text-xs text-slate-800 leading-tight font-medium">
                    {selectedStage.dataIn}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
                  <span className="font-mono text-[10px] font-bold text-cyan-700 uppercase tracking-wider block">
                    DATA OUT
                  </span>
                  <p className="text-xs text-slate-800 leading-tight font-medium">
                    {selectedStage.dataOut}
                  </p>
                </div>
              </div>

              {/* Processing Sovereignty & Voice Isolation */}
              <div className="space-y-1.5 pt-1">
                <span className="font-mono text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  PROCESSING SOVEREIGNTY & ISOLATION
                </span>
                <p className="text-xs sm:text-[13px] text-slate-700 leading-relaxed font-normal">
                  {selectedStage.voiceIsolationDetail}
                </p>
                <div className="pt-1">
                  <span className="inline-block font-mono text-[10px] text-slate-700 bg-white border border-slate-200/90 shadow-2xs px-2 py-0.5 rounded">
                    Boundary: {selectedStage.boundary}
                  </span>
                </div>
              </div>

              {/* Data Retention & Lifecycle */}
              <div className="space-y-1.5 pt-1">
                <span className="font-mono text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  MEMORY & RETENTION LIFECYCLE
                </span>
                <p className="text-xs sm:text-[13px] text-slate-700 leading-relaxed font-normal">
                  {selectedStage.retentionDetail}
                </p>
              </div>

              {/* Pilot Legal Disclaimer if Applicable */}
              {selectedStage.vendorNotice && (
                <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-900 text-xs font-mono leading-relaxed flex items-start gap-2">
                  <Info className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                  <span>{selectedStage.vendorNotice}</span>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Action Footer: Step Next Stage Button */}
          <div className="pt-6 border-t border-slate-200/70 mt-6 flex items-center justify-between">
            <span className="font-mono text-[11px] text-slate-500">
              Active: {selectedStage.shortLabel}
            </span>
            <button
              onClick={handleNextStage}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-mono text-xs font-semibold text-white bg-slate-950 hover:bg-slate-800 border border-slate-900 shadow-xs transition-all cursor-pointer active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
            >
              <span>Step next</span>
              <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClinicalDataLifecycle3D;
