"use client";

import { useState } from "react";
import {
  type AnomalyConfig,
  type BridgeConfig,
  updateAnomalyConfig,
  updateBridgeConfig,
} from "@/lib/api";
import { Activity, Check, Loader2 } from "lucide-react";

interface Props {
  anomaly: AnomalyConfig;
  bridge: BridgeConfig;
  onUpdate: () => void;
}

export default function AnomalyConfigPanel({
  anomaly,
  bridge,
  onUpdate,
}: Props) {
  const [localAnomaly, setLocalAnomaly] = useState<AnomalyConfig>(anomaly);
  const [localBridge, setLocalBridge] = useState<BridgeConfig>(bridge);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isDirty =
    JSON.stringify(localAnomaly) !== JSON.stringify(anomaly) ||
    JSON.stringify(localBridge) !== JSON.stringify(bridge);

  const handleSave = async () => {
    setSaving(true);
    try {
      const promises: Promise<unknown>[] = [];
      if (JSON.stringify(localAnomaly) !== JSON.stringify(anomaly)) {
        promises.push(updateAnomalyConfig(localAnomaly));
      }
      if (JSON.stringify(localBridge) !== JSON.stringify(bridge)) {
        promises.push(updateBridgeConfig(localBridge));
      }
      await Promise.all(promises);
      onUpdate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between border-b border-[#f2f2f7] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            Anomaly Detection
          </h3>
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

      <div className="p-5 space-y-5">
        {/* Bridge thresholds */}
        <div>
          <h4 className="mb-3 text-[12px] font-semibold text-[#1d1d1f]">
            Detection Engine (Bridge)
          </h4>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Z-Score Threshold */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] font-medium text-[#6e6e73]">
                  Z-Score Threshold
                </label>
                <span className="font-mono text-[12px] font-semibold text-[#1d1d1f]">
                  {localBridge.zscoreThreshold.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min="1.0"
                max="5.0"
                step="0.1"
                value={localBridge.zscoreThreshold}
                onChange={(e) =>
                  setLocalBridge((p) => ({
                    ...p,
                    zscoreThreshold: parseFloat(e.target.value),
                  }))
                }
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#e5e5ea] accent-[#FF5722]"
              />
              <div className="mt-0.5 flex justify-between text-[9px] text-[#aeaeb2]">
                <span>Sensitive (1.0)</span>
                <span>Conservative (5.0)</span>
              </div>
            </div>

            {/* Window Seconds */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] font-medium text-[#6e6e73]">
                  Analysis Window
                </label>
                <span className="font-mono text-[12px] font-semibold text-[#1d1d1f]">
                  {localBridge.windowSeconds}s
                </span>
              </div>
              <input
                type="range"
                min="60"
                max="900"
                step="30"
                value={localBridge.windowSeconds}
                onChange={(e) =>
                  setLocalBridge((p) => ({
                    ...p,
                    windowSeconds: parseInt(e.target.value),
                  }))
                }
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#e5e5ea] accent-[#FF5722]"
              />
              <div className="mt-0.5 flex justify-between text-[9px] text-[#aeaeb2]">
                <span>1 min</span>
                <span>15 min</span>
              </div>
            </div>

            {/* Bulk Size */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#6e6e73]">
                Bulk Index Size
              </label>
              <input
                type="number"
                min="50"
                max="5000"
                step="50"
                value={localBridge.bulkSize}
                onChange={(e) =>
                  setLocalBridge((p) => ({
                    ...p,
                    bulkSize: parseInt(e.target.value) || 500,
                  }))
                }
                className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
              />
            </div>

            {/* Bulk Interval */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#6e6e73]">
                Bulk Interval (seconds)
              </label>
              <input
                type="number"
                min="1"
                max="60"
                step="1"
                value={localBridge.bulkIntervalSeconds}
                onChange={(e) =>
                  setLocalBridge((p) => ({
                    ...p,
                    bulkIntervalSeconds: parseFloat(e.target.value) || 5,
                  }))
                }
                className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
              />
            </div>
          </div>
        </div>

        {/* Ticketing thresholds */}
        <div className="border-t border-[#f2f2f7] pt-5">
          <h4 className="mb-3 text-[12px] font-semibold text-[#1d1d1f]">
            Ticketing Thresholds
          </h4>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Minimum Score */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] font-medium text-[#6e6e73]">
                  Minimum Score
                </label>
                <span className="font-mono text-[12px] font-semibold text-[#1d1d1f]">
                  {localAnomaly.minimumScore.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={localAnomaly.minimumScore}
                onChange={(e) =>
                  setLocalAnomaly((p) => ({
                    ...p,
                    minimumScore: parseFloat(e.target.value),
                  }))
                }
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#e5e5ea] accent-[#FF5722]"
              />
              <div className="mt-0.5 flex justify-between text-[9px] text-[#aeaeb2]">
                <span>All alerts (0.1)</span>
                <span>Critical only (1.0)</span>
              </div>
            </div>

            {/* Dedup Window */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#6e6e73]">
                Deduplication Window (minutes)
              </label>
              <input
                type="number"
                min="1"
                max="120"
                value={localAnomaly.deduplicationWindowMinutes}
                onChange={(e) =>
                  setLocalAnomaly((p) => ({
                    ...p,
                    deduplicationWindowMinutes: parseInt(e.target.value) || 15,
                  }))
                }
                className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
              />
            </div>

            {/* Context Window */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#6e6e73]">
                Context Window (minutes)
              </label>
              <input
                type="number"
                min="1"
                max="60"
                value={localAnomaly.contextWindowMinutes}
                onChange={(e) =>
                  setLocalAnomaly((p) => ({
                    ...p,
                    contextWindowMinutes: parseInt(e.target.value) || 5,
                  }))
                }
                className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
              />
            </div>

            {/* Max Context Lines */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#6e6e73]">
                Max Context Log Lines
              </label>
              <input
                type="number"
                min="10"
                max="500"
                step="10"
                value={localAnomaly.maxContextLogLines}
                onChange={(e) =>
                  setLocalAnomaly((p) => ({
                    ...p,
                    maxContextLogLines: parseInt(e.target.value) || 50,
                  }))
                }
                className="w-full rounded-xl border border-[#e5e5ea] bg-white px-3 py-2 font-mono text-[12px] text-[#1d1d1f] outline-none focus:border-[#FF5722] focus:ring-1 focus:ring-[#FF5722]/20"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
