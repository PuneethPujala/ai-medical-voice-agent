"use client";

import React, { useRef, useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

interface SculpturalRibbonCanvasProps {
  className?: string;
}

export function SculpturalRibbonCanvas({ className = "" }: SculpturalRibbonCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const driftWrapperRef = useRef<HTMLDivElement>(null);
  const parallaxWrapperRef = useRef<HTMLDivElement>(null);
  const ribbonImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const driftEl = driftWrapperRef.current;
    const parallaxEl = parallaxWrapperRef.current;
    const imgEl = ribbonImgRef.current;
    if (!container || !driftEl || !parallaxEl || !imgEl) return;

    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      gsap.set(imgEl, { opacity: 0.95 });
      return;
    }

    const ctx = gsap.context(() => {
      // 1. Slow, elegant, continuous ambient breathing on driftWrapper (strictly vertical floating, zero horizontal drift)
      const driftTl = gsap.timeline({ repeat: -1, yoyo: true });
      driftTl.to(driftEl, {
        y: -12,
        scale: 1.015,
        duration: 9,
        ease: "sine.inOut",
      }).to(driftEl, {
        y: 8,
        scale: 0.992,
        duration: 11,
        ease: "sine.inOut",
      });

      // 2. Pure vertical parallax scrubbed against hero scroll (strictly Y-axis, zero horizontal relocation)
      gsap.to(parallaxEl, {
        y: 85,
        opacity: 0.85,
        ease: "none",
        scrollTrigger: {
          trigger: container,
          start: "top top",
          end: "bottom top",
          scrub: 1.2,
        },
      });
    }, container);

    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={`absolute inset-0 overflow-hidden pointer-events-none select-none z-0 ${className}`}
    >
      {/* Luminous cyan / teal / pearl ambient light wells (Baseline & Scrolltide reference) */}
      <div
        className="absolute top-1/4 -right-20 w-[800px] h-[550px] bg-gradient-to-bl from-teal-400/18 via-cyan-400/14 to-transparent blur-[140px] pointer-events-none rounded-full"
      />
      <div className="absolute -bottom-10 left-1/4 w-[650px] h-[450px] bg-gradient-to-tr from-emerald-300/10 via-cyan-300/12 to-transparent blur-[120px] pointer-events-none rounded-full" />

      {/* Atmospheric Oversized Sculptural Acoustic Ribbon with Stable Rock-Solid Horizontal Anchor */}
      <div ref={parallaxWrapperRef} className="absolute inset-0 pointer-events-none">
        <div
          ref={driftWrapperRef}
          className="absolute top-1/2 -translate-y-1/2 right-[-24%] sm:right-[-16%] md:right-[-10%] lg:right-[-4%] xl:right-[0%] w-[950px] sm:w-[1200px] md:w-[1350px] lg:w-[1450px] xl:w-[1550px] max-w-none pointer-events-none flex items-center justify-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={ribbonImgRef}
            src="/sculptural-acoustic-ribbon.png"
            alt=""
            className="w-full h-auto object-contain opacity-85 sm:opacity-90 filter drop-shadow-[0_24px_50px_rgba(13,148,136,0.12)] transition-opacity duration-700"
            style={{
              willChange: "transform",
              transformOrigin: "center center",
            }}
          />
        </div>
      </div>

      {/* Gentle frosted gradient scrim at bottom to transition seamlessly into content */}
      <div className="absolute bottom-0 inset-x-0 h-32 bg-gradient-to-t from-[#FAF9F6] via-[#FAF9F6]/80 to-transparent pointer-events-none" />
    </div>
  );
}
