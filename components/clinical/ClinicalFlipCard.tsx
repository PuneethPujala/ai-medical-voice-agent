"use client";

import React, { useState } from "react";
import { motion } from "motion/react";
import { RotateCw, CheckCircle2, ShieldCheck, ArrowRight } from "lucide-react";

export interface ClinicalFlipCardProps {
  category: string;
  title: string;
  frontSnippet: string;
  frontBadge: string;
  frontIcon?: React.ReactNode;
  backTitle: string;
  backItems: Array<{ label: string; value: string }>;
  backNote?: string;
  className?: string;
}

export function ClinicalFlipCard({
  category,
  title,
  frontSnippet,
  frontBadge,
  frontIcon,
  backTitle,
  backItems,
  backNote,
  className = "",
}: ClinicalFlipCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <div
      className={`relative h-[320px] w-full [perspective:1200px] cursor-pointer group ${className}`}
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <motion.div
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
        className="relative w-full h-full [transform-style:preserve-3d] rounded-3xl"
      >
        {/* ===================== FRONT FACE ===================== */}
        <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-7 shadow-xs hover:border-cyan-300 transition-all flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-slate-900 bg-slate-100 border border-slate-200/90 px-3 py-1 rounded-full">
                {category}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-slate-400 font-medium">Click to inspect</span>
                <RotateCw className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-900 transition-colors" />
              </div>
            </div>

            <div className="flex items-start gap-3 my-2">
              {frontIcon && (
                <div className="w-10 h-10 rounded-2xl bg-slate-100 border border-slate-200/90 flex items-center justify-center text-slate-950 flex-shrink-0">
                  {frontIcon}
                </div>
              )}
              <div>
                <h3 className="text-xl font-bold text-slate-950 tracking-tight leading-snug">
                  {title}
                </h3>
              </div>
            </div>

            <p className="mt-3 text-sm text-slate-600 leading-relaxed font-normal">
              {frontSnippet}
            </p>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-slate-500">
              {frontBadge}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-900 group-hover:text-slate-700">
              <span>View Schema</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>

        {/* ===================== BACK FACE (LIGHT CLINICAL SURFACE) ===================== */}
        <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] rounded-3xl bg-slate-50/95 text-slate-900 border border-slate-200/90 p-6 sm:p-7 shadow-xs flex flex-col justify-between font-mono text-xs">
          <div>
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-3 mb-4">
              <span className="text-slate-950 font-bold uppercase tracking-wider text-xs">
                {backTitle}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsFlipped(false);
                }}
                className="text-[11px] text-slate-500 hover:text-slate-900 flex items-center gap-1 cursor-pointer font-sans font-medium"
              >
                <span>Flip Back</span>
                <RotateCw className="w-3 h-3 text-slate-400" />
              </button>
            </div>

            <div className="space-y-2.5 font-sans">
              {backItems.map((item, idx) => (
                <div key={idx} className="flex items-baseline justify-between gap-3 text-xs border-b border-slate-200/50 pb-1.5 last:border-b-0">
                  <span className="font-mono text-[11px] font-bold text-slate-500 uppercase tracking-wider flex-shrink-0">
                    {item.label}:
                  </span>
                  <span className="text-xs text-slate-800 font-medium text-right truncate">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {backNote && (
            <div className="pt-3 border-t border-slate-200/80 text-[11px] text-slate-500 font-sans italic">
              {backNote}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default ClinicalFlipCard;
