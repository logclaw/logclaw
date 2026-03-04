"use client";

import { useEffect, useState } from "react";
import { checkServiceHealth, type ServiceHealth } from "@/lib/api";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  RefreshCw,
  Loader2,
  Activity,
} from "lucide-react";

export default function ServiceHealthPanel() {
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    checkServiceHealth()
      .then(setServices)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const StatusIcon = ({ status }: { status: ServiceHealth["status"] }) => {
    switch (status) {
      case "healthy":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "degraded":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case "down":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <HelpCircle className="h-4 w-4 text-[#aeaeb2]" />;
    }
  };

  const statusBg = (status: ServiceHealth["status"]) => {
    switch (status) {
      case "healthy": return "bg-emerald-50";
      case "degraded": return "bg-amber-50";
      case "down": return "bg-red-50";
      default: return "bg-gray-50";
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[#f2f2f7] px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            Integration Status
          </h3>
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
      <div className="divide-y divide-[#f2f2f7]">
        {loading && services.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[#aeaeb2]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking services...
          </div>
        ) : (
          services.map((svc) => (
            <div
              key={svc.name}
              className="flex items-center justify-between px-4 py-3 transition-colors duration-200 hover:bg-[#fafafa] sm:px-5"
            >
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${statusBg(svc.status)}`}>
                  <StatusIcon status={svc.status} />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[#1d1d1f]">
                    {svc.name}
                  </p>
                  <p className="hidden truncate font-mono text-[10px] text-[#aeaeb2] sm:block">
                    {svc.url}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                {svc.latencyMs !== undefined && (
                  <span className="hidden font-mono text-[11px] text-[#aeaeb2] sm:inline">
                    {svc.latencyMs}ms
                  </span>
                )}
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${
                    svc.status === "healthy"
                      ? "bg-emerald-50 text-emerald-600"
                      : svc.status === "degraded"
                        ? "bg-amber-50 text-amber-600"
                        : "bg-red-50 text-red-500"
                  }`}
                >
                  {svc.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
