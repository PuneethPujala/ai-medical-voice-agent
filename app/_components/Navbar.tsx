"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser, useClerk } from "@clerk/nextjs";
import {
  ArrowRight,
  ShieldCheck,
  X,
  LogOut,
  ChevronDown,
  Stethoscope,
  Building2,
  FileText,
  User,
  Sparkles,
  ChevronRight,
  Clock,
  Bookmark,
  Mic,
  Home,
} from "lucide-react";
import { GooeyNav, type GooeyNavItem } from "@/components/GooeyNav";

const NAV_LINKS: GooeyNavItem[] = [
  { href: "/", label: "Home" },
  { href: "/consult", label: "Consult" },
  { href: "/dashboard", label: "SOAP" },
  { href: "/care", label: "Care" },
  { href: "/privacy", label: "Privacy" },
];

export function Navbar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [spotlightPos, setSpotlightPos] = useState({ x: 0, y: 0, opacity: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<(HTMLAnchorElement | HTMLButtonElement | null)[]>([]);
  const { isSignedIn, isLoaded, user } = useUser();
  const { signOut } = useClerk();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close drawer and dropdown on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        if (dropdownOpen) {
          setDropdownOpen(false);
          accountButtonRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dropdownOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);



  // Lock body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setDropdownOpen(true);
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = menuItemRefs.current.filter(Boolean) as (HTMLAnchorElement | HTMLButtonElement)[];
    if (items.length === 0) return;

    const currentIndex = items.findIndex((el) => el === document.activeElement);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = currentIndex === -1 || currentIndex === items.length - 1 ? 0 : currentIndex + 1;
      items[nextIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      items[prevIndex]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDropdownOpen(false);
      accountButtonRef.current?.focus();
    } else if (e.key === "Tab") {
      setDropdownOpen(false);
    }
  };

  const userName =
    user?.fullName ||
    (user?.firstName
      ? `${user.firstName}${user.lastName ? " " + user.lastName : ""}`
      : "") ||
    "Physician";

  const userInitials =
    userName
      .split(" ")
      .map((n) => n[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "ME";

  const isHome = pathname === "/";

  return (
    <>
      {/* ============================================================ Floating Architectural Clinical Header */}
      <header className={`${isHome ? "fixed" : "sticky"} top-0 left-0 right-0 z-50 w-full pt-3 sm:pt-5 pb-2 px-3 sm:px-8 pointer-events-none transition-all duration-300`}>
        <div
          className="mx-auto flex h-[58px] sm:h-[64px] max-w-[1360px] items-center justify-between px-3.5 sm:px-8 rounded-2xl pointer-events-auto transition-all"
          style={{
            background: "rgba(255, 255, 255, 0.96)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(226, 232, 240, 0.9)",
            boxShadow: "0 10px 35px rgba(0, 0, 0, 0.12)",
          }}
        >
          
          {/* Group 1: Brand Identity Anchor */}
          <div className="flex items-center min-w-0 sm:min-w-[180px] shrink-0">
            <Link href="/" className="flex items-center gap-2 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-xl">
              {/* 34px clinical icon with subtle waveform */}
              <div className="w-[32px] sm:w-[34px] h-[32px] sm:h-[34px] rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center text-white shadow-[0_2px_8px_rgba(6,182,212,0.25)] shrink-0 group-hover:scale-105 transition-transform">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-white stroke-[2.2]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 13h3.5l2.5-6 3.5 12 3-8 2 4h3.5" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-[14px] sm:text-[15px] font-black tracking-tight text-slate-950 uppercase leading-none">
                  MEDVOICE
                </span>
                <span className="font-mono text-[8.5px] sm:text-[9px] font-bold text-cyan-600 tracking-[0.2em] uppercase mt-1">
                  CLINICAL INTELLIGENCE
                </span>
              </div>
            </Link>
          </div>

          {/* Group 2: Centered Primary Navigation with Official React Bits GooeyNav (Clinical White-First Track) */}
          <div className="hidden md:flex items-center justify-center flex-1">
            <div className="rounded-full bg-white px-1.5 py-1 border border-slate-200/90 shadow-[0_2px_10px_rgba(15,23,42,0.04)]">
              <GooeyNav
                items={NAV_LINKS}
                particleCount={12}
                particleDistances={[38, 8]}
                particleR={60}
                animationTime={500}
                timeVariance={200}
                colors={[1, 2, 3, 1, 2, 3, 1, 4]}
              />
            </div>
          </div>

          {/* Group 3: Right Action Area / Clinical HUD Account Menu */}
          <div className="flex items-center justify-end min-w-0 sm:min-w-[180px] gap-2 sm:gap-3 shrink-0">
            {mounted && isLoaded ? (
              isSignedIn ? (
                /* Polished Clinical Account Capsule */
                <div className="relative" ref={dropdownRef}>
                  <button
                    ref={accountButtonRef}
                    id="clinical-account-trigger"
                    aria-haspopup="menu"
                    aria-expanded={dropdownOpen}
                    aria-controls="clinical-account-menu"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    onKeyDown={handleTriggerKeyDown}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/95 backdrop-blur-md px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs transition-all hover:bg-slate-50 hover:border-cyan-400/80 cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                  >
                    <div className="relative shrink-0">
                      {user?.imageUrl ? (
                        <img
                          src={user.imageUrl}
                          alt={userName}
                          className="h-6 w-6 rounded-full object-cover border border-slate-200"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-slate-900 text-white font-bold text-[10px] flex items-center justify-center">
                          {userInitials}
                        </div>
                      )}
                      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border border-white" />
                    </div>
                    <span className="max-w-[110px] truncate text-xs font-semibold text-slate-800 group-hover:text-slate-950">
                      {userName}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  {/* PREMIUM CLINICAL WORKSPACE HUD DROPDOWN PANEL */}
                  {dropdownOpen && (
                    <div
                      id="clinical-account-menu"
                      role="menu"
                      aria-labelledby="clinical-account-trigger"
                      aria-orientation="vertical"
                      onKeyDown={handleMenuKeyDown}
                      className="absolute right-0 top-full mt-2.5 w-72 sm:w-80 rounded-2xl bg-white/98 backdrop-blur-2xl border border-slate-200/90 shadow-2xl p-3 flex flex-col gap-2 z-50 animate-in fade-in zoom-in-95 duration-150"
                    >
                      {/* Physician Profile Header */}
                      <div className="flex items-center gap-3 p-2 border-b border-slate-100">
                        {user?.imageUrl ? (
                          <img
                            src={user.imageUrl}
                            alt={userName}
                            className="h-10 w-10 rounded-full object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0">
                            {userInitials}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-slate-950 text-sm truncate leading-snug">
                            {userName}
                          </p>
                          <p className="text-xs text-slate-500 font-mono truncate">
                            {user?.primaryEmailAddress?.emailAddress || "physician@hospital.org"}
                          </p>
                        </div>
                      </div>

                      {/* Group 1: Clinical workspace */}
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1">
                          Clinical workspace
                        </span>
                        
                        <Link
                          href="/consult"
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[0] = el; }}
                          onClick={() => setDropdownOpen(false)}
                          aria-current={pathname === "/consult" ? "page" : undefined}
                          className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                            pathname === "/consult"
                              ? "bg-cyan-50/90 text-cyan-950 font-bold border border-cyan-200/90 shadow-2xs"
                              : "text-slate-700 hover:text-slate-950 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Stethoscope className={`w-4 h-4 shrink-0 ${pathname === "/consult" ? "text-cyan-700" : "text-cyan-600"}`} />
                            <span className="truncate">Voice Consultation</span>
                          </div>
                          {pathname === "/consult" && (
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-600 shadow-[0_0_6px_rgba(6,182,212,0.8)] shrink-0" />
                          )}
                        </Link>

                        <Link
                          href="/profile"
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[1] = el; }}
                          onClick={() => setDropdownOpen(false)}
                          aria-current={pathname === "/profile" ? "page" : undefined}
                          className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                            pathname === "/profile"
                              ? "bg-teal-50/90 text-teal-950 font-bold border border-teal-200/90 shadow-2xs"
                              : "text-slate-700 hover:text-slate-950 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <User className={`w-4 h-4 shrink-0 ${pathname === "/profile" ? "text-teal-700" : "text-teal-600"}`} />
                            <span className="truncate">Patient Profile & History</span>
                          </div>
                          {pathname === "/profile" && (
                            <span className="w-1.5 h-1.5 rounded-full bg-teal-600 shadow-[0_0_6px_rgba(20,184,166,0.8)] shrink-0" />
                          )}
                        </Link>

                        <Link
                          href="/dashboard"
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[2] = el; }}
                          onClick={() => setDropdownOpen(false)}
                          aria-current={pathname === "/dashboard" ? "page" : undefined}
                          className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                            pathname === "/dashboard"
                              ? "bg-indigo-50/90 text-indigo-950 font-bold border border-indigo-200/90 shadow-2xs"
                              : "text-slate-700 hover:text-slate-950 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileText className={`w-4 h-4 shrink-0 ${pathname === "/dashboard" ? "text-indigo-700" : "text-indigo-600"}`} />
                            <span className="truncate">SOAP Charts & History</span>
                          </div>
                          {pathname === "/dashboard" && (
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shadow-[0_0_6px_rgba(99,102,241,0.8)] shrink-0" />
                          )}
                        </Link>
                      </div>

                      {/* Group 2: Care and security */}
                      <div className="flex flex-col gap-0.5 pt-1 border-t border-slate-100">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1">
                          Care and security
                        </span>

                        <Link
                          href="/care"
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[3] = el; }}
                          onClick={() => setDropdownOpen(false)}
                          aria-current={pathname === "/care" ? "page" : undefined}
                          className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                            pathname === "/care"
                              ? "bg-emerald-50/90 text-emerald-950 font-bold border border-emerald-200/90 shadow-2xs"
                              : "text-slate-700 hover:text-slate-950 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Building2 className={`w-4 h-4 shrink-0 ${pathname === "/care" ? "text-emerald-700" : "text-emerald-600"}`} />
                            <span className="truncate">Hospital Routing</span>
                          </div>
                          {pathname === "/care" && (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shadow-[0_0_6px_rgba(16,185,129,0.8)] shrink-0" />
                          )}
                        </Link>

                        <Link
                          href="/privacy"
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[4] = el; }}
                          onClick={() => setDropdownOpen(false)}
                          aria-current={pathname === "/privacy" ? "page" : undefined}
                          className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                            pathname === "/privacy"
                              ? "bg-slate-100 text-slate-950 font-bold border border-slate-300/80 shadow-2xs"
                              : "text-slate-700 hover:text-slate-950 hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <ShieldCheck className={`w-4 h-4 shrink-0 ${pathname === "/privacy" ? "text-slate-800" : "text-slate-600"}`} />
                            <span className="truncate">Privacy & Technical Safeguards</span>
                          </div>
                          {pathname === "/privacy" && (
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-700 shrink-0" />
                          )}
                        </Link>

                        {user?.publicMetadata?.role === "admin" && (
                          <Link
                            href="/admin"
                            role="menuitem"
                            tabIndex={-1}
                            ref={(el) => { menuItemRefs.current[5] = el; }}
                            onClick={() => setDropdownOpen(false)}
                            aria-current={pathname === "/admin" ? "page" : undefined}
                            className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-all group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 ${
                              pathname === "/admin"
                                ? "bg-purple-50 text-purple-950 font-bold border border-purple-200/90 shadow-2xs"
                                : "text-slate-700 hover:text-slate-950 hover:bg-purple-50/50"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <ShieldCheck className={`w-4 h-4 shrink-0 ${pathname === "/admin" ? "text-purple-700" : "text-purple-600"}`} />
                              <span className="truncate">Governance & Audit</span>
                            </div>
                            {pathname === "/admin" && (
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-600 shrink-0" />
                            )}
                          </Link>
                        )}
                      </div>

                      {/* Group 3: Account */}
                      <div className="pt-1 border-t border-slate-100">
                        <button
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[6] = el; }}
                          onClick={() => {
                            setDropdownOpen(false);
                            signOut({ redirectUrl: "/" });
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-rose-50 text-rose-700 text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                        >
                          <LogOut className="w-4 h-4 text-rose-500 shrink-0" />
                          <span>Sign Out</span>
                        </button>
                      </div>

                    </div>
                  )}
                </div>
              ) : (
                /* Signed-out Sign In Button */
                <Link
                  href="/sign-in"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/80 hover:bg-white hover:border-cyan-400/80 px-3.5 py-1.5 text-xs font-semibold text-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.03)] transition-all cursor-pointer group"
                >
                  <span>Sign in</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-cyan-600 group-hover:translate-x-0.5 transition-all" />
                </Link>
              )
            ) : (
              <div className="h-8 w-24 bg-slate-200/70 rounded-xl animate-pulse" />
            )}

            {/* Mobile Menu Trigger (strictly hidden on desktop) */}
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Menu"
              className="inline-flex md:hidden w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200/80 flex-col justify-center items-center gap-1 cursor-pointer transition-colors border border-slate-200/80"
            >
              <span className="block h-[1.5px] bg-slate-700 rounded-full w-4" />
              <span className="block h-[1.5px] bg-slate-700 rounded-full w-4" />
            </button>
          </div>

        </div>
      </header>

      {/* ============================================================ Mobile Navigation Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop Blur Overlay */}
          <div
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-slate-950/35 backdrop-blur-md transition-opacity duration-300 animate-in fade-in cursor-pointer"
          />

          {/* Drawer Panel */}
          <aside className="relative z-50 flex h-full w-full max-w-[360px] flex-col justify-between overflow-y-auto bg-[#FAFCFF]/98 backdrop-blur-2xl p-5 shadow-2xl border-l border-slate-200/90 transition-transform duration-300 animate-in slide-in-from-right">
            <div className="flex flex-col gap-4">
              
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-200/80">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center text-white shadow-2xs shrink-0">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-white stroke-[2.2]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 13h3.5l2.5-6 3.5 12 3-8 2 4h3.5" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-extrabold text-sm text-slate-950 leading-tight">
                      MEDVOICE
                    </div>
                    <div className="text-[9px] font-bold text-cyan-700 tracking-[0.2em] uppercase">
                      CLINICAL AI
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close Navigation"
                  className="w-8 h-8 rounded-full bg-white border border-slate-200 shadow-2xs hover:border-cyan-300 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* User Profile Card */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
                {mounted && isLoaded && isSignedIn ? (
                  <div className="flex items-center gap-3">
                    {user?.imageUrl ? (
                      <img
                        src={user.imageUrl}
                        alt={userName}
                        className="h-10 w-10 rounded-full object-cover border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white font-bold text-xs">
                        {userInitials}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-slate-950 truncate">
                        {userName}
                      </div>
                      <div className="text-xs text-slate-500 font-mono truncate">
                        {user?.primaryEmailAddress?.emailAddress || "physician@hospital.org"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    <div className="text-xs font-semibold text-slate-700">Clinical Account</div>
                    <Link
                      href="/sign-in"
                      onClick={() => setDrawerOpen(false)}
                      className="w-full py-2 bg-slate-950 hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs"
                    >
                      <span>Sign In</span>
                      <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
                    </Link>
                  </div>
                )}
              </div>

              {/* Primary Navigation Links */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 py-0.5">
                  Navigation
                </span>

                {NAV_LINKS.map((item) => {
                  const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setDrawerOpen(false)}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                        isActive
                          ? "bg-cyan-50 text-cyan-900 border border-cyan-200/80 font-bold"
                          : "text-slate-700 hover:text-slate-950 hover:bg-slate-100/70"
                      }`}
                    >
                      <span>{item.label}</span>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </Link>
                  );
                })}
              </div>

              {/* Clinical Workspace Shortcuts */}
              <div className="flex flex-col gap-1 pt-1 border-t border-slate-200/80">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 py-0.5">
                  Workspace
                </span>

                <Link
                  href="/consult"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-700 hover:text-slate-950 hover:bg-slate-100/70 transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <Stethoscope className="w-4 h-4 text-cyan-600" />
                    <span>Voice Consultation</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </Link>

                <Link
                  href="/profile"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-700 hover:text-slate-950 hover:bg-slate-100/70 transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <User className="w-4 h-4 text-teal-600" />
                    <span>Patient Health Profile</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </Link>

                <Link
                  href="/dashboard"
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-700 hover:text-slate-950 hover:bg-slate-100/70 transition-all"
                >
                  <div className="flex items-center gap-2.5">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    <span>SOAP Charts & History</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </Link>
              </div>

              {/* Sign Out */}
              {mounted && isLoaded && isSignedIn && (
                <div className="pt-2 border-t border-slate-200/80">
                  <button
                    onClick={() => {
                      setDrawerOpen(false);
                      signOut({ redirectUrl: "/" });
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-slate-600 hover:text-rose-600 hover:bg-rose-50/60 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <LogOut className="w-3.5 h-3.5 text-slate-400" />
                      <span>Sign out</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
                  </button>
                </div>
              )}

            </div>

            {/* Drawer Footer */}
            <div className="mt-auto pt-4 border-t border-slate-200/70 text-center flex flex-col gap-0.5">
              <span className="text-[11px] font-bold text-slate-800 tracking-wider">
                MEDVOICE CLINICAL AI
              </span>
              <span className="text-[10px] text-slate-400">
                Real-time medical voice assistance
              </span>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

export default Navbar;
