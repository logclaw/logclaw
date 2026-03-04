---
title: Bridge API
description: Bridge service API for health checks, metrics, and runtime configuration.
---

# Bridge API

The Bridge exposes HTTP endpoints for health monitoring, Prometheus metrics, and runtime configuration management.

**Base URL:** `http://logclaw-bridge:8080`
**Dashboard proxy:** `/api/bridge/*`

## Health Check

```
GET /health
```

Returns the health status of all Bridge threads and connections.

### Response

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

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Overall status: `ok` or `error` |
| `threads` | object | Status of each processing thread |
| `kafka` | string | Kafka connection status |
| `opensearch` | string | OpenSearch connection status |

---

## Prometheus Metrics

```
GET /metrics
```

Returns Prometheus-format metrics for monitoring and alerting.

### Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `logclaw_bridge_etl_consumed_total` | counter | — | Kafka messages (batches) consumed from `raw-logs` |
| `logclaw_bridge_etl_records_received_total` | counter | — | Individual OTLP log records unpacked and flattened |
| `logclaw_bridge_etl_produced_total` | counter | — | Enriched documents written to `enriched-logs` |
| `logclaw_bridge_anomalies_detected_total` | counter | — | Anomalies detected by the Z-score engine |
| `logclaw_bridge_opensearch_indexed_total` | counter | — | Documents successfully indexed into OpenSearch |
| `logclaw_bridge_opensearch_errors_total` | counter | — | OpenSearch indexing errors |

### Example Response

```
# HELP logclaw_bridge_etl_consumed_total Kafka messages consumed
# TYPE logclaw_bridge_etl_consumed_total counter
logclaw_bridge_etl_consumed_total 47

# HELP logclaw_bridge_etl_records_received_total OTLP log records received
# TYPE logclaw_bridge_etl_records_received_total counter
logclaw_bridge_etl_records_received_total 12450

# HELP logclaw_bridge_etl_produced_total Enriched documents produced
# TYPE logclaw_bridge_etl_produced_total counter
logclaw_bridge_etl_produced_total 12450

# HELP logclaw_bridge_anomalies_detected_total Anomalies detected
# TYPE logclaw_bridge_anomalies_detected_total counter
logclaw_bridge_anomalies_detected_total 3
```

<Note>
`etl_consumed_total` counts **Kafka messages** (batches), while `etl_records_received_total` counts **individual log records**. A single Kafka message can contain hundreds of OTLP log records. Use `etl_records_received_total` for accurate log volume tracking.
</Note>

---

## Get Configuration

```
GET /config
```

Returns the current runtime configuration.

### Response

```json
{
  "anomalyThreshold": 2.5,
  "windowSize": 50,
  "kafkaBrokers": "logclaw-kafka-kafka-bootstrap:9093",
  "rawTopic": "raw-logs",
  "enrichedTopic": "enriched-logs",
  "opensearchEndpoint": "https://logclaw-opensearch:9200"
}
```

---

## Update Configuration

```
PATCH /config
```

Update runtime configuration dynamically. Changes take effect immediately without restart.

### Request Body

```json
{
  "anomalyThreshold": 3.0,
  "windowSize": 100
}
```

| Field | Type | Description |
|-------|------|-------------|
| `anomalyThreshold` | number | Z-score threshold for anomaly detection (default: 2.5) |
| `windowSize` | integer | Sliding window size for anomaly calculation (default: 50) |

### Response

```json
{
  "status": "ok",
  "config": {
    "anomalyThreshold": 3.0,
    "windowSize": 100
  }
}
```

<Warning>
Runtime config changes are not persisted across pod restarts. For permanent changes, update the Helm values and redeploy.
</Warning>
