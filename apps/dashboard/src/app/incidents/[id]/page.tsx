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
import {
  ArrowLeft,
  GitBranch,
  Clock,
  CheckCircle2,
  Eye,
  Search,
  AlertCircle,
  Loader2,
  User,
  Server,
  Zap,
  Brain,
  Tag,
  Repeat,
  ArrowRight,
  Shield,
  Lightbulb,
} from "lucide-react";

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
      <div className="animate-fade-in flex items-center gap-2.5 rounded-xl bg-red-50 px-4 py-8 text-[13px] font-medium text-red-500">
        <AlertCircle className="mx-auto h-5 w-5" />
        {error}
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[#aeaeb2]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading incident...
      </div>
    );
  }

  const actions = getAvailableActions(incident.state);

  return (
    <div className="animate-fade-in-up space-y-6">
      {/* Back + header */}
      <div>
        <button
          onClick={() => router.push("/incidents")}
          className="mb-4 flex items-center gap-1.5 text-[13px] text-[#6e6e73] transition-colors hover:text-[#1d1d1f]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to incidents
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-md px-2.5 py-1 text-[11px] font-bold uppercase ${severityColor(incident.severity)}`}
          >
            {incident.severity}
          </span>
          <span
            className={`rounded-md px-2.5 py-1 text-[11px] font-bold uppercase ${stateColor(incident.state)}`}
          >
            {incident.state}
          </span>
          {incident.priority && (
            <span className="rounded-md bg-[#f5f5f7] px-2 py-1 text-[11px] font-medium text-[#aeaeb2]">
              {incident.priority}
            </span>
          )}
          {incident.root_cause && (
            <span className="flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1 text-[11px] font-bold uppercase text-violet-600">
              <Brain className="h-3 w-3" />
              AI-Analyzed
            </span>
          )}
          {incident.similar_count != null && incident.similar_count > 0 && (
            <span className="flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-600">
              <Repeat className="h-3 w-3" />
              {incident.similar_count} similar
            </span>
          )}
          {incident.custom_fields?.error_category && (
            <span className="rounded-md bg-[#f5f5f7] px-2 py-1 text-[11px] font-medium text-[#6e6e73]">
              {incident.custom_fields.error_category}
            </span>
          )}
        </div>
        <h1 className="mt-2 text-[16px] font-bold tracking-tight text-[#1d1d1f] sm:text-[20px]">
          {incident.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-[#6e6e73]">
          <span className="flex items-center gap-1">
            <Server className="h-3.5 w-3.5" />
            {incident.service}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {timeAgo(incident.created_at)}
          </span>
          {incident.assigned_to && (
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              {incident.assigned_to}
            </span>
          )}
          {incident.mttr_seconds != null && (
            <span className="font-mono text-[#FF5722]">
              MTTR: {formatDuration(incident.mttr_seconds)}
            </span>
          )}
        </div>
        {incident.tags && incident.tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {incident.tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-medium text-[#6e6e73]"
              >
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.action}
                onClick={() => doTransition(a.action)}
                disabled={transitioning}
                className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-medium transition-all duration-200 sm:flex-initial sm:px-5 ${a.className} disabled:opacity-50 active:scale-[0.98]`}
              >
                {transitioning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                {a.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Description */}
      {incident.description && (
        <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            Description
          </h3>
          <p className="text-[14px] leading-relaxed text-[#1d1d1f] whitespace-pre-wrap">
            {incident.description}
          </p>
        </div>
      )}

      {/* Affected services */}
      {incident.affected_services && incident.affected_services.length > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            Affected Services
          </h3>
          <div className="flex flex-wrap gap-2">
            {incident.affected_services.map((svc) => (
              <span
                key={svc}
                className="flex items-center gap-1.5 rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[12px] font-medium text-[#1d1d1f]"
              >
                <Server className="h-3 w-3 text-[#aeaeb2]" />
                {svc}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Causal Chain + Blast Radius */}
      {incident.custom_fields?.causal_chain && incident.custom_fields.causal_chain.length > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between">
            <h3 className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
              <Zap className="h-3.5 w-3.5 text-[#FF5722]" />
              Causal Chain
            </h3>
            {incident.custom_fields.blast_radius?.impact_score != null && (
              <div className="mb-4 flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-[#aeaeb2]" />
                <span className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                  Blast Radius
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${
                    incident.custom_fields.blast_radius.impact_score >= 0.6
                      ? "bg-red-50 text-red-600"
                      : incident.custom_fields.blast_radius.impact_score >= 0.3
                        ? "bg-amber-50 text-amber-600"
                        : "bg-emerald-50 text-emerald-600"
                  }`}
                >
                  {Math.round(incident.custom_fields.blast_radius.impact_score * 100)}%
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {incident.custom_fields.causal_chain.map((svc, i) => (
              <div key={i} className="flex items-center gap-1">
                <span
                  className={`rounded-lg px-3 py-1.5 text-[12px] font-medium ${
                    i === 0
                      ? "bg-red-50 text-red-700 ring-1 ring-red-200"
                      : "bg-[#f5f5f7] text-[#1d1d1f]"
                  }`}
                >
                  {i === 0 && <span className="mr-1 text-[10px] font-bold uppercase text-red-500">root</span>}
                  {svc}
                </span>
                {i < incident.custom_fields!.causal_chain!.length - 1 && (
                  <ArrowRight className="h-3.5 w-3.5 text-[#aeaeb2]" />
                )}
              </div>
            ))}
          </div>
          {incident.custom_fields.blast_radius?.affected_downstream &&
            incident.custom_fields.blast_radius.affected_downstream.length > 0 && (
              <p className="mt-3 text-[12px] text-[#6e6e73]">
                <span className="font-medium">Downstream impact:</span>{" "}
                {incident.custom_fields.blast_radius.affected_downstream.join(", ")}
                {incident.custom_fields.blast_radius.estimated_user_impact && (
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      incident.custom_fields.blast_radius.estimated_user_impact === "high"
                        ? "bg-red-50 text-red-600"
                        : incident.custom_fields.blast_radius.estimated_user_impact === "medium"
                          ? "bg-amber-50 text-amber-600"
                          : "bg-emerald-50 text-emerald-600"
                    }`}
                  >
                    {incident.custom_fields.blast_radius.estimated_user_impact} user impact
                  </span>
                )}
              </p>
            )}
        </div>
      )}

      {/* AI Root Cause Analysis */}
      {incident.root_cause && (
        <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            <Brain className="h-3.5 w-3.5 text-violet-500" />
            Root Cause Analysis
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-500">
              AI
            </span>
          </h3>
          <p className="text-[14px] leading-relaxed text-[#1d1d1f] whitespace-pre-wrap">
            {incident.root_cause}
          </p>
        </div>
      )}

      {/* AI Impact + Suggested Fix */}
      {(incident.impact || incident.custom_fields?.suggested_fix) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {incident.impact && (
            <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
              <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                Impact Assessment
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-500">
                  AI
                </span>
              </h3>
              <p className="text-[13px] leading-relaxed text-[#1d1d1f]">
                {incident.impact}
              </p>
            </div>
          )}
          {incident.custom_fields?.suggested_fix && (
            <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
              <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                <Lightbulb className="h-3.5 w-3.5 text-emerald-500" />
                Suggested Fix
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-500">
                  AI
                </span>
              </h3>
              <p className="text-[13px] leading-relaxed text-[#1d1d1f]">
                {incident.custom_fields.suggested_fix}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Reproduce Steps */}
      {incident.reproduce_steps && incident.reproduce_steps.length > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            <Search className="h-3.5 w-3.5 text-[#aeaeb2]" />
            Steps to Reproduce
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-500">
              AI
            </span>
          </h3>
          <ol className="space-y-1.5 pl-4">
            {incident.reproduce_steps.map((step, i) => (
              <li
                key={i}
                className="list-decimal text-[13px] leading-relaxed text-[#1d1d1f] marker:text-[#aeaeb2] marker:font-medium"
              >
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Request Traces */}
      {incident.request_traces && incident.request_traces.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-2 border-b border-[#f2f2f7] px-5 py-3.5">
            <GitBranch className="h-4 w-4 text-[#aeaeb2]" />
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
              Request Traces ({incident.request_traces.length})
            </h3>
          </div>
          <div className="divide-y divide-[#f2f2f7]">
            {incident.request_traces.map((trace, ti) => (
              <div key={ti} className="p-5">
                <p className="mb-3 font-mono text-[11px] text-[#aeaeb2]">
                  trace_id: {trace.trace_id}
                </p>
                {trace.logs && trace.logs.length > 0 && (
                  <div className="space-y-1.5">
                    {trace.logs.map((log, li) => (
                      <div
                        key={li}
                        className="flex items-center gap-3 rounded-xl bg-[#fafafa] px-3.5 py-2.5"
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            log.level === "ERROR" || log.level === "FATAL"
                              ? "bg-red-500"
                              : log.level === "WARN"
                                ? "bg-amber-400"
                                : "bg-emerald-500"
                          }`}
                        />
                        <span className="text-[12px] font-medium text-[#6e6e73]">
                          {log.service}
                        </span>
                        <span className="flex-1 truncate text-[12px] text-[#aeaeb2]">
                          {log.message}
                        </span>
                        {log.duration_ms != null && log.duration_ms > 0 && (
                          <span className="font-mono text-[11px] text-[#aeaeb2]">
                            {log.duration_ms}ms
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {trace.spans && trace.spans.length > 0 && (
                  <div className="space-y-1.5">
                    {trace.spans.map((span, si) => (
                      <div
                        key={si}
                        className="flex items-center gap-3 rounded-xl bg-[#fafafa] px-3.5 py-2.5"
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            span.status === "OK" || span.status === "200"
                              ? "bg-emerald-500"
                              : "bg-red-500"
                          }`}
                        />
                        <span className="text-[12px] font-medium text-[#1d1d1f]">
                          {span.service}
                        </span>
                        <span className="text-[12px] text-[#aeaeb2]">
                          {span.operation}
                        </span>
                        <span className="ml-auto font-mono text-[11px] text-[#aeaeb2]">
                          {span.duration_ms}ms
                        </span>
                        <span
                          className={`text-[12px] font-medium ${span.error ? "text-red-500" : "text-emerald-500"}`}
                        >
                          {span.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      {incident.timeline && incident.timeline.length > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <h3 className="mb-5 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            Timeline
          </h3>
          <div className="relative border-l-2 border-[#e5e5ea] pl-6 space-y-5">
            {incident.timeline.map((entry, i) => (
              <div key={i} className="relative">
                <div className="absolute -left-[29px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-[#e5e5ea] bg-white">
                  <div className="h-1.5 w-1.5 rounded-full bg-[#FF5722]" />
                </div>
                <p className="text-[11px] text-[#aeaeb2]">
                  {new Date(entry.timestamp).toLocaleString()} · {entry.actor}
                </p>
                <p className="mt-0.5 text-[14px] font-medium text-[#1d1d1f]">
                  {entry.action}
                </p>
                {entry.note && (
                  <p className="mt-0.5 text-[12px] text-[#6e6e73]">
                    {entry.note}
                  </p>
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
    case "identified":
      return [
        {
          action: "acknowledge",
          label: "Acknowledge",
          icon: Eye,
          className:
            "bg-amber-500 text-white shadow-sm shadow-amber-500/20 hover:bg-amber-400",
        },
        {
          action: "resolve",
          label: "Resolve",
          icon: CheckCircle2,
          className:
            "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 hover:bg-emerald-400",
        },
      ];
    case "acknowledged":
      return [
        {
          action: "investigate",
          label: "Start Investigation",
          icon: Search,
          className:
            "bg-[#FF5722] text-white shadow-sm shadow-orange-500/20 hover:bg-[#E64A19]",
        },
        {
          action: "resolve",
          label: "Resolve",
          icon: CheckCircle2,
          className:
            "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 hover:bg-emerald-400",
        },
      ];
    case "investigating":
    case "mitigated":
      return [
        {
          action: "resolve",
          label: "Resolve",
          icon: CheckCircle2,
          className:
            "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 hover:bg-emerald-400",
        },
      ];
    default:
      return [];
  }
}
