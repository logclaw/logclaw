"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatCard from "@/components/stat-card";
import PipelineFlow from "@/components/pipeline-flow";
import BarChart from "@/components/bar-chart";
import { StatCardSkeleton, BarChartSkeleton, PipelineFlowSkeleton, IncidentCardSkeleton } from "@/components/skeleton";
import { ErrorBanner } from "@/components/error-boundary";
import {
  fetchPipelineStats,
  fetchPipelineThroughput,
  fetchIncidents,
  type PipelineStats,
  type PipelineThroughput,
  type Incident,
} from "@/lib/api";
import {
  formatNumber,
  severityColor,
  stateColor,
  timeAgo,
  formatDuration,
} from "@/lib/utils";
import {
  BarChart3,
  AlertOctagon,
  Server,
  Zap,
  AlertCircle,
  RefreshCw,
  ShieldAlert,
  ChevronRight,
  Clock,
  User,
  ArrowRight,
  ExternalLink,
  Database,
} from "lucide-react";

const REFRESH_MS = 15_000;

export default function OverviewPage() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [throughput, setThroughput] = useState<PipelineThroughput | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentTotal, setIncidentTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const [s, tp, incRes] = await Promise.all([
        fetchPipelineStats(),
        fetchPipelineThroughput(),
        fetchIncidents({ limit: 5 }),
      ]);
      setStats(s);
      setThroughput(tp);
      setIncidents(incRes.incidents);
      setIncidentTotal(incRes.total);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const levelData = stats
    ? Object.entries(stats.levelDistribution).map(([label, value]) => ({
        label,
        value,
        color:
          label === "ERROR" || label === "FATAL"
            ? "bg-red-400"
            : label === "WARN" || label === "WARNING"
              ? "bg-amber-400"
              : label === "INFO"
                ? "bg-blue-500"
                : "bg-emerald-500",
      }))
    : [];

  const serviceData = stats
    ? stats.topServices.slice(0, 8).map((s) => ({
        label: s.name,
        value: s.count,
      }))
    : [];

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} onRetry={refresh} />}

      {/* Header */}
      <div className="animate-fade-in-up flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold tracking-tight text-[#1d1d1f] sm:text-[22px]">
            Overview
          </h1>
          <p className="text-[12px] text-[#6e6e73] sm:text-[13px]">
            Your AI SRE is watching. Here&apos;s what it found.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[12px] font-medium text-[#6e6e73] shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:shadow-md disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* Stats row */}
      {!stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : (
        <div className="stagger-children grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            icon={<BarChart3 className="h-5 w-5" />}
            label="Total Logs (24h)"
            value={formatNumber(stats.totalLogs)}
            color="text-[#FF5722]"
            trend="24h"
          />
          <StatCard
            icon={<AlertOctagon className="h-5 w-5" />}
            label="Error Rate"
            value={`${stats.errorRate.toFixed(1)}%`}
            color={stats.errorRate > 5 ? "text-red-500" : "text-emerald-500"}
          />
          <StatCard
            icon={<Server className="h-5 w-5" />}
            label="Services"
            value={stats.serviceCount}
            color="text-purple-500"
          />
          <StatCard
            icon={<Zap className="h-5 w-5" />}
            label="Anomalies (24h)"
            value={formatNumber(stats.anomalyCount)}
            color={stats.anomalyCount > 0 ? "text-orange-500" : "text-emerald-500"}
          />
        </div>
      )}

      {/* Pipeline flow with throughput */}
      {!throughput ? <PipelineFlowSkeleton /> : <PipelineFlow throughput={throughput} />}

      {/* Active Incidents — the most actionable section */}
      <div className="animate-fade-in-up overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between border-b border-[#f2f2f7] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-500" />
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
              Recent Incidents
            </h3>
            {incidentTotal > 0 && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-500">
                {incidentTotal}
              </span>
            )}
          </div>
          <Link
            href="/incidents"
            className="flex items-center gap-1 text-[12px] font-medium text-[#FF5722] transition-colors hover:text-[#E64A19]"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {incidents.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <ShieldAlert className="mx-auto mb-2 h-8 w-8 text-emerald-300" />
            <p className="text-[13px] font-medium text-[#6e6e73]">
              No incidents detected
            </p>
            <p className="mt-1 text-[12px] text-[#aeaeb2]">
              Your AI SRE is monitoring — you&apos;ll see incidents here when
              anomalies are escalated
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#f2f2f7]">
            {incidents.slice(0, 5).map((inc) => (
              <Link
                key={inc.id}
                href={`/incidents/${inc.id}`}
                className="group flex items-center justify-between px-5 py-3.5 transition-colors duration-150 hover:bg-[#fafafa]"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${severityColor(inc.severity)}`}
                    >
                      {inc.severity}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${stateColor(inc.state)}`}
                    >
                      {inc.state}
                    </span>
                  </div>
                  <p className="truncate text-[13px] font-semibold text-[#1d1d1f] group-hover:text-[#FF5722] transition-colors">
                    {inc.title}
                  </p>
                  <div className="mt-1 flex items-center gap-3 text-[11px] text-[#aeaeb2]">
                    <span className="font-medium text-[#6e6e73]">
                      {inc.service}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />
                      {timeAgo(inc.created_at)}
                    </span>
                    {inc.assigned_to && (
                      <span className="flex items-center gap-0.5">
                        <User className="h-3 w-3" />
                        {inc.assigned_to}
                      </span>
                    )}
                    {inc.mttr_seconds && (
                      <span className="font-mono text-[#FF5722]">
                        MTTR: {formatDuration(inc.mttr_seconds)}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#d1d1d6] transition-all group-hover:translate-x-0.5 group-hover:text-[#FF5722]" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Charts row */}
      {!stats ? (
        <div className="grid gap-4 md:grid-cols-2">
          <BarChartSkeleton />
          <BarChartSkeleton />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <BarChart title="Log Level Distribution" data={levelData} />
          <BarChart title="Top Services by Volume" data={serviceData} />
        </div>
      )}

      {/* Log Explorer banner — nudge to OpenSearch Dashboards */}
      <div className="animate-fade-in-up rounded-2xl border border-[#f2f2f7] bg-gradient-to-r from-[#fafafa] to-white px-4 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f5f5f7]">
              <Database className="h-4.5 w-4.5 text-[#6e6e73]" />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-[#1d1d1f]">
                Need to explore raw logs?
              </p>
              <p className="hidden text-[12px] text-[#6e6e73] sm:block">
                Launch OpenSearch Dashboards for full-text search, filtering, and
                visualizations
              </p>
            </div>
          </div>
          <a
            href={
              (typeof window !== "undefined" &&
                (window as any).__OPENSEARCH_DASHBOARDS_URL) ||
              "/api/opensearch/_dashboards"
            }
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-1.5 rounded-full bg-[#f5f5f7] px-4 py-2 text-[12px] font-medium text-[#6e6e73] transition-all hover:bg-[#e5e5ea] hover:text-[#1d1d1f] sm:w-auto"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Log Explorer
          </a>
        </div>
      </div>
    </div>
  );
}
