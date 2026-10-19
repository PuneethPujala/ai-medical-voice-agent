"use client";

import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Mic, ShieldCheck, Navigation, FileText } from "lucide-react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
  (window as any).ScrollTrigger = ScrollTrigger;
  (window as any).gsap = gsap;
}

export interface FaqToFooterTransitionOverlayProps {
  className?: string;
}

export function FaqToFooterTransitionOverlay({
  className = "",
}: FaqToFooterTransitionOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const motif1Ref = useRef<HTMLDivElement>(null);
  const motif2Ref = useRef<HTMLDivElement>(null);
  const motif3Ref = useRef<HTMLDivElement>(null);
  const motif4Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const m1 = motif1Ref.current;
    const m2 = motif2Ref.current;
    const m3 = motif3Ref.current;
    const m4 = motif4Ref.current;

    const triggerEl = document.getElementById("cta-transition-band");
    const stageEl = document.getElementById("monumental-wordmark-stage");
    const sensorEl = document.getElementById("sensor-object");
    const tabletEl = document.getElementById("tablet-object");
    const shaderEl = document.getElementById("acid-mint-wordmark-shader");
    const ribbonImg = document.getElementById("cinematic-ribbon-bg");

    if (!triggerEl || !stageEl || !m1 || !m2 || !m3 || !m4) return;

    if (prefersReducedMotion) {
      gsap.set([m1, m2, m3, m4], { opacity: 0, display: "none" });
      if (sensorEl) gsap.set(sensorEl, { opacity: 0, pointerEvents: "none" });
      if (tabletEl) gsap.set(tabletEl, { opacity: 0, pointerEvents: "none" });
      return;
    }

    const mm = gsap.matchMedia(overlay);

    const setupTimeline = (isMobile: boolean) => {
      // Initial positions for the 4 luminous emblems
      // Spread across the outer arcs of the vortex ribbons to keep center text legible
      gsap.set(m1, {
        x: isMobile ? -90 : -400,
        y: isMobile ? -120 : -220,
        scale: isMobile ? 0.45 : 0.6,
        rotation: -25,
        opacity: 0,
        transformOrigin: "center center",
      });
      gsap.set(m2, {
        x: isMobile ? -35 : -220,
        y: isMobile ? -90 : -180,
        scale: isMobile ? 0.45 : 0.6,
        rotation: 15,
        opacity: 0,
        transformOrigin: "center center",
      });
      gsap.set(m3, {
        x: isMobile ? 35 : 220,
        y: isMobile ? -90 : -180,
        scale: isMobile ? 0.45 : 0.6,
        rotation: -15,
        opacity: 0,
        transformOrigin: "center center",
      });
      gsap.set(m4, {
        x: isMobile ? 90 : 400,
        y: isMobile ? -120 : -220,
        scale: isMobile ? 0.45 : 0.6,
        rotation: 25,
        opacity: 0,
        transformOrigin: "center center",
      });

      // Master ScrollTrigger Timeline
      // Spans from entry of transition band to the bottom of the wordmark stage
      const masterTl = gsap.timeline({
        scrollTrigger: {
          trigger: triggerEl,
          start: "top 75%",
          endTrigger: stageEl,
          end: "bottom bottom",
          scrub: 1.2,
          invalidateOnRefresh: true,
        },
      });

      // 1. Subtle parallax & scale of the edge-to-edge cinematic ribbon image
      if (ribbonImg) {
        masterTl.fromTo(
          ribbonImg,
          { scale: 1.12, yPercent: isMobile ? -5 : -8 },
          { scale: 1.0, yPercent: isMobile ? 3 : 4, ease: "none", duration: 1.0 },
          0
        );
      }

      // 2. Animate out the 3D objects (sensor and tablet) completely to opacity 0
      if (sensorEl) {
        masterTl.to(
          sensorEl,
          {
            scale: 0.25,
            rotation: -28,
            opacity: 0,
            x: isMobile ? -20 : -70,
            y: 45,
            ease: "power2.inOut",
            duration: 0.65,
          },
          0.1
        );
      }

      if (tabletEl) {
        masterTl.to(
          tabletEl,
          {
            scale: 0.25,
            rotation: 30,
            opacity: 0,
            x: isMobile ? 20 : 70,
            y: 45,
            ease: "power2.inOut",
            duration: 0.65,
          },
          0.12
        );
      }

      // 3. Travel the 4 Luminous Motifs along the sweeping vortex curves:
      // They sweep in along the outer ribbons, zoom forward (scale up to 1.5), rotate,
      // and cleanly dissolve as they reach the wordmark finale — leaving ZERO stranded pills!

      // Motif 1: Patient Voice (Microphone) - sweeping along upper-left vortex loop
      masterTl.to(
        m1,
        {
          keyframes: [
            { x: isMobile ? -85 : -360, y: isMobile ? -25 : -50, opacity: 0.95, scale: isMobile ? 0.7 : 1.15, rotation: -12, ease: "power1.out" },
            { x: isMobile ? -55 : -240, y: isMobile ? 50 : 100, opacity: 1, scale: isMobile ? 0.85 : 1.45, rotation: 10, ease: "power2.out" },
            { x: isMobile ? -15 : -70, y: isMobile ? 150 : 320, opacity: 0, scale: isMobile ? 1.2 : 2.2, rotation: 20, ease: "power2.in" },
          ],
          duration: 0.85,
        },
        0.05
      );

      // Motif 2: Deterministic Safety (ShieldCheck) - sweeping along inner-left vortex loop
      masterTl.to(
        m2,
        {
          keyframes: [
            { x: isMobile ? -35 : -180, y: isMobile ? -15 : -30, opacity: 0.95, scale: isMobile ? 0.75 : 1.2, rotation: 18, ease: "power1.out" },
            { x: isMobile ? -20 : -110, y: isMobile ? 60 : 130, opacity: 1, scale: isMobile ? 0.9 : 1.5, rotation: -6, ease: "power2.out" },
            { x: isMobile ? -5 : -25, y: isMobile ? 160 : 340, opacity: 0, scale: isMobile ? 1.2 : 2.2, rotation: 8, ease: "power2.in" },
          ],
          duration: 0.88,
        },
        0.1
      );

      // Motif 3: Care Network (Navigation) - sweeping along inner-right vortex loop
      masterTl.to(
        m3,
        {
          keyframes: [
            { x: isMobile ? 35 : 180, y: isMobile ? -15 : -30, opacity: 0.95, scale: isMobile ? 0.75 : 1.2, rotation: -18, ease: "power1.out" },
            { x: isMobile ? 20 : 110, y: isMobile ? 60 : 130, opacity: 1, scale: isMobile ? 0.9 : 1.5, rotation: 6, ease: "power2.out" },
            { x: isMobile ? 5 : 25, y: isMobile ? 160 : 340, opacity: 0, scale: isMobile ? 1.2 : 2.2, rotation: -8, ease: "power2.in" },
          ],
          duration: 0.88,
        },
        0.08
      );

      // Motif 4: Clinical Record (FileText) - sweeping along upper-right vortex loop
      masterTl.to(
        m4,
        {
          keyframes: [
            { x: isMobile ? 85 : 360, y: isMobile ? -25 : -50, opacity: 0.95, scale: isMobile ? 0.7 : 1.15, rotation: 14, ease: "power1.out" },
            { x: isMobile ? 55 : 240, y: isMobile ? 50 : 100, opacity: 1, scale: isMobile ? 0.85 : 1.45, rotation: -10, ease: "power2.out" },
            { x: isMobile ? 15 : 70, y: isMobile ? 150 : 320, opacity: 0, scale: isMobile ? 1.2 : 2.2, rotation: -20, ease: "power2.in" },
          ],
          duration: 0.85,
        },
        0.12
      );

      // 4. Wordmark Shader Bloom:
      if (shaderEl) {
        masterTl.to(
          shaderEl,
          {
            opacity: 1,
            scale: isMobile ? 1.04 : 1.08,
            duration: 0.45,
            ease: "power2.out",
          },
          0.5
        );
        masterTl.to(
          shaderEl,
          {
            opacity: 0.85,
            scale: 1.0,
            duration: 0.35,
            ease: "power1.inOut",
          },
          0.8
        );
      }
    };

    mm.add("(min-width: 768px)", () => setupTimeline(false));
    mm.add("(max-width: 767px)", () => setupTimeline(true));

    return () => {
      mm.revert();
    };
  }, []);

  return (
    <div
      id="faq-footer-transition-overlay"
      ref={overlayRef}
      className={`absolute inset-0 pointer-events-none z-20 overflow-visible ${className}`}
      aria-hidden="true"
    >
      {/* Centered stage coordinate anchor for the 4 flying motifs */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-0 h-0 pointer-events-none">

        {/* Motif 1: Patient Voice (Microphone) */}
        <div
          ref={motif1Ref}
          id="converging-motif-voice"
          className="absolute -top-7 -left-7 pointer-events-none will-change-transform will-change-opacity"
        >
          <div className="w-14 h-14 rounded-full bg-[#05070F]/90 border-2 border-[#B7FF72] shadow-[0_0_30px_#B7FF72,0_0_60px_rgba(183,255,114,0.45)] backdrop-blur-md flex items-center justify-center">
            <Mic className="w-7 h-7 text-[#B7FF72]" />
          </div>
        </div>

        {/* Motif 2: Deterministic Safety (ShieldCheck) */}
        <div
          ref={motif2Ref}
          id="converging-motif-safety"
          className="absolute -top-7 -left-7 pointer-events-none will-change-transform will-change-opacity"
        >
          <div className="w-14 h-14 rounded-full bg-[#05070F]/90 border-2 border-[#B7FF72] shadow-[0_0_30px_#B7FF72,0_0_60px_rgba(183,255,114,0.45)] backdrop-blur-md flex items-center justify-center">
            <ShieldCheck className="w-7 h-7 text-[#B7FF72]" />
          </div>
        </div>

        {/* Motif 3: Care Network (Navigation) */}
        <div
          ref={motif3Ref}
          id="converging-motif-routing"
          className="absolute -top-7 -left-7 pointer-events-none will-change-transform will-change-opacity"
        >
          <div className="w-14 h-14 rounded-full bg-[#05070F]/90 border-2 border-[#B7FF72] shadow-[0_0_30px_#B7FF72,0_0_60px_rgba(183,255,114,0.45)] backdrop-blur-md flex items-center justify-center">
            <Navigation className="w-7 h-7 text-[#B7FF72]" />
          </div>
        </div>

        {/* Motif 4: Clinical Record (FileText) */}
        <div
          ref={motif4Ref}
          id="converging-motif-record"
          className="absolute -top-7 -left-7 pointer-events-none will-change-transform will-change-opacity"
        >
          <div className="w-14 h-14 rounded-full bg-[#05070F]/90 border-2 border-[#B7FF72] shadow-[0_0_30px_#B7FF72,0_0_60px_rgba(183,255,114,0.45)] backdrop-blur-md flex items-center justify-center">
            <FileText className="w-7 h-7 text-[#B7FF72]" />
          </div>
        </div>

      </div>
    </div>
  );
}
