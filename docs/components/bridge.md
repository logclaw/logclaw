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
│ (Z-score)│  │ logclaw-logs-*      │
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

Uses a sliding-window **Z-score** algorithm to detect anomalous error rate spikes per service.

**Configuration:**

| Parameter | Env Var | Default | Description |
|-----------|---------|---------|-------------|
| Threshold | `ANOMALY_THRESHOLD` | `2.5` | Z-score threshold for anomaly flagging |
| Window Size | `WINDOW_SIZE` | `50` | Number of data points in sliding window |

When an anomaly is detected, the document is enriched with:
- `anomaly_score` — the computed Z-score
- `is_anomaly` — boolean flag
- Written to the anomalies topic for the Ticketing Agent

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
| `logclaw_bridge_anomalies_detected_total` | Counter | Anomalies detected |
| `logclaw_bridge_opensearch_indexed_total` | Counter | Documents indexed into OpenSearch |
| `logclaw_bridge_opensearch_errors_total` | Counter | OpenSearch indexing errors |

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
| `ANOMALY_THRESHOLD` | No | `2.5` | Z-score threshold |
| `WINDOW_SIZE` | No | `50` | Sliding window size |
| `PORT` | No | `8080` | HTTP server port |

### Runtime Configuration

The Bridge supports dynamic runtime configuration via the `/config` endpoint:

```bash
# Get current config
curl http://localhost:8080/config

# Update anomaly threshold
curl -X PATCH http://localhost:8080/config \
  -H "Content-Type: application/json" \
  -d '{"anomalyThreshold": 3.0, "windowSize": 100}'
```

### Helm Values

```yaml
logclaw-bridge:
  bridge:
    kafkaBrokers: "logclaw-kafka-kafka-bootstrap:9093"
    opensearchEndpoint: "https://logclaw-opensearch:9200"
    anomalyThreshold: 2.5
    windowSize: 50
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
