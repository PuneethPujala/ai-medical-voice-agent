"use client";

import React from "react";
import Link from "next/link";
import { PhoneCall } from "lucide-react";

export function AppFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative w-full mt-auto text-slate-600 text-xs overflow-hidden">
      {/* Subtle Ambient Light Gradient Underlay */}
      <div className="absolute inset-0 bg-gradient-to-r from-cyan-50/40 via-blue-50/25 to-indigo-50/30 pointer-events-none" />

      {/* MAIN FOOTER BODY */}
      <div className="relative z-10 w-full bg-white/90 backdrop-blur-xl border-t border-slate-200/90 px-4 sm:px-8 pt-12 pb-10">
        <div className="mx-auto max-w-6xl flex flex-col gap-10">
          
          {/* Main Grid: Brand statement + Real application navigation columns */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-8 lg:gap-10">
            {/* Brand Column (Span 2) */}
            <div className="col-span-2 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.6)] animate-pulse" />
                <span className="font-extrabold text-slate-950 tracking-wider text-sm uppercase">MEDVOICE</span>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed max-w-sm">
                Clinical intelligence for safer patient intake and care navigation. Investigational decision support for preliminary triage and documentation.
              </p>

              {/* Direct Emergency Helpline Action */}
              <div className="flex items-center gap-2.5 mt-1">
                <a
                  href="tel:108"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs"
                >
                  <PhoneCall className="w-3 h-3 text-rose-600" />
                  <span>Ambulance: 108</span>
                </a>
                <a
                  href="tel:112"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs"
                >
                  <span>Emergency: 112</span>
                </a>
              </div>
            </div>

            {/* Column 1: Clinical (Verified routes) */}
            <div className="col-span-1 flex flex-col gap-3">
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-slate-950">
                Clinical
              </h3>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link href="/consult" className="text-slate-600 hover:text-cyan-700 transition-colors">
                    Voice Consult
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard" className="text-slate-600 hover:text-cyan-700 transition-colors">
                    SOAP Records
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="text-slate-600 hover:text-cyan-700 transition-colors">
                    Care Network
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-slate-600 hover:text-cyan-700 transition-colors">
                    Safety & Triage
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 2: Care Network (Verified routes) */}
            <div className="col-span-1 flex flex-col gap-3">
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-slate-950">
                Care Network
              </h3>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link href="/care" className="text-slate-600 hover:text-cyan-700 transition-colors">
                    Find Facilities
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="text-slate-600 hover:text-cyan-700 transition-colors">
                    Emergency Routing
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="text-slate-600 hover:text-cyan-700 transition-colors">
                    Specialist Discovery
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="text-slate-600 hover:text-cyan-700 transition-colors">
                    Drive Time & Maps
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 3: Privacy & Support (Verified routes & actions) */}
            <div className="col-span-1 flex flex-col gap-3">
              <h3 className="text-xs font-bold font-mono uppercase tracking-wider text-slate-950">
                Support & Privacy
              </h3>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link href="/privacy" className="text-slate-600 hover:text-cyan-700 transition-colors">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-slate-600 hover:text-cyan-700 transition-colors">
                    Security Safeguards
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-slate-600 hover:text-cyan-700 transition-colors">
                    Data Protection
                  </Link>
                </li>
                <li>
                  <a href="tel:108" className="text-rose-600 hover:text-rose-700 transition-colors font-semibold">
                    Ambulance (108)
                  </a>
                </li>
              </ul>
            </div>

          </div>

          {/* Divider */}
          <div className="w-full h-px bg-slate-200/90" />

          {/* Bottom Bar: Operational Status & Legal Disclaimer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[11px] font-mono text-slate-500">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
              <span className="text-slate-800 font-semibold">MEDVOICE AI</span>
              <span className="text-slate-300">·</span>
              <span>© {currentYear} MedVoice. All rights reserved.</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-slate-600 font-sans">
                Investigational Decision Support
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-amber-700 font-medium font-sans text-xs">
                In acute emergency dial 108 / 112
              </span>
            </div>
          </div>

        </div>
      </div>
    </footer>
  );
}
