"use client";

import React, { useState } from "react";
import {
  Activity,
  ShieldCheck,
  Building2,
  Users,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  PhoneCall,
  Flame,
  ArrowRight
} from "lucide-react";
import Link from "next/link";

interface ConsultClinicalContextProps {
  completenessPercent: number;
  establishedFindings: string[];
  missingElements: string[];
  isEmergency?: boolean;
  triageLevel?: string;
  triageTitle?: string;
  esiScore?: number | null;
  boardMessages?: any[];
  nearbyHospitals?: any[];
  onTriggerEmergencyCall?: (number: string) => void;
}

export function ConsultClinicalContext({
  completenessPercent,
  establishedFindings = [],
  missingElements = [],
  isEmergency = false,
  triageLevel = "routine",
  triageTitle = "Gathering Initial History",
  esiScore,
  boardMessages = [],
  nearbyHospitals = [],
  onTriggerEmergencyCall,
}: ConsultClinicalContextProps) {
  const [activeTab, setActiveTab] = useState<"findings" | "board" | "care">("findings");

  return (
    <div className="flex flex-col rounded-3xl bg-white border border-slate-200/90 shadow-xs overflow-hidden h-full min-h-[580px] justify-between">
      {/* 1. TOP DOSSIER HEADER */}
      <div className="p-4 sm:p-5 border-b border-slate-100 bg-[#FAF9F6] flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#18251D]" />
            <h3 className="text-xs font-mono font-extrabold uppercase tracking-widest text-[#05070F]">
              Clinical Dossier
            </h3>
          </div>
          <span
            className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-extrabold uppercase tracking-wider border ${
              isEmergency || (esiScore && esiScore <= 2)
                ? "bg-rose-50 text-rose-700 border-rose-300"
                : "bg-emerald-50 text-emerald-800 border-emerald-300"
            }`}
          >
            {isEmergency || (esiScore && esiScore <= 2)
              ? `ESI-${esiScore || 2} EMERGENCY`
              : `ESI-${esiScore || 4} ${triageLevel.toUpperCase()}`}
          </span>
        </div>

        {/* History Completeness Progress Meter */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
              History Completeness
            </span>
            <span className="font-extrabold text-[#18251D]">
              {Math.round(completenessPercent)}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-200/80 overflow-hidden">
            <div
              className="h-full bg-[#18251D] rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.max(6, Math.min(100, completenessPercent))}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. NAVIGATION SWITCHER TABS */}
      <div className="flex items-center border-b border-slate-200/80 bg-slate-50/70 p-1.5 text-xs font-mono font-bold">
        <button
          type="button"
          onClick={() => setActiveTab("findings")}
          className={`flex-1 py-2 px-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === "findings"
              ? "bg-[#18251D] text-[#B7FF72] shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Findings</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("board")}
          className={`flex-1 py-2 px-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === "board"
              ? "bg-[#18251D] text-[#B7FF72] shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Board ({boardMessages.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("care")}
          className={`flex-1 py-2 px-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
            activeTab === "care"
              ? "bg-[#18251D] text-[#B7FF72] shadow-xs"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          <span>Facilities</span>
        </button>
      </div>

      {/* 3. DYNAMIC TAB CONTENT (Flexible Middle Area) */}
      <div className="flex-1 p-5 overflow-y-auto min-h-[260px] max-h-[340px]">
        {/* TAB 1: Clinical Findings & History Checklist */}
        {activeTab === "findings" && (
          <div className="flex flex-col gap-4 text-slate-800">
            {/* Established Clinical Findings */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                Established Findings ({establishedFindings.length})
              </span>
              {establishedFindings.length === 0 ? (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-500 italic">
                  No verified clinical findings yet. Speak symptoms to populate diagnostic markers.
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {establishedFindings.map((finding, idx) => (
                    <li
                      key={idx}
                      className="flex items-center gap-2 text-xs font-medium text-slate-800 bg-emerald-50/60 px-3 py-2 rounded-xl border border-emerald-200/80"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="font-semibold text-slate-900">{finding}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Diagnostic Dimensions To Establish */}
            {missingElements.length > 0 && (
              <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                  Unresolved Clinical Criteria ({missingElements.length})
                </span>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {missingElements.slice(0, 8).map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200/60"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                      <span className="truncate">{item.replace(/_/g, " ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Specialist Board Deliberations */}
        {activeTab === "board" && (
          <div className="flex flex-col gap-3">
            {boardMessages.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                Board synchronization active. 5 specialist reviews update in real-time as symptoms are shared.
              </div>
            ) : (
              boardMessages.map((bm, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-[#18251D]">
                      {bm.doctorName}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">
                      {bm.specialty}
                    </span>
                  </div>
                  <p className="text-slate-700 leading-relaxed font-medium">
                    {bm.content}
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 3: Care Network & Facilities */}
        {activeTab === "care" && (
          <div className="flex flex-col gap-4 text-xs">
            <span className="font-mono font-bold uppercase tracking-wider text-slate-500">
              Synchronized Care Centers
            </span>
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col gap-1.5">
              <div className="flex items-center justify-between font-bold text-slate-900">
                <span>Apex Emergency Care Center</span>
                <span className="text-emerald-700 font-mono text-[11px]">1.8 km</span>
              </div>
              <span className="text-[11px] text-slate-500">
                Level-1 Trauma & Comprehensive Stroke Center · Open 24/7
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col gap-1.5">
              <div className="flex items-center justify-between font-bold text-slate-900">
                <span>City Heart Institute & ED</span>
                <span className="text-emerald-700 font-mono text-[11px]">3.4 km</span>
              </div>
              <span className="text-[11px] text-slate-500">
                Emergency PCI & Cardiac Intensive Care · Open 24/7
              </span>
            </div>

            <Link
              href="/care"
              className="inline-flex items-center justify-center gap-2 p-2.5 rounded-xl border border-slate-200 text-slate-800 hover:bg-slate-50 font-bold transition-all text-xs"
            >
              <MapPin className="w-3.5 h-3.5 text-[#18251D]" />
              <span>Open Regional Facility Matrix</span>
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
            </Link>
          </div>
        )}
      </div>

      {/* 4. PERMANENT EMERGENCY & SAFETY ANCHOR (Always visible at the bottom) */}
      <div className="p-4 sm:p-5 border-t border-slate-200/90 bg-[#FAF9F6] flex flex-col gap-3">
        <div
          className={`p-3 rounded-xl border flex items-start gap-2.5 ${
            isEmergency
              ? "bg-rose-50 border-rose-300 text-rose-950"
              : "bg-emerald-50/80 border-emerald-200 text-emerald-950"
          }`}
        >
          {isEmergency ? (
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          ) : (
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider">
              {isEmergency ? "RED-FLAG SAFETY OVERRIDE ACTIVE" : "SAFETY ARBITER ACTIVE"}
            </span>
            <p className="text-[11px] leading-tight text-slate-600">
              {isEmergency
                ? "Life-threat detected. Emergency transport recommended immediately."
                : "Continuous real-time surveillance for airway, chest, and neurological red flags."}
            </p>
          </div>
        </div>

        {/* Emergency Ambulance Direct Dial Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onTriggerEmergencyCall?.("108")}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-mono text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>DIAL 108</span>
          </button>
          <button
            type="button"
            onClick={() => onTriggerEmergencyCall?.("112")}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-[#18251D] hover:bg-black text-[#B7FF72] font-mono text-xs font-bold transition-all shadow-xs cursor-pointer border border-[#18251D]"
          >
            <PhoneCall className="w-3.5 h-3.5 text-[#B7FF72]" />
            <span>DIAL 112</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConsultClinicalContext;
