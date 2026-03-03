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
} from "lucide-react";

const PROVIDERS = [
  { value: "disabled", label: "Disabled", desc: "No LLM — raw anomaly data only" },
  { value: "ollama", label: "Ollama", desc: "In-cluster Llama model (air-gapped)" },
  { value: "vllm", label: "vLLM", desc: "In-cluster vLLM server" },
  { value: "claude", label: "Claude", desc: "Anthropic Claude API" },
  { value: "openai", label: "OpenAI", desc: "OpenAI API" },
] as const;

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

  const isDirty = JSON.stringify(local) !== JSON.stringify(llm);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateLlmConfig(local);
      onUpdate();
      setSaved(true);
      setTestResult(null); // Clear old test since config changed
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

  const activeProvider = PROVIDERS.find((p) => p.value === local.provider);
  const canTest = llm.provider !== "disabled" && llm.endpoint && !isDirty;

  return (
    <div className="rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[#f2f2f7] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            LLM Provider
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div className="flex items-center gap-1.5">
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

      <div className="p-5 space-y-4">
        {/* Provider selector */}
        <div>
          <label className="mb-2 block text-[11px] font-medium text-[#6e6e73]">
            Provider
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                onClick={() =>
                  setLocal((prev) => ({ ...prev, provider: p.value as LlmConfig["provider"] }))
                }
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
                placeholder="llama3.2:8b"
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
                placeholder="http://ollama.logclaw.svc:11434"
                onChange={(e) =>
                  setLocal((prev) => ({ ...prev, endpoint: e.target.value }))
                }
                className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
              />
            </div>
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
