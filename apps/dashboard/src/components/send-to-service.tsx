"use client";

import { useState, useEffect, useRef } from "react";
import {
  fetchTicketingConfig,
  forwardIncident,
  PLATFORM_REQUIRED_FIELDS,
  type TicketingConfig,
} from "@/lib/api";
import {
  Send,
  ChevronDown,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react";

/* ── Platform definitions (mirrors platform-config.tsx) ──── */

const PLATFORMS = [
  { key: "pagerduty", label: "PagerDuty", icon: "PD", bg: "bg-[#06AC38]", bgMuted: "bg-[#06AC38]/15", text: "text-white", textMuted: "text-[#06AC38]" },
  { key: "jira", label: "Jira", icon: "JR", bg: "bg-[#0052CC]", bgMuted: "bg-[#0052CC]/15", text: "text-white", textMuted: "text-[#0052CC]" },
  { key: "servicenow", label: "ServiceNow", icon: "SN", bg: "bg-[#81B5A1]", bgMuted: "bg-[#81B5A1]/15", text: "text-white", textMuted: "text-[#5A8F7A]" },
  { key: "opsgenie", label: "OpsGenie", icon: "OG", bg: "bg-[#2684FF]", bgMuted: "bg-[#2684FF]/15", text: "text-white", textMuted: "text-[#2684FF]" },
  { key: "slack", label: "Slack", icon: "SK", bg: "bg-[#E01E5A]", bgMuted: "bg-[#E01E5A]/15", text: "text-white", textMuted: "text-[#E01E5A]" },
  { key: "email", label: "Email", icon: "EM", bg: "bg-[#7C3AED]", bgMuted: "bg-[#7C3AED]/15", text: "text-white", textMuted: "text-[#7C3AED]" },
] as const;

/* ── Component ───────────────────────────────────────────── */

interface Props {
  incidentId: string;
  onForwarded?: () => void;
}

export default function SendToServiceDropdown({ incidentId, onForwarded }: Props) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<TicketingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [forwarding, setForwarding] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; message: string }>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load platform config
  useEffect(() => {
    fetchTicketingConfig()
      .then(setConfig)
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const isConfigured = (platform: string): boolean => {
    if (!config) return false;
    const cfg = config.platforms[platform];
    if (!cfg || !cfg.enabled) return false;
    const required = PLATFORM_REQUIRED_FIELDS[platform] ?? [];
    return required.every((f) => {
      const val = String(cfg[f] ?? "");
      return val !== "" && val !== "****";
    });
  };

  const handleForward = async (platform: string) => {
    if (!isConfigured(platform) || forwarding) return;
    setForwarding(platform);
    try {
      await forwardIncident(incidentId, platform);
      setResult((prev) => ({ ...prev, [platform]: { ok: true, message: "Sent" } }));
      onForwarded?.();
    } catch (e: any) {
      setResult((prev) => ({ ...prev, [platform]: { ok: false, message: e.message } }));
    } finally {
      setForwarding(null);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full border border-[#e5e5ea] bg-white px-4 py-2 text-[13px] font-medium text-[#1d1d1f] shadow-sm transition-all hover:border-[#aeaeb2] hover:shadow-md active:scale-[0.98]"
      >
        <Send className="h-3.5 w-3.5 text-[#6e6e73]" />
        Send to…
        <ChevronDown
          className={`h-3.5 w-3.5 text-[#aeaeb2] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 animate-fade-in overflow-hidden rounded-2xl border border-[#e5e5ea] bg-white/95 shadow-[0_12px_40px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.06)] backdrop-blur-xl">
          {/* Header */}
          <div className="border-b border-[#f2f2f7] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
              Forward Incident
            </p>
          </div>

          {/* Platform List */}
          <div className="py-1">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[#aeaeb2]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading platforms…
              </div>
            ) : (
              PLATFORMS.map(({ key, label, icon, bg, bgMuted, text, textMuted }) => {
                const configured = isConfigured(key);
                const isForwarding = forwarding === key;
                const res = result[key];

                return (
                  <button
                    key={key}
                    onClick={() => handleForward(key)}
                    disabled={!configured || !!forwarding}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      configured
                        ? "hover:bg-[#f5f5f7] active:bg-[#e5e5ea]"
                        : "cursor-not-allowed opacity-60"
                    }`}
                    title={
                      configured
                        ? `Send to ${label}`
                        : `${label} is not configured — go to Settings`
                    }
                  >
                    {/* Platform icon badge — branded color */}
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${
                        configured
                          ? `${bg} ${text}`
                          : `${bgMuted} ${textMuted}`
                      }`}
                    >
                      {icon}
                    </div>

                    {/* Platform name + status */}
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-[13px] font-medium ${
                          configured ? "text-[#1d1d1f]" : "text-[#86868b]"
                        }`}
                      >
                        {label}
                      </p>
                      <p className={`text-[10px] ${configured ? "text-emerald-600" : "text-[#aeaeb2]"}`}>
                        {configured ? "Connected" : "Not configured"}
                      </p>
                    </div>

                    {/* Status indicator */}
                    <div className="shrink-0">
                      {isForwarding ? (
                        <Loader2 className="h-4 w-4 animate-spin text-[#FF5722]" />
                      ) : res?.ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : res && !res.ok ? (
                        <XCircle className="h-4 w-4 text-red-500" />
                      ) : (
                        <div
                          className={`h-2.5 w-2.5 rounded-full ${
                            configured ? "bg-emerald-500" : "bg-[#c7c7cc]"
                          }`}
                        />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-[#f2f2f7] px-4 py-2.5">
            <a
              href="/settings"
              className="flex items-center gap-1.5 text-[11px] font-medium text-[#6e6e73] transition-colors hover:text-[#FF5722]"
            >
              <ExternalLink className="h-3 w-3" />
              Manage integrations in Settings
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
