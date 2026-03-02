"use client";

const stages = [
  { name: "Ingest", desc: "Vector", icon: "📥", color: "bg-cyan-500" },
  { name: "Stream", desc: "Kafka", icon: "📡", color: "bg-purple-500" },
  { name: "ETL", desc: "Bridge", icon: "🔄", color: "bg-yellow-500" },
  { name: "Detect", desc: "Anomaly", icon: "🔍", color: "bg-orange-500" },
  { name: "Index", desc: "OpenSearch", icon: "💾", color: "bg-green-500" },
  { name: "Enrich", desc: "Flink", icon: "⚡", color: "bg-blue-500" },
];

export default function PipelineFlow() {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
      <h3 className="mb-4 text-sm font-medium text-slate-400 uppercase tracking-wider">
        Pipeline Flow
      </h3>
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
        {stages.map((stage, i) => (
          <div key={stage.name} className="flex items-center gap-2">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-lg ${stage.color}/20 text-xl`}
              >
                {stage.icon}
              </div>
              <span className="text-xs font-medium text-slate-300">
                {stage.name}
              </span>
              <span className="text-[10px] text-slate-500">{stage.desc}</span>
            </div>
            {i < stages.length - 1 && (
              <div className="mx-1 text-slate-600">→</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
