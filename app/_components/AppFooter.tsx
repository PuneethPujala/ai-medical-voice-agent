"use client";

import React from "react";
import Link from "next/link";
import { PhoneCall } from "lucide-react";

export function AppFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative w-full mt-auto text-slate-400 text-xs">
      {/* MAIN FOOTER BODY */}
      <div className="w-full bg-slate-950 border-t border-slate-800/80 px-4 sm:px-8 pt-10 pb-8">
        <div className="mx-auto max-w-6xl flex flex-col gap-10">
          
          {/* Main Grid: Brand statement + Real application navigation columns */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-8 lg:gap-10">
            {/* Brand Column (Span 2) */}
            <div className="col-span-2 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)] animate-pulse" />
                <span className="font-extrabold text-white tracking-wider text-sm">MEDVOICE</span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
                Clinical intelligence for safer patient intake and care navigation. Investigational decision support for preliminary triage and documentation.
              </p>

              {/* Direct Emergency Helpline Action */}
              <div className="flex items-center gap-2.5 mt-1">
                <a
                  href="tel:108"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/40 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  <PhoneCall className="w-3 h-3 text-rose-400" />
                  <span>Ambulance: 108</span>
                </a>
                <a
                  href="tel:112"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-800 text-[11px] font-semibold transition-colors cursor-pointer"
                >
                  <span>Emergency: 112</span>
                </a>
              </div>
            </div>

            {/* Column 1: Clinical (Verified routes) */}
            <div className="col-span-1 flex flex-col gap-3">
              <h3 className="text-xs font-bold text-white tracking-wide">
                Clinical
              </h3>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link href="/consult" className="hover:text-cyan-400 transition-colors">
                    Voice Consult
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard" className="hover:text-cyan-400 transition-colors">
                    SOAP Records
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="hover:text-cyan-400 transition-colors">
                    Care Network
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="hover:text-cyan-400 transition-colors">
                    Safety & Triage
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 2: Care Network (Verified routes) */}
            <div className="col-span-1 flex flex-col gap-3">
              <h3 className="text-xs font-bold text-white tracking-wide">
                Care Network
              </h3>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link href="/care" className="hover:text-cyan-400 transition-colors">
                    Find Facilities
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="hover:text-cyan-400 transition-colors">
                    Emergency Routing
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="hover:text-cyan-400 transition-colors">
                    Specialist Discovery
                  </Link>
                </li>
                <li>
                  <Link href="/care" className="hover:text-cyan-400 transition-colors">
                    Drive Time & Maps
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 3: Privacy & Support (Verified routes & actions) */}
            <div className="col-span-1 flex flex-col gap-3">
              <h3 className="text-xs font-bold text-white tracking-wide">
                Support & Privacy
              </h3>
              <ul className="space-y-2 text-xs">
                <li>
                  <Link href="/privacy" className="hover:text-cyan-400 transition-colors">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="hover:text-cyan-400 transition-colors">
                    Security Safeguards
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="hover:text-cyan-400 transition-colors">
                    Data Protection
                  </Link>
                </li>
                <li>
                  <a href="tel:108" className="text-rose-400 hover:text-rose-300 transition-colors font-medium">
                    Ambulance (108)
                  </a>
                </li>
              </ul>
            </div>

          </div>

          {/* Divider */}
          <div className="w-full h-px bg-slate-800/80" />

          {/* Bottom Bar: Operational Status & Legal Disclaimer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[11px] font-mono text-slate-500">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span className="text-slate-400">MEDVOICE AI</span>
              <span className="text-slate-700">·</span>
              <span>© {currentYear} MedVoice. All rights reserved.</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-slate-400 font-sans">
                Investigational Decision Support
              </span>
              <span className="text-slate-700">·</span>
              <span className="text-amber-400/90 font-medium font-sans text-xs">
                In acute emergency dial 108 / 112
              </span>
            </div>
          </div>

        </div>
      </div>
    </footer>
  );
}
