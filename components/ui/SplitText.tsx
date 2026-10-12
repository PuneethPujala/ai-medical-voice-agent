'use client';

import React, { useRef, useEffect, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText as GSAPSplitText } from 'gsap/dist/SplitText';
import { useGSAP } from '@gsap/react';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, GSAPSplitText, useGSAP);
}

export interface SplitTextProps {
  text: string;
  className?: string;
  delay?: number;
  duration?: number;
  ease?: string | ((t: number) => number);
  splitType?: 'chars' | 'words' | 'lines' | 'words, chars';
  from?: gsap.TweenVars;
  to?: gsap.TweenVars;
  threshold?: number;
  rootMargin?: string;
  tag?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span';
  textAlign?: React.CSSProperties['textAlign'];
  onLetterAnimationComplete?: () => void;
}

export const SplitText: React.FC<SplitTextProps> = ({
  text,
  className = '',
  delay = 35,
  duration = 0.9,
  ease = 'power3.out',
  splitType = 'words',
  from = { opacity: 0, y: 24 },
  to = { opacity: 1, y: 0 },
  threshold = 0.15,
  rootMargin = '-50px',
  tag = 'h2',
  textAlign = 'left',
  onLetterAnimationComplete
}) => {
  const ref = useRef<HTMLHeadingElement | HTMLParagraphElement>(null);
  const animationCompletedRef = useRef(false);
  const onCompleteRef = useRef(onLetterAnimationComplete);
  const [fontsLoaded, setFontsLoaded] = useState<boolean>(false);

  useEffect(() => {
    onCompleteRef.current = onLetterAnimationComplete;
  }, [onLetterAnimationComplete]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (document.fonts?.status === 'loaded') {
        setFontsLoaded(true);
      } else if (document.fonts?.ready) {
        document.fonts.ready.then(() => {
          setFontsLoaded(true);
        });
      } else {
        setFontsLoaded(true);
      }
    }
  }, []);

  useGSAP(
    () => {
      if (!ref.current || !text || !fontsLoaded) return;
      if (animationCompletedRef.current) return;

      const prefersReduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (prefersReduced) {
        ref.current.style.opacity = '1';
        return;
      }

      const el = ref.current as HTMLElement & {
        _rbsplitInstance?: GSAPSplitText;
      };

      if (el._rbsplitInstance) {
        try {
          el._rbsplitInstance.revert();
        } catch (_) {}
        el._rbsplitInstance = undefined;
      }

      const startPct = (1 - threshold) * 100;
      const marginMatch = /^(-?\d+(?:\\.\\d+)?)(px|em|rem|%)?$/.exec(rootMargin);
      const marginValue = marginMatch ? parseFloat(marginMatch[1]) : 0;
      const marginUnit = marginMatch ? marginMatch[2] || 'px' : 'px';
      const sign =
        marginValue === 0
          ? ''
          : marginValue < 0
            ? `-=${Math.abs(marginValue)}${marginUnit}`
            : `+=${marginValue}${marginUnit}`;
      const start = `top ${startPct}%${sign}`;

      let targets: Element[] = [];
      const assignTargets = (self: GSAPSplitText) => {
        if (splitType.includes('chars') && self.chars?.length) targets = self.chars;
        if (!targets.length && splitType.includes('words') && self.words?.length) targets = self.words;
        if (!targets.length && splitType.includes('lines') && self.lines?.length) targets = self.lines;
        if (!targets.length) targets = self.chars || self.words || self.lines || [];
      };

      let safetyTimer: ReturnType<typeof setTimeout> | undefined;

      try {
        const inView = el.getBoundingClientRect().top < (window.innerHeight || 800) + 50;

        const splitInstance = new GSAPSplitText(el, {
          type: splitType,
          smartWrap: true,
          autoSplit: splitType === 'lines',
          linesClass: 'split-line',
          wordsClass: 'split-word',
          charsClass: 'split-char',
          reduceWhiteSpace: false,
          onSplit: (self: GSAPSplitText) => {
            assignTargets(self);

            safetyTimer = setTimeout(() => {
              if (!animationCompletedRef.current && el) {
                gsap.set(targets.length ? targets : el, { opacity: 1, y: 0, clearProps: 'transform' });
                animationCompletedRef.current = true;
              }
            }, Math.max(500, (duration + 0.3) * 1000));

            const animVars: gsap.TweenVars = {
              ...to,
              duration,
              ease,
              stagger: delay / 1000,
              onComplete: () => {
                animationCompletedRef.current = true;
                if (safetyTimer) clearTimeout(safetyTimer);
                onCompleteRef.current?.();
              },
              willChange: 'transform, opacity',
              force3D: true
            };

            if (!inView) {
              animVars.scrollTrigger = {
                trigger: el,
                start,
                once: true,
                fastScrollEnd: true,
                anticipatePin: 0.4
              };
            }

            return gsap.fromTo(targets, { ...from }, animVars);
          }
        });
        el._rbsplitInstance = splitInstance;
      } catch (err) {
        // Fallback for environments where SplitText DOM manipulation is prevented
        gsap.fromTo(el, { ...from }, { ...to, duration, ease });
        animationCompletedRef.current = true;
      }

      return () => {
        if (safetyTimer) clearTimeout(safetyTimer);
        ScrollTrigger.getAll().forEach(st => {
          if (st.trigger === el) st.kill();
        });
        try {
          el._rbsplitInstance?.revert();
        } catch (_) {}
        el._rbsplitInstance = undefined;
      };
    },
    {
      dependencies: [
        text,
        delay,
        duration,
        ease,
        splitType,
        JSON.stringify(from),
        JSON.stringify(to),
        threshold,
        rootMargin,
        fontsLoaded
      ],
      scope: ref
    }
  );

  const style: React.CSSProperties = {
    textAlign,
    wordWrap: 'break-word',
    willChange: 'transform, opacity'
  };
  const classes = `split-parent whitespace-normal ${className}`;
  const Tag = tag || 'h2';

  return React.createElement(
    Tag,
    {
      ref,
      style,
      className: classes
    },
    text
  );
};

export default SplitText;
