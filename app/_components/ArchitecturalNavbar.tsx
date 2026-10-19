"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser, useClerk } from "@clerk/nextjs";
import {
  Mic,
  Activity,
  Menu,
  X,
  ArrowRight,
  ShieldCheck,
  Building2,
  FileText,
  User,
  LogOut,
  ChevronRight
} from "lucide-react";

interface NavLink {
  href: string;
  label: string;
  badge?: string;
}

const NAV_LINKS: NavLink[] = [
  { href: "/consult", label: "Consult Room", badge: "Live" },
  { href: "/dashboard", label: "SOAP Charting" },
  { href: "/care", label: "Care Network" },
  { href: "/privacy", label: "Safety & Logic" },
];

export function ArchitecturalNavbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { isSignedIn, isLoaded, user } = useUser();
  const { signOut } = useClerk();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 15);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-200 border-b ${
          scrolled
            ? "bg-white/90 backdrop-blur-xl border-slate-200/90 shadow-[0_2px_12px_-2px_rgba(15,23,42,0.06)]"
            : "bg-white/70 backdrop-blur-md border-slate-200/60"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* Brand Identity: Understated Clinical Elegance */}
            <Link href="/" className="flex items-center gap-2.5 group shrink-0 whitespace-nowrap">
              <div className="w-7 h-7 rounded-lg bg-slate-950 flex items-center justify-center text-teal-400 group-hover:scale-105 transition-transform">
                <Mic className="w-3.5 h-3.5 text-teal-400" />
              </div>
              <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="font-bold text-slate-950 tracking-tight text-sm font-sans uppercase">
                  MEDVOICE
                </span>
                <span className="text-[11px] font-mono text-slate-400 font-medium hidden sm:inline">
                  / Clinical AI
                </span>
              </div>
            </Link>

            {/* Desktop Navigation Links: Clean Understated Inline Nav */}
            <nav className="hidden lg:flex items-center gap-5 xl:gap-7">
              {NAV_LINKS.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`relative text-xs font-medium transition-colors py-1 ${
                      isActive
                        ? "text-slate-950 font-bold"
                        : "text-slate-600 hover:text-slate-950"
                    }`}
                  >
                    <span>{link.label}</span>
                    {link.badge && (
                      <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[9px] font-mono font-bold bg-teal-50 text-teal-700 border border-teal-200">
                        {link.badge}
                      </span>
                    )}
                    {isActive && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-600 rounded-full" />
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Right Action Cluster: Emergency Indicator + Proportionate Consultation CTA */}
            <div className="hidden lg:flex items-center gap-3">
              <div className="hidden xl:flex items-center gap-1.5 text-xs font-mono text-slate-500 pr-3 border-r border-slate-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-[11px]">Emergency Hotline: 108 / 112</span>
              </div>

              {isLoaded && isSignedIn ? (
                <div className="flex items-center gap-2">
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-800 hover:bg-slate-200 text-xs font-medium transition-colors"
                  >
                    <User className="w-3.5 h-3.5 text-slate-600" />
                    <span>{user?.firstName || "Account"}</span>
                  </Link>
                  <button
                    onClick={() => signOut({ redirectUrl: "/" })}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Sign Out"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <Link
                  href="/consult"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#18251D] hover:bg-[#223529] border border-[#18251D] hover:border-[#B7FF72]/40 text-white text-xs font-semibold shadow-xs hover:shadow-[0_0_12px_rgba(183,255,114,0.22)] active:scale-98 transition-all cursor-pointer"
                >
                  <Mic className="w-3 h-3 text-[#B7FF72]" />
                  <span>Launch Consult</span>
                </Link>
              )}
            </div>

            {/* Mobile / Tablet Menu Trigger */}
            <div className="flex lg:hidden items-center gap-2">
              <Link
                href="/consult"
                className="px-2.5 py-1.5 rounded-md bg-[#18251D] border border-[#18251D] text-white text-xs font-semibold inline-flex items-center gap-1"
              >
                <Mic className="w-3 h-3 text-[#B7FF72]" />
                <span>Consult</span>
              </Link>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="p-1.5 rounded-md text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Toggle navigation menu"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>

          </div>
        </div>
      </header>

      {/* Mobile / Tablet Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden bg-slate-950/30 backdrop-blur-xs pt-16">
          <div className="bg-white border-b border-slate-200 px-4 py-5 space-y-4 shadow-xl">
            <nav className="space-y-1">
              {NAV_LINKS.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-slate-100 text-slate-950 font-bold"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <span>{link.label}</span>
                    {link.badge ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-teal-50 text-teal-700 border border-teal-200">
                        {link.badge}
                      </span>
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Emergency Hotline: 108 / 112
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
