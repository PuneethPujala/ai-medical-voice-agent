"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/app/_components/Navbar";

export function ConditionalNavigationShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up");

  return (
    <>
      {!isAuthRoute && <Navbar />}
      {children}
    </>
  );
}
