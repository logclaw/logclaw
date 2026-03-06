"use client";

export function SkeletonBox({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} />;
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] sm:p-5">
      <div className="flex items-center justify-between">
        <SkeletonBox className="h-8 w-8 rounded-xl sm:h-10 sm:w-10" />
        <SkeletonBox className="h-4 w-10 rounded-full" />
      </div>
      <SkeletonBox className="mt-3 h-8 w-24 sm:mt-4" />
      <SkeletonBox className="mt-2 h-3 w-20" />
    </div>
  );
}

export function IncidentCardSkeleton() {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2.5 flex items-center gap-2">
            <SkeletonBox className="h-5 w-16 rounded-md" />
            <SkeletonBox className="h-5 w-20 rounded-md" />
          </div>
          <SkeletonBox className="h-4 w-3/4" />
          <div className="mt-2 flex items-center gap-3">
            <SkeletonBox className="h-3 w-20" />
            <SkeletonBox className="h-3 w-16" />
          </div>
        </div>
        <SkeletonBox className="h-4 w-4 shrink-0 rounded" />
      </div>
    </div>
  );
}

export function BarChartSkeleton() {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <SkeletonBox className="mb-4 h-3 w-32" />
      <div className="space-y-3">
        {[80, 60, 40, 25].map((w, i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonBox className="h-3 w-16" />
            <div className="relative flex-1 h-[22px] overflow-hidden rounded-full bg-[#f5f5f7]">
              <SkeletonBox className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${w}%` }} />
            </div>
            <SkeletonBox className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function IncidentDetailSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <SkeletonBox className="mb-4 h-4 w-32" />
        <div className="flex items-center gap-2">
          <SkeletonBox className="h-6 w-16 rounded-md" />
          <SkeletonBox className="h-6 w-24 rounded-md" />
          <SkeletonBox className="h-6 w-20 rounded-md" />
        </div>
        <SkeletonBox className="mt-2 h-6 w-2/3" />
        <div className="mt-2 flex items-center gap-3">
          <SkeletonBox className="h-4 w-24" />
          <SkeletonBox className="h-4 w-20" />
        </div>
      </div>
      <div className="flex gap-2">
        <SkeletonBox className="h-10 w-32 rounded-full" />
        <SkeletonBox className="h-10 w-24 rounded-full" />
      </div>
      <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <SkeletonBox className="mb-3 h-3 w-24" />
        <SkeletonBox className="h-4 w-full" />
        <SkeletonBox className="mt-2 h-4 w-5/6" />
        <SkeletonBox className="mt-2 h-4 w-3/4" />
      </div>
      <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <SkeletonBox className="mb-3 h-3 w-36" />
        <SkeletonBox className="h-4 w-full" />
        <SkeletonBox className="mt-2 h-4 w-4/5" />
      </div>
    </div>
  );
}

export function PipelineFlowSkeleton() {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <SkeletonBox className="mb-4 h-3 w-28" />
      <div className="flex items-center justify-between gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <SkeletonBox className="h-12 w-12 rounded-xl" />
            <SkeletonBox className="h-3 w-16" />
            <SkeletonBox className="h-5 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
