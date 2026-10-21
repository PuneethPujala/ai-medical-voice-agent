"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Building2,
  Navigation,
  Clock,
  CheckCircle2,
  PhoneCall,
  ArrowRight,
  ShieldAlert,
  Activity
} from "lucide-react";

export interface RegionalHub {
  city: string;
  center: string;
  specialty: string;
  distance: string;
  eta: string;
  capabilities: string[];
}

export const REGIONAL_HUBS: RegionalHub[] = [
  {
    city: "Vijayawada",
    center: "Manipal Hospital / Trauma & Emergency Center",
    specialty: "Comprehensive 24/7 STEMI Cath Lab & Polytrauma Resuscitation",
    distance: "8.4 km",
    eta: "~16 min drive",
    capabilities: ["24/7 Level-1 Trauma", "Emergency Cath Lab", "Pediatric ICU"],
  },
  {
    city: "Guntur",
    center: "NRI General & Emergency Medical Center",
    specialty: "Acute Stroke & Neurological Intervention Center",
    distance: "12.8 km",
    eta: "~22 min drive",
    capabilities: ["Comprehensive Stroke Center", "Rapid CT/MRI Protocol", "Interventional Radiology"],
  },
  {
    city: "Visakhapatnam",
    center: "Apollo Hospitals Emergency & Heart Institute",
    specialty: "Critical Cardiac Resuscitation & Emergency Surgery",
    distance: "5.6 km",
    eta: "~11 min drive",
    capabilities: ["Primary PCI Ready", "Cardiovascular ICU", "Helipad Access"],
  },
  {
    city: "Hyderabad",
    center: "Yashoda Emergency & Critical Care Center",
    specialty: "Advanced Polytrauma & Quaternary Intensive Care",
    distance: "14.2 km",
    eta: "~26 min drive",
    capabilities: ["Level-1 Trauma Certified", "Burn Care Unit", "Extracorporeal Membrane Oxygenation (ECMO)"],
  },
];

export function CareNetworkCommand() {
  const [selectedCity, setSelectedCity] = useState<string>("Vijayawada");
  const activeHub = REGIONAL_HUBS.find((h) => h.city === selectedCity) || REGIONAL_HUBS[0];

  return (
    <section id="care" className="py-20 sm:py-28 bg-white border-b border-slate-200/80 relative overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        
        {/* Header & Link to Full Map */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-800 font-mono text-xs font-semibold uppercase tracking-wider">
              <span>REGIONAL REACHABILITY & CARE ROUTING · REPRESENTATIVE DATA</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-slate-950 leading-[1.15]">
              Regional hospital coordination with{" "}
              <span className="text-teal-600">canonical road travel times.</span>
            </h2>
            <p className="text-base sm:text-lg text-slate-600 leading-relaxed font-normal">
              Representative emergency centers filtered by medical capabilities. Distance and drive times calculated via canonical road routing (OSRM) rather than straight-line approximations.
            </p>
          </div>

          <Link
            href="/care"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#18251D] hover:bg-[#223529] border border-[#18251D] hover:border-[#B7FF72]/40 text-white px-6 py-3.5 text-sm font-bold shadow-xs hover:shadow-[0_0_20px_rgba(183,255,114,0.18)] active:scale-[0.98] transition-all cursor-pointer shrink-0"
          >
            <Navigation className="w-4 h-4 text-[#B7FF72]" />
            <span>Open Full Interactive Map →</span>
          </Link>
        </div>

        {/* City Switcher & Hospital Capability Slate */}
        <div className="rounded-2xl sm:rounded-3xl border border-slate-200/90 bg-slate-50/70 p-6 sm:p-8 shadow-[0_16px_40px_-10px_rgba(15,23,42,0.06)] space-y-6">
          
          {/* City Tab Selectors */}
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Regional Hospital Hubs">
            {REGIONAL_HUBS.map((hub) => {
              const isActive = hub.city === selectedCity;
              return (
                <button
                  key={hub.city}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setSelectedCity(hub.city)}
                  className={`px-4 py-2 rounded-xl font-mono text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? "bg-slate-950 text-white shadow-xs"
                      : "bg-white text-slate-700 hover:bg-slate-200/80 border border-slate-200"
                  }`}
                >
                  {hub.city}
                </button>
              );
            })}
          </div>

          {/* Active Facility Card */}
          <div className="rounded-2xl bg-white border border-slate-200 p-6 sm:p-8 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-teal-700 font-bold mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>VERIFIED EMERGENCY FACILITY</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-slate-950">
                  {activeHub.center}
                </h3>
                <p className="text-sm text-slate-600 font-medium mt-0.5">
                  {activeHub.specialty}
                </p>
              </div>

              {/* Distance and ETA Capsule */}
              <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 p-3 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs shrink-0">
                <div className="flex items-center gap-1.5 text-slate-900 font-bold">
                  <Navigation className="w-3.5 h-3.5 text-teal-600" />
                  <span>{activeHub.distance}</span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>{activeHub.eta}</span>
                </div>
              </div>
            </div>

            {/* Verified Capabilities Tags */}
            <div className="space-y-2">
              <span className="text-xs font-mono uppercase text-slate-400 tracking-wider">
                Accredited Clinical Capabilities
              </span>
              <div className="flex flex-wrap gap-2">
                {activeHub.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-100 border border-slate-200/80 text-xs font-mono font-medium text-slate-800"
                  >
                    <Activity className="w-3 h-3 text-teal-600" />
                    <span>{cap}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
