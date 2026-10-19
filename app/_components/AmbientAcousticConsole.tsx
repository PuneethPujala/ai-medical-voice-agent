"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Mic,
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileText,
  Navigation,
  Clock,
  Sparkles,
  Shield,
  ArrowRight
} from "lucide-react";

export interface TriageScenario {
  id: string;
  label: string;
  category: string;
  esiBadge: string;
  esiStyle: string;
  speaker: string;
  turn: string;
  aiResponse: string;
  icd10: { code: string; label: string };
  action: string;
  verifiedRoute: string;
}

export const TRIAGE_SCENARIOS: TriageScenario[] = [
  {
    id: "cardiac",
    label: "Acute Chest Pressure",
    category: "CRITICAL TRIAGE",
    esiBadge: "ESI Level 2 · Emergent",
    esiStyle: "text-rose-700 bg-rose-50 border-rose-200",
    speaker: "Caller (Robert, 58yo M)",
    turn: "Sudden crushing retrosternal pressure radiating down left arm with cold diaphoresis, started 45 minutes ago while climbing stairs.",
    aiResponse: "Protocol ACS-2 engaged. ESI Level 2 verified. Pre-arrival STEMI telemetry dispatched to Level-1 Cath Lab.",
    icd10: { code: "ICD-10 R07.9", label: "Acute Chest Pain, Unspecified" },
    action: "Emergency Cath Lab Alerted · ED Trauma Team On-Call",
    verifiedRoute: "Level-1 Trauma Hub (8.4 km · ~16 min ETA)",
  },
  {
    id: "pediatric",
    label: "Pediatric Stridor & Fever",
    category: "URGENT INTAKE",
    esiBadge: "ESI Level 3 · Urgent",
    esiStyle: "text-amber-700 bg-amber-50 border-amber-200",
    speaker: "Parent (for Maya, 3yo)",
    turn: "Fever 102.8°F with barking stridor cough. Lethargic but responding, drinking clear fluids, no cyanosis observed.",
    aiResponse: "Urgent pediatric assessment scheduled for 2:15 PM. Fever reduction guidance delivered with red-flag warning triggers.",
    icd10: { code: "ICD-10 R05.1", label: "Acute Pediatric Stridor" },
    action: "Pediatric Slot Reserved · Red-Flag Preemption Active",
    verifiedRoute: "Regional Children's Urgent Care (3.2 km · ~8 min ETA)",
  },
  {
    id: "stroke",
    label: "Sudden Unilateral Weakness",
    category: "PREEMPTIVE STROKE",
    esiBadge: "ESI Level 1-2 · Immediate",
    esiStyle: "text-rose-800 bg-rose-100 border-rose-300 font-bold",
    speaker: "Daughter (for Helen, 71yo F)",
    turn: "Mom suddenly cannot raise her right arm, speech is slurred and drooping on the right side. Onset was 20 minutes ago.",
    aiResponse: "BE-FAST criteria positive. Immediate emergency ambulance dispatch initiated. Code Stroke pre-notification sent to neuro-interventional suite.",
    icd10: { code: "ICD-10 G45.9", label: "Transient Cerebral Ischemia" },
    action: "Immediate Code Stroke Protocol · 911 Dispatch Interlock",
    verifiedRoute: "Comprehensive Stroke Center (6.1 km · ~12 min ETA)",
  },
  {
    id: "asthma",
    label: "Exertional Wheezing Exacerbation",
    category: "RESPIRATORY",
    esiBadge: "ESI Level 3 · Urgent",
    esiStyle: "text-teal-700 bg-teal-50 border-teal-200",
    speaker: "Caller (David, 34yo M)",
    turn: "Severe expiratory wheezing not responding to initial rescue inhaler two puffs. Speaking in short 4-word sentences.",
    aiResponse: "Acute bronchospasm protocol. Recommended immediate nebulization. Rapid respiratory evaluation bay assigned.",
    icd10: { code: "ICD-10 J45.901", label: "Unspecified Asthma with Exacerbation" },
    action: "Respiratory Bay Alerted · Peak Flow Baseline Logged",
    verifiedRoute: "Acute Pulmonary Center (4.8 km · ~10 min ETA)",
  },
];

