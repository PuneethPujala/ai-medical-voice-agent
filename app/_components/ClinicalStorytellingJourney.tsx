"use client";

import React, { useRef, useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Mic,
  Activity,
  AlertTriangle,
  Building2,
  ArrowRight,
  ShieldCheck,
  Check
} from "lucide-react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

interface JourneyStage {
  num: string;
  phase: string;
  title: string;
  summary: string;
  technicalArtifact: {
    label: string;
    pill: string;
    pillStyle: string;
    details: React.ReactNode;
  };
}

const JOURNEY_STAGES: JourneyStage[] = [
  {
    num: "01",
    phase: "ACOUSTIC INTAKE",
    title: "Continuous Patient Speech Capture",
    summary:
      "Captures natural, multi-clause conversational patient speech. Background ambient acoustics and pauses are handled in transient memory with immediate in-memory scrubbing post-transcription.",
    technicalArtifact: {
      label: "TRANSIENT ASR BUFFER",
      pill: "WHISPER BASE.EN ENGINE",
      pillStyle: "bg-teal-50 text-teal-800 border-teal-200",
      details: (
        <div className="space-y-2">
          <div className="text-xs text-slate-500 font-mono">Sample Incoming Audio Turn:</div>
          <div className="p-3 rounded-lg bg-slate-100/90 text-slate-900 font-serif italic text-xs leading-relaxed border border-slate-200">
            &ldquo;Started having a heavy tightness right in the center of my chest while shoveling snow, feels like an elephant sitting on me and my jaw hurts...&rdquo;
          </div>
          <div className="flex justify-between items-center text-[11px] font-mono text-slate-500 pt-1">
            <span>Audio Retention: None (Purged)</span>
            <span>Latency: ~1.4s</span>
          </div>
        </div>
      ),
    },
  },
  {
    num: "02",
    phase: "ENTITY MINING",
    title: "Standardized ICD-10 & Negation Extraction",
    summary:
      "Parses multi-clause clinical presentations into standardized ICD-10 concepts. Preserves critical clinical negations (e.g. 'denies shortness of breath') to prevent false positive triage triggers.",
    technicalArtifact: {
      label: "CLINICAL EVIDENCE BUS",
      pill: "ICD-10-CM MAPPED",
      pillStyle: "bg-slate-100 text-slate-900 border-slate-200",
      details: (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5 font-mono text-xs">
            <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold">
              R07.9 Chest Pain (Acute)
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-900 border border-slate-200 font-bold">
              R61 Diaphoresis
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
              Negation: Denies Fever
            </span>
          </div>
          <p className="text-xs text-slate-600 font-sans leading-relaxed">
            Severity: Severe · Radiation: Mandible & Left Shoulder · Exertional Onset: Positive
          </p>
        </div>
      ),
    },
  },
  {
    num: "03",
    phase: "DETERMINISTIC TRIAGE",
    title: "Algorithmic ESI Urgency Stratification",
    summary:
      "Evaluates clinical presentations against the Emergency Severity Index (ESI Levels 1–5). Acute red flags strictly preempt generative dialogue and initiate immediate emergency referral.",
    technicalArtifact: {
      label: "SAFETY ARBITER PRECEDENCE",
      pill: "ESI LEVEL 2 · EMERGENT",
      pillStyle: "bg-rose-50 text-rose-700 border-rose-200 font-bold",
      details: (
        <div className="p-3 rounded-lg bg-rose-50/80 border border-rose-200 text-rose-950 space-y-1.5 text-xs">
          <div className="font-mono font-bold text-rose-700 uppercase flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            ACUTE CORONARY RED FLAG TRIGGERED
          </div>
          <p className="text-rose-900 leading-relaxed font-sans">
            Preemptive safety rule overrides standard conversational turns. Direct emergency transfer protocol activated.
          </p>
        </div>
      ),
    },
  },
  {
    num: "04",
    phase: "ECOSYSTEM COORDINATION",
    title: "Canonical Road Routing & FHIR R4 Bundle",
    summary:
      "Calculates canonical driving travel times to verified Level-1 trauma centers or specialized facilities, compiling a standardized HL7 FHIR bundle for immediate clinician review.",
    technicalArtifact: {
      label: "REGIONAL CARE NETWORK",
      pill: "CATH LAB PRE-ARRIVAL READY",
      pillStyle: "bg-teal-50 text-teal-800 border-teal-200 font-bold",
      details: (
        <div className="space-y-2 text-xs">
          <div className="flex justify-between items-center text-slate-900 font-semibold font-mono">
            <span>Vijayawada Level-1 Trauma Hub</span>
            <span className="text-teal-700">8.4 km · ~16 min ETA</span>
          </div>
          <p className="text-slate-600 font-sans leading-relaxed text-[11px]">
            EHR Integration: HL7 FHIR R4 Encounter document ready with preliminary SOAP note and clinical vitals.
          </p>
        </div>
      ),
    },
  },
];

