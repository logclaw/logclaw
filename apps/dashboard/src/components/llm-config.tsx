"use client";

import { useState } from "react";
import { type LlmConfig, updateLlmConfig } from "@/lib/api";
import { Brain, Check, Loader2 } from "lucide-react";

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

  const isDirty = JSON.stringify(local) !== JSON.stringify(llm);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateLlmConfig(local);
      onUpdate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const activeProvider = PROVIDERS.find((p) => p.value === local.provider);

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
                  : "bg-emerald-500 animate-pulse"
              }`}
            />
            <span className="text-[11px] font-medium text-[#6e6e73]">
              {local.provider === "disabled" ? "Off" : activeProvider?.label}
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
      </div>
    </div>
  );
}
