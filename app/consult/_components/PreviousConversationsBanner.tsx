"use client";

import React from "react";
import Link from "next/link";
import { Clock, ArrowRight } from "lucide-react";

export function PreviousConsultationsBanner() {
  return (
    <Link
      href="/history"
      className="group flex items-center justify-between px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-2xl bg-white/90 hover:bg-white border border-slate-200/80 hover:border-slate-300 shadow-2xs hover:shadow-xs transition-all text-xs cursor-pointer w-full"
      aria-label="View previous consultations in history hub"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="p-1.5 rounded-xl bg-slate-100 group-hover:bg-[#18251D] text-slate-600 group-hover:text-[#B7FF72] transition-colors shrink-0">
          <Clock className="w-3.5 h-3.5" />
        </span>
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          <span className="font-bold text-slate-900 group-hover:text-slate-950 truncate">
            Previous consultations
          </span>
          <span className="hidden md:inline-block text-slate-300">·</span>
          <span className="hidden md:inline-block text-[11px] sm:text-xs text-slate-500 truncate">
            Pick up where you left off or review past visits.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 font-semibold text-slate-700 group-hover:text-slate-950 shrink-0 ml-2">
        <span className="text-xs">View all</span>
        <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#18251D] group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  );
}

// Keep backwards-compatible default and named export
export const PreviousConversationsBanner = PreviousConsultationsBanner;
export default PreviousConsultationsBanner;