export function AmbientAcousticConsole() {
  const [selectedId, setSelectedId] = useState<string>("cardiac");
  const scenario = TRIAGE_SCENARIOS.find((s) => s.id === selectedId) || TRIAGE_SCENARIOS[0];

  return (
    <div className="w-full rounded-2xl sm:rounded-3xl bg-white border border-slate-200/90 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.08)] overflow-hidden">
      {/* Console Top Bar: Live Status & Simulation Notice */}
      <div className="px-4 sm:px-6 py-3.5 bg-slate-50/90 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
          <span className="font-mono font-bold text-slate-900 tracking-wider uppercase text-[11px]">
            ACOUSTIC INTAKE CONSOLE
          </span>
          <span className="hidden sm:inline-block text-slate-300">|</span>
          <span className="hidden sm:inline-block font-mono text-[10px] text-slate-500 uppercase tracking-widest">
            SIMULATED CLINICAL DIALOGUE · REPRESENTATIVE TEST DATA
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500 bg-white border border-slate-200 px-2.5 py-0.5 rounded-full">
          <span>SAMPLE SCENARIO</span>
        </div>
      </div>

      {/* Scenario Pill Selectors */}
      <div className="px-4 sm:px-6 pt-4 pb-3 bg-white border-b border-slate-100 flex items-center gap-2 overflow-x-auto no-scrollbar" role="tablist">
        {TRIAGE_SCENARIOS.map((s) => {
          const isActive = s.id === selectedId;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setSelectedId(s.id)}
              className={`px-3 py-1.5 rounded-xl font-mono text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? "bg-slate-950 text-white shadow-xs"
                  : "bg-slate-100/80 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Active Dialogue & Triage Slate */}
      <div className="p-4 sm:p-6 space-y-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={scenario.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* Caller Voice Turn */}
            <div className="p-3.5 sm:p-4 rounded-xl bg-slate-50 border border-slate-200/70 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-teal-600" />
                  {scenario.speaker}
                </span>
                <span className="text-[11px] text-slate-400 uppercase">Spoken Intake</span>
              </div>
              <p className="text-xs sm:text-sm font-medium text-slate-900 italic leading-relaxed">
                &ldquo;{scenario.turn}&rdquo;
              </p>
            </div>

            {/* Extracted Clinical Invariants Deck */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Card 1: Standardized ICD-10 Parsing */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5">
                <span className="text-[10px] font-mono uppercase font-bold text-slate-500 tracking-wider">
                  STANDARDIZED CLINICAL MAPPING
                </span>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-teal-50 border border-teal-200 text-teal-800 font-mono text-xs font-bold">
                    {scenario.icd10.code}
                  </span>
                  <span className="text-xs font-semibold text-slate-800 truncate">
                    {scenario.icd10.label}
                  </span>
                </div>
              </div>

              {/* Card 2: Deterministic ESI Urgency */}
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5">
                <span className="text-[10px] font-mono uppercase font-bold text-slate-500 tracking-wider">
                  DETERMINISTIC ESI STRATIFICATION
                </span>
                <div>
                  <span className={`inline-block px-2 py-0.5 rounded border text-xs font-bold font-mono ${scenario.esiStyle}`}>
                    {scenario.esiBadge}
                  </span>
                </div>
              </div>
            </div>

            {/* AI Decision & Care Routing */}
            <div className="p-3.5 sm:p-4 rounded-xl bg-slate-950 text-white space-y-2.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-teal-300 font-bold flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-teal-400" />
                  MEDVOICE RESPONSE & DISPATCH
                </span>
                <span className="text-[10px] text-slate-400 uppercase">Automated Clinical Plan</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-sans">
                {scenario.aiResponse}
              </p>
              <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-teal-400" />
                  {scenario.verifiedRoute}
                </span>
                <span className="text-teal-400 font-semibold">
                  {scenario.action}
                </span>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer Audit Notice */}
      <div className="px-4 sm:px-6 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-slate-400">
        <span>Acoustic Memory: Transient Buffer Scrubbed</span>
        <span>Decision Logic: Deterministic Precedence</span>
      </div>
    </div>
  );
}
