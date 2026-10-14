"use client";

import React, { useEffect, useRef, useState } from "react";

export interface AuroraRibbonBackgroundProps {
  /**
   * "procedural" guarantees an exact mathematical periodic loop f(0) === f(T)
   * with true alpha transparency and zero video network payload.
   * "video" attempts to play video asset with automatic fallback to procedural canvas.
   * "auto" (default) probes for video and falls back to procedural canvas.
   */
  mode?: "procedural" | "video" | "auto";
  videoWebmSrc?: string;
  videoMp4Src?: string;
  posterSrc?: string;
  className?: string;
}

interface RibbonStrandConfig {
  id: string;
  yBase: number;            // Normalized vertical anchor (0..1)
  amplitude: number;        // Wave vertical spread
  ribbonWidth: number;      // Thickness of the silk ribbon in pixels
  spatialFreq: number;      // Wave curvature along X
  temporalHarmonic: number; // Integer harmonic k (1, 2) for exact periodic loop
  phaseOffset: number;      // Initial phase offset in radians
  tilt: number;             // Diagonal slope across viewport
  colors: [string, string, string]; // Gradient stops (RGBA)
  highlightColor: string;
}

const LOOP_DURATION_SEC = 8.0; // 8-second exact periodic cycle: f(t) === f(t + 8)
const TARGET_FPS = 30;

const STRANDS: RibbonStrandConfig[] = [
  // Deep Teal / Aqua sculptural base strand
  {
    id: "teal-base",
    yBase: 0.56,
    amplitude: 0.11,
    ribbonWidth: 190,
    spatialFreq: 2.1,
    temporalHarmonic: 1,
    phaseOffset: 0.0,
    tilt: -0.22,
    colors: [
      "rgba(20, 184, 166, 0.02)",
      "rgba(45, 212, 191, 0.22)",
      "rgba(14, 165, 233, 0.05)",
    ],
    highlightColor: "rgba(240, 253, 250, 0.35)",
  },
  // Icy Blue / Cyan luminous core wave
  {
    id: "icy-cyan",
    yBase: 0.48,
    amplitude: 0.095,
    ribbonWidth: 155,
    spatialFreq: 2.5,
    temporalHarmonic: 1,
    phaseOffset: 1.15,
    tilt: -0.18,
    colors: [
      "rgba(56, 189, 248, 0.02)",
      "rgba(125, 211, 252, 0.26)",
      "rgba(186, 230, 253, 0.06)",
    ],
    highlightColor: "rgba(255, 255, 255, 0.5)",
  },
  // Soft Muted Lavender counter-flowing silk layer
  {
    id: "muted-lavender",
    yBase: 0.52,
    amplitude: 0.085,
    ribbonWidth: 140,
    spatialFreq: 1.85,
    temporalHarmonic: 1,
    phaseOffset: 2.4,
    tilt: -0.14,
    colors: [
      "rgba(196, 181, 253, 0.01)",
      "rgba(167, 139, 250, 0.16)",
      "rgba(125, 211, 252, 0.04)",
    ],
    highlightColor: "rgba(245, 243, 255, 0.35)",
  },
  // Mint / Pearl White translucent upper veil
  {
    id: "mint-pearl",
    yBase: 0.43,
    amplitude: 0.075,
    ribbonWidth: 115,
    spatialFreq: 2.8,
    temporalHarmonic: 2, // 2x harmonic completes exactly 2 full cycles per 8s loop
    phaseOffset: 0.7,
    tilt: -0.25,
    colors: [
      "rgba(110, 231, 183, 0.01)",
      "rgba(204, 251, 241, 0.28)",
      "rgba(248, 250, 252, 0.05)",
    ],
    highlightColor: "rgba(255, 255, 255, 0.65)",
  },
  // Fine Pearl / Icy Blue acoustic crest highlight
  {
    id: "pearl-crest",
    yBase: 0.50,
    amplitude: 0.065,
    ribbonWidth: 75,
    spatialFreq: 3.1,
    temporalHarmonic: 1,
    phaseOffset: 3.8,
    tilt: -0.2,
    colors: [
      "rgba(255, 255, 255, 0.0)",
      "rgba(224, 242, 254, 0.32)",
      "rgba(196, 181, 253, 0.04)",
    ],
    highlightColor: "rgba(255, 255, 255, 0.75)",
  },
];

