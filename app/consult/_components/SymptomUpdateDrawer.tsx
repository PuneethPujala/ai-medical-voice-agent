"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Send, CheckCircle2, ShieldCheck, X, FileEdit } from "lucide-react";

interface SymptomUpdateDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  transcript?: Array<{ role: string; text: string; timestamp?: string }>;
  doctorName: string;
  onApplyTextCorrection?: (text: string) => void;
}

export function SymptomUpdateDrawer({
  isOpen,
  onClose,
  transcript = [],
  doctorName,
  onApplyTextCorrection,
}: SymptomUpdateDrawerProps) {
  const [correctionText, setCorrectionText] = useState("");
  const [isSaved, setIsSaved] = useState(false);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!correctionText.trim()) return;

    if (onApplyTextCorrection) {
      onApplyTextCorrection(correctionText.trim());
    }

    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
      setCorrectionText("");
    }, 2500);
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileEdit className="w-4 h-4 text-slate-700" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Review Dialogue & Append Addendum
                </h4>
              </div>
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Prior turns immutable · Addenda appended
              </span>
            </div>

            {/* Saved conversation turns */}
            <div className="max-h-60 overflow-y-auto rounded-2xl bg-slate-50 p-4 border border-slate-200/70 space-y-3">
              {transcript.length > 0 ? (
                transcript.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`text-xs p-3 rounded-xl ${
                      msg.role === "doctor"
                        ? "bg-white text-slate-800 border border-slate-200/60 mr-8"
                        : msg.role === "patient"
                        ? "bg-slate-900 text-white ml-8"
                        : "bg-slate-100 text-slate-500 text-center text-[11px]"
                    }`}
                  >
                    <span className="font-bold block text-[10px] opacity-75 mb-0.5">
                      {msg.role === "doctor" ? doctorName : msg.role === "patient" ? "You" : "System"}
                    </span>
                    {msg.text}
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400 text-center py-4">
                  No saved dialogue turns in this encounter.
                </p>
              )}
            </div>

            {/* Symptom addendum input */}
            <form onSubmit={handleSubmit} className="rounded-2xl bg-white border border-slate-200 p-4 shadow-2xs space-y-2">
              <label htmlFor="symptom-update-input" className="block text-xs font-bold text-slate-800">
                Update or correct your symptoms:
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="symptom-update-input"
                  type="text"
                  value={correctionText}
                  onChange={(e) => setCorrectionText(e.target.value)}
                  placeholder="e.g. The pressure has now moved towards my left arm..."
                  className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
                <button
                  type="submit"
                  disabled={!correctionText.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-950 text-white hover:bg-slate-800 disabled:opacity-50 transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Append Addendum</span>
                </button>
              </div>

              {isSaved && (
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 p-2 rounded-xl mt-2 animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Provenance-tracked addendum appended to consultation record.</span>
                </div>
              )}
            </form>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
