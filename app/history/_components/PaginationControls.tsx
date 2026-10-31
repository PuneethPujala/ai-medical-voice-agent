"use client";

import React from "react";
import { Loader2, ArrowDownCircle, CheckCircle } from "lucide-react";

export interface PaginationControlsProps {
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  totalLoaded: number;
}

export function PaginationControls({
  hasMore,
  isLoadingMore,
  onLoadMore,
  totalLoaded,
}: PaginationControlsProps) {
  if (totalLoaded === 0) return null;

  return (
    <div className="pt-6 pb-4 flex flex-col items-center justify-center gap-3">
      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          aria-label="Load more consultation records"
          aria-busy={isLoadingMore}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl text-xs sm:text-sm font-bold bg-white text-slate-800 border border-slate-200/90 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-xs hover:shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          {isLoadingMore ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
              <span>Loading earlier records...</span>
            </>
          ) : (
            <>
              <ArrowDownCircle className="w-4 h-4 text-emerald-600 group-hover:translate-y-0.5 transition-transform" />
              <span>Load More Consultations</span>
            </>
          )}
        </button>
      ) : (
        <div className="flex items-center gap-2 text-xs font-medium text-slate-400 py-3">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
          <span>All consultation records loaded ({totalLoaded} total)</span>
        </div>
      )}
    </div>
  );
}
