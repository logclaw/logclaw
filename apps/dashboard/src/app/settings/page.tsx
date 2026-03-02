"use client";

import ServiceHealthPanel from "@/components/service-health";
import { useState } from "react";
import {
  Settings,
  Info,
  Server,
  RefreshCw,
  Loader2,
  Globe,
} from "lucide-react";

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
      {/* Header */}
      <div className="animate-fade-in-up flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f5f5f7]">
          <Settings className="h-5 w-5 text-[#6e6e73]" />
        </div>
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[#1d1d1f]">
            Settings
          </h1>
          <p className="text-[13px] text-[#6e6e73]">
            System configuration and health
          </p>
        </div>
      </div>

      {/* Service health */}
      <ServiceHealthPanel />

      {/* Environment */}
      <div className="animate-fade-in-up rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="mb-4 flex items-center gap-2">
          <Info className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            Environment
          </h3>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { label: "Tenant ID", value: process.env.NEXT_PUBLIC_TENANT_ID || "dev-local" },
            { label: "Dashboard Version", value: "2.0.0 (Next.js)" },
            { label: "API Proxy", value: "Route Handlers" },
            { label: "Refresh Interval", value: "15s" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between rounded-xl bg-[#fafafa] px-4 py-3"
            >
              <span className="text-[12px] text-[#6e6e73]">{item.label}</span>
              <span className="font-mono text-[12px] font-medium text-[#1d1d1f]">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* System health JSON */}
      <div className="animate-fade-in-up rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-[#aeaeb2]" />
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
              System Health (Bridge)
            </h3>
          </div>
          <button
            onClick={fetchSystemHealth}
            disabled={loadingHealth}
            className="flex items-center gap-1.5 rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-medium text-[#6e6e73] transition-all hover:bg-[#e5e5ea] disabled:opacity-50"
          >
            {loadingHealth ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Fetch Health
          </button>
        </div>
        {healthJson && (
          <pre className="overflow-x-auto rounded-xl bg-[#1d1d1f] p-4 text-[12px] text-[#aeaeb2] font-mono">
            {healthJson}
          </pre>
        )}
      </div>

      {/* API Schema */}
      <div className="animate-fade-in-up rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="mb-4 flex items-center gap-2">
          <Globe className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            API Endpoints
          </h3>
        </div>
        <div className="space-y-1.5">
          {[
            { method: "GET", path: "/api/opensearch/_cat/indices", desc: "List all indices" },
            { method: "POST", path: "/api/vector/", desc: "Ingest logs via Vector" },
            { method: "GET", path: "/api/ticketing/api/incidents", desc: "List incidents" },
            { method: "POST", path: "/api/ticketing/api/incidents/:id/:action", desc: "Transition incident" },
            { method: "GET", path: "/api/bridge/health", desc: "Bridge health" },
            { method: "GET", path: "/api/bridge/metrics", desc: "Prometheus metrics" },
            { method: "GET", path: "/api/feast/health", desc: "ML feature server health" },
            { method: "GET", path: "/api/airflow/health", desc: "Airflow scheduler health" },
          ].map((ep) => (
            <div
              key={ep.path}
              className="flex items-center gap-3 rounded-xl bg-[#fafafa] px-4 py-2.5"
            >
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                  ep.method === "GET"
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-blue-50 text-[#FF5722]"
                }`}
              >
                {ep.method}
              </span>
              <span className="flex-1 font-mono text-[12px] text-[#1d1d1f]">
                {ep.path}
              </span>
              <span className="text-[12px] text-[#aeaeb2]">{ep.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
