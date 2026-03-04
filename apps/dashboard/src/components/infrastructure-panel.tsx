"use client";

import { Lock, Server, Shield } from "lucide-react";

interface Props {
  tenantId: string;
}

export default function InfrastructurePanel({ tenantId }: Props) {
  const tier =
    tenantId === "prod"
      ? "ha"
      : tenantId === "uat"
        ? "standard"
        : "dev";

  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Shield className="h-4 w-4 text-[#aeaeb2]" />
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
          Infrastructure
        </h3>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-[#f5f5f7] px-2.5 py-0.5 text-[10px] font-medium text-[#aeaeb2]">
          <Lock className="h-2.5 w-2.5" />
          <span className="hidden sm:inline">Requires redeployment</span>
          <span className="sm:hidden">Read-only</span>
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-xl bg-[#fafafa] px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-[#aeaeb2]" />
            <span className="text-[12px] text-[#6e6e73]">Deployment Tier</span>
          </div>
          <span className="rounded-full bg-[#f5f5f7] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#1d1d1f]">
            {tier}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-[#fafafa] px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-[#aeaeb2]" />
            <span className="text-[12px] text-[#6e6e73]">Secret Store</span>
          </div>
          <span className="rounded-full bg-[#f5f5f7] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#1d1d1f]">
            ExternalSecrets
          </span>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-[#fafafa] px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-[#aeaeb2]" />
            <span className="text-[12px] text-[#6e6e73]">Tenant ID</span>
          </div>
          <span className="font-mono text-[11px] font-semibold text-[#1d1d1f]">
            {tenantId}
          </span>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-[#fafafa] px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-[#aeaeb2]" />
            <span className="text-[12px] text-[#6e6e73]">Storage Class</span>
          </div>
          <span className="font-mono text-[11px] font-semibold text-[#1d1d1f]">
            standard
          </span>
        </div>
      </div>
    </div>
  );
}
