'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

export interface PageTransitionProps {
  children: React.ReactNode;
}

/**
 * PageTransition: High-craft, restrained route crossfade for MedVoice App Router.
 * Establishes incoming screen at 180ms without blocking interaction or hiding content.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();

  return (
    <div
      key={pathname}
      className="page-transition-wrapper flex-1 flex flex-col w-full"
    >
      {children}
    </div>
  );
}

export default PageTransition;
