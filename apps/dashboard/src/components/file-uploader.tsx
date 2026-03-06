"use client";

import { useCallback, useState } from "react";
import { uploadLogs } from "@/lib/api";
import {
  Upload,
  FileJson,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
  ShieldCheck,
  XCircle,
  AlertTriangle,
} from "lucide-react";

type FileFormat = "json" | "ndjson" | "csv" | "text";

/* ── Required / recommended fields for LogClaw logs ────────────── */
const REQUIRED_FIELDS = ["message"];
const RECOMMENDED_FIELDS = ["level", "service", "timestamp"];
const VALID_LEVELS = ["DEBUG", "INFO", "WARN", "WARNING", "ERROR", "FATAL", "CRITICAL"];

/* ── Validation result ─────────────────────────────────────────── */
interface ValidationResult {
  valid: boolean;
  logs: object[];
  format: FileFormat;
  totalEntries: number;
  errors: string[];
  warnings: string[];
}

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
      const parseCSVLine = (line: string): string[] => {
        const fields: string[] = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
              current += '"';
              i++;
            } else if (ch === '"') {
              inQuotes = false;
            } else {
              current += ch;
            }
          } else {
            if (ch === '"') {
              inQuotes = true;
            } else if (ch === ",") {
              fields.push(current.trim());
              current = "";
            } else {
              current += ch;
            }
          }
        }
        fields.push(current.trim());
        return fields;
      };
      const headers = parseCSVLine(lines[0]);
      return lines.slice(1).filter(Boolean).map((line) => {
        const vals = parseCSVLine(line);
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => (obj[h] = vals[i] ?? ""));
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

/** Validate parsed logs against LogClaw schema */
function validateLogs(logs: object[], format: FileFormat): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (logs.length === 0) {
    return { valid: false, logs, format, totalEntries: 0, errors: ["File contains no log entries"], warnings };
  }

  // Check first 5 entries for structure
  const sample = logs.slice(0, 5) as Record<string, unknown>[];

  // Required field check
  const missingRequired = REQUIRED_FIELDS.filter(
    (f) => !sample.some((entry) => entry[f] !== undefined && entry[f] !== ""),
  );
  if (missingRequired.length > 0) {
    errors.push(`Missing required field: "${missingRequired.join('", "')}". Each log must have a "message" field.`);
  }

  // Recommended field check
  const missingRecommended = RECOMMENDED_FIELDS.filter(
    (f) => !sample.some((entry) => entry[f] !== undefined && entry[f] !== ""),
  );
  if (missingRecommended.length > 0) {
    warnings.push(`Missing recommended fields: "${missingRecommended.join('", "')}". Logs work best with level, service, and timestamp.`);
  }

  // Level validation
  const levelsFound = sample
    .map((e) => String(e.level ?? "").toUpperCase())
    .filter(Boolean);
  const invalidLevels = levelsFound.filter((l) => l && !VALID_LEVELS.includes(l));
  if (invalidLevels.length > 0) {
    warnings.push(`Non-standard level values: "${invalidLevels.join('", "')}". Expected: ${VALID_LEVELS.join(", ")}`);
  }

  // Gibberish detection — if entries have no string values > 3 chars
  const hasReadableContent = sample.some((entry) =>
    Object.values(entry).some(
      (v) => typeof v === "string" && v.length > 3,
    ),
  );
  if (!hasReadableContent) {
    errors.push("Content appears to be gibberish or binary data — no readable text fields found.");
  }

  // Timestamp format check
  const timestamps = sample.map((e) => e.timestamp).filter(Boolean) as string[];
  const badTimestamps = timestamps.filter((t) => isNaN(Date.parse(String(t))));
  if (badTimestamps.length > 0) {
    warnings.push(`Some timestamps are not valid ISO 8601 format. Example: "${badTimestamps[0]}"`);
  }

  return {
    valid: errors.length === 0,
    logs,
    format,
    totalEntries: logs.length,
    errors,
    warnings,
  };
}

