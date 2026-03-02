"use client";

import FileUploader from "@/components/file-uploader";

export default function IngestionPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-200">Log Ingestion</h1>

      <FileUploader />

      {/* API docs reference */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6">
        <h3 className="mb-3 text-sm font-medium text-slate-400 uppercase tracking-wider">
          API Reference
        </h3>
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium text-slate-300">
              POST /api/vector/
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              Send log entries directly to the Vector ingestion pipeline.
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-400">
{`curl -X POST http://localhost:3000/api/vector/ \\
  -H "Content-Type: application/json" \\
  -d '[{
    "timestamp": "2025-01-15T10:30:00Z",
    "level": "ERROR",
    "message": "Connection timeout",
    "service": "payment-api",
    "host": "prod-web-01"
  }]'`}
            </pre>
          </div>

          <div>
            <h4 className="text-sm font-medium text-slate-300">
              Supported Formats
            </h4>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { format: "JSON", ext: ".json", desc: "Array or single object" },
                { format: "NDJSON", ext: ".ndjson", desc: "One JSON per line" },
                { format: "CSV", ext: ".csv", desc: "Header row required" },
                { format: "Text", ext: ".txt/.log", desc: "One log per line" },
              ].map((f) => (
                <div
                  key={f.format}
                  className="rounded-lg border border-slate-600 bg-slate-900/50 p-3"
                >
                  <p className="text-sm font-medium text-slate-300">
                    {f.format}
                  </p>
                  <p className="text-xs text-slate-500">{f.ext}</p>
                  <p className="mt-1 text-[10px] text-slate-600">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium text-slate-300">
              Required Fields
            </h4>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-2 pr-4 font-medium">Field</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="text-xs text-slate-400">
                  <tr>
                    <td className="py-1 pr-4 font-mono text-blue-400">
                      message
                    </td>
                    <td className="py-1 pr-4">string</td>
                    <td>Log message (required)</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-4 font-mono text-blue-400">
                      level
                    </td>
                    <td className="py-1 pr-4">string</td>
                    <td>
                      DEBUG, INFO, WARN, ERROR, FATAL (defaults to INFO)
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-4 font-mono text-blue-400">
                      timestamp
                    </td>
                    <td className="py-1 pr-4">ISO 8601</td>
                    <td>Auto-generated if missing</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-4 font-mono text-blue-400">
                      service
                    </td>
                    <td className="py-1 pr-4">string</td>
                    <td>Service name for grouping</td>
                  </tr>
                  <tr>
                    <td className="py-1 pr-4 font-mono text-blue-400">
                      trace_id
                    </td>
                    <td className="py-1 pr-4">string</td>
                    <td>Distributed trace correlation</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
