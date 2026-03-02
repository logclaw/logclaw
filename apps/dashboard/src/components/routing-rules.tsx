"use client";

import { useState } from "react";
import {
  type RoutingRules,
  type PlatformConfig,
  updateRouting,
} from "@/lib/api";
import { Route, Check, Loader2 } from "lucide-react";

const SEVERITIES: (keyof RoutingRules)[] = [
  "critical",
  "high",
  "medium",
  "low",
];

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-50 text-red-600",
  high: "bg-orange-50 text-orange-600",
  medium: "bg-amber-50 text-amber-600",
  low: "bg-blue-50 text-blue-600",
};

interface Props {
  routing: RoutingRules;
  platforms: Record<string, PlatformConfig>;
  onUpdate: () => void;
}

export default function RoutingRulesPanel({
  routing,
  platforms,
  onUpdate,
}: Props) {
  const [local, setLocal] = useState<RoutingRules>(routing);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const enabledPlatforms = Object.entries(platforms)
    .filter(([, cfg]) => cfg.enabled)
    .map(([key]) => key);

  const isDirty = JSON.stringify(local) !== JSON.stringify(routing);

  const toggle = (severity: keyof RoutingRules, platform: string) => {
    setLocal((prev) => {
      const list = prev[severity] ?? [];
      const next = list.includes(platform)
        ? list.filter((p) => p !== platform)
        : [...list, platform];
      return { ...prev, [severity]: next };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateRouting(local);
      onUpdate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const PLATFORM_LABELS: Record<string, string> = {
    pagerduty: "PagerDuty",
    jira: "Jira",
    servicenow: "ServiceNow",
    opsgenie: "OpsGenie",
    slack: "Slack",
  };

  if (enabledPlatforms.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2 mb-3">
          <Route className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            Severity Routing
          </h3>
        </div>
        <p className="text-[12px] text-[#aeaeb2]">
          Enable at least one platform above to configure routing rules.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[#f2f2f7] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            Severity Routing
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-[10px] text-amber-500 font-medium">
              Unsaved changes
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-1.5 rounded-full bg-[#FF5722] px-3 py-1.5 text-[11px] font-medium text-white transition-all hover:bg-[#E64A19] disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : saved ? (
              <Check className="h-3 w-3" />
            ) : null}
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      <div className="p-5">
        <p className="mb-3 text-[11px] text-[#aeaeb2]">
          Choose which platforms receive alerts for each severity. Empty rows
          route to all enabled platforms (backward compatible).
        </p>

        {/* Matrix header */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="pb-2 text-left text-[11px] font-medium text-[#6e6e73]">
                  Severity
                </th>
                {enabledPlatforms.map((p) => (
                  <th
                    key={p}
                    className="pb-2 text-center text-[11px] font-medium text-[#6e6e73]"
                  >
                    {PLATFORM_LABELS[p] ?? p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SEVERITIES.map((sev) => (
                <tr key={sev} className="border-t border-[#f2f2f7]">
                  <td className="py-2.5 pr-4">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${SEVERITY_COLORS[sev]}`}
                    >
                      {sev}
                    </span>
                  </td>
                  {enabledPlatforms.map((p) => {
                    const checked = (local[sev] ?? []).includes(p);
                    return (
                      <td key={p} className="py-2.5 text-center">
                        <button
                          onClick={() => toggle(sev, p)}
                          className={`mx-auto flex h-6 w-6 items-center justify-center rounded-md border transition-all ${
                            checked
                              ? "border-[#FF5722] bg-[#FF5722]"
                              : "border-[#d1d1d6] bg-white hover:border-[#aeaeb2]"
                          }`}
                        >
                          {checked && (
                            <Check className="h-3.5 w-3.5 text-white" />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
