"use client";

import React from "react";
import { motion, useReducedMotion } from "motion/react";

interface ClipRevealProps {
  children: string;
  className?: string;
  lineClassName?: string;
  delay?: number;
  stagger?: number;
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "span" | "div";
}

/**
 * BaselineClipLines: Line-by-line clip-mask reveal
 * Each line is wrapped in an overflow-hidden mask; inner text glides up from translateY(115%) to 0.
 * Honors prefers-reduced-motion by bypassing the translate transform.
 */
export function BaselineClipLines({
  children,
  className = "",
  lineClassName = "",
  delay = 0.1,
  stagger = 0.12,
  as: Component = "div",
}: ClipRevealProps) {
  const prefersReduced = useReducedMotion();
  const lines = children.split("\n").filter((l) => l.trim().length > 0);

  if (prefersReduced) {
    return (
      <Component className={className}>
        {lines.map((line, idx) => (
          <span key={idx} className={`block ${lineClassName}`}>
            {line}
          </span>
        ))}
      </Component>
    );
  }

  return (
    <Component className={className}>
      {lines.map((line, idx) => (
        <span key={idx} className="block overflow-hidden pb-1">
          <motion.span
            className={`block ${lineClassName}`}
            initial={{ y: "115%", opacity: 0.2 }}
            animate={{ y: "0%", opacity: 1 }}
            transition={{
              duration: 0.85,
              delay: delay + idx * stagger,
              ease: [0.16, 1, 0.3, 1], // Baseline easeOutExpo
            }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Component>
  );
}

/**
 * BaselineClipWords: Word-by-word clip-mask reveal
 */
export function BaselineClipWords({
  children,
  className = "",
  wordClassName = "",
  delay = 0.1,
  stagger = 0.04,
}: {
  children: string;
  className?: string;
  wordClassName?: string;
  delay?: number;
  stagger?: number;
}) {
  const prefersReduced = useReducedMotion();
  const words = children.split(" ");

  if (prefersReduced) {
    return <span className={className}>{children}</span>;
  }

  return (
    <span className={`inline-flex flex-wrap gap-x-1.5 ${className}`}>
      {words.map((word, idx) => (
        <span key={idx} className="inline-block overflow-hidden py-0.5">
          <motion.span
            className={`inline-block ${wordClassName}`}
            initial={{ y: "115%", opacity: 0 }}
            animate={{ y: "0%", opacity: 1 }}
            transition={{
              duration: 0.7,
              delay: delay + idx * stagger,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {word}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/**
 * BaselineSpringButton: Spring-based tactile interaction wrapper
 */
export function BaselineSpringButton({
  children,
  className = "",
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return (
      <div className={className} onClick={onClick}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={className}
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      {children}
    </motion.div>
  );
}
