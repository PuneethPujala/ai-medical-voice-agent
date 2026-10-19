"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { Volume2, Sparkles, Activity, ShieldAlert, Cpu, Terminal, Radio } from "lucide-react";

interface AcousticWaveformHeroProps {
  className?: string;
}

export function AcousticWaveformHero({ className = "" }: AcousticWaveformHeroProps) {
  const [currentMode, setCurrentMode] = useState<"listening" | "analyzing" | "structured">("listening");

  return (
    <div
      className={`relative w-full rounded-2xl sm:rounded-3xl bg-white/80 backdrop-blur-xl border border-slate-200/90 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.08)] overflow-hidden ${className}`}
    >
      {/* Top Signal Demonstration Rail */}
      <div className="px-4 sm:px-6 py-3 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs bg-slate-50/60 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-teal-600" />
          </span>
          <span className="font-mono font-bold text-slate-900 tracking-wider text-[11px] uppercase">
            Acoustic Signal Architecture
          </span>
          <span className="text-[10px] font-mono text-slate-500 hidden sm:inline">
            (16kHz Multi-Clause Telemetry)
          </span>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-slate-200 shadow-2xs" role="tablist" aria-label="Acoustic Pipeline Stage">
          <button
            role="tab"
            aria-selected={currentMode === "listening"}
            onClick={() => setCurrentMode("listening")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-all cursor-pointer ${
              currentMode === "listening"
                ? "bg-slate-950 text-white shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            01 Speech
          </button>
          <button
            role="tab"
            aria-selected={currentMode === "analyzing"}
            onClick={() => setCurrentMode("analyzing")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-all cursor-pointer ${
              currentMode === "analyzing"
                ? "bg-slate-950 text-white shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            02 DSP Extraction
          </button>
          <button
            role="tab"
            aria-selected={currentMode === "structured"}
            onClick={() => setCurrentMode("structured")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-all cursor-pointer ${
              currentMode === "structured"
                ? "bg-slate-950 text-white shadow-xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            03 Clinical Gate
          </button>
        </div>
      </div>

      {/* Living Acoustic Spectrum & Mel-Cepstrum Stream (Procedural Audio Representation) */}
      <div className="relative h-48 sm:h-56 w-full px-4 sm:px-6 flex items-center justify-center overflow-hidden bg-gradient-to-b from-teal-50/20 via-white to-slate-50/40">
        
        {/* Procedural Frequency Waves & Dynamic Sampling Grid */}
        <svg viewBox="0 0 1000 300" className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="spectrumTeal" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#0d9488" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#0d9488" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#0d9488" stopOpacity="0.1" />
            </linearGradient>
            <linearGradient id="spectrumCyan" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.1" />
            </linearGradient>
          </defs>

          {/* Formant F0 Fundamental Pitch Wave */}
          <motion.path
            d="M 0,150 C 150,90 250,210 400,150 C 550,90 650,210 800,150 C 900,110 1000,150 1000,150"
            fill="none"
            stroke="url(#spectrumTeal)"
            strokeWidth="3.5"
            strokeLinecap="round"
            animate={{
              d: currentMode === "listening"
                ? [
                    "M 0,150 C 150,90 250,210 400,150 C 550,90 650,210 800,150 C 900,110 1000,150 1000,150",
                    "M 0,150 C 150,190 250,70 400,150 C 550,230 650,80 800,150 C 900,180 1000,150 1000,150",
                    "M 0,150 C 150,90 250,210 400,150 C 550,90 650,210 800,150 C 900,110 1000,150 1000,150",
                  ]
                : "M 0,150 C 200,130 400,170 600,150 C 800,130 1000,150 1000,150",
            }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Formant F1 Acoustic Harmonic */}
          <motion.path
            d="M 0,150 C 120,200 280,100 450,150 C 620,200 780,100 950,150 L 1000,150"
            fill="none"
            stroke="url(#spectrumCyan)"
            strokeWidth="2.5"
            strokeLinecap="round"
            animate={{
              d: currentMode === "listening"
                ? [
                    "M 0,150 C 120,200 280,100 450,150 C 620,200 780,100 950,150 L 1000,150",
                    "M 0,150 C 120,100 280,200 450,150 C 620,90 780,210 950,150 L 1000,150",
                    "M 0,150 C 120,200 280,100 450,150 C 620,200 780,100 950,150 L 1000,150",
                  ]
                : "M 0,150 C 250,160 500,140 750,160 L 1000,150",
            }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Sampling Bars / Spectral Bands */}
          {[120, 220, 320, 420, 520, 620, 720, 820, 920].map((cx, idx) => {
            const h = 40 + (idx % 3) * 25;
            return (
              <g key={cx}>
                <line
                  x1={cx}
                  y1={150 - h / 2}
                  x2={cx}
                  y2={150 + h / 2}
                  stroke="#0d9488"
                  strokeWidth="2"
                  strokeOpacity="0.4"
                  strokeDasharray="2 2"
                />
                <circle cx={cx} cy={150} r="3" fill="#0d9488" />
              </g>
            );
          })}
        </svg>

        {/* Central State Descriptor Overlay */}
        <div className="absolute bottom-3 inset-x-4 sm:inset-x-6 z-20 flex items-center justify-between gap-2 pointer-events-none">
          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-700 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-200 shadow-xs max-w-full truncate">
            <Volume2 className="w-3.5 h-3.5 text-teal-700 shrink-0" />
            <span className="truncate">
              {currentMode === "listening" && "Capturing multi-clause acoustic envelope (16kHz PCM)"}
              {currentMode === "analyzing" && "Mel-frequency cepstral coefficients & acoustic cadence extraction"}
              {currentMode === "structured" && "Synthesizing structured ICD-10 & algorithmic ESI vectors"}
            </span>
          </div>

          <div className="font-mono text-[10px] text-slate-600 uppercase tracking-widest hidden md:block bg-white/95 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-slate-200 shrink-0">
            Ephemeral In-Memory DSP
          </div>
        </div>
      </div>

      {/* Bottom Transformation Tray: How speech crystallizes into clinical schema */}
      <div className="p-3 sm:p-4 bg-white border-t border-slate-200/80 grid grid-cols-1 md:grid-cols-3 gap-2.5">
        <div
          className={`p-2.5 sm:p-3 rounded-xl border transition-all ${
            currentMode === "listening"
              ? "bg-slate-50 border-teal-500/40 ring-1 ring-teal-500/20"
              : "bg-slate-50/70 border-slate-200/80"
          } space-y-1`}
        >
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold flex items-center justify-between">
            <span>01 Speech Intake</span>
            <span className="text-[9px] text-teal-700 font-semibold px-1 rounded bg-teal-50">16kHz PCM</span>
          </div>
          <div className="text-xs text-slate-800 font-serif italic truncate">
            &ldquo;Started having a heavy tightness in my chest...&rdquo;
          </div>
        </div>

        <div
          className={`p-2.5 sm:p-3 rounded-xl border transition-all ${
            currentMode === "analyzing"
              ? "bg-teal-50/90 border-teal-500/60 ring-1 ring-teal-500/30"
              : "bg-teal-50/40 border-teal-200/80"
          } space-y-1`}
        >
          <div className="text-[10px] font-mono uppercase tracking-wider text-teal-800 font-bold flex items-center justify-between">
            <span>02 Extracted</span>
            <span className="text-teal-900 font-bold text-[9px] px-1 py-0.2 rounded bg-teal-100">ICD-10</span>
          </div>
          <div className="text-xs font-mono font-bold text-teal-950 flex items-center gap-1.5 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0" />
            <span className="truncate">R07.9 Retrosternal Pain</span>
          </div>
        </div>

        <div
          className={`p-2.5 sm:p-3 rounded-xl border transition-all ${
            currentMode === "structured"
              ? "bg-rose-50 border-rose-500/60 ring-1 ring-rose-500/30"
              : "bg-rose-50/50 border-rose-200/80"
          } space-y-1`}
        >
          <div className="text-[10px] font-mono uppercase tracking-wider text-rose-800 font-bold flex items-center justify-between">
            <span>03 Preemptive Action</span>
            <span className="text-rose-900 font-bold text-[9px] px-1 py-0.2 rounded bg-rose-100">ESI Level 2</span>
          </div>
          <div className="text-xs font-mono font-bold text-rose-950 flex items-center gap-1.5 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0" />
            <span className="truncate">STEMI Cath Lab Route</span>
          </div>
        </div>
      </div>
    </div>
  );
}
