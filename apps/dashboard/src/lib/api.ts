/* ──────────────────────────────────────────────────────────────
   LogClaw Dashboard – API client
   All fetches go through Next.js rewrites (/api/*) to avoid CORS.
   ────────────────────────────────────────────────────────────── */

export interface LogEntry {
  _source: {
    timestamp: string;
    level: string;
    message: string;
    service?: string;
    host?: string;
    trace_id?: string;
    span_id?: string;
    [key: string]: unknown;
  };
}

export interface Anomaly {
  _source: {
    timestamp: string;
    service: string;
    severity: string;
    error_rate: number;
    z_score: number;
    window_seconds: number;
    message?: string;
  };
}

export interface Incident {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  state: "triggered" | "acknowledged" | "investigating" | "resolved";
  service: string;
  created_at: string;
  updated_at: string;
  assigned_to?: string;
  description?: string;
  affected_services?: string[];
  request_traces?: RequestTrace[];
  timeline?: TimelineEntry[];
  mttr_seconds?: number;
}

export interface RequestTrace {
  trace_id: string;
  spans: TraceSpan[];
}

export interface TraceSpan {
  service: string;
  operation: string;
  status: string;
  duration_ms: number;
  error?: string;
}

export interface TimelineEntry {
  timestamp: string;
  actor: string;
  action: string;
  note?: string;
}

export interface PipelineStats {
  totalLogs: number;
  errorRate: number;
  serviceCount: number;
  anomalyCount: number;
  levelDistribution: Record<string, number>;
  topServices: { name: string; count: number }[];
}

// ── OpenSearch helpers ──────────────────────────────────────

async function osQuery<T = unknown>(
  index: string,
  body: object,
): Promise<T> {
  const res = await fetch(`/api/opensearch/${index}/_search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenSearch ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function fetchPipelineStats(): Promise<PipelineStats> {
  const now = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  const [logsRes, anomalyRes] = await Promise.all([
    osQuery<any>("logclaw-logs-*", {
      size: 0,
      query: { range: { timestamp: { gte: dayAgo, lte: now } } },
      aggs: {
        levels: { terms: { field: "level.keyword", size: 10 } },
        services: { terms: { field: "service.keyword", size: 20 } },
        error_count: {
          filter: {
            terms: { "level.keyword": ["ERROR", "FATAL", "CRITICAL"] },
          },
        },
      },
    }),
    osQuery<any>("logclaw-anomalies-*", {
      size: 0,
      query: { range: { timestamp: { gte: dayAgo, lte: now } } },
    }),
  ]);

  const total = logsRes.hits?.total?.value ?? 0;
  const errorCount = logsRes.aggregations?.error_count?.doc_count ?? 0;
  const levels: Record<string, number> = {};
  for (const b of logsRes.aggregations?.levels?.buckets ?? []) {
    levels[b.key] = b.doc_count;
  }
  const topServices = (logsRes.aggregations?.services?.buckets ?? []).map(
    (b: any) => ({ name: b.key, count: b.doc_count }),
  );

  return {
    totalLogs: total,
    errorRate: total > 0 ? (errorCount / total) * 100 : 0,
    serviceCount: topServices.length,
    anomalyCount: anomalyRes.hits?.total?.value ?? 0,
    levelDistribution: levels,
    topServices,
  };
}

export async function fetchRecentLogs(limit = 100): Promise<LogEntry[]> {
  const res = await osQuery<any>("logclaw-logs-*", {
    size: limit,
    sort: [{ timestamp: "desc" }],
    query: { match_all: {} },
  });
  return res.hits?.hits ?? [];
}

export async function fetchErrorLogs(limit = 50): Promise<LogEntry[]> {
  const res = await osQuery<any>("logclaw-logs-*", {
    size: limit,
    sort: [{ timestamp: "desc" }],
    query: {
      terms: { "level.keyword": ["ERROR", "FATAL", "CRITICAL"] },
    },
  });
  return res.hits?.hits ?? [];
}

export async function fetchAnomalies(limit = 50): Promise<Anomaly[]> {
  const res = await osQuery<any>("logclaw-anomalies-*", {
    size: limit,
    sort: [{ timestamp: "desc" }],
    query: { match_all: {} },
  });
  return res.hits?.hits ?? [];
}

// ── Incident / ticketing helpers ────────────────────────────

export async function fetchIncidents(params?: {
  severity?: string;
  state?: string;
  service?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ incidents: Incident[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.severity) q.set("severity", params.severity);
  if (params?.state) q.set("state", params.state);
  if (params?.service) q.set("service", params.service);
  if (params?.search) q.set("search", params.search);
  if (params?.limit) q.set("limit", String(params.limit));
  if (params?.offset) q.set("offset", String(params.offset));

  const res = await fetch(`/api/ticketing/incidents?${q}`);
  if (!res.ok) throw new Error(`Ticketing ${res.status}`);
  return res.json();
}

export async function fetchIncident(id: string): Promise<Incident> {
  const res = await fetch(`/api/ticketing/incidents/${id}`);
  if (!res.ok) throw new Error(`Incident ${res.status}`);
  return res.json();
}

export async function transitionIncident(
  id: string,
  action: string,
  payload?: object,
): Promise<Incident> {
  const res = await fetch(`/api/ticketing/incidents/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (!res.ok) throw new Error(`Transition ${res.status}`);
  return res.json();
}

// ── Ingestion helpers ───────────────────────────────────────

export async function uploadLogs(logs: object[]): Promise<{ accepted: number }> {
  const res = await fetch("/api/vector/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(logs),
  });
  if (!res.ok) throw new Error(`Upload ${res.status}`);
  return { accepted: logs.length };
}

// ── Health helpers ──────────────────────────────────────────

export interface ServiceHealth {
  name: string;
  url: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  latencyMs?: number;
}

export async function checkServiceHealth(): Promise<ServiceHealth[]> {
  const services = [
    { name: "OpenSearch", url: "/api/opensearch/" },
    { name: "Vector (Ingestion)", url: "/api/vector/health" },
    { name: "Ticketing Agent", url: "/api/ticketing/health" },
    { name: "Bridge", url: "/api/bridge/health" },
    { name: "Feast (ML)", url: "/api/feast/health" },
    { name: "Airflow", url: "/api/airflow/health" },
  ];

  return Promise.all(
    services.map(async (svc) => {
      const start = Date.now();
      try {
        const res = await fetch(svc.url, { signal: AbortSignal.timeout(5000) });
        return {
          ...svc,
          status: res.ok ? "healthy" : "degraded",
          latencyMs: Date.now() - start,
        } as ServiceHealth;
      } catch {
        return { ...svc, status: "down" as const, latencyMs: Date.now() - start };
      }
    }),
  );
}
