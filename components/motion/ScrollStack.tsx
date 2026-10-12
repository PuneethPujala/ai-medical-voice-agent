"use client";

import React, { useRef } from "react";
import { motion, useScroll, useTransform, useSpring, useReducedMotion } from "motion/react";

export interface ScrollStackCard {
  step: string;
  tag: string;
  title: string;
  description: string;
  highlightBadge: string;
  badgeColor: string;
  metric?: string;
  content: React.ReactNode;
}

export interface ScrollStackProps {
  cards: ScrollStackCard[];
  className?: string;
  stackPosition?: number;
  theme?: "light" | "dark";
}

function StackCardItem({
  card,
  index,
  total,
  progress,
  stackPosition = 110,
  theme = "light",
}: {
  card: ScrollStackCard;
  index: number;
  total: number;
  progress: any;
  stackPosition?: number;
  theme?: "light" | "dark";
}) {
  const reduceMotion = useReducedMotion();

  // Progress threshold for when this card is covered by subsequent cards
  const rangeStart = index / total;

  // Progressive scale-down as subsequent cards stack on top (1 down to ~0.92)
  const targetScale = 1 - (total - index - 1) * 0.028;
  const scale = useTransform(progress, [rangeStart, 1], [1, targetScale]);

  // Subtle dimming as card settles under the deck
  const opacity = useTransform(
    progress,
    [rangeStart, (rangeStart + 1) / 2, 1],
    [1, index === total - 1 ? 1 : 0.98, index === total - 1 ? 1 : 0.90]
  );

  // Cascading deck lip elevation offset
  const yOffset = index * 20;

  const isDark = theme === "dark";

  return (
    <motion.div
      style={{
        scale: reduceMotion ? 1 : scale,
        opacity: reduceMotion ? 1 : opacity,
        top: `calc(${stackPosition}px + ${yOffset}px)`,
        zIndex: 10 + index,
      }}
      className={`sticky w-full max-w-4xl mx-auto rounded-3xl min-h-[340px] sm:min-h-[360px] p-6 sm:p-9 mb-[55vh] sm:mb-[65vh] last:mb-0 transition-colors will-change-transform ${
        isDark
          ? "bg-[#0D1526]/96 border border-slate-700/80 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.6)] backdrop-blur-2xl"
          : "bg-white/95 border border-slate-200/90 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.08)] backdrop-blur-xl"
      }`}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center h-full">
        
        {/* Left Information Side */}
        <div className="lg:col-span-6 space-y-4 text-left">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-slate-400">
              {card.step}
            </span>
            <span className="text-slate-400">/</span>
            <span
              className={`font-mono text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border ${card.badgeColor}`}
            >
              {card.tag}
            </span>
          </div>

          <h3 className={`text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight ${isDark ? "text-white" : "text-slate-950"}`}>
            {card.title}
          </h3>

          <p className={`text-sm sm:text-base leading-relaxed font-normal ${isDark ? "text-slate-300" : "text-slate-600"}`}>
            {card.description}
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <span
              className={`font-mono text-xs font-semibold px-3 py-1.5 rounded-xl inline-block border ${
                isDark
                  ? "text-cyan-400 bg-cyan-950/60 border-cyan-800"
                  : "text-cyan-800 bg-cyan-50 border-cyan-200"
              }`}
            >
              {card.highlightBadge}
            </span>
            {card.metric && (
              <span className={`font-mono text-xs font-medium ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                {card.metric}
              </span>
            )}
          </div>
        </div>

        {/* Right Visual Clinical Slate */}
        <div className="lg:col-span-6 w-full">
          <div className={`w-full rounded-2xl p-5 font-mono text-xs shadow-2xs border ${
            isDark
              ? "bg-[#070B14] border-slate-800 text-slate-200"
              : "bg-slate-50 border-slate-200/90 text-slate-800"
          }`}>
            {card.content}
          </div>
        </div>

      </div>
    </motion.div>
  );
}

export function ScrollStack({
  cards,
  className = "",
  stackPosition = 110,
  theme = "light",
}: ScrollStackProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"],
  });

  // Balanced spring easing: crisp tracking without elastic jitter
  const smoothProgress = useSpring(scrollYProgress, {
    damping: 30,
    stiffness: 140,
    mass: 0.8,
  });

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {cards.map((card, index) => (
        <StackCardItem
          key={card.step}
          card={card}
          index={index}
          total={cards.length}
          progress={smoothProgress}
          stackPosition={stackPosition}
          theme={theme}
        />
      ))}
    </div>
  );
}

export default ScrollStack;
