"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";

export interface NavItem {
  href: string;
  label: string;
  badge?: string;
  icon?: ReactNode;
}

export interface PillNavProps {
  items: NavItem[];
  className?: string;
  stretch?: number;
  squash?: number;
  speed?: number;
  glide?: number;
  draggable?: boolean;
}

type Slot = { l: number; r: number };
type Sample = [number, number];
type Drag = {
  id: number;
  x0: number;
  slot: number;
  onThumb: boolean;
  live: boolean;
  offset: number;
  w: number;
  hist: Sample[];
};

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const SPRING_UI = { type: "spring" as const, duration: 0.32, bounce: 0 };
const SPRING_MOMENTUM = { type: "spring" as const, duration: 0.42, bounce: 0.2 };
const SPRING_RELAX = { type: "spring" as const, duration: 0.16, bounce: 0 };
const DILATE = 0.2;
const HANDOFF = 0.15;
const FLICK = 110;
const MAX_VELOCITY = 2000;
const DEADZONE = 4;
const RUBBER = 0.55;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const rubber = (over: number, dim: number) =>
  (over * dim * RUBBER) / (dim + RUBBER * Math.abs(over));
const project = (v: number, glide: number) => {
  const d = 1 - 0.1 * Math.pow(0.05, glide / 100);
  return ((v / 1000) * d) / (1 - d);
};
const velocityOf = (hist: Sample[], now: number) => {
  const recent = hist.filter(([t]) => now - t <= 100);
  if (recent.length < 2) return 0;
  const [t0, x0] = recent[0];
  const [t1, x1] = recent[recent.length - 1];
  return t1 - t0 >= 8 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
};
const nearestSlot = (slots: Slot[], x: number) => {
  let best = 0;
  for (let i = 1; i < slots.length; i++) {
    if (
      Math.abs((slots[i].l + slots[i].r) / 2 - x) <
      Math.abs((slots[best].l + slots[best].r) / 2 - x)
    )
      best = i;
  }
  return best;
};

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function PillNav({
  items,
  className = "",
  stretch = 95,
  squash = 4,
  speed = 1,
  glide = 75,
  draggable = true,
}: PillNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const reduce = useReducedMotion();

  // Find index corresponding to current pathname
  const activeIndex = Math.max(
    0,
    items.findIndex((item) =>
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
    )
  );

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const slots = useRef<Slot[]>([]);
  const box = useRef<DOMRect | null>(null);
  const committed = useRef(activeIndex);
  const handoff = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<Drag | null>(null);
  const gen = useRef(0);

  const edgeL = useMotionValue(0);
  const edgeR = useMotionValue(0);
  const innerW = useMotionValue(0);
  const thumbRadius = 12;

  const thumbWidth = useTransform(() => Math.max(0, edgeR.get() - edgeL.get()));
  const clipPath = useTransform(
    () =>
      `inset(0px ${Math.max(
        0,
        innerW.get() - edgeR.get()
      )}px 0px ${Math.max(0, edgeL.get())}px round ${thumbRadius}px)`
  );

  const t = (seconds: number) => seconds / speed;

  const jumpTo = (i: number) => {
    const s = slots.current[i];
    if (!s) return;
    clearTimeout(handoff.current);
    gen.current += 1;
    edgeL.jump(s.l);
    edgeR.jump(s.r);
  };

  const measure = () => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    box.current = rect;
    slots.current = items.map((_, i) => {
      const el = itemRefs.current[i];
      if (!el) return { l: 0, r: 0 };
      const r = el.getBoundingClientRect();
      return { l: r.left - rect.left, r: r.right - rect.left };
    });
    innerW.set(rect.width);
    jumpTo(committed.current);
  };

  const itemsKey = items.map((item) => item.href).join("|");
  useIsomorphicLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (trackRef.current) observer.observe(trackRef.current);
    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(measure);
    }
    return () => observer.disconnect();
  }, [itemsKey]);

  // When pathname changes externally, update active slot with rubber stretch
  useEffect(() => {
    if (!drag.current && committed.current !== activeIndex) {
      const from = committed.current;
      committed.current = activeIndex;
      travel(from, activeIndex);
    }
  }, [activeIndex]);

  useEffect(
    () => () => {
      clearTimeout(handoff.current);
      edgeL.stop();
      edgeR.stop();
    },
    [edgeL, edgeR]
  );

  const land = (
    to: number,
    v: number | null,
    flick: boolean,
    withSquash: boolean
  ) => {
    const b = slots.current[to];
    if (!b) return;
    const g = ++gen.current;
    const dir =
      Math.sign((b.l + b.r) / 2 - (edgeL.get() + edgeR.get()) / 2) || 1;
    const [lead, leadTo, trail, trailTo] =
      dir > 0 ? [edgeR, b.r, edgeL, b.l] : [edgeL, b.l, edgeR, b.r];
    const velocityFor = (mv: MotionValue<number>) =>
      clamp(v === null ? mv.getVelocity() : v, -MAX_VELOCITY, MAX_VELOCITY);

    animate(lead, leadTo, {
      ...(flick ? SPRING_MOMENTUM : SPRING_UI),
      duration: t(flick ? 0.42 : 0.32),
      velocity: velocityFor(lead),
    });

    const trailVelocity = velocityFor(trail);
    if (!withSquash || squash <= 0) {
      animate(trail, trailTo, {
        ...SPRING_UI,
        duration: t(0.32),
        velocity: trailVelocity,
      });
      return;
    }

    animate(trail, trailTo + dir * squash, {
      ...SPRING_UI,
      duration: t(0.32),
      velocity: trailVelocity,
    }).then(() => {
      if (gen.current === g) {
        animate(trail, trailTo, { ...SPRING_RELAX, duration: t(0.16) });
      }
    });
  };

  const travel = (from: number, to: number) => {
    const a = slots.current[from];
    const b = slots.current[to];
    if (!a || !b) return;
    clearTimeout(handoff.current);
    gen.current += 1;
    if (reduce) {
      edgeL.jump(b.l);
      edgeR.jump(b.r);
      return;
    }
    const u = stretch / 100;
    const tween = { duration: t(DILATE), ease: EASE_OUT };
    animate(edgeL, b.l + (Math.min(a.l, b.l) - b.l) * u, tween);
    animate(edgeR, b.r + (Math.max(a.r, b.r) - b.r) * u, tween);
    handoff.current = setTimeout(
      () => land(to, null, false, true),
      t(HANDOFF) * 1000
    );
  };

  const localX = (e: { clientX: number }) =>
    e.clientX - (box.current ? box.current.left : 0);

  const handlePointerDown = (
    e: React.PointerEvent<HTMLAnchorElement>,
    i: number
  ) => {
    if (drag.current || e.button !== 0) return;
    box.current = trackRef.current?.getBoundingClientRect() ?? null;
    const x = localX(e);
    const onThumb = draggable && x >= edgeL.get() && x <= edgeR.get();
    drag.current = {
      id: e.pointerId,
      x0: x,
      slot: i,
      onThumb,
      live: false,
      offset: 0,
      w: 0,
      hist: [[e.timeStamp, x]],
    };
    if (onThumb) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      clearTimeout(handoff.current);
      gen.current += 1;
      edgeL.stop();
      edgeR.stop();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id || !d.onThumb) return;
    const x = localX(e);
    d.hist.push([e.timeStamp, x]);
    if (d.hist.length > 8) d.hist.shift();
    if (!d.live) {
      if (Math.abs(x - d.x0) < DEADZONE) return;
      d.live = true;
      d.offset = x - edgeL.get();
      d.w = edgeR.get() - edgeL.get();
      if (trackRef.current) trackRef.current.dataset.held = "";
    }
    const width = innerW.get();
    const l = x - d.offset;
    const maxL = width - d.w;
    if (reduce) {
      const c = clamp(l, 0, maxL);
      edgeL.set(c);
      edgeR.set(c + d.w);
    } else if (l < 0) {
      edgeL.set(0);
      edgeR.set(d.w - rubber(-l, d.w));
    } else if (l > maxL) {
      edgeR.set(width);
      edgeL.set(maxL + rubber(l - maxL, d.w));
    } else {
      edgeL.set(l);
      edgeR.set(l + d.w);
    }
  };

  const release = () => {
    const d = drag.current as Drag;
    drag.current = null;
    if (trackRef.current) delete trackRef.current.dataset.held;
    return d;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    release();
    if (!d.live) {
      // Tap without drag is handled by Link onClick
      return;
    }
    e.preventDefault();
    const v = velocityOf(d.hist, e.timeStamp);
    const flick = Math.abs(v) > FLICK;
    let to = nearestSlot(
      slots.current,
      (edgeL.get() + edgeR.get()) / 2 + project(v, glide)
    );
    if (flick && to === committed.current) {
      to = clamp(to + Math.sign(v), 0, items.length - 1);
    }
    committed.current = to;
    if (reduce) {
      jumpTo(to);
    } else {
      land(to, v, flick, flick);
    }
    if (items[to] && items[to].href !== pathname) {
      router.push(items[to].href);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    release();
    if (!d.live) return;
    if (reduce) jumpTo(committed.current);
    else land(committed.current, null, false, false);
  };

  const handleLinkClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    i: number
  ) => {
    if (drag.current?.live) {
      e.preventDefault();
      return;
    }
    if (i !== committed.current) {
      const from = committed.current;
      committed.current = i;
      travel(from, i);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    let nextIdx = -1;
    if (e.key === "ArrowRight") {
      nextIdx = (committed.current + 1) % items.length;
    } else if (e.key === "ArrowLeft") {
      nextIdx = (committed.current - 1 + items.length) % items.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = items.length - 1;
    }

    if (nextIdx >= 0) {
      e.preventDefault();
      const from = committed.current;
      committed.current = nextIdx;
      travel(from, nextIdx);
      itemRefs.current[nextIdx]?.focus();
      if (items[nextIdx] && items[nextIdx].href !== pathname) {
        router.push(items[nextIdx].href);
      }
    }
  };

  return (
    <nav
      ref={trackRef}
      role="tablist"
      aria-label="Clinical Navigation"
      onKeyDown={handleKeyDown}
      className={`relative inline-flex items-center gap-1 select-none p-1 rounded-2xl ${className}`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onMouseLeave={() => setHoveredIdx(null)}
      style={{ touchAction: "pan-y" }}
    >
      {/* 1. GOOEY MORPHING ACTIVE THUMB CAPSULE */}
      <motion.div
        className="absolute top-1 bottom-1 rounded-xl bg-cyan-500/[0.09] border border-cyan-500/25 shadow-[0_2px_14px_-2px_rgba(6,182,212,0.18)] pointer-events-none z-0 transition-colors"
        style={{
          left: edgeL,
          width: thumbWidth,
        }}
        aria-hidden="true"
      />

      {/* 2. BASE INTERACTIVE NAVIGATION LINKS */}
      {items.map((item, index) => {
        const isHovered = hoveredIdx === index && activeIndex !== index;
        const isActive = activeIndex === index;

        return (
          <Link
            key={item.href}
            href={item.href}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={(e) => handleLinkClick(e, index)}
            onPointerDown={(e) => handlePointerDown(e, index)}
            onMouseEnter={() => setHoveredIdx(index)}
            className={`relative px-4 py-2 text-sm font-semibold tracking-normal rounded-xl transition-all duration-150 z-10 flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 ${
              isActive && draggable
                ? "cursor-grab active:cursor-grabbing text-cyan-950 font-bold"
                : "cursor-pointer text-slate-600 hover:text-slate-950"
            }`}
          >
            {/* Subtle Hover Highlight */}
            {isHovered && (
              <motion.span
                layoutId="hoverNavPill"
                className="absolute inset-0 rounded-xl bg-slate-100/60 -z-10"
                transition={{ type: "spring", stiffness: 450, damping: 35 }}
              />
            )}

            {/* Invisible spacer dot matching the overlay layout pixel-perfect */}
            <span className="w-1.5 h-1.5 rounded-full opacity-0 flex-shrink-0" />
            <span>{item.label}</span>

            {item.badge && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold bg-slate-100 text-slate-500">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}

      {/* 3. SYNCHRONIZED CLIP-PATH ACTIVE TEXT & GLOWING DOT OVERLAY */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-20 flex items-center gap-1 overflow-hidden"
        style={{ clipPath }}
        aria-hidden="true"
      >
        {items.map((item) => (
          <div
            key={item.href}
            className="px-4 py-2 text-sm font-bold tracking-normal rounded-xl flex items-center gap-2 text-cyan-950 flex-shrink-0"
          >
            {/* Illuminated Glowing Cyan Micro-Dot */}
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.85)] flex-shrink-0" />
            <span>{item.label}</span>
            {item.badge && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider font-bold bg-cyan-100/80 text-cyan-800 border border-cyan-300/70">
                {item.badge}
              </span>
            )}
          </div>
        ))}
      </motion.div>
    </nav>
  );
}

export default PillNav;
