"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Mic,
  ShieldCheck,
  Database,
  Navigation,
  ArrowRight,
  Activity,
  AlertTriangle,
  FileText,
  Clock,
  Sparkles,
  Lock
} from "lucide-react";

interface ArchitecturalRow {
  index: string;
  name: string;
  summary: string;
  href: string;
  tag: string;
}

const ARCHITECTURAL_ROWS: ArchitecturalRow[] = [
  {
    index: "01",
    name: "Acoustic Signal Front-End",
    summary:
      "Streams 16kHz conversational audio directly into transient memory. Voice Activity Detection captures speech cadence, exertional pauses, and respiratory effort without saving raw audio recordings to disk.",
    href: "/consult",
    tag: "16kHz PCM DSP",
  },
  {
    index: "02",
    name: "Diagnostic NLP & NegEx Extraction",
    summary:
      "Decomposes natural conversational sentences into verified ICD-10 medical entities. Negation invariants ensure that explicit denials ('no fever', 'no vomiting') are strictly maintained as absent findings.",
    href: "/privacy",
    tag: "ICD-10 & NegEx",
  },
  {
    index: "03",
    name: "Deterministic Safety Arbiter",
    summary:
      "Mathematical Emergency Severity Index (ESI v4) rule gates operate completely decoupled from generative language models. Emergency symptom constellations immediately override dialogue loops.",
    href: "/privacy",
    tag: "ESI v4 Rule Gate",
  },
  {
    index: "04",
    name: "HL7 FHIR Documentation & Routing",
    summary:
      "Compiles structured SOAP clinical summaries paired with standardized HL7 FHIR R4 Encounter bundles, calculating canonical driving travel times to regional facilities via OSRM.",
    href: "/care",
    tag: "HL7 FHIR & OSRM",
  },
];

