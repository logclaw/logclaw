"use client";

import FileUploader from "@/components/file-uploader";
import {
  Upload,
  Terminal,
  FileJson,
  FileSpreadsheet,
  FileText,
} from "lucide-react";

export default function IngestionPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in-up flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
          <Upload className="h-5 w-5 text-[#FF5722]" />
        </div>
        <div>
          <h1 className="text-[18px] font-bold tracking-tight text-[#1d1d1f] sm:text-[22px]">
            Log Ingestion
          </h1>
          <p className="text-[13px] text-[#6e6e73]">
            Upload logs to the pipeline
          </p>
        </div>
      </div>

      <FileUploader />

      {/* API docs reference */}
      <div className="animate-fade-in-up rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] sm:p-6">
        <div className="mb-4 flex items-center gap-2 sm:mb-5">
          <Terminal className="h-4 w-4 text-[#aeaeb2]" />
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
            API Reference
          </h3>
        </div>
        <div className="space-y-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600">
                POST
              </span>
              <h4 className="font-mono text-[14px] font-medium text-[#1d1d1f]">
                /api/otel/v1/logs
              </h4>
            </div>
            <p className="mt-1.5 text-[13px] text-[#6e6e73]">
              Send log entries via OTLP HTTP to the OpenTelemetry Collector.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-[#1d1d1f] p-3 text-[10px] text-[#aeaeb2] font-mono sm:p-4 sm:text-[12px]">
{`curl -X POST http://localhost:3000/api/otel/v1/logs \\
  -H "Content-Type: application/json" \\
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "payment-api"}}
        ]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "1741003200000000000",
          "severityText": "ERROR",
          "body": {"stringValue": "Connection timeout"},
          "attributes": [
            {"key": "host.name", "value": {"stringValue": "prod-web-01"}}
          ]
        }]
      }]
    }]
  }'`}
            </pre>
          </div>

          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
              Supported Formats
            </h4>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
              {[
                { format: "JSON", ext: ".json", desc: "Array or single object", icon: FileJson },
                { format: "NDJSON", ext: ".ndjson", desc: "One JSON per line", icon: FileJson },
                { format: "CSV", ext: ".csv", desc: "Header row required", icon: FileSpreadsheet },
                { format: "Text", ext: ".txt/.log", desc: "One log per line", icon: FileText },
              ].map((f) => {
                const Icon = f.icon;
                return (
                  <div
                    key={f.format}
                    className="card-hover rounded-xl bg-[#fafafa] p-4"
                  >
                    <Icon className="h-5 w-5 text-[#aeaeb2] mb-2" />
                    <p className="text-[14px] font-semibold text-[#1d1d1f]">
                      {f.format}
                    </p>
                    <p className="font-mono text-[11px] text-[#aeaeb2]">{f.ext}</p>
                    <p className="mt-1 text-[11px] text-[#6e6e73]">{f.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
              Required Fields
            </h4>
            <div className="mt-3 overflow-x-auto rounded-xl border border-[#e5e5ea]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#f2f2f7] text-left text-[10px] uppercase tracking-wider text-[#aeaeb2]">
                    <th className="px-4 py-2.5 font-medium">Field</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="text-[12px] text-[#6e6e73]">
                  {[
                    { field: "message", type: "string", desc: "Log message (required)" },
                    { field: "level", type: "string", desc: "DEBUG, INFO, WARN, ERROR, FATAL" },
                    { field: "timestamp", type: "ISO 8601", desc: "Auto-generated if missing" },
                    { field: "service", type: "string", desc: "Service name for grouping" },
                    { field: "trace_id", type: "string", desc: "Distributed trace correlation" },
                  ].map((row) => (
                    <tr key={row.field} className="border-b border-[#f2f2f7]/60">
                      <td className="px-4 py-2.5 font-mono text-[#FF5722] font-medium">
                        {row.field}
                      </td>
                      <td className="px-4 py-2.5 text-[#aeaeb2]">{row.type}</td>
                      <td className="px-4 py-2.5">{row.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
