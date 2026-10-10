"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export interface GooeyNavItem {
  href: string;
  label: string;
}

export interface GooeyNavProps {
  items: GooeyNavItem[];
  className?: string;
  animationTime?: number;
  particleCount?: number;
}

interface Particle {
  id: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  size: number;
  color: string;
}

export function GooeyNav({
  items,
  className = "",
  animationTime = 450,
  particleCount = 12,
}: GooeyNavProps) {
  const pathname = usePathname();
  const router = useRouter();

  // Find active index based strictly on current pathname
  // If no match (e.g. on /profile or /admin), activeIndex is -1 and pill is hidden
  const activeIndex = items.findIndex((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLUListElement>(null);
  const prevIndexRef = useRef<number>(activeIndex);

  const [pillStyle, setPillStyle] = useState<{ left: number; width: number; opacity: number }>({
    left: 0,
    width: 0,
    opacity: 0,
  });

  const [particles, setParticles] = useState<Particle[]>([]);

  // Position the indicator over the active li item
  const updatePill = useCallback(() => {
    if (!navRef.current || !containerRef.current) return;
    if (activeIndex === -1) {
      setPillStyle((prev) => ({ ...prev, opacity: 0 }));
      return;
    }

    const lis = navRef.current.querySelectorAll<HTMLLIElement>("li[data-nav-item]");
    const activeLi = lis[activeIndex];
    if (!activeLi) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const liRect = activeLi.getBoundingClientRect();

    setPillStyle({
      left: liRect.left - containerRect.left,
      width: liRect.width,
      opacity: 1,
    });
  }, [activeIndex]);

  // Spawn gooey liquid bubble particles transitioning between fromIdx and toIdx
  const spawnGooeyBubbles = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (typeof window !== "undefined") {
        const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (prefersReduced) return;
      }

      if (!navRef.current || !containerRef.current) return;
      const lis = navRef.current.querySelectorAll<HTMLLIElement>("li[data-nav-item]");
      const fromLi = lis[fromIdx];
      const toLi = lis[toIdx];
      if (!fromLi || !toLi) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const fromRect = fromLi.getBoundingClientRect();
      const toRect = toLi.getBoundingClientRect();

      const startX = fromRect.left - containerRect.left + fromRect.width / 2;
      const startY = fromRect.top - containerRect.top + fromRect.height / 2;
      const endX = toRect.left - containerRect.left + toRect.width / 2;
      const endY = toRect.top - containerRect.top + toRect.height / 2;

      const palette = ["#06b6d4", "#0891b2", "#0e7490", "#14b8a6"];

      const newParticles: Particle[] = [];
      for (let i = 0; i < particleCount; i++) {
        const progress = (i + 1) / (particleCount + 1);
        const jitterX = (Math.random() - 0.5) * 20;
        const jitterY = (Math.random() - 0.5) * 14;
        const midX = startX + (endX - startX) * progress + jitterX;
        const midY = startY + (endY - startY) * progress + jitterY;

        newParticles.push({
          id: Date.now() + i + Math.random(),
          startX,
          startY,
          targetX: midX,
          targetY: midY,
          size: 14 + Math.random() * 12,
          color: palette[i % palette.length],
        });
      }

      setParticles(newParticles);

      setTimeout(() => {
        setParticles([]);
      }, animationTime + 150);
    },
    [animationTime, particleCount]
  );

  // Sync pill positioning and trigger gooey droplet animation on tab change
  useEffect(() => {
    updatePill();

    if (
      prevIndexRef.current !== -1 &&
      activeIndex !== -1 &&
      prevIndexRef.current !== activeIndex
    ) {
      spawnGooeyBubbles(prevIndexRef.current, activeIndex);
    }
    prevIndexRef.current = activeIndex;
  }, [activeIndex, updatePill, spawnGooeyBubbles]);

  // Recalculate on window resize
  useEffect(() => {
    const handleResize = () => updatePill();
    window.addEventListener("resize", handleResize);

    const observer = new ResizeObserver(updatePill);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
  }, [updatePill]);

  // Handle immediate click feedback
  const handleItemClick = (index: number) => {
    if (index !== activeIndex && activeIndex !== -1) {
      spawnGooeyBubbles(activeIndex, index);
    }
  };

  // Accessible keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    let nextIdx = -1;
    if (e.key === "ArrowRight") {
      nextIdx = activeIndex === -1 ? 0 : (activeIndex + 1) % items.length;
    } else if (e.key === "ArrowLeft") {
      nextIdx = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = items.length - 1;
    }

    if (nextIdx !== -1) {
      e.preventDefault();
      router.push(items[nextIdx].href);
    }
  };

  return (
    <>
      {/* Authentic SVG Gooey Metaball Filter */}
      <style>{`
        @keyframes gooeyDroplet {
          0% {
            transform: translate3d(var(--start-x), var(--start-y), 0) scale(0.3);
            opacity: 0;
          }
          25% {
            opacity: 1;
            transform: translate3d(var(--target-x), var(--target-y), 0) scale(1.15);
          }
          70% {
            opacity: 0.85;
            transform: translate3d(var(--target-x), var(--target-y), 0) scale(0.95);
          }
          100% {
            opacity: 0;
            transform: translate3d(var(--target-x), var(--target-y), 0) scale(0.1);
          }
        }
        .animate-gooey-droplet {
          animation: gooeyDroplet ease-out forwards;
        }
      `}</style>
      <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
        <defs>
          <filter id="medvoice-gooey-filter" x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6.5" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div
        ref={containerRef}
        className={`relative inline-flex items-center select-none ${className}`}
        onKeyDown={handleKeyDown}
      >
        {/* ============================================================ 
            BACKGROUND GOOEY METABALL LAYER (Z-0)
            Applied strictly to the indicator blob and liquid droplets.
            Renders solid color through high-contrast matrix, then softened
            by container opacity to create a flawless clinical fluid effect.
            ============================================================ */}
        <div
          className="absolute inset-0 pointer-events-none z-0 overflow-visible"
          style={{
            filter: "url(#medvoice-gooey-filter)",
            opacity: pillStyle.opacity > 0 ? 0.35 : 0,
            transition: "opacity 180ms ease",
          }}
          aria-hidden="true"
        >
          {/* Main Morphing Active Blob */}
          <div
            className="absolute top-1 bottom-1 rounded-2xl bg-cyan-600"
            style={{
              transform: `translate3d(${pillStyle.left}px, 0, 0)`,
              width: `${pillStyle.width}px`,
              transition: `transform ${animationTime}ms cubic-bezier(0.34, 1.35, 0.64, 1), width ${animationTime}ms cubic-bezier(0.34, 1.35, 0.64, 1)`,
            }}
          />

          {/* Liquid Gooey Transition Droplets */}
          {particles.map((p) => (
            <span
              key={p.id}
              className="absolute rounded-full pointer-events-none animate-gooey-droplet"
              style={{
                left: 0,
                top: 0,
                width: `${p.size}px`,
                height: `${p.size}px`,
                backgroundColor: p.color,
                animationDuration: `${animationTime}ms`,
                ["--start-x" as string]: `${p.startX - p.size / 2}px`,
                ["--start-y" as string]: `${p.startY - p.size / 2}px`,
                ["--target-x" as string]: `${p.targetX - p.size / 2}px`,
                ["--target-y" as string]: `${p.targetY - p.size / 2}px`,
              }}
            />
          ))}
        </div>

        {/* Crisp Clinical Stroke Accent (Z-1) */}
        {pillStyle.opacity > 0 && (
          <div
            className="absolute top-1 bottom-1 rounded-xl border border-cyan-400/40 pointer-events-none z-[1] shadow-[0_2px_12px_rgba(6,182,212,0.18)]"
            style={{
              transform: `translate3d(${pillStyle.left}px, 0, 0)`,
              width: `${pillStyle.width}px`,
              transition: `transform ${animationTime}ms cubic-bezier(0.34, 1.35, 0.64, 1), width ${animationTime}ms cubic-bezier(0.34, 1.35, 0.64, 1), opacity 180ms ease`,
            }}
            aria-hidden="true"
          />
        )}

        {/* ============================================================ 
            FOREGROUND ACCESSIBLE NAVIGATION LINKS (Z-10)
            Crisp typography, exactly ONE label per item.
            Zero ghosting, zero duplicate text, zero clipping bugs.
            ============================================================ */}
        <nav role="tablist" aria-label="Primary Navigation" className="relative z-10 flex">
          <ul ref={navRef} className="flex items-center gap-1 list-none p-0 m-0">
            {items.map((item, index) => {
              const isActive = activeIndex === index;
              return (
                <li key={item.href} data-nav-item className="relative">
                  <Link
                    href={item.href}
                    role="tab"
                    aria-selected={isActive}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => handleItemClick(index)}
                    className={`relative px-4 py-2 text-sm font-semibold rounded-xl transition-colors duration-150 flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60 ${
                      isActive
                        ? "text-cyan-950 font-bold"
                        : "text-slate-600 hover:text-slate-900 font-medium hover:bg-slate-100/50"
                    }`}
                  >
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
}

export default GooeyNav;
