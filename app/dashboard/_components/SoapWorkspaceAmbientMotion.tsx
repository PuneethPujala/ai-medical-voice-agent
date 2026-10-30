"use client";

import React, { useEffect, useRef } from "react";
import gsap from "gsap";

export function SoapWorkspaceAmbientMotion() {
  const containerRef = useRef<HTMLDivElement>(null);
  const particleGroupRef = useRef<SVGGElement>(null);
  const waveformRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    // Respect prefers-reduced-motion
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const ctx = gsap.context(() => {
      // 1. Subtle, slow floating drift for ambient mint particles
      if (particleGroupRef.current) {
        const particles = particleGroupRef.current.querySelectorAll(".ambient-particle");
        particles.forEach((p, i) => {
          gsap.to(p, {
            x: `+=${(i % 2 === 0 ? 1 : -1) * (18 + i * 4)}`,
            y: `+=${(i % 3 === 0 ? -1 : 1) * (24 + i * 5)}`,
            opacity: 0.15 + (i % 3) * 0.25,
            duration: 6 + i * 2,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
            delay: i * 0.8,
          });
        });
      }

      // 2. Subtle pulse on the acoustic waveform in the top-right whitespace
      if (waveformRef.current) {
        gsap.to(waveformRef.current, {
          opacity: 0.55,
          scale: 1.02,
          y: -8,
          duration: 9,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      }
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none overflow-hidden -z-10 select-none"
      aria-hidden="true"
    >
      {/* Subtle organic acoustic wave image asset drifting delicately in whitespace */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={waveformRef}
        src="/images/soap/ambient-acoustic-waveform.png"
        alt=""
        className="absolute -top-12 -right-16 w-[700px] max-w-none opacity-40 mix-blend-multiply pointer-events-none transform-gpu"
      />

      {/* Ambient delicate SVG particles drifting along soft paths */}
      <svg
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="mintGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#B7FF72" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#B7FF72" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g ref={particleGroupRef}>
          {/* Faint mint glowing nodes and particle motes positioned in peripheral negative space */}
          <circle className="ambient-particle" cx="12%" cy="18%" r="3.5" fill="url(#mintGlow)" opacity="0.3" />
          <circle className="ambient-particle" cx="15%" cy="24%" r="2" fill="#B7FF72" opacity="0.25" />
          <circle className="ambient-particle" cx="88%" cy="14%" r="4" fill="url(#mintGlow)" opacity="0.4" />
          <circle className="ambient-particle" cx="92%" cy="28%" r="2.5" fill="#B7FF72" opacity="0.3" />
          <circle className="ambient-particle" cx="8%" cy="55%" r="3" fill="#B7FF72" opacity="0.2" />
          <circle className="ambient-particle" cx="94%" cy="65%" r="3.5" fill="url(#mintGlow)" opacity="0.25" />
          <circle className="ambient-particle" cx="86%" cy="85%" r="2" fill="#B7FF72" opacity="0.35" />
          <circle className="ambient-particle" cx="18%" cy="88%" r="3" fill="url(#mintGlow)" opacity="0.2" />
        </g>
      </svg>
    </div>
  );
}
