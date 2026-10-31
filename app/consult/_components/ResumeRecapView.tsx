"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  MicOff,
  Volume2,
  VolumeX,
  MessageSquare,
  ArrowRight,
  Clock,
  ShieldCheck,
  AlertCircle,
  PauseCircle,
  Activity,
  Layers,
} from "lucide-react";
import { DoctorProfile } from "@/config/doctors";
import { VisualRecap } from "./VisualRecap";
import { SymptomChronology } from "./SymptomChronology";
import { SymptomUpdateDrawer } from "./SymptomUpdateDrawer";
import { extractGroundedRecapCategories } from "@/lib/triage/recap-categories";

interface ResumeRecapViewProps {
  consultation: {
    id: string;
    patientName?: string;
    doctorName?: string;
    specialty?: string;
    chiefComplaint?: string;
    transcript?: Array<{ id?: string; role: string; text: string; timestamp?: string }>;
    durationSeconds?: number;
    createdAt?: string;
    status?: string;
    detectedSymptoms?: string[];
    interviewState?: any;
    attributedFacts?: any[];
    parentConsultationId?: string;
    isFollowUp?: boolean;
  };
  doctor: DoctorProfile;
  onContinueWithVoice: () => void;
  onListenToRecap: () => void;
  onStopRecapAudio: () => void;
  isRecapAudioPlaying: boolean;
  onApplyTextCorrection?: (
    text: string,
    targetTurnId?: string
  ) => Promise<{ success: boolean; error?: string } | void> | void;
  onStartNewConsultation: () => void;
}

