"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/stat-card";
import PipelineFlow from "@/components/pipeline-flow";
import BarChart from "@/components/bar-chart";
import LogTable from "@/components/log-table";
import {
  fetchPipelineStats,
  fetchRecentLogs,
  fetchErrorLogs,
  fetchAnomalies,
  type PipelineStats,
  type LogEntry,
  type Anomaly,
} from "@/lib/api";
import { formatNumber, severityColor, timeAgo } from "@/lib/utils";

const REFRESH_MS = 15_000;

export default function OverviewPage() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [recentLogs, setRecentLogs] = useState<LogEntry[]>([]);
  const [errorLogs, setErrorLogs] = useState<LogEntry[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [s, recent, errors, anom] = await Promise.all([
        fetchPipelineStats(),
        fetchRecentLogs(100),
        fetchErrorLogs(50),
        fetchAnomalies(20),
      ]);
      setStats(s);
      setRecentLogs(recent);
      setErrorLogs(errors);
      setAnomalies(anom);
      setError(null);
    } catch (err: any) {
      setError(err.message);
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
            ? "bg-red-500"
            : label === "WARN" || label === "WARNING"
              ? "bg-yellow-500"
              : label === "INFO"
                ? "bg-blue-500"
                : "bg-green-500",
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
      {error && (
        <div className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
          ⚠️ {error}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon="📊"
          label="Total Logs (24h)"
          value={stats ? formatNumber(stats.totalLogs) : "—"}
          color="text-blue-400"
          trend="24h"
        />
        <StatCard
          icon="🔴"
          label="Error Rate"
          value={stats ? `${stats.errorRate.toFixed(1)}%` : "—"}
          color={
            stats && stats.errorRate > 5 ? "text-red-400" : "text-green-400"
          }
        />
        <StatCard
          icon="🏢"
          label="Services"
          value={stats?.serviceCount ?? "—"}
          color="text-purple-400"
        />
        <StatCard
          icon="⚡"
          label="Anomalies (24h)"
          value={stats ? formatNumber(stats.anomalyCount) : "—"}
          color={
            stats && stats.anomalyCount > 0
              ? "text-orange-400"
              : "text-green-400"
          }
        />
      </div>

      {/* Pipeline flow */}
      <PipelineFlow />

      {/* Charts row */}
      <div className="grid gap-4 md:grid-cols-2">
        <BarChart title="Log Level Distribution" data={levelData} />
        <BarChart title="Top Services by Volume" data={serviceData} />
      </div>

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
          <div className="border-b border-slate-700 px-4 py-3">
            <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
              Recent Anomalies
            </h3>
          </div>
          <div className="divide-y divide-slate-700/50">
            {anomalies.slice(0, 5).map((a, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${severityColor(a._source.severity)}`}
                  >
                    {a._source.severity}
                  </span>
                  <span className="text-sm text-slate-300">
                    {a._source.service}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono text-slate-400">
                    z={a._source.z_score.toFixed(2)}
                  </span>
                  <p className="text-[10px] text-slate-500">
                    {timeAgo(a._source.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log tables */}
      <LogTable title="Error Logs" logs={errorLogs} maxRows={20} />
      <LogTable title="Recent Logs" logs={recentLogs} maxRows={50} />
    </div>
  );
}
