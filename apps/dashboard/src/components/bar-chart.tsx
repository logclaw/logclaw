"use client";

interface BarChartProps {
  title: string;
  data: { label: string; value: number; color?: string }[];
}

const defaultColors = [
  "bg-blue-500",
  "bg-red-500",
  "bg-yellow-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-pink-500",
];

export default function BarChart({ title, data }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-400 uppercase tracking-wider">
        {title}
      </h3>
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={d.label} className="flex items-center gap-3">
            <span className="w-20 truncate text-xs text-slate-400">
              {d.label}
            </span>
            <div className="relative flex-1 h-5 rounded bg-slate-700/50">
              <div
                className={`h-full rounded ${d.color ?? defaultColors[i % defaultColors.length]} transition-all duration-500`}
                style={{ width: `${(d.value / max) * 100}%` }}
              />
            </div>
            <span className="w-12 text-right text-xs font-mono text-slate-300">
              {d.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
