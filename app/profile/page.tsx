"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  User,
  HeartPulse,
  Pill,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Phone,
  FileText,
  Save,
  RefreshCw,
  Info,
  Calendar,
  Languages,
  Activity,
  ArrowRight,
  Eye,
  Check,
  Stethoscope,
  Smile,
  AlertCircle,
  RefreshCcw,
  Lock,
  ArrowLeft,
  X
} from "lucide-react";
import { ArchitecturalBrandLedgerFooter } from "../_components/ArchitecturalBrandLedgerFooter";
import { PatientProfile, PatientMedication, DrugAllergy } from "@/lib/clinical-knowledge/types";
import { clientProfileCache, isProfileFormDirty } from "@/lib/patient/profile-cache";

const COMMON_CONDITIONS = [
  "Hypertension",
  "Type 2 Diabetes",
  "Asthma",
  "Coronary Artery Disease",
  "GERD / Acid Reflux",
  "Migraine",
  "Hypothyroidism",
  "Chronic Kidney Disease",
  "Hyperlipidemia",
  "Anxiety / Depression"
];

const COMMON_DRUG_ALLERGIES = [
  "Penicillin",
  "Sulfa Drugs / Sulfonamides",
  "Aspirin / NSAIDs",
  "Amoxicillin",
  "Codeine",
  "Cephalosporins"
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi (हिंदी)" },
  { value: "te", label: "Telugu (తెలుగు)" },
  { value: "ta", label: "Tamil (தமிழ்)" },
  { value: "bn", label: "Bengali (বাংলা)" },
  { value: "es", label: "Spanish (Español)" }
];

const EMPTY_PROFILE_TEMPLATE: Partial<PatientProfile> = {
  name: "",
  relationshipToUser: "self",
  language: "en",
  dateOfBirth: "",
  age: undefined,
  sexAssignedAtBirth: undefined,
  gender: undefined,
  bloodGroup: "",
  pregnancyStatus: "not_applicable",
  knownConditions: [],
  currentMedications: [],
  allergyStatus: "unassessed",
  drugAllergies: [],
  surgicalHistory: [],
  smokingStatus: "unknown",
  emergencyContact: { name: "", phone: "", relationship: "" },
  accessibilityPreferences: { communicationStyle: "concise", notes: "" },
  clinicalNotes: ""
};

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse" aria-busy="true" aria-label="Loading profile data">
      {/* Section 1 skeleton */}
      <div className="bg-white border border-[#E5E7EB] rounded-3xl p-6 sm:p-7 shadow-xs flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-slate-200" />
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="h-4 w-36 bg-slate-200 rounded-md" />
            <div className="h-3 w-64 bg-slate-100 rounded-md" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 pt-4 border-t border-[#F1F5F9]">
          <div className="flex flex-col gap-2">
            <div className="h-3 w-20 bg-slate-100 rounded" />
            <div className="h-9 w-full bg-slate-100 rounded-xl" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-3 w-20 bg-slate-100 rounded" />
            <div className="h-9 w-full bg-slate-100 rounded-xl" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-3 w-20 bg-slate-100 rounded" />
            <div className="h-9 w-full bg-slate-100 rounded-xl" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-3 w-20 bg-slate-100 rounded" />
            <div className="h-9 w-full bg-slate-100 rounded-xl" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-3 w-20 bg-slate-100 rounded" />
            <div className="h-9 w-full bg-slate-100 rounded-xl" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-3 w-20 bg-slate-100 rounded" />
            <div className="h-9 w-full bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>

      {/* Section 2 skeleton */}
      <div className="bg-white border border-[#E5E7EB] rounded-3xl p-6 sm:p-7 shadow-xs flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-slate-200" />
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="h-4 w-44 bg-slate-200 rounded-md" />
            <div className="h-3 w-56 bg-slate-100 rounded-md" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-3 border-t border-[#F1F5F9]">
          <div className="h-7 w-24 bg-slate-100 rounded-full" />
          <div className="h-7 w-32 bg-slate-100 rounded-full" />
          <div className="h-7 w-20 bg-slate-100 rounded-full" />
          <div className="h-7 w-28 bg-slate-100 rounded-full" />
        </div>
      </div>

      {/* Section 3 skeleton */}
      <div className="bg-white border border-[#E5E7EB] rounded-3xl p-6 sm:p-7 shadow-xs flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-slate-200" />
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="h-4 w-40 bg-slate-200 rounded-md" />
            <div className="h-3 w-48 bg-slate-100 rounded-md" />
          </div>
        </div>
        <div className="h-10 w-full bg-slate-100 rounded-xl" />
      </div>
    </div>
  );
}

