/* ──────────────────────────────────────────────────────────────
   LogClaw Dashboard – API client
   All fetches go through Next.js API route handlers (/api/*).
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
    anomaly_score: number;
    z_score: number;
    anomaly_type?: string;
    title?: string;
    description?: string;
    trace_id?: string;
    error_rate?: number;
    window_seconds?: number;
    message?: string;
  };
}

export interface Incident {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  state: string;
  service: string;
  created_at: string;
  updated_at: string;
  assigned_to?: string;
  description?: string;
  affected_services?: string[];
  request_traces?: RequestTrace[];
  timeline?: TimelineEntry[];
  mttr_seconds?: number;
  priority?: string;
  anomaly_score?: number;
  impact?: string;
  root_cause?: string;
  tags?: string[];
  similar_count?: number;
  reproduce_steps?: string[];
  evidence_logs?: EvidenceLog[];
  custom_fields?: {
    causal_chain?: string[];
    blast_radius?: {
      impact_score?: number;
      affected_downstream?: string[];
      estimated_user_impact?: string;
    };
    error_category?: string;
    root_cause_service?: string;
    suggested_fix?: string;
    error_pattern?: string;
  };
}

export interface RequestTrace {
  trace_id: string;
  spans?: TraceSpan[];
  span_ids?: string[];
  logs?: TraceLog[];
}

export interface TraceSpan {
  service: string;
  operation: string;
  status: string;
  duration_ms: number;
  error?: string;
}

export interface TraceLog {
  timestamp: string;
  service: string;
  level: string;
  message: string;
  span_id?: string;
  duration_ms?: number;
}

export interface TimelineEntry {
  timestamp: string;
  actor: string;
  action: string;
  note?: string;
}

export interface EvidenceLog {
  timestamp: string;
  service: string;
  level: string;
  message: string;
  span_id?: string;
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
    // Logs: `timestamp` field is NOT indexed (mapping: dynamic=false),
    // so we use match_all instead of range. Text fields need .keyword
    // sub-field for aggregations and term-level queries.
    osQuery<any>("logclaw-logs-*", {
      size: 0,
      query: { match_all: {} },
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
    // Anomalies: `timestamp` IS indexed here, so range filter works.
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
  // Sort by _doc desc (insertion order ≈ chronological) because the
  // `timestamp` field is not indexed in the logs mapping.
  const res = await osQuery<any>("logclaw-logs-*", {
    size: limit,
    sort: [{ _doc: "desc" }],
    query: { match_all: {} },
  });
  return res.hits?.hits ?? [];
}

export async function fetchErrorLogs(limit = 50): Promise<LogEntry[]> {
  const res = await osQuery<any>("logclaw-logs-*", {
    size: limit,
    sort: [{ _doc: "desc" }],
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

  const res = await fetch(`/api/ticketing/api/incidents?${q}`);
  if (!res.ok) throw new Error(`Ticketing ${res.status}`);
  const body = await res.json();
  const incidents: Incident[] = body.data ?? body.incidents ?? [];
  return { incidents, total: body.total ?? incidents.length };
}

export async function fetchIncident(id: string): Promise<Incident> {
  const res = await fetch(`/api/ticketing/api/incidents/${id}`);
  if (!res.ok) throw new Error(`Incident ${res.status}`);
  const body = await res.json();
  return body.data ?? body;
}

export async function transitionIncident(
  id: string,
  action: string,
  payload?: object,
): Promise<Incident> {
  const res = await fetch(`/api/ticketing/api/incidents/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  if (!res.ok) throw new Error(`Transition ${res.status}`);
  const body = await res.json();
  return body.data ?? body;
}

// ── Pipeline throughput ─────────────────────────────────────

export interface PipelineThroughput {
  // ── Data Pipeline ──
  ingestCount: number;
  streamCount: number;
  processCount: number;
  processErrors: number;
  indexCount: number;
  indexSizeBytes: number;
  logsSizeBytes: number;
  anomaliesSizeBytes: number;

  // ── AI & Operations ──
  detectCount: number;
  enrichCount: number;
  lifecycleTracked: number;
  lifecycleCompleted: number;
  incidentCount: number;

  // ── Service health (up/degraded/down) ──
  airflowStatus: "healthy" | "degraded" | "down";
  airflowScheduler: string;
  feastStatus: "healthy" | "degraded" | "down";
  ticketingStatus: "healthy" | "degraded" | "down";
}

/**
 * Fetch pipeline throughput from Bridge metrics, OpenSearch stats,
 * Airflow health, Feast health, and Ticketing incident count.
 */
