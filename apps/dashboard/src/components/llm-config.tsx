"use client";

import { useState, useCallback } from "react";
import {
  type LlmConfig,
  type LlmProviderEntry,
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
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  GripVertical,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";

/* ── Provider catalog ──────────────────────────────────── */

const AVAILABLE_PROVIDERS = [
  { value: "openai", label: "OpenAI", desc: "OpenAI GPT API" },
  { value: "claude", label: "Claude", desc: "Anthropic Claude API" },
  { value: "ollama", label: "Ollama", desc: "In-cluster Llama (air-gapped)" },
  { value: "vllm", label: "vLLM", desc: "In-cluster vLLM server" },
] as const;

const PROVIDER_DEFAULTS: Record<string, { model: string; endpoint: string }> = {
  ollama: { model: "llama3.2:8b", endpoint: "http://ollama.logclaw.svc:11434" },
  vllm: { model: "", endpoint: "http://vllm.logclaw.svc:8000" },
  claude: { model: "claude-3-5-haiku-latest", endpoint: "https://api.anthropic.com" },
  openai: { model: "gpt-4o-mini", endpoint: "https://api.openai.com" },
};

const NEEDS_API_KEY = new Set(["claude", "openai"]);

/* ── Default chain ─────────────────────────────────────── */

const DEFAULT_CHAIN: LlmProviderEntry[] = [
  { name: "openai", model: "gpt-4o-mini", endpoint: "https://api.openai.com", api_key: "", enabled: true },
  { name: "openai", model: "gpt-4o", endpoint: "https://api.openai.com", api_key: "", enabled: true },
  { name: "claude", model: "claude-3-5-haiku-latest", endpoint: "https://api.anthropic.com", api_key: "", enabled: true },
  { name: "claude", model: "claude-sonnet-4-20250514", endpoint: "https://api.anthropic.com", api_key: "", enabled: true },
];

/* ── Component ─────────────────────────────────────────── */

interface Props {
  llm: LlmConfig;
  onUpdate: () => void;
}

export default function LlmConfigPanel({ llm, onUpdate }: Props) {
  const initialChain = llm.providers?.length ? llm.providers : DEFAULT_CHAIN;
  const [chain, setChain] = useState<LlmProviderEntry[]>(initialChain);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingIdx, setTestingIdx] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});
  const [showAddMenu, setShowAddMenu] = useState(false);

  const isDirty = JSON.stringify(chain) !== JSON.stringify(initialChain);
  const isDisabled = chain.length === 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateLlmConfig({ providers: chain } as any);
      onUpdate();
      setSaved(true);
      setTestResults({});
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleTestProvider = useCallback(async (idx: number) => {
    setTestingIdx(idx);
    try {
      const p = chain[idx];
      const key = `${p.name}:${p.model}`;
      const result = await testLlmConnection(key);
      setTestResults((prev) => ({ ...prev, [idx]: result }));
    } catch {
      setTestResults((prev) => ({ ...prev, [idx]: { ok: false, message: "Request failed", latency_ms: 0 } }));
    } finally {
      setTestingIdx(null);
    }
  }, [chain]);

  const addProvider = (name: string) => {
    const defaults = PROVIDER_DEFAULTS[name] ?? { model: "", endpoint: "" };
    setChain((prev) => [
      ...prev,
      { name: name as any, model: defaults.model, endpoint: defaults.endpoint, api_key: "", enabled: true },
    ]);
    setShowAddMenu(false);
    setExpandedIdx(chain.length);
  };

  const removeProvider = (idx: number) => {
    setChain((prev) => prev.filter((_, i) => i !== idx));
    setExpandedIdx(null);
  };

  const moveProvider = (idx: number, direction: "up" | "down") => {
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= chain.length) return;
    setChain((prev) => {
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
    setExpandedIdx(newIdx);
  };

  const updateEntry = (idx: number, updates: Partial<LlmProviderEntry>) => {
    setChain((prev) => prev.map((p, i) => (i === idx ? { ...p, ...updates } : p)));
  };

  const providerLabel = (name: string) =>
    AVAILABLE_PROVIDERS.find((p) => p.value === name)?.label ?? name;

  return (
    <div className="rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#f2f2f7] px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            LLM Provider Chain
          </h3>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-1.5 sm:flex">
            <div
              className={`h-2 w-2 rounded-full ${
                isDisabled ? "bg-[#aeaeb2]" : "bg-emerald-500 animate-pulse"
              }`}
            />
            <span className="text-[11px] font-medium text-[#6e6e73]">
              {isDisabled ? "Off" : `${chain.filter((p) => p.enabled).length} provider(s) active`}
            </span>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-1.5 rounded-full bg-[#FF5722] px-3 py-1.5 text-[11px] font-medium text-white transition-all hover:bg-[#E64A19] disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? <Check className="h-3 w-3" /> : null}
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3 sm:p-5">
        {/* Provider chain list */}
        {chain.map((entry, idx) => {
          const isExpanded = expandedIdx === idx;
          const needsKey = NEEDS_API_KEY.has(entry.name);
          const hasDefaultKey = needsKey && !entry.api_key;
          const result = testResults[idx];

          return (
            <div
              key={`${entry.name}-${entry.model}-${idx}`}
              className={`rounded-xl border transition-all ${
                !entry.enabled
                  ? "border-[#e5e5ea] bg-[#fafafa] opacity-60"
                  : isExpanded
                    ? "border-[#FF5722] bg-[#FFF3E0] ring-1 ring-[#FF5722]/10"
                    : "border-[#e5e5ea] bg-white hover:border-[#d1d1d6]"
              }`}
            >
              {/* Row header */}
              <div
                className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              >
                <GripVertical className="h-3.5 w-3.5 text-[#d1d1d6] flex-shrink-0" />

                {/* Priority number */}
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#f2f2f7] text-[10px] font-bold text-[#6e6e73]">
                  {idx + 1}
                </span>

                {/* Provider name + model */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-[#1d1d1f]">
                      {providerLabel(entry.name)}
                    </span>
                    <span className="text-[10px] font-mono text-[#aeaeb2] truncate">
                      {entry.model}
                    </span>
                  </div>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {hasDefaultKey && (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-medium text-emerald-700">
                      <ShieldCheck className="h-2.5 w-2.5" />
                      LogClaw default
                    </span>
                  )}
                  {needsKey && entry.api_key && entry.api_key !== "****" && (
                    <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-medium text-blue-700">
                      <KeyRound className="h-2.5 w-2.5" />
                      Custom key
                    </span>
                  )}
                  {result && (
                    <span
                      className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                        result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                      }`}
                    >
                      {result.ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                      {result.latency_ms > 0 ? `${result.latency_ms}ms` : result.ok ? "OK" : "Fail"}
                    </span>
                  )}

                  {/* Toggle enabled */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateEntry(idx, { enabled: !entry.enabled });
                    }}
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      entry.enabled ? "bg-[#FF5722]" : "bg-[#d1d1d6]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        entry.enabled ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>

                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 text-[#aeaeb2]" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-[#aeaeb2]" />
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="border-t border-[#f2f2f7] px-3 py-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-[#6e6e73]">Model</label>
                      <input
                        type="text"
                        value={entry.model}
                        placeholder={PROVIDER_DEFAULTS[entry.name]?.model ?? ""}
                        onChange={(e) => updateEntry(idx, { model: e.target.value })}
                        className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-[#6e6e73]">Endpoint URL</label>
                      <input
                        type="text"
                        value={entry.endpoint}
                        placeholder={PROVIDER_DEFAULTS[entry.name]?.endpoint ?? ""}
                        onChange={(e) => updateEntry(idx, { endpoint: e.target.value })}
                        className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
                      />
                    </div>
                  </div>

                  {/* API Key override */}
                  {needsKey && (
                    <div>
                      <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-[#6e6e73]">
                        <KeyRound className="h-3 w-3" />
                        API Key Override
                        <span className="text-[9px] text-[#aeaeb2] ml-1">
                          Leave empty to use LogClaw default
                        </span>
                      </label>
                      <input
                        type="password"
                        value={entry.api_key}
                        placeholder="Leave empty for LogClaw default key"
                        onChange={(e) => updateEntry(idx, { api_key: e.target.value })}
                        className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
                      />
                    </div>
                  )}

                  {/* Actions row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTestProvider(idx)}
                        disabled={testingIdx !== null}
                        className="flex items-center gap-1.5 rounded-full border border-[#e5e5ea] bg-white px-3 py-1 text-[11px] font-medium text-[#6e6e73] transition-all hover:border-[#aeaeb2] hover:text-[#1d1d1f] disabled:opacity-40"
                      >
                        {testingIdx === idx ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                        Test
                      </button>
                      <button
                        onClick={() => moveProvider(idx, "up")}
                        disabled={idx === 0}
                        className="rounded-lg border border-[#e5e5ea] p-1 text-[#aeaeb2] hover:text-[#1d1d1f] disabled:opacity-30"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => moveProvider(idx, "down")}
                        disabled={idx === chain.length - 1}
                        className="rounded-lg border border-[#e5e5ea] p-1 text-[#aeaeb2] hover:text-[#1d1d1f] disabled:opacity-30"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                    <button
                      onClick={() => removeProvider(idx)}
                      className="flex items-center gap-1 rounded-full border border-red-200 px-2.5 py-1 text-[11px] font-medium text-red-500 transition-all hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      Remove
                    </button>
                  </div>

                  {/* Test result */}
                  {result && (
                    <div
                      className={`flex items-start gap-2 rounded-lg px-3 py-2 ${
                        result.ok ? "bg-emerald-50" : "bg-red-50"
                      }`}
                    >
                      {result.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle className="mt-0.5 h-3 w-3 flex-shrink-0 text-red-500" />
                      )}
                      <p className={`text-[10px] ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
                        {result.message}
                        {result.latency_ms > 0 && ` (${result.latency_ms}ms)`}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Add Provider */}
        <div className="relative">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[#e5e5ea] py-2.5 text-[11px] font-medium text-[#aeaeb2] transition-all hover:border-[#FF5722] hover:text-[#FF5722]"
          >
            <Plus className="h-3 w-3" />
            Add Provider
          </button>
          {showAddMenu && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-xl border border-[#e5e5ea] bg-white shadow-lg">
              {AVAILABLE_PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => addProvider(p.value)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-[#f2f2f7] first:rounded-t-xl last:rounded-b-xl"
                >
                  <span className="font-medium text-[#1d1d1f]">{p.label}</span>
                  <span className="text-[10px] text-[#aeaeb2]">{p.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info text */}
        <div className="flex items-start gap-2 rounded-lg bg-[#f2f2f7] px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-[#aeaeb2]" />
          <p className="text-[10px] text-[#6e6e73]">
            Providers are tried in order. If one fails, the next is used automatically.
            Circuit breaker skips providers that fail 3 times in a row for 60 seconds.
            Cloud providers use LogClaw default keys unless you provide your own.
          </p>
        </div>
      </div>
    </div>
  );
}
