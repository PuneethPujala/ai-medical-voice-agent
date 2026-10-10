"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
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
  AlertCircle
} from "lucide-react";
import { Navbar } from "../_components/Navbar";
import { AppFooter } from "../_components/AppFooter";
import GradientText from "@/components/ui/GradientText";
import { PatientProfile, PatientMedication, DrugAllergy } from "@/lib/clinical-knowledge/types";

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

const RELATIONSHIPS = [
  { value: "self", label: "Myself (Self)" },
  { value: "parent", label: "Parent / Mother / Father" },
  { value: "child", label: "Child / Son / Daughter" },
  { value: "spouse", label: "Spouse / Partner" },
  { value: "other", label: "Other Family / Dependent" }
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi (हिंदी)" },
  { value: "te", label: "Telugu (తెలుగు)" },
  { value: "ta", label: "Tamil (தமிழ்)" },
  { value: "bn", label: "Bengali (বাংলা)" },
  { value: "es", label: "Spanish (Español)" }
];

export default function PatientProfilePage() {
  const { user, isLoaded } = useUser();
  const [profiles, setProfiles] = useState<PatientProfile[]>([]);
  const [selectedRelationship, setSelectedRelationship] = useState<string>("self");
  const [loading, setLoading] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // Collapsible section toggles for clean hierarchy
  const [sectionsOpen, setSectionsOpen] = useState({
    demographics: true,
    conditions: true,
    medications: true,
    allergies: true,
    history: false,
    emergency: false
  });

  // Current Form State
  const [formData, setFormData] = useState<Partial<PatientProfile>>({
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
  });

  const [customCondition, setCustomCondition] = useState("");
  const [customSurgical, setCustomSurgical] = useState("");
  const [newMed, setNewMed] = useState({ name: "", dose: "", frequency: "" });
  const [newAllergy, setNewAllergy] = useState({ drugName: "", severity: "moderate" as const, reactionDescription: "" });

  const toggleSection = (key: keyof typeof sectionsOpen) => {
    setSectionsOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Fetch all user profiles on mount
  useEffect(() => {
    async function loadProfiles() {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const res = await fetch("/api/patient/profile?all=true");
        const data = await res.json();
        if (data.success && Array.isArray(data.profiles)) {
          setProfiles(data.profiles);
          const selfProfile = data.profiles.find((p: any) => p.relationshipToUser === "self") || data.profiles[0];
          if (selfProfile) {
            populateForm(selfProfile);
            setSelectedRelationship(selfProfile.relationshipToUser || "self");
            if (selfProfile.updatedAt) {
              setLastSavedAt(new Date(selfProfile.updatedAt).toLocaleTimeString());
            }
          } else {
            // Default empty self profile
            setFormData((prev) => ({
              ...prev,
              name: user.fullName || user.firstName || "",
              relationshipToUser: "self"
            }));
          }
        }
      } catch (err: any) {
        console.error("Failed to load patient profiles:", err);
      } finally {
        setLoading(false);
      }
    }

    if (isLoaded) {
      loadProfiles();
    }
  }, [user, isLoaded]);

  const populateForm = (p: PatientProfile) => {
    setFormData({
      id: p.id,
      name: p.name || "",
      relationshipToUser: p.relationshipToUser || "self",
      language: p.language || "en",
      dateOfBirth: p.dateOfBirth || "",
      age: p.age,
      sexAssignedAtBirth: p.sexAssignedAtBirth,
      gender: p.gender,
      bloodGroup: p.bloodGroup || "",
      pregnancyStatus: p.pregnancyStatus || "not_applicable",
      knownConditions: p.knownConditions || [],
      currentMedications: p.currentMedications || [],
      allergyStatus: p.allergyStatus || "unassessed",
      drugAllergies: p.drugAllergies || [],
      surgicalHistory: p.surgicalHistory || [],
      smokingStatus: p.smokingStatus || "unknown",
      emergencyContact: p.emergencyContact || { name: "", phone: "", relationship: "" },
      accessibilityPreferences: p.accessibilityPreferences || { communicationStyle: "concise", notes: "" },
      clinicalNotes: p.clinicalNotes || ""
    });
  };

  // Switch between Self and Family Profiles
  const handleSelectRelationship = (rel: string) => {
    setSelectedRelationship(rel);
    const existing = profiles.find((p) => (p.relationshipToUser || "self") === rel);
    if (existing) {
      populateForm(existing);
      if (existing.updatedAt) setLastSavedAt(new Date(existing.updatedAt).toLocaleTimeString());
    } else {
      // Create new clean profile draft for that relationship
      setFormData({
        name: "",
        relationshipToUser: rel as any,
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
      });
      setLastSavedAt(null);
    }
  };

  // Dynamic Age calculation from DOB
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

  // Condition toggles
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

  // Save profile to backend
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaveStatus("saving");
    setErrorMessage("");

    try {
      const payload = {
        ...formData,
        relationshipToUser: selectedRelationship
      };

      const res = await fetch("/api/patient/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save profile.");
      }

      setSaveStatus("saved");
      setLastSavedAt(new Date().toLocaleTimeString());

      // Update local profiles list
      setProfiles((prev) => {
        const idx = prev.findIndex((p) => p.id === data.profile.id || p.relationshipToUser === data.profile.relationshipToUser);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = data.profile;
          return updated;
        }
        return [...prev, data.profile];
      });

      setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
    } catch (err: any) {
      console.error("Save error:", err);
      setSaveStatus("error");
      setErrorMessage(err.message || "Could not save profile.");
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-50/50 text-slate-900 flex flex-col font-sans selection:bg-cyan-500 selection:text-white overflow-x-clip">
      <Navbar />

      <main className="relative z-10 flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 pt-6 sm:pt-10 pb-24 flex flex-col gap-8">
        
        {/* ========================================================================= */}
        {/* HERO HEADER: CLINICAL INTELLIGENCE HEALTH PROFILE                        */}
        {/* ========================================================================= */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="flex flex-col items-center text-center space-y-4 pt-2 sm:pt-4"
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-50 border border-cyan-200/90 shadow-2xs font-mono">
            <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-[0.1em] text-cyan-900">
              MEDVOICE · PATIENT HEALTH CONTEXT
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-slate-950 tracking-tight leading-[1.1]">
            Patient Health Profile
          </h1>

          <p className="text-sm sm:text-base text-slate-600 max-w-2xl font-normal leading-relaxed">
            Optionally maintain your clinical background so MedVoice can personalize consultations, avoid repeated questions, and account for your medical history. All fields are completely optional.
          </p>

          {/* Privacy & Non-Interrogation Assurance Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-white border border-slate-200 shadow-2xs text-xs text-slate-600 max-w-xl">
            <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>
              <strong>Privacy Assurance:</strong> The chatbot will <em>never</em> interrogate you for blank fields. Details are used only when pertinent to active symptoms.
            </span>
          </div>
        </motion.div>

        {/* ========================================================================= */}
        {/* PATIENT PROFILE SWITCHER: SELF VS FAMILY MEMBERS                         */}
        {/* ========================================================================= */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1, ease: "easeOut" }}
          className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-950 uppercase tracking-wider font-mono">
                Active Profile
              </div>
              <div className="text-sm font-semibold text-slate-700">
                {selectedRelationship === "self" ? "Personal Profile (Self)" : `Family Member (${selectedRelationship})`}
              </div>
            </div>
          </div>

          {/* Relationship Selector Pills */}
          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            {RELATIONSHIPS.map((rel) => {
              const isSelected = selectedRelationship === rel.value;
              const hasSaved = profiles.some((p) => (p.relationshipToUser || "self") === rel.value);
              return (
                <button
                  key={rel.value}
                  type="button"
                  onClick={() => handleSelectRelationship(rel.value)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                    isSelected
                      ? "bg-slate-950 text-white shadow-xs"
                      : "bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200"
                  }`}
                >
                  {hasSaved && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-cyan-400" : "bg-emerald-500"}`} />}
                  <span>{rel.label.split(" ")[0]}</span>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* ========================================================================= */}
        {/* FORM CONTAINER WITH STAGGERED REVEAL & ACCORDION CARDS                  */}
        {/* ========================================================================= */}
        <form onSubmit={handleSave} className="flex flex-col gap-6">

          {/* ----------------------------------------------------------------------- */}
          {/* SECTION 1: BASIC INFORMATION & DEMOGRAPHICS                            */}
          {/* ----------------------------------------------------------------------- */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.15 }}
            className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs"
          >
            <div
              onClick={() => toggleSection("demographics")}
              className="flex items-center justify-between cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-700">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-950">
                    Basic Demographics
                  </h2>
                  <p className="text-xs text-slate-500">
                    Preferred name, date of birth, biological sex, and communication language
                  </p>
                </div>
              </div>
              <button type="button" className="text-slate-400 group-hover:text-slate-700 p-1">
                {sectionsOpen.demographics ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            </div>

            {sectionsOpen.demographics && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 pt-6 mt-4 border-t border-slate-100">
                {/* Full / Preferred Name */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                    <span>Full / Preferred Name</span>
                    <span className="text-[10px] text-slate-400 font-normal">Optional</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name || ""}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Marcus Vance"
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 bg-slate-50/50"
                  />
                </div>

                {/* Date of Birth */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                    <span>Date of Birth</span>
                    <span className="text-[10px] text-slate-400 font-normal">Calculates age</span>
                  </label>
                  <input
                    type="date"
                    value={formData.dateOfBirth || ""}
                    onChange={handleDobChange}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 bg-slate-50/50"
                  />
                </div>

                {/* Age (Direct or Computed) */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                    <span>Age (Years)</span>
                    <span className="text-[10px] text-slate-400 font-normal">{formData.dateOfBirth ? "Auto-computed" : "Optional"}</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={125}
                    value={formData.age !== undefined && formData.age !== null ? formData.age : ""}
                    onChange={(e) => setFormData({ ...formData, age: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                    placeholder="e.g. 56"
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 bg-slate-50/50 font-mono"
                  />
                </div>

                {/* Sex Assigned at Birth */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                    <span>Biological Sex</span>
                    <span className="text-[10px] text-slate-400 font-normal">For clinical risks</span>
                  </label>
                  <select
                    value={formData.sexAssignedAtBirth || ""}
                    onChange={(e) => setFormData({ ...formData, sexAssignedAtBirth: (e.target.value || undefined) as any })}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 bg-slate-50/50"
                  >
                    <option value="">Unspecified</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="intersex">Intersex</option>
                  </select>
                </div>

                {/* Pregnancy Status (when biologically female) */}
                {formData.sexAssignedAtBirth === "female" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                      <span>Pregnancy Status</span>
                      <span className="text-[10px] text-slate-400 font-normal">Clinical safety</span>
                    </label>
                    <select
                      value={formData.pregnancyStatus || "not_applicable"}
                      onChange={(e) => setFormData({ ...formData, pregnancyStatus: e.target.value as any })}
                      className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 bg-slate-50/50"
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
                  <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                    <span>Preferred Language</span>
                    <span className="text-[10px] text-slate-400 font-normal">Consultation style</span>
                  </label>
                  <select
                    value={formData.language || "en"}
                    onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 bg-slate-50/50"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Blood Group */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                    <span>Blood Group</span>
                    <span className="text-[10px] text-slate-400 font-normal">Optional</span>
                  </label>
                  <select
                    value={formData.bloodGroup || ""}
                    onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value })}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 bg-slate-50/50"
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

          {/* ----------------------------------------------------------------------- */}
          {/* SECTION 2: KNOWN MEDICAL CONDITIONS                                    */}
          {/* ----------------------------------------------------------------------- */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.2 }}
            className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs"
          >
            <div
              onClick={() => toggleSection("conditions")}
              className="flex items-center justify-between cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-700">
                  <HeartPulse className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-950">
                    Known Medical Conditions
                  </h2>
                  <p className="text-xs text-slate-500">
                    Existing chronic diagnoses (e.g. hypertension, diabetes, asthma)
                  </p>
                </div>
              </div>
              <button type="button" className="text-slate-400 group-hover:text-slate-700 p-1">
                {sectionsOpen.conditions ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            </div>

            {sectionsOpen.conditions && (
              <div className="pt-6 mt-4 border-t border-slate-100 flex flex-col gap-4">
                <p className="text-xs text-slate-500">
                  Select common conditions or add your own. The chatbot will know these baseline conditions and won&apos;t ask you to re-list them.
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
                            ? "bg-rose-50 text-rose-800 border border-rose-200 font-bold shadow-2xs"
                            : "bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200"
                        }`}
                      >
                        {active ? <Check className="w-3.5 h-3.5 text-rose-600" /> : <Plus className="w-3.5 h-3.5 text-slate-400" />}
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
                    className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 bg-slate-50/50"
                  />
                  <button
                    type="button"
                    onClick={addCustomCondition}
                    className="px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl transition-colors cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </motion.div>

          {/* ----------------------------------------------------------------------- */}
          {/* SECTION 3: CURRENT MEDICATIONS                                         */}
          {/* ----------------------------------------------------------------------- */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.25 }}
            className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs"
          >
            <div
              onClick={() => toggleSection("medications")}
              className="flex items-center justify-between cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
                  <Pill className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-950">
                    Current Medications
                  </h2>
                  <p className="text-xs text-slate-500">
                    Regular prescriptions, over-the-counter drugs, or supplements
                  </p>
                </div>
              </div>
              <button type="button" className="text-slate-400 group-hover:text-slate-700 p-1">
                {sectionsOpen.medications ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            </div>

            {sectionsOpen.medications && (
              <div className="pt-6 mt-4 border-t border-slate-100 flex flex-col gap-4">
                {/* List of existing medications */}
                {formData.currentMedications && formData.currentMedications.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {formData.currentMedications.map((med, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <Pill className="w-3.5 h-3.5 text-amber-600" />
                          <span className="font-bold text-slate-900">{med.name}</span>
                          {med.dose && <span className="text-slate-500 font-mono">({med.dose})</span>}
                          {med.frequency && <span className="text-slate-400 italic">• {med.frequency}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeMedication(idx)}
                          className="text-slate-400 hover:text-rose-600 transition-colors p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No regular medications listed.</p>
                )}

                {/* Add medication input row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
                  <input
                    type="text"
                    value={newMed.name}
                    onChange={(e) => setNewMed({ ...newMed, name: e.target.value })}
                    placeholder="Medication name (e.g. Metformin)"
                    className="px-3.5 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  />
                  <input
                    type="text"
                    value={newMed.dose}
                    onChange={(e) => setNewMed({ ...newMed, dose: e.target.value })}
                    placeholder="Dosage (e.g. 500mg)"
                    className="px-3.5 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newMed.frequency}
                      onChange={(e) => setNewMed({ ...newMed, frequency: e.target.value })}
                      placeholder="Frequency (e.g. Twice daily)"
                      className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
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

          {/* ----------------------------------------------------------------------- */}
          {/* SECTION 4: KNOWN ALLERGIES & SENSITIVITIES                             */}
          {/* ----------------------------------------------------------------------- */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.3 }}
            className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs"
          >
            <div
              onClick={() => toggleSection("allergies")}
              className="flex items-center justify-between cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-700">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-950">
                    Known Drug Allergies
                  </h2>
                  <p className="text-xs text-slate-500">
                    Allergic reactions or adverse sensitivities to medications
                  </p>
                </div>
              </div>
              <button type="button" className="text-slate-400 group-hover:text-slate-700 p-1">
                {sectionsOpen.allergies ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            </div>

            {sectionsOpen.allergies && (
              <div className="pt-6 mt-4 border-t border-slate-100 flex flex-col gap-4">
                {/* Allergy status radio */}
                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                    <input
                      type="radio"
                      name="allergyStatus"
                      checked={formData.allergyStatus === "none_known"}
                      onChange={() => setFormData({ ...formData, allergyStatus: "none_known", drugAllergies: [] })}
                      className="text-cyan-600 focus:ring-cyan-500"
                    />
                    <span>No known drug allergies (NKDA)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                    <input
                      type="radio"
                      name="allergyStatus"
                      checked={formData.allergyStatus === "confirmed"}
                      onChange={() => setFormData({ ...formData, allergyStatus: "confirmed" })}
                      className="text-cyan-600 focus:ring-cyan-500"
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
                                ? "bg-purple-50 text-purple-800 border border-purple-200 font-bold shadow-2xs"
                                : "bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200"
                            }`}
                          >
                            {active ? <Check className="w-3.5 h-3.5 text-purple-600" /> : <Plus className="w-3.5 h-3.5 text-slate-400" />}
                            <span>{allergyName}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Active allergies list */}
                    {formData.drugAllergies && formData.drugAllergies.length > 0 && (
                      <div className="flex flex-col gap-2 pt-2">
                        {formData.drugAllergies.map((a, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-purple-50/50 border border-purple-200/70 text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="w-3.5 h-3.5 text-purple-600" />
                              <strong className="text-slate-900">{a.drugName}</strong>
                              <span className="text-purple-700 font-mono text-[11px]">({a.severity})</span>
                              {a.reactionDescription && <span className="text-slate-500">• {a.reactionDescription}</span>}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeAllergy(a.drugName)}
                              className="text-slate-400 hover:text-rose-600 transition-colors p-1"
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

          {/* ----------------------------------------------------------------------- */}
          {/* SECTION 5: SURGICAL HISTORY & LIFESTYLE                                */}
          {/* ----------------------------------------------------------------------- */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.35 }}
            className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs"
          >
            <div
              onClick={() => toggleSection("history")}
              className="flex items-center justify-between cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
                  <Stethoscope className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-950">
                    Surgical History & Lifestyle
                  </h2>
                  <p className="text-xs text-slate-500">
                    Past procedures, surgeries, and tobacco use
                  </p>
                </div>
              </div>
              <button type="button" className="text-slate-400 group-hover:text-slate-700 p-1">
                {sectionsOpen.history ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            </div>

            {sectionsOpen.history && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-6 mt-4 border-t border-slate-100">
                {/* Smoking Status */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">Smoking / Tobacco History</label>
                  <select
                    value={formData.smokingStatus || "unknown"}
                    onChange={(e) => setFormData({ ...formData, smokingStatus: e.target.value as any })}
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  >
                    <option value="never">Never Smoked</option>
                    <option value="former">Former Smoker</option>
                    <option value="current">Current Smoker</option>
                    <option value="unknown">Prefer not to say / Unknown</option>
                  </select>
                </div>

                {/* Surgical notes */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">Major Surgeries</label>
                  <input
                    type="text"
                    value={formData.clinicalNotes || ""}
                    onChange={(e) => setFormData({ ...formData, clinicalNotes: e.target.value })}
                    placeholder="e.g. Appendectomy (2018), Knee replacement (2022)"
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  />
                </div>
              </div>
            )}
          </motion.div>

          {/* ----------------------------------------------------------------------- */}
          {/* SECTION 6: EMERGENCY CONTACT & ACCESSIBILITY                           */}
          {/* ----------------------------------------------------------------------- */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.4 }}
            className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-xs"
          >
            <div
              onClick={() => toggleSection("emergency")}
              className="flex items-center justify-between cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700">
                  <Phone className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-950">
                    Emergency Contact & Preferences
                  </h2>
                  <p className="text-xs text-slate-500">
                    Next of kin contact and communication style preferences
                  </p>
                </div>
              </div>
              <button type="button" className="text-slate-400 group-hover:text-slate-700 p-1">
                {sectionsOpen.emergency ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            </div>

            {sectionsOpen.emergency && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-6 mt-4 border-t border-slate-100">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">Contact Name</label>
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
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">Phone Number</label>
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
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">Relationship</label>
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
                    className="w-full px-3.5 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  />
                </div>
              </div>
            )}
          </motion.div>

          {/* ======================================================================= */}
          {/* BOTTOM ACTION BAR: SAVE / STATUS FEEDBACK                              */}
          {/* ======================================================================= */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.45 }}
            className="sticky bottom-6 z-20 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl p-4 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-900">
                  {selectedRelationship === "self" ? "Personal Profile" : `Family Member (${selectedRelationship})`}
                </span>
                <span className="text-[11px] text-slate-500">
                  {lastSavedAt ? `Last saved at ${lastSavedAt}` : "Unsaved changes"}
                </span>
              </div>

              {saveStatus === "saved" && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold animate-in fade-in zoom-in-95">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Saved to Health Record</span>
                </div>
              )}

              {saveStatus === "error" && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                  <span>{errorMessage || "Save failed"}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Link
                href="/consult"
                className="flex-1 sm:flex-none text-center px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-all cursor-pointer"
              >
                Return to Consult
              </Link>

              <button
                type="submit"
                disabled={saveStatus === "saving"}
                className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold text-white shadow-sm transition-all cursor-pointer ${
                  saveStatus === "saving"
                    ? "bg-slate-400 cursor-not-allowed"
                    : "bg-slate-950 hover:bg-slate-800 active:scale-98"
                }`}
              >
                {saveStatus === "saving" ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving Profile...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Profile Details</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>

        </form>

      </main>

      <AppFooter />
    </div>
  );
}
