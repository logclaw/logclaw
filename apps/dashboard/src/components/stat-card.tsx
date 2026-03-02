interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
  trend?: string;
  color?: string;
}

export default function StatCard({
  label,
  value,
  icon,
  trend,
  color = "text-blue-400",
}: StatCardProps) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        {trend && (
          <span className="text-xs text-slate-500">{trend}</span>
        )}
      </div>
      <p className={`mt-2 text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  );
}
