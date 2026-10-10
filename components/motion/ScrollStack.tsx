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
}

function StackCardItem({
  card,
  index,
  total,
  progress,
}: {
  card: ScrollStackCard;
  index: number;
  total: number;
  progress: any;
}) {
  const reduceMotion = useReducedMotion();

  // Progress threshold for when this card is covered by subsequent cards
  const rangeStart = index / total;
  const rangeEnd = Math.min(1, (index + 1) / total);

  // Subtle scale down as cards stack on top (1 down to ~0.94)
  const targetScale = 1 - (total - index - 1) * 0.03;
  const scale = useTransform(progress, [rangeStart, 1], [1, targetScale]);

  // Subtle dimming as card settles under the next card
  const opacity = useTransform(
    progress,
    [rangeStart, (rangeStart + 1) / 2, 1],
    [1, index === total - 1 ? 1 : 0.96, index === total - 1 ? 1 : 0.88]
  );

  // Elevation offset for the deck lip
  const yOffset = index * 20;

  return (
    <motion.div
      style={{
        scale: reduceMotion ? 1 : scale,
        opacity: reduceMotion ? 1 : opacity,
        top: `calc(13vh + ${yOffset}px)`,
      }}
      className="sticky w-full max-w-4xl mx-auto rounded-3xl bg-white/95 backdrop-blur-xl border border-slate-200/90 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.08)] p-6 sm:p-10 mb-10 transition-colors will-change-transform"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        
        {/* Left Information Side */}
        <div className="lg:col-span-6 space-y-4 text-left">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-slate-400">
              {card.step}
            </span>
            <span className="text-slate-300">/</span>
            <span
              className={`font-mono text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full border ${card.badgeColor}`}
            >
              {card.tag}
            </span>
          </div>

          <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight leading-tight">
            {card.title}
          </h3>

          <p className="text-sm sm:text-base text-slate-600 leading-relaxed font-normal">
            {card.description}
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs font-semibold text-cyan-800 bg-cyan-50 border border-cyan-200 px-3 py-1.5 rounded-xl inline-block">
              {card.highlightBadge}
            </span>
            {card.metric && (
              <span className="font-mono text-xs text-slate-500 font-medium">
                {card.metric}
              </span>
            )}
          </div>
        </div>

        {/* Right Visual Clinical Slate */}
        <div className="lg:col-span-6 w-full">
          <div className="w-full rounded-2xl bg-slate-50 border border-slate-200/90 p-5 font-mono text-xs shadow-2xs">
            {card.content}
          </div>
        </div>

      </div>
    </motion.div>
  );
}

export function ScrollStack({ cards, className = "" }: ScrollStackProps) {
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
        />
      ))}
    </div>
  );
}

export default ScrollStack;
