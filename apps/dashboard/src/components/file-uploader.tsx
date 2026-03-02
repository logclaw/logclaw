"use client";

import { useCallback, useState } from "react";
import { uploadLogs } from "@/lib/api";

type FileFormat = "json" | "ndjson" | "csv" | "text";

function detectFormat(content: string, name: string): FileFormat {
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".ndjson") || name.endsWith(".jsonl")) return "ndjson";
  const trimmed = content.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  return "text";
}

function parseContent(content: string, format: FileFormat): object[] {
  switch (format) {
    case "json": {
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    case "ndjson":
      return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    case "csv": {
      const lines = content.trim().split("\n");
      if (lines.length < 2) return [];
      const headers = lines[0].split(",").map((h) => h.trim());
      return lines.slice(1).map((line) => {
        const vals = line.split(",");
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => (obj[h] = vals[i]?.trim() ?? ""));
        return obj;
      });
    }
    case "text":
      return content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => ({
          message: line,
          timestamp: new Date().toISOString(),
          level: "INFO",
        }));
  }
}

export default function FileUploader() {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<{
    type: "idle" | "uploading" | "success" | "error";
    message?: string;
  }>({ type: "idle" });

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setStatus({ type: "uploading", message: "Parsing files..." });

    try {
      let totalAccepted = 0;
      for (const file of Array.from(files)) {
        const content = await file.text();
        const format = detectFormat(content, file.name);
        const logs = parseContent(content, format);

        // Batch upload in groups of 50
        for (let i = 0; i < logs.length; i += 50) {
          const batch = logs.slice(i, i + 50);
          setStatus({
            type: "uploading",
            message: `Uploading ${i + batch.length}/${logs.length} from ${file.name}...`,
          });
          await uploadLogs(batch);
          totalAccepted += batch.length;
        }
      }
      setStatus({
        type: "success",
        message: `Uploaded ${totalAccepted} log entries`,
      });
      setTimeout(() => setStatus({ type: "idle" }), 4000);
    } catch (err: any) {
      setStatus({ type: "error", message: err.message ?? "Upload failed" });
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition
          ${
            dragging
              ? "border-blue-400 bg-blue-900/20"
              : "border-slate-600 bg-slate-800/30 hover:border-slate-500"
          }`}
      >
        <span className="text-4xl">📁</span>
        <p className="text-sm text-slate-300">
          Drag &amp; drop log files here
        </p>
        <p className="text-xs text-slate-500">
          JSON, NDJSON, CSV, or plain text
        </p>
        <label className="mt-2 cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700">
          Browse Files
          <input
            type="file"
            className="hidden"
            multiple
            accept=".json,.ndjson,.jsonl,.csv,.txt,.log"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      </div>

      {/* Quick JSON paste */}
      <QuickUpload onUpload={handleFiles} />

      {/* Status */}
      {status.type !== "idle" && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            status.type === "uploading"
              ? "bg-blue-900/30 text-blue-300"
              : status.type === "success"
                ? "bg-green-900/30 text-green-300"
                : "bg-red-900/30 text-red-300"
          }`}
        >
          {status.type === "uploading" && (
            <span className="mr-2 inline-block animate-spin">⏳</span>
          )}
          {status.message}
        </div>
      )}
    </div>
  );
}

function QuickUpload({
  onUpload,
}: {
  onUpload: (files: FileList | null) => void;
}) {
  const [json, setJson] = useState("");

  const handlePaste = async () => {
    if (!json.trim()) return;
    try {
      const parsed = JSON.parse(json);
      const logs = Array.isArray(parsed) ? parsed : [parsed];
      await uploadLogs(logs);
      setJson("");
    } catch {
      // let parent handle error
    }
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
      <h4 className="mb-2 text-sm font-medium text-slate-400">
        Quick JSON Upload
      </h4>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={4}
        placeholder='{"level": "ERROR", "message": "Something went wrong", "service": "payment-api"}'
        className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none font-mono"
      />
      <button
        onClick={handlePaste}
        disabled={!json.trim()}
        className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
      >
        Send to Vector
      </button>
    </div>
  );
}
