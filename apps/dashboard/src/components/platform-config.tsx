"use client";

import { useState } from "react";
import {
  type PlatformConfig,
  type TestResult,
  updatePlatforms,
  testPlatformConnection,
  PLATFORM_REQUIRED_FIELDS,
} from "@/lib/api";
import {
  ChevronDown,
  ChevronRight,
  Check,
  Loader2,
  Eye,
  EyeOff,
  Plug,
  AlertTriangle,
  Zap,
  XCircle,
  CheckCircle2,
} from "lucide-react";

/* ── Platform definitions ────────────────────────────────── */

interface FieldDef {
  key: string;
  label: string;
  type: "string" | "secret";
  placeholder?: string;
  required?: boolean;
}

const PLATFORM_DEFS: Record<
  string,
  { label: string; icon: string; fields: FieldDef[] }
> = {
  pagerduty: {
    label: "PagerDuty",
    icon: "PD",
    fields: [
      { key: "routingKey", label: "Routing Key", type: "secret", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", required: true },
      { key: "apiUrl", label: "API URL", type: "string", placeholder: "https://events.pagerduty.com" },
    ],
  },
  jira: {
    label: "Jira",
    icon: "JR",
    fields: [
      { key: "baseUrl", label: "Base URL", type: "string", placeholder: "https://yourcompany.atlassian.net", required: true },
      { key: "projectKey", label: "Project Key", type: "string", placeholder: "OPS" },
      { key: "issueType", label: "Issue Type", type: "string", placeholder: "Bug" },
      { key: "userEmail", label: "User Email", type: "string", placeholder: "sre@company.com", required: true },
      { key: "apiToken", label: "API Token", type: "secret", placeholder: "ATATT3x...", required: true },
    ],
  },
  servicenow: {
    label: "ServiceNow",
    icon: "SN",
    fields: [
      { key: "instanceUrl", label: "Instance URL", type: "string", placeholder: "https://your-instance.service-now.com", required: true },
      { key: "table", label: "Table", type: "string", placeholder: "incident" },
      { key: "username", label: "Username", type: "string", placeholder: "admin", required: true },
      { key: "password", label: "Password", type: "secret", required: true },
      { key: "assignmentGroup", label: "Assignment Group", type: "string" },
    ],
  },
  opsgenie: {
    label: "OpsGenie",
    icon: "OG",
    fields: [
      { key: "apiUrl", label: "API URL", type: "string", placeholder: "https://api.opsgenie.com" },
      { key: "apiKey", label: "API Key", type: "secret", required: true },
      { key: "team", label: "Team", type: "string" },
    ],
  },
  slack: {
    label: "Slack",
    icon: "SK",
    fields: [
      { key: "webhookUrl", label: "Webhook URL", type: "secret", placeholder: "https://hooks.slack.com/services/...", required: true },
      { key: "channel", label: "Channel", type: "string", placeholder: "#incidents" },
    ],
  },
};

/* ── Component ───────────────────────────────────────────── */

interface Props {
  platforms: Record<string, PlatformConfig>;
  onUpdate: () => void;
}

export default function PlatformConfigPanel({ platforms, onUpdate }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, Record<string, unknown>>>({});
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  const toggleExpand = (p: string) =>
    setExpanded((prev) => (prev === p ? null : p));

  const toggleReveal = (key: string) => {
    setRevealedFields((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const getFieldValue = (platform: string, field: string): string => {
    if (localEdits[platform]?.[field] !== undefined)
      return String(localEdits[platform][field]);
    const val = platforms[platform]?.[field];
    return val !== undefined ? String(val) : "";
  };

  const setField = (platform: string, field: string, value: string) => {
    setLocalEdits((prev) => ({
      ...prev,
      [platform]: { ...prev[platform], [field]: value },
    }));
  };

  /** Check if all required fields have real (non-masked, non-empty) values */
  const isConfigured = (platform: string): boolean => {
    const required = PLATFORM_REQUIRED_FIELDS[platform] ?? [];
    const cfg = platforms[platform] ?? {};
    return required.every((f) => {
      const val = String(cfg[f] ?? "");
      return val !== "" && val !== "****";
    });
  };

  /** Get status label and style for a platform */
  const getStatus = (platform: string) => {
    const cfg = platforms[platform] ?? { enabled: false };
    const enabled = !!cfg.enabled;
    const configured = isConfigured(platform);
    const testResult = testResults[platform];

    if (!enabled) {
      return { label: "Off", style: "bg-[#f5f5f7] text-[#aeaeb2]", sublabel: "Disabled" };
    }
    if (!configured) {
      return { label: "Setup required", style: "bg-amber-50 text-amber-600", sublabel: "Enabled — missing credentials" };
    }
    if (testResult?.ok) {
      return { label: "Connected", style: "bg-emerald-50 text-emerald-600", sublabel: `Verified — ${testResult.latency_ms}ms` };
    }
    if (testResult && !testResult.ok) {
      return { label: "Failed", style: "bg-red-50 text-red-500", sublabel: testResult.message };
    }
    // Configured but not tested
    return { label: "Not verified", style: "bg-blue-50 text-blue-600", sublabel: "Configured — run test to verify" };
  };

  const handleToggle = async (platform: string) => {
    setSaving(platform);
    try {
      await updatePlatforms({
        [platform]: { enabled: !platforms[platform]?.enabled },
      });
      onUpdate();
      setSaved(platform);
      setTimeout(() => setSaved(null), 2000);
    } finally {
      setSaving(null);
    }
  };

  const handleSave = async (platform: string) => {
    if (!localEdits[platform]) return;
    setSaving(platform);
    try {
      await updatePlatforms({ [platform]: localEdits[platform] as Partial<PlatformConfig> });
      setLocalEdits((prev) => {
        const next = { ...prev };
        delete next[platform];
        return next;
      });
      // Clear old test result since config changed
      setTestResults((prev) => {
        const next = { ...prev };
        delete next[platform];
        return next;
      });
      onUpdate();
      setSaved(platform);
      setTimeout(() => setSaved(null), 2000);
    } finally {
      setSaving(null);
    }
  };

  const handleTest = async (platform: string) => {
    setTesting(platform);
    try {
      const result = await testPlatformConnection(platform);
      setTestResults((prev) => ({ ...prev, [platform]: result }));
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [platform]: { ok: false, message: "Request failed", latency_ms: 0 },
      }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[#f2f2f7] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            Ticketing Platforms
          </h3>
        </div>
      </div>

      <div className="divide-y divide-[#f2f2f7]">
        {Object.entries(PLATFORM_DEFS).map(([key, def]) => {
          const cfg = platforms[key] ?? { enabled: false };
          const isEnabled = !!cfg.enabled;
          const isExpanded = expanded === key;
          const status = getStatus(key);
          const configured = isConfigured(key);
          const testResult = testResults[key];

          return (
            <div key={key}>
              {/* Header row */}
              <div className="flex items-center justify-between px-5 py-3">
                <button
                  onClick={() => toggleExpand(key)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-[#aeaeb2]" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-[#aeaeb2]" />
                  )}
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f5f5f7] text-[10px] font-bold text-[#6e6e73]">
                    {def.icon}
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[#1d1d1f]">
                      {def.label}
                    </p>
                    <p className="text-[10px] text-[#aeaeb2]">
                      {status.sublabel}
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-3">
                  {/* Status badge */}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${status.style}`}
                  >
                    {status.label}
                  </span>

                  {/* Toggle switch */}
                  <button
                    onClick={() => handleToggle(key)}
                    disabled={saving === key}
                    className={`relative h-6 w-11 rounded-full transition-colors ${
                      isEnabled ? "bg-[#FF5722]" : "bg-[#e5e5ea]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                        isEnabled ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Expanded config form */}
              {isExpanded && (
                <div className="border-t border-[#f2f2f7] bg-[#fafafa] px-5 py-4">
                  <div className="space-y-3">
                    {def.fields.map((field) => {
                      const isSecret = field.type === "secret";
                      const revealKey = `${key}.${field.key}`;
                      const revealed = revealedFields.has(revealKey);
                      const val = getFieldValue(key, field.key);

                      return (
                        <div key={field.key}>
                          <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[#6e6e73]">
                            {field.label}
                            {field.required && (
                              <span className="text-[#FF5722]">*</span>
                            )}
                          </label>
                          <div className="relative">
                            <input
                              type={isSecret && !revealed ? "password" : "text"}
                              value={val}
                              placeholder={field.placeholder}
                              onChange={(e) =>
                                setField(key, field.key, e.target.value)
                              }
                              className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none transition-colors focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
                            />
                            {isSecret && (
                              <button
                                onClick={() => toggleReveal(revealKey)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#aeaeb2] hover:text-[#6e6e73]"
                              >
                                {revealed ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action buttons */}
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={() => handleSave(key)}
                      disabled={saving === key || !localEdits[key]}
                      className="flex items-center gap-1.5 rounded-full bg-[#FF5722] px-4 py-1.5 text-[12px] font-medium text-white transition-all hover:bg-[#E64A19] disabled:opacity-40"
                    >
                      {saving === key ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : saved === key ? (
                        <Check className="h-3 w-3" />
                      ) : null}
                      {saved === key ? "Saved" : "Save"}
                    </button>

                    <button
                      onClick={() => handleTest(key)}
                      disabled={testing === key || !configured || !!localEdits[key]}
                      title={
                        !configured
                          ? "Fill in required fields first"
                          : localEdits[key]
                            ? "Save changes first"
                            : "Test connection to this platform"
                      }
                      className="flex items-center gap-1.5 rounded-full border border-[#e5e5ea] bg-white px-4 py-1.5 text-[12px] font-medium text-[#6e6e73] transition-all hover:border-[#aeaeb2] hover:text-[#1d1d1f] disabled:opacity-40"
                    >
                      {testing === key ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Zap className="h-3 w-3" />
                      )}
                      Test Connection
                    </button>
                  </div>

                  {/* Test result feedback */}
                  {testResult && (
                    <div
                      className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 ${
                        testResult.ok ? "bg-emerald-50" : "bg-red-50"
                      }`}
                    >
                      {testResult.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle className="mt-0.5 h-3 w-3 flex-shrink-0 text-red-500" />
                      )}
                      <div>
                        <p
                          className={`text-[11px] font-medium ${
                            testResult.ok ? "text-emerald-700" : "text-red-700"
                          }`}
                        >
                          {testResult.ok ? "Connection successful" : "Connection failed"}
                        </p>
                        <p
                          className={`text-[10px] ${
                            testResult.ok ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {testResult.message}
                          {testResult.latency_ms > 0 && ` (${testResult.latency_ms}ms)`}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Credential security note */}
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-500" />
                    <p className="text-[10px] text-amber-700">
                      Runtime credentials are in-memory only. For production, use External
                      Secrets Operator to manage credentials securely.
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
