"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "@/app/_components/Navbar";

export function ConditionalNavigationShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHomePage = pathname === "/";

  return (
    <>
      {!isHomePage && <Navbar />}
      {children}
    </>
  );
}
