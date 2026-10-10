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
  Activity,
  Stethoscope,
  Building2,
  FileText,
  Lock,
  User,
  Sparkles,
  ChevronRight,
  Clock,
  Bookmark,
  Mic,
  Bell,
} from "lucide-react";
import { PillNav } from "@/components/motion/PillNav";

interface NavLinkItem {
  href: string;
  label: string;
  alt: string;
}

const NAV_LINKS: NavLinkItem[] = [
  { href: "/", label: "Home", alt: "OVERVIEW" },
  { href: "/consult", label: "Consult", alt: "DELIBERATION" },
  { href: "/dashboard", label: "SOAP", alt: "CHARTS" },
  { href: "/care", label: "Care", alt: "HOSPITALS" },
  { href: "/admin", label: "Admin", alt: "GOVERNANCE" },
  { href: "/privacy", label: "Privacy", alt: "SECURITY" },
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

  // Focus first item when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      const timer = setTimeout(() => {
        const items = menuItemRefs.current.filter(Boolean);
        items[0]?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [dropdownOpen]);

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

  return (
    <>
      {/* ============================================================ Floating Architectural Clinical Header */}
      <header className="sticky top-0 z-50 w-full pt-5 sm:pt-6 pb-2 px-4 sm:px-8 pointer-events-none transition-all duration-300">
        <div
          className="mx-auto flex h-[64px] sm:h-[68px] max-w-[1360px] items-center justify-between px-6 sm:px-8 rounded-2xl pointer-events-auto transition-all"
          style={{
            background: "rgba(255, 255, 255, 0.76)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255, 255, 255, 0.85)",
            boxShadow: "0 10px 35px rgba(40, 70, 100, 0.06)",
          }}
        >
          
          {/* Group 1: Brand Identity Anchor */}
          <div className="flex items-center min-w-[200px]">
            <Link href="/" className="flex items-center gap-2.5 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-xl">
              {/* 34px clinical icon with subtle pulse waveform */}
              <div className="w-[34px] h-[34px] rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center text-white shadow-[0_2px_8px_rgba(6,182,212,0.25)] flex-shrink-0 group-hover:scale-105 transition-transform">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-white stroke-[2.2]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 13h3.5l2.5-6 3.5 12 3-8 2 4h3.5" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-[15px] font-black tracking-tight text-slate-950 uppercase leading-none">
                  MEDVOICE
                </span>
                <span className="font-mono text-[9px] font-bold text-cyan-600 tracking-[0.2em] uppercase mt-1">
                  CLINICAL INTELLIGENCE
                </span>
              </div>
            </Link>
          </div>

          {/* Group 2: Centered Navigation (Substantial separation from logo & action) */}
          <div className="hidden md:flex items-center justify-center flex-1">
            <PillNav items={NAV_LINKS.filter((item) => (item.href === "/admin" ? user?.publicMetadata?.role === "admin" : true))} />
          </div>

          {/* Group 3: Right Action Area */}
          <div className="flex items-center justify-end min-w-[200px] gap-3">
            {mounted && isLoaded ? (
              isSignedIn ? (
                /* Polished Signed-in User Capsule with Floating HUD Dropdown */
                <div className="relative" ref={dropdownRef}>
                  <button
                    ref={accountButtonRef}
                    id="clinical-account-trigger"
                    aria-haspopup="menu"
                    aria-expanded={dropdownOpen}
                    aria-controls="clinical-account-menu"
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    onKeyDown={handleTriggerKeyDown}
                    className="inline-flex items-center gap-2.5 rounded-full border border-slate-200/90 bg-white/95 backdrop-blur-md px-3.5 py-1.5 text-xs font-bold text-slate-900 shadow-xs transition-all hover:bg-slate-50 hover:border-cyan-400 hover:shadow-sm cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                  >
                    <div className="relative flex-shrink-0">
                      {user?.imageUrl ? (
                        <img
                          src={user.imageUrl}
                          alt={userName}
                          className="h-6 w-6 rounded-full object-cover border border-slate-300"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-slate-900 text-white font-bold text-[10px] flex items-center justify-center">
                          {userInitials}
                        </div>
                      )}
                      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 border border-white shadow-[0_0_6px_#10b981]" />
                    </div>
                    <span className="max-w-[120px] truncate text-xs font-bold text-slate-900 group-hover:text-cyan-900">
                      {userName}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 text-slate-400 group-hover:text-slate-700 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  {/* FLOATING CLINICAL WORKSPACE HUD DROPDOWN */}
                  {dropdownOpen && (
                    <div
                      id="clinical-account-menu"
                      role="menu"
                      aria-labelledby="clinical-account-trigger"
                      aria-orientation="vertical"
                      onKeyDown={handleMenuKeyDown}
                      className="absolute right-0 top-full mt-2.5 w-84 sm:w-88 rounded-2xl bg-white/98 backdrop-blur-2xl border border-slate-200/90 shadow-2xl p-4 flex flex-col gap-3.5 z-50 animate-in fade-in zoom-in-95 duration-150"
                    >
                      {/* Physician Profile Header Card */}
                      <div className="flex items-center gap-3 pb-3 border-b border-slate-200/80">
                        {user?.imageUrl ? (
                          <img
                            src={user.imageUrl}
                            alt={userName}
                            className="h-11 w-11 rounded-xl object-cover border border-slate-200 shadow-2xs flex-shrink-0"
                          />
                        ) : (
                          <div className="h-11 w-11 rounded-xl bg-slate-950 text-white font-black text-sm flex items-center justify-center shadow-2xs flex-shrink-0">
                            {userInitials}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-slate-950 text-sm truncate">
                              {userName}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 font-mono truncate">
                            {user?.primaryEmailAddress?.emailAddress || "physician@hospital.org"}
                          </p>
                          <div className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200/80 text-[10px] font-bold text-emerald-800">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981] animate-pulse" />
                            <span>Level 1 Triage Access · Active Session</span>
                          </div>
                        </div>
                      </div>

                      {/* Security & Workspace Status Summary */}
                      <div className="p-2.5 rounded-xl bg-slate-50/90 border border-slate-200/70 text-xs flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 font-medium">Session Status:</span>
                          <span className="font-mono font-bold text-emerald-700">RBAC AUTHENTICATED</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 font-medium">Data Retention:</span>
                          <span className="font-mono font-semibold text-cyan-800">Zero Audio Storage</span>
                        </div>
                      </div>

                      {/* Group 1: Clinical Workspace */}
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400 px-1">
                          Clinical Workspace
                        </span>
                        
                        <Link
                          href="/consult"
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[0] = el; }}
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 text-xs font-semibold text-slate-800 transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus:bg-slate-100"
                        >
                          <div className="flex items-center gap-2">
                            <Stethoscope className="w-4 h-4 text-cyan-600" />
                            <span>Voice Consultation</span>
                          </div>
                          <span className="text-[10px] font-mono text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded border border-cyan-200 font-bold">
                            16kHz Audio
                          </span>
                        </Link>

                        <Link
                          href="/profile"
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[1] = el; }}
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 text-xs font-semibold text-slate-800 transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus:bg-slate-100"
                        >
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-teal-600" />
                            <span>Patient Profile & History</span>
                          </div>
                          <span className="text-[10px] font-mono text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200 font-bold">
                            Context Aware
                          </span>
                        </Link>

                        <Link
                          href="/dashboard"
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[2] = el; }}
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 text-xs font-semibold text-slate-800 transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus:bg-slate-100"
                        >
                          <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-indigo-600" />
                            <span>SOAP Charts & History</span>
                          </div>
                          <span className="text-[10px] font-mono text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 font-bold">
                            HL7 FHIR Live
                          </span>
                        </Link>
                      </div>

                      {/* Group 2: Care & Security */}
                      <div className="flex flex-col gap-1 pt-1 border-t border-slate-200/80">
                        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400 px-1">
                          Care & Security
                        </span>

                        <Link
                          href="/care"
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[3] = el; }}
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 text-xs font-semibold text-slate-800 transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus:bg-slate-100"
                        >
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-emerald-600" />
                            <span>Hospital Routing (ABDM)</span>
                          </div>
                          <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-bold">
                            ED / Cath Lab
                          </span>
                        </Link>

                        <Link
                          href="/privacy"
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[4] = el; }}
                          onClick={() => setDropdownOpen(false)}
                          className="flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-slate-100 text-xs font-semibold text-slate-800 transition-colors group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus:bg-slate-100"
                        >
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-slate-600" />
                            <span>Privacy & Technical Safeguards</span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded font-bold">
                            Zero Retention
                          </span>
                        </Link>

                        {user?.publicMetadata?.role === "admin" && (
                          <Link
                            href="/admin"
                            role="menuitem"
                            tabIndex={-1}
                            ref={(el) => { menuItemRefs.current[5] = el; }}
                            onClick={() => setDropdownOpen(false)}
                            className="flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-purple-50 text-xs font-semibold text-purple-900 transition-colors group cursor-pointer bg-purple-50/50 border border-purple-200/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus:bg-purple-100"
                          >
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="w-4 h-4 text-purple-600" />
                              <span className="font-bold">Governance & Audit</span>
                            </div>
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                              Admin
                            </span>
                          </Link>
                        )}
                      </div>

                      {/* Group 3: Account Actions */}
                      <div className="pt-2 border-t border-slate-200/80">
                        <button
                          role="menuitem"
                          tabIndex={-1}
                          ref={(el) => { menuItemRefs.current[6] = el; }}
                          onClick={() => {
                            setDropdownOpen(false);
                            signOut({ redirectUrl: "/" });
                          }}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-rose-50/80 hover:bg-rose-100 text-rose-700 border border-rose-200/80 text-xs font-bold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                        >
                          <LogOut className="w-3.5 h-3.5 text-rose-600" />
                          <span>Sign Out of Clinical Session</span>
                        </button>
                      </div>

                    </div>
                  )}
                </div>
              ) : (
                /* Signed-out Sign In Button - Compact, architectural outlined action */
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

      {/* ============================================================ Slide-out Personal Clinical Workspace Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop Blur Overlay - Soft background Aurora remains visible through */}
          <div
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-slate-950/35 backdrop-blur-md transition-opacity duration-300 animate-in fade-in cursor-pointer"
          />

          {/* Drawer Panel: Personal Clinical Workspace */}
          <aside className="relative z-50 flex h-full w-full max-w-[390px] sm:max-w-[400px] flex-col justify-between overflow-y-auto bg-[#FAFCFF]/96 backdrop-blur-2xl p-5 sm:p-6 shadow-2xl border-l border-slate-200/90 transition-transform duration-300 animate-in slide-in-from-right">
            <div className="flex flex-col gap-5">
              
              {/* 1. Header */}
              <div className="flex items-center justify-between pb-3.5 border-b border-slate-200/80">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl overflow-hidden border border-cyan-400/80 shadow-[0_0_10px_rgba(6,182,212,0.18)] bg-white flex items-center justify-center shrink-0">
                    <img
                      src="/images/medvoice-logo.png"
                      alt="MedVoice AI"
                      className="w-full h-full object-cover scale-110"
                    />
                  </div>
                  <div>
                    <div className="font-extrabold text-sm text-slate-950 leading-tight tracking-wide">
                      MEDVOICE AI
                    </div>
                    <div className="text-[9px] font-bold text-cyan-700 tracking-[0.22em] uppercase">
                      MY WORKSPACE
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close Workspace"
                  className="w-9 h-9 rounded-full bg-white/90 border border-slate-200/80 shadow-2xs hover:border-cyan-300 hover:rotate-90 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-all duration-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* 2. Hero Profile Identity Card (1 Prominent Surface) */}
              <div
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setSpotlightPos({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                    opacity: 1,
                  });
                }}
                onMouseLeave={() => setSpotlightPos((prev) => ({ ...prev, opacity: 0 }))}
                className="relative overflow-hidden group rounded-2xl border border-cyan-100/90 bg-[#F0F7FB]/95 p-5 shadow-2xs flex flex-col items-center text-center transition-all"
              >
                {/* Understated spotlight sweep */}
                <div
                  className="pointer-events-none absolute -inset-px rounded-2xl transition-opacity duration-300"
                  style={{
                    opacity: spotlightPos.opacity,
                    background: `radial-gradient(220px circle at ${spotlightPos.x}px ${spotlightPos.y}px, rgba(255, 255, 255, 0.7), transparent 80%)`,
                  }}
                />

                {mounted && isLoaded && isSignedIn ? (
                  <>
                    <div className="relative z-10">
                      {user?.imageUrl ? (
                        <div className="relative inline-block">
                          <img
                            src={user.imageUrl}
                            alt={userName}
                            className="h-16 w-16 rounded-2xl object-cover border-2 border-white shadow-xs mx-auto ring-2 ring-cyan-400/40"
                          />
                          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow-[0_0_6px_#10b981]" />
                        </div>
                      ) : (
                        <div className="relative inline-block">
                          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white font-extrabold text-base border-2 border-cyan-400/60 shadow-xs mx-auto">
                            {userInitials}
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow-[0_0_6px_#10b981]" />
                        </div>
                      )}
                    </div>

                    <div className="mt-3 relative z-10">
                      <div className="font-extrabold text-base text-slate-950 tracking-tight leading-tight">
                        {userName}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-0.5">
                        {user?.primaryEmailAddress?.emailAddress || "physician@medvoice.ai"}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col items-center gap-1 relative z-10">
                      <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-emerald-500/10 backdrop-blur-xs border border-emerald-400/30 text-emerald-800 text-[10px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>Clinical Account Active</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        Level 1 · Triage Access
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-3 relative z-10 w-full">
                    <div className="w-12 h-12 rounded-2xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-600">
                      <User className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-slate-900">Clinical Account Access</div>
                      <p className="text-xs text-slate-500 mt-1 max-w-[240px]">
                        Sign in to access your personal triage history and clinical consultations.
                      </p>
                    </div>
                    <Link
                      href="/sign-in"
                      onClick={() => setDrawerOpen(false)}
                      className="w-full py-2.5 bg-slate-950 hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs mt-1"
                    >
                      <span>Sign In with Clinical Credentials</span>
                      <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />
                    </Link>
                  </div>
                )}
              </div>

              {/* 3. QUICK ACTIONS */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">
                  QUICK ACTIONS
                </span>

                <div className="flex flex-col gap-2">
                  {/* Prominent CTA Surface */}
                  <Link
                    href="/consult"
                    onClick={() => setDrawerOpen(false)}
                    className="p-3.5 rounded-2xl bg-slate-950 hover:bg-slate-900 text-white shadow-xs hover:shadow-cyan-500/10 border border-slate-800 hover:border-cyan-400/50 transition-all flex items-center justify-between group cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div className="text-left">
                        <div className="text-xs font-bold text-white group-hover:text-cyan-200 transition-colors">
                          Start New Consultation
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Begin a fresh intake
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-cyan-400 group-hover:translate-x-1 transition-transform" />
                  </Link>

                  {/* Simple unboxed rows */}
                  <div className="flex flex-col gap-1 pt-1">
                    <Link
                      href="/profile"
                      onClick={() => setDrawerOpen(false)}
                      className="flex items-center justify-between p-2.5 rounded-xl text-slate-700 hover:text-slate-950 hover:bg-slate-100/70 transition-all group"
                    >
                      <div className="flex items-center gap-2.5">
                        <User className="w-4 h-4 text-teal-600 transition-colors" />
                        <span className="text-xs font-medium">Patient Health Profile</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 group-hover:translate-x-0.5 transition-all" />
                    </Link>

                    <Link
                      href="/dashboard"
                      onClick={() => setDrawerOpen(false)}
                      className="flex items-center justify-between p-2.5 rounded-xl text-slate-700 hover:text-slate-950 hover:bg-slate-100/70 transition-all group"
                    >
                      <div className="flex items-center gap-2.5">
                        <Clock className="w-4 h-4 text-slate-400 group-hover:text-cyan-600 transition-colors" />
                        <span className="text-xs font-medium">Consultation History</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 group-hover:translate-x-0.5 transition-all" />
                    </Link>

                    <Link
                      href="/dashboard"
                      onClick={() => setDrawerOpen(false)}
                      className="flex items-center justify-between p-2.5 rounded-xl text-slate-700 hover:text-slate-950 hover:bg-slate-100/70 transition-all group"
                    >
                      <div className="flex items-center gap-2.5">
                        <Bookmark className="w-4 h-4 text-slate-400 group-hover:text-cyan-600 transition-colors" />
                        <span className="text-xs font-medium">Saved Clinical Insights</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 group-hover:translate-x-0.5 transition-all" />
                    </Link>
                  </div>
                </div>
              </div>

              {/* 4. SYSTEM */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 px-1">
                  SYSTEM
                </span>

                <div className="flex flex-col gap-0.5 pt-1">
                  <div className="flex items-center justify-between p-2 rounded-xl text-slate-600 hover:bg-slate-100/50 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <Mic className="w-4 h-4 text-slate-400" />
                      <span className="text-xs font-medium text-slate-700">Voice & Audio</span>
                    </div>
                    <span className="text-[10px] font-mono font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                      Ready
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-xl text-slate-600 hover:bg-slate-100/50 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <Bell className="w-4 h-4 text-slate-400" />
                      <span className="text-xs font-medium text-slate-700">Clinical Alerts</span>
                    </div>
                    <span className="text-[10px] font-mono font-medium text-emerald-800 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-md">
                      Enabled
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-xl text-slate-600 hover:bg-slate-100/50 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="w-4 h-4 text-slate-400" />
                      <span className="text-xs font-medium text-slate-700">Privacy & Data</span>
                    </div>
                    <span className="text-[10px] font-mono font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                      Protected
                    </span>
                  </div>
                </div>
              </div>

              {/* 5. Quiet Sign Out */}
              {mounted && isLoaded && isSignedIn && (
                <div className="pt-2 border-t border-slate-200/70">
                  <button
                    onClick={() => {
                      setDrawerOpen(false);
                      signOut({ redirectUrl: "/" });
                    }}
                    className="w-full flex items-center justify-between p-2 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50/50 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 text-xs font-medium">
                      <LogOut className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-600 transition-colors" />
                      <span>Sign out</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-rose-500 group-hover:translate-x-0.5 transition-all" />
                  </button>
                </div>
              )}

            </div>

            {/* 6. Calm Footer Anchored to Bottom */}
            <div className="mt-auto pt-4 border-t border-slate-200/70 text-center flex flex-col gap-0.5">
              <span className="text-[11px] font-bold text-slate-800 tracking-wider">
                MEDVOICE AI V2.4
              </span>
              <span className="text-[10px] text-slate-400 font-normal">
                Clinical voice intelligence
              </span>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

