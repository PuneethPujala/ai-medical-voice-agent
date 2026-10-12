"use client";

import React from "react";
import { Activity, ShieldCheck, CheckCircle2, ArrowUpRight, Lock, Radio } from "lucide-react";
import CursorGrid from "@/components/CursorGrid";

export function Footer({ showPayoffBanner = false }: { showPayoffBanner?: boolean }) {
  return (
    <footer className="relative w-full text-slate-400 text-xs overflow-hidden">
      {/* Optional Marketing Payoff Banner */}
      {showPayoffBanner && (
        <div className="relative border-b border-slate-800 bg-[#0B0F17] py-24 sm:py-32 px-6 text-center overflow-hidden">
          {/* Interactive CursorGrid Background */}
          <div className="absolute inset-0 z-0">
            <CursorGrid
              cellSize={70}
              colors={["#00F0FF", "#3B82F6", "#8B5CF6", "#D946EF"]}
              radius={140}
              falloff="smooth"
              holdTime={400}
              fadeDuration={800}
              lineWidth={1.2}
              maxOpacity={1}
              fillOpacity={0.08}
              gridOpacity={0}
              cellRadius={0}
              clickPulse
              pulseSpeed={600}
            />
          </div>

          <div className="relative z-10 max-w-3xl mx-auto space-y-6 pointer-events-none">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-400">
              LISTEN · UNDERSTAND · ACT
            </span>
            <h2 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
              Start a Voice Consultation
            </h2>
            <p className="text-base sm:text-lg text-slate-300 max-w-xl mx-auto font-normal leading-relaxed">
              Experience instant medical voice triage, continuous ICD-10 extraction, and automated SOAP clinical documentation.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <a
                href="/consult"
                className="pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white px-7 py-3.5 text-sm font-bold shadow-lg transition-all cursor-pointer"
              >
                <span>Launch Voice Consult Room →</span>
              </a>
              <a
                href="/care"
                className="pointer-events-auto inline-flex items-center gap-2 text-slate-300 hover:text-white px-5 py-3 text-sm font-semibold transition-all cursor-pointer"
              >
                <span>Explore Care Network</span>
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-950 w-full">
        <div className="mx-auto max-w-7xl px-6 pt-10 pb-10">
        {/* Main Footer Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pb-10 border-b border-slate-800/80">
          {/* Brand Column (6 cols) */}
          <div className="md:col-span-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-sky-400/30 bg-white shadow-sm">
                <img src="/images/medvoice-logo.png" alt="MedVoice AI" className="h-full w-full object-cover scale-110" />
              </div>
              <span className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                MedVoice
                <span className="font-mono text-xs font-bold text-slate-300 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-md">
                  AI
                </span>
              </span>
            </div>

            <p className="text-slate-400 text-xs leading-relaxed max-w-md font-sans">
              Deliver instant, empathetic medical assistance through natural voice conversations. Automating symptom triage, appointment scheduling, and EHR SOAP charting 24/7.
            </p>

            {/* Live System Status Pill */}
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 border border-slate-800 px-3 py-1.5 text-xs text-slate-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="font-mono text-[11px] text-emerald-400 font-bold tracking-tight">
                FASTAPI & VOICE ENGINE OPERATIONAL
              </span>
            </div>
          </div>

          {/* Platform & Navigation Links (3 cols) */}
          <div className="md:col-span-3 space-y-3">
            <span className="font-bold text-white text-xs block uppercase tracking-wider font-mono">
              Platform Features
            </span>
            <ul className="space-y-2 text-slate-400 font-medium">
              <li>
                <a href="/demo" className="hover:text-white transition-colors flex items-center gap-1">
                  Voice Simulator Playground <ArrowUpRight className="h-3 w-3 text-slate-500" />
                </a>
              </li>
              <li>
                <a href="/#capabilities" className="hover:text-white transition-colors">
                  Real-Time Voice Triage
                </a>
              </li>
              <li>
                <a href="/#capabilities" className="hover:text-white transition-colors">
                  ICD-10 NLP Symptom Mining
                </a>
              </li>
              <li>
                <a href="/" className="hover:text-white transition-colors">
                  Automated SOAP Note Generator
                </a>
              </li>
            </ul>
          </div>

          {/* Architecture & Security Links (3 cols) */}
          <div className="md:col-span-3 space-y-3">
            <span className="font-bold text-white text-xs block uppercase tracking-wider font-mono">
              Architecture & Security
            </span>
            <ul className="space-y-2 text-slate-400 font-medium">
              <li>
                <a href="/#how-it-works" className="hover:text-white transition-colors">
                  5-Step Clinical Workflow
                </a>
              </li>
              <li>
                <a href="/privacy" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-teal-400" /> Technical Safeguards Architecture
                </a>
              </li>
              <li>
                <a href="/privacy" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-blue-400" /> TLS 1.3 & Zero-Retention
                </a>
              </li>
              <li>
                <a href="/privacy" className="hover:text-white transition-colors flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> FHIR Standard Compatibility
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar: Copyright & Clinical Disclaimer */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-500 text-[11px] font-sans">
          <p>© {new Date().getFullYear()} MedVoice AI. All rights reserved.</p>
          <p className="text-slate-400 max-w-xl text-center sm:text-right italic">
            Notice: MedVoice AI is designed as a clinical decision support and triage assistant. In the event of a medical emergency, patients should always contact 911 immediately.
          </p>
        </div>
      </div>
    </div>
  </footer>
);
}
