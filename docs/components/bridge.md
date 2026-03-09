---
title: Bridge
description: OTLP ETL translator, anomaly detection, trace correlation, and OpenSearch indexing service.
---

# Bridge

The Bridge is a Python-based service that provides the core log processing pipeline. It consumes raw OTLP JSON from Kafka, normalizes it into flat documents, detects anomalies, correlates traces, and indexes everything into OpenSearch.

## Architecture

The Bridge runs **4 concurrent threads**, each handling a distinct stage of the pipeline:

```
Kafka "raw-logs"
       │
       ▼
┌─────────────────────┐
│  Thread 1: OTLP ETL │  Flatten OTLP JSON → normalized documents
│  (consumer group:   │  Write to "enriched-logs" topic
│   logclaw-bridge-etl)│
└──────────┬──────────┘
           │
     Kafka "enriched-logs"
       │           │
       ▼           ▼
┌──────────┐  ┌──────────────────────┐
│ Thread 2 │  │ Thread 3: Indexer    │
│ Anomaly  │  │ Bulk write to       │
│ Detector │  │ OpenSearch           │
│ (Signal) │  │ logclaw-logs-*      │
└──────────┘  └──────────────────────┘
       │
       ▼
┌──────────────────────┐
│ Thread 4: Lifecycle  │
│ Request correlation  │
│ (5-layer trace)      │
└──────────────────────┘
```

## OTLP ETL (Thread 1)

The ETL thread consumes OTLP JSON messages from the `raw-logs` Kafka topic and flattens them into canonical log documents.

**OTLP unwrapping path:**
```
resourceLogs → scopeLogs → logRecords → flatten each record
```

**Field mapping:**

| OTLP Field | Output Field | Description |
|------------|-------------|-------------|
| `resource.attributes["service.name"]` | `service` | Service name |
| `logRecord.body.stringValue` | `message` | Log message |
| `logRecord.severityText` | `level` | Log level (INFO, WARN, ERROR) |
| `logRecord.timeUnixNano` | `timestamp` | ISO-8601 timestamp |
| `logRecord.traceId` | `trace_id` | Distributed trace ID |
| `logRecord.spanId` | `span_id` | Span ID |
| `resource.attributes["host.name"]` | `host` | Hostname |
| `resource.attributes["tenant_id"]` | `tenant_id` | Tenant identifier |
| `logRecord.attributes[*]` | *(flattened)* | Custom attributes as top-level fields |

## Anomaly Detection (Thread 2)

Uses a **signal-based composite scoring** system to classify whether an error log is incident-worthy. Not every error triggers an incident — the system distinguishes actionable failures (OOM, database deadlocks, cascading failures) from noise (validation errors, 404s).

Two detection paths run in parallel:

- **Immediate path** — OOM, crash, and resource exhaustion patterns fire in under 1 second without waiting for a time window
- **Windowed path** — statistical z-score combined with blast radius, velocity, and recurrence signals across the sliding window

See [Incident Classification](/components/incident-classification) for the full signal system documentation.

**Key environment variables:**

| Variable | Default | Description |
|---|---|---|
| `ANOMALY_ZSCORE_THRESHOLD` | `2.0` | Z-score threshold for statistical spike signal |
| `ANOMALY_WINDOW_SECONDS` | `300` | Sliding window duration |
| `ANOMALY_COMPOSITE_SCORE_THRESHOLD` | `0.4` | Minimum composite score to emit an event |
| `ANOMALY_IMMEDIATE_DEDUP_SECONDS` | `60` | Dedup window for immediate-path emissions |

When an anomaly is detected, an event is published to `anomaly-events` Kafka topic with `anomaly_score`, `severity`, `signals`, `detection_mode`, `error_category`, and `error_message` fields.

## Request Lifecycle Engine (Thread 4)

The lifecycle engine performs **5-layer trace correlation** to group related log entries into request timelines:

