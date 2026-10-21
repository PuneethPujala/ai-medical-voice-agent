import React from "react";
import Link from "next/link";
import {
  Mic,
  ArrowRight,
  ShieldCheck,
  Lock,
  Activity,
  Navigation,
  PhoneCall,
  ArrowUpRight,
} from "lucide-react";
import { FaqToFooterTransitionOverlay } from "./FaqToFooterTransitionOverlay";

export interface ArchitecturalBrandLedgerFooterProps {
  className?: string;
  wordmarkRef?: React.Ref<HTMLDivElement>;
}

export function ArchitecturalBrandLedgerFooter({
  className = "",
  wordmarkRef,
}: ArchitecturalBrandLedgerFooterProps) {
  const currentYear = new Date().getFullYear();

  return (
    <footer
      id="brand-footer"
      className={`relative w-full text-slate-900 overflow-x-clip overflow-y-visible ${className}`}
    >
      {/* ===================================================================== */}
      {/* 1. CINEMATIC RIBBON SCENE (Edge-to-Edge User-Supplied Asset on Black)  */}
      {/* ===================================================================== */}

      <section
        id="cta-transition-band"
        className="relative w-full min-h-[640px] sm:min-h-[720px] lg:min-h-[780px] bg-[#05070F] text-white overflow-hidden flex items-center justify-center"
      >
        {/* Full-bleed edge-to-edge cinematic ribbon backdrop (User Reference Image) */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden select-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            id="cinematic-ribbon-bg"
            src="/images/footer/acid-mint-vortex-ribbon.jpg"
            alt="Cinematic Acid Mint flowing ribbon vortex"
            className="w-full h-full object-cover object-center opacity-80 will-change-transform"
          />
          {/* Smooth upper dissolve from Pearl White FAQ canvas into deep black */}
          <div className="absolute inset-x-0 top-0 h-48 sm:h-64 bg-gradient-to-b from-[#FAF9F6] via-[#FAF9F6]/60 via-30% to-transparent pointer-events-none z-10" />
          {/* Smooth lower dissolve into footer */}
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#05070F] via-[#05070F]/50 to-transparent pointer-events-none z-10" />
          {/* Subtle radial focus vignette */}
          <div className="absolute inset-0 bg-radial-[circle_at_center_rgba(5,7,15,0)_40%,#05070F_100%] pointer-events-none z-10 opacity-70" />
        </div>

        {/* Dynamic GSAP Travelling Motifs Overlay (Sweeping along the vortex ribbons) */}
        <FaqToFooterTransitionOverlay />

        {/* Unboxed, Floating Editorial Foreground Content */}
        <div className="relative z-20 w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-32 sm:py-40 text-center space-y-9">

          {/* Eyebrow Pill */}
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-[#B7FF72] font-mono text-xs font-semibold uppercase tracking-widest backdrop-blur-md shadow-lg">
            <span className="w-2 h-2 rounded-full bg-[#B7FF72] shadow-[0_0_10px_#B7FF72] animate-pulse" />
            <span>CLINICAL VOICE EVALUATION · DEMO PIPELINE</span>
          </div>

          {/* Confident Stacked Editorial Headline */}
          <h2 className="text-4xl sm:text-6xl lg:text-7xl xl:text-8xl font-black text-white tracking-tight leading-[1.02] drop-shadow-[0_12px_40px_rgba(0,0,0,0.9)]">
            <span className="block">Experience Continuous</span>
            <span className="block bg-gradient-to-r from-white via-slate-100 to-[#B7FF72] bg-clip-text text-transparent">
              Voice Triage.
            </span>
          </h2>

          {/* Subtitle */}
          <p className="text-base sm:text-lg lg:text-xl text-slate-200 max-w-2xl mx-auto font-normal leading-relaxed drop-shadow-md">
            Launch a live clinical voice consultation session with continuous ICD-10 extraction, deterministic safety overrides, and instant hospital coordination.
          </p>

          {/* Action Buttons: Forest Graphite (#18251D) with Acid Mint (#B7FF72) accents */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-3">
            <Link
              href="/consult"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 rounded-full bg-[#18251D] hover:bg-[#24382c] border border-[#B7FF72]/70 hover:border-[#B7FF72] text-white px-9 py-4 text-sm sm:text-base font-bold shadow-[0_0_30px_rgba(183,255,114,0.3)] hover:shadow-[0_0_45px_rgba(183,255,114,0.5)] active:scale-[0.98] transition-all cursor-pointer group"
            >
              <Mic className="w-5 h-5 text-[#B7FF72] group-hover:scale-110 transition-transform" />
              <span>Launch Voice Consult Room</span>
              <ArrowRight className="w-5 h-5 text-[#B7FF72] group-hover:translate-x-1 transition-transform" />
            </Link>

            <Link
              href="/care"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full text-slate-200 hover:text-white px-8 py-4 text-sm sm:text-base font-semibold transition-all cursor-pointer border border-white/25 hover:border-white/50 bg-white/5 hover:bg-white/10 backdrop-blur-md"
            >
              <Navigation className="w-4 h-4 text-[#B7FF72]" />
              <span>Explore Care Network</span>
            </Link>
          </div>

          {/* Clinical Protocol Guarantees */}
          <div className="pt-6 flex flex-wrap items-center justify-center gap-6 sm:gap-8 text-xs font-mono text-slate-300">
            <span className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#B7FF72]" />
              Deterministic ESI Preemption
            </span>
            <span className="text-white/30 hidden sm:inline">·</span>
            <span className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#B7FF72]" />
              Ephemeral RAM Scrubbing
            </span>
            <span className="text-white/30 hidden sm:inline">·</span>
            <span className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#B7FF72]" />
              Emergency Direct Dial: 108 / 112
            </span>
          </div>
        </div>
      </section>
      {/* ===================================================================== */}
      {/* 2. NAVIGATION AND LEGAL SURFACES (Pearl White #FAF9F6)                */}
      {/* ===================================================================== */}
      <section
        id="footer-nav-legal"
        className="relative w-full bg-[#FAF9F6] border-y border-stone-200/90"
      >
        <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-6 sm:pb-8">
          {/* Navigation Links Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 lg:gap-12 pb-12">

            {/* Column 1: Clinical Applications */}
            <div className="space-y-4">
              <h4 className="font-mono text-xs font-bold uppercase tracking-widest text-slate-500">
                CLINICAL SUITE
              </h4>
              <ul className="space-y-2.5 text-sm font-medium">
                <li>
                  <Link href="/consult" className="text-slate-800 hover:text-slate-950 transition-colors inline-flex items-center gap-1 group">
                    <span>Voice Consult Room</span>
                    <ArrowUpRight className="w-3 h-3 text-slate-400 group-hover:text-slate-950 transition-colors" />
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard" className="text-slate-800 hover:text-slate-950 transition-colors inline-flex items-center gap-1 group">
                    <span>SOAP Records & Notes</span>
                    <ArrowUpRight className="w-3 h-3 text-slate-400 group-hover:text-slate-950 transition-colors" />
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="text-slate-800 hover:text-slate-950 transition-colors inline-flex items-center gap-1 group">
                    <span>Regional Facility Matrix</span>
                    <ArrowUpRight className="w-3 h-3 text-slate-400 group-hover:text-slate-950 transition-colors" />
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-slate-800 hover:text-slate-950 transition-colors inline-flex items-center gap-1 group">
                    <span>Deterministic Arbiter</span>
                    <ArrowUpRight className="w-3 h-3 text-slate-400 group-hover:text-slate-950 transition-colors" />
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 2: Facility Network */}
            <div className="space-y-4">
              <h4 className="font-mono text-xs font-bold uppercase tracking-widest text-slate-500">
                CARE NETWORK
              </h4>
              <ul className="space-y-2.5 text-sm font-medium">
                <li>
                  <Link href="/care" className="text-slate-800 hover:text-slate-950 transition-colors">
                    Emergency Routing (OSRM)
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="text-slate-800 hover:text-slate-950 transition-colors">
                    Level-1 Trauma Hubs
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="text-slate-800 hover:text-slate-950 transition-colors">
                    Cath Lab & STEMI Centers
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="text-slate-800 hover:text-slate-950 transition-colors">
                    Pediatric Urgent Centers
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 3: Safeguards & Protocols */}
            <div className="space-y-4">
              <h4 className="font-mono text-xs font-bold uppercase tracking-widest text-slate-500">
                CLINICAL PROTOCOLS
              </h4>
              <ul className="space-y-2.5 text-sm font-medium">
                <li>
                  <Link href="/privacy" className="text-slate-800 hover:text-slate-950 transition-colors">
                    Transient RAM Buffers
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-slate-800 hover:text-slate-950 transition-colors">
                    ESI v4 Decision Logic
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-slate-800 hover:text-slate-950 transition-colors">
                    HL7 FHIR Interoperability
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-slate-800 hover:text-slate-950 transition-colors">
                    Clinical Governance Model
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 4: Emergency Dispatch Anchors */}
            <div className="space-y-4">
              <h4 className="font-mono text-xs font-bold uppercase tracking-widest text-rose-700">
                EMERGENCY DISPATCH
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li>
                  <a
                    href="tel:108"
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-600 text-white hover:bg-rose-700 transition-colors font-mono text-xs font-bold shadow-sm"
                  >
                    <PhoneCall className="w-3.5 h-3.5 text-white" />
                    <span>AMBULANCE: DIAL 108</span>
                  </a>
                </li>
                <li>
                  <a
                    href="tel:112"
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#18251D] text-white hover:bg-[#24382c] border border-stone-700 hover:border-[#B7FF72]/40 transition-colors font-mono text-xs font-medium shadow-sm"
                  >
                    <span>EMERGENCY: DIAL 112</span>
                  </a>
                </li>
                <li className="pt-1">
                  <span className="text-slate-600 font-mono text-xs block">
                    Women Helpline: 1091
                  </span>
                </li>
                <li>
                  <span className="text-slate-600 font-mono text-xs block">
                    Tele-MANAS: 14416
                  </span>
                </li>
              </ul>
            </div>

          </div>

          {/* Horizon Legal Row */}
          <div className="pt-6 border-t border-stone-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs font-mono text-slate-600">
            <div>
              <span>© {currentYear} MEDVOICE INTELLIGENCE SYSTEMS. ALL RIGHTS RESERVED.</span>
            </div>

            <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-slate-600 font-medium">
              <Link href="/privacy" className="hover:text-slate-950 transition-colors">
                TERMS & PROTOCOLS
              </Link>
              <span>·</span>
              <Link href="/privacy" className="hover:text-slate-950 transition-colors">
                EPHEMERAL PRIVACY
              </Link>
              <span>·</span>
              <span className="text-slate-500">
                INVESTIGATIONAL CLINICAL DECISION SUPPORT
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 3. MONUMENTAL WORDMARK STAGE (Pearl White #FAF9F6 + Acid Mint Shader) */}
      {/* ===================================================================== */}
      <section
        id="monumental-wordmark-stage"
        ref={wordmarkRef}
        className="relative w-full bg-[#FAF9F6] select-none pt-8 pb-6 sm:pt-10 sm:pb-8 md:pt-12 md:pb-10 flex flex-col justify-end overflow-x-clip overflow-y-visible"
      >
        {/* Localized Acid Mint (#B7FF72) Horizon Radial Shader */}
        <div
          id="acid-mint-wordmark-shader"
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-56 sm:h-64 pointer-events-none z-0 transition-opacity duration-700"
          style={{
            background:
              "radial-gradient(ellipse 65% 55% at 50% 90%, rgba(183, 255, 114, 0.38) 0%, rgba(183, 255, 114, 0.12) 45%, rgba(183, 255, 114, 0) 70%)",
          }}
        />

        {/* Constrained layout shell ensuring balanced framing */}
        <div className="relative w-full max-w-[1500px] mx-auto px-4 sm:px-6">

          {/* Monumental Edge-to-Edge Display Type in Ink Black (#05070F) */}
          <div className="w-full text-center tracking-tighter leading-none relative z-10 pb-2 sm:pb-4">
            <span
              id="monumental-wordmark-text"
              style={{
                fontSize: "clamp(38px, 11.5vw, 175px)",
                lineHeight: 0.88,
                display: "inline-block",
                letterSpacing: "-0.04em",
              }}
              className="font-black uppercase text-[#05070F] drop-shadow-[0_15px_30px_rgba(5,7,15,0.12)] select-none whitespace-nowrap"
            >
              MEDVOICE
            </span>
          </div>

        </div>

        {/* Extreme Bottom Horizon Accent in Acid Mint (#B7FF72) */}
        <div className="w-full h-1 bg-gradient-to-r from-transparent via-[#B7FF72]/70 to-transparent" />
      </section>
    </footer>
  );
}
