'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { animate, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, SparklesIcon, Tick02Icon } from '@hugeicons/core-free-icons';

export type ThoughtLineGlyph = 'sparkle' | 'dot' | 'none' | ReactNode;
export type ThoughtStep = string | { id?: string; label: string; detail?: string; status?: string };

export interface ThoughtLineProps {
  label?: string;
  doneLabel?: string;
  renderLabel?: (text: string, working: boolean) => ReactNode;
  glyph?: ThoughtLineGlyph;
  steps?: ThoughtStep[];
  collapsible?: boolean;
  collapseOnSettle?: boolean;
  color?: string;
  glyphColor?: string;
  fontSize?: number;
  breathPeriod?: number;
  breathDepth?: number;
  shimmer?: boolean;
  shimmerDuration?: number;
  settleDuration?: number;
  settleBlur?: number;
  working?: boolean;
  settleAfter?: number;
  elapsed?: number;
  showTimer?: boolean;
  isEmergency?: boolean;
  emergencyDirective?: string;
  onSettle?: (seconds: number) => void;
  className?: string;
  style?: CSSProperties;
}

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1];
const GLYPH_DONE = 0.55;
const EMPTY_STEPS: string[] = [];

const fmt = (ds: number) =>
  ds < 600 ? `${(ds / 10).toFixed(1)}s` : `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`;
const spoken = (ds: number) =>
  ds < 600
    ? `${(ds / 10).toFixed(1)} seconds`
    : `${Math.floor(ds / 600)} minutes ${((ds % 600) / 10).toFixed(1)} seconds`;

const STYLE = `
@keyframes thought-line-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
@keyframes thought-line-shimmer { to { background-position: -125% 0; } }
`;