export async function fetchPipelineThroughput(): Promise<PipelineThroughput> {
  const [metricsText, indicesJson, airflowHealth, feastRes, ticketingRes] =
    await Promise.all([
      fetch("/api/bridge/metrics")
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => ""),
      fetch("/api/opensearch/_cat/indices?format=json")
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch("/api/airflow/health", { signal: AbortSignal.timeout(3000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/feast/health", { signal: AbortSignal.timeout(3000) })
        .then((r) => ({ ok: r.ok, status: r.status }))
        .catch(() => ({ ok: false, status: 0 })),
      fetch("/api/ticketing/api/incidents?limit=0", {
        signal: AbortSignal.timeout(3000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

  // Parse Prometheus text format
  const metric = (name: string): number => {
    const m = metricsText.match(
      new RegExp(`^${name}\\s+(\\d+(?:\\.\\d+)?)`, "m"),
    );
    return m ? parseFloat(m[1]) : 0;
  };

  const etlConsumed = metric("logclaw_bridge_etl_consumed_total");
  const etlProduced = metric("logclaw_bridge_etl_produced_total");
  const anomalyDetected = metric("logclaw_bridge_anomaly_detected_total");
  const indexerIndexed = metric("logclaw_bridge_indexer_indexed_total");
  const indexerErrors = metric("logclaw_bridge_indexer_errors_total");
  const lifecycleTracked = metric("logclaw_bridge_lifecycle_tracked_total");
  const lifecycleCompleted = metric("logclaw_bridge_lifecycle_completed_total");

  // Parse OpenSearch _cat/indices JSON
  const { parseOsSize } = await import("@/lib/utils");
  let logsSizeBytes = 0;
  let anomaliesSizeBytes = 0;
  let logsDocCount = 0;
  let anomaliesDocCount = 0;

  for (const idx of indicesJson as any[]) {
    const name = idx.index as string;
    if (name.startsWith("logclaw-logs-")) {
      logsDocCount += parseInt(idx["docs.count"] ?? "0", 10);
      logsSizeBytes += parseOsSize(idx["store.size"] ?? "0b");
    } else if (name.startsWith("logclaw-anomalies-")) {
      anomaliesDocCount += parseInt(idx["docs.count"] ?? "0", 10);
      anomaliesSizeBytes += parseOsSize(idx["store.size"] ?? "0b");
    }
  }

  // Airflow health
  const schedulerStatus = airflowHealth?.scheduler?.status;
  const airflowStatus: "healthy" | "degraded" | "down" = airflowHealth
    ? schedulerStatus === "healthy"
      ? "healthy"
      : "degraded"
    : "down";

  // Feast health
  const feastStatus: "healthy" | "degraded" | "down" = feastRes.ok
    ? "healthy"
    : feastRes.status > 0
      ? "degraded"
      : "down";

  // Ticketing
  const incidentCount = ticketingRes?.total ?? ticketingRes?.data?.length ?? 0;
  const ticketingStatus: "healthy" | "degraded" | "down" = ticketingRes
    ? "healthy"
    : "down";

  return {
    ingestCount: etlConsumed || logsDocCount,
    streamCount: etlConsumed || logsDocCount,
    processCount: etlProduced || logsDocCount,
    processErrors: indexerErrors,
    indexCount: indexerIndexed || logsDocCount + anomaliesDocCount,
    indexSizeBytes: logsSizeBytes + anomaliesSizeBytes,
    logsSizeBytes,
    anomaliesSizeBytes,
    detectCount: anomalyDetected || anomaliesDocCount,
    enrichCount: etlProduced || logsDocCount,
    lifecycleTracked,
    lifecycleCompleted,
    incidentCount,
    airflowStatus,
    airflowScheduler: schedulerStatus ?? "unknown",
    feastStatus,
    ticketingStatus,
  };
}

// ── Ingestion helpers ───────────────────────────────────────

export async function uploadLogs(logs: object[]): Promise<{ accepted: number }> {
  // NOTE: No trailing slash — Next.js 308-redirects /api/vector/ → /api/vector
  // which loses the POST body.
  const res = await fetch("/api/vector", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(logs),
  });
  if (!res.ok) throw new Error(`Upload ${res.status}`);
  return { accepted: logs.length };
}

// ── Runtime Configuration types ─────────────────────────────

export interface PlatformConfig {
  enabled: boolean;
  [key: string]: unknown; // platform-specific fields (baseUrl, apiToken, etc.)
}

export interface RoutingRules {
  critical: string[];
  high: string[];
  medium: string[];
  low: string[];
}

export interface AnomalyConfig {
  minimumScore: number;
  deduplicationWindowMinutes: number;
  contextWindowMinutes: number;
  maxContextLogLines: number;
}

export interface LlmConfig {
  provider: "ollama" | "claude" | "openai" | "vllm" | "disabled";
  model: string;
  endpoint: string;
}

export interface TicketingConfig {
  platforms: Record<string, PlatformConfig>;
  routing: RoutingRules;
  anomaly: AnomalyConfig;
  llm: LlmConfig;
}

export interface BridgeConfig {
  zscoreThreshold: number;
  windowSeconds: number;
  bulkSize: number;
  bulkIntervalSeconds: number;
}

// ── Runtime Configuration API ───────────────────────────────

export async function fetchTicketingConfig(): Promise<TicketingConfig> {
  const res = await fetch("/api/ticketing/api/v1/config");
  if (!res.ok) throw new Error(`Config ${res.status}`);
  return res.json();
}

export async function updateRouting(routing: Partial<RoutingRules>): Promise<RoutingRules> {
  const res = await fetch("/api/ticketing/api/v1/config/routing", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(routing),
  });
  if (!res.ok) throw new Error(`Routing ${res.status}`);
  return res.json();
}

export async function updatePlatforms(
  platforms: Record<string, Partial<PlatformConfig>>,
): Promise<Record<string, PlatformConfig>> {
  const res = await fetch("/api/ticketing/api/v1/config/platforms", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(platforms),
  });
  if (!res.ok) throw new Error(`Platforms ${res.status}`);
  return res.json();
}

export async function updateAnomalyConfig(
  anomaly: Partial<AnomalyConfig>,
): Promise<AnomalyConfig> {
  const res = await fetch("/api/ticketing/api/v1/config/anomaly", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(anomaly),
  });
  if (!res.ok) throw new Error(`Anomaly ${res.status}`);
  return res.json();
}

export async function updateLlmConfig(
  llm: Partial<LlmConfig>,
): Promise<LlmConfig> {
  const res = await fetch("/api/ticketing/api/v1/config/llm", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(llm),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  return res.json();
}

export async function fetchBridgeConfig(): Promise<BridgeConfig> {
  const res = await fetch("/api/bridge/config");
  if (!res.ok) throw new Error(`Bridge config ${res.status}`);
  return res.json();
}

export async function updateBridgeConfig(
  patch: Partial<BridgeConfig>,
): Promise<BridgeConfig> {
  const res = await fetch("/api/bridge/config", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Bridge config ${res.status}`);
  return res.json();
}

// ── Connection test helpers ──────────────────────────────────

export interface TestResult {
  ok: boolean;
  message: string;
  latency_ms: number;
}

export async function testPlatformConnection(
  platform: string,
): Promise<TestResult> {
  const res = await fetch("/api/ticketing/api/v1/test-connection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform }),
  });
  return res.json();
}

export async function testLlmConnection(): Promise<TestResult> {
  const res = await fetch("/api/ticketing/api/v1/test-llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  return res.json();
}

// ── Required field definitions for status badges ──────────

export const PLATFORM_REQUIRED_FIELDS: Record<string, string[]> = {
  pagerduty: ["routingKey"],
  jira: ["baseUrl", "apiToken", "userEmail"],
  servicenow: ["instanceUrl", "username", "password"],
  opsgenie: ["apiKey"],
  slack: ["webhookUrl"],
};

// ── Agent (infrastructure health) helpers ────────────────────

export interface AgentMetrics {
  tenantId: string;
  collectedAt: string;
  kafkaLag: Record<string, number>;
  flinkJobs: { name: string; state: string; restarts: number }[];
  osHealth: { status: string; numberOfNodes: number; numberOfDataNodes: number };
  esoStatus: { name: string; ready: boolean; lastSync: string }[];
}

export async function fetchAgentMetrics(): Promise<AgentMetrics> {
  const res = await fetch("/api/agent/metrics", { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error("Agent unreachable");
  return res.json();
}

// ── Health helpers ──────────────────────────────────────────

export interface ServiceHealth {
  name: string;
  url: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  latencyMs?: number;
}

/**
 * Check health of all integrated services.
 * Some services (like Vector) only accept POST on their HTTP source,
 * returning 405 on GET — we treat 405 as "healthy" (service is alive).
 */
export async function checkServiceHealth(): Promise<ServiceHealth[]> {
  const services = [
    { name: "OpenSearch", url: "/api/opensearch/_cluster/health" },
    { name: "Vector (Ingestion)", url: "/api/vector", acceptCodes: [200, 405] },
    { name: "Ticketing Agent", url: "/api/ticketing/api/incidents?limit=1" },
    { name: "Bridge", url: "/api/bridge/health" },
    { name: "Feast (ML)", url: "/api/feast/health" },
    { name: "Airflow", url: "/api/airflow/health" },
    { name: "Agent", url: "/api/agent/health" },
  ];

  return Promise.all(
    services.map(async (svc) => {
      const start = Date.now();
      const acceptCodes = (svc as any).acceptCodes ?? [200];
      try {
        const res = await fetch(svc.url, { signal: AbortSignal.timeout(5000) });
        const isHealthy =
          res.ok || acceptCodes.includes(res.status);
        return {
          name: svc.name,
          url: svc.url,
          status: isHealthy ? "healthy" : "degraded",
          latencyMs: Date.now() - start,
        } as ServiceHealth;
      } catch {
        return {
          name: svc.name,
          url: svc.url,
          status: "down" as const,
          latencyMs: Date.now() - start,
        };
      }
    }),
  );
}
