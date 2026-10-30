"use client";

import React, { useState, useEffect, useRef } from "react";
import { Send, RotateCcw, X, Edit2, CheckCircle2, ShieldCheck } from "lucide-react";

interface TranscriptReviewBarProps {
  initialTranscript: string;
  onSend: (correctedText: string) => void;
  onReRecord: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export function TranscriptReviewBar({
  initialTranscript,
  onSend,
  onReRecord,
  onCancel,
  isSubmitting = false,
}: TranscriptReviewBarProps) {
  const [editedText, setEditedText] = useState(initialTranscript);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditedText(initialTranscript);
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [initialTranscript]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (editedText.trim() && !isSubmitting) {
        onSend(editedText.trim());
      }
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className="relative rounded-2xl bg-white border-2 border-[#18251D] p-4 sm:p-5 shadow-xl transition-all">
      {/* Header ribbon */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-[#18251D] text-[#B7FF72] flex items-center justify-center">
            <Edit2 className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-extrabold text-[#05070F]">
              Review & Approve Spoken Transcript
            </h4>
            <span className="text-[11px] text-slate-500 font-medium">
              Verify medical symptoms and timeline accuracy before sending
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          title="Discard transcript"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Editable Transcript Area */}
      <div className="my-3">
        <textarea
          ref={inputRef}
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={isSubmitting}
          placeholder="Speak or edit your symptoms here..."
          className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-sm sm:text-base text-slate-900 font-medium leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-[#18251D] focus:border-transparent"
        />
      </div>

      {/* Safety Note & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>Press Enter to send · Escape to cancel</span>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={onReRecord}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            <span>Re-record</span>
          </button>

          <button
            type="button"
            onClick={() => editedText.trim() && onSend(editedText.trim())}
            disabled={!editedText.trim() || isSubmitting}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-white transition-all cursor-pointer shadow-sm ${
              !editedText.trim() || isSubmitting
                ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                : "bg-[#18251D] hover:bg-[#05070F] text-[#B7FF72] hover:shadow-md"
            }`}
          >
            <span>Send to Doctor</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default TranscriptReviewBar;
