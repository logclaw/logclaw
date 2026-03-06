"use client";

import { useState } from "react";
import {
  type LlmConfig,
  type TestResult,
  updateLlmConfig,
  testLlmConnection,
} from "@/lib/api";
import {
  Brain,
  Check,
  Loader2,
  Zap,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  KeyRound,
} from "lucide-react";

/* ── Provider catalog with defaults ─────────────────────── */

const PROVIDERS = [
  { value: "disabled", label: "Disabled", desc: "No LLM — raw anomaly data only" },
  { value: "ollama", label: "Ollama", desc: "In-cluster Llama model (air-gapped)" },
  { value: "vllm", label: "vLLM", desc: "In-cluster vLLM server" },
  { value: "claude", label: "Claude", desc: "Anthropic Claude API" },
  { value: "openai", label: "OpenAI", desc: "OpenAI API" },
] as const;

const PROVIDER_DEFAULTS: Record<string, { model: string; endpoint: string }> = {
  disabled: { model: "", endpoint: "" },
  ollama: { model: "llama3.2:8b", endpoint: "http://ollama.logclaw.svc:11434" },
  vllm: { model: "", endpoint: "http://vllm.logclaw.svc:8000" },
  claude: { model: "claude-sonnet-4-20250514", endpoint: "https://api.anthropic.com" },
  openai: { model: "gpt-4o", endpoint: "https://api.openai.com" },
};

const PLACEHOLDERS: Record<string, { model: string; endpoint: string }> = {
  ollama: { model: "llama3.2:8b", endpoint: "http://ollama.logclaw.svc:11434" },
  vllm: { model: "meta-llama/Llama-3.2-8B", endpoint: "http://vllm.logclaw.svc:8000" },
  claude: { model: "claude-sonnet-4-20250514", endpoint: "https://api.anthropic.com" },
  openai: { model: "gpt-4o", endpoint: "https://api.openai.com" },
};

const NEEDS_API_KEY = new Set(["claude", "openai"]);

/* ── Component ──────────────────────────────────────────── */

interface Props {
  llm: LlmConfig;
  onUpdate: () => void;
}

