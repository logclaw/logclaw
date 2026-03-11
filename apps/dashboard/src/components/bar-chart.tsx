"use client";

interface BarChartProps {
  title: string;
  data: { label: string; value: number; color?: string }[];
}

const defaultColors = [
  "bg-blue-500",
  "bg-red-400",
  "bg-amber-400",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-cyan-500",
  "bg-orange-400",
  "bg-pink-400",
];

export default function BarChart({ title, data }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
        {title}
      </h3>
      <div className="space-y-3">
        {data.map((d, i) => (
          <div key={d.label} className="flex items-center gap-2 sm:gap-3">
            <span className="w-24 truncate text-[11px] font-medium text-[#6e6e73] sm:w-36 sm:text-[12px]" title={d.label}>
              {d.label}
            </span>
            <div className="relative flex-1 h-[22px] overflow-hidden rounded-full bg-[#f5f5f7]">
              <div
                className={`animate-bar-grow absolute inset-y-0 left-0 rounded-full ${d.color ?? defaultColors[i % defaultColors.length]} transition-all`}
                style={{
                  width: `${(d.value / max) * 100}%`,
                  animationDelay: `${i * 100}ms`,
                }}
              />
            </div>
            <span className="w-14 text-right text-[12px] font-mono font-medium text-[#1d1d1f]">
              {d.value.toLocaleString()}
            </span>
          </div>
        ))}
        {data.length === 0 && (
          <p className="py-8 text-center text-[13px] text-[#aeaeb2]">No data</p>
        )}
      </div>
    </div>
  );
}
