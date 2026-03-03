"use client";

import { useEffect, useState, useCallback } from "react";
import ServiceHealthPanel from "@/components/service-health";
import PlatformConfigPanel from "@/components/platform-config";
import RoutingRulesPanel from "@/components/routing-rules";
import AnomalyConfigPanel from "@/components/anomaly-config";
import LlmConfigPanel from "@/components/llm-config";
import InfrastructurePanel from "@/components/infrastructure-panel";
import {
  fetchTicketingConfig,
  fetchBridgeConfig,
  type TicketingConfig,
  type BridgeConfig,
} from "@/lib/api";
import {
  Settings,
  Loader2,
  AlertTriangle,
  Globe,
  Activity,
  Plug,
  ShieldAlert,
  Brain,
  Server,
  type LucideIcon,
} from "lucide-react";

/* ── Tab definitions ─────────────────────────────────────── */

interface TabDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { id: "health", label: "Health", icon: Activity },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "detection", label: "Detection", icon: ShieldAlert },
  { id: "llm", label: "LLM", icon: Brain },
  { id: "system", label: "System", icon: Server },
];

/* ── Page ─────────────────────────────────────────────────── */

export default function SettingsPage() {
  const [ticketingCfg, setTicketingCfg] = useState<TicketingConfig | null>(null);
  const [bridgeCfg, setBridgeCfg] = useState<BridgeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("health");

  const tenantId = process.env.NEXT_PUBLIC_TENANT_ID || "dev-local";

  const loadConfig = useCallback(async () => {
    try {
      const [tc, bc] = await Promise.allSettled([
        fetchTicketingConfig(),
        fetchBridgeConfig(),
      ]);
      if (tc.status === "fulfilled") setTicketingCfg(tc.value);
      else setError("Ticketing agent unreachable");
      if (bc.status === "fulfilled") setBridgeCfg(bc.value);
    } catch {
      setError("Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const refreshConfig = () => {
    loadConfig();
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
            Runtime configuration and system health
          </p>
        </div>
      </div>

      {/* Runtime warning banner */}
      <div className="animate-fade-in-up flex items-start gap-3 rounded-2xl bg-amber-50 px-5 py-3.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
        <div>
          <p className="text-[12px] font-medium text-amber-800">
            Runtime changes are not persisted across pod restarts
          </p>
          <p className="text-[11px] text-amber-600">
            Helm values remain the source of truth. Use these controls for quick
            testing and tuning.
          </p>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[#aeaeb2]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading configuration...
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-2xl bg-red-50 px-5 py-3.5 text-[12px] text-red-600">
          {error} — some panels may show defaults.
        </div>
      )}

      {/* Tab bar */}
      {!loading && (
        <div className="animate-fade-in-up flex gap-0.5 rounded-xl bg-white p-1 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-medium transition-all ${
                  activeTab === tab.id
                    ? "bg-[#FF5722] text-white shadow-sm"
                    : "text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Tab content ─────────────────────────────────────── */}

      {/* Health */}
      {!loading && activeTab === "health" && (
        <div className="animate-fade-in-up">
          <ServiceHealthPanel />
        </div>
      )}

      {/* Integrations */}
      {!loading && activeTab === "integrations" && (
        <div className="animate-fade-in-up space-y-6">
          {ticketingCfg && (
            <PlatformConfigPanel
              platforms={ticketingCfg.platforms}
              onUpdate={refreshConfig}
            />
          )}
          {ticketingCfg && (
            <RoutingRulesPanel
              routing={ticketingCfg.routing}
              platforms={ticketingCfg.platforms}
              onUpdate={refreshConfig}
            />
          )}
        </div>
      )}

      {/* Detection */}
      {!loading && activeTab === "detection" && ticketingCfg && bridgeCfg && (
        <div className="animate-fade-in-up">
          <AnomalyConfigPanel
            anomaly={ticketingCfg.anomaly}
            bridge={bridgeCfg}
            onUpdate={refreshConfig}
          />
        </div>
      )}

      {/* LLM */}
      {!loading && activeTab === "llm" && ticketingCfg && (
        <div className="animate-fade-in-up">
          <LlmConfigPanel llm={ticketingCfg.llm} onUpdate={refreshConfig} />
        </div>
      )}

      {/* System */}
      {!loading && activeTab === "system" && (
        <div className="animate-fade-in-up space-y-6">
          <InfrastructurePanel tenantId={tenantId} />

          {/* API Endpoints reference */}
          <div className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
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
                { method: "GET", path: "/api/ticketing/api/v1/config", desc: "Runtime config" },
                { method: "PATCH", path: "/api/ticketing/api/v1/config/platforms", desc: "Update platforms" },
                { method: "PATCH", path: "/api/ticketing/api/v1/config/routing", desc: "Update routing" },
                { method: "PATCH", path: "/api/ticketing/api/v1/config/anomaly", desc: "Update anomaly thresholds" },
                { method: "PATCH", path: "/api/ticketing/api/v1/config/llm", desc: "Update LLM provider" },
                { method: "POST", path: "/api/ticketing/api/v1/test-connection", desc: "Test platform connectivity" },
                { method: "POST", path: "/api/ticketing/api/v1/test-llm", desc: "Test LLM connectivity" },
                { method: "GET", path: "/api/bridge/health", desc: "Bridge health" },
                { method: "GET", path: "/api/bridge/metrics", desc: "Prometheus metrics" },
                { method: "GET", path: "/api/bridge/config", desc: "Bridge config" },
                { method: "PATCH", path: "/api/bridge/config", desc: "Update bridge config" },
                { method: "GET", path: "/api/feast/health", desc: "ML feature server health" },
                { method: "GET", path: "/api/airflow/health", desc: "Airflow scheduler health" },
              ].map((ep) => (
                <div
                  key={`${ep.method}-${ep.path}`}
                  className="flex items-center gap-3 rounded-xl bg-[#fafafa] px-4 py-2.5"
                >
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      ep.method === "GET"
                        ? "bg-emerald-50 text-emerald-600"
                        : ep.method === "PATCH"
                          ? "bg-purple-50 text-purple-600"
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
      )}
    </div>
  );
}
