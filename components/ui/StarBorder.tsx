"use client";

import React, { ElementType, ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./StarBorder.css";

export interface StarBorderProps<T extends ElementType = "button"> {
  as?: T;
  className?: string;
  innerClassName?: string;
  color?: string;
  speed?: string;
  children?: ReactNode;
}

export function StarBorder<T extends ElementType = "button">({
  as,
  className = "",
  innerClassName,
  color = "#06b6d4",
  speed = "5s",
  children,
  ...props
}: StarBorderProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof StarBorderProps<T>>) {
  const Component = as || "button";

  return (
    <Component
      className={cn(
        "relative inline-block py-[1.5px] px-[1.5px] overflow-hidden rounded-2xl group transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30",
        className
      )}
      {...props}
    >
      {/* Top glowing star particle traveling left-to-right along upper border */}
      <div
        className="absolute w-[280%] h-[60%] -top-[12px] -left-[200%] rounded-full z-0 pointer-events-none star-movement-top"
        style={{
          background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
          animationDuration: speed,
        }}
        aria-hidden="true"
      />

      {/* Bottom glowing star particle traveling right-to-left along lower border */}
      <div
        className="absolute w-[280%] h-[60%] -bottom-[12px] -right-[200%] rounded-full z-0 pointer-events-none star-movement-bottom"
        style={{
          background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
          animationDuration: speed,
        }}
        aria-hidden="true"
      />

      {/* Content wrapper - protects legibility and maintains crisp border geometry */}
      <div
        className={cn(
          "relative z-10 w-full h-full rounded-[14.5px] transition-colors",
          innerClassName || "bg-white border border-slate-200/90 shadow-2xs group-hover:border-slate-300"
        )}
      >
        {children}
      </div>
    </Component>
  );
}

export default StarBorder;