export const ThoughtLine: React.FC<ThoughtLineProps> = ({
  label = 'Thinking…',
  doneLabel = '',
  renderLabel,
  glyph = 'sparkle',
  steps = EMPTY_STEPS,
  collapsible = false,
  collapseOnSettle = true,
  color = '#0891b2',
  glyphColor = '#06b6d4',
  fontSize = 12,
  breathPeriod = 1.6,
  breathDepth = 0.45,
  shimmer = true,
  shimmerDuration = 1.8,
  settleDuration = 350,
  settleBlur = 2,
  working = true,
  settleAfter = 0,
  elapsed,
  showTimer = false,
  isEmergency = false,
  emergencyDirective,
  onSettle,
  className = '',
  style
}) => {
  const reduce = useReducedMotion();
  const [autoSettled, setAutoSettled] = useState(false);
  const [open, setOpen] = useState(true);
  const isWorking = working && !autoSettled && !isEmergency;
  const doneText = doneLabel || (showTimer ? 'Processed in' : 'Deliberation complete');
  const hasTrace = steps.length > 0;
  const depth = reduce ? Math.min(breathDepth, 0.2) : breathDepth;
  const period = reduce ? breathPeriod * 1.5 : breathPeriod;
  const trough = 1 - depth;
  const sheen = shimmer && !reduce;

  const glyphRef = useRef<HTMLSpanElement>(null);
  const breathRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const stackRef = useRef<HTMLSpanElement>(null);
  const workRef = useRef<HTMLSpanElement>(null);
  const doneRef = useRef<HTMLSpanElement>(null);
  const dsRef = useRef(0);
  const prevWorking = useRef(isWorking);
  const latest = useRef<{ onSettle?: (seconds: number) => void }>({});
  latest.current = { onSettle };
  const [announce, setAnnounce] = useState(label);

  useEffect(() => {
    if (working) setAutoSettled(false);
  }, [working]);

  useEffect(() => {
    if (isWorking) setOpen(true);
    else if (collapseOnSettle) setOpen(false);
  }, [isWorking, collapseOnSettle]);

  useEffect(() => {
    const glyphEl = glyphRef.current;
    const breathEl = breathRef.current;
    if (!breathEl) return undefined;
    const s = settleDuration / 1000;
    const loop = (el: HTMLElement, delay: number) =>
      animate(el, { opacity: [trough, 1, trough] }, { duration: period, ease: EASE_IN_OUT, repeat: Infinity, delay });
    let cancelled = false;
    const running: AnimationPlaybackControls[] = [];
    if (isWorking) {
      if (depth > 0) {
        if (sheen) running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
        if (glyphEl) {
          const lead = animate(glyphEl, { opacity: trough }, { duration: 0.2, ease: EASE_OUT });
          running.push(lead);
          lead.then(() => {
            if (cancelled) return;
            running.push(loop(glyphEl, 0));
            if (!sheen) running.push(loop(breathEl, 0.14));
          });
        } else if (!sheen) {
          running.push(loop(breathEl, 0.14));
        }
      } else {
        if (glyphEl) running.push(animate(glyphEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
        running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
      }
    } else {
      if (glyphEl) running.push(animate(glyphEl, { opacity: GLYPH_DONE }, { duration: s, ease: EASE_OUT }));
      running.push(animate(breathEl, { opacity: 1 }, { duration: s, ease: EASE_OUT }));
    }
    return () => {
      cancelled = true;
      running.forEach(a => a.stop());
    };
  }, [isWorking, period, depth, trough, settleDuration, glyph, sheen]);

  const paint = (ds: number) => {
    dsRef.current = ds;
    if (timerRef.current) timerRef.current.textContent = fmt(ds);
  };

  useLayoutEffect(() => {
    if (elapsed != null) {
      paint(Math.round(elapsed * 10));
      return undefined;
    }
    if (!isWorking) return undefined;
    const startedAt = performance.now();
    paint(0);
    const id = setInterval(() => {
      const ds = Math.floor((performance.now() - startedAt) / 100);
      paint(ds);
      if (settleAfter > 0 && ds >= Math.round(settleAfter * 10)) setAutoSettled(true);
    }, 100);
    return () => clearInterval(id);
  }, [isWorking, elapsed, settleAfter]);

  useLayoutEffect(() => {
    const t = timerRef.current;
    const stack = stackRef.current;
    if (!t || !stack) return undefined;
    const place = (glide: boolean) => {
      const active = isWorking ? workRef.current : doneRef.current;
      if (!active) return;
      const shift = active.offsetWidth - stack.offsetWidth;
      if (!glide) t.style.transition = 'none';
      t.style.transform = `translateX(${shift}px)`;
      if (!glide) {
        void t.offsetWidth;
        t.style.transition = '';
      }
    };
    place(prevWorking.current !== isWorking);
    prevWorking.current = isWorking;
    const ro = new ResizeObserver(() => place(false));
    if (workRef.current) ro.observe(workRef.current);
    if (doneRef.current) ro.observe(doneRef.current);
    return () => ro.disconnect();
  }, [isWorking, label, doneText, fontSize, showTimer]);

  useEffect(() => {
    if (isWorking) {
      setAnnounce(label);
      return;
    }
    setAnnounce(showTimer ? `${doneText} ${spoken(dsRef.current)}` : doneText);
    latest.current.onSettle?.(dsRef.current / 10);
  }, [isWorking, doneText, label, showTimer]);

  // If Emergency Escalation occurs, override ordinary thinking with Emergency Alert
  if (isEmergency) {
    return (
      <div className={`px-3.5 py-2 rounded-xl bg-rose-600 text-white text-xs font-mono font-bold flex items-center justify-between shadow-xs ${className}`}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-white animate-ping shrink-0" />
          <span>EMERGENCY OVERRIDE ACTIVE</span>
        </div>
        <span className="text-[11px] font-sans font-medium text-rose-100 truncate ml-2">
          {emergencyDirective || "Immediate Facility Referral Required"}
        </span>
      </div>
    );
  }

  const toggle = hasTrace && collapsible;
  const head = (
    <>
      {glyph !== 'none' ? (
        <span
          ref={glyphRef}
          className="mr-[0.3em] inline-flex h-[1.15em] w-[1.15em] flex-none [color:var(--tl-glyph)] [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          aria-hidden="true"
        >
          {glyph === 'sparkle' ? (
            <HugeiconsIcon icon={SparklesIcon} size="100%" strokeWidth={2.2} />
          ) : glyph === 'dot' ? (
            <span className="m-auto h-[0.5em] w-[0.5em] rounded-full bg-current" />
          ) : (
            glyph
          )}
        </span>
      ) : null}
      <span ref={stackRef} className="inline-grid" aria-hidden="true">
        <span
          ref={workRef}
          className="w-max opacity-0 [grid-area:1/1] [filter:blur(var(--tl-blur))] [transition:opacity_var(--tl-settle)_cubic-bezier(0.23,1,0.32,1),filter_var(--tl-settle)_cubic-bezier(0.23,1,0.32,1)] data-[active]:opacity-100 data-[active]:[filter:blur(0)] motion-reduce:[filter:none]! motion-reduce:[transition:opacity_var(--tl-settle)_ease]"
          data-active={isWorking ? '' : undefined}
        >
          <span
            ref={breathRef}
            className="inline-block font-mono tracking-tight text-cyan-900 group-data-[working]:data-[shimmer]:bg-clip-text group-data-[working]:data-[shimmer]:text-transparent group-data-[working]:data-[shimmer]:[background-image:linear-gradient(100deg,color-mix(in_srgb,var(--tl-color)_50%,transparent)_30%,var(--tl-color)_50%,color-mix(in_srgb,var(--tl-color)_50%,transparent)_70%)] group-data-[working]:data-[shimmer]:[background-size:250%_100%] group-data-[working]:data-[shimmer]:[background-position:125%_0] group-data-[working]:data-[shimmer]:[-webkit-text-fill-color:transparent] group-data-[working]:data-[shimmer]:[animation:thought-line-shimmer_var(--tl-shimmer)_linear_infinite]"
            data-shimmer={sheen ? '' : undefined}
          >
            {renderLabel ? renderLabel(label, true) : label}
          </span>
        </span>
        <span
          ref={doneRef}
          className="w-max opacity-0 [grid-area:1/1] font-mono tracking-tight text-slate-700 [filter:blur(var(--tl-blur))] [transition:opacity_var(--tl-settle)_cubic-bezier(0.23,1,0.32,1),filter_var(--tl-settle)_cubic-bezier(0.23,1,0.32,1)] data-[active]:[opacity:var(--tl-done)] data-[active]:[filter:blur(0)] motion-reduce:[filter:none]! motion-reduce:[transition:opacity_var(--tl-settle)_ease]"
          data-active={isWorking ? undefined : ''}
        >
          {renderLabel ? renderLabel(doneText, false) : doneText}
        </span>
      </span>
      {showTimer ? (
        <span
          ref={timerRef}
          className="tabular-nums font-mono text-[11px] text-cyan-700 ml-1.5 px-1.5 py-0.5 rounded bg-cyan-50 border border-cyan-200/70"
          data-done={isWorking ? undefined : ''}
          aria-hidden="true"
        >
          0.0s
        </span>
      ) : null}
      {collapsible ? (
        <span
          className="ml-[0.2em] inline-flex text-slate-400 opacity-60 [transition:opacity_200ms_ease,transform_200ms_cubic-bezier(0.23,1,0.32,1)] group-data-[open]:rotate-180"
          data-on={hasTrace ? '' : undefined}
          aria-hidden="true"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size="1em" strokeWidth={2.2} />
        </span>
      ) : null}
      <span className="sr-only" role="status">
        {announce}
      </span>
    </>
  );

  return (
    <div
      className={`group inline-flex ${hasTrace ? 'flex-col items-start p-3 rounded-2xl bg-white/95 border border-slate-200/90 shadow-xs' : 'items-center px-3.5 py-1.5 rounded-xl bg-slate-50/90 border border-slate-200/80 shadow-2xs'} leading-[1.2] font-medium [color:var(--tl-color)] font-mono text-xs ${className}`}
      data-working={isWorking ? '' : undefined}
      data-open={open && hasTrace ? '' : undefined}
      style={
        {
          '--tl-font': `${fontSize}px`,
          '--tl-color': color,
          '--tl-glyph': glyphColor || color,
          '--tl-settle': `${settleDuration}ms`,
          '--tl-blur': `${settleBlur}px`,
          '--tl-shimmer': `${shimmerDuration}s`,
          ...style
        } as CSSProperties
      }
    >
      <style>{STYLE}</style>
      {collapsible ? (
        <button
          type="button"
          className="relative m-0 inline-flex cursor-pointer items-center gap-[0.3em] border-0 bg-transparent p-0 text-left whitespace-nowrap text-inherit outline-none"
          data-toggle={toggle ? '' : undefined}
          aria-expanded={toggle ? open : undefined}
          tabIndex={toggle ? 0 : -1}
          onClick={() => {
            if (toggle) setOpen(v => !v);
          }}
        >
          {head}
        </button>
      ) : (
        <div className="relative m-0 inline-flex cursor-default items-center gap-[0.3em] border-0 bg-transparent p-0 text-left whitespace-nowrap text-inherit outline-none">
          {head}
        </div>
      )}
      {hasTrace ? (
        <div
          className="grid w-0 min-w-full [grid-template-rows:0fr] [transition:grid-template-rows_var(--tl-settle)_cubic-bezier(0.23,1,0.32,1)] data-[open]:[grid-template-rows:1fr]"
          data-open={open ? '' : undefined}
          aria-hidden={!open}
        >
          <div className="min-h-0 overflow-x-visible overflow-y-clip">
            <div className="flex w-max flex-col gap-[0.45em] pt-[0.6em] pb-[0.2em] pl-[1.6em] text-[0.875em] font-normal whitespace-nowrap">
              {steps.map((stepItem, i) => {
                const text = typeof stepItem === 'string' ? stepItem : `${stepItem.label}${stepItem.detail ? ` (${stepItem.detail})` : ''}`;
                const isStepCompleted = typeof stepItem === 'object' && stepItem.status ? stepItem.status === 'completed' : (!isWorking || i < steps.length - 1);
                const done = isStepCompleted;
                const key = typeof stepItem === 'string' ? `${i}-${stepItem}` : `${i}-${stepItem.id || stepItem.label}`;
                return (
                  <div
                    key={key}
                    className="group/step flex translate-y-0 items-center gap-[0.5em] opacity-100 transition-all"
                    data-done={done ? '' : undefined}
                  >
                    <span
                      className="inline-grid h-[1em] w-[1em] flex-none place-items-center opacity-70"
                      aria-hidden="true"
                    >
                      {done ? (
                        <HugeiconsIcon icon={Tick02Icon} size="1em" strokeWidth={2.5} className="text-emerald-600" />
                      ) : (
                        <i className="block h-[0.4em] w-[0.4em] rounded-full bg-cyan-500 [animation:thought-line-pulse_1.6s_cubic-bezier(0.77,0,0.175,1)_infinite]" />
                      )}
                    </span>
                    <span className="transition-opacity text-slate-700 group-data-[done]/step:text-slate-500 font-sans text-xs">
                      {text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ThoughtLine;