1. **Trace ID grouping** — group logs sharing the same `trace_id`
2. **Temporal proximity** — cluster logs within a time window
3. **Service dependency mapping** — map caller→callee relationships
4. **Error propagation tracking** — trace error cascades across services
5. **Blast radius computation** — determine affected services and endpoints

## Prometheus Metrics

The Bridge exposes Prometheus-format metrics at `GET /metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `logclaw_bridge_etl_consumed_total` | Counter | Kafka messages (batches) consumed from `raw-logs` |
| `logclaw_bridge_etl_records_received_total` | Counter | Individual OTLP log records flattened |
| `logclaw_bridge_etl_produced_total` | Counter | Enriched documents written to `enriched-logs` |
| `logclaw_bridge_anomaly_detected_total` | Counter | Total anomaly events emitted |
| `logclaw_bridge_anomaly_immediate_detected_total` | Counter | Anomalies detected via immediate path (OOM/crash/resource) |
| `logclaw_bridge_anomaly_windowed_detected_total` | Counter | Anomalies detected via windowed statistical path |
| `logclaw_bridge_anomaly_signals_extracted_total` | Counter | Error records with at least one signal extracted |
| `logclaw_bridge_anomaly_below_threshold_total` | Counter | Signals filtered (below composite score threshold) |
| `logclaw_bridge_anomaly_std_zero_detected_total` | Counter | Constant error rate cases (previously silent failures) |
| `logclaw_bridge_indexer_indexed_total` | Counter | Documents indexed into OpenSearch |
| `logclaw_bridge_indexer_errors_total` | Counter | OpenSearch indexing errors |

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KAFKA_BROKERS` | Yes | — | Kafka bootstrap servers |
| `KAFKA_TOPIC_RAW` | No | `raw-logs` | Topic to consume raw OTLP JSON |
| `KAFKA_TOPIC_ENRICHED` | No | `enriched-logs` | Topic to produce enriched documents |
| `OPENSEARCH_ENDPOINT` | Yes | — | OpenSearch cluster URL |
| `OPENSEARCH_USERNAME` | No | — | OpenSearch Basic Auth username |
| `OPENSEARCH_PASSWORD` | No | — | OpenSearch Basic Auth password |
| `ANOMALY_ZSCORE_THRESHOLD` | No | `2.0` | Z-score threshold for statistical spike signal |
| `ANOMALY_WINDOW_SECONDS` | No | `300` | Sliding window duration in seconds |
| `ANOMALY_COMPOSITE_SCORE_THRESHOLD` | No | `0.4` | Minimum composite score to emit an anomaly event |
| `ANOMALY_IMMEDIATE_DEDUP_SECONDS` | No | `60` | Dedup window for immediate-path emissions |
| `ANOMALY_BLAST_RADIUS_WINDOW_SECONDS` | No | `60` | Cross-service error tracking window |
| `PORT` | No | `8080` | HTTP server port |

### Runtime Configuration

The Bridge supports dynamic runtime configuration via the `/config` endpoint:

```bash
# Get current config
curl http://localhost:8080/config

# Update anomaly thresholds
curl -X PATCH http://localhost:8080/config \
  -H "Content-Type: application/json" \
  -d '{"zscoreThreshold": 3.0, "windowSeconds": 600, "compositeScoreThreshold": 0.45}'
```

### Helm Values

```yaml
logclaw-bridge:
  env:
    KAFKA_BROKERS: "logclaw-kafka-bootstrap:9092"
    OPENSEARCH_ENDPOINT: "https://logclaw-opensearch:9200"
    ANOMALY_ZSCORE_THRESHOLD: "2.0"
    ANOMALY_WINDOW_SECONDS: "300"
    ANOMALY_COMPOSITE_SCORE_THRESHOLD: "0.4"
```

## Health Check

```bash
curl http://localhost:8080/health
```

Returns:
```json
{
  "status": "ok",
  "threads": {
    "etl": "running",
    "anomaly": "running",
    "indexer": "running",
    "lifecycle": "running"
  },
  "kafka": "connected",
  "opensearch": "connected"
}
```
