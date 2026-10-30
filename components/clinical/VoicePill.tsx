"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { Mic, Volume2, Send, Loader2, ArrowRight, Square, RotateCcw, X } from "lucide-react";

export type VoicePillState = "idle" | "listening" | "transcribing" | "understanding" | "responding" | "review";

export interface VoicePillProps {
  state: VoicePillState;
  onToggleRecord?: () => void;
  onStopRecord?: () => void;
  onSendRecord?: () => void;
  onInterrupt?: () => void;
  transcriptSnippet?: string;
  typedValue?: string;
  onTypedChange?: (val: string) => void;
  onSubmitText?: (val: string) => void;
  pendingTranscript?: string;
  onPendingTranscriptChange?: (val: string) => void;
  onConfirmSend?: () => void;
  onReRecord?: () => void;
  onDiscard?: () => void;
  className?: string;
  speakerName?: string;
  speakerVoiceId?: string;
  isSessionActive?: boolean;
}

export function VoicePill({
  state,
  onToggleRecord,
  onStopRecord,
  onSendRecord,
  onInterrupt,
  transcriptSnippet = "",
  typedValue = "",
  onTypedChange,
  onSubmitText,
  pendingTranscript = "",
  onPendingTranscriptChange,
  onConfirmSend,
  onReRecord,
  onDiscard,
  className = "",
  speakerName,
  speakerVoiceId,
  isSessionActive = true,
}: VoicePillProps) {
  const shouldReduceMotion = useReducedMotion();
  const isListening = state === "listening";
  const isResponding = state === "responding";
  const isTranscribing = state === "transcribing" || state === "understanding";
  const isReview = state === "review";

  const statusAnnouncement = (() => {
    switch (state) {
      case "listening":
        return transcriptSnippet ? `Listening: "${transcriptSnippet}"` : "Listening for your voice. Speak now or click send.";
      case "transcribing":
        return "Transcribing your speech...";
      case "review":
        return "Speech transcribed. Review or edit your message before sending.";
      case "understanding":
        return "Reviewing clinical symptoms...";
      case "responding":
        return `${speakerName || "Doctor"} is speaking. Click Interrupt to speak.`;
      case "idle":
      default:
        return "Ready. Type symptoms or click microphone to speak.";
    }
  })();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && typedValue.trim()) {
      onSubmitText?.(typedValue.trim());
    }
  };

  return (
    <motion.div
      layout={!shouldReduceMotion}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={`relative w-full rounded-2xl border transition-all ${
        isReview
          ? "bg-white text-slate-900 border-[#18251D] shadow-lg ring-4 ring-[#B7FF72]/20 p-4"
          : isListening
          ? "bg-slate-950 text-white border-[#18251D] shadow-[0_8px_30px_rgba(24,37,29,0.25)] ring-4 ring-[#B7FF72]/30 flex items-center gap-3 px-4 py-2.5"
          : isResponding
          ? "bg-slate-900 text-white border-[#18251D] shadow-md flex items-center gap-3 px-4 py-2.5"
          : state === "understanding"
          ? "bg-slate-50 text-slate-800 border-slate-200/90 shadow-xs flex items-center gap-3 px-4 py-2.5"
          : isTranscribing
          ? "bg-slate-900 text-white border-slate-700 shadow-sm flex items-center gap-3 px-4 py-2.5"
          : "bg-white text-slate-900 border-slate-200/90 shadow-xs hover:border-slate-300 focus-within:border-[#18251D] focus-within:ring-2 focus-within:ring-[#B7FF72]/40 flex items-center gap-3 px-4 py-2.5"
      } ${className}`}
    >
      {/* Visually hidden screen reader status announcement */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {statusAnnouncement}
      </div>

      {/* ===================== REVIEW STATE UI ===================== */}
      {isReview ? (
        <div className="flex flex-col gap-2.5 w-full">
          <div className="flex items-center justify-between text-xs">
            <div className="inline-flex items-center gap-2 text-[#18251D] font-semibold font-mono text-[11px] bg-[#FAF9F6] px-2.5 py-1 rounded-lg border border-[#18251D]/20">
              <span className="w-2 h-2 rounded-full bg-[#B7FF72] animate-pulse" />
              <span>Whisper STT Transcribed · Review &amp; Edit</span>
            </div>
            {onDiscard && (
              <button
                type="button"
                onClick={onDiscard}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-rose-600 px-2.5 py-1 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all cursor-pointer font-medium"
                aria-label="Discard transcript"
                title="Discard transcript"
              >
                <X className="w-3.5 h-3.5" />
                <span>Discard</span>
              </button>
            )}
          </div>

          <textarea
            value={pendingTranscript}
            onChange={(e) => onPendingTranscriptChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (pendingTranscript.trim()) {
                  onConfirmSend?.();
                }
              }
            }}
            rows={2}
            placeholder="Review or edit your spoken message before submitting..."
            aria-label="Edit transcribed speech"
            autoFocus
            className="w-full bg-slate-50 border border-slate-200 focus:border-[#18251D] focus:bg-white rounded-xl p-3 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none resize-none font-sans leading-relaxed focus:ring-2 focus:ring-[#B7FF72]/40 transition-all shadow-inner"
          />

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
            <span className="text-[11px] text-slate-500 hidden sm:inline font-mono">
              Press Enter to send (Shift+Enter for newline)
            </span>
            <div className="flex items-center gap-2 ml-auto">
              {onReRecord && (
                <button
                  type="button"
                  onClick={onReRecord}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold transition-all cursor-pointer"
                  aria-label="Re-record speech"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#18251D]" />
                  <span>Re-record</span>
                </button>
              )}
              <button
                type="button"
                onClick={onConfirmSend}
                disabled={!pendingTranscript.trim()}
                aria-label="Confirm and send transcript"
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold font-mono uppercase tracking-wider transition-all cursor-pointer ${
                  pendingTranscript.trim()
                    ? "bg-slate-950 hover:bg-slate-800 text-white shadow-sm ring-2 ring-slate-950/20"
                    : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60"
                }`}
              >
                <span>Confirm &amp; Send</span>
                <Send className="w-3 h-3 text-[#B7FF72]" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* ===================== LEFT: MICROPHONE / STATE ICON TRIGGER ===================== */}
          <button
            type="button"
            onClick={isListening ? (onStopRecord || onToggleRecord) : (isResponding ? onInterrupt : onToggleRecord)}
            aria-label={
              isResponding
                ? "Interrupt doctor"
                : isListening
                ? "Stop recording"
                : "Start microphone voice intake"
            }
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer flex-shrink-0 ${
              isListening
                ? `bg-rose-500 text-white shadow-md ${shouldReduceMotion ? "" : "animate-pulse"}`
                : isResponding
                ? "bg-[#18251D] text-[#B7FF72] hover:bg-black shadow-xs"
                : "bg-slate-900 text-white hover:bg-slate-800 shadow-2xs"
            }`}
          >
            {isListening ? (
              <Square className="w-3.5 h-3.5 fill-current" />
            ) : isResponding ? (
              <Volume2 className={`w-4 h-4 ${shouldReduceMotion ? "" : "animate-pulse"}`} />
            ) : isTranscribing ? (
              <Loader2 className={`w-4 h-4 text-[#B7FF72] ${shouldReduceMotion ? "" : "animate-spin"}`} />
            ) : (
              <Mic className="w-4 h-4 text-[#B7FF72]" />
            )}
          </button>

          {/* ===================== CENTER: TRANSFORMING INTERACTION BODY ===================== */}
          <div className="flex-1 min-w-0">
            {/* State A: LISTENING (Live Waveform + Interim Speech Snippet) */}
            {isListening && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 h-5 flex-shrink-0" aria-hidden="true">
                  {[0.4, 0.9, 0.6, 1, 0.7, 0.4, 0.8, 0.5, 0.9, 0.6].map((scale, i) =>
                    shouldReduceMotion ? (
                      <div
                        key={i}
                        style={{ height: `${Math.round(scale * 100)}%` }}
                        className="w-1 bg-[#B7FF72] rounded-full origin-center"
                      />
                    ) : (
                      <motion.div
                        key={i}
                        animate={{ scaleY: [scale * 0.3, scale, scale * 0.35] }}
                        transition={{ repeat: Infinity, duration: 0.7, delay: i * 0.07, ease: "easeInOut" }}
                        className="w-1 bg-[#B7FF72] rounded-full h-full origin-center"
                      />
                    )
                  )}
                </div>
                <span className="text-xs text-slate-200 font-sans truncate font-medium">
                  {transcriptSnippet ? `"${transcriptSnippet}"` : "Listening to your voice... speak now"}
                </span>
              </div>
            )}

            {/* State B: TRANSCRIBING / UNDERSTANDING (Processing Feedback) */}
            {isTranscribing && (
              <div className="flex items-center gap-2 text-xs font-sans">
                <span className={`w-2 h-2 rounded-full ${state === "understanding" ? "bg-[#18251D]" : "bg-[#B7FF72]"} ${shouldReduceMotion ? "" : "animate-pulse"}`} />
                <span className={`font-mono text-[11px] font-bold uppercase tracking-wider ${state === "understanding" ? "text-[#18251D]" : "text-[#B7FF72]"}`}>
                  {state === "understanding" ? "Clinical deliberation in progress..." : "Transcribing..."}
                </span>
                {transcriptSnippet && (
                  <span className={`${state === "understanding" ? "text-slate-500" : "text-slate-400"} truncate italic`}>
                    &quot;{transcriptSnippet}&quot;
                  </span>
                )}
              </div>
            )}

            {/* State C: RESPONDING (Doctor Speech Playback + Waveform) */}
            {isResponding && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0 ${shouldReduceMotion ? "" : "animate-pulse"}`} />
                  <span className="text-xs font-semibold text-white truncate">
                    {speakerName || "Doctor"} is speaking...
                  </span>
                </div>
                <span className="text-[11px] font-mono text-slate-300 hidden sm:inline flex-shrink-0">
                  Click to interrupt
                </span>
              </div>
            )}

            {/* State D: IDLE (Direct Input Field for Typing or Voice) - Kept mounted to preserve focus */}
            <input
              type="text"
              value={typedValue}
              onChange={(e) => onTypedChange?.(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type symptoms or click mic to speak..."
              aria-label="Patient symptoms input"
              tabIndex={isListening || isTranscribing || isResponding ? -1 : 0}
              aria-hidden={isListening || isTranscribing || isResponding ? "true" : undefined}
              className={`w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none font-medium ${
                isListening || isTranscribing || isResponding ? "sr-only" : "block"
              }`}
            />
          </div>

          {/* ===================== RIGHT: CONTEXTUAL ACTION BUTTON ===================== */}
          <div className="flex-shrink-0 flex items-center gap-2">
            {isListening ? (
              <button
                type="button"
                onClick={onSendRecord || onToggleRecord}
                aria-label="Review recorded voice"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#18251D] text-[#B7FF72] border border-[#18251D] hover:bg-black text-xs font-bold font-mono uppercase tracking-wider transition-colors cursor-pointer"
              >
                <span>Done</span>
                <Send className="w-3 h-3" />
              </button>
            ) : isResponding ? (
              <button
                type="button"
                onClick={onInterrupt}
                className="px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-400/40 hover:bg-amber-500/30 text-xs font-bold font-mono uppercase tracking-wider transition-colors cursor-pointer"
              >
                Interrupt
              </button>
            ) : (
              typedValue.trim() && (
                <button
                  type="button"
                  onClick={() => onSubmitText?.(typedValue.trim())}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-2xs transition-all cursor-pointer"
                >
                  <span>Send</span>
                  <ArrowRight className="w-3 h-3 text-[#B7FF72]" />
                </button>
              )
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}

export default VoicePill;

