"use client";

import React, { useRef, useEffect, useState } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Mic,
  Cpu,
  ShieldCheck,
  Lock,
  ArrowRight,
  CheckCircle2,
  Trash2,
  FileText,
  Terminal,
  ShieldAlert,
  Hash,
  Activity,
  Layers,
  Network,
  Sparkles,
} from "lucide-react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

interface NarrativeMilestone {
  step: string;
  badge: string;
  telemetryState: string;
  title: string;
  summary: string;
  specs: { label: string; value: string }[];
}

const MILESTONES: NarrativeMilestone[] = [
  {
    step: "01",
    badge: "MOVEMENT 01 · VOLATILE INGEST",
    telemetryState: "VOLATILE RAM · 0-BYTE DISK",
    title: "Patient voice enters volatile memory. Zero audio persisted.",
    summary:
      "When a patient speaks, 16kHz PCM audio chunks stream via MediaRecorder over strict TLS. The stream is allocated exclusively in volatile RAM ring-buffers. Raw acoustic waveforms are never written to permanent disk or relational tables.",
    specs: [
      { label: "INGEST PROTOCOL", value: "MediaRecorder PCM (16kHz)" },
      { label: "STORAGE FOOTPRINT", value: "0 Bytes Written to Disk" },
      { label: "MEMORY BUFFER", value: "Volatile RAM Ring-Buffer" },
      { label: "TRANSPORT SECURITY", value: "HTTPS / TLS 1.3 Transport" },
    ],
  },
  {
    step: "02",
    badge: "MOVEMENT 02 · LOCAL ASR & IMMEDIATE PURGE",
    telemetryState: "LOCAL WHISPER · BUFFER UNLINKED",
    title: "Neural transcription executes locally. Audio is instantly scrubbed.",
    summary:
      "Acoustic phonemes are decoded 100% locally on the server container using Whisper base.en. Voice data is never transmitted to third-party cloud speech providers. Upon completion, temporary files are permanently unlinked in an explicit finally: os.remove() block.",
    specs: [
      { label: "ASR ENGINE", value: "Whisper base.en (74M Local)" },
      { label: "CLOUD TRANSMISSION", value: "0% — 100% On-Premise" },
      { label: "BUFFER ZEROIZATION", value: "finally: os.remove(temp)" },
      { label: "POST-TURN RETENTION", value: "0-Byte Residual Waveform" },
    ],
  },
  {
    step: "03",
    badge: "MOVEMENT 03 · DETERMINISTIC ARBITRATION",
    telemetryState: "CLINICAL SLOTS · ESI ARBITER",
    title: "Fluid speech crystallizes into verified clinical structure.",
    summary:
      "Acoustic tokens are structured into standardized clinical slots (ICD-10 ontology, symptom timelines, and NegEx negation validation). Emergency constellations trigger our deterministic ESI v4 safety arbiter—completely decoupled from generative language models.",
    specs: [
      { label: "ONTOLOGY MAPPING", value: "ICD-10-CM & NegEx Filter" },
      { label: "SAFETY GATEWAY", value: "Deterministic ESI v4 Arbiter" },
      { label: "HALLUCINATION SHIELD", value: "Decoupled from LLMs" },
      { label: "INTEROP STANDARD", value: "HL7 FHIR R4 Condition" },
    ],
  },
  {
    step: "04",
    badge: "MOVEMENT 04 · CRYPTOGRAPHIC LEDGER & RBAC",
    telemetryState: "SHA-256 CHAINED · CLERK RBAC",
    title: "Transactions seal in an immutable, chained audit ledger.",
    summary:
      "Every clinical transaction, provider lookup, and triage recommendation generates a cryptographic SHA-256 digest chained to the preceding block. Enforced by Clerk server-side RBAC and strict IDOR boundaries, historical clinical logs cannot be altered without detection.",
    specs: [
      { label: "INTEGRITY DIGEST", value: "SHA-256 Chained Hash" },
      { label: "ACCESS CONTROL", value: "Clerk Server-Side JWT" },
      { label: "TENANT ISOLATION", value: "Strict IDOR Boundary" },
      { label: "STATUTORY CITATION", value: "45 CFR § 164.312 Compliant" },
    ],
  },
];

