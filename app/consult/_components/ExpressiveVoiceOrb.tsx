"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { Mic, Volume2, Loader2, AlertCircle, Edit3, Square, Play, Sparkles } from "lucide-react";

export type VoiceOrbState =
  | "pending_activation"
  | "ready"
  | "requesting_mic"
  | "listening"
  | "transcribing"
  | "reviewing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "error";

interface ExpressiveVoiceOrbProps {
  state: VoiceOrbState;
  audioLevel?: number; // 0 to 1 normalized RMS volume from DSP
  speakerName?: string;
  errorMessage?: string;
  onMicClick?: () => void;
  onInterrupt?: () => void;
  onStartConsultation?: () => void;
  className?: string;
  compact?: boolean;
}

export function ExpressiveVoiceOrb({
  state,
  audioLevel = 0,
  speakerName = "Dr. Sarah Chen",
  errorMessage,
  onMicClick,
  onInterrupt,
  onStartConsultation,
  className = "",
  compact = false,
}: ExpressiveVoiceOrbProps) {
  const shouldReduceMotion = useReducedMotion();

  // State configurations
  const stateMeta = (() => {
    switch (state) {
      case "pending_activation":
        return {
          label: "Start Voice Consultation",
          sublabel: `Click to begin session and listen to ${speakerName.split(",")[0]}`,
          accentColor: "#B7FF72",
          badgeBg: "bg-[#18251D] text-[#B7FF72] border-[#18251D]",
          ringColor: "rgba(183, 255, 114, 0.35)",
          canClick: true,
          actionHint: "Click to begin consultation with audio",
        };
      case "speaking":
        return {
          label: `${speakerName.split(",")[0]} is speaking…`,
          sublabel: "Click orb to interrupt and respond immediately",
          accentColor: "#B7FF72",
          badgeBg: "bg-emerald-50 text-emerald-900 border-emerald-300",
          ringColor: "rgba(183, 255, 114, 0.45)",
          canClick: true,
          actionHint: "Click to interrupt physician",
        };
      case "listening":
        return {
          label: "Listening to your voice…",
          sublabel: "Speak naturally. Click orb or Send when finished.",
          accentColor: "#B7FF72",
          badgeBg: "bg-emerald-50 text-emerald-900 border-emerald-300",
          ringColor: "rgba(183, 255, 114, 0.5)",
          canClick: true,
          actionHint: "Click to complete utterance",
        };
      case "transcribing":
        return {
          label: "Transcribing clinical speech…",
          sublabel: "Processing acoustic features via Whisper ASR",
          accentColor: "#B7FF72",
          badgeBg: "bg-[#18251D] text-[#B7FF72] border-[#18251D]",
          ringColor: "rgba(183, 255, 114, 0.25)",
          canClick: false,
          actionHint: null,
        };
      case "reviewing":
        return {
          label: "Review transcript before sending",
          sublabel: "Verify or correct medical terminology below",
          accentColor: "#B7FF72",
          badgeBg: "bg-amber-50 text-amber-950 border-amber-300",
          ringColor: "rgba(245, 158, 11, 0.25)",
          canClick: false,
          actionHint: null,
        };
      case "thinking":
        return {
          label: "Synthesizing clinical assessment…",
          sublabel: "Consulting peer board & differential protocol",
          accentColor: "#B7FF72",
          badgeBg: "bg-[#18251D] text-white border-[#18251D]",
          ringColor: "rgba(24, 37, 29, 0.3)",
          canClick: false,
          actionHint: null,
        };
      case "interrupted":
        return {
          label: "Physician speech paused",
          sublabel: "Resuming microphone capture for your response…",
          accentColor: "#f59e0b",
          badgeBg: "bg-amber-50 text-amber-900 border-amber-300",
          ringColor: "rgba(245, 158, 11, 0.4)",
          canClick: true,
          actionHint: null,
        };
      case "error":
        return {
          label: "Microphone attention needed",
          sublabel: errorMessage || "Click to retry microphone access",
          accentColor: "#ef4444",
          badgeBg: "bg-rose-50 text-rose-900 border-rose-300",
          ringColor: "rgba(239, 68, 68, 0.3)",
          canClick: true,
          actionHint: "Click to retry",
        };
      case "requesting_mic":
        return {
          label: "Connecting audio stream…",
          sublabel: "Grant microphone access in browser prompt",
          accentColor: "#B7FF72",
          badgeBg: "bg-slate-100 text-slate-800 border-slate-300",
          ringColor: "rgba(24, 37, 29, 0.2)",
          canClick: false,
          actionHint: null,
        };
      case "ready":
      default:
        return {
          label: "Your Turn to Respond",
          sublabel: "Click microphone to record, or type in composer below",
          accentColor: "#B7FF72",
          badgeBg: "bg-slate-100 text-slate-800 border-slate-300",
          ringColor: "rgba(24, 37, 29, 0.15)",
          canClick: true,
          actionHint: "Click to record your voice",
        };
    }
  })();

  const handleClick = () => {
    if (state === "pending_activation") {
      if (onStartConsultation) {
        onStartConsultation();
      } else {
        onMicClick?.();
      }
    } else if (state === "speaking") {
      onInterrupt?.();
    } else if (stateMeta.canClick) {
      onMicClick?.();
    }
  };

  const activeLevel = Math.max(0.15, Math.min(1, audioLevel * 2.5));

  // COMPACT MONIOR STRIP (Used when multi-turn dialogue is active)
  if (compact) {
    return (
      <div className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-[#FAF9F6] border border-slate-200/90 shadow-2xs w-full ${className}`}>
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={handleClick}
            disabled={!stateMeta.canClick}
            aria-label={stateMeta.label}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0 cursor-pointer ${
              state === "listening"
                ? "bg-[#18251D] text-[#B7FF72] ring-2 ring-[#B7FF72]/40"
                : state === "speaking"
                ? "bg-[#18251D] text-[#B7FF72] ring-2 ring-[#B7FF72]/30"
                : "bg-[#18251D] text-[#B7FF72]"
            }`}
          >
            {state === "listening" ? (
              <div className="w-3 h-3 rounded-full bg-[#B7FF72] animate-ping" />
            ) : state === "speaking" ? (
              <Volume2 className="w-4 h-4 text-[#B7FF72] animate-pulse" />
            ) : state === "transcribing" || state === "thinking" ? (
              <Loader2 className="w-4 h-4 text-[#B7FF72] animate-spin" />
            ) : (
              <Mic className="w-4 h-4 text-[#B7FF72]" />
            )}
          </button>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#05070F] truncate">{stateMeta.label}</span>
              <span className={`text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${stateMeta.badgeBg}`}>
                {state.replace("_", " ").toUpperCase()}
              </span>
            </div>
            <span className="text-[11px] text-slate-500 truncate">{stateMeta.sublabel}</span>
          </div>
        </div>

        {/* Real-time Waveform Monitor */}
        <div className="flex items-center gap-1 h-5 shrink-0" aria-hidden="true">
          {[0.35, 0.8, 0.5, 1, 0.7, 0.45, 0.9, 0.6].map((scale, i) => (
            <div
              key={i}
              style={{
                height: state === "listening" || state === "speaking"
                  ? `${Math.max(25, Math.round(scale * activeLevel * 100))}%`
                  : "30%",
              }}
              className={`w-1 rounded-full transition-all duration-150 ${
                state === "listening" || state === "speaking" ? "bg-[#B7FF72]" : "bg-slate-300"
              }`}
            />
          ))}
        </div>
      </div>
    );
  }

  // HERO VOX ACOUSTIC STAGE (Launly.com Vox-inspired concentric design)
  return (
    <div className={`relative flex flex-col items-center justify-center py-6 px-4 w-full ${className}`}>
      {/* Soft Ambient Radial Lighting */}
      <div
        className="absolute inset-0 rounded-3xl pointer-events-none transition-all duration-700"
        style={{
          background: `radial-gradient(ellipse 60% 60% at 50% 50%, ${stateMeta.ringColor} 0%, rgba(24, 37, 29, 0.03) 60%, transparent 80%)`,
        }}
      />

      {/* CONCENTRIC ACOUSTIC SOUND RINGS */}
      <div className="relative flex items-center justify-center my-2">
        {/* Tier 3 Outer Acoustic Halo Ring */}
        <div
          className={`absolute w-64 h-64 sm:w-72 sm:h-72 rounded-full border border-stone-200/60 pointer-events-none transition-all duration-700 ${
            state === "speaking" || state === "listening" ? "scale-105 border-[#B7FF72]/30" : "scale-100"
          }`}
        />

        {/* Tier 2 Middle Acoustic Ring (Pulsing during speech) */}
        {!shouldReduceMotion && (state === "speaking" || state === "listening" || state === "pending_activation") && (
          <motion.div
            animate={{
              scale: [1, 1.12, 1],
              opacity: [0.35, 0.7, 0.35],
            }}
            transition={{
              repeat: Infinity,
              duration: state === "speaking" ? 1.4 : state === "listening" ? 1.8 : 2.4,
              ease: "easeInOut",
            }}
            className="absolute w-48 h-48 sm:w-56 sm:h-56 rounded-full border-2 border-dashed border-[#B7FF72]/50 pointer-events-none"
          />
        )}

        {/* Tier 1 Inner Contour Ring */}
        <div
          className={`absolute w-36 h-36 sm:w-40 sm:h-40 rounded-full border border-stone-300/80 pointer-events-none transition-all duration-500 ${
            state === "speaking" || state === "listening"
              ? "border-[#B7FF72] ring-4 ring-[#B7FF72]/15"
              : state === "pending_activation"
              ? "border-[#B7FF72]/60"
              : ""
          }`}
        />

        {/* THE CENTRAL SCULPTURAL VOX TRANSDUCER */}
        <button
          type="button"
          onClick={handleClick}
          disabled={!stateMeta.canClick}
          aria-label={stateMeta.label}
          title={stateMeta.actionHint || stateMeta.label}
          className={`relative z-10 w-24 h-24 sm:w-28 sm:h-28 rounded-full flex flex-col items-center justify-center transition-all duration-300 shadow-xl border cursor-pointer group ${
            state === "pending_activation"
              ? "bg-[#18251D] text-[#B7FF72] border-[#B7FF72] shadow-lg shadow-[#B7FF72]/20 ring-4 ring-[#B7FF72]/30 hover:scale-105"
              : state === "speaking"
              ? "bg-[#18251D] text-[#B7FF72] border-[#B7FF72] shadow-lg shadow-emerald-500/25 ring-4 ring-[#B7FF72]/35"
              : state === "listening"
              ? "bg-[#18251D] text-[#B7FF72] border-[#B7FF72] shadow-xl shadow-[#B7FF72]/30 ring-4 ring-[#B7FF72]/40"
              : state === "reviewing"
              ? "bg-amber-950 text-amber-300 border-amber-400 shadow-amber-500/20"
              : state === "error"
              ? "bg-rose-950 text-rose-300 border-rose-400 shadow-rose-500/20"
              : state === "thinking" || state === "transcribing"
              ? "bg-[#18251D] text-white border-slate-700 shadow-md"
              : "bg-[#18251D] text-white border-slate-800 hover:border-[#B7FF72] hover:shadow-lg hover:shadow-[#B7FF72]/15 hover:scale-105"
          }`}
        >
          {/* Inner Icon / State Visual */}
          {state === "pending_activation" ? (
            <div className="flex flex-col items-center gap-1">
              <Play className="w-8 h-8 text-[#B7FF72] translate-x-0.5 group-hover:scale-110 transition-transform fill-[#B7FF72]" />
              <span className="text-[9px] font-mono font-bold tracking-widest uppercase text-[#B7FF72]">
                START
              </span>
            </div>
          ) : state === "speaking" ? (
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-1 h-6" aria-hidden="true">
                {[0.4, 0.9, 0.6, 1, 0.7, 0.5].map((h, i) => (
                  <motion.div
                    key={i}
                    animate={
                      shouldReduceMotion
                        ? {}
                        : {
                            scaleY: [h * 0.35, h * 1.1, h * 0.35],
                          }
                    }
                    transition={{
                      repeat: Infinity,
                      duration: 0.5,
                      delay: i * 0.09,
                      ease: "easeInOut",
                    }}
                    className="w-1 bg-[#B7FF72] rounded-full h-full origin-center"
                  />
                ))}
              </div>
              <span className="text-[8px] font-mono font-extrabold tracking-widest uppercase text-[#B7FF72]">
                SPEAKING
              </span>
            </div>
          ) : state === "listening" ? (
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-1 h-6" aria-hidden="true">
                {[0.4, 0.8, 1, 0.6, 0.9, 0.5, 0.7].map((height, i) => (
                  <motion.div
                    key={i}
                    animate={
                      shouldReduceMotion
                        ? {}
                        : {
                            scaleY: [height * 0.3, height * activeLevel, height * 0.3],
                          }
                    }
                    transition={{
                      repeat: Infinity,
                      duration: 0.6,
                      delay: i * 0.08,
                      ease: "easeInOut",
                    }}
                    className="w-1 bg-[#B7FF72] rounded-full h-full origin-center"
                  />
                ))}
              </div>
              <span className="text-[8px] font-mono font-bold tracking-widest uppercase text-[#B7FF72]">
                RECORDING
              </span>
            </div>
          ) : state === "transcribing" || state === "thinking" ? (
            <div className="flex flex-col items-center gap-1">
              <Loader2 className="w-7 h-7 text-[#B7FF72] animate-spin" />
              <span className="text-[8px] font-mono font-bold tracking-wider uppercase text-slate-300">
                {state === "transcribing" ? "WHISPER" : "CLINICAL"}
              </span>
            </div>
          ) : state === "reviewing" ? (
            <div className="flex flex-col items-center gap-1">
              <Edit3 className="w-7 h-7 text-amber-300" />
              <span className="text-[8px] font-mono font-bold tracking-wider uppercase text-amber-200">
                REVIEW
              </span>
            </div>
          ) : state === "error" ? (
            <div className="flex flex-col items-center gap-1">
              <AlertCircle className="w-7 h-7 text-rose-400" />
              <span className="text-[8px] font-mono font-bold tracking-wider uppercase text-rose-200">
                RETRY
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <Mic className="w-8 h-8 text-[#B7FF72] group-hover:scale-110 transition-transform" />
              <span className="text-[8px] font-mono font-bold tracking-widest uppercase text-slate-300">
                YOUR TURN
              </span>
            </div>
          )}
        </button>
      </div>

      {/* STATE BADGE & INSTRUCTION LABEL */}
      <div className="mt-4 text-center flex flex-col items-center gap-1.5 max-w-sm">
        <div
          className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-bold font-mono tracking-wide ${stateMeta.badgeBg} shadow-2xs`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              state === "speaking" || state === "listening" || state === "pending_activation"
                ? "bg-[#B7FF72] animate-ping"
                : state === "error"
                ? "bg-rose-500"
                : "bg-slate-400"
            }`}
          />
          <span>{stateMeta.label}</span>
        </div>
        <p className="text-xs text-slate-600 leading-normal font-medium max-w-xs">
          {stateMeta.sublabel}
        </p>
      </div>
    </div>
  );
}

export default ExpressiveVoiceOrb;
