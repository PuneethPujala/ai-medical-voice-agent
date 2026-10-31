"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  RotateCcw,
  AlertCircle,
  FileText,
  Loader2,
  Sparkles,
} from "lucide-react";
import { DoctorProfile } from "@/config/doctors";
import {
  synthesizeRecapScript,
  RecapScriptResult,
} from "@/lib/audio/recap-synthesizer";

interface RecapNarratorProps {
  consultation: any;
  doctor: DoctorProfile;
  onNarrationStart?: () => void;
  onNarrationComplete?: () => void;
  onNarrationError?: (error: string) => void;
  className?: string;
}

export type NarrationStatus =
  | "idle"
  | "synthesizing"
  | "playing"
  | "paused"
  | "error";

export function RecapNarrator({
  consultation,
  doctor,
  onNarrationStart,
  onNarrationComplete,
  onNarrationError,
  className = "",
}: RecapNarratorProps) {
  const [status, setStatus] = useState<NarrationStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recapData, setRecapData] = useState<RecapScriptResult | null>(null);
  const [showScriptText, setShowScriptText] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  // Synthesize script on load
  useEffect(() => {
    isMountedRef.current = true;
    try {
      const result = synthesizeRecapScript(consultation, {
        doctorName: doctor.name,
        maxWords: 120,
      });
      setRecapData(result);
    } catch (err: any) {
      console.warn("[RecapNarrator] Error generating recap script:", err);
    }

    return () => {
      isMountedRef.current = false;
      cleanupAudio();
    };
  }, [consultation, doctor.name]);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      } catch {}
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      try {
        URL.revokeObjectURL(audioUrlRef.current);
      } catch {}
      audioUrlRef.current = null;
    }
  }, []);

  const handleStartNarration = async () => {
    if (!recapData?.script) return;

    // Idempotency / toggle: if playing, pause it
    if (status === "playing") {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setStatus("paused");
      return;
    }

    // If paused, resume
    if (status === "paused" && audioRef.current) {
      try {
        await audioRef.current.play();
        setStatus("playing");
        if (onNarrationStart) onNarrationStart();
        return;
      } catch {
        // Fall through to re-synthesize
      }
    }

    cleanupAudio();
    setStatus("synthesizing");
    setErrorMessage(null);

    try {
      // Call local Kokoro TTS endpoint
      const res = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: recapData.script,
          doctorId: doctor.id,
          speed: 1.0,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "TTS synthesis failed");
        throw new Error(`TTS server returned status ${res.status}: ${errText}`);
      }

      const blob = await res.blob();
      if (!isMountedRef.current) return;

      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onplay = () => {
        if (!isMountedRef.current) return;
        setStatus("playing");
        if (onNarrationStart) onNarrationStart();
      };

      audio.onended = () => {
        if (!isMountedRef.current) return;
        setStatus("idle");
        cleanupAudio();
        if (onNarrationComplete) onNarrationComplete();
      };

      audio.onerror = (e) => {
        console.warn("[RecapNarrator] HTMLAudioElement playback error:", e);
        if (!isMountedRef.current) return;
        setStatus("error");
        setErrorMessage("Audio playback could not be decoded. Spoken narration fallback to text below.");
        cleanupAudio();
        if (onNarrationError) onNarrationError("Playback failed");
      };

      await audio.play();
    } catch (err: any) {
      console.warn("[RecapNarrator] Synthesis exception:", err);
      if (!isMountedRef.current) return;
      setStatus("error");
      setErrorMessage("Local Kokoro voice synthesis unavailable. Full text recap is displayed below.");
      cleanupAudio();
      if (onNarrationError) onNarrationError(err.message || "Synthesis error");
    }
  };

  const handleStopNarration = () => {
    cleanupAudio();
    setStatus("idle");
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-slate-100 text-slate-700">
            {status === "playing" ? (
              <Volume2 className="w-4 h-4 text-emerald-600 animate-pulse" />
            ) : status === "synthesizing" ? (
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
            ) : (
              <VolumeX className="w-4 h-4 text-slate-400" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">
                {status === "playing"
                  ? `Listening to ${doctor.name}...`
                  : status === "synthesizing"
                  ? "Synthesizing voice recap..."
                  : status === "paused"
                  ? "Voice recap paused"
                  : "Kokoro Voice Narration"}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                ({recapData?.wordCount || 0} words · Grounded)
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              {status === "playing"
                ? "Microphone is strictly OFF during recap audio playback."
                : "Listen to a concise, clinically grounded summary by your clinician."}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {status === "playing" ? (
            <>
              <button
                type="button"
                onClick={handleStartNarration}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors cursor-pointer"
              >
                <Pause className="w-3.5 h-3.5" />
                <span>Pause</span>
              </button>
              <button
                type="button"
                onClick={handleStopNarration}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition-colors cursor-pointer"
              >
                <VolumeX className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            </>
          ) : status === "paused" ? (
            <>
              <button
                type="button"
                onClick={handleStartNarration}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer shadow-xs"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Resume</span>
              </button>
              <button
                type="button"
                onClick={handleStopNarration}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
              >
                <span>Reset</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={status === "synthesizing"}
              onClick={handleStartNarration}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-950 hover:bg-slate-800 text-white disabled:opacity-50 transition-all cursor-pointer shadow-xs"
            >
              {status === "synthesizing" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  <span>Preparing Voice...</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Listen to Voice Recap</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowScriptText(!showScriptText)}
            className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Toggle script text"
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Error Fallback Banner */}
      {status === "error" && errorMessage && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/80 text-xs text-amber-900 flex items-start gap-2 animate-in fade-in">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">{errorMessage}</p>
            <p className="text-[11px] text-amber-800/90 mt-0.5">
              You can read the complete summary text below. Your clinical record is fully intact.
            </p>
          </div>
        </div>
      )}

      {/* Script Text Preview (Always accessible or when error occurs) */}
      {(showScriptText || status === "error") && recapData?.script && (
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs leading-relaxed text-slate-800 animate-in fade-in space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 pb-1 border-b border-slate-200/60">
            <span>Spoken Narration Script</span>
            <span>{recapData.wordCount} words (Max 120)</span>
          </div>
          <p className="italic font-medium">"{recapData.script}"</p>
        </div>
      )}
    </div>
  );
}
