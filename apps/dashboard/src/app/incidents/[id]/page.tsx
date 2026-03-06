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
import { IncidentDetailSkeleton } from "@/components/skeleton";
import { ErrorBanner } from "@/components/error-boundary";
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
  Activity,
  FileText,
  RefreshCw,
} from "lucide-react";
import SendToServiceDropdown from "@/components/send-to-service";
import CollapsibleSection from "@/components/collapsible-section";

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());

  const reload = () => {
    setError(null);
    setIncident(null);
    fetchIncident(id).then(setIncident).catch((e) => setError(e.message));
  };

  useEffect(() => {
    reload();
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

  const toggleLogExpand = (idx: number) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  /* ── Loading / Error ──────────────────────────────────────── */

  if (error) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push("/incidents")}
          className="flex items-center gap-1.5 text-[13px] text-[#6e6e73] transition-colors hover:text-[#1d1d1f]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to incidents
        </button>
        <ErrorBanner message={error} onRetry={reload} />
      </div>
    );
  }

  if (!incident) {
    return <IncidentDetailSkeleton />;
  }

  const actions = getAvailableActions(incident.state);

  return (
    <div className="animate-fade-in-up mx-auto max-w-4xl space-y-5">

      {/* ────────────────────────────────────────────────────── */}
      {/*  HEADER                                                */}
      {/* ────────────────────────────────────────────────────── */}
      <section>
        <button
          onClick={() => router.push("/incidents")}
          className="mb-5 flex items-center gap-1.5 text-[13px] text-[#6e6e73] transition-colors hover:text-[#1d1d1f]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to incidents
        </button>

        {/* Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-lg px-3 py-1 text-[11px] font-bold uppercase tracking-wide shadow-sm ${severityColor(incident.severity)}`}
          >
            {incident.severity}
          </span>
          <span
            className={`rounded-lg px-3 py-1 text-[11px] font-bold uppercase tracking-wide shadow-sm ${stateColor(incident.state)}`}
          >
            {incident.state.replace(/_/g, " ")}
          </span>
          {incident.priority && (
            <span className="rounded-lg bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#6e6e73]">
              {incident.priority}
            </span>
          )}
          {incident.root_cause && (
            <span className="flex items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1 text-[11px] font-bold uppercase text-violet-600 shadow-sm">
              <Brain className="h-3 w-3" />
              AI-Analyzed
            </span>
          )}
          {incident.custom_fields?.llm_fallback && (
            <span className="flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold uppercase text-amber-600">
              <AlertCircle className="h-3 w-3" />
              No AI Analysis
            </span>
          )}
          {incident.similar_count != null && incident.similar_count > 0 && (
            <span className="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-600">
              <Repeat className="h-3 w-3" />
              {incident.similar_count} similar
            </span>
          )}
          {incident.custom_fields?.error_category && (
            <span className="rounded-lg bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-medium text-[#6e6e73]">
              {incident.custom_fields.error_category}
            </span>
          )}
        </div>

        {/* Title */}
        <h1 className="mt-3 text-[20px] font-bold leading-tight tracking-tight text-[#1d1d1f] sm:text-[24px]">
          {incident.title}
        </h1>

        {/* Meta */}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px] text-[#6e6e73]">
          <span className="flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5 text-[#aeaeb2]" />
            {incident.service}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-[#aeaeb2]" />
            {timeAgo(incident.created_at)}
          </span>
          {incident.assigned_to && (
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-[#aeaeb2]" />
              {incident.assigned_to}
            </span>
          )}
          {incident.mttr_seconds != null && (
            <span className="rounded-lg bg-[#FFF3E0] px-2.5 py-0.5 font-mono text-[12px] font-semibold text-[#FF5722]">
              MTTR {formatDuration(incident.mttr_seconds)}
            </span>
          )}
        </div>

        {/* Anomaly Score Bar */}
        {incident.anomaly_score != null && incident.anomaly_score > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[11px] font-medium text-[#aeaeb2]">Anomaly Score</span>
            <div className="h-2 flex-1 max-w-48 overflow-hidden rounded-full bg-[#f2f2f7]">
              <div
                className={`h-full rounded-full transition-all duration-700 animate-bar-grow ${
                  incident.anomaly_score >= 0.8
                    ? "bg-red-500"
                    : incident.anomaly_score >= 0.5
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(incident.anomaly_score * 100, 100)}%` }}
              />
            </div>
            <span className="font-mono text-[12px] font-semibold text-[#1d1d1f]">
              {(incident.anomaly_score * 100).toFixed(0)}%
            </span>
          </div>
        )}

        {/* Tags */}
        {incident.tags && incident.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {incident.tags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded-full bg-[#f5f5f7] px-3 py-1 text-[11px] font-medium text-[#6e6e73] transition-colors hover:bg-[#e5e5ea]"
              >
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ────────────────────────────────────────────────────── */}
      {/*  ACTION BAR                                            */}
      {/* ────────────────────────────────────────────────────── */}
      <section className="flex flex-wrap items-center gap-2">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.action}
              onClick={() => doTransition(a.action)}
              disabled={transitioning}
              className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium shadow-sm transition-all duration-200 ${a.className} disabled:opacity-50 active:scale-[0.97]`}
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
        <div className="ml-auto">
          <SendToServiceDropdown incidentId={id} onForwarded={reload} />
        </div>
      </section>

      {/* ────────────────────────────────────────────────────── */}
      {/*  DESCRIPTION                                           */}
      {/* ────────────────────────────────────────────────────── */}
      {incident.description && (
        <section className="card-hover rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            <FileText className="h-3.5 w-3.5" />
            Description
          </h3>
          <p className="max-w-prose text-[14px] leading-relaxed text-[#1d1d1f] whitespace-pre-wrap">
            {incident.description}
          </p>
        </section>
      )}

      {/* ────────────────────────────────────────────────────── */}
      {/*  AFFECTED SERVICES                                     */}
      {/* ────────────────────────────────────────────────────── */}
      {incident.affected_services && incident.affected_services.length > 0 && (
        <section className="card-hover rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            <Server className="h-3.5 w-3.5" />
            Affected Services
          </h3>
          <div className="flex flex-wrap gap-2">
            {incident.affected_services.map((svc) => (
              <span
                key={svc}
                className="flex items-center gap-1.5 rounded-full bg-[#f5f5f7] px-3.5 py-1.5 text-[12px] font-medium text-[#1d1d1f] transition-colors hover:bg-[#e5e5ea]"
              >
                <Server className="h-3 w-3 text-[#aeaeb2]" />
                {svc}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ────────────────────────────────────────────────────── */}
      {/*  CAUSAL CHAIN + BLAST RADIUS                           */}
      {/* ────────────────────────────────────────────────────── */}
      {incident.custom_fields?.causal_chain && incident.custom_fields.causal_chain.length > 0 && (
        <section className="card-hover rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
              <Zap className="h-3.5 w-3.5 text-[#FF5722]" />
              Causal Chain
            </h3>
            {incident.custom_fields.blast_radius?.impact_score != null && (
              <div className="flex items-center gap-2.5">
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

          {/* Chain visualization */}
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {incident.custom_fields.causal_chain.map((svc, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span
                  className={`rounded-xl px-3.5 py-2 text-[12px] font-medium transition-all ${
                    i === 0
                      ? "bg-red-50 text-red-700 ring-1 ring-red-200 shadow-sm shadow-red-100"
                      : "bg-[#f5f5f7] text-[#1d1d1f]"
                  }`}
                >
                  {i === 0 && (
                    <span className="mr-1.5 text-[9px] font-bold uppercase text-red-500">
                      root
                    </span>
                  )}
                  {svc}
                </span>
                {i < incident.custom_fields!.causal_chain!.length - 1 && (
                  <ArrowRight className="h-3.5 w-3.5 text-[#aeaeb2]" />
                )}
              </div>
            ))}
          </div>

          {/* Downstream impact */}
          {incident.custom_fields.blast_radius?.affected_downstream &&
            incident.custom_fields.blast_radius.affected_downstream.length > 0 && (
              <p className="mt-4 text-[12px] text-[#6e6e73]">
                <span className="font-medium text-[#1d1d1f]">Downstream impact:</span>{" "}
                {incident.custom_fields.blast_radius.affected_downstream.join(" → ")}
                {incident.custom_fields.blast_radius.estimated_user_impact && (
                  <span
                    className={`ml-2 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
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
        </section>
      )}

      {/* ────────────────────────────────────────────────────── */}
      {/*  AI ANALYSIS (grouped card)                            */}
      {/* ────────────────────────────────────────────────────── */}
      {(incident.root_cause || incident.impact || incident.custom_fields?.suggested_fix || (incident.reproduce_steps && incident.reproduce_steps.length > 0)) && (
        <section className="card-hover overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          {/* Section header */}
          <div className="flex items-center gap-2 border-b border-[#f2f2f7] bg-gradient-to-r from-violet-50/50 to-transparent px-6 py-4">
            <Brain className="h-4 w-4 text-violet-500" />
            <h3 className="text-[12px] font-semibold uppercase tracking-widest text-violet-600">
              AI Analysis
            </h3>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold text-violet-500">
              AUTO
            </span>
          </div>

          <div className="divide-y divide-[#f2f2f7]">
            {/* Root Cause */}
            {incident.root_cause && (
              <div className="px-6 py-5">
                <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                  <Brain className="h-3 w-3 text-violet-400" />
                  Root Cause
                </h4>
                <p className="max-w-prose text-[14px] leading-relaxed text-[#1d1d1f] whitespace-pre-wrap">
                  {incident.root_cause}
                </p>
              </div>
            )}

            {/* Impact */}
            {incident.impact && (
              <div className="px-6 py-5">
                <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                  <AlertCircle className="h-3 w-3 text-amber-400" />
                  Impact Assessment
                </h4>
                <p className="max-w-prose text-[13px] leading-relaxed text-[#1d1d1f]">
                  {incident.impact}
                </p>
              </div>
            )}

            {/* Suggested Fix */}
            {incident.custom_fields?.suggested_fix && (
              <div className="px-6 py-5">
                <h4 className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                  <Lightbulb className="h-3 w-3 text-emerald-400" />
                  Suggested Fix
                </h4>
                <p className="max-w-prose text-[13px] leading-relaxed text-[#1d1d1f]">
                  {incident.custom_fields.suggested_fix}
                </p>
              </div>
            )}

            {/* Reproduce Steps */}
            {incident.reproduce_steps && incident.reproduce_steps.length > 0 && (
              <div className="px-6 py-5">
                <h4 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                  <Search className="h-3 w-3 text-[#aeaeb2]" />
                  Steps to Reproduce
                </h4>
                <ol className="space-y-2 pl-5">
                  {incident.reproduce_steps.map((step, i) => (
                    <li
                      key={i}
                      className="list-decimal text-[13px] leading-relaxed text-[#1d1d1f] marker:text-[#FF5722] marker:font-semibold"
                    >
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ────────────────────────────────────────────────────── */}
      {/*  EVIDENCE LOGS (collapsible)                           */}
      {/* ────────────────────────────────────────────────────── */}
      {incident.evidence_logs && incident.evidence_logs.length > 0 && (
        <CollapsibleSection
          title="Evidence Logs"
          icon={<FileText className="h-3.5 w-3.5 text-amber-500" />}
          badge={incident.evidence_logs.length}
          badgeColor="bg-amber-50 text-amber-600"
          defaultOpen={false}
        >
          <div className="space-y-1.5">
            {incident.evidence_logs.map((log, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-xl bg-[#fafafa] px-4 py-3 transition-colors hover:bg-[#f5f5f7]"
              >
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    log.level === "ERROR" || log.level === "FATAL"
                      ? "bg-red-500"
                      : log.level === "WARN"
                        ? "bg-amber-400"
                        : "bg-emerald-500"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-[#6e6e73]">
                      {log.service}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                        log.level === "ERROR" || log.level === "FATAL"
                          ? "bg-red-50 text-red-500"
                          : log.level === "WARN"
                            ? "bg-amber-50 text-amber-500"
                            : "bg-emerald-50 text-emerald-500"
                      }`}
                    >
                      {log.level}
                    </span>
                    <span className="text-[10px] text-[#aeaeb2]">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <button
                    onClick={() => toggleLogExpand(i)}
                    className="mt-1 text-left"
                  >
                    <p
                      className={`text-[12px] text-[#1d1d1f] ${
                        expandedLogs.has(i) ? "whitespace-pre-wrap" : "truncate max-w-full"
                      }`}
                    >
                      {log.message}
                    </p>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ────────────────────────────────────────────────────── */}
      {/*  REQUEST TRACES (collapsible per trace)                */}
      {/* ────────────────────────────────────────────────────── */}
      {incident.request_traces && incident.request_traces.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <GitBranch className="h-4 w-4 text-[#aeaeb2]" />
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
              Request Traces ({incident.request_traces.length})
            </h3>
          </div>

          {incident.request_traces.map((trace, ti) => (
            <CollapsibleSection
              key={ti}
              title={`Trace ${ti + 1}`}
              icon={<Activity className="h-3.5 w-3.5 text-[#FF5722]" />}
              badge={`${(trace.logs?.length ?? 0) + (trace.spans?.length ?? 0)} events`}
              badgeColor="bg-[#FFF3E0] text-[#FF5722]"
              defaultOpen={ti === 0}
            >
              {/* Trace ID */}
              <p className="mb-3 rounded-lg bg-[#f5f5f7] px-3 py-2 font-mono text-[11px] text-[#6e6e73]">
                <span className="text-[#aeaeb2]">trace_id:</span>{" "}
                <span className="text-[#1d1d1f] select-all">{trace.trace_id}</span>
              </p>

              {/* Spans */}
              {trace.spans && trace.spans.length > 0 && (
                <div className="mb-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                    Spans
                  </p>
                  <div className="relative space-y-1.5 pl-4">
                    {/* Connecting line */}
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#e5e5ea]" />
                    {trace.spans.map((span, si) => (
                      <div
                        key={si}
                        className="relative flex items-center gap-3 rounded-xl bg-[#fafafa] px-4 py-2.5 transition-colors hover:bg-[#f5f5f7]"
                      >
                        <span
                          className={`absolute -left-[9px] h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                            span.status === "OK" || span.status === "200"
                              ? "bg-emerald-500"
                              : "bg-red-500"
                          }`}
                        />
                        <span className="text-[12px] font-semibold text-[#1d1d1f]">
                          {span.service}
                        </span>
                        <span className="text-[12px] text-[#6e6e73]">
                          {span.operation}
                        </span>
                        <span className="ml-auto font-mono text-[11px] text-[#aeaeb2]">
                          {span.duration_ms}ms
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            span.error
                              ? "bg-red-50 text-red-500"
                              : "bg-emerald-50 text-emerald-500"
                          }`}
                        >
                          {span.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Logs */}
              {trace.logs && trace.logs.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                    Logs
                  </p>
                  <div className="space-y-1.5">
                    {trace.logs.map((log, li) => {
                      const globalIdx = ti * 1000 + li;
                      return (
                        <div
                          key={li}
                          className="flex items-start gap-3 rounded-xl bg-[#fafafa] px-4 py-2.5 transition-colors hover:bg-[#f5f5f7]"
                        >
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              log.level === "ERROR" || log.level === "FATAL"
                                ? "bg-red-500"
                                : log.level === "WARN"
                                  ? "bg-amber-400"
                                  : "bg-emerald-500"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-[#6e6e73]">
                                {log.service}
                              </span>
                              {log.duration_ms != null && log.duration_ms > 0 && (
                                <span className="font-mono text-[10px] text-[#aeaeb2]">
                                  {log.duration_ms}ms
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => toggleLogExpand(globalIdx)}
                              className="mt-0.5 w-full text-left"
                            >
                              <p
                                className={`text-[12px] text-[#1d1d1f] ${
                                  expandedLogs.has(globalIdx)
                                    ? "whitespace-pre-wrap break-all"
                                    : "truncate"
                                }`}
                              >
                                {log.message}
                              </p>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CollapsibleSection>
          ))}
        </section>
      )}

      {/* ────────────────────────────────────────────────────── */}
      {/*  TIMELINE                                              */}
      {/* ────────────────────────────────────────────────────── */}
      {incident.timeline && incident.timeline.length > 0 && (
        <section className="card-hover rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <h3 className="mb-6 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            <Clock className="h-3.5 w-3.5" />
            Timeline
          </h3>
          <div className="stagger-children relative border-l-2 border-[#e5e5ea] pl-7 space-y-6">
            {incident.timeline.map((entry, i) => {
              const isStateChange = entry.action?.includes("→") || entry.action?.toLowerCase().includes("state");
              return (
                <div key={i} className="relative">
                  {/* Dot */}
                  <div
                    className={`absolute -left-[33px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 bg-white ${
                      isStateChange
                        ? "border-[#FF5722]"
                        : "border-[#e5e5ea]"
                    }`}
                  >
                    <div
                      className={`h-2 w-2 rounded-full ${
                        isStateChange ? "bg-[#FF5722]" : "bg-[#d1d1d6]"
                      }`}
                    />
                  </div>
                  <p className="text-[11px] text-[#aeaeb2]">
                    {new Date(entry.timestamp).toLocaleString()}{" "}
                    <span className="font-medium text-[#6e6e73]">· {entry.actor}</span>
                  </p>
                  <p className="mt-0.5 text-[14px] font-medium text-[#1d1d1f]">
                    {entry.action}
                  </p>
                  {entry.note && (
                    <p className="mt-0.5 text-[12px] text-[#6e6e73]">{entry.note}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ────────────────────────────────────────────────────── */}
      {/*  ANOMALY DETECTION INFO                                */}
      {/* ────────────────────────────────────────────────────── */}
      {(incident.anomaly_score != null || incident.custom_fields?.error_pattern) && (
        <section className="rounded-2xl border border-[#e5e5ea] bg-[#fafafa] p-5">
          <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            <Activity className="h-3.5 w-3.5 text-[#FF5722]" />
            Detection Details
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {incident.anomaly_score != null && (
              <div>
                <p className="text-[10px] font-medium text-[#aeaeb2]">Anomaly Score</p>
                <p className="mt-0.5 font-mono text-[16px] font-bold text-[#1d1d1f]">
                  {(incident.anomaly_score * 100).toFixed(0)}%
                </p>
              </div>
            )}
            <div>
              <p className="text-[10px] font-medium text-[#aeaeb2]">Detection Method</p>
              <p className="mt-0.5 text-[13px] font-medium text-[#1d1d1f]">
                {incident.anomaly_score != null && incident.anomaly_score >= 0.65
                  ? "Flink Rule-Based Scoring"
                  : "Bridge Z-Score Detection"}
              </p>
            </div>
            {incident.custom_fields?.error_pattern && (
              <div>
                <p className="text-[10px] font-medium text-[#aeaeb2]">Error Pattern</p>
                <p className="mt-0.5 font-mono text-[12px] text-[#6e6e73]">
                  {incident.custom_fields.error_pattern}
                </p>
              </div>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[#aeaeb2]">
            Incidents are detected by analyzing log severity patterns, error rate spikes,
            and trace correlation across services. Flink scores anomalies using severity weighting,
            critical pattern matching, and burst detection. Bridge applies Z-score analysis
            with sliding windows for real-time detection.
          </p>
        </section>
      )}
    </div>
  );
}

/* ── State machine: available actions per state ──────────── */

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
            "bg-amber-500 text-white shadow-amber-500/20 hover:bg-amber-400",
        },
        {
          action: "resolve",
          label: "Resolve",
          icon: CheckCircle2,
          className:
            "bg-emerald-500 text-white shadow-emerald-500/20 hover:bg-emerald-400",
        },
      ];
    case "acknowledged":
      return [
        {
          action: "investigate",
          label: "Start Investigation",
          icon: Search,
          className:
            "bg-[#FF5722] text-white shadow-orange-500/20 hover:bg-[#E64A19]",
        },
        {
          action: "resolve",
          label: "Resolve",
          icon: CheckCircle2,
          className:
            "bg-emerald-500 text-white shadow-emerald-500/20 hover:bg-emerald-400",
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
            "bg-emerald-500 text-white shadow-emerald-500/20 hover:bg-emerald-400",
        },
      ];
    default:
      return [];
  }
}
