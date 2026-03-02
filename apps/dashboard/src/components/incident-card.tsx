"use client";

import Link from "next/link";
import { severityColor, stateColor, timeAgo } from "@/lib/utils";
import type { Incident } from "@/lib/api";

export default function IncidentCard({ incident }: { incident: Incident }) {
  return (
    <Link
      href={`/incidents/${incident.id}`}
      className="block rounded-xl border border-slate-700 bg-slate-800/50 p-4 transition hover:border-slate-600 hover:bg-slate-800"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${severityColor(incident.severity)}`}
            >
              {incident.severity}
            </span>
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${stateColor(incident.state)}`}
            >
              {incident.state}
            </span>
          </div>
          <h4 className="truncate text-sm font-medium text-slate-200">
            {incident.title}
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            {incident.service} · {timeAgo(incident.created_at)}
            {incident.assigned_to && ` · ${incident.assigned_to}`}
          </p>
        </div>
        {incident.request_traces && incident.request_traces.length > 0 && (
          <span className="shrink-0 rounded bg-slate-700 px-2 py-1 text-[10px] text-slate-400">
            {incident.request_traces.length} trace
            {incident.request_traces.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </Link>
  );
}
