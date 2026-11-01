"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldAlert,
  ShieldCheck,
  HeartPulse,
  Pill,
  AlertTriangle,
  Activity,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight,
  UserCheck,
  HelpCircle,
} from "lucide-react";
import type { CategorizedClinicalFacts } from "@/app/api/patient/longitudinal-facts/route";
import type { LongitudinalPatientFact } from "@/lib/patient/longitudinal-fact-types";

interface ProfileSummary {
  profileId?: string;
  name?: string;
  knownConditions?: string[];
  currentMedications?: string[];
  drugAllergies?: string[];
  allergyStatus?: string;
  smokingStatus?: string;
  consentGiven?: boolean;
  consentTimestamp?: string;
}

export function LongitudinalSidebar() {
  const [factsData, setFactsData] = useState<{
    facts: LongitudinalPatientFact[];
    categorized: CategorizedClinicalFacts;
    profileSummary: ProfileSummary | null;
    consentNotice: boolean;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function fetchLongitudinalFacts() {
      setIsLoading(true);
      try {
        const res = await fetch("/api/patient/longitudinal-facts");
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setFactsData({
              facts: data.facts || [],
              categorized: data.categorized || {
                clinicianConfirmed: [],
                patientReported: [],
                confirmedNone: [],
                uncollected: [],
              },
              profileSummary: data.profileSummary || null,
              consentNotice: Boolean(data.consentNotice),
            });
          }
        } else if (res.status === 401) {
          if (isMounted) {
            setError("Sign in to view longitudinal health context");
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError("Unable to load longitudinal health profile");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchLongitudinalFacts();
    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="rounded-3xl bg-white border border-slate-200/80 p-5 space-y-4">
        <div className="flex items-center gap-2 text-slate-400">
          <Activity className="w-4 h-4 animate-spin" />
          <span className="text-xs font-semibold">Loading clinical context...</span>
        </div>
        <div className="space-y-2">
          <div className="h-4 bg-slate-100 rounded-md w-3/4 animate-pulse" />
          <div className="h-4 bg-slate-100 rounded-md w-1/2 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !factsData) {
    return (
      <div className="rounded-3xl bg-slate-50 border border-slate-200/80 p-5 text-center">
        <Activity className="w-6 h-6 text-slate-400 mx-auto mb-2" />
        <p className="text-xs font-medium text-slate-500">{error || "No clinical context available"}</p>
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-xs font-bold text-slate-900 hover:underline mt-2"
        >
          <span>View Profile</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  const { profileSummary, categorized, consentNotice } = factsData;

  return (
    <aside aria-label="Longitudinal Clinical Context" className="space-y-6">
      {/* 1. DPDP Consent & Profile Card */}
      <div className="rounded-3xl bg-white border border-slate-200/90 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold tracking-tight text-slate-900">
              Longitudinal Health Profile
            </span>
          </div>
          <Link
            href="/profile"
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 transition-colors"
          >
            Edit
          </Link>
        </div>

        {consentNotice || !profileSummary?.consentGiven ? (
          <div className="rounded-2xl bg-slate-50 border border-slate-200/90 p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-slate-900">
              <ShieldAlert className="w-4 h-4 text-slate-700 shrink-0" />
              <span className="text-xs font-bold">DPDP Consent Required</span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Longitudinal tracking and cross-consultation continuity require active patient consent under healthcare regulations.
            </p>
            <Link
              href="/profile"
              className="inline-flex items-center gap-1 text-xs font-bold text-[#18251D] hover:text-black underline hover:no-underline pt-1"
            >
              <span>Enable Longitudinal Consent</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11px] text-emerald-800 bg-emerald-50/80 border border-emerald-200/60 px-3 py-1.5 rounded-xl font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>DPDP Consent Active · Private & Protected</span>
          </div>
        )}
      </div>

      {/* 2. Known Conditions & Current Medications */}
      {profileSummary && profileSummary.consentGiven && (
        <div className="rounded-3xl bg-white border border-slate-200/90 p-5 shadow-xs space-y-4">
          {/* Conditions */}
          <div>
            <div className="flex items-center gap-2 text-slate-700 mb-2">
              <HeartPulse className="w-4 h-4 text-rose-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Known Conditions
              </span>
            </div>
            {profileSummary.knownConditions && profileSummary.knownConditions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {profileSummary.knownConditions.map((cond, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200/60"
                  >
                    {cond}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">No chronic conditions recorded</p>
            )}
          </div>

          {/* Current Medications */}
          <div className="pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-slate-700 mb-2">
              <Pill className="w-4 h-4 text-indigo-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Active Medications
              </span>
            </div>
            {profileSummary.currentMedications && profileSummary.currentMedications.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {profileSummary.currentMedications.map((med, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200/60"
                  >
                    {med}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">No regular medications recorded</p>
            )}
          </div>

          {/* Allergies */}
          <div className="pt-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-slate-700 mb-2">
              <AlertTriangle className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Allergy Status
              </span>
            </div>
            {profileSummary.drugAllergies && profileSummary.drugAllergies.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {profileSummary.drugAllergies.map((alg, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200/60"
                  >
                    {alg}
                  </span>
                ))}
              </div>
            ) : profileSummary.allergyStatus === "no_known_allergies" ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/60">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                No Known Drug Allergies (NKDA)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-50 text-slate-600 border border-slate-200/60">
                <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                Status Unassessed
              </span>
            )}
          </div>
        </div>
      )}

      {/* 3. Grounded Clinical Observations */}
      {profileSummary && profileSummary.consentGiven && (
        <div className="rounded-3xl bg-white border border-slate-200/90 p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <Activity className="w-4 h-4 text-emerald-600" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Grounded Observations
            </h4>
          </div>

          {/* Clinician Confirmed Facts */}
          {categorized.clinicianConfirmed.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                Clinician Confirmed
              </span>
              <div className="space-y-1.5">
                {categorized.clinicianConfirmed.map((fact) => (
                  <div
                    key={fact.id}
                    className="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100 text-xs text-emerald-950 flex items-start justify-between gap-2"
                  >
                    <div>
                      <span className="font-semibold block capitalize">
                        {fact.concept.replace(/_/g, " ")}
                      </span>
                      <span className="text-emerald-800 text-[11px]">
                        {fact.reportedValue} {fact.unit || ""}
                      </span>
                    </div>
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded shrink-0">
                      Verified
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Patient Reported Baseline */}
          {categorized.patientReported.length > 0 && (
            <div className="space-y-1.5 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Patient Reported
              </span>
              <div className="space-y-1.5">
                {categorized.patientReported.map((fact) => (
                  <div
                    key={fact.id}
                    className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 text-xs text-slate-800 flex items-start justify-between gap-2"
                  >
                    <div>
                      <span className="font-semibold block capitalize">
                        {fact.concept.replace(/_/g, " ")}
                      </span>
                      <span className="text-slate-600 text-[11px]">
                        {fact.reportedValue} {fact.unit || ""}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 bg-slate-200/70 px-1.5 py-0.5 rounded shrink-0">
                      Reported
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confirmed Negative Findings */}
          {categorized.confirmedNone.length > 0 && (
            <div className="space-y-1.5 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Confirmed Absent / None
              </span>
              <div className="flex flex-wrap gap-1.5">
                {categorized.confirmedNone.map((item, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200/60"
                  >
                    <CheckCircle2 className="w-3 h-3 text-slate-500" />
                    <span>{item.statement}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Uncollected / Unrecorded Domains */}
          {categorized.uncollected.length > 0 && (
            <div className="space-y-1.5 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Uncollected Domains
              </span>
              <div className="space-y-1">
                {categorized.uncollected.map((item, idx) => (
                  <div
                    key={idx}
                    className="text-[11px] text-slate-600 flex items-center gap-1.5"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                    <span>
                      <strong className="font-semibold text-slate-800">{item.domain}:</strong> {item.reason}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