export default function LlmConfigPanel({ llm, onUpdate }: Props) {
  const [local, setLocal] = useState<LlmConfig>(llm);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showKey, setShowKey] = useState(false);

  /** Compare local vs saved — treat masked api_key ("****") as unchanged */
  const isDirty = (() => {
    const { api_key: localKey, ...localRest } = local;
    const { api_key: savedKey, ...savedRest } = llm;
    if (JSON.stringify(localRest) !== JSON.stringify(savedRest)) return true;
    // If saved key is masked and local key is non-empty, treat as clean (already saved)
    if (savedKey === "****" && localKey && localKey !== "****") return false;
    return localKey !== savedKey;
  })();

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateLlmConfig(local);
      onUpdate();
      setSaved(true);
      setTestResult(null);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testLlmConnection();
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, message: "Request failed", latency_ms: 0 });
    } finally {
      setTesting(false);
    }
  };

  /** All known default model/endpoint values — used to detect "unedited" fields. */
  const ALL_DEFAULT_MODELS = new Set(
    Object.values(PROVIDER_DEFAULTS).map((d) => d.model).filter(Boolean),
  );
  const ALL_DEFAULT_ENDPOINTS = new Set(
    Object.values(PROVIDER_DEFAULTS).map((d) => d.endpoint).filter(Boolean),
  );

  /** Switch provider — auto-populate defaults when fields are empty or match any known default */
  const handleProviderSwitch = (newProvider: LlmConfig["provider"]) => {
    const defaults = PROVIDER_DEFAULTS[newProvider] ?? { model: "", endpoint: "" };

    setLocal((prev) => ({
      ...prev,
      provider: newProvider,
      // Auto-fill model if empty or matches ANY provider's default (user hasn't customized it)
      model: !prev.model || ALL_DEFAULT_MODELS.has(prev.model) ? defaults.model : prev.model,
      // Auto-fill endpoint if empty or matches ANY provider's default
      endpoint: !prev.endpoint || ALL_DEFAULT_ENDPOINTS.has(prev.endpoint) ? defaults.endpoint : prev.endpoint,
      // Clear API key when switching away from cloud providers
      api_key: NEEDS_API_KEY.has(newProvider) ? prev.api_key : "",
    }));
  };

  const activeProvider = PROVIDERS.find((p) => p.value === local.provider);
  const canTest = llm.provider !== "disabled" && llm.endpoint && !isDirty;
  const needsKey = NEEDS_API_KEY.has(local.provider);
  const ph = PLACEHOLDERS[local.provider] ?? { model: "", endpoint: "" };

  return (
    <div className="rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[#f2f2f7] px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            LLM Provider
          </h3>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Status indicator */}
          <div className="hidden items-center gap-1.5 sm:flex">
            <div
              className={`h-2 w-2 rounded-full ${
                local.provider === "disabled"
                  ? "bg-[#aeaeb2]"
                  : testResult?.ok
                    ? "bg-emerald-500"
                    : "bg-amber-500 animate-pulse"
              }`}
            />
            <span className="text-[11px] font-medium text-[#6e6e73]">
              {local.provider === "disabled"
                ? "Off"
                : testResult?.ok
                  ? `${activeProvider?.label} connected`
                  : activeProvider?.label}
            </span>
          </div>
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

      <div className="p-4 space-y-4 sm:p-5">
        {/* Provider selector */}
        <div>
          <label className="mb-2 block text-[11px] font-medium text-[#6e6e73]">
            Provider
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                onClick={() => handleProviderSwitch(p.value as LlmConfig["provider"])}
                className={`rounded-xl border px-3 py-2 text-left transition-all ${
                  local.provider === p.value
                    ? "border-[#FF5722] bg-[#FFF3E0] ring-1 ring-[#FF5722]/20"
                    : "border-[#e5e5ea] bg-white hover:border-[#aeaeb2]"
                }`}
              >
                <span
                  className={`block text-[12px] font-medium ${
                    local.provider === p.value
                      ? "text-[#FF5722]"
                      : "text-[#1d1d1f]"
                  }`}
                >
                  {p.label}
                </span>
                <span className="block text-[9px] text-[#aeaeb2] mt-0.5">
                  {p.desc}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Model + Endpoint (shown when not disabled) */}
        {local.provider !== "disabled" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#6e6e73]">
                Model
              </label>
              <input
                type="text"
                value={local.model}
                placeholder={ph.model}
                onChange={(e) =>
                  setLocal((prev) => ({ ...prev, model: e.target.value }))
                }
                className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#6e6e73]">
                Endpoint URL
              </label>
              <input
                type="text"
                value={local.endpoint}
                placeholder={ph.endpoint}
                onChange={(e) =>
                  setLocal((prev) => ({ ...prev, endpoint: e.target.value }))
                }
                className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
              />
            </div>
          </div>
        )}

        {/* API Key (shown for Claude / OpenAI) */}
        {needsKey && (
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-[#6e6e73]">
              <KeyRound className="h-3 w-3" />
              API Key
              <span className="text-[9px] text-[#aeaeb2] ml-1">
                {local.provider === "claude" ? "Anthropic" : "OpenAI"}
              </span>
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={local.api_key}
                placeholder={
                  local.provider === "claude"
                    ? "sk-ant-api03-…"
                    : "sk-…"
                }
                onChange={(e) =>
                  setLocal((prev) => ({ ...prev, api_key: e.target.value }))
                }
                className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 pr-10 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#aeaeb2] hover:text-[#6e6e73] transition-colors"
              >
                {showKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="mt-1 text-[9px] text-[#aeaeb2]">
              Stored in runtime memory only. Cleared on pod restart. Set <code className="bg-[#f5f5f7] px-1 rounded text-[8px]">
              {local.provider === "claude" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}
              </code> env var for persistence.
            </p>
          </div>
        )}

        {/* Test Connection button + result */}
        {local.provider !== "disabled" && (
          <div>
            <button
              onClick={handleTest}
              disabled={testing || !canTest}
              title={
                isDirty
                  ? "Save changes first"
                  : !llm.endpoint
                    ? "Set an endpoint URL first"
                    : "Test connection to the LLM provider"
              }
              className="flex items-center gap-1.5 rounded-full border border-[#e5e5ea] bg-white px-4 py-1.5 text-[12px] font-medium text-[#6e6e73] transition-all hover:border-[#aeaeb2] hover:text-[#1d1d1f] disabled:opacity-40"
            >
              {testing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
              Test Connection
            </button>

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
          </div>
        )}
      </div>
    </div>
  );
}
