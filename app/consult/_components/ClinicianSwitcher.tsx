"use client";

import React from "react";
import { DoctorProfile, DOCTOR_PROFILES } from "@/config/doctors";
import { Check } from "lucide-react";

interface ClinicianSwitcherProps {
  selectedDoctor: DoctorProfile;
  onSelectDoctor: (doctor: DoctorProfile) => void;
  disabled?: boolean;
}

export function ClinicianSwitcher({
  selectedDoctor,
  onSelectDoctor,
  disabled = false,
}: ClinicianSwitcherProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1 px-1">
      <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-500 shrink-0 mr-1 hidden sm:inline">
        Attending Specialist:
      </span>
      <div
        role="radiogroup"
        aria-label="Clinical Specialists"
        className="flex items-center gap-2 flex-nowrap"
      >
        {DOCTOR_PROFILES.map((doc) => {
          const isSelected = selectedDoctor.id === doc.id;
          const firstName = doc.name.split(" ")[1] || doc.name;
          return (
            <button
              key={doc.id}
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onSelectDoctor(doc)}
              className={`group relative inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shrink-0 border ${
                isSelected
                  ? "bg-[#18251D] text-white border-[#18251D] shadow-xs"
                  : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200/90 hover:border-slate-300"
              } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
              title={`${doc.name} · ${doc.department}`}
            >
              <div className="relative">
                <img
                  src={doc.avatarUrl}
                  alt={doc.name}
                  className={`w-5 h-5 rounded-full object-cover border ${
                    isSelected ? "border-[#B7FF72]" : "border-slate-200"
                  }`}
                />
                {isSelected && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#B7FF72] ring-1 ring-[#18251D]" />
                )}
              </div>
              <span className="truncate max-w-[110px] font-bold">
                {firstName}
              </span>
              <span
                className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.2 rounded ${
                  isSelected
                    ? "bg-[#B7FF72]/20 text-[#B7FF72]"
                    : "bg-slate-100 text-slate-500 group-hover:text-slate-700"
                }`}
              >
                {doc.id === "dr-sarah-chen" ? "Lead" : doc.department.split(" ")[0]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default ClinicianSwitcher;
