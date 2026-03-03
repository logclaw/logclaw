"use client";

import { useEffect, useState } from "react";
import { fetchAgentMetrics, type AgentMetrics } from "@/lib/api";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Database,
  Workflow,
  Search,
  KeyRound,
  ServerCrash,
} from "lucide-react";

export default function InfraHealthPanel() {
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    fetchAgentMetrics()
      .then(setMetrics)
      .catch(() => setError("Agent not available"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  if (error && !metrics) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ServerCrash className="h-4 w-4 text-[#aeaeb2]" />
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
              Infrastructure Health
            </h3>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-medium text-[#6e6e73] transition-all hover:bg-[#e5e5ea]"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
        <p className="mt-3 text-[12px] text-[#aeaeb2]">
          Agent not available — infrastructure metrics require the logclaw-agent pod to be running.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#f2f2f7] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <ServerCrash className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            Infrastructure Health
          </h3>
          {metrics && (
            <span className="text-[10px] text-[#aeaeb2]">
              Updated {new Date(metrics.collectedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-medium text-[#6e6e73] transition-all hover:bg-[#e5e5ea] disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Refresh
        </button>
      </div>

      {loading && !metrics ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[#aeaeb2]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading infrastructure data...
        </div>
      ) : metrics ? (
        <div className="divide-y divide-[#f2f2f7]">
          {/* ── OpenSearch Cluster ────────────────────────── */}
          <div className="px-5 py-4">
            <div className="mb-2.5 flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-[#aeaeb2]" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                OpenSearch Cluster
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    metrics.osHealth.status === "green"
                      ? "bg-emerald-500"
                      : metrics.osHealth.status === "yellow"
                        ? "bg-amber-500"
                        : "bg-red-500"
                  }`}
                />
                <span className="text-[13px] font-medium capitalize text-[#1d1d1f]">
                  {metrics.osHealth.status}
                </span>
              </div>
              <span className="text-[12px] text-[#aeaeb2]">
                {metrics.osHealth.numberOfNodes ?? "?"} nodes &middot;{" "}
                {metrics.osHealth.numberOfDataNodes ?? "?"} data nodes
              </span>
            </div>
          </div>

          {/* ── Kafka Consumer Lag ────────────────────────── */}
          <div className="px-5 py-4">
            <div className="mb-2.5 flex items-center gap-2">
              <Database className="h-3.5 w-3.5 text-[#aeaeb2]" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                Kafka Consumer Lag
              </span>
              {Object.keys(metrics.kafkaLag).length === 0 && (
                <span className="text-[10px] text-[#aeaeb2]">No consumer groups found</span>
              )}
            </div>
            {Object.keys(metrics.kafkaLag).length > 0 && (
              <div className="space-y-1">
                {Object.entries(metrics.kafkaLag).map(([group, lag]) => (
                  <div
                    key={group}
                    className="flex items-center justify-between rounded-lg bg-[#fafafa] px-3 py-2"
                  >
                    <span className="font-mono text-[12px] text-[#1d1d1f]">{group}</span>
                    <span
                      className={`font-mono text-[12px] font-semibold ${
                        lag > 1000 ? "text-red-500" : lag > 100 ? "text-amber-500" : "text-emerald-600"
                      }`}
                    >
                      {lag.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Flink Jobs ────────────────────────────────── */}
          <div className="px-5 py-4">
            <div className="mb-2.5 flex items-center gap-2">
              <Workflow className="h-3.5 w-3.5 text-[#aeaeb2]" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                Flink Jobs
              </span>
              {metrics.flinkJobs.length === 0 && (
                <span className="text-[10px] text-[#aeaeb2]">No Flink jobs found</span>
              )}
            </div>
            {metrics.flinkJobs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {metrics.flinkJobs.map((job) => (
                  <div
                    key={job.name}
                    className="flex items-center gap-2 rounded-lg bg-[#fafafa] px-3 py-2"
                  >
                    {job.state === "RUNNING" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : job.state === "FAILED" ? (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-[#aeaeb2]" />
                    )}
                    <span className="text-[12px] font-medium text-[#1d1d1f]">{job.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        job.state === "RUNNING"
                          ? "bg-emerald-50 text-emerald-600"
                          : job.state === "FAILED"
                            ? "bg-red-50 text-red-500"
                            : "bg-gray-50 text-[#aeaeb2]"
                      }`}
                    >
                      {job.state}
                    </span>
                    {job.restarts > 0 && (
                      <span className="text-[10px] text-[#aeaeb2]">
                        {job.restarts} restarts
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── External Secrets ──────────────────────────── */}
          <div className="px-5 py-4">
            <div className="mb-2.5 flex items-center gap-2">
              <KeyRound className="h-3.5 w-3.5 text-[#aeaeb2]" />
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
                External Secrets
              </span>
              {metrics.esoStatus.length === 0 && (
                <span className="text-[10px] text-[#aeaeb2]">No ExternalSecrets found</span>
              )}
            </div>
            {metrics.esoStatus.length > 0 && (
              <div className="space-y-1">
                {metrics.esoStatus.map((secret) => (
                  <div
                    key={secret.name}
                    className="flex items-center justify-between rounded-lg bg-[#fafafa] px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      {secret.ready ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-500" />
                      )}
                      <span className="font-mono text-[12px] text-[#1d1d1f]">{secret.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          secret.ready
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-red-50 text-red-500"
                        }`}
                      >
                        {secret.ready ? "Synced" : "Not Ready"}
                      </span>
                      {secret.lastSync && (
                        <span className="text-[10px] text-[#aeaeb2]">
                          {new Date(secret.lastSync).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