export function BaselineArchitecturalCapabilities() {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  return (
    <div className="w-full">
      {/* ========================================================================= */}
      {/* PART 1: BASELINE NUMBERED CAPABILITIES LIST (On Off-White Canvas #F4F4F6) */}
      {/* ========================================================================= */}
      <section className="bg-[#F4F4F6] text-slate-900 py-20 sm:py-28 px-4 sm:px-6 lg:px-8 border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto space-y-12">
          
          {/* Baseline Header: Eyebrow + Stacked Headline */}
          <div className="space-y-4 max-w-3xl">
            <div className="inline-flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-slate-500 uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-600" />
              <span>ARCHITECTURAL CAPABILITIES</span>
            </div>
            
            <h2 className="text-3xl sm:text-5xl font-extrabold text-slate-950 tracking-tight leading-[1.05]">
              <span className="block">Engineered for</span>
              <span className="block text-teal-600">clinical certainty.</span>
            </h2>

            <p className="text-base sm:text-lg text-slate-600 leading-relaxed font-normal pt-1">
              MedVoice operates through a decoupled architecture that separates conversational dialogue fluency from strict, deterministic safety enforcement.
            </p>
          </div>

          {/* Numbered Program Rows List (Baseline Signature Component) */}
          <div className="space-y-0 border-t border-slate-300/80 mt-8">
            {ARCHITECTURAL_ROWS.map((row, idx) => {
              const isHovered = hoveredRow === idx;
              return (
                <Link
                  key={row.index}
                  href={row.href}
                  onMouseEnter={() => setHoveredRow(idx)}
                  onMouseLeave={() => setHoveredRow(null)}
                  className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-7 sm:py-8 border-b border-slate-200/90 transition-colors hover:bg-white/60 -mx-4 px-4 sm:rounded-2xl cursor-pointer"
                >
                  <div className="flex items-start sm:items-center gap-6 sm:gap-8">
                    {/* Index Number */}
                    <span className="font-mono text-sm sm:text-base font-bold text-slate-400 group-hover:text-teal-700 transition-colors w-8 shrink-0">
                      {row.index}
                    </span>

                    {/* Title & Description */}
                    <div className="space-y-1.5 max-w-3xl">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-950 group-hover:text-teal-800 transition-colors">
                          {row.name}
                        </h3>
                        <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded-md">
                          {row.tag}
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-normal">
                        {row.summary}
                      </p>
                    </div>
                  </div>

                  {/* Trailing Spring Arrow Button (Baseline Reference) */}
                  <div className="sm:self-center shrink-0 self-end">
                    <div
                      className={`w-11 h-11 rounded-full border flex items-center justify-center transition-all duration-200 ${
                        isHovered
                          ? "bg-slate-950 text-white border-slate-950 translate-x-1.5 shadow-xs"
                          : "bg-white text-slate-400 border-slate-300"
                      }`}
                    >
                      <ArrowRight className="w-4 h-4 transition-transform group-hover:scale-110" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

        </div>
      </section>

      {/* ========================================================================= */}
      {/* PART 2: BASELINE ASYMMETRIC STAGGERED DEMONSTRATION SECTION               */}
      {/* Overlaps up onto previous section with rounded-t-[2.5rem] and -mt-10      */}
      {/* ========================================================================= */}
      <section className="relative -mt-10 rounded-t-[2.5rem] bg-white text-slate-900 pt-16 sm:pt-24 pb-20 sm:pb-28 px-4 sm:px-6 lg:px-8 shadow-[0_-12px_40px_rgba(0,0,0,0.03)] border-t border-slate-200/80">
        <div className="max-w-6xl mx-auto">
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-end">
            
            {/* Left Column (Span 5): Intro & Stacked Typography */}
            <div className="lg:col-span-5 space-y-6">
              <div className="inline-flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-slate-500 uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-600" />
                <span>CLINICAL SAFETY IN PRACTICE</span>
              </div>

              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-950 tracking-tight leading-[1.05]">
                <span className="block">Deterministic Safety</span>
                <span className="block text-teal-600">at every turn.</span>
              </h2>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed font-normal">
                Generative AI models excel at conversational fluency, but clinical triage decisions demand absolute deterministic consistency. MedVoice binds conversations to explicit Emergency Severity Index rules.
              </p>

              <div className="pt-2">
                <Link
                  href="/privacy"
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-slate-950 hover:bg-slate-800 text-white text-xs font-mono font-bold uppercase tracking-wider transition-all active:scale-98 cursor-pointer shadow-xs"
                >
                  <span>Explore Safety Arbiter Logic</span>
                  <ArrowRight className="w-3.5 h-3.5 text-teal-400" />
                </Link>
              </div>
            </div>

            {/* Right Column (Span 7): Two Asymmetric Staggered Visual Cards (Baseline Court-Tile Pattern) */}
            <div className="lg:col-span-7 flex flex-col sm:flex-row gap-5 items-end">
              
              {/* Tile 1: Emergency Preemption Arbiter Card */}
              <div className="flex-1 w-full rounded-2xl sm:rounded-3xl border border-rose-200/90 bg-rose-50/70 p-6 sm:p-7 space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-rose-200/80 pb-3 font-mono text-xs">
                  <span className="font-bold text-rose-900 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    RULE INVARIANT
                  </span>
                  <span className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold text-[10px]">
                    ESI LEVEL 2
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-mono text-slate-900 bg-white/90 p-3 rounded-xl border border-rose-200 font-semibold space-y-1">
                    <div className="text-rose-900 text-[11px]">
                      [Retrosternal Pressure] + [Jaw Radiation] + [Exertion]
                    </div>
                    <div className="text-slate-500 text-[10px] font-sans">
                      Trigger: High-acuity ACS. Standard dialogue suppressed.
                    </div>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed font-normal pt-1">
                    Mathematical safety overrides immediately activate emergency EMS escalation when acute criteria are met.
                  </p>
                </div>

                {/* Glass Bottom Caption */}
                <div className="pt-2 border-t border-rose-200/60 flex items-center justify-between text-[11px] font-mono text-rose-800">
                  <span>Preemption Protocol</span>
                  <span className="font-bold">Algorithmic Gate</span>
                </div>
              </div>

              {/* Tile 2: Regional Reachability Tile (Staggered Offset: margin-bottom on sm/lg) */}
              <div className="flex-1 w-full rounded-2xl sm:rounded-3xl border border-slate-200 bg-slate-50/80 p-6 sm:p-7 space-y-4 shadow-sm sm:mb-8">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3 font-mono text-xs">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Navigation className="w-3.5 h-3.5 text-teal-600" />
                    ROAD ROUTING
                  </span>
                  <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 font-bold text-[10px] border border-teal-200">
                    CANONICAL OSRM
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-mono text-slate-900 bg-white p-3 rounded-xl border border-slate-200 font-semibold space-y-1">
                    <div className="text-slate-950 font-bold text-[11px]">
                      Manipal Emergency & Trauma
                    </div>
                    <div className="text-teal-700 text-[10px]">
                      8.4 km · ~16 min ETA (Primary Cath Lab Ready)
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed font-normal pt-1">
                    Emergency centers filtered by verified medical capabilities and computed with real road geometry.
                  </p>
                </div>

                {/* Glass Bottom Caption */}
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] font-mono text-slate-600">
                  <span>Facility Matrix</span>
                  <span className="font-bold text-slate-900">Verified Hub</span>
                </div>
              </div>

            </div>

          </div>

        </div>
      </section>
    </div>
  );
}