export function ImmersivePrivacyStoryScene() {
  const runwayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // Content panel refs
  const c0Ref = useRef<HTMLDivElement>(null);
  const c1Ref = useRef<HTMLDivElement>(null);
  const c2Ref = useRef<HTMLDivElement>(null);
  const c3Ref = useRef<HTMLDivElement>(null);

  // Visual art layer refs
  const v1Ref = useRef<HTMLDivElement>(null);
  const v2Ref = useRef<HTMLDivElement>(null);
  const v3Ref = useRef<HTMLDivElement>(null);
  const v4Ref = useRef<HTMLDivElement>(null);

  // Dynamic atmospheric lighting refs
  const auraRef = useRef<HTMLDivElement>(null);

  const [activeStep, setActiveStep] = useState<number>(0);
  const [scrollProgress, setScrollProgress] = useState<number>(0);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  // Jump to specific milestone on user click
  const scrollToMilestone = (index: number) => {
    if (!runwayRef.current) return;
    const runway = runwayRef.current;
    const startY = runway.offsetTop;
    const totalDist = 3400;
    // Normalized target points inside the steady plateaus
    const targets = [0.08, 0.35, 0.62, 0.89];
    const targetScrollY = startY + targets[index] * totalDist;
    window.scrollTo({
      top: targetScrollY,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    const isReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReducedMotion(isReduced);

    const runway = runwayRef.current;
    const stage = stageRef.current;
    const v1 = v1Ref.current;
    const v2 = v2Ref.current;
    const v3 = v3Ref.current;
    const v4 = v4Ref.current;
    const c0 = c0Ref.current;
    const c1 = c1Ref.current;
    const c2 = c2Ref.current;
    const c3 = c3Ref.current;
    const aura = auraRef.current;

    if (!runway || !stage || !v1 || !v2 || !v3 || !v4 || !c0 || !c1 || !c2 || !c3 || isReduced) {
      return;
    }

    const ctx = gsap.context(() => {
      // 1. Initial Settled State: Step 0 is active, crisp, zero blur
      gsap.set([c0, v1], {
        opacity: 1,
        y: 0,
        scale: 1,
        visibility: "visible",
        pointerEvents: "auto",
        filter: "blur(0px)",
      });
      gsap.set([c1, c2, c3], {
        opacity: 0,
        y: 25,
        visibility: "hidden",
        pointerEvents: "none",
      });
      gsap.set([v2, v3, v4], {
        opacity: 0,
        scale: 0.95,
        visibility: "hidden",
        pointerEvents: "none",
        filter: "blur(8px)",
      });

      if (aura) {
        gsap.set(aura, {
          background:
            "radial-gradient(circle at 65% 45%, rgba(183, 255, 114, 0.16) 0%, rgba(24, 37, 29, 0.4) 45%, transparent 70%)",
        });
      }

      // 2. Master Scrubbed Timeline with ScrollTrigger Pinning
      // Total duration = 6.0s anchored across 3400px scroll runway
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: runway,
          start: "top top",
          end: "+=3400",
          pin: stage,
          scrub: 0.8,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            const p = self.progress;
            setScrollProgress(p);

            // Update live progress bar width
            if (progressBarRef.current) {
              progressBarRef.current.style.width = `${Math.min(100, Math.max(0, p * 100))}%`;
            }

            // Determine active step based on progress thresholds
            let step = 0;
            if (p >= 0.72) step = 3;
            else if (p >= 0.48) step = 2;
            else if (p >= 0.24) step = 1;
            else step = 0;

            setActiveStep(step);
          },
        },
      });

      timelineRef.current = tl;

      // =======================================================================
      // SEQUENCED TIMELINE WITH DEFINED PLATEAUS & OVERLAPPING VISUAL MORPHS
      // Total timeline duration: 6.0 seconds
      // Milestone 0 (Ingest):      0.00 -> 1.20 (Steady plateau)
      // Transition 0 -> 1:         1.20 -> 1.65 (Wave sculpture cross-dissolves into particles)
      // Milestone 1 (ASR & Scrub): 1.65 -> 2.70 (Steady plateau)
      // Transition 1 -> 2:         2.70 -> 3.15 (Particles cross-dissolve into data cubes)
      // Milestone 2 (Synthesis):   3.15 -> 4.20 (Steady plateau)
      // Transition 2 -> 3:         4.20 -> 4.65 (Cubes cross-dissolve into ledger network)
      // Milestone 3 (Audit):       4.65 -> 6.00 (Steady plateau)
      // =======================================================================

      // -----------------------------------------------------------------------
      // MOVEMENT 0 -> 1: Ingest wave sculpture -> Dissolving particle flow
      // -----------------------------------------------------------------------
      // Text transition
      tl.to(c0, { opacity: 0, y: -20, duration: 0.20, ease: "power1.in" }, 1.20)
        .set(c0, { visibility: "hidden", pointerEvents: "none" }, 1.42)
        .set(c1, { visibility: "visible", pointerEvents: "auto" }, 1.45)
        .fromTo(c1, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.20, ease: "power1.out" }, 1.45);

      // Overlapping visual morph (v1 and v2 simultaneously visible during blend)
      tl.set(v2, { visibility: "visible" }, 1.20)
        .to(v1, { opacity: 0, scale: 1.06, filter: "blur(8px)", duration: 0.45, ease: "sine.inOut" }, 1.20)
        .fromTo(
          v2,
          { opacity: 0, scale: 0.94, filter: "blur(8px)" },
          { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.45, ease: "sine.inOut" },
          1.20
        )
        .set(v1, { visibility: "hidden", pointerEvents: "none" }, 1.65)
        .set(v2, { pointerEvents: "auto" }, 1.65);

      // Shift atmospheric lighting to emerald particle field
      if (aura) {
        tl.to(
          aura,
          {
            background:
              "radial-gradient(circle at 55% 50%, rgba(52, 211, 153, 0.18) 0%, rgba(15, 23, 42, 0.5) 50%, transparent 75%)",
            duration: 0.45,
            ease: "sine.inOut",
          },
          1.20
        );
      }

      // -----------------------------------------------------------------------
      // MOVEMENT 1 -> 2: Dissolving particles -> Assembled isometric compute cubes
      // -----------------------------------------------------------------------
      // Text transition
      tl.to(c1, { opacity: 0, y: -20, duration: 0.20, ease: "power1.in" }, 2.70)
        .set(c1, { visibility: "hidden", pointerEvents: "none" }, 2.92)
        .set(c2, { visibility: "visible", pointerEvents: "auto" }, 2.95)
        .fromTo(c2, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.20, ease: "power1.out" }, 2.95);

      // Overlapping visual morph
      tl.set(v3, { visibility: "visible" }, 2.70)
        .to(v2, { opacity: 0, scale: 1.06, filter: "blur(8px)", duration: 0.45, ease: "sine.inOut" }, 2.70)
        .fromTo(
          v3,
          { opacity: 0, scale: 0.94, filter: "blur(8px)" },
          { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.45, ease: "sine.inOut" },
          2.70
        )
        .set(v2, { visibility: "hidden", pointerEvents: "none" }, 3.15)
        .set(v3, { pointerEvents: "auto" }, 3.15);

      // Shift atmospheric lighting to structured compute glow
      if (aura) {
        tl.to(
          aura,
          {
            background:
              "radial-gradient(circle at 60% 45%, rgba(16, 185, 129, 0.16) 0%, rgba(24, 37, 29, 0.45) 50%, transparent 75%)",
            duration: 0.45,
            ease: "sine.inOut",
          },
          2.70
        );
      }

      // -----------------------------------------------------------------------
      // MOVEMENT 2 -> 3: Compute cubes -> Interconnected cryptographic ledger
      // -----------------------------------------------------------------------
      // Text transition
      tl.to(c2, { opacity: 0, y: -20, duration: 0.20, ease: "power1.in" }, 4.20)
        .set(c2, { visibility: "hidden", pointerEvents: "none" }, 4.42)
        .set(c3, { visibility: "visible", pointerEvents: "auto" }, 4.45)
        .fromTo(c3, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.20, ease: "power1.out" }, 4.45);

      // Overlapping visual morph
      tl.set(v4, { visibility: "visible" }, 4.20)
        .to(v3, { opacity: 0, scale: 1.06, filter: "blur(8px)", duration: 0.45, ease: "sine.inOut" }, 4.20)
        .fromTo(
          v4,
          { opacity: 0, scale: 0.94, filter: "blur(8px)" },
          { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.45, ease: "sine.inOut" },
          4.20
        )
        .set(v3, { visibility: "hidden", pointerEvents: "none" }, 4.65)
        .set(v4, { pointerEvents: "auto" }, 4.65);

      // Shift atmospheric lighting to cryptographic circuit green
      if (aura) {
        tl.to(
          aura,
          {
            background:
              "radial-gradient(circle at 50% 55%, rgba(183, 255, 114, 0.2) 0%, rgba(5, 7, 15, 0.6) 55%, transparent 80%)",
            duration: 0.45,
            ease: "sine.inOut",
          },
          4.20
        );
      }

      // Explicit timeline duration anchor
      tl.set({}, {}, 6.0);
    }, runway);

    return () => ctx.revert();
  }, []);

  // Static Fallback for reduced motion users
  if (reducedMotion) {
    return (
      <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto space-y-16">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-[#18251D] px-3.5 py-1.5 rounded-full bg-white border border-slate-200 shadow-2xs">
            DATA GOVERNANCE STORY · STATIC ACCESSIBLE VIEW
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[#05070F] tracking-tight">
            The Immutable Path of Patient Audio & Clinical Data
          </h2>
          <p className="text-slate-600 text-base leading-relaxed">
            Read through the complete 4-stage technical data lifecycle below, detailing memory isolation, local execution, and audit integrity.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {MILESTONES.map((item, idx) => (
            <div
              key={idx}
              className="p-8 rounded-3xl bg-[#090E0A] border border-emerald-950 text-white shadow-xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-2xl font-black text-[#B7FF72]">
                  {item.step}
                </span>
                <span className="font-mono text-[11px] font-bold uppercase px-3 py-1 rounded-full bg-[#18251D] border border-emerald-800 text-[#B7FF72]">
                  {item.telemetryState}
                </span>
              </div>
              <h3 className="text-xl font-bold text-white tracking-tight">
                {item.title}
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed">
                {item.summary}
              </p>
              <div className="space-y-2 pt-2 border-t border-slate-800">
                {item.specs.map((s, sIdx) => (
                  <div key={sIdx} className="flex justify-between items-center text-xs font-mono">
                    <span className="text-slate-400">{s.label}:</span>
                    <span className="font-bold text-[#B7FF72]">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <div
      ref={runwayRef}
      id="immersive-privacy-story"
      className="relative w-full bg-[#FAF9F6] selection:bg-[#B7FF72] selection:text-[#05070F]"
      style={{ height: "4400px" }}
    >
      {/* ===================================================================== */}
      {/* PINNED VIEWPORT STAGE CONTAINER                                       */}
      {/* ===================================================================== */}
      <div
        ref={stageRef}
        className="h-screen w-full relative overflow-hidden flex flex-col justify-between pt-24 sm:pt-28 pb-4 sm:pb-6 px-3 sm:px-6 lg:px-10 select-none"
      >
        {/* Architectural Stage Enclosure with Forest Graphite Canvas & Ambient Glow */}
        <div className="absolute inset-x-2 sm:inset-x-4 top-20 sm:top-24 bottom-3 sm:bottom-4 rounded-[28px] sm:rounded-[36px] lg:rounded-[44px] bg-[#05080A] border border-emerald-500/20 shadow-2xl overflow-hidden pointer-events-none -z-10">
          {/* Dynamic Ambient Aura that shifts per stage */}
          <div
            ref={auraRef}
            className="absolute inset-0 transition-all duration-700 pointer-events-none"
          />

          {/* Precision Architectural Grid Coordinates */}
          <div
            className="absolute inset-0 opacity-[0.035]"
            style={{
              backgroundImage:
                "linear-gradient(to right, #B7FF72 1px, transparent 1px), linear-gradient(to bottom, #B7FF72 1px, transparent 1px)",
              backgroundSize: "64px 64px",
            }}
          />

          {/* Stage Perimeter Vignette */}
          <div className="absolute inset-0 bg-radial-[circle_at_center,_transparent_40%,_rgba(5,7,15,0.8)_100%]" />
        </div>

        {/* ------------------------------------------------------------------- */}
        {/* 1. TOP STAGE HUD BAR & LIVE PROGRESS RAIL                           */}
        {/* ------------------------------------------------------------------- */}
        <div className="w-full max-w-7xl mx-auto flex flex-col gap-2 z-20 shrink-0 px-2 sm:px-4">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
            {/* Left Category Indicator */}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#B7FF72] shadow-[0_0_8px_#B7FF72] animate-pulse" />
              <span className="font-mono text-[10px] sm:text-xs font-bold uppercase tracking-[0.16em] text-[#B7FF72]">
                MEDVOICE / DATA LIFECYCLE
              </span>
            </div>

            {/* Center Dynamic Telemetry State */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md">
              <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                ACTIVE PIPELINE:
              </span>
              <span className="font-mono text-[10px] font-extrabold uppercase tracking-wider text-[#B7FF72]">
                {MILESTONES[activeStep].telemetryState}
              </span>
            </div>

            {/* Right Scroll Progress % */}
            <div className="flex items-center gap-1.5 font-mono text-[10px] sm:text-xs font-bold text-slate-400">
              <span className="hidden sm:inline text-slate-500 uppercase tracking-widest text-[9px]">
                JOURNEY
              </span>
              <span className="text-white font-extrabold">
                {Math.round(scrollProgress * 100)}%
              </span>
            </div>
          </div>

          {/* Interactive Milestone Navigation Rail */}
          <div className="relative w-full">
            {/* Background Track */}
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                ref={progressBarRef}
                className="h-full bg-gradient-to-r from-teal-400 via-[#B7FF72] to-emerald-400 transition-all duration-75"
                style={{ width: "0%" }}
              />
            </div>

            {/* Interactive Milestone Jump Buttons */}
            <div className="flex justify-between items-center mt-1.5">
              {MILESTONES.map((m, idx) => {
                const isCurrent = activeStep === idx;
                const isPassed = activeStep > idx;

                return (
                  <button
                    key={idx}
                    onClick={() => scrollToMilestone(idx)}
                    className="group flex items-center gap-1.5 sm:gap-2 focus:outline-hidden py-1 px-1.5 sm:px-2 rounded-lg hover:bg-white/5 transition-all text-left"
                    title={`Jump to Movement ${m.step}`}
                  >
                    <div
                      className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center font-mono text-[10px] sm:text-xs font-bold transition-all ${
                        isCurrent
                          ? "bg-[#B7FF72] text-[#05070F] shadow-[0_0_12px_rgba(183,255,114,0.6)] scale-110"
                          : isPassed
                          ? "bg-white/20 text-white"
                          : "bg-white/5 text-slate-500 group-hover:text-slate-300"
                      }`}
                    >
                      {m.step}
                    </div>
                    <div className="hidden sm:flex flex-col">
                      <span
                        className={`font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
                          isCurrent
                            ? "text-white"
                            : isPassed
                            ? "text-slate-300"
                            : "text-slate-500 group-hover:text-slate-300"
                        }`}
                      >
                        {idx === 0
                          ? "Voice Ingest"
                          : idx === 1
                          ? "Local ASR & Purge"
                          : idx === 2
                          ? "Clinical Structure"
                          : "Audit Ledger"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------------- */}
        {/* 2. MAIN IMMERSIVE STAGE VIEWPORT (CINEMATIC VISUAL + EDITORIAL)     */}
        {/* ------------------------------------------------------------------- */}
        <div className="w-full max-w-7xl mx-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center min-h-0 py-2 sm:py-3 z-10 px-2 sm:px-4">

          {/* ================================================================= */}
          {/* LEFT COLUMN: SYNCHRONIZED EDITORIAL NARRATIVE (4 PLATEAUS)        */}
          {/* ================================================================= */}
          <div className="lg:col-span-5 relative h-[240px] sm:h-[300px] lg:h-[380px] flex items-center">

            {/* STAGE 01 CARD · VOLATILE INGEST */}
            <div
              ref={c0Ref}
              className="absolute inset-0 flex flex-col justify-center space-y-3 sm:space-y-4 pr-0 lg:pr-2"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#18251D] border border-[#B7FF72]/40 shadow-sm w-fit">
                <Mic className="w-3.5 h-3.5 text-[#B7FF72]" />
                <span className="font-mono text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#B7FF72]">
                  {MILESTONES[0].badge}
                </span>
              </div>
              <h2 className="text-lg sm:text-2xl lg:text-3xl font-extrabold text-white tracking-tight leading-snug">
                {MILESTONES[0].title}
              </h2>
              <p className="text-xs sm:text-sm lg:text-[15px] text-slate-300 leading-relaxed font-normal">
                {MILESTONES[0].summary}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
                {MILESTONES[0].specs.map((s, idx) => (
                  <div key={idx} className="p-2 sm:p-2.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-slate-400">
                      {s.label}
                    </div>
                    <div className="font-mono text-xs font-bold text-white truncate mt-0.5">
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* STAGE 02 CARD · LOCAL ASR & PURGE */}
            <div
              ref={c1Ref}
              className="absolute inset-0 flex flex-col justify-center space-y-3 sm:space-y-4 pr-0 lg:pr-2"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#18251D] border border-emerald-400/40 shadow-sm w-fit">
                <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-mono text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-300">
                  {MILESTONES[1].badge}
                </span>
              </div>
              <h2 className="text-lg sm:text-2xl lg:text-3xl font-extrabold text-white tracking-tight leading-snug">
                {MILESTONES[1].title}
              </h2>
              <p className="text-xs sm:text-sm lg:text-[15px] text-slate-300 leading-relaxed font-normal">
                {MILESTONES[1].summary}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
                {MILESTONES[1].specs.map((s, idx) => (
                  <div key={idx} className="p-2 sm:p-2.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-slate-400">
                      {s.label}
                    </div>
                    <div className="font-mono text-xs font-bold text-white truncate mt-0.5">
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* STAGE 03 CARD · CLINICAL SYNTHESIS */}
            <div
              ref={c2Ref}
              className="absolute inset-0 flex flex-col justify-center space-y-3 sm:space-y-4 pr-0 lg:pr-2"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#18251D] border border-teal-400/40 shadow-sm w-fit">
                <FileText className="w-3.5 h-3.5 text-teal-400" />
                <span className="font-mono text-[10px] sm:text-xs font-bold uppercase tracking-wider text-teal-300">
                  {MILESTONES[2].badge}
                </span>
              </div>
              <h2 className="text-lg sm:text-2xl lg:text-3xl font-extrabold text-white tracking-tight leading-snug">
                {MILESTONES[2].title}
              </h2>
              <p className="text-xs sm:text-sm lg:text-[15px] text-slate-300 leading-relaxed font-normal">
                {MILESTONES[2].summary}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
                {MILESTONES[2].specs.map((s, idx) => (
                  <div key={idx} className="p-2 sm:p-2.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-slate-400">
                      {s.label}
                    </div>
                    <div className="font-mono text-xs font-bold text-white truncate mt-0.5">
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* STAGE 04 CARD · CRYPTOGRAPHIC LEDGER */}
            <div
              ref={c3Ref}
              className="absolute inset-0 flex flex-col justify-center space-y-3 sm:space-y-4 pr-0 lg:pr-2"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#18251D] border border-[#B7FF72]/40 shadow-sm w-fit">
                <ShieldCheck className="w-3.5 h-3.5 text-[#B7FF72]" />
                <span className="font-mono text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#B7FF72]">
                  {MILESTONES[3].badge}
                </span>
              </div>
              <h2 className="text-lg sm:text-2xl lg:text-3xl font-extrabold text-white tracking-tight leading-snug">
                {MILESTONES[3].title}
              </h2>
              <p className="text-xs sm:text-sm lg:text-[15px] text-slate-300 leading-relaxed font-normal">
                {MILESTONES[3].summary}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
                {MILESTONES[3].specs.map((s, idx) => (
                  <div key={idx} className="p-2 sm:p-2.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-slate-400">
                      {s.label}
                    </div>
                    <div className="font-mono text-xs font-bold text-white truncate mt-0.5">
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ================================================================= */}
          {/* RIGHT COLUMN: LARGE-SCALE 3D VISUAL TRANSFORMATION THEATER        */}
          {/* ================================================================= */}
          <div className="lg:col-span-7 relative h-[180px] sm:h-[280px] lg:h-[420px] rounded-2xl sm:rounded-3xl overflow-hidden flex items-center justify-center p-2 sm:p-4">

            {/* --------------------------------------------------------------- */}
            {/* STAGE 1 VISUAL: SCULPTURAL TRANSLUCENT ACOUSTIC WAVE            */}
            {/* --------------------------------------------------------------- */}
            <div
              ref={v1Ref}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="relative w-full h-full rounded-2xl overflow-hidden border border-emerald-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
                <Image
                  src="/images/privacy/stage1-acoustic-wave-sculpture.png"
                  alt="Translucent sculptural acoustic sound-wave entering volatile memory"
                  fill
                  priority
                  className="object-cover object-center"
                  sizes="(max-width: 1024px) 100vw, 60vw"
                />

                {/* Luminous Telemetry Overlay */}
                <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-3 py-1 rounded-full bg-[#05070F]/80 border border-[#B7FF72]/40 backdrop-blur-md">
                  <span className="w-2 h-2 rounded-full bg-[#B7FF72] shadow-[0_0_8px_#B7FF72] animate-pulse" />
                  <span className="font-mono text-[10px] font-bold text-[#B7FF72] uppercase tracking-wider">
                    INGEST: 16kHz PCM LOSSLESS
                  </span>
                </div>

                <div className="absolute bottom-3 right-3 z-10 hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-[#05070F]/80 border border-white/10 backdrop-blur-md">
                  <span className="font-mono text-[10px] font-bold text-slate-300">
                    RAM RING BUFFER · 0 BYTES PERSISTED
                  </span>
                </div>

                {/* Subtle Inner Glow Border */}
                <div className="absolute inset-0 ring-1 ring-inset ring-white/15 pointer-events-none rounded-2xl" />
              </div>
            </div>

            {/* --------------------------------------------------------------- */}
            {/* STAGE 2 VISUAL: WAVE SHATTERING & DISSOLVING INTO PARTICLES      */}
            {/* --------------------------------------------------------------- */}
            <div
              ref={v2Ref}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="relative w-full h-full rounded-2xl overflow-hidden border border-emerald-400/40 shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
                <Image
                  src="/images/privacy/stage2-wave-particle-dissolve.png"
                  alt="Acoustic wave dissolving into neural tokens and zeroized fragments"
                  fill
                  className="object-cover object-center"
                  sizes="(max-width: 1024px) 100vw, 60vw"
                />

                {/* Local ASR & Purge Status Badges */}
                <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-3 py-1 rounded-full bg-[#05070F]/80 border border-emerald-400/40 backdrop-blur-md">
                  <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-mono text-[10px] font-bold text-emerald-300 uppercase tracking-wider">
                    LOCAL WHISPER (74M) · ZERO CLOUD RETENTION
                  </span>
                </div>

                {/* Python Explicit Purge Status Pill */}
                <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/50 backdrop-blur-md">
                  <Trash2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-mono text-[10px] font-bold text-emerald-300">
                    finally: os.remove(temp_wav) — UNLINKED [0B]
                  </span>
                </div>

                <div className="absolute inset-0 ring-1 ring-inset ring-white/15 pointer-events-none rounded-2xl" />
              </div>
            </div>

            {/* --------------------------------------------------------------- */}
            {/* STAGE 3 VISUAL: ISOMETRIC DATA CUBES & CLINICAL STRUCTURE       */}
            {/* --------------------------------------------------------------- */}
            <div
              ref={v3Ref}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="relative w-full h-full rounded-2xl overflow-hidden border border-teal-400/40 shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
                <Image
                  src="/images/privacy/stage3-neural-compute-cubes.png"
                  alt="Frosted glass compute cubes structuring clinical entities and safety gates"
                  fill
                  className="object-cover object-center"
                  sizes="(max-width: 1024px) 100vw, 60vw"
                />

                {/* Anchored Structured Ontology Badges */}
                <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-3 py-1 rounded-full bg-[#05070F]/80 border border-teal-400/40 backdrop-blur-md">
                  <FileText className="w-3.5 h-3.5 text-teal-400" />
                  <span className="font-mono text-[10px] font-bold text-teal-300 uppercase tracking-wider">
                    HL7 FHIR R4 · ICD-10-CM [I20.9]
                  </span>
                </div>

                {/* Deterministic ESI Safety Gateway Callout */}
                <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2 px-3 py-1 rounded-full bg-[#05070F]/80 border border-emerald-400/50 backdrop-blur-md">
                  <ShieldAlert className="w-3.5 h-3.5 text-[#B7FF72]" />
                  <span className="font-mono text-[10px] font-bold text-[#B7FF72]">
                    ESI LEVEL 2 · DETERMINISTIC ARBITER GATE
                  </span>
                </div>

                <div className="absolute inset-0 ring-1 ring-inset ring-white/15 pointer-events-none rounded-2xl" />
              </div>
            </div>

            {/* --------------------------------------------------------------- */}
            {/* STAGE 4 VISUAL: CRYPTOGRAPHIC HARDWARE & SHA-256 LEDGER         */}
            {/* --------------------------------------------------------------- */}
            <div
              ref={v4Ref}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="relative w-full h-full rounded-2xl overflow-hidden border border-[#B7FF72]/40 shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
                <Image
                  src="/images/privacy/stage4-cryptographic-ledger-network.png"
                  alt="Precision dark hardware network with luminous green circuit traces and cryptographic ledger"
                  fill
                  className="object-cover object-center"
                  sizes="(max-width: 1024px) 100vw, 60vw"
                />

                {/* SHA-256 Hash Chain Pulse Overlay */}
                <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-3 py-1 rounded-full bg-[#05070F]/85 border border-[#B7FF72]/50 backdrop-blur-md">
                  <Hash className="w-3.5 h-3.5 text-[#B7FF72]" />
                  <span className="font-mono text-[10px] font-bold text-[#B7FF72] uppercase tracking-wider">
                    SHA-256 DIGEST: c89f...3e21 CHAINED
                  </span>
                </div>

                {/* Clerk Authoritative Access Control Badge */}
                <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2 px-3 py-1 rounded-full bg-[#05070F]/85 border border-white/20 backdrop-blur-md">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#B7FF72]" />
                  <span className="font-mono text-[10px] font-bold text-white">
                    CLERK SERVER-SIDE JWT · 45 CFR § 164.312
                  </span>
                </div>

                <div className="absolute inset-0 ring-1 ring-inset ring-white/15 pointer-events-none rounded-2xl" />
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------------- */}
        {/* 3. BOTTOM FOOTER TELEMETRY & SCROLL CUE                             */}
        {/* ------------------------------------------------------------------- */}
        <div className="w-full max-w-7xl mx-auto flex items-center justify-between text-slate-400 font-mono text-[10px] sm:text-xs z-10 px-2 sm:px-4 shrink-0 pt-1">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#B7FF72] shadow-[0_0_6px_#B7FF72]" />
            <span className="text-slate-300 font-medium">
              Acoustic-to-EHR Provenance Guaranteed
            </span>
          </div>

          <div className="flex items-center gap-2 text-slate-400">
            <span className="hidden sm:inline">
              Scroll to advance transformation
            </span>
            <span className="text-[#B7FF72] animate-bounce">↓</span>
          </div>
        </div>
      </div>
    </div>
  );
}
