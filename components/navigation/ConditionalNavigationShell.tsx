"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/app/_components/Navbar";

export function ConditionalNavigationShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isCustomNavbarPage = pathname === "/" || pathname === "/privacy" || pathname === "/dashboard" || pathname === "/consult";

  return (
    <>
      {!isCustomNavbarPage && <Navbar />}
      {children}
    </>
  );
}
