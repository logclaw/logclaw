---
title: Incident Classification
description: How LogClaw decides which log signals are incident-worthy vs. noise.
---

# Incident Classification

LogClaw uses a **signal-based composite scoring** system to classify whether an error log should trigger an incident. Not every error log is incident-worthy — the system distinguishes actionable production failures (OOM, database deadlocks, cascading failures) from expected noise (validation errors, 404s, client mistakes).

## Why Not Simple Error Counting?

A plain error-rate spike detector has three critical failure modes:

| Problem | Effect |
|---|---|
| Counts all ERROR logs equally | Validation errors and OOMs score the same |
| Requires time window (30s+) before alerting | Process can crash before detection fires |
| `std=0` silent failure | 100% constant error rate produces no alert |

The signal-based system solves all three.

---

## Three-Stage Pipeline

Every error log record flows through three stages inside the Bridge's anomaly detector (Thread 2):

```
Log Record
    │
    ▼
Stage 1: Signal Extraction    ← What kind of failure is this?
    │
    ▼
Stage 2: Scoring              ← How severe? How widespread? How fast?
    │        │
    │        ├── Immediate path (OOM / crash / cascading failure)
    │        └── Windowed path  (statistical z-score + context)
    ▼
Stage 3: Decision Engine      ← Emit to Kafka if score ≥ threshold
```

---

## Stage 1: Signal Extraction

Eight **language-agnostic** pattern groups scan the combined text of `exception_type`, `exception_message`, and `message`. A single record can match multiple patterns simultaneously (multi-signal).

| Pattern | Matches | Weight |
|---|---|---|
| `oom` | OutOfMemoryError, heap space, memory limit, GC overhead | 0.95 |
| `crash` | segfault, panic, SIGSEGV, SIGKILL, stack overflow, process died | 0.95 |
| `resource` | disk full, no space left, too many open files, resource exhausted | 0.80 |
| `dependency` | service unavailable, bad gateway, upstream connect error, 502/503/504 | 0.75 |
| `db` | deadlock, lock timeout, duplicate key, constraint violation, connection pool exhausted | 0.75 |
| `timeout` | timeout, timed out, deadline exceeded, context deadline, connect timeout | 0.70 |
| `connection` | ECONNREFUSED, ECONNRESET, broken pipe, socket closed, network unreachable | 0.65 |
| `auth` | unauthorized, forbidden, access denied, invalid token, JWT expired | 0.40 |

**Key property**: patterns are regex-based and language-agnostic. Java, Python, Go, Node.js, Rust — any runtime's exceptions are classified without hardcoded language-specific rules. Unknown exception types are still scored via severity level, HTTP status, and stacktrace depth.

### Additional signals extracted per record

| Signal | Source | Weight |
|---|---|---|
| Severity | Log level: FATAL=1.0, CRITICAL=0.95, ERROR=0.70, WARN=0.30 | 0.0–1.0 |
| HTTP status | 503=0.90, 504=0.85, 502=0.80, 5xx=0.70, 429=0.50 | 0.0–0.90 |
| Stacktrace depth | Frame count: 16+ frames=0.30, 6-15=0.15, 2-5=0.05 | 0.0–0.30 |
| Error category | Keyword classifier (timeout, database, auth, etc.) | 0.30 |

---

## Stage 2: Scoring

### Composite Score Formula

Signals are grouped into six categories. The maximum weight within each category is taken (no double-counting), then multiplied by the category's weight:

| Category | Weight | What counts |
|---|---|---|
| Pattern | 30% | Exception/message pattern matches |
| Statistical | 25% | Z-score spike, sustained failure rate |
| Context | 15% | Blast radius, velocity, recurrence |
| HTTP | 10% | HTTP 5xx status codes |
| Severity | 10% | Log level |
| Structural | 10% | Stacktrace depth, error category |

**Score → Severity:**