export default function FileUploader() {
  const [dragging, setDragging] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [status, setStatus] = useState<{
    type: "idle" | "validating" | "validated" | "uploading" | "success" | "error";
    message?: string;
  }>({ type: "idle" });

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0]; // validate one at a time for clarity
    setFileName(file.name);
    setStatus({ type: "validating", message: `Checking ${file.name}...` });
    setValidation(null);

    try {
      const content = await file.text();
      const format = detectFormat(content, file.name);
      const logs = parseContent(content, format);
      const result = validateLogs(logs, format);
      setValidation(result);
      setStatus({ type: "validated" });
    } catch (err: any) {
      setValidation(null);
      setStatus({
        type: "error",
        message: `Failed to parse ${file.name}: ${err.message}. Check that the file is valid ${file.name.split(".").pop()?.toUpperCase() ?? "text"}.`,
      });
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (!validation || !validation.valid) return;
    setStatus({ type: "uploading", message: `Uploading ${validation.totalEntries} entries...` });

    try {
      let totalAccepted = 0;
      const logs = validation.logs;
      for (let i = 0; i < logs.length; i += 50) {
        const batch = logs.slice(i, i + 50);
        setStatus({
          type: "uploading",
          message: `Sending ${Math.min(i + 50, logs.length)}/${logs.length} entries via OTLP...`,
        });
        await uploadLogs(batch);
        totalAccepted += batch.length;
      }
      setStatus({
        type: "success",
        message: `Successfully ingested ${totalAccepted} log entries via OTLP`,
      });
      setValidation(null);
      setTimeout(() => setStatus({ type: "idle" }), 5000);
    } catch (err: any) {
      setStatus({ type: "error", message: err.message ?? "Upload failed" });
    }
  }, [validation]);

  const reset = () => {
    setValidation(null);
    setStatus({ type: "idle" });
    setFileName("");
  };

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 transition-all duration-300 sm:gap-4 sm:p-14
          ${
            dragging
              ? "border-[#FF5722] bg-orange-50/50 shadow-lg shadow-orange-500/5"
              : "border-[#e5e5ea] bg-white hover:border-[#d1d1d6] hover:bg-[#fafafa]"
          }`}
      >
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-all duration-300 ${
            dragging
              ? "bg-orange-100 text-[#FF5722] scale-110"
              : "bg-[#f5f5f7] text-[#aeaeb2]"
          }`}
        >
          <Upload className="h-7 w-7" />
        </div>
        <div className="text-center">
          <p className="text-[14px] font-medium text-[#1d1d1f]">
            Drag & drop log files here
          </p>
          <p className="mt-1 text-[12px] text-[#aeaeb2]">
            JSON, NDJSON, CSV, or plain text — validated before upload
          </p>
        </div>
        <label className="cursor-pointer rounded-full bg-[#FF5722] px-5 py-2.5 text-[13px] font-medium text-white shadow-sm transition-all duration-200 hover:bg-[#E64A19] hover:shadow-md active:scale-[0.98]">
          Browse Files
          <input
            type="file"
            className="hidden"
            accept=".json,.ndjson,.jsonl,.csv,.txt,.log"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      </div>

      {/* Validation result card */}
      {status.type === "validating" && (
        <div className="animate-fade-in flex items-center gap-2.5 rounded-xl bg-blue-50 px-4 py-3.5 text-[13px] font-medium text-blue-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          {status.message}
        </div>
      )}

      {validation && status.type === "validated" && (
        <div className="animate-fade-in-up rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {validation.valid ? (
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
              ) : (
                <XCircle className="h-5 w-5 text-red-500" />
              )}
              <h4 className="text-[14px] font-semibold text-[#1d1d1f]">
                {validation.valid ? "Validation Passed" : "Validation Failed"}
              </h4>
            </div>
            <button
              onClick={reset}
              className="text-[12px] text-[#aeaeb2] hover:text-[#6e6e73] transition-colors"
            >
              Clear
            </button>
          </div>

          {/* File summary */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-medium text-[#6e6e73]">
              {fileName}
            </span>
            <span className="rounded-md bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-medium text-[#6e6e73]">
              {validation.format.toUpperCase()}
            </span>
            <span className="rounded-md bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-medium text-[#6e6e73]">
              {validation.totalEntries} entries
            </span>
          </div>

          {/* Errors */}
          {validation.errors.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {validation.errors.map((e, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {e}
                </div>
              ))}
            </div>
          )}

          {/* Warnings */}
          {validation.warnings.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {validation.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Upload button — only when validation passed */}
          {validation.valid && (
            <button
              onClick={handleUpload}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#FF5722] px-4 py-3 text-[14px] font-semibold text-white transition-all hover:bg-[#E64A19] active:scale-[0.99]"
            >
              <Send className="h-4 w-4" />
              Ingest {validation.totalEntries} Logs via OTLP
            </button>
          )}

          {/* Fix hint when invalid */}
          {!validation.valid && (
            <div className="mt-3 rounded-lg bg-[#f5f5f7] px-4 py-3">
              <p className="text-[12px] font-medium text-[#6e6e73]">Expected format:</p>
              <pre className="mt-1.5 text-[11px] text-[#aeaeb2] font-mono">
{`[{
  "message": "GET /api/users 200 12ms",
  "level": "INFO",
  "service": "api-gateway",
  "timestamp": "2026-03-02T14:00:01Z"
}]`}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Upload progress / status */}
      {(status.type === "uploading" || status.type === "success" || status.type === "error") && (
        <div
          className={`animate-fade-in flex items-center gap-2.5 rounded-xl px-4 py-3.5 text-[13px] font-medium ${
            status.type === "uploading"
              ? "bg-orange-50 text-[#E64A19]"
              : status.type === "success"
                ? "bg-emerald-50 text-emerald-600"
                : "bg-red-50 text-red-500"
          }`}
        >
          {status.type === "uploading" && <Loader2 className="h-4 w-4 animate-spin" />}
          {status.type === "success" && <CheckCircle2 className="h-4 w-4" />}
          {status.type === "error" && <AlertCircle className="h-4 w-4" />}
          {status.message}
        </div>
      )}

      {/* Quick JSON Upload */}
      <QuickUpload />
    </div>
  );
}

function QuickUpload() {
  const [json, setJson] = useState("");
  const [sending, setSending] = useState(false);
  const [validationMsg, setValidationMsg] = useState<{ type: "ok" | "warn" | "error"; text: string } | null>(null);

  const validate = (text: string) => {
    if (!text.trim()) {
      setValidationMsg(null);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      if (entries.length === 0) {
        setValidationMsg({ type: "error", text: "Empty array" });
        return;
      }
      const first = entries[0];
      if (typeof first !== "object" || first === null) {
        setValidationMsg({ type: "error", text: "Entries must be JSON objects" });
        return;
      }
      if (!first.message) {
        setValidationMsg({ type: "error", text: 'Missing required "message" field' });
        return;
      }
      const missing = RECOMMENDED_FIELDS.filter((f) => !(f in first));
      if (missing.length > 0) {
        setValidationMsg({ type: "warn", text: `Missing: ${missing.join(", ")}` });
      } else {
        setValidationMsg({ type: "ok", text: `${entries.length} valid log${entries.length > 1 ? "s" : ""}` });
      }
    } catch {
      setValidationMsg({ type: "error", text: "Invalid JSON" });
    }
  };

  const handlePaste = async () => {
    if (!json.trim() || validationMsg?.type === "error") return;
    setSending(true);
    try {
      const parsed = JSON.parse(json);
      const logs = Array.isArray(parsed) ? parsed : [parsed];
      await uploadLogs(logs);
      setJson("");
      setValidationMsg(null);
    } catch {
      setValidationMsg({ type: "error", text: "Send failed" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="mb-3 flex items-center gap-2">
        <FileJson className="h-4 w-4 text-[#aeaeb2]" />
        <h4 className="text-[11px] font-semibold uppercase tracking-widest text-[#aeaeb2]">
          Quick JSON Upload
        </h4>
      </div>
      <textarea
        value={json}
        onChange={(e) => { setJson(e.target.value); validate(e.target.value); }}
        rows={4}
        placeholder='{"level": "ERROR", "message": "Something went wrong", "service": "payment-api"}'
        className={`w-full rounded-xl border bg-[#fafafa] px-4 py-3 text-[13px] text-[#1d1d1f] placeholder:text-[#d1d1d6] focus:outline-none focus:ring-2 font-mono transition-all ${
          validationMsg?.type === "error"
            ? "border-red-300 focus:border-red-400 focus:ring-red-100"
            : validationMsg?.type === "warn"
              ? "border-amber-300 focus:border-amber-400 focus:ring-amber-100"
              : "border-[#e5e5ea] focus:border-[#FF5722] focus:ring-orange-100"
        }`}
      />
      {/* Live validation indicator */}
      {validationMsg && (
        <div className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-medium ${
          validationMsg.type === "ok"
            ? "text-emerald-600"
            : validationMsg.type === "warn"
              ? "text-amber-600"
              : "text-red-500"
        }`}>
          {validationMsg.type === "ok" && <CheckCircle2 className="h-3 w-3" />}
          {validationMsg.type === "warn" && <AlertTriangle className="h-3 w-3" />}
          {validationMsg.type === "error" && <XCircle className="h-3 w-3" />}
          {validationMsg.text}
        </div>
      )}
      <button
        onClick={handlePaste}
        disabled={!json.trim() || sending || validationMsg?.type === "error"}
        className="mt-3 flex items-center gap-2 rounded-full bg-[#FF5722] px-4 py-2 text-[13px] font-medium text-white transition-all hover:bg-[#E64A19] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Send className="h-3.5 w-3.5" />
        Send via OTLP
      </button>
    </div>
  );
}
