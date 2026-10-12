"use client";

import React, { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "motion/react";

export interface GlowCursorProps {
  color?: string;
  size?: number;
  blur?: number;
  opacity?: number;
  className?: string;
}

export function GlowCursor({
  color = "rgba(6, 182, 212, 0.12)",
  size = 360,
  blur = 60,
  opacity = 0.8,
  className = "",
}: GlowCursorProps) {
  const [visible, setVisible] = useState(false);
  const [isFinePointer, setIsFinePointer] = useState(false);
  const reduceMotion = useReducedMotion();

  const mouseX = useMotionValue(-size);
  const mouseY = useMotionValue(-size);

  const springX = useSpring(mouseX, { damping: 30, stiffness: 200, mass: 0.6 });
  const springY = useSpring(mouseY, { damping: 30, stiffness: 200, mass: 0.6 });

  useEffect(() => {
    // Only enable on desktop pointer devices
    if (typeof window !== "undefined") {
      setIsFinePointer(window.matchMedia("(pointer: fine)").matches);
    }

    const handleMouseMove = (e: MouseEvent) => {
      mouseX.set(e.clientX - size / 2);
      mouseY.set(e.clientY - size / 2);
      if (!visible) setVisible(true);
    };

    const handleMouseLeave = () => {
      setVisible(false);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [mouseX, mouseY, size, visible]);

  if (reduceMotion || !isFinePointer) {
    return null;
  }

  return (
    <motion.div
      aria-hidden="true"
      className={`fixed top-0 left-0 pointer-events-none z-0 rounded-full transition-opacity duration-500 ease-out ${className}`}
      style={{
        x: springX,
        y: springY,
        width: size,
        height: size,
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        filter: `blur(${blur}px)`,
        opacity: visible ? opacity : 0,
      }}
    />
  );
}

export default GlowCursor;
