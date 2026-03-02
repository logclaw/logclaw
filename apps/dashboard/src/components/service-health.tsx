"use client";

import { useEffect, useState } from "react";
import { checkServiceHealth, type ServiceHealth } from "@/lib/api";

export default function ServiceHealthPanel() {
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkServiceHealth()
      .then(setServices)
      .finally(() => setLoading(false));
  }, []);

  const statusIcon = (s: ServiceHealth["status"]) => {
    switch (s) {
      case "healthy":
        return "🟢";
      case "degraded":
        return "🟡";
      case "down":
        return "🔴";
      default:
        return "⚪";
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6 text-center text-slate-500">
        Checking service health...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
      <div className="border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
          Integration Status
        </h3>
      </div>
      <div className="divide-y divide-slate-700/50">
        {services.map((svc) => (
          <div
            key={svc.name}
            className="flex items-center justify-between px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span>{statusIcon(svc.status)}</span>
              <div>
                <p className="text-sm font-medium text-slate-300">
                  {svc.name}
                </p>
                <p className="text-xs text-slate-500">{svc.url}</p>
              </div>
            </div>
            <div className="text-right">
              <span
                className={`text-xs font-medium ${
                  svc.status === "healthy"
                    ? "text-green-400"
                    : svc.status === "degraded"
                      ? "text-yellow-400"
                      : "text-red-400"
                }`}
              >
                {svc.status}
              </span>
              {svc.latencyMs !== undefined && (
                <p className="text-[10px] text-slate-500">
                  {svc.latencyMs}ms
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
