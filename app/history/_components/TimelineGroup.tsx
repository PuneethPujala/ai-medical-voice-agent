"use client";

import React from "react";
import { Calendar } from "lucide-react";
import type { ConsultationItem } from "../page";

export type TimelinePeriod = "today" | "yesterday" | "this_week" | "earlier";

export interface TimelineGroupProps {
  title: string;
  count: number;
  period: TimelinePeriod;
  children: React.ReactNode;
}

export function groupConsultationsByPeriod(items: ConsultationItem[]): Record<TimelinePeriod, ConsultationItem[]> {
  const groups: Record<TimelinePeriod, ConsultationItem[]> = {
    today: [],
    yesterday: [],
    this_week: [],
    earlier: [],
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfThisWeek = startOfToday - 6 * 86400000;

  for (const item of items) {
    const itemTime = new Date(item.createdAt).getTime();
    if (isNaN(itemTime)) {
      groups.earlier.push(item);
    } else if (itemTime >= startOfToday) {
      groups.today.push(item);
    } else if (itemTime >= startOfYesterday) {
      groups.yesterday.push(item);
    } else if (itemTime >= startOfThisWeek) {
      groups.this_week.push(item);
    } else {
      groups.earlier.push(item);
    }
  }

  return groups;
}

export function TimelineGroup({ title, count, period, children }: TimelineGroupProps) {
  if (count === 0) return null;

  return (
    <section aria-label={`${title} consultations`} className="space-y-3 mb-8">
      <div className="flex items-center justify-between px-1 border-b border-slate-200/80 pb-2">
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-slate-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {title}
          </h3>
        </div>
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
          {count} {count === 1 ? "record" : "records"}
        </span>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </section>
  );
}