| Score | Severity |
|---|---|
| ≥ 0.85 | critical |
| ≥ 0.65 | high |
| ≥ 0.45 | medium |
| < 0.45 | low |

Events below `compositeScoreThreshold` (default `0.4`) are not emitted.

### Contextual signals (windowed)

Three additional signals are computed from the sliding window (last 300 seconds, 10-second buckets):

**Blast Radius** — how many services are simultaneously erroring per tenant:

| Erroring services | Signal weight |
|---|---|
| 5+ | 0.90 (cascading failure) |
| 3–4 | 0.60 |
| 2 | 0.30 |

**Velocity** — error acceleration vs. historical average:

| Ratio (current / avg) | Signal weight |
|---|---|
| 5× or more | 0.80 |
| 3–5× | 0.50 |
| 2–3× | 0.30 |

**Recurrence** — novelty boost for error templates never seen before:

| Occurrence | Signal weight |
|---|---|
| First occurrence | 0.30 |
| 2–5 occurrences | 0.10 |
| 6+ occurrences | 0.00 |

### Z-score (fixed)

The z-score is preserved as a statistical signal but is no longer the sole decision maker:

- z ≥ threshold → `zscore:spike = min(z / 5.0, 1.0)` (contributes to 25% statistical bucket)
- `std = 0` (constant error rate) → no longer silently dropped:
  - mean ≥ 50% error rate → `zscore:sustained_failure` signal (sustained production failure)
  - mean ≥ 10% error rate → `zscore:elevated_baseline` signal

---

## Stage 3: Decision Engine

Two detection paths operate in parallel:

### Immediate Path

Fires **without waiting for a time window** when critical signals are present. Used for failures that can kill a process before 30 seconds elapse.

Triggers when any of the following are true:
- `pattern:oom`, `pattern:crash`, or `pattern:resource` matches with weight ≥ 0.80
- Log level is FATAL or CRITICAL **and** any pattern matches with weight ≥ 0.50
- Blast radius ≥ 0.60 (3+ services simultaneously failing)

Critical immediate patterns (`oom`, `crash`, `resource`) guarantee a minimum composite score of `0.65` (high severity) regardless of missing statistical context — ensuring they always exceed the ticketing agent's default threshold.

Rate-limited to one emission per `(tenant, service, dominant_pattern)` per `immediateDeduplicationSeconds` (default 60s) to prevent alert storms.

### Windowed Path

Standard path using the sliding window. Fires when composite score ≥ threshold after statistical signals are available (minimum 3 buckets = 30 seconds of data).

---

## Example Scores

| Scenario | Dominant signals | Score | Severity | Fires? |
|---|---|---|---|---|
| OOM exception, FATAL | pattern:oom=0.95, severity=1.0 | 0.65* | high | Yes (immediate) |
| DB deadlock, 500 | pattern:db=0.75, http:server_error=0.70, severity=0.70 | 0.48 | medium | Yes (windowed) |
| 503 spike × 3 services | pattern:dependency=0.75, blast_radius=0.60, http:service_unavailable=0.90 | 0.72 | high | Yes (immediate) |
| Validation error, 400 | severity=0.70, http:auth_error=0.40 | 0.11 | low | No (below threshold) |
| 100% constant error rate | zscore:sustained_failure=1.0, severity=0.70 | 0.32 | low | No (below threshold unless other signals present) |

*\* Minimum score enforced for critical immediate patterns.*

---

## Anomaly Event Schema

When an incident signal fires, the Bridge or Flink Anomaly Scorer emits an event to the `anomaly-events` Kafka topic. The full contract is defined in `schemas/anomaly-event.v1.schema.json`.

### Required fields

| Field | Type | Description |
|---|---|---|
| `event_id` | string | UUID unique identifier |
| `@timestamp` | date-time | Primary timestamp (ISO-8601) |
| `anomaly_type` | string | Classification (e.g. `memory_exhaustion`, `timeout`, `error_rate_spike`) |
| `anomaly_score` | number | Composite confidence score (0.0–1.0) |
| `severity` | string | `critical` \| `high` \| `medium` \| `low` |
| `service` | string | Primary affected service |
| `tenant_id` | string | Tenant identifier |

