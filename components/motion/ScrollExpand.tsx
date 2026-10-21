"use client";

import React, { useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "motion/react";
import { ShieldCheck, Lock, CheckCircle2, ChevronDown } from "lucide-react";

export interface ExpandItem {
  id: string;
  num: string;
  tag: string;
  title: string;
  headline: string;
  summary: string;
  pipelineFlow: Array<{ label: string; sub?: string }>;
  complianceBadge: string;
}

export interface ScrollExpandProps {
  items: ExpandItem[];
  className?: string;
}

function ExpandCardItem({ item, idx }: { item: ExpandItem; idx: number }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: cardRef,
    offset: ["start end", "center center"],
  });

  const smoothProgress = useSpring(scrollYProgress, { damping: 25, stiffness: 100 });
  const scale = useTransform(smoothProgress, [0, 1], [0.96, 1]);
  const opacity = useTransform(smoothProgress, [0, 0.4], [0.4, 1]);

  return (
    <motion.div
      ref={cardRef}
      style={{ scale, opacity }}
      className="w-full rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-10 shadow-xs hover:border-[#18251D]/30 hover:shadow-lg transition-all duration-300 space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-bold text-slate-400">
            {item.num}
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#B7FF72]" />
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#18251D] bg-[#FAF9F6] border border-slate-200/90 px-3 py-1 rounded-full">
            {item.tag}
          </span>
        </div>
        <span className="font-mono text-xs font-semibold text-[#18251D] bg-[#B7FF72]/20 border border-[#B7FF72]/50 px-3.5 py-1 rounded-full inline-flex items-center gap-1.5 self-start sm:self-auto shadow-xs">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#18251D]" />
          {item.complianceBadge}
        </span>
      </div>

      {/* Main Copy */}
      <div className="space-y-2 max-w-3xl">
        <h3 className="text-2xl sm:text-3xl font-extrabold text-[#05070F] tracking-tight">
          {item.title}
        </h3>
        <p className="text-base sm:text-lg text-slate-600 leading-relaxed font-normal">
          {item.headline}
        </p>
      </div>

      {/* Progressive Architecture Diagram Pipeline Flow */}
      <div className="pt-2">
        <span className="font-mono text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-3">
          TECHNICAL EXECUTION LIFECYCLE:
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-2.5">
          {item.pipelineFlow.map((step, i) => (
            <div
              key={i}
              className="p-3.5 rounded-2xl bg-[#FAF9F6] border border-slate-200/80 hover:border-[#18251D]/30 flex flex-col justify-between font-mono text-xs transition-colors"
            >
              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
                <span className="font-semibold text-slate-500">0{i + 1}</span>
                {i < item.pipelineFlow.length - 1 && <span className="text-[#18251D]/40 font-bold">→</span>}
              </div>
              <span className="font-bold text-[#05070F] font-sans text-xs">
                {step.label}
              </span>
              {step.sub && (
                <span className="text-[10px] text-slate-500 font-mono mt-1">
                  {step.sub}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Summary Note */}
      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-4">
        <p className="text-xs text-slate-500 leading-relaxed font-mono">
          {item.summary}
        </p>
        <div className="shrink-0 flex items-center gap-1.5 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-[#B7FF72]" />
          <span>Verified Protocol</span>
        </div>
      </div>
    </motion.div>
  );
}

export function ScrollExpand({ items, className = "" }: ScrollExpandProps) {
  return (
    <div className={`space-y-8 ${className}`}>
      {items.map((item, idx) => (
        <ExpandCardItem key={item.id} item={item} idx={idx} />
      ))}
    </div>
  );
}

export default ScrollExpand;
