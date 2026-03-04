import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  trend?: string;
  color?: string;
}

export default function StatCard({
  label,
  value,
  icon,
  trend,
  color = "text-[#FF5722]",
}: StatCardProps) {
  return (
    <div className="card-hover rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] sm:p-5">
      <div className="flex items-center justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f5f5f7] text-[#6e6e73] sm:h-10 sm:w-10">
          {icon}
        </div>
        {trend && (
          <span className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] font-medium text-[#aeaeb2]">
            {trend}
          </span>
        )}
      </div>
      <p className={`mt-3 text-[22px] font-bold tracking-tight sm:mt-4 sm:text-[28px] ${color}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-[#6e6e73] sm:text-[13px]">{label}</p>
    </div>
  );
}