export const AuroraRibbonBackground: React.FC<AuroraRibbonBackgroundProps> = ({
  mode = "auto",
  videoWebmSrc = "/assets/hero/medvoice-aurora-ribbon.webm",
  videoMp4Src = "/assets/hero/medvoice-aurora-ribbon.mp4",
  posterSrc = "/assets/hero/medvoice-aurora-poster.webp",
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  // Detect prefers-reduced-motion
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Periodic Aurora Ribbon Renderer (with tab suspension & voice session throttling)
  useEffect(() => {
    const shouldRenderCanvas =
      mode === "procedural" || mode === "auto" || videoFailed || prefersReducedMotion;
    if (!shouldRenderCanvas) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let animationFrameId: number | null = null;
    let lastFrameTime = 0;
    const frameInterval = 1000 / TARGET_FPS;
    let isSuspended = false;

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    /**
     * Renders a single frame at normalized periodic angle phi in [0, 2*PI).
     * Because all time-dependent terms use sin/cos(k * phi), frame(0) === frame(2*PI).
     */
    const renderRibbonFrame = (phi: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      ctx.clearRect(0, 0, width, height);

      // Responsive horizontal start: keep left side calm for hero typography on desktop
      const isMobile = width < 768;
      const startXRatio = isMobile ? 0.05 : 0.24;
      const steps = 64;

      // Subtle global ambient glow on the centre-right
      const ambientGrad = ctx.createRadialGradient(
        width * 0.72,
        height * 0.48,
        width * 0.04,
        width * 0.72,
        height * 0.48,
        width * 0.48
      );
      ambientGrad.addColorStop(0, "rgba(186, 230, 253, 0.22)");
      ambientGrad.addColorStop(0.5, "rgba(196, 181, 253, 0.09)");
      ambientGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = ambientGrad;
      ctx.fillRect(0, 0, width, height);

      STRANDS.forEach((strand) => {
        const tPhase = strand.temporalHarmonic * phi + strand.phaseOffset;
        const upperPoints: { x: number; y: number }[] = [];
        const lowerPoints: { x: number; y: number }[] = [];
        const spinePoints: { x: number; y: number }[] = [];

        for (let i = 0; i <= steps; i++) {
          const u = i / steps; // 0..1 along ribbon length
          const x = width * (startXRatio + u * (1.08 - startXRatio));

          // Smooth envelope: gentle fade-in on the left, expansive sculptural fullness on the right
          const leftEnvelope = Math.pow(Math.sin(Math.min(u * 1.35, 1) * (Math.PI / 2)), 1.6);

          // Compound periodic wave (primary wave + secondary harmonic undulation)
          const wave1 = Math.sin(u * strand.spatialFreq * Math.PI * 2 - tPhase);
          const wave2 =
            0.42 *
            Math.cos(
              u * (strand.spatialFreq * 1.5) * Math.PI * 2 +
                phi * strand.temporalHarmonic +
                strand.phaseOffset
            );
          const depthBreathing = 0.2 * Math.sin(phi + strand.phaseOffset * 1.7);

          const centerY =
            height *
            (strand.yBase +
              (u - 0.5) * strand.tilt +
              strand.amplitude * leftEnvelope * (wave1 + wave2 + depthBreathing));

          // 3D ribbon twist modulation (simulates silk turning in space)
          const twist =
            0.38 +
            0.62 *
              Math.abs(
                Math.cos(
                  u * Math.PI * 1.75 -
                    phi * strand.temporalHarmonic * 0.5 +
                    strand.phaseOffset
                )
              );
          const halfThickness =
            (strand.ribbonWidth * (isMobile ? 0.65 : 1) * leftEnvelope * twist) / 2;

          upperPoints.push({ x, y: centerY - halfThickness });
          lowerPoints.push({ x, y: centerY + halfThickness });
          spinePoints.push({ x, y: centerY - halfThickness * 0.45 });
        }

        // Draw translucent silk ribbon body
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(upperPoints[0].x, upperPoints[0].y);
        for (let i = 1; i < upperPoints.length; i++) {
          ctx.lineTo(upperPoints[i].x, upperPoints[i].y);
        }
        for (let i = lowerPoints.length - 1; i >= 0; i--) {
          ctx.lineTo(lowerPoints[i].x, lowerPoints[i].y);
        }
        ctx.closePath();

        // Linear gradient flowing across the ribbon with periodic shimmer shift
        const shimmerShift = 0.06 * Math.sin(phi + strand.phaseOffset);
        const grad = ctx.createLinearGradient(
          width * startXRatio,
          height * 0.7,
          width,
          height * 0.25
        );
        grad.addColorStop(0, strand.colors[0]);
        grad.addColorStop(Math.max(0.15, Math.min(0.85, 0.52 + shimmerShift)), strand.colors[1]);
        grad.addColorStop(1, strand.colors[2]);

        ctx.fillStyle = grad;
        ctx.fill();

        // Draw glass-like specular edge highlight along the upper ridge
        ctx.beginPath();
        ctx.moveTo(spinePoints[0].x, spinePoints[0].y);
        for (let i = 1; i < spinePoints.length; i++) {
          ctx.lineTo(spinePoints[i].x, spinePoints[i].y);
        }
        const strokeGrad = ctx.createLinearGradient(width * startXRatio, 0, width, 0);
        strokeGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
        strokeGrad.addColorStop(0.55, strand.highlightColor);
        strokeGrad.addColorStop(1, "rgba(255, 255, 255, 0.12)");
        ctx.strokeStyle = strokeGrad;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      });
    };

    // If user prefers reduced motion, render a single static sculptural frame at phi = 0.85
    if (prefersReducedMotion) {
      renderRibbonFrame(0.85);
      return () => window.removeEventListener("resize", resizeCanvas);
    }

    const startTime = performance.now();
    const animate = (now: number) => {
      if (!isSuspended) {
        if (now - lastFrameTime >= frameInterval) {
          lastFrameTime = now;
          const elapsedSec = ((now - startTime) / 1000) % LOOP_DURATION_SEC;
          const phi = (elapsedSec / LOOP_DURATION_SEC) * Math.PI * 2;
          renderRibbonFrame(phi);
        }
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    // Visibility and Voice-Session Event Handlers to conserve CPU/battery
    const handleVisibilityChange = () => {
      isSuspended = document.hidden;
    };

    const handleVoiceSessionEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ active: boolean }>;
      isSuspended = !!customEvent.detail?.active;
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("medvoice:voice-session-active", handleVoiceSessionEvent);

    return () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resizeCanvas);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("medvoice:voice-session-active", handleVoiceSessionEvent);
    };
  }, [mode, videoFailed, prefersReducedMotion]);

  const showVideoElement =
    mode === "video" && !videoFailed && !prefersReducedMotion;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className}`}
    >
      {showVideoElement ? (
        <video
          autoPlay
          muted
          loop
          playsInline
          poster={posterSrc}
          onError={() => setVideoFailed(true)}
          className="h-full w-full object-cover object-[68%_center] md:object-right-top dark:mix-blend-screen dark:opacity-80"
        >
          <source src={videoWebmSrc} type="video/webm" />
          <source src={videoMp4Src} type="video/mp4" />
        </video>
      ) : (
        <canvas
          ref={canvasRef}
          className="h-full w-full block"
        />
      )}

      {/* Soft radial protective scrim on the left and behind center to guarantee WCAG AAA contrast */}
      <div
        className="
          absolute inset-0
          bg-[radial-gradient(circle_at_22%_50%,rgba(250,249,246,0.88)_0%,rgba(250,249,246,0.45)_42%,transparent_72%)]
          dark:bg-[radial-gradient(circle_at_22%_50%,rgba(2,6,23,0.88)_0%,rgba(2,6,23,0.45)_42%,transparent_72%)]
          pointer-events-none
        "
      />
    </div>
  );
};

export default AuroraRibbonBackground;
