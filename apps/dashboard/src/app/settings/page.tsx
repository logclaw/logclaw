"use client";

import ServiceHealthPanel from "@/components/service-health";
import { useState } from "react";

export default function SettingsPage() {
  const [healthJson, setHealthJson] = useState<string | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  const fetchSystemHealth = async () => {
    setLoadingHealth(true);
    try {
      const res = await fetch("/api/bridge/health");
      const data = await res.json();
      setHealthJson(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setHealthJson(`Error: ${err.message}`);
    } finally {
      setLoadingHealth(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-200">Settings</h1>

      {/* Service health */}
      <ServiceHealthPanel />

      {/* Environment */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-400 uppercase tracking-wider">
          Environment
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: "Tenant ID", value: process.env.NEXT_PUBLIC_TENANT_ID || "dev-local" },
            { label: "Dashboard Version", value: "2.0.0 (Next.js)" },
            { label: "API Proxy", value: "Next.js rewrites" },
            { label: "Refresh Interval", value: "15s" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between rounded-lg bg-slate-900/50 px-3 py-2"
            >
              <span className="text-xs text-slate-500">{item.label}</span>
              <span className="font-mono text-xs text-slate-300">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* System health JSON */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
            System Health (Bridge)
          </h3>
          <button
            onClick={fetchSystemHealth}
            disabled={loadingHealth}
            className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600 disabled:opacity-50"
          >
            {loadingHealth ? "Loading..." : "Fetch Health"}
          </button>
        </div>
        {healthJson && (
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-400 font-mono">
            {healthJson}
          </pre>
        )}
      </div>

      {/* API Schema */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
        <h3 className="mb-3 text-sm font-medium text-slate-400 uppercase tracking-wider">
          API Endpoints
        </h3>
        <div className="space-y-2">
          {[
            { method: "GET", path: "/api/opensearch/_cat/indices", desc: "List all indices" },
            { method: "POST", path: "/api/vector/", desc: "Ingest logs via Vector" },
            { method: "GET", path: "/api/ticketing/incidents", desc: "List incidents" },
            { method: "POST", path: "/api/ticketing/incidents/:id/:action", desc: "Transition incident" },
            { method: "GET", path: "/api/bridge/health", desc: "Bridge health" },
            { method: "GET", path: "/api/bridge/metrics", desc: "Prometheus metrics" },
            { method: "GET", path: "/api/feast/health", desc: "ML feature server health" },
            { method: "GET", path: "/api/airflow/health", desc: "Airflow scheduler health" },
          ].map((ep) => (
            <div
              key={ep.path}
              className="flex items-center gap-3 rounded-lg bg-slate-900/50 px-3 py-2"
            >
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  ep.method === "GET"
                    ? "bg-green-900/50 text-green-400"
                    : "bg-blue-900/50 text-blue-400"
                }`}
              >
                {ep.method}
              </span>
              <span className="flex-1 font-mono text-xs text-slate-300">
                {ep.path}
              </span>
              <span className="text-xs text-slate-500">{ep.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
