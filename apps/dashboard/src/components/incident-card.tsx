"use client";

import Link from "next/link";
import { severityColor, stateColor, timeAgo } from "@/lib/utils";
import type { Incident } from "@/lib/api";
import { ChevronRight, GitBranch, Clock, User, Brain, Repeat, Zap } from "lucide-react";

export default function IncidentCard({ incident }: { incident: Incident }) {
  return (
    <Link
      href={`/incidents/${incident.id}`}
      className="card-hover group block rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] sm:p-5"
    >
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5 sm:mb-2.5 sm:gap-2">
            <span
              className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${severityColor(incident.severity)}`}
            >
              {incident.severity}
            </span>
            <span
              className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${stateColor(incident.state)}`}
            >
              {incident.state}
            </span>
            {incident.priority && (
              <span className="rounded-md bg-[#f5f5f7] px-1.5 py-0.5 text-[10px] font-medium text-[#aeaeb2]">
                {incident.priority}
              </span>
            )}
            {incident.root_cause && (
              <span className="flex items-center gap-0.5 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-600">
                <Brain className="h-2.5 w-2.5" />
                AI
              </span>
            )}
            {incident.similar_count != null && incident.similar_count > 0 && (
              <span className="flex items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
                <Repeat className="h-2.5 w-2.5" />
                {incident.similar_count}
              </span>
            )}
          </div>
          <h4 className="truncate text-[13px] font-semibold text-[#1d1d1f] group-hover:text-[#FF5722] transition-colors sm:text-[14px]">
            {incident.title}
          </h4>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[#aeaeb2] sm:mt-2 sm:gap-3 sm:text-[12px]">
            <span className="font-medium text-[#6e6e73]">{incident.service}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo(incident.created_at)}
            </span>
            {incident.assigned_to && (
              <span className="hidden items-center gap-1 sm:flex">
                <User className="h-3 w-3" />
                {incident.assigned_to}
              </span>
            )}
            {incident.custom_fields?.root_cause_service && (
              <span className="hidden items-center gap-1 text-red-500 sm:flex">
                <Zap className="h-3 w-3" />
                root: {incident.custom_fields.root_cause_service}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {incident.request_traces && incident.request_traces.length > 0 && (
            <span className="hidden items-center gap-1 rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[10px] font-medium text-[#6e6e73] sm:flex">
              <GitBranch className="h-3 w-3" />
              {incident.request_traces.length}
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-[#d1d1d6] transition-all group-hover:translate-x-0.5 group-hover:text-[#FF5722]" />
        </div>
      </div>
    </Link>
  );
}
