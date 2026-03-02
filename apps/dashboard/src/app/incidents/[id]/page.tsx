"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  fetchIncident,
  transitionIncident,
  type Incident,
} from "@/lib/api";
import {
  severityColor,
  stateColor,
  timeAgo,
  formatDuration,
} from "@/lib/utils";

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    fetchIncident(id).then(setIncident).catch((e) => setError(e.message));
  }, [id]);

  const doTransition = async (action: string) => {
    setTransitioning(true);
    try {
      const updated = await transitionIncident(id, action);
      setIncident(updated);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTransitioning(false);
    }
  };

  if (error) {
    return (
      <div className="rounded-lg bg-red-900/30 px-4 py-8 text-center text-red-300">
        {error}
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="py-12 text-center text-slate-500">Loading incident...</div>
    );
  }

  const actions = getAvailableActions(incident.state);

  return (
    <div className="space-y-6">
      {/* Back + title */}
      <div>
        <button
          onClick={() => router.push("/incidents")}
          className="mb-3 text-sm text-slate-500 hover:text-slate-300"
        >
          ← Back to incidents
        </button>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase ${severityColor(incident.severity)}`}
          >
            {incident.severity}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase ${stateColor(incident.state)}`}
          >
            {incident.state}
          </span>
          <h1 className="text-lg font-bold text-slate-200">
            {incident.title}
          </h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {incident.service} · Created {timeAgo(incident.created_at)}
          {incident.assigned_to && ` · Assigned to ${incident.assigned_to}`}
          {incident.mttr_seconds != null && (
            <> · MTTR: {formatDuration(incident.mttr_seconds)}</>
          )}
        </p>
      </div>

      {/* Actions */}
      {actions.length > 0 && (
        <div className="flex gap-2">
          {actions.map((a) => (
            <button
              key={a.action}
              onClick={() => doTransition(a.action)}
              disabled={transitioning}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${a.className} disabled:opacity-50`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Description */}
      {incident.description && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <h3 className="mb-2 text-sm font-medium text-slate-400">
            Description
          </h3>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">
            {incident.description}
          </p>
        </div>
      )}

      {/* Affected services */}
      {incident.affected_services && incident.affected_services.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <h3 className="mb-2 text-sm font-medium text-slate-400">
            Affected Services
          </h3>
          <div className="flex flex-wrap gap-2">
            {incident.affected_services.map((svc) => (
              <span
                key={svc}
                className="rounded-lg bg-slate-700 px-3 py-1 text-xs text-slate-300"
              >
                {svc}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Request Traces */}
      {incident.request_traces && incident.request_traces.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
          <div className="border-b border-slate-700 px-4 py-3">
            <h3 className="text-sm font-medium text-slate-400">
              Request Traces ({incident.request_traces.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-700/50">
            {incident.request_traces.map((trace, ti) => (
              <div key={ti} className="p-4">
                <p className="mb-2 font-mono text-xs text-slate-500">
                  trace_id: {trace.trace_id}
                </p>
                <div className="space-y-1">
                  {trace.spans.map((span, si) => (
                    <div
                      key={si}
                      className="flex items-center gap-3 rounded-lg bg-slate-900/50 px-3 py-2"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          span.status === "OK" || span.status === "200"
                            ? "bg-green-500"
                            : "bg-red-500"
                        }`}
                      />
                      <span className="text-xs font-medium text-slate-300">
                        {span.service}
                      </span>
                      <span className="text-xs text-slate-500">
                        {span.operation}
                      </span>
                      <span className="ml-auto font-mono text-xs text-slate-400">
                        {span.duration_ms}ms
                      </span>
                      <span
                        className={`text-xs ${span.error ? "text-red-400" : "text-green-400"}`}
                      >
                        {span.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      {incident.timeline && incident.timeline.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
          <h3 className="mb-3 text-sm font-medium text-slate-400">Timeline</h3>
          <div className="relative border-l border-slate-700 pl-6 space-y-4">
            {incident.timeline.map((entry, i) => (
              <div key={i} className="relative">
                <div className="absolute -left-[29px] top-1 h-3 w-3 rounded-full border-2 border-slate-700 bg-slate-600" />
                <p className="text-xs text-slate-500">
                  {new Date(entry.timestamp).toLocaleString()} ·{" "}
                  {entry.actor}
                </p>
                <p className="text-sm text-slate-300">{entry.action}</p>
                {entry.note && (
                  <p className="mt-0.5 text-xs text-slate-500">{entry.note}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getAvailableActions(state: string) {
  switch (state) {
    case "triggered":
      return [
        {
          action: "acknowledge",
          label: "Acknowledge",
          className: "bg-yellow-600 text-white hover:bg-yellow-700",
        },
        {
          action: "resolve",
          label: "Resolve",
          className: "bg-green-600 text-white hover:bg-green-700",
        },
      ];
    case "acknowledged":
      return [
        {
          action: "investigate",
          label: "Start Investigation",
          className: "bg-blue-600 text-white hover:bg-blue-700",
        },
        {
          action: "resolve",
          label: "Resolve",
          className: "bg-green-600 text-white hover:bg-green-700",
        },
      ];
    case "investigating":
      return [
        {
          action: "resolve",
          label: "Resolve",
          className: "bg-green-600 text-white hover:bg-green-700",
        },
      ];
    default:
      return [];
  }
}