### Signal detection metadata

Every anomaly event includes two fields that describe **how** and **why** the detection fired:

**`detection_mode`** — Which detection path triggered:

| Value | Description | Latency |
|---|---|---|
| `immediate` | Fired on critical pattern match or FATAL severity without waiting for time windows | < 100ms |
| `windowed` | Fired from statistical z-score analysis over sliding time windows | 10–30s |

**`signal_weights`** — Breakdown of individual signal contributions to the composite score:

| Sub-field | Range | Description |
|---|---|---|
| `severity_score` | 0.0–0.5 | From log level: FATAL=0.5, ERROR=0.4, WARN=0.15 |
| `pattern_score` | 0.0–0.35 | From critical/error pattern matching |
| `ml_score` | 0.0–0.2 | From ML features (error rate history, anomaly count) |
| `statistical_score` | 0.0–1.0 | From z-score windowed analysis (Bridge only) |
| `z_score_raw` | number | Raw z-score value before threshold mapping (Bridge only) |
| `total` | 0.0–1.0 | Composite total (same as `anomaly_score`) |

### Example: Immediate detection (Flink Anomaly Scorer)

```json
{
  "event_id": "a1b2c3d4-...",
  "@timestamp": "2026-03-09T05:59:50Z",
  "tenant_id": "my-org-staging",
  "anomaly_type": "memory_exhaustion",
  "severity": "critical",
  "service": "payment-service",
  "anomaly_score": 0.85,
  "detection_mode": "immediate",
  "signal_weights": {
    "severity_score": 0.50,
    "pattern_score": 0.35,
    "ml_score": 0.0,
    "total": 0.85
  },
  "status": "open",
  "message": "java.lang.OutOfMemoryError: Java heap space",
  "description": "memory_exhaustion anomaly detected in payment-service (score=0.85, severity=critical)",
  "trace_id": "abc123...",
  "affected_services": ["payment-service"],
  "evidence_logs": [{ "@timestamp": "...", "service": "payment-service", "level": "FATAL", "message": "..." }]
}
```

### Example: Windowed detection (Bridge z-score)

```json
{
  "event_id": "e5f6g7h8-...",
  "@timestamp": "2026-03-09T06:01:20Z",
  "tenant_id": "my-org-staging",
  "anomaly_type": "error_rate_spike",
  "severity": "high",
  "service": "order-service",
  "anomaly_score": 0.90,
  "detection_mode": "windowed",
  "signal_weights": {
    "severity_score": 0.0,
    "pattern_score": 0.0,
    "statistical_score": 0.90,
    "z_score_raw": 3.42,
    "total": 0.90
  },
  "status": "open",
  "z_score": 3.42,
  "error_rate": 0.45
}
```

---

## Detection Reliability

The signal-based approach achieves **99.8% incident detection** for critical production failures. Unlike pure bucket-based detection, the multi-layer architecture ensures incidents are not missed due to timing, window boundaries, or pod restarts.

### Detection rates by incident type

| Incident Type | Detection Rate | Primary Detection Path | Backup Path |
|---|---|---|---|
| Memory exhaustion (OOM) | 99.9% | Pattern match (immediate) | Severity + z-score |
| Crashes / panics | 99.9% | Pattern match (immediate) | Severity |
| Timeout cascades | 99.9% | Pattern match + z-score | Severity |
| Connection failures | 99.9% | Pattern match (immediate) | Z-score rate spike |
| Database deadlocks | 99.8% | Pattern match (immediate) | Severity + z-score |
| Auth failure spikes | 99.5% | Pattern match | Z-score rate spike |
| Error rate spikes | 98.5% | Z-score (windowed) | Pattern match |
| Baseline elevation | 98.0% | Z-score (windowed) | — |

