"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Radio,
  Navigation,
  Check,
  FileCheck,
  Lock,
  PhoneCall
} from "lucide-react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
  (window as any).ScrollTrigger = ScrollTrigger;
  (window as any).gsap = gsap;
}

interface StepMeta {
  num: string;
  shortLabel: string;
  badge: string;
  title: string;
  subtitle: string;
}

const STEPS: StepMeta[] = [
  {
    num: "01",
    shortLabel: "Patient Voice",
    badge: "MOVEMENT 1 · ACOUSTIC INTAKE",
    title: "Continuous Conversational Voice",
    subtitle:
      "Captures raw speech cadence, pauses, and urgent context at 16kHz PCM without forcing rigid digital form fields.",
  },
  {
    num: "02",
    shortLabel: "Clinical Extraction",
    badge: "MOVEMENT 2 · DIAGNOSTIC NLP",
    title: "Contextual Extraction & NegEx Safety",
    subtitle:
      "Decomposes spontaneous speech into verified ICD-10 ontology. Negation invariants strictly preserve denials as absent.",
  },
  {
    num: "03",
    shortLabel: "Safety Evaluation",
    badge: "MOVEMENT 3 · DETERMINISTIC ARBITER",
    title: "Deterministic ESI Urgency Gate",
    subtitle:
      "Decoupled from generative language models. Emergency symptom constellations immediately trigger override protocols.",
  },
  {
    num: "04",
    shortLabel: "Care Action",
    badge: "MOVEMENT 4 · CONNECTED ACTION",
    title: "Reasoned Dialogue & Hospital Routing",
    subtitle:
      "Synthesizes clinician guidance, computes canonical driving ETA via OSRM, and exports HL7 FHIR R4 records.",
  },
];

interface MorphVisualConfig {
  src: string;
  badge: string;
  pillIconText: string;
  caption: string;
  borderRadius: string;
  glowColor: string;
  borderColor: string;
}

const MORPH_CONFIGS: MorphVisualConfig[] = [
  {
    // Stage 0: Upper-Left (Living voice signal entering)
    src: "/journey-morph-1.jpg",
    badge: "MOVEMENT 1 · LIVING SIGNAL",
    pillIconText: "16kHz ACOUSTIC ENVELOPE",
    caption: "Spontaneous conversational speech captured with lossless acoustic dynamics.",
    borderRadius: "4.5rem 1.5rem 4rem 1.75rem",
    glowColor: "rgba(13, 148, 136, 0.28)",
    borderColor: "rgba(20, 184, 166, 0.55)",
  },
  {
    // Stage 1: Upper-Right (Glides upper-left ↗ upper-right, structured decomposition)
    src: "/journey-morph-2.png",
    badge: "MOVEMENT 2 · ONTOLOGY MAPPING",
    pillIconText: "ICD-10 DECOMPOSITION",
    caption: "Fluid acoustic waveforms structured into verified clinical ontology.",
    borderRadius: "1.75rem 4.5rem 1.5rem 4rem",
    glowColor: "rgba(99, 102, 241, 0.28)",
    borderColor: "rgba(99, 102, 241, 0.55)",
  },
  {
    // Stage 2: Lower-Left (Sweeps upper-right ↙ lower-left, precise geometry & warning warmth)
    src: "/journey-morph-3.png",
    badge: "MOVEMENT 3 · SAFETY ARBITER",
    pillIconText: "DETERMINISTIC PREEMPTION",
    caption: "High-acuity emergency constellations trigger hard-coded safety gates.",
    borderRadius: "3rem 1.75rem 4.5rem 1.75rem",
    glowColor: "rgba(239, 68, 68, 0.35)",
    borderColor: "rgba(239, 68, 68, 0.6)",
  },
  {
    // Stage 3: Lower-Right (Sweeps lower-left ↗ lower-right, connected care routes & destinations)
    src: "/journey-morph-4.jpg",
    badge: "MOVEMENT 4 · CONNECTED ACTION",
    pillIconText: "OSRM ROUTING & FHIR R4",
    caption: "Canonical navigation trajectories and structured clinical handoffs dispatched.",
    borderRadius: "1.75rem 4rem 1.75rem 4.5rem",
    glowColor: "rgba(16, 185, 129, 0.3)",
    borderColor: "rgba(16, 185, 129, 0.55)",
  },
];

