/**
 * Log and anomaly search tools — adapted from apps/logclaw-mcp-server/src/tools/logs.ts.
 */
import { createClient } from "../client.ts";

type Fetch = ReturnType<typeof createClient>["logclawFetch"];

export async function searchLogs(
  fetch: Fetch,
  args: Record<string, unknown>,
) {
  const limit = Math.min(Number(args.limit) || 50, 200);
  const minutesAgo = Number(args.minutes_ago) || 60;
  const now = new Date().toISOString();
  const from = new Date(Date.now() - minutesAgo * 60_000).toISOString();

  const musts: object[] = [
    { range: { timestamp: { gte: from, lte: now } } },
  ];

  if (args.service) {
    musts.push({ term: { "service.keyword": String(args.service) } });
  }
  if (args.level) {
    musts.push({ term: { "level.keyword": String(args.level) } });
  }
  if (args.query) {
    musts.push({
      multi_match: {
        query: String(args.query),
        fields: ["message", "service", "host"],
      },
    });
  }

  const body = {
    size: limit,
    sort: [{ timestamp: "desc" }],
    query: { bool: { must: musts } },
    _source: ["timestamp", "service", "level", "message", "trace_id", "span_id", "host"],
  };

  // deno-lint-ignore no-explicit-any
  const res = await fetch<any>("/api/logs/_search", {
    method: "POST",
    body,
    timeout: 20_000,
  });

  const hits = res.hits?.hits ?? [];
  // deno-lint-ignore no-explicit-any
  const logs = hits.map((h: any) => h._source);
  return { total: res.hits?.total?.value ?? logs.length, logs };
}

export async function getAnomalies(
  fetch: Fetch,
  args: Record<string, unknown>,
) {
  const limit = Math.min(Number(args.limit) || 20, 100);
  const musts: object[] = [];

  if (args.service) {
    musts.push({ term: { "service.keyword": String(args.service) } });
  }
  if (args.severity) {
    musts.push({ term: { "severity.keyword": String(args.severity) } });
  }

  const body = {
    size: limit,
    sort: [{ timestamp: "desc" }],
    query: musts.length > 0 ? { bool: { must: musts } } : { match_all: {} },
    _source: [
      "timestamp", "event_id", "service", "severity", "anomaly_score",
      "z_score", "anomaly_type", "title", "description", "detection_mode",
      "error_rate", "message",
    ],
  };

  // deno-lint-ignore no-explicit-any
  const res = await fetch<any>("/api/anomalies/_search", {
    method: "POST",
    body,
    timeout: 20_000,
  });

  const hits = res.hits?.hits ?? [];
  // deno-lint-ignore no-explicit-any
  const anomalies = hits.map((h: any) => ({ id: h._id, ...h._source }));
  return { total: res.hits?.total?.value ?? anomalies.length, anomalies };
}
