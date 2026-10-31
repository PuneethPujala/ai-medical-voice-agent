"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  Send,
  CheckCircle2,
  ShieldCheck,
  X,
  FileEdit,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

interface SymptomUpdateDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  transcript?: Array<{ id?: string; role: string; text: string; timestamp?: string }>;
  doctorName: string;
  onApplyTextCorrection?: (
    text: string,
    targetTurnId?: string
  ) => Promise<{ success: boolean; error?: string } | void> | void;
}

export function SymptomUpdateDrawer({
  isOpen,
  onClose,
  transcript = [],
  doctorName,
  onApplyTextCorrection,
}: SymptomUpdateDrawerProps) {
  const [correctionText, setCorrectionText] = useState("");
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!correctionText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setConflictError(null);

    try {
      if (onApplyTextCorrection) {
        const result = await onApplyTextCorrection(
          correctionText.trim(),
          selectedTurnId || undefined
        );

        if (result && typeof result === "object" && !result.success) {
          // Invariant 10: CAS Conflict preserves unsaved patient correction input
          setConflictError(
            result.error ||
              "Concurrency Conflict (409): Encounter was modified in another session. Your draft text has been preserved below. Please click retry to record."
          );
          setIsSubmitting(false);
          return;
        }
      }

      setIsSaved(true);
      setTimeout(() => {
        setIsSaved(false);
        setCorrectionText("");
        setSelectedTurnId(null);
      }, 2500);
    } catch (err: any) {
      console.warn("[MedVoice] Error submitting patient amendment:", err);
      // Invariant: Always preserve draft text on error
      setConflictError(
        "Persistence notice: Could not link amendment immediately. Your input is preserved. Click to retry."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="pt-4 border-t border-slate-100 overflow-hidden"
        >
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileEdit className="w-4 h-4 text-slate-700" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Review Immutable Dialogue & Record Amendment
                </h4>
              </div>
              <span className="text-xs text-slate-500 flex items-center gap-1 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Original turns immutable · Typed addenda appended
              </span>
            </div>

            {/* Saved immutable dialogue turns */}
            <div className="max-h-60 overflow-y-auto rounded-2xl bg-slate-50 p-4 border border-slate-200/70 space-y-3">
              {transcript.length > 0 ? (
                transcript.map((msg, idx) => {
                  const turnId = msg.id || `turn-${idx}`;
                  const isSelected = selectedTurnId === turnId;

                  return (
                    <div
                      key={turnId}
                      onClick={() =>
                        msg.role === "patient" &&
                        setSelectedTurnId(isSelected ? null : turnId)
                      }
                      className={`text-xs p-3 rounded-xl transition-all cursor-pointer ${
                        msg.role === "doctor"
                          ? "bg-white text-slate-800 border border-slate-200/60 mr-8"
                          : msg.role === "patient"
                          ? isSelected
                            ? "bg-slate-900 text-white ml-8 ring-2 ring-emerald-400 shadow-sm"
                            : "bg-slate-800 text-slate-100 ml-8 hover:bg-slate-900"
                          : "bg-slate-100 text-slate-500 text-center text-[11px]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-bold text-[10px] opacity-75">
                          {msg.role === "doctor"
                            ? doctorName
                            : msg.role === "patient"
                            ? "You (Click to link amendment to this turn)"
                            : "System"}
                        </span>
                        {msg.timestamp && (
                          <span className="text-[10px] opacity-60 font-mono">
                            {msg.timestamp}
                          </span>
                        )}
                      </div>
                      <p>{msg.text}</p>
                      {isSelected && (
                        <div className="mt-2 text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Amendment will link to Turn #{idx + 1} ({turnId})</span>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">
                  No saved dialogue turns in this encounter.
                </p>
              )}
            </div>

            {/* Symptom addendum input */}
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl bg-white border border-slate-200 p-4 shadow-2xs space-y-3"
            >
              <div className="flex items-center justify-between">
                <label
                  htmlFor="symptom-update-input"
                  className="block text-xs font-bold text-slate-800"
                >
                  Record symptom amendment or update:
                </label>
                {selectedTurnId ? (
                  <button
                    type="button"
                    onClick={() => setSelectedTurnId(null)}
                    className="text-[11px] text-slate-500 hover:text-slate-800 font-medium underline cursor-pointer"
                  >
                    Clear turn link (amend general intake)
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-400">
                    Tip: Click any patient turn above to target a specific statement
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="symptom-update-input"
                  type="text"
                  value={correctionText}
                  onChange={(e) => setCorrectionText(e.target.value)}
                  placeholder={
                    selectedTurnId
                      ? `Correcting selected turn: ${selectedTurnId}...`
                      : "e.g. The pressure has now moved towards my left arm..."
                  }
                  className="flex-1 px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <button
                  type="submit"
                  disabled={!correctionText.trim() || isSubmitting}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-950 text-white hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? "Recording..." : "Append Addendum"}</span>
                </button>
              </div>

              {/* Conflict / Error State with preserved input */}
              {conflictError && (
                <div className="flex items-start gap-2 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 p-3 rounded-xl animate-in fade-in">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p>{conflictError}</p>
                    <p className="text-[11px] text-amber-800/80 mt-1">
                      Your draft is safe above. Click "Append Addendum" again to retry.
                    </p>
                  </div>
                </div>
              )}

              {/* Success Notification */}
              {isSaved && (
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Provenance-tracked addendum appended to consultation record. Original turns preserved unmutated.
                  </span>
                </div>
              )}
            </form>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