export function OrchestratedClinicalJourney() {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinSectionRef = useRef<HTMLDivElement>(null);
  const stageAreaRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);

  const content0Ref = useRef<HTMLDivElement>(null);
  const content1Ref = useRef<HTMLDivElement>(null);
  const content2Ref = useRef<HTMLDivElement>(null);
  const content3Ref = useRef<HTMLDivElement>(null);

  const [activeStep, setActiveStep] = useState<number>(0);
  const activeStepRef = useRef<number>(0);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  useEffect(() => {
    const container = containerRef.current;
    const pinSection = pinSectionRef.current;
    const stageArea = stageAreaRef.current;
    const visual = visualRef.current;
    const c0 = content0Ref.current;
    const c1 = content1Ref.current;
    const c2 = content2Ref.current;
    const c3 = content3Ref.current;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReducedMotion(prefersReducedMotion);

    if (!container || !pinSection || !stageArea || !visual || !c0 || !c1 || !c2 || !c3 || prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      // Helper: Calculate exact pixel distance to place visual flush right in container
      const getTargetX = () => {
        const parentW = stageArea.offsetWidth;
        const visualW = visual.offsetWidth;
        return Math.max(0, parentW - visualW);
      };

      // Set initial positions: Stage 1 (Visual on Left, Content 0 on Right)
      // Visual top starts with y: 0, sitting cleanly 28-36px below the tabs
      gsap.set(visual, {
        x: 0,
        y: 0,
        rotation: -2.5,
        scale: 1.0,
        transformOrigin: "center center",
        willChange: "transform",
      });

      gsap.set(c0, { x: 0, opacity: 1, visibility: "visible", pointerEvents: "auto" });
      gsap.set(c1, { x: -30, opacity: 0, visibility: "hidden", pointerEvents: "none" });
      gsap.set(c2, { x: 30, opacity: 0, visibility: "hidden", pointerEvents: "none" });
      gsap.set(c3, { x: -30, opacity: 0, visibility: "hidden", pointerEvents: "none" });

      // Scrubbed GSAP master timeline linked to ScrollTrigger
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: container,
          start: "top top",
          end: "+=2600",
          pin: pinSection,
          scrub: 0.8,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            const p = self.progress;
            let step = 0;
            if (p >= 0.79) step = 3;
            else if (p >= 0.49) step = 2;
            else if (p >= 0.18) step = 1;
            else step = 0;

            // Discrete update: ONLY trigger re-render when stage index changes
            if (step !== activeStepRef.current) {
              activeStepRef.current = step;
              setActiveStep(step);
            }
          },
        },
      });

      timelineRef.current = tl;

      // -----------------------------------------------------------------------
      // CHOREOGRAPHED SCROLL TRAJECTORY (Zero Bounding-Box Collisions)
      // Normalized: Total duration = 3.6s
      // -----------------------------------------------------------------------

      // Movement 1 -> 2: Stage 1 (Right content) -> Stage 2 (Left content)
      // 1. Content 0 vacates right column first (0.20 -> 0.42)
      tl.to(c0, { opacity: 0, x: 25, duration: 0.22, ease: "power1.in" }, 0.20)
        .set(c0, { visibility: "hidden", pointerEvents: "none" }, 0.42)
        // 2. Visual glides from Left to Right (0.35 -> 1.00) (Right column is clear!)
        .to(visual, {
          x: getTargetX,
          y: 0,
          rotation: 2.5,
          scale: 1.0,
          ease: "power2.inOut",
          duration: 0.65,
        }, 0.35)
        // 3. Content 1 enters Left column (0.88 -> 1.10) (Left column is clear!)
        .set(c1, { visibility: "visible", pointerEvents: "auto" }, 0.88)
        .fromTo(c1,
          { opacity: 0, x: -30 },
          { opacity: 1, x: 0, duration: 0.22, ease: "power1.out" },
          0.88
        );

      // Movement 2 -> 3: Stage 2 (Left content) -> Stage 3 (Right content)
      // 1. Content 1 vacates left column first (1.30 -> 1.52)
      tl.to(c1, { opacity: 0, x: -25, duration: 0.22, ease: "power1.in" }, 1.30)
        .set(c1, { visibility: "hidden", pointerEvents: "none" }, 1.52)
        // 2. Visual sweeps diagonally from Right down to Left (1.45 -> 2.10)
        .to(visual, {
          x: 0,
          y: 15,
          rotation: -2.0,
          scale: 1.02,
          ease: "power2.inOut",
          duration: 0.65,
        }, 1.45)
        // 3. Content 2 enters Right column (1.98 -> 2.20)
        .set(c2, { visibility: "visible", pointerEvents: "auto" }, 1.98)
        .fromTo(c2,
          { opacity: 0, x: 30 },
          { opacity: 1, x: 0, duration: 0.22, ease: "power1.out" },
          1.98
        );

      // Movement 3 -> 4: Stage 3 (Right content) -> Stage 4 (Left content)
      // 1. Content 2 vacates right column first (2.40 -> 2.62)
      tl.to(c2, { opacity: 0, x: 25, duration: 0.22, ease: "power1.in" }, 2.40)
        .set(c2, { visibility: "hidden", pointerEvents: "none" }, 2.62)
        // 2. Visual glides across from Left to Right (2.55 -> 3.20)
        .to(visual, {
          x: getTargetX,
          y: 10,
          rotation: 2.0,
          scale: 1.0,
          ease: "power2.inOut",
          duration: 0.65,
        }, 2.55)
        // 3. Content 3 enters Left column (3.08 -> 3.30)
        .set(c3, { visibility: "visible", pointerEvents: "auto" }, 3.08)
        .fromTo(c3,
          { opacity: 0, x: -30 },
          { opacity: 1, x: 0, duration: 0.22, ease: "power1.out" },
          3.08
        );

      // Dwell at Stage 4 (3.30 -> 3.60)
      tl.to(visual, { duration: 0.3 }, 3.30);
    }, container);

    return () => {
      ctx.revert();
    };
  }, []);

  const handleStepClick = useCallback((stepIdx: number) => {
    activeStepRef.current = stepIdx;
    setActiveStep(stepIdx);

    const pinSection = pinSectionRef.current;
    const trigger = ScrollTrigger.getAll().find((t) => t.pin === pinSection);
    if (trigger) {
      // Discrete progress targets inside each movement's dwell zone
      const targetProgress = [0.03, 0.33, 0.64, 0.96][stepIdx];
      const targetScroll = trigger.start + (trigger.end - trigger.start) * targetProgress;
      window.scrollTo({ top: targetScroll, behavior: "instant" });
      if (typeof window !== "undefined" && (window as any).ScrollTrigger) {
        (window as any).ScrollTrigger.update();
      }
    }
  }, []);

  const handleNext = () => {
    if (activeStep < STEPS.length - 1) {
      handleStepClick(activeStep + 1);
    }
  };

  const handlePrev = () => {
    if (activeStep > 0) {
      handleStepClick(activeStep - 1);
    }
  };

  const currentMeta = STEPS[activeStep];
  const currentVisual = MORPH_CONFIGS[activeStep];

  return (
    <div
      id="journey"
      ref={containerRef}
      className="relative w-full bg-[#FAF9F6] border-b border-slate-200/80 overflow-hidden"
    >
      {/* Pinned Editorial Screen Canvas */}
      <div
        ref={pinSectionRef}
        className="w-full min-h-screen flex flex-col justify-between pt-20 pb-6 sm:pt-24 sm:pb-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto"
      >
        {/* =================================================================== */}
        {/* TOP NARRATIVE BAR & PROGRESSION STEP TRACKER                        */}
        {/* =================================================================== */}
        <div className="space-y-4">
          {/* Eyebrow & Stacked Section Title */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-200/80 pb-4">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-slate-500 uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-pulse" />
                <span>CLINICAL TRANSFORMATION PIPELINE</span>
              </div>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black text-slate-950 tracking-tight leading-tight">
                From Spoken Voice to <span className="text-teal-600">Deterministic Action.</span>
              </h2>
            </div>

            <div className="text-xs font-mono text-slate-600 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-2xs self-start sm:self-auto flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
              <span>Illustrative Scenario: </span>
              <span className="font-bold text-slate-900">ACS Presentation #904 (58M)</span>
            </div>
          </div>

          {/* Architectural Stage Progression Rail (Baseline Step Path) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {STEPS.map((step, idx) => {
              const isActive = activeStep === idx;
              const isPast = activeStep > idx;
              return (
                <button
                  key={step.num}
                  onClick={() => handleStepClick(idx)}
                  className={`text-left p-3 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                    isActive
                      ? "bg-slate-950 text-white border-slate-950 shadow-sm"
                      : isPast
                      ? "bg-white text-slate-900 border-teal-200 hover:border-teal-300"
                      : "bg-white/60 text-slate-500 border-slate-200 hover:bg-white"
                  }`}
                  aria-selected={isActive}
                  role="tab"
                >
                  <div className="flex items-center justify-between text-xs font-mono mb-1">
                    <span
                      className={`font-bold ${
                        isActive ? "text-teal-400" : isPast ? "text-teal-600" : "text-slate-400"
                      }`}
                    >
                      {step.num}
                    </span>
                    {isPast && <Check className="w-3.5 h-3.5 text-teal-600" />}
                    {isActive && <span className="w-2 h-2 rounded-full bg-teal-400 animate-ping" />}
                  </div>
                  <div className="font-bold text-xs sm:text-sm tracking-tight truncate">
                    {step.shortLabel}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* =================================================================== */}
        {/* ACTIVE STAGE EDITORIAL DISPLAY AREA (Persistent Morph Visual + Text)*/}
        {/* =================================================================== */}
        <div
          ref={stageAreaRef}
          className="relative mt-7 sm:mt-9 mb-auto w-full min-h-[480px] lg:h-[480px]"
        >
          {/* --------------------------------------------------------------- */}
          {/* SINGLE PERSISTENT CURVED-IMAGE FOCAL POINT (DESKTOP)             */}
          {/* GSAP Timeline strictly owns x, y, rotation, scale; React owns image */}
          {/* --------------------------------------------------------------- */}
          <div
            ref={visualRef}
            className="hidden lg:block absolute top-0 left-0 z-10 pointer-events-none select-none"
            style={{
              width: "46%",
              height: "460px",
              filter: `drop-shadow(0 25px 60px ${currentVisual.glowColor})`,
              transition: "filter 0.6s ease-out",
              ...(reducedMotion
                ? {
                    left: activeStep % 2 === 1 ? "auto" : 0,
                    right: activeStep % 2 === 1 ? 0 : "auto",
                  }
                : {}),
            }}
          >
            <div
              className="w-full h-full relative overflow-hidden backdrop-blur-xl bg-white/40 border-2 transition-all duration-700 pointer-events-auto"
              style={{
                borderRadius: currentVisual.borderRadius,
                borderColor: currentVisual.borderColor,
              }}
            >
              {/* Crossfading Visual Imagery */}
              <AnimatePresence mode="popLayout">
                <motion.img
                  key={currentVisual.src}
                  src={currentVisual.src}
                  alt={currentVisual.caption}
                  initial={{ opacity: 0, scale: 1.08 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.94 }}
                  transition={{ duration: 0.45, ease: "easeInOut" }}
                  className="w-full h-full object-cover select-none"
                />
              </AnimatePresence>

              {/* Specular Glaze & Lighting Gradient */}
              <div className="absolute inset-0 bg-gradient-to-tr from-black/35 via-transparent to-white/40 pointer-events-none" />
              <div className="absolute inset-0 ring-1 ring-white/60 ring-inset pointer-events-none rounded-[inherit]" />

              {/* Floating Top Header Badges */}
              <div className="absolute top-5 left-5 right-5 flex items-center justify-between z-10 pointer-events-none">
                <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-950/85 backdrop-blur-md text-white text-xs font-mono tracking-wider font-semibold border border-white/20 shadow-md">
                  <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                  {currentVisual.pillIconText}
                </span>
                <span className="px-3 py-1.5 rounded-full bg-white/90 backdrop-blur-md text-slate-900 text-xs font-mono font-bold tracking-widest border border-slate-200/90 shadow-sm">
                  0{activeStep + 1} / 04
                </span>
              </div>

              {/* Bottom Cinematic Glass Caption Scrim */}
              <div className="absolute bottom-5 left-5 right-5 z-10 pointer-events-none">
                <div className="p-4 rounded-2xl bg-slate-950/80 backdrop-blur-lg border border-white/20 text-white shadow-xl space-y-1">
                  <div className="text-[11px] font-mono font-bold tracking-widest text-teal-300 uppercase">
                    {currentVisual.badge}
                  </div>
                  <p className="text-xs sm:text-sm text-slate-200 font-sans leading-relaxed">
                    {currentVisual.caption}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* --------------------------------------------------------------- */}
          {/* STAGE 0: PATIENT VOICE (Visual Left, Content Right)             */}
          {/* --------------------------------------------------------------- */}
          <div
            ref={content0Ref}
            className={`w-full lg:w-[48%] space-y-4 ${
              activeStep === 0 ? "block" : "hidden"
            } lg:block lg:absolute lg:top-0 lg:right-0`}
            style={
              reducedMotion
                ? {
                    opacity: activeStep === 0 ? 1 : 0,
                    visibility: activeStep === 0 ? "visible" : "hidden",
                    pointerEvents: activeStep === 0 ? "auto" : "none",
                  }
                : undefined
            }
          >
            {/* Mobile Inline Visual (Between Header & Cards) */}
            <div className="block lg:hidden w-full h-56 sm:h-64 rounded-3xl overflow-hidden relative shadow-lg mb-4 border border-slate-200">
              <img
                src={MORPH_CONFIGS[0].src}
                alt={MORPH_CONFIGS[0].caption}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-slate-950/85 text-white font-mono text-[10px] font-bold">
                {MORPH_CONFIGS[0].pillIconText}
              </div>
            </div>

            {/* Desktop: Content sits flush right, leaving left 46% for persistent visual */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-teal-700 bg-teal-50 px-2.5 py-1 rounded-md border border-teal-200">
                  {STEPS[0].badge}
                </span>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
                  {STEPS[0].title}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed font-normal">
                  {STEPS[0].subtitle}
                </p>
              </div>

              <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 text-xs font-mono text-slate-500">
                  <span className="flex items-center gap-2 text-teal-700 font-bold">
                    <Radio className="w-3.5 h-3.5 text-teal-600 animate-pulse" />
                    LIVE ACOUSTIC AUDIO STREAM
                  </span>
                  <span>Duration: 00:14 · 16kHz Lossless</span>
                </div>

                <blockquote className="text-base sm:text-lg font-serif italic text-slate-900 leading-relaxed border-l-3 border-teal-500 pl-4 py-1">
                  &ldquo;Started having a{" "}
                  <strong className="text-slate-950 font-sans not-italic font-bold bg-amber-50 px-1 rounded">
                    heavy tightness
                  </strong>{" "}
                  right in the{" "}
                  <strong className="text-slate-950 font-sans not-italic font-bold bg-amber-50 px-1 rounded">
                    center of my chest
                  </strong>{" "}
                  and got{" "}
                  <strong className="text-slate-950 font-sans not-italic font-bold bg-amber-50 px-1 rounded">
                    short of breath
                  </strong>{" "}
                  while shoveling snow, feels like an elephant sitting on me and my{" "}
                  <strong className="text-slate-950 font-sans not-italic font-bold bg-amber-50 px-1 rounded">
                    jaw hurts
                  </strong>
                  ... No fever, no vomiting.&rdquo;
                </blockquote>

                {/* Acoustic DSP Spectrum Membrane Bars */}
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs font-mono text-slate-600">
                  <span className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-teal-600" />
                    <span>Acoustic Envelope: Exertional Dyspnea</span>
                  </span>
                  <span className="text-teal-800 font-bold bg-teal-100/60 px-2 py-0.5 rounded text-[10px]">
                    DSP ACTIVE
                  </span>
                </div>

                {/* Ephemeral Privacy Note */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-teal-600" />
                    Ephemeral 16kHz capture buffer
                  </span>
                  <span className="text-slate-400">Zero persistent retention</span>
                </div>
              </div>
            </div>
          </div>

          {/* --------------------------------------------------------------- */}
          {/* STAGE 1: CLINICAL EXTRACTION (Content Left, Visual Right)       */}
          {/* --------------------------------------------------------------- */}
          <div
            ref={content1Ref}
            className={`w-full lg:w-[48%] space-y-4 ${
              activeStep === 1 ? "block" : "hidden"
            } lg:block lg:absolute lg:top-0 lg:left-0`}
            style={
              reducedMotion
                ? {
                    opacity: activeStep === 1 ? 1 : 0,
                    visibility: activeStep === 1 ? "visible" : "hidden",
                    pointerEvents: activeStep === 1 ? "auto" : "none",
                  }
                : undefined
            }
          >
            {/* Mobile Inline Visual (Between Header & Cards) */}
            <div className="block lg:hidden w-full h-56 sm:h-64 rounded-3xl overflow-hidden relative shadow-lg mb-4 border border-slate-200">
              <img
                src={MORPH_CONFIGS[1].src}
                alt={MORPH_CONFIGS[1].caption}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-slate-950/85 text-white font-mono text-[10px] font-bold">
                {MORPH_CONFIGS[1].pillIconText}
              </div>
            </div>

            {/* Desktop: Content sits flush left, leaving right 46% for persistent visual */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-teal-700 bg-teal-50 px-2.5 py-1 rounded-md border border-teal-200">
                  {STEPS[1].badge}
                </span>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
                  {STEPS[1].title}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed font-normal">
                  {STEPS[1].subtitle}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Fact 1: Chest Pain */}
                <div className="p-4 rounded-xl bg-white border border-teal-200/90 shadow-2xs space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-slate-900">R07.9 · Chest Pain</span>
                    <span className="text-teal-700 font-bold bg-teal-50 px-2 py-0.5 rounded text-[11px]">
                      AFFIRMED
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono">
                    Entity: &quot;heavy tightness / elephant sitting on me&quot;
                  </p>
                </div>

                {/* Fact 2: Shortness of Breath */}
                <div className="p-4 rounded-xl bg-white border border-teal-200/90 shadow-2xs space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-slate-900">R06.02 · Dyspnea</span>
                    <span className="text-teal-700 font-bold bg-teal-50 px-2 py-0.5 rounded text-[11px]">
                      AFFIRMED
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono">
                    Entity: &quot;short of breath&quot; (exertional)
                  </p>
                </div>

                {/* Fact 3: Fever (Negated) */}
                <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-slate-700">R50.9 · Fever</span>
                    <span className="text-slate-600 font-bold bg-slate-200/80 px-2 py-0.5 rounded text-[11px]">
                      NEGATED · ABSENT
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono">
                    Trigger: &quot;no fever&quot; · NegEx Scope Bound
                  </p>
                </div>

                {/* Fact 4: Vomiting (Negated) */}
                <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 space-y-1">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="font-bold text-slate-700">R11.10 · Vomiting</span>
                    <span className="text-slate-600 font-bold bg-slate-200/80 px-2 py-0.5 rounded text-[11px]">
                      NEGATED · ABSENT
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-mono">
                    Trigger: &quot;no vomiting&quot; · NegEx Scope Bound
                  </p>
                </div>
              </div>

              {/* Fact Invariant Commit Strip */}
              <div className="p-3 rounded-xl bg-white border border-slate-200 text-xs font-mono text-slate-600 flex items-center justify-between shadow-2xs">
                <span className="flex items-center gap-2 text-indigo-700 font-bold">
                  <FileCheck className="w-4 h-4 text-indigo-600" />
                  Negation Invariant Verified
                </span>
                <span className="text-slate-400">Ontology Confidence 99.4%</span>
              </div>
            </div>
          </div>

          {/* --------------------------------------------------------------- */}
          {/* STAGE 2: SAFETY EVALUATION (Visual Left, Content Right)         */}
          {/* --------------------------------------------------------------- */}
          <div
            ref={content2Ref}
            className={`w-full lg:w-[48%] space-y-4 ${
              activeStep === 2 ? "block" : "hidden"
            } lg:block lg:absolute lg:top-0 lg:right-0`}
            style={
              reducedMotion
                ? {
                    opacity: activeStep === 2 ? 1 : 0,
                    visibility: activeStep === 2 ? "visible" : "hidden",
                    pointerEvents: activeStep === 2 ? "auto" : "none",
                  }
                : undefined
            }
          >
            {/* Mobile Inline Visual (Between Header & Cards) */}
            <div className="block lg:hidden w-full h-56 sm:h-64 rounded-3xl overflow-hidden relative shadow-lg mb-4 border border-slate-200">
              <img
                src={MORPH_CONFIGS[2].src}
                alt={MORPH_CONFIGS[2].caption}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-slate-950/85 text-white font-mono text-[10px] font-bold">
                {MORPH_CONFIGS[2].pillIconText}
              </div>
            </div>

            {/* Desktop: Content sits flush right, leaving left 46% for persistent visual */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                  {STEPS[2].badge}
                </span>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
                  {STEPS[2].title}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed font-normal">
                  {STEPS[2].subtitle}
                </p>
              </div>

              <div className="p-5 sm:p-6 rounded-2xl bg-white border-2 border-red-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-red-100 pb-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600 animate-pulse" />
                    <span className="font-mono text-xs font-bold text-red-700 uppercase tracking-wider">
                      EMERGENCY CRITICAL GATE TRIGGERED
                    </span>
                  </div>
                  <span className="font-mono text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-800 font-bold">
                    ESI LEVEL 2 (EMERGENT)
                  </span>
                </div>

                <div className="space-y-2 text-xs font-mono text-slate-700">
                  <div className="flex items-start gap-2">
                    <span className="text-red-600 font-bold">RULE-ACS-04:</span>
                    <span>
                      Substernal chest pressure + jaw pain + exertional dyspnea (Scenario 58M).
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-teal-700 font-bold">SAFETY BOUNDARY:</span>
                    <span>
                      Deterministic safety arbiter lock active. Emergency preemption overrides conversational dialogue.
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between text-xs font-mono text-red-900">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-red-600" />
                    Deterministic Protocol Engaged
                  </span>
                  <span className="font-bold underline cursor-pointer">Illustrative Spec #904-ACS</span>
                </div>
              </div>
            </div>
          </div>

          {/* --------------------------------------------------------------- */}
          {/* STAGE 3: CARE ACTION (Content Left, Visual Right)               */}
          {/* --------------------------------------------------------------- */}
          <div
            ref={content3Ref}
            className={`w-full lg:w-[48%] space-y-4 ${
              activeStep === 3 ? "block" : "hidden"
            } lg:block lg:absolute lg:top-0 lg:left-0`}
            style={
              reducedMotion
                ? {
                    opacity: activeStep === 3 ? 1 : 0,
                    visibility: activeStep === 3 ? "visible" : "hidden",
                    pointerEvents: activeStep === 3 ? "auto" : "none",
                  }
                : undefined
            }
          >
            {/* Mobile Inline Visual (Between Header & Cards) */}
            <div className="block lg:hidden w-full h-56 sm:h-64 rounded-3xl overflow-hidden relative shadow-lg mb-4 border border-slate-200">
              <img
                src={MORPH_CONFIGS[3].src}
                alt={MORPH_CONFIGS[3].caption}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-slate-950/85 text-white font-mono text-[10px] font-bold">
                {MORPH_CONFIGS[3].pillIconText}
              </div>
            </div>

            {/* Desktop: Content sits flush left, leaving right 46% for persistent visual */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-teal-700 bg-teal-50 px-2.5 py-1 rounded-md border border-teal-200">
                  {STEPS[3].badge}
                </span>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
                  {STEPS[3].title}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed font-normal">
                  {STEPS[3].subtitle}
                </p>
              </div>

              <div className="space-y-3">
                {/* Clinician Guidance Card */}
                <div className="p-4 rounded-xl bg-white border border-teal-200 space-y-1.5 shadow-2xs">
                  <div className="flex items-center justify-between text-xs font-mono text-slate-500">
                    <span className="text-teal-700 font-bold flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-teal-600 animate-pulse" />
                      CALM SPOKEN CLINICIAN DIRECTIVE (KOKORO TTS)
                    </span>
                    <span>Voice Latency: ~420ms (Local Synthesis)</span>
                  </div>
                  <p className="text-xs sm:text-sm font-sans text-slate-800 leading-relaxed">
                    &ldquo;Emergency medical services have been flagged. Please sit or lie down comfortably and do
                    not exert yourself. Have you had any cold sweating or previous heart stents?&rdquo;
                  </p>
                </div>

                {/* Facility OSRM Routing Card */}
                <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1 shadow-2xs">
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="font-bold text-slate-950 flex items-center gap-1.5">
                      <Navigation className="w-3.5 h-3.5 text-teal-600" />
                      Manipal Emergency & Heart Hub
                    </span>
                    <span className="text-teal-800 font-bold bg-teal-50 border border-teal-200 px-2 py-0.5 rounded text-[11px]">
                      8.4 km · ~16 min ETA (OSRM)
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 font-sans leading-relaxed">
                    Canonical road geometry via OSRM. Facility indexed for 24/7 Primary PCI Cath Lab in demo network.
                  </p>
                </div>

                {/* FHIR Encounter Resource Chip */}
                <div className="p-3 rounded-xl bg-slate-950 text-teal-300 font-mono text-xs border border-slate-800 flex items-center justify-between shadow-2xs">
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-slate-400">HL7 FHIR R4 RESOURCE SCHEMA (REPRESENTATIVE BUNDLE)</div>
                    <div className="text-slate-200 font-bold text-xs truncate">
                      Encounter/E-9042 · ICD-10-CM: R07.9 (Emergent ACS)
                    </div>
                  </div>
                  <div className="px-2 py-0.5 rounded bg-teal-950 border border-teal-800 text-[10px] font-bold text-teal-400 flex items-center gap-1">
                    <FileCheck className="w-3 h-3" />
                    <span>EHR READY</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* =================================================================== */}
        {/* BOTTOM TECHNICAL BAR & STEPPER CONTROLS                             */}
        {/* =================================================================== */}
        <div className="pt-3 border-t border-slate-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono text-slate-500">
          <div className="flex items-center gap-2">
            <span>{currentMeta.badge} · Deterministic ESI-v4 Engine</span>
          </div>

          <div className="flex items-center gap-4 self-end sm:self-auto">
            {/* Step Navigation Arrows */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={handlePrev}
                disabled={activeStep === 0}
                className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                  activeStep === 0
                    ? "opacity-30 cursor-not-allowed border-slate-200 text-slate-400"
                    : "border-slate-300 hover:bg-slate-100 text-slate-700 active:scale-95"
                }`}
                title="Previous Movement"
                aria-label="Previous Movement"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-mono px-1">
                {activeStep + 1} / {STEPS.length}
              </span>
              <button
                onClick={handleNext}
                disabled={activeStep === STEPS.length - 1}
                className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                  activeStep === STEPS.length - 1
                    ? "opacity-30 cursor-not-allowed border-slate-200 text-slate-400"
                    : "border-slate-300 hover:bg-slate-100 text-slate-700 active:scale-95"
                }`}
                title="Next Movement"
                aria-label="Next Movement"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <span className="text-slate-400 hidden md:inline">|</span>
            <span className="hidden md:inline">Investigational decision support · Direct dial 108 / 112</span>
          </div>
        </div>
      </div>
    </div>
  );
}
