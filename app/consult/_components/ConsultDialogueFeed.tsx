"use client";

import React, { useRef, useEffect } from "react";
import { Volume2, Stethoscope, AlertCircle, ArrowDown } from "lucide-react";

export interface ChatMessage {
  id: string;
  role: "doctor" | "patient" | "system";
  text: string;
  timestamp: string;
  doctorName?: string;
  doctorSpecialty?: string;
  doctorId?: string;
  wasInterrupted?: boolean;
  isBargeIn?: boolean;
}

interface ConsultDialogueFeedProps {
  messages: ChatMessage[];
  pendingDoctorMessage: {
    id: string;
    doctorName: string;
    doctorSpecialty?: string;
  } | null;
  selectedDoctorName: string;
  isDoctorSpeaking: boolean;
  onInterrupt: () => void;
  micPermissionError: string | null;
}

export function ConsultDialogueFeed({
  messages,
  pendingDoctorMessage,
  selectedDoctorName,
  isDoctorSpeaking,
  onInterrupt,
  micPermissionError,
}: ConsultDialogueFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, pendingDoctorMessage]);

  return (
    <div className="flex flex-col gap-3">
      {/* Active Interruption Bar */}
      {isDoctorSpeaking && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs sm:text-sm text-amber-950 shadow-2xs">
          <div className="flex items-center gap-2 font-medium">
            <Volume2 className="w-4 h-4 text-amber-600 animate-pulse" />
            <span>Doctor is speaking. Click Interrupt to speak immediately</span>
          </div>
          <button
            type="button"
            onClick={onInterrupt}
            className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            Interrupt
          </button>
        </div>
      )}

      {/* Mic Permission Alert */}
      {micPermissionError && (
        <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-xs sm:text-sm text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{micPermissionError}</span>
        </div>
      )}

      {/* Message Stream */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="min-h-[380px] max-h-[520px] overflow-y-auto flex flex-col gap-4 pr-2 scrollbar-thin scrollbar-thumb-slate-200"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400 gap-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-1">
              <Stethoscope className="w-6 h-6 text-[#18251D]" />
            </div>
            <h3 className="text-lg sm:text-xl font-extrabold text-[#05070F] tracking-tight">
              Consultation Room Ready
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 max-w-md leading-relaxed">
              Your attending clinician is ready. Click the central microphone to speak your symptoms naturally, or type in the bar below.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col gap-1.5 transition-all animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none ${
                msg.role === "system"
                  ? "items-center w-full my-2"
                  : msg.role === "doctor"
                  ? "items-start"
                  : "items-end"
              }`}
            >
              {/* System Event Notice */}
              {msg.role === "system" && (
                <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-600">
                  <span className="w-2 h-2 rounded-full bg-[#18251D]" />
                  <span>{msg.text}</span>
                  <span className="text-[10px] text-slate-400 font-mono">· {msg.timestamp}</span>
                </div>
              )}

              {/* Doctor Message Turn */}
              {msg.role === "doctor" && (
                <>
                  <div className="flex items-center gap-2 text-xs font-extrabold text-[#05070F]">
                    <span>{msg.doctorName?.toUpperCase() || selectedDoctorName.toUpperCase()}</span>
                    {msg.doctorSpecialty && (
                      <span className="text-[11px] font-semibold text-slate-500 font-sans">
                        · {msg.doctorSpecialty}
                      </span>
                    )}
                  </div>
                  <div className="max-w-[90%] sm:max-w-[85%] text-slate-900 text-sm sm:text-base leading-relaxed font-medium bg-[#FAF9F6] border border-slate-200/90 rounded-2xl px-4 py-3 shadow-2xs">
                    "{msg.text}"
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                    <span>{msg.timestamp}</span>
                    {msg.wasInterrupted && (
                      <>
                        <span>•</span>
                        <span className="text-amber-600 font-sans font-semibold">
                          Interrupted by patient
                        </span>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Patient Message Turn */}
              {msg.role === "patient" && (
                <>
                  <div className="max-w-[90%] sm:max-w-[85%] rounded-2xl px-4 py-3 bg-[#05070F] text-white text-sm sm:text-base leading-relaxed shadow-xs font-medium">
                    {msg.text}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono pr-1">
                    <span>{msg.timestamp}</span>
                    {msg.isBargeIn && (
                      <>
                        <span>•</span>
                        <span className="text-amber-600 font-sans font-semibold">
                          Patient interruption
                        </span>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}

        {/* Pending Turn Indicator */}
        {pendingDoctorMessage && (
          <div className="flex flex-col gap-1.5 items-start">
            <span className="text-xs font-extrabold text-[#05070F]">
              {pendingDoctorMessage.doctorName.toUpperCase()}
            </span>
            <div className="flex items-center gap-2.5 max-w-[85%] text-slate-600 text-xs sm:text-sm font-medium bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
              <span className="w-2 h-2 rounded-full bg-[#18251D] animate-ping" />
              <span className="italic">Formulating clinical assessment…</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConsultDialogueFeed;