export function ClinicalStorytellingJourney() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Subtle scroll-driven entrance for each stage card
      const cards = gsap.utils.toArray<HTMLElement>(".journey-stage-card");
      cards.forEach((card) => {
        gsap.fromTo(
          card,
          { opacity: 0.2, y: 30 },
          {
            opacity: 1,
            y: 0,
            duration: 0.6,
            ease: "power2.out",
            scrollTrigger: {
              trigger: card,
              start: "top 80%",
              end: "top 45%",
              scrub: true,
            },
          }
        );
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="py-20 sm:py-28 bg-[#FAF9F6] border-b border-slate-200/80 relative overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
        
        {/* Section Header */}
        <div className="max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-800 font-mono text-xs font-semibold uppercase tracking-wider">
            <span>CLINICAL ARCHITECTURE PIPELINE</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-950 leading-[1.15]">
            How spoken symptoms become{" "}
            <span className="text-teal-600">deterministic clinical action.</span>
          </h2>
          <p className="text-base sm:text-lg text-slate-600 leading-relaxed font-normal">
            Every clinical encounter progresses through four continuous, deterministic layers—ensuring medical safety, HIPAA privacy, and zero hallucinated diagnostic commitments.
          </p>
        </div>

        {/* 4-Stage Connected Journey Cards */}
        <div className="space-y-8 sm:space-y-12">
          {JOURNEY_STAGES.map((stage, idx) => (
            <div
              key={stage.num}
              className="journey-stage-card rounded-2xl sm:rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-[0_12px_36px_-8px_rgba(15,23,42,0.06)] hover:border-slate-300 transition-all"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                
                {/* Left: Stage Context & Narrative */}
                <div className="lg:col-span-6 space-y-3.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-teal-600">
                      STAGE {stage.num}
                    </span>
                    <span className="text-slate-300">/</span>
                    <span className="font-mono text-xs uppercase tracking-wider font-semibold text-slate-500">
                      {stage.phase}
                    </span>
                  </div>

                  <h3 className="text-xl sm:text-2xl font-bold text-slate-950 tracking-tight">
                    {stage.title}
                  </h3>

                  <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                    {stage.summary}
                  </p>
                </div>

                {/* Right: Technical Artifact Slate */}
                <div className="lg:col-span-6">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-bold text-slate-600">{stage.technicalArtifact.label}</span>
                      <span className={`px-2.5 py-0.5 rounded text-[11px] font-semibold border ${stage.technicalArtifact.pillStyle}`}>
                        {stage.technicalArtifact.pill}
                      </span>
                    </div>
                    {stage.technicalArtifact.details}
                  </div>
                </div>

              </div>
            </div>
          ))}
        </div>

        {/* Bottom Transparency Notice */}
        <div className="text-center pt-2">
          <p className="text-xs font-mono text-slate-400 uppercase tracking-wider">
            [Sample clinical workflows illustrate deterministic preemption logic · Consult your local healthcare emergency provider in acute crisis]
          </p>
        </div>

      </div>
    </section>
  );
}
