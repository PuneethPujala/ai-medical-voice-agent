'use client';

import React, { useEffect, useRef, useMemo, type ReactNode, type RefObject } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

interface ScrollRevealProps {
  children: ReactNode;
  scrollContainerRef?: RefObject<HTMLElement>;
  enableBlur?: boolean;
  baseOpacity?: number;
  baseRotation?: number;
  blurStrength?: number;
  containerClassName?: string;
  textClassName?: string;
  rotationEnd?: string;
  wordAnimationEnd?: string;
}

const ScrollReveal: React.FC<ScrollRevealProps> = ({
  children,
  scrollContainerRef,
  enableBlur = true,
  baseOpacity = 0.1,
  baseRotation = 3,
  blurStrength = 4,
  containerClassName = '',
  textClassName = '',
  rotationEnd = 'bottom bottom',
  wordAnimationEnd = 'bottom bottom'
}) => {
  const containerRef = useRef<HTMLHeadingElement>(null);

  const splitText = useMemo(() => {
    if (typeof children === 'string') {
      return children.split(/(\s+)/).map((word, index) => {
        if (word.match(/^\s+$/)) return word;
        return (
          <span className="inline-block word" key={index}>
            {word}
          </span>
        );
      });
    }

    return React.Children.map(children, (child, index) => {
      if (typeof child === 'string') {
        return child.split(/(\s+)/).map((word, wIdx) => {
          if (word.match(/^\s+$/)) return word;
          return (
            <span className="inline-block word" key={`${index}-${wIdx}`}>
              {word}
            </span>
          );
        });
      }
      if (React.isValidElement(child)) {
        return (
          <span className="inline-block word" key={index}>
            {child}
          </span>
        );
      }
      return child;
    });
  }, [children]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.set(el, { rotate: 0 });
      const wordElements = el.querySelectorAll<HTMLElement>('.word');
      gsap.set(wordElements, { opacity: 1, filter: 'none' });
      return;
    }

    const scroller = scrollContainerRef && scrollContainerRef.current ? scrollContainerRef.current : window;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { transformOrigin: '0% 50%', rotate: baseRotation },
        {
          ease: 'none',
          rotate: 0,
          scrollTrigger: {
            trigger: el,
            scroller,
            start: 'top bottom',
            end: rotationEnd,
            scrub: true
          }
        }
      );

      const wordElements = el.querySelectorAll<HTMLElement>('.word');

      gsap.fromTo(
        wordElements,
        { opacity: baseOpacity, willChange: 'opacity' },
        {
          ease: 'none',
          opacity: 1,
          stagger: 0.05,
          scrollTrigger: {
            trigger: el,
            scroller,
            start: 'top bottom-=20%',
            end: wordAnimationEnd,
            scrub: true
          }
        }
      );

      if (enableBlur) {
        gsap.fromTo(
          wordElements,
          { filter: `blur(${blurStrength}px)` },
          {
            ease: 'none',
            filter: 'blur(0px)',
            stagger: 0.05,
            scrollTrigger: {
              trigger: el,
              scroller,
              start: 'top bottom-=20%',
              end: wordAnimationEnd,
              scrub: true
            }
          }
        );
      }
    }, containerRef);

    return () => {
      ctx.revert();
    };
  }, [scrollContainerRef, enableBlur, baseRotation, baseOpacity, rotationEnd, wordAnimationEnd, blurStrength]);

  return (
    <h2 ref={containerRef} className={`my-4 ${containerClassName}`}>
      <span className={`block ${textClassName || 'text-[clamp(1.6rem,4vw,3rem)] leading-[1.5] font-semibold'}`}>{splitText}</span>
    </h2>
  );
};

export default ScrollReveal;