export function ResumeRecapView({
  consultation,
  doctor,
  onContinueWithVoice,
  onListenToRecap,
  onStopRecapAudio,
  isRecapAudioPlaying,
  onApplyTextCorrection,
  onStartNewConsultation,
}: ResumeRecapViewProps) {
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [showChronology, setShowChronology] = useState(false);

  const turnCount = consultation.transcript?.length || 0;
  const categories = React.useMemo(
    () => extractGroundedRecapCategories(consultation),
    [consultation]
  );

  // Format relative timestamp
  const formatTime = (dateStr?: string) => {
    if (!dateStr) return "recently";
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

      if (diffDays === 0) return `today at ${timeStr}`;
      if (diffDays === 1) return `yesterday at ${timeStr}`;
      return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${timeStr}`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto my-auto px-4 py-8 animate-in fade-in zoom-in-95 duration-200">
      <div className="relative overflow-hidden rounded-3xl bg-[#FAF9F6] border border-slate-200/90 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.08)] p-6 sm:p-10">
        {/* Subtle decorative atmosphere */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 rounded-full bg-[#B7FF72]/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 rounded-full bg-slate-200/30 blur-3xl pointer-events-none" />

        {/* 1. Header with Doctor Card & Status */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200/80 relative z-10">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              {doctor.avatarUrl ? (
                <img
                  src={doctor.avatarUrl}
                  alt={doctor.name}
                  className="w-14 h-14 rounded-2xl object-cover border border-slate-200 shadow-xs"
                />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white font-bold flex items-center justify-center text-lg">
                  {doctor.name.charAt(0)}
                </div>
              )}
              <span className="absolute -bottom-1 -right-1 p-1 rounded-full bg-[#18251D] text-[#B7FF72] shadow-xs border border-white">
                <PauseCircle className="w-3.5 h-3.5" />
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#18251D] text-white border border-slate-700 shadow-2xs">
                  <Clock className="w-3 h-3 text-[#B7FF72]" />
                  {categories.isFollowUp ? "Linked Follow-Up Active" : "Consultation Restored"}
                </span>
                <span className="text-xs font-mono text-slate-400">· {consultation.id}</span>
              </div>
              <h2 className="text-lg font-bold text-slate-950 leading-tight">
                {doctor.name}
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {doctor.specialty} · {doctor.department || "MedVoice Telehealth"}
              </p>
            </div>
          </div>

          <div className="self-start sm:self-auto text-right">
            <span className="text-xs text-slate-400 font-medium block">
              Saved {formatTime(consultation.createdAt)}
            </span>
            <span className="text-[11px] text-slate-500 font-medium">
              {turnCount} dialogue turns captured
            </span>
          </div>
        </div>

        {/* 2. Welcome Back & Clinical Grounding Header */}
        <div className="py-6 space-y-4 relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight">
                {categories.recapTitle}
              </h1>
              <p className="text-sm text-slate-600 mt-0.5">
                {categories.recapSubtitle}
              </p>
            </div>

            {/* Toggle Chronology View Button */}
            <button
              onClick={() => setShowChronology(!showChronology)}
              className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 shadow-2xs transition-all cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>{showChronology ? "Show 4 Category Cards" : "View Dialogue Chronology"}</span>
            </button>
          </div>

          {/* 3. Visual Recap or Chronology Display */}
          {showChronology ? (
            <SymptomChronology
              encounterId={consultation.id}
              transcript={consultation.transcript}
              detectedSymptoms={consultation.detectedSymptoms}
              slots={consultation.interviewState?.slots}
              historicalSymptoms={
                categories.previouslyReported
                  .filter((item) => item.domain === "historical_symptom")
                  .map((item) => item.value || "")
              }
            />
          ) : (
            <VisualRecap consultation={consultation} categories={categories} />
          )}

          {/* 4. Symptom Update & Review Drawer */}
          <SymptomUpdateDrawer
            isOpen={isReviewOpen}
            onClose={() => setIsReviewOpen(false)}
            transcript={consultation.transcript}
            doctorName={doctor.name}
            onApplyTextCorrection={onApplyTextCorrection}
          />
        </div>

        {/* 5. Action Buttons & Mic Protection */}
        <div className="pt-2 pb-4 space-y-4 relative z-10 border-t border-slate-200/80">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Primary Action: Explicit Patient Confirmation to Resume */}
            <button
              onClick={onContinueWithVoice}
              className="sm:col-span-1 flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl text-xs sm:text-sm font-bold bg-slate-950 hover:bg-slate-800 text-white transition-all shadow-md hover:shadow-lg cursor-pointer group"
            >
              <span>Proceed to Consultation</span>
              <ArrowRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
            </button>

            {/* Action 2: Review Dialogue & Add Addendum */}
            <button
              onClick={() => setIsReviewOpen(!isReviewOpen)}
              className="flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold bg-white hover:bg-slate-50 text-slate-800 border border-slate-200/90 transition-all cursor-pointer shadow-2xs"
            >
              <MessageSquare className="w-4 h-4 text-slate-500" />
              <span>{isReviewOpen ? "Hide Review" : "Review or Add Addendum"}</span>
            </button>

            {/* Action 3: Listen to Voice Recap via Kokoro */}
            <button
              onClick={isRecapAudioPlaying ? onStopRecapAudio : onListenToRecap}
              className={`flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold transition-all cursor-pointer border shadow-2xs ${
                isRecapAudioPlaying
                  ? "bg-emerald-50 text-emerald-800 border-emerald-300 animate-pulse"
                  : "bg-white hover:bg-slate-50 text-slate-800 border-slate-200/90"
              }`}
            >
              {isRecapAudioPlaying ? (
                <>
                  <VolumeX className="w-4 h-4 text-emerald-700" />
                  <span>Stop Voice Recap</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4 text-slate-600" />
                  <span>Listen to Voice Recap</span>
                </>
              )}
            </button>
          </div>

          {/* Privacy & Safety Gate Reassurance */}
          <div className="flex items-center justify-center gap-2 pt-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-slate-700 border border-slate-200/80 font-medium shadow-2xs">
              <MicOff className="w-3.5 h-3.5 text-slate-500" />
              Microphone is strictly OFF. Audio is only acquired after clicking "Proceed to Consultation".
            </span>
          </div>
        </div>

        {/* 6. Footer Options */}
        <div className="pt-6 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-500">
          <Link
            href="/history"
            className="hover:text-slate-800 font-medium transition-colors"
          >
            ← Return to History Hub
          </Link>

          <button
            onClick={onStartNewConsultation}
            className="hover:text-slate-900 font-medium underline underline-offset-2 transition-colors cursor-pointer"
          >
            Start a separate consultation instead
          </button>
        </div>
      </div>
    </div>
  );
}
