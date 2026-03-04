"use client";

import {
  ArrowRight,
  ArrowDown,
  Download,
  Radio,
  GitBranch,
  Database,
  Zap,
  Brain,
  Calendar,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import type { PipelineThroughput } from "@/lib/api";
import { formatCompact, formatBytes } from "@/lib/utils";

/* ── Status dot helper ─────────────────────────────────────── */

function StatusDot({
  status,
}: {
  status: "healthy" | "degraded" | "down" | "active";
}) {
  const color =
    status === "healthy" || status === "active"
      ? "bg-emerald-500"
      : status === "degraded"
        ? "bg-amber-500"
        : "bg-red-400";
  const ping =
    status === "healthy" || status === "active"
      ? "bg-emerald-500"
      : status === "degraded"
        ? "bg-amber-500"
        : "bg-red-400";

  return (
    <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full ${ping} opacity-40`}
      />
      <span className={`relative inline-flex h-3 w-3 rounded-full ${color}`} />
    </span>
  );
}

function StatusIcon({
  status,
}: {
  status: "healthy" | "degraded" | "down";
}) {
  if (status === "healthy")
    return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
  if (status === "degraded")
    return <AlertTriangle className="h-3 w-3 text-amber-500" />;
  return <XCircle className="h-3 w-3 text-red-400" />;
}

/* ── Arrow connector ───────────────────────────────────────── */

function Arrow() {
  return (
    <div className="flow-connector mx-1 flex items-center">
      <div className="h-[1.5px] w-4 bg-[#e5e5ea]" />
      <ArrowRight className="h-3 w-3 text-[#d1d1d6]" />
    </div>
  );
}

/* ── Stat pill under a stage ───────────────────────────────── */

function StageStat({
  count,
  unit,
  sizeBytes,
  status,
}: {
  count?: number | null;
  unit: string;
  sizeBytes?: number | null;
  status?: "healthy" | "degraded" | "down" | null;
}) {
  // Health-only pill (no count)
  if (count == null && status) {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-[#fafafa] px-2.5 py-1.5 min-w-[68px] justify-center">
        <StatusIcon status={status} />
        <span className="text-[10px] capitalize text-[#6e6e73]">{status}</span>
      </div>
    );
  }
  if (count == null) return null;

  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg bg-[#fafafa] px-2.5 py-1.5 min-w-[68px]">
      <span className="text-[12px] font-bold tabular-nums text-[#1d1d1f]">
        {formatCompact(count)}
      </span>
      <span className="text-[9px] text-[#aeaeb2]">{unit}</span>
      {sizeBytes != null && sizeBytes > 0 && (
        <span className="text-[9px] font-mono text-[#6e6e73]">
          {formatBytes(sizeBytes)}
        </span>
      )}
    </div>
  );
}

/* ── Main component ────────────────────────────────────────── */

interface Props {
  throughput?: PipelineThroughput | null;
}

export default function PipelineFlow({ throughput }: Props) {
  const tp = throughput;

  return (
    <div className="animate-fade-in-up rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      {/* ── Data Pipeline ─────────────────────────────────── */}
      <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
        Data Pipeline
      </h3>
      <div className="stagger-children flex items-start justify-between gap-1 overflow-x-auto pb-4">
        {/* Ingest — OTel Collector */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-600 transition-transform duration-300 hover:scale-110">
                <Download className="h-5 w-5" />
              </div>
              <StatusDot status="active" />
            </div>
            <div className="text-center">
              <span className="block text-[12px] font-semibold text-[#1d1d1f]">
                Ingest
              </span>
              <span className="block text-[10px] text-[#aeaeb2]">OTel</span>
            </div>
            <StageStat
              count={tp?.ingestCount}
              unit="logs"
              sizeBytes={tp?.logsSizeBytes}
            />
          </div>
          <Arrow />
        </div>

        {/* Stream — Kafka */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-50 text-purple-600 transition-transform duration-300 hover:scale-110">
                <Radio className="h-5 w-5" />
              </div>
              <StatusDot status="active" />
            </div>
            <div className="text-center">
              <span className="block text-[12px] font-semibold text-[#1d1d1f]">
                Stream
              </span>
              <span className="block text-[10px] text-[#aeaeb2]">Kafka</span>
            </div>
            <StageStat count={tp?.streamCount} unit="events" />
          </div>
          <Arrow />
        </div>

        {/* Process — Bridge/Flink */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 transition-transform duration-300 hover:scale-110">
                <GitBranch className="h-5 w-5" />
              </div>
              <StatusDot status="active" />
            </div>
            <div className="text-center">
              <span className="block text-[12px] font-semibold text-[#1d1d1f]">
                Process
              </span>
              <span className="block text-[10px] text-[#aeaeb2]">
                Bridge / Flink
              </span>
            </div>
            <StageStat count={tp?.processCount} unit="processed" />
          </div>
          <Arrow />
        </div>

        {/* Index — OpenSearch */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 transition-transform duration-300 hover:scale-110">
                <Database className="h-5 w-5" />
              </div>
              <StatusDot status="active" />
            </div>
            <div className="text-center">
              <span className="block text-[12px] font-semibold text-[#1d1d1f]">
                Index
              </span>
              <span className="block text-[10px] text-[#aeaeb2]">
                OpenSearch
              </span>
            </div>
            <StageStat
              count={tp?.indexCount}
              unit="docs"
              sizeBytes={tp?.indexSizeBytes}
            />
          </div>
        </div>
      </div>

      {/* ── Vertical connector ────────────────────────────── */}
      <div className="flex justify-center py-1">
        <div className="flex flex-col items-center">
          <div className="h-4 w-[1.5px] bg-[#e5e5ea]" />
          <ArrowDown className="h-3 w-3 text-[#d1d1d6]" />
        </div>
      </div>

      {/* ── AI & Operations ───────────────────────────────── */}
      <h3 className="mb-4 mt-1 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
        AI &amp; Operations
      </h3>
      <div className="stagger-children flex items-start justify-between gap-1 overflow-x-auto pb-2">
        {/* Detect — Anomaly */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-600 transition-transform duration-300 hover:scale-110">
                <Zap className="h-5 w-5" />
              </div>
              <StatusDot status="active" />
            </div>
            <div className="text-center">
              <span className="block text-[12px] font-semibold text-[#1d1d1f]">
                Detect
              </span>
              <span className="block text-[10px] text-[#aeaeb2]">
                Anomaly Engine
              </span>
            </div>
            <StageStat
              count={tp?.detectCount}
              unit="anomalies"
              sizeBytes={tp?.anomaliesSizeBytes}
            />
          </div>
          <Arrow />
        </div>

        {/* ML — Feast / KServe */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 transition-transform duration-300 hover:scale-110">
                <Brain className="h-5 w-5" />
              </div>
              <StatusDot
                status={tp?.feastStatus === "healthy" ? "healthy" : tp?.feastStatus === "degraded" ? "degraded" : "down"}
              />
            </div>
            <div className="text-center">
              <span className="block text-[12px] font-semibold text-[#1d1d1f]">
                ML Engine
              </span>
              <span className="block text-[10px] text-[#aeaeb2]">
                Feast / KServe
              </span>
            </div>
            <StageStat status={tp?.feastStatus} unit="" />
          </div>
          <Arrow />
        </div>

        {/* Orchestrate — Airflow */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 transition-transform duration-300 hover:scale-110">
                <Calendar className="h-5 w-5" />
              </div>
              <StatusDot
                status={tp?.airflowStatus === "healthy" ? "healthy" : tp?.airflowStatus === "degraded" ? "degraded" : "down"}
              />
            </div>
            <div className="text-center">
              <span className="block text-[12px] font-semibold text-[#1d1d1f]">
                Orchestrate
              </span>
              <span className="block text-[10px] text-[#aeaeb2]">Airflow</span>
            </div>
            <StageStat status={tp?.airflowStatus} unit="" />
          </div>
          <Arrow />
        </div>

        {/* Ticketing — AI Agent */}
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500 transition-transform duration-300 hover:scale-110">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <StatusDot
                status={tp?.ticketingStatus === "healthy" ? "healthy" : tp?.ticketingStatus === "degraded" ? "degraded" : "down"}
              />
            </div>
            <div className="text-center">
              <span className="block text-[12px] font-semibold text-[#1d1d1f]">
                Ticketing
              </span>
              <span className="block text-[10px] text-[#aeaeb2]">
                AI Agent
              </span>
            </div>
            <StageStat count={tp?.incidentCount} unit="incidents" />
          </div>
        </div>
      </div>
    </div>
  );
}
