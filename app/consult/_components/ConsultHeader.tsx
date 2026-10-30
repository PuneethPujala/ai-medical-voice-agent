"use client";

import React from "react";
import { DoctorProfile, DOCTOR_PROFILES } from "@/config/doctors";
import { PhoneOff, FileText, Clock, ShieldCheck, Activity } from "lucide-react";

interface ConsultHeaderProps {
  doctor: DoctorProfile;
  callDuration: number;
  audioStateLabel: string;
  hasMessages: boolean;
  onOpenSoapModal: () => void;
  onEndConsultation: () => void;
  onSelectDoctor?: (doctor: DoctorProfile) => void;
  isDoctorSwitchingDisabled?: boolean;
  isSessionActive?: boolean;
}

export function ConsultHeader({
  doctor,
  callDuration,
  audioStateLabel,
  hasMessages,
  onOpenSoapModal,
  onEndConsultation,
  onSelectDoctor,
  isDoctorSwitchingDisabled = false,
  isSessionActive = false,
}: ConsultHeaderProps) {
  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <header className="flex flex-col rounded-3xl bg-white border border-slate-200/90 shadow-2xs overflow-hidden">
      {/* ROW 1: CLINICIAN STATUS & PRIMARY CONTROLS */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
        {/* Left: Clinician status & timer */}
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="relative shrink-0">
            <img
              src={doctor.avatarUrl}
              alt={doctor.name}
              className="w-12 h-12 rounded-2xl object-cover border-2 border-[#18251D] shadow-xs"
            />
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#B7FF72] border-2 border-white ring-1 ring-[#18251D]" />
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-extrabold text-[#05070F] truncate">
                {doctor.name}
              </h1>
              <span className="text-xs sm:text-sm text-slate-500 font-medium truncate">
                · {doctor.department}
              </span>
              <span
                className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ${
                  isSessionActive
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-slate-100 text-slate-600 border-slate-200"
                }`}
              >
                {isSessionActive ? "Active Session" : "Session Standby"}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
              <span className="font-mono font-bold text-[#18251D] bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                ⏱ {formatTimer(callDuration)}
              </span>
              <span>·</span>
              <span className="text-slate-600 truncate font-medium">
                {audioStateLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2.5">
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono font-semibold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-[#18251D] animate-pulse" />
            <span>5 Specialists Synced</span>
          </div>

          {hasMessages && (
            <button
              type="button"
              onClick={onOpenSoapModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-[#18251D] bg-slate-100 hover:bg-slate-200/80 border border-slate-200 transition-colors shadow-2xs cursor-pointer"
              title="Inspect generated clinical SOAP chart"
            >
              <FileText className="w-3.5 h-3.5 text-[#18251D]" />
              <span>SOAP Note</span>
            </button>
          )}

          <button
            type="button"
            onClick={onEndConsultation}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold text-slate-700 bg-white border border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 transition-colors shadow-2xs cursor-pointer group"
          >
            <PhoneOff className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-600 transition-colors" />
            <span>End Consultation</span>
          </button>
        </div>
      </div>

      {/* ROW 2: INTEGRATED SPECIALIST SWITCHER TRACK */}
      {onSelectDoctor && (
        <div className="px-4 py-2 border-t border-slate-100 bg-[#FAF9F6]/80 flex items-center gap-2 overflow-x-auto scrollbar-none">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 shrink-0 mr-1 hidden sm:inline">
            Switch Specialist:
          </span>
          <div
            role="radiogroup"
            aria-label="Clinical Specialists"
            className="flex items-center gap-2 flex-nowrap"
          >
            {DOCTOR_PROFILES.map((doc) => {
              const isSelected = doctor.id === doc.id;
              const firstName = doc.name.split(" ")[1] || doc.name;
              return (
                <button
                  key={doc.id}
                  role="radio"
                  aria-checked={isSelected}
                  disabled={isDoctorSwitchingDisabled}
                  onClick={() => onSelectDoctor(doc)}
                  className={`group relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 border ${
                    isSelected
                      ? "bg-[#18251D] text-white border-[#18251D] shadow-2xs"
                      : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200 hover:border-slate-300"
                  } ${isDoctorSwitchingDisabled ? "opacity-60 cursor-not-allowed" : ""}`}
                  title={`${doc.name} · ${doc.department}`}
                >
                  <img
                    src={doc.avatarUrl}
                    alt={doc.name}
                    className={`w-4 h-4 rounded-full object-cover border ${
                      isSelected ? "border-[#B7FF72]" : "border-slate-200"
                    }`}
                  />
                  <span className="truncate max-w-[100px] text-[11px] font-bold">
                    {firstName}
                  </span>
                  <span
                    className={`text-[9px] font-mono uppercase tracking-wider px-1 py-0.2 rounded ${
                      isSelected
                        ? "bg-[#B7FF72]/20 text-[#B7FF72]"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {doc.id === "dr-sarah-chen" ? "Lead" : doc.department.split(" ")[0]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}

export default ConsultHeader;