export default function PatientProfilePage() {
  const prefersReducedMotion = useReducedMotion();
  const { user, isLoaded: isUserLoaded } = useUser();
  const userId = user?.id || "guest_session";

  // Data Lifecycle States
  const [loading, setLoading] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // Baselines and Form state (Single-Patient Model)
  const [baselineProfile, setBaselineProfile] = useState<PatientProfile | null>(null);
  const [formData, setFormData] = useState<Partial<PatientProfile>>(EMPTY_PROFILE_TEMPLATE);

  // Collapsible section toggles
  const [sectionsOpen, setSectionsOpen] = useState({
    demographics: true,
    conditions: true,
    medications: true,
    allergies: true,
    history: false,
    emergency: false
  });

  // Section custom inputs
  const [customCondition, setCustomCondition] = useState("");
  const [newMed, setNewMed] = useState({ name: "", dose: "", frequency: "" });
  const [newAllergy, setNewAllergy] = useState({ drugName: "", severity: "moderate" as const, reactionDescription: "" });

  const toggleSection = (key: keyof typeof sectionsOpen) => {
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Determine if form is dirty relative to baseline for self-profile
  const isDirty = useMemo(() => {
    return isProfileFormDirty(baselineProfile, formData);
  }, [baselineProfile, formData]);

  // Load single self-profile data on mount / user change
  useEffect(() => {
    let isMounted = true;

    async function loadSelfProfile() {
      // Check in-memory cache first
      const cachedSelf = clientProfileCache.get(userId, "self");
      if (cachedSelf && isMounted) {
        setFormData({ ...cachedSelf });
        setBaselineProfile(cachedSelf);
        if (cachedSelf.updatedAt) {
          setLastSavedAt(new Date(cachedSelf.updatedAt).toLocaleTimeString());
        }
        setLoading(false);
      } else {
        setLoading(true);
      }

      try {
        const res = await fetch("/api/patient/profile");
        if (!res.ok) {
          throw new Error(`Failed to load profile (${res.status})`);
        }
        const data = await res.json();

        if (isMounted && data.success && data.profile) {
          const profile: PatientProfile = data.profile;
          setBaselineProfile(profile);
          clientProfileCache.set(userId, "self", profile);

          // If no local pending draft, update form data
          const localDraft = clientProfileCache.getDraft(userId, "self");
          if (localDraft) {
            setFormData({ ...localDraft });
          } else {
            setFormData({ ...profile });
          }

          if (profile.updatedAt) {
            setLastSavedAt(new Date(profile.updatedAt).toLocaleTimeString());
          }
        } else if (isMounted) {
          setFormData({
            ...EMPTY_PROFILE_TEMPLATE,
            name: user?.fullName || user?.firstName || "",
            relationshipToUser: "self",
          });
        }
      } catch (err: any) {
        console.warn("[Profile] Server load exception (using local baseline):", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadSelfProfile();

    return () => {
      isMounted = false;
    };
  }, [isUserLoaded, userId, user]);

  // DOB and Age handling
  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const dob = e.target.value;
    let computedAge: number | undefined = undefined;
    if (dob) {
      const birth = new Date(dob);
      if (!isNaN(birth.getTime())) {
        const diff = Date.now() - birth.getTime();
        const ageDate = new Date(diff);
        computedAge = Math.abs(ageDate.getUTCFullYear() - 1970);
      }
    }
    setFormData((prev) => ({
      ...prev,
      dateOfBirth: dob,
      age: computedAge
    }));
  };

  // Condition handlers
  const toggleCondition = (cond: string) => {
    setFormData((prev) => {
      const current = prev.knownConditions || [];
      const exists = current.includes(cond);
      return {
        ...prev,
        knownConditions: exists ? current.filter((c) => c !== cond) : [...current, cond]
      };
    });
  };

  const addCustomCondition = () => {
    if (!customCondition.trim()) return;
    const val = customCondition.trim();
    if (!formData.knownConditions?.includes(val)) {
      setFormData((prev) => ({
        ...prev,
        knownConditions: [...(prev.knownConditions || []), val]
      }));
    }
    setCustomCondition("");
  };

  // Medication handlers
  const addMedication = () => {
    if (!newMed.name.trim()) return;
    const med: PatientMedication = {
      name: newMed.name.trim(),
      dose: newMed.dose.trim() || undefined,
      frequency: newMed.frequency.trim() || undefined
    };
    setFormData((prev) => ({
      ...prev,
      currentMedications: [...(prev.currentMedications || []), med]
    }));
    setNewMed({ name: "", dose: "", frequency: "" });
  };

  const removeMedication = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      currentMedications: (prev.currentMedications || []).filter((_, i) => i !== index)
    }));
  };

  // Allergy handlers
  const addAllergy = (name?: string) => {
    const drugName = name || newAllergy.drugName.trim();
    if (!drugName) return;
    const allergy: DrugAllergy = {
      drugName,
      severity: newAllergy.severity,
      reactionType: "allergy",
      reactionDescription: newAllergy.reactionDescription.trim() || undefined
    };
    setFormData((prev) => ({
      ...prev,
      allergyStatus: "confirmed",
      drugAllergies: [...(prev.drugAllergies || []).filter((a) => a.drugName.toLowerCase() !== drugName.toLowerCase()), allergy]
    }));
    setNewAllergy({ drugName: "", severity: "moderate", reactionDescription: "" });
  };

  const removeAllergy = (drugName: string) => {
    setFormData((prev) => {
      const remaining = (prev.drugAllergies || []).filter((a) => a.drugName !== drugName);
      return {
        ...prev,
        drugAllergies: remaining,
        allergyStatus: remaining.length === 0 ? "none_known" : "confirmed"
      };
    });
  };

  // Save profile with fault-tolerant draft preservation & retry (Single-Patient Model)
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaveStatus("saving");
    setErrorMessage("");

    // Cache current form as draft so user work is never lost if network drops
    clientProfileCache.setDraft(userId, "self", formData);

    try {
      const payload = {
        ...formData,
        relationshipToUser: "self"
      };

      const res = await fetch("/api/patient/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save patient profile.");
      }

      // Success: update cache & baseline
      const saved: PatientProfile = data.profile;
      clientProfileCache.set(userId, "self", saved);
      clientProfileCache.clearDraft(userId, "self");

      setBaselineProfile(saved);
      setFormData({ ...saved });

      setSaveStatus("saved");
      const timestamp = new Date().toLocaleTimeString();
      setLastSavedAt(timestamp);

      setTimeout(() => {
        setSaveStatus("idle");
      }, 4000);
    } catch (err: any) {
      console.error("[Profile Save Error]", err);
      setSaveStatus("error");
      setErrorMessage(err.message || "Failed to save profile. Your changes are preserved locally.");
    }
  };

  const handleResetToBaseline = () => {
    const baseline = baselineProfile || EMPTY_PROFILE_TEMPLATE;
    setFormData({ ...baseline });
    clientProfileCache.clearDraft(userId, "self");
    setSaveStatus("idle");
    setErrorMessage("");
  };

  return (
    <div className="relative min-h-screen bg-[#FAF9F6] text-[#05070F] flex flex-col font-sans selection:bg-[#B7FF72] selection:text-[#05070F]">

      {/* Main Container: Expanded to full desktop canvas (1200-1280px) */}
      <main className="relative z-10 flex-1 max-w-[1240px] w-full mx-auto px-4 sm:px-6 lg:px-8 pt-28 sm:pt-32 pb-12 sm:pb-16 flex flex-col gap-8">

        {/* ========================================================================= */}
        {/* EDITORIAL SETTINGS HEADER: LINEAR / RAYCAST / APPLE HIG PATTERN           */}
        {/* ========================================================================= */}
        <header className="relative border-b border-[#E5E7EB] pb-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start relative z-10">
            {/* Left Column: Title, status, relationship selector */}
            <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-[#F0FDF4] border border-[#DCFCE7] text-[11px] font-mono font-bold uppercase tracking-[0.12em] text-[#16A34A]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse" />
                  <span>MEDVOICE · CLINICAL HEALTH CONTEXT</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F3F4F6] border border-[#E5E7EB] text-[11px] text-[#475569]">
                    <Lock className="w-3 h-3 text-[#16A34A]" />
                    <span>Strictly Private & Client-Controlled</span>
                  </div>

                  {!isDirty && (
                    <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F0FDF4] border border-[#DCFCE7] text-[11px] text-[#16A34A] font-medium">
                      <Check className="w-3 h-3 text-[#16A34A]" />
                      <span>All changes saved</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-[#05070F] tracking-tight">
                  Patient Profile & Health Baseline
                </h1>
                <p className="text-sm sm:text-base text-[#475569] max-w-2xl leading-relaxed">
                  Maintain an optional baseline so consultations remain seamless, personalized, and informed. MedVoice respects your boundaries and will never interrogate you for unprovided details.
                </p>
              </div>

              {/* Relationship Selector Pills */}
              <div className="pt-2 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-[#94A3B8] font-bold">
                    Active Patient Record
                  </div>
                  {!isDirty && (
                    <span className="text-[11px] text-[#64748B]">
                      {lastSavedAt ? `Saved at ${lastSavedAt}` : "Baseline is up to date"}
                    </span>
                  )}
                </div>

                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-[#F3F4F6] border border-[#E5E7EB] rounded-xl w-fit text-xs font-semibold text-[#05070F]">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" />
                  <span>Personal Account Holder (Self)</span>
                </div>
              </div>
            </div>

            {/* Right Column: Sculptural Acoustic Wave Identity */}
            <div className="lg:col-span-5 xl:col-span-4 hidden lg:flex flex-col justify-end relative">
              <motion.div
                animate={prefersReducedMotion ? {} : { y: [0, -6, 0] }}
                transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
                className="relative w-full h-[210px] rounded-3xl bg-linear-to-br from-emerald-50/60 via-[#FAF9F6] to-teal-50/30 border border-[#E5E7EB] p-5 flex flex-col justify-between overflow-hidden shadow-2xs"
              >
                {/* Sculptural Mint Ribbon graphic with smooth blend */}
                <div className="absolute -right-8 -top-12 w-[280px] h-[300px] pointer-events-none select-none opacity-45 mix-blend-multiply">
                  <img
                    src="/images/profile/sculptural-mint-ribbon.png"
                    alt=""
                    className="w-full h-full object-cover [mask-image:radial-gradient(ellipse_at_70%_40%,black_30%,transparent_75%)]"
                  />
                </div>

                {/* Acoustic Waveform Filament */}
                <div className="absolute right-0 bottom-0 w-[240px] h-[150px] pointer-events-none select-none opacity-30">
                  <img
                    src="/images/profile/acoustic-waveform-filament.png"
                    alt=""
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* Micro-spec metadata */}
                <div className="relative z-10 flex items-center justify-between text-[10px] font-mono text-[#64748B]">
                  <span className="inline-flex items-center gap-1.5 uppercase tracking-wider font-semibold text-[#18251D]">
                    <Activity className="w-3.5 h-3.5 text-[#16A34A]" />
                    ACOUSTIC CONTEXT CORE
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-white/90 border border-[#E2E8F0] text-[10px] text-[#475569]">
                    CLIENT-SIDE · PHI
                  </span>
                </div>

                <div className="relative z-10 flex flex-col gap-1">
                  <div className="text-xs font-semibold text-[#18251D]">
                    Zero-Interrogation Clinical Flow
                  </div>
                  <p className="text-[11px] text-[#64748B] leading-relaxed">
                    Baseline medical facts pre-populate clinical reasoning silently, eliminating redundant intake questions.
                  </p>
                </div>
              </motion.div>
            </div>
          </div>
        </header>

        {/* ========================================================================= */}
        {/* SKELETON PLACEHOLDER WHILE DATA FETCHES                                  */}
        {/* ========================================================================= */}
        {loading ? (
          <ProfileSkeleton />
        ) : (
          <form onSubmit={handleSave} className="relative flex flex-col gap-6">

            {/* --------------------------------------------------------------------- */}
            {/* SECTION 1: CORE DEMOGRAPHICS                                          */}
            {/* --------------------------------------------------------------------- */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="bg-white border border-[#E5E7EB] rounded-3xl p-6 sm:p-7 shadow-xs hover:border-[#CBD5E1] transition-colors"
            >
              <div
                onClick={() => toggleSection("demographics")}
                className="flex items-center justify-between cursor-pointer select-none group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#F0FDF4] border border-[#DCFCE7] flex items-center justify-center text-[#16A34A]">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-[#05070F]">
                      Basic Demographics
                    </h2>
                    <p className="text-xs text-[#64748B]">
                      Identity, age calculation, biological sex, and communication language
                    </p>
                  </div>
                </div>
                <button type="button" className="text-[#94A3B8] group-hover:text-[#05070F] p-1">
                  {sectionsOpen.demographics ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
              </div>

              {sectionsOpen.demographics && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 pt-6 mt-4 border-t border-[#F1F5F9]">
                  {/* Full / Preferred Name */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#334155] flex items-center justify-between">
                      <span>Full / Preferred Name</span>
                      <span className="text-[10px] text-[#94A3B8] font-normal">Optional</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name || ""}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Marcus Vance"
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20 focus:border-[#16A34A] bg-[#F8FAFC]"
                    />
                  </div>

                  {/* Date of Birth */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#334155] flex items-center justify-between">
                      <span>Date of Birth</span>
                      <span className="text-[10px] text-[#94A3B8] font-normal">Auto-computes age</span>
                    </label>
                    <input
                      type="date"
                      value={formData.dateOfBirth || ""}
                      onChange={handleDobChange}
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20 focus:border-[#16A34A] bg-[#F8FAFC]"
                    />
                  </div>

                  {/* Age (Direct or Computed) */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#334155] flex items-center justify-between">
                      <span>Age (Years)</span>
                      <span className="text-[10px] text-[#94A3B8] font-normal">{formData.dateOfBirth ? "Calculated" : "Optional"}</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={125}
                      value={formData.age !== undefined && formData.age !== null ? formData.age : ""}
                      onChange={(e) => setFormData({ ...formData, age: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                      placeholder="e.g. 56"
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20 focus:border-[#16A34A] bg-[#F8FAFC] font-mono"
                    />
                  </div>

                  {/* Biological Sex (Sex Assigned at Birth) */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="patient-biological-sex" className="text-xs font-semibold text-[#334155] flex items-center justify-between">
                      <span>Biological Sex</span>
                      <span className="text-[10px] text-[#94A3B8] font-normal">For clinical risks</span>
                    </label>
                    <select
                      id="patient-biological-sex"
                      value={formData.sexAssignedAtBirth || ""}
                      onChange={(e) => {
                        const newSex = (e.target.value || undefined) as any;
                        setFormData((prev) => ({
                          ...prev,
                          sexAssignedAtBirth: newSex,
                          pregnancyStatus: newSex === "female" ? prev.pregnancyStatus : "not_applicable"
                        }));
                      }}
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20 focus:border-[#16A34A] bg-[#F8FAFC]"
                    >
                      <option value="">Unspecified</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="intersex">Intersex</option>
                    </select>
                  </div>

                  {/* Gender Identity */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="patient-gender-identity" className="text-xs font-semibold text-[#334155] flex items-center justify-between">
                      <span>Gender Identity</span>
                      <span className="text-[10px] text-[#94A3B8] font-normal">Personal identity</span>
                    </label>
                    <select
                      id="patient-gender-identity"
                      value={formData.gender || ""}
                      onChange={(e) => {
                        const newGender = (e.target.value || undefined) as any;
                        setFormData((prev) => ({
                          ...prev,
                          gender: newGender
                        }));
                      }}
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20 focus:border-[#16A34A] bg-[#F8FAFC]"
                    >
                      <option value="">Unspecified</option>
                      <option value="male">Identifies as Male</option>
                      <option value="female">Identifies as Female</option>
                      <option value="other">Non-binary / Other</option>
                    </select>
                  </div>

                  {/* Pregnancy Status (if biologically female) */}
                  {formData.sexAssignedAtBirth === "female" && (
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-[#334155] flex items-center justify-between">
                        <span>Pregnancy Status</span>
                        <span className="text-[10px] text-[#94A3B8] font-normal">Medication safety</span>
                      </label>
                      <select
                        value={formData.pregnancyStatus || "not_applicable"}
                        onChange={(e) => setFormData({ ...formData, pregnancyStatus: e.target.value as any })}
                        className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20 focus:border-[#16A34A] bg-[#F8FAFC]"
                      >
                        <option value="not_pregnant">Not Pregnant</option>
                        <option value="pregnant">Currently Pregnant</option>
                        <option value="not_applicable">Not Applicable</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </div>
                  )}

                  {/* Preferred Language */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#334155] flex items-center justify-between">
                      <span>Preferred Language</span>
                      <span className="text-[10px] text-[#94A3B8] font-normal">ASR / TTS Voice</span>
                    </label>
                    <select
                      value={formData.language || "en"}
                      onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20 focus:border-[#16A34A] bg-[#F8FAFC]"
                    >
                      {LANGUAGES.map((lang) => (
                        <option key={lang.value} value={lang.value}>
                          {lang.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Blood Group */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#334155] flex items-center justify-between">
                      <span>Blood Group</span>
                      <span className="text-[10px] text-[#94A3B8] font-normal">Optional</span>
                    </label>
                    <select
                      value={formData.bloodGroup || ""}
                      onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value })}
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20 focus:border-[#16A34A] bg-[#F8FAFC]"
                    >
                      <option value="">Unknown</option>
                      <option value="A+">A+</option>
                      <option value="A-">A-</option>
                      <option value="B+">B+</option>
                      <option value="B-">B-</option>
                      <option value="O+">O+</option>
                      <option value="O-">O-</option>
                      <option value="AB+">AB+</option>
                      <option value="AB-">AB-</option>
                    </select>
                  </div>
                </div>
              )}
            </motion.div>

            {/* --------------------------------------------------------------------- */}
            {/* SECTION 2: KNOWN MEDICAL CONDITIONS                                   */}
            {/* --------------------------------------------------------------------- */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.04, ease: "easeOut" }}
              className="bg-white border border-[#E5E7EB] rounded-3xl p-6 sm:p-7 shadow-xs hover:border-[#CBD5E1] transition-colors"
            >
              <div
                onClick={() => toggleSection("conditions")}
                className="flex items-center justify-between cursor-pointer select-none group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600">
                    <HeartPulse className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-[#05070F]">
                      Known Medical Conditions
                    </h2>
                    <p className="text-xs text-[#64748B]">
                      Existing chronic diagnoses (e.g. hypertension, diabetes, asthma)
                    </p>
                  </div>
                </div>
                <button type="button" className="text-[#94A3B8] group-hover:text-[#05070F] p-1">
                  {sectionsOpen.conditions ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
              </div>

              {sectionsOpen.conditions && (
                <div className="pt-6 mt-4 border-t border-[#F1F5F9] flex flex-col gap-4">
                  <p className="text-xs text-[#64748B]">
                    Select common conditions or add custom diagnoses. MedVoice will recognize these in consultations without asking repetitive questions.
                  </p>

                  {/* Preset Chips */}
                  <div className="flex flex-wrap gap-2">
                    {COMMON_CONDITIONS.map((cond) => {
                      const active = formData.knownConditions?.includes(cond);
                      return (
                        <button
                          key={cond}
                          type="button"
                          onClick={() => toggleCondition(cond)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                            active
                              ? "bg-rose-50 text-rose-800 border border-rose-200 font-bold"
                              : "bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#334155] border border-[#E2E8F0]"
                          }`}
                        >
                          {active ? <Check className="w-3.5 h-3.5 text-rose-600" /> : <Plus className="w-3.5 h-3.5 text-[#94A3B8]" />}
                          <span>{cond}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom condition input */}
                  <div className="flex items-center gap-2 pt-2">
                    <input
                      type="text"
                      value={customCondition}
                      onChange={(e) => setCustomCondition(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomCondition();
                        }
                      }}
                      placeholder="Add other diagnosed condition..."
                      className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-[#E2E8F0] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20 bg-[#F8FAFC]"
                    />
                    <button
                      type="button"
                      onClick={addCustomCondition}
                      className="px-3 py-2 text-xs font-semibold bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#05070F] rounded-xl transition-colors cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </motion.div>

            {/* --------------------------------------------------------------------- */}
            {/* SECTION 3: CURRENT MEDICATIONS                                        */}
            {/* --------------------------------------------------------------------- */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.08, ease: "easeOut" }}
              className="bg-white border border-[#E5E7EB] rounded-3xl p-6 sm:p-7 shadow-xs hover:border-[#CBD5E1] transition-colors"
            >
              <div
                onClick={() => toggleSection("medications")}
                className="flex items-center justify-between cursor-pointer select-none group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
                    <Pill className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-[#05070F]">
                      Current Medications
                    </h2>
                    <p className="text-xs text-[#64748B]">
                      Regular prescriptions, over-the-counter drugs, or daily supplements
                    </p>
                  </div>
                </div>
                <button type="button" className="text-[#94A3B8] group-hover:text-[#05070F] p-1">
                  {sectionsOpen.medications ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
              </div>

              {sectionsOpen.medications && (
                <div className="pt-6 mt-4 border-t border-[#F1F5F9] flex flex-col gap-4">
                  {/* List of existing medications */}
                  {formData.currentMedications && formData.currentMedications.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {formData.currentMedications.map((med, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <Pill className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span className="font-bold text-[#05070F]">{med.name}</span>
                            {med.dose && <span className="text-[#64748B] font-mono">({med.dose})</span>}
                            {med.frequency && <span className="text-[#94A3B8] italic">• {med.frequency}</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeMedication(idx)}
                            className="text-[#94A3B8] hover:text-rose-600 transition-colors p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#94A3B8] italic">No regular medications listed.</p>
                  )}

                  {/* Add medication input row */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
                    <input
                      type="text"
                      value={newMed.name}
                      onChange={(e) => setNewMed({ ...newMed, name: e.target.value })}
                      placeholder="Medication name (e.g. Metformin)"
                      className="px-3.5 py-2 text-xs rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20"
                    />
                    <input
                      type="text"
                      value={newMed.dose}
                      onChange={(e) => setNewMed({ ...newMed, dose: e.target.value })}
                      placeholder="Dosage (e.g. 500mg)"
                      className="px-3.5 py-2 text-xs rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newMed.frequency}
                        onChange={(e) => setNewMed({ ...newMed, frequency: e.target.value })}
                        placeholder="Frequency (e.g. Twice daily)"
                        className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20"
                      />
                      <button
                        type="button"
                        onClick={addMedication}
                        className="px-3.5 py-2 text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl transition-colors cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>

            {/* --------------------------------------------------------------------- */}
            {/* SECTION 4: KNOWN DRUG ALLERGIES                                       */}
            {/* --------------------------------------------------------------------- */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.12, ease: "easeOut" }}
              className="bg-white border border-[#E5E7EB] rounded-3xl p-6 sm:p-7 shadow-xs hover:border-[#CBD5E1] transition-colors"
            >
              <div
                onClick={() => toggleSection("allergies")}
                className="flex items-center justify-between cursor-pointer select-none group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-[#05070F]">
                      Known Drug Allergies
                    </h2>
                    <p className="text-xs text-[#64748B]">
                      Allergic reactions or adverse sensitivities to medications
                    </p>
                  </div>
                </div>
                <button type="button" className="text-[#94A3B8] group-hover:text-[#05070F] p-1">
                  {sectionsOpen.allergies ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
              </div>

              {sectionsOpen.allergies && (
                <div className="pt-6 mt-4 border-t border-[#F1F5F9] flex flex-col gap-4">
                  {/* Allergy status radio */}
                  <div className="flex items-center gap-5 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-[#334155]">
                      <input
                        type="radio"
                        name="allergyStatus"
                        checked={formData.allergyStatus === "none_known"}
                        onChange={() => setFormData({ ...formData, allergyStatus: "none_known", drugAllergies: [] })}
                        className="text-[#16A34A] focus:ring-[#16A34A]"
                      />
                      <span>No known drug allergies (NKDA)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer font-medium text-[#334155]">
                      <input
                        type="radio"
                        name="allergyStatus"
                        checked={formData.allergyStatus === "confirmed"}
                        onChange={() => setFormData({ ...formData, allergyStatus: "confirmed" })}
                        className="text-[#16A34A] focus:ring-[#16A34A]"
                      />
                      <span>I have confirmed drug allergies</span>
                    </label>
                  </div>

                  {formData.allergyStatus === "confirmed" && (
                    <>
                      {/* Common allergy chips */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {COMMON_DRUG_ALLERGIES.map((allergyName) => {
                          const active = formData.drugAllergies?.some((a) => a.drugName.toLowerCase() === allergyName.toLowerCase());
                          return (
                            <button
                              key={allergyName}
                              type="button"
                              onClick={() => (active ? removeAllergy(allergyName) : addAllergy(allergyName))}
                              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                                active
                                  ? "bg-purple-50 text-purple-800 border border-purple-200 font-bold"
                                  : "bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#334155] border border-[#E2E8F0]"
                              }`}
                            >
                              {active ? <Check className="w-3.5 h-3.5 text-purple-600" /> : <Plus className="w-3.5 h-3.5 text-[#94A3B8]" />}
                              <span>{allergyName}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Active allergies list */}
                      {formData.drugAllergies && formData.drugAllergies.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2">
                          {formData.drugAllergies.map((a, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-purple-50/50 border border-purple-200/70 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                                <strong className="text-[#05070F]">{a.drugName}</strong>
                                <span className="text-purple-700 font-mono text-[11px]">({a.severity})</span>
                                {a.reactionDescription && <span className="text-[#64748B]">• {a.reactionDescription}</span>}
                              </div>
                              <button
                                type="button"
                                onClick={() => removeAllergy(a.drugName)}
                                className="text-[#94A3B8] hover:text-rose-600 transition-colors p-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </motion.div>

            {/* --------------------------------------------------------------------- */}
            {/* SECTION 5: SURGICAL HISTORY & LIFESTYLE                               */}
            {/* --------------------------------------------------------------------- */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.16, ease: "easeOut" }}
              className="bg-white border border-[#E5E7EB] rounded-3xl p-6 sm:p-7 shadow-xs hover:border-[#CBD5E1] transition-colors"
            >
              <div
                onClick={() => toggleSection("history")}
                className="flex items-center justify-between cursor-pointer select-none group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-center text-[#334155]">
                    <Stethoscope className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-[#05070F]">
                      Surgical History & Lifestyle
                    </h2>
                    <p className="text-xs text-[#64748B]">
                      Past procedures, major surgeries, and tobacco history
                    </p>
                  </div>
                </div>
                <button type="button" className="text-[#94A3B8] group-hover:text-[#05070F] p-1">
                  {sectionsOpen.history ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
              </div>

              {sectionsOpen.history && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-6 mt-4 border-t border-[#F1F5F9]">
                  {/* Smoking Status */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#334155]">Smoking / Tobacco History</label>
                    <select
                      value={formData.smokingStatus || "unknown"}
                      onChange={(e) => setFormData({ ...formData, smokingStatus: e.target.value as any })}
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20"
                    >
                      <option value="never">Never Smoked</option>
                      <option value="former">Former Smoker</option>
                      <option value="current">Current Smoker</option>
                      <option value="unknown">Prefer not to say / Unknown</option>
                    </select>
                  </div>

                  {/* Surgical notes */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#334155]">Major Surgeries</label>
                    <input
                      type="text"
                      value={formData.clinicalNotes || ""}
                      onChange={(e) => setFormData({ ...formData, clinicalNotes: e.target.value })}
                      placeholder="e.g. Appendectomy (2018), Knee replacement (2022)"
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20"
                    />
                  </div>
                </div>
              )}
            </motion.div>

            {/* --------------------------------------------------------------------- */}
            {/* SECTION 6: EMERGENCY CONTACT & PREFERENCES                            */}
            {/* --------------------------------------------------------------------- */}
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2, ease: "easeOut" }}
              className="bg-white border border-[#E5E7EB] rounded-3xl p-6 sm:p-7 shadow-xs hover:border-[#CBD5E1] transition-colors"
            >
              <div
                onClick={() => toggleSection("emergency")}
                className="flex items-center justify-between cursor-pointer select-none group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700">
                    <Phone className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-[#05070F]">
                      Emergency Contact & Preferences
                    </h2>
                    <p className="text-xs text-[#64748B]">
                      Designated next of kin contact for urgent situations
                    </p>
                  </div>
                </div>
                <button type="button" className="text-[#94A3B8] group-hover:text-[#05070F] p-1">
                  {sectionsOpen.emergency ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </button>
              </div>

              {sectionsOpen.emergency && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-6 mt-4 border-t border-[#F1F5F9]">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#334155]">Contact Name</label>
                    <input
                      type="text"
                      value={formData.emergencyContact?.name || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          emergencyContact: { ...(formData.emergencyContact || {}), name: e.target.value }
                        })
                      }
                      placeholder="e.g. Elena Vance"
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#334155]">Phone Number</label>
                    <input
                      type="tel"
                      value={formData.emergencyContact?.phone || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          emergencyContact: { ...(formData.emergencyContact || {}), phone: e.target.value }
                        })
                      }
                      placeholder="e.g. +91 98765 43210"
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20 font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#334155]">Relationship</label>
                    <input
                      type="text"
                      value={formData.emergencyContact?.relationship || ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          emergencyContact: { ...(formData.emergencyContact || {}), relationship: e.target.value }
                        })
                      }
                      placeholder="e.g. Spouse / Sister"
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#16A34A]/20"
                    />
                  </div>
                </div>
              )}
            </motion.div>

            {/* =================================================================== */}
            {/* IN-FLOW STATUS (WHILE UNCHANGED)                                    */}
            {/* =================================================================== */}
            {!isDirty && saveStatus !== "saving" && saveStatus !== "error" && (
              <div className="pt-6 pb-2 border-t border-[#E5E7EB] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-2.5 text-[#475569]">
                  <div className="w-5 h-5 rounded-full bg-[#16A34A]/10 border border-[#16A34A]/30 flex items-center justify-center text-[#16A34A] shrink-0">
                    <Check className="w-3 h-3" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-[#18251D]">
                      All profile changes saved
                    </span>
                    <span className="text-[11px] text-[#94A3B8]">
                      {lastSavedAt ? `· Saved at ${lastSavedAt}` : "· Clinical baseline is up to date"}
                    </span>
                  </div>
                </div>

                <Link
                  href="/consult"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#E5E7EB] bg-white hover:bg-[#F8FAFC] text-[#05070F] font-semibold text-xs shadow-2xs hover:shadow-xs transition-all"
                >
                  <span>Return to Consult</span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#64748B]" />
                </Link>
              </div>
            )}

            {/* =================================================================== */}
            {/* SCOPED STICKY SAVE BAR (ONLY REVEALED ON EDITS / ERROR / SAVING)     */}
            {/* =================================================================== */}
            {(isDirty || saveStatus === "saving" || saveStatus === "error") && (
              <div className="sticky bottom-4 sm:bottom-6 z-20 mt-4">
                <div className="bg-[#05070F] text-white rounded-2xl p-3 sm:px-5 sm:py-3.5 shadow-xl border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 backdrop-blur-md">
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#B7FF72] animate-pulse shrink-0" />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">
                          Unsaved Changes
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-white/10 text-[10px] font-mono uppercase tracking-wide text-white/80">
                          Self (Personal)
                        </span>
                      </div>
                      <span className="text-[11px] text-[#94A3B8]">
                        {saveStatus === "error"
                          ? errorMessage || "Save failed. Your edits are safely preserved."
                          : "Pending edits in this profile will be used in future consultations"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                    <button
                      type="button"
                      onClick={handleResetToBaseline}
                      disabled={saveStatus === "saving"}
                      className="px-3.5 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white text-xs font-semibold transition-all cursor-pointer"
                    >
                      Discard Changes
                    </button>

                    <button
                      type="submit"
                      disabled={saveStatus === "saving"}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer bg-[#B7FF72] hover:bg-[#a6f75c] text-[#05070F] shadow-sm active:scale-98"
                    >
                      {saveStatus === "saving" ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : saveStatus === "error" ? (
                        <>
                          <RefreshCcw className="w-3.5 h-3.5" />
                          <span>Retry Save</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          <span>Save Changes</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </form>
        )}

      </main>

      <ArchitecturalBrandLedgerFooter />
    </div>
  );
}
