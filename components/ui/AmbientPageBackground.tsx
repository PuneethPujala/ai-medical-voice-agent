'use client';

import React from 'react';

export interface AmbientPageBackgroundProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * AmbientPageBackground
 * 
 * Reusable full-page ambient gradient treatment for MedVoice (/care and /privacy).
 * 
 * Extends a subtle cool-blue to soft-violet ambient gradient across the entire
 * scrollable page height, seamlessly blending into the warm porcelain foundation (#FAF9F6).
 * 
 * Key architectural features:
 * - Starts at top: 0 (behind the floating navbar capsule via -mt-20 pt-20) to eliminate
 *   any horizontal cutoff band beneath the header.
 * - Stretches through 100% of the document scroll height via relative page shell + absolute underlay.
 * - Gentle, broad radial highlights behind content panels and instruments.
 * - Non-interactive pointer-events-none underlay with strict z-index separation (-z-10).
 * - Preserves high-contrast legibility of both white cards and dark instruments.
 */
export function AmbientPageBackground({
  children,
  className = '',
}: AmbientPageBackgroundProps) {
  return (
    <div
      className={`relative min-h-screen bg-[#FAF9F6] text-slate-900 font-sans flex flex-col justify-between selection:bg-cyan-500 selection:text-white isolate -mt-20 pt-20 ${className}`}
    >
      {/* ========================================================================= */}
      {/* FULL-PAGE AMBIENT GRADIENT UNDERLAY (Covers 100% of scrollable document)  */}
      {/* ========================================================================= */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none -z-10 overflow-hidden w-full h-full select-none"
      >
        {/* Foundation Gradient Wash: Cool blue top-left, soft violet top-right, into porcelain */}
        <div
          className="absolute inset-0 w-full h-full"
          style={{
            background: `
              radial-gradient(ellipse 65% 45% at 15% 6%, rgba(56, 189, 248, 0.16) 0%, rgba(56, 189, 248, 0.04) 45%, transparent 75%),
              radial-gradient(ellipse 65% 45% at 85% 7%, rgba(192, 132, 252, 0.15) 0%, rgba(192, 132, 252, 0.03) 45%, transparent 75%),
              radial-gradient(ellipse 55% 30% at 50% 2%, rgba(129, 140, 248, 0.10) 0%, transparent 60%),
              radial-gradient(ellipse 70% 50% at 16% 38%, rgba(96, 165, 250, 0.12) 0%, rgba(56, 189, 248, 0.03) 50%, transparent 75%),
              radial-gradient(ellipse 70% 50% at 84% 48%, rgba(167, 139, 250, 0.12) 0%, rgba(192, 132, 252, 0.03) 50%, transparent 75%),
              radial-gradient(ellipse 65% 45% at 20% 76%, rgba(56, 189, 248, 0.10) 0%, transparent 70%),
              radial-gradient(ellipse 65% 45% at 80% 82%, rgba(192, 132, 252, 0.11) 0%, transparent 70%),
              radial-gradient(ellipse 60% 40% at 50% 96%, rgba(129, 140, 248, 0.09) 0%, transparent 65%)
            `,
          }}
        />

        {/* Soft atmospheric blurred bloom orbs for organic diffusion across all screen widths */}
        {/* Upper Hero Sky/Cyan Aura (Behind navbar & hero title) */}
        <div className="absolute -top-12 left-[6%] w-[min(680px,50vw)] h-[440px] bg-sky-400/14 rounded-full blur-[110px] transform-gpu pointer-events-none" />
        
        {/* Upper Hero Violet Aura (Behind right hero area) */}
        <div className="absolute -top-12 right-[6%] w-[min(680px,50vw)] h-[440px] bg-purple-400/13 rounded-full blur-[110px] transform-gpu pointer-events-none" />

        {/* Mid-Document Periwinkle Atmosphere (Behind workspace / 3D instrument) */}
        <div className="absolute top-[34%] left-[10%] w-[min(760px,55vw)] h-[520px] bg-blue-400/10 rounded-full blur-[130px] transform-gpu pointer-events-none" />
        <div className="absolute top-[44%] right-[8%] w-[min(760px,55vw)] h-[520px] bg-violet-400/10 rounded-full blur-[130px] transform-gpu pointer-events-none" />

        {/* Lower-Document Sky/Violet Glow (Blending smoothly towards AppFooter) */}
        <div className="absolute bottom-[6%] left-[14%] w-[min(700px,50vw)] h-[480px] bg-cyan-400/10 rounded-full blur-[120px] transform-gpu pointer-events-none" />
        <div className="absolute bottom-[4%] right-[12%] w-[min(700px,50vw)] h-[480px] bg-purple-400/10 rounded-full blur-[120px] transform-gpu pointer-events-none" />
      </div>

      {/* Main Document Content */}
      {children}
    </div>
  );
}

export default AmbientPageBackground;