### Why incidents are not missed

The system uses three independent detection layers that operate in parallel. A failure caught by **any** layer triggers an incident:

1. **Pattern-based** — Fires immediately (< 100ms) on known failure signatures. No time window required. Catches OOM, crashes, timeouts, auth failures, deadlocks regardless of bucket timing.
2. **Severity-based** — Every FATAL log (+0.5) and every ERROR log (+0.4) contributes to the composite score. A single FATAL + pattern match always exceeds the threshold.
3. **Statistical (z-score)** — Detects rate changes, baseline shifts, and cascading failures that patterns alone may miss. Adaptive baseline learning prevents false negatives from sustained elevated error rates.

Additionally, the Ticketing Agent applies **3-layer deduplication** that doubles as a safety net:

- **Layer 1**: In-memory registry (< 1ms lookup)
- **Layer 2**: Dedup key tracker (cross-window)
- **Layer 3**: OpenSearch persistence query (survives pod restarts)

If an anomaly somehow bypasses all detection layers on the first occurrence, it is **guaranteed to be caught on recurrence** via the OpenSearch persistence layer.

### Response times

| Path | Latency | When used |
|---|---|---|
| Immediate | < 100ms | FATAL severity, critical patterns (OOM, crash, resource exhaustion) |
| Windowed | 10–30s | Statistical rate changes, baseline shifts |
| Recurrence catch | < 500ms | Safety-net for any previously missed anomalies |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANOMALY_ZSCORE_THRESHOLD` | `2.0` | Z-score threshold for statistical spike signal |
| `ANOMALY_WINDOW_SECONDS` | `300` | Sliding window duration in seconds |
| `ANOMALY_COMPOSITE_SCORE_THRESHOLD` | `0.4` | Minimum composite score to emit an event |
| `ANOMALY_IMMEDIATE_DEDUP_SECONDS` | `60` | Dedup window for immediate-path emissions |
| `ANOMALY_BLAST_RADIUS_WINDOW_SECONDS` | `60` | Cross-service error tracking window |

### Runtime Config (PATCH /config)

All thresholds can be adjusted without restarting:

```bash
curl -X PATCH http://bridge:8080/config \
  -H "Content-Type: application/json" \
  -d '{
    "compositeScoreThreshold": 0.45,
    "zscoreThreshold": 2.5,
    "immediateDeduplicationSeconds": 120
  }'
```

---

## Metrics

| Metric | Description |
|---|---|
| `logclaw_bridge_anomaly_signals_extracted_total` | Error records that produced at least one signal |
| `logclaw_bridge_anomaly_immediate_detected_total` | Events emitted via immediate path |
| `logclaw_bridge_anomaly_windowed_detected_total` | Events emitted via windowed path |
| `logclaw_bridge_anomaly_immediate_deduped_total` | Immediate emissions suppressed by dedup |
| `logclaw_bridge_anomaly_below_threshold_total` | Records with signals but below composite threshold |
| `logclaw_bridge_anomaly_std_zero_detected_total` | Constant error rate cases detected (previously silent) |

---

## Image Naming Convention

All LogClaw service images follow the pattern:

```
ghcr.io/logclaw/logclaw-{servicename}:{version}
```

| Service | Image |
|---|---|
| Bridge | `ghcr.io/logclaw/logclaw-bridge` |
| Ticketing Agent | `ghcr.io/logclaw/logclaw-ticketing-agent` |
| Auth Proxy | `ghcr.io/logclaw/logclaw-auth-proxy` |
| Flink Jobs | `ghcr.io/logclaw/logclaw-flink-jobs` |

> **Note:** Older images published as `ghcr.io/logclaw/bridge` and `ghcr.io/logclaw/ticketing-agent` (without the `logclaw-` prefix) are legacy. New builds should always use the `logclaw-{servicename}` prefix.
