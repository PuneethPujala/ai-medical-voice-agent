"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Mic,
  MicOff,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  MessageSquare,
  RefreshCw,
} from "lucide-react";

export type MicGateState =
  | "RECAP_PLAYING"
  | "RECAP_COMPLETE_MIC_OFF"
  | "REQUESTING_MIC"
  | "PATIENT_LISTENING"
  | "PERMISSION_DENIED";

interface MicrophoneGateProps {
  isRecapPlaying: boolean;
  onMicrophoneActivated: (stream: MediaStream) => void;
  onTextOnlyFallback: () => void;
  onProceedClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function MicrophoneGate({
  isRecapPlaying,
  onMicrophoneActivated,
  onTextOnlyFallback,
  onProceedClick,
  disabled = false,
  className = "",
}: MicrophoneGateProps) {
  const [gateState, setGateState] = useState<MicGateState>(
    isRecapPlaying ? "RECAP_PLAYING" : "RECAP_COMPLETE_MIC_OFF"
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isRequestingRef = useRef<boolean>(false);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Sync state when recap begins or ends
  useEffect(() => {
    isMountedRef.current = true;
    if (isRecapPlaying) {
      setGateState("RECAP_PLAYING");
    } else if (gateState === "RECAP_PLAYING") {
      // INVARIANT: When recap finishes, mic remains strictly OFF!
      setGateState("RECAP_COMPLETE_MIC_OFF");
    }

    return () => {
      isMountedRef.current = false;
      cleanupStream();
    };
  }, [isRecapPlaying]);

  const cleanupStream = useCallback(() => {
    if (activeStreamRef.current) {
      try {
        activeStreamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
      } catch {}
      activeStreamRef.current = null;
    }
  }, []);

  const handleExplicitProceed = async () => {
    // Invariant: Double-click prevention
    if (isRequestingRef.current || disabled || isRecapPlaying) return;

    if (onProceedClick) {
      onProceedClick();
    }

    isRequestingRef.current = true;
    setGateState("REQUESTING_MIC");
    setErrorMessage(null);

    // If browser does not support getUserMedia (e.g. test environment or legacy browser)
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      console.warn("[MicrophoneGate] getUserMedia unsupported, falling back to text mode");
      isRequestingRef.current = false;
      if (isMountedRef.current) {
        onTextOnlyFallback();
      }
      return;
    }

    try {
      // EXPLICIT USER GESTURE ONLY
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (!isMountedRef.current) {
        // Component unmounted while permission prompt was open - immediately stop tracks!
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      activeStreamRef.current = stream;
      setGateState("PATIENT_LISTENING");
      isRequestingRef.current = false;
      onMicrophoneActivated(stream);
    } catch (err: any) {
      console.warn("[MicrophoneGate] getUserMedia rejected or denied:", err?.name, err?.message);
      if (!isMountedRef.current) return;

      isRequestingRef.current = false;
      setGateState("PERMISSION_DENIED");
      setErrorMessage(
        err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError"
          ? "Microphone access was denied. You can continue via text consultation or update browser permissions."
          : "Could not initialize audio capture hardware. Please check your microphone connection."
      );
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* 1. Main Action Trigger */}
      {gateState === "PERMISSION_DENIED" ? (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200/90 space-y-3 animate-in fade-in">
          <div className="flex items-start gap-2.5 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Microphone Permission Denied</p>
              <p className="text-[11px] text-amber-800/90 mt-0.5">{errorMessage}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleExplicitProceed}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-900 text-white hover:bg-amber-950 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Microphone</span>
            </button>
            <button
              type="button"
              onClick={onTextOnlyFallback}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <MessageSquare className="w-3.5 h-3.5 text-slate-600" />
              <span>Continue with Text Consultation</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <button
            type="button"
            disabled={disabled || isRecapPlaying || gateState === "REQUESTING_MIC"}
            onClick={handleExplicitProceed}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-xs sm:text-sm font-bold transition-all shadow-md cursor-pointer group ${
              isRecapPlaying
                ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                : gateState === "REQUESTING_MIC"
                ? "bg-slate-800 text-white cursor-wait"
                : "bg-slate-950 hover:bg-slate-800 text-white hover:shadow-lg"
            }`}
          >
            {gateState === "REQUESTING_MIC" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                <span>Requesting Microphone...</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 text-emerald-400" />
                <span>Proceed to Consultation</span>
                <ArrowRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>

          {/* Explicit Reassurance Badge */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-slate-700 border border-slate-200/80 font-medium shadow-2xs">
              <MicOff className="w-3.5 h-3.5 text-slate-400" />
              {isRecapPlaying
                ? "Microphone is strictly OFF during recap."
                : gateState === "REQUESTING_MIC"
                ? "Awaiting browser microphone confirmation..."
                : "Microphone is OFF until you click Proceed."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
