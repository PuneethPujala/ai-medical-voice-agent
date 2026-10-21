"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

export interface SoapSection {
  id: "subjective" | "objective" | "assessment" | "plan";
  letter: string;
  name: string;
  subtitle: string;
  content: string;
  tags?: string[];
}

export interface ClinicalSwipeRowProps {
  sections: SoapSection[];
  activeId?: "subjective" | "objective" | "assessment" | "plan";
  onChange?: (id: SoapSection["id"]) => void;
  className?: string;
}

export function ClinicalSwipeRow({
  sections,
  activeId = "subjective",
  onChange,
  className = "",
}: ClinicalSwipeRowProps) {
  const [selectedId, setSelectedId] = useState<SoapSection["id"]>(activeId);

  const activeIndex = sections.findIndex((s) => s.id === selectedId);
  const currentSection = sections[activeIndex >= 0 ? activeIndex : 0];

  const handleSelect = (id: SoapSection["id"]) => {
    setSelectedId(id);
    onChange?.(id);
  };

  const handleNext = () => {
    const nextIdx = (activeIndex + 1) % sections.length;
    handleSelect(sections[nextIdx].id);
  };

  const handlePrev = () => {
    const prevIdx = (activeIndex - 1 + sections.length) % sections.length;
    handleSelect(sections[prevIdx].id);
  };

  return (
    <div className={`space-y-3.5 ${className}`}>
      {/* ===================================================================== */}
      {/* UNMISTAKABLE S · O · A · P SEGMENTED CONTROL                          */}
      {/* ===================================================================== */}
      <div
        role="tablist"
        aria-label="Clinical SOAP Sections"
        className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 p-1.5 rounded-2xl bg-slate-100/90 border border-slate-200/90 shadow-2xs"
      >
        {/* The 4 Segmented Tabs */}
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-1.5 flex-1">
          {sections.map((section) => {
            const isActive = section.id === selectedId;
            return (
              <button
                key={section.id}
                role="tab"
                id={`soap-tab-${section.id}`}
                aria-selected={isActive}
                aria-controls={`soap-panel-${section.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => handleSelect(section.id)}
                className={`relative px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center sm:justify-start gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#18251D] ${
                  isActive
                    ? "bg-[#18251D] text-white shadow-sm ring-1 ring-[#18251D]"
                    : "bg-white/80 hover:bg-white text-slate-700 hover:text-slate-950 border border-slate-200/60 shadow-2xs"
                }`}
              >
                {/* Active Indicator Letter Badge */}
                <span
                  className={`w-5 h-5 rounded-md flex items-center justify-center font-mono text-[11px] font-black transition-colors ${
                    isActive
                      ? "bg-[#B7FF72] text-[#05070F] shadow-xs"
                      : "bg-slate-100 text-slate-600 border border-slate-200/70"
                  }`}
                >
                  {section.letter}
                </span>

                {/* Full Unambiguous Section Label */}
                <span className="font-semibold text-xs tracking-tight">
                  {section.name}
                </span>

                {/* Active Acid Mint Glow Dot */}
                {isActive && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-[#B7FF72] shadow-[0_0_8px_#B7FF72] ml-auto hidden sm:inline-block animate-pulse"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Previous / Next Dimension Shortcuts */}
        <div className="flex items-center justify-end gap-1 px-1 border-t sm:border-t-0 sm:border-l border-slate-200/80 pt-1.5 sm:pt-0 sm:pl-2">
          <button
            onClick={handlePrev}
            aria-label="Previous SOAP section"
            className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors cursor-pointer"
            title="Previous section"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleNext}
            aria-label="Next SOAP section"
            className="p-1.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors cursor-pointer"
            title="Next section"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* SELECTED SOAP CONTENT SURFACE (Fully Readable, Zero Fadeout)          */}
      {/* ===================================================================== */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentSection.id}
          id={`soap-panel-${currentSection.id}`}
          role="tabpanel"
          aria-labelledby={`soap-tab-${currentSection.id}`}
          initial={{ opacity: 0.85, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0.85, y: -4 }}
          transition={{ duration: 0.15 }}
          className="p-6 sm:p-7 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-4"
        >
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-[10px] font-black uppercase tracking-wider text-[#18251D] bg-[#FAF9F6] border border-slate-200 px-2.5 py-1 rounded-md">
                SECTION {currentSection.letter} · {currentSection.name.toUpperCase()}
              </span>
              <h4 className="text-base sm:text-lg font-black text-[#05070F] tracking-tight">
                {currentSection.name} Findings
              </h4>
            </div>
            <span className="text-xs text-slate-400 font-mono font-medium">
              {currentSection.subtitle}
            </span>
          </div>

          {/* Primary Clinical Narrative Text */}
          <div className="text-sm sm:text-[14.5px] text-slate-800 leading-relaxed font-sans whitespace-pre-line font-normal selection:bg-[#B7FF72] selection:text-[#05070F]">
            {currentSection.content || "No clinical observations recorded for this section."}
          </div>

          {/* Extracted Clinical Entities (Subordinate, Quiet) */}
          {currentSection.tags && currentSection.tags.length > 0 && (
            <div className="pt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100">
              <span className="font-mono text-[10px] font-bold text-slate-400 mr-1 uppercase tracking-wider">
                Extracted Entities:
              </span>
              {currentSection.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="font-mono text-[11px] font-medium px-2.5 py-0.5 rounded-lg bg-[#FAF9F6] text-slate-700 border border-slate-200/80"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default ClinicalSwipeRow;
