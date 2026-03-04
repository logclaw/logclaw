---
title: OpenSearch API
description: OpenSearch query and index management endpoints proxied through the Dashboard.
---

# OpenSearch API

LogClaw stores processed logs in OpenSearch. The Dashboard proxies OpenSearch API requests with automatic Basic Auth injection.

**Base URL:** `https://logclaw-opensearch:9200`
**Dashboard proxy:** `/api/opensearch/*`

## Index Pattern

LogClaw writes to daily indices: `logclaw-logs-YYYY.MM.dd`

Wildcard for all logs: `logclaw-logs-*`

---

## Cluster Health

```
GET /_cluster/health
```

### Response

```json
{
  "cluster_name": "logclaw-opensearch",
  "status": "green",
  "number_of_nodes": 6,
  "number_of_data_nodes": 3,
  "active_primary_shards": 15,
  "active_shards": 30
}
```

| Status | Meaning |
|--------|---------|
| `green` | All primary and replica shards assigned |
| `yellow` | All primary shards assigned, some replicas unassigned |
| `red` | Some primary shards unassigned — data may be unavailable |

---

## List Indices

```
GET /_cat/indices?format=json
```

Returns all indices with size, document count, and health status.

### Response

```json
[
  {
    "health": "green",
    "status": "open",
    "index": "logclaw-logs-2024.03.01",
    "docs.count": "15420",
    "store.size": "12.3mb"
  }
]
```

---

## Search Logs

```
POST /logclaw-logs-*/_search
```

Query logs using the OpenSearch Query DSL.

### Request Body

```json
{
  "size": 50,
  "sort": [{ "timestamp": "desc" }],
  "query": {
    "bool": {
      "must": [
        { "match": { "level": "ERROR" } },
        { "match": { "service": "payment-api" } }
      ],
      "filter": [
        {
          "range": {
            "timestamp": {
              "gte": "now-1h",
              "lte": "now"
            }
          }
        }
      ]
    }
  }
}
```

### Response

```json
{
  "hits": {
    "total": { "value": 42, "relation": "eq" },
    "hits": [
      {
        "_index": "logclaw-logs-2024.03.01",
        "_id": "abc123",
        "_source": {
          "timestamp": "2024-03-01T15:30:00Z",
          "service": "payment-api",
          "level": "ERROR",
          "message": "Connection refused to database",
          "trace_id": "abcdef1234567890",
          "span_id": "1234567890ab",
          "host": "pod-xyz",
          "tenant_id": "acme-corp",
          "anomaly_score": 3.2,
          "is_anomaly": true
        }
      }
    ]
  }
}
```

### Common Query Patterns

**All errors in the last hour:**
```json
{
  "query": {
    "bool": {
      "must": [{ "match": { "level": "ERROR" } }],
      "filter": [{ "range": { "timestamp": { "gte": "now-1h" } } }]
    }
  }
}
```

**Logs by trace ID:**
```json
{
  "query": {
    "term": { "trace_id": "abcdef1234567890abcdef1234567890" }
  },
  "sort": [{ "timestamp": "asc" }]
}
```

**Anomalies above threshold:**
```json
{
  "query": {
    "bool": {
      "must": [
        { "term": { "is_anomaly": true } },
        { "range": { "anomaly_score": { "gte": 2.5 } } }
      ]
    }
  }
}
```

**Full-text search:**
```json
{
  "query": {
    "match": { "message": "connection timeout database" }
  }
}
```

---

## Document Count

```
GET /logclaw-logs-*/_count
```

### Response

```json
{
  "count": 154200,
  "_shards": {
    "total": 15,
    "successful": 15,
    "failed": 0
  }
}
```

---

## Document Schema

Each indexed log document has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | date | ISO-8601 timestamp |
| `service` | keyword | Service name (from `service.name` resource attribute) |
| `level` | keyword | Log level: INFO, WARN, ERROR, FATAL |
| `message` | text | Log message body |
| `trace_id` | keyword | Distributed trace ID |
| `span_id` | keyword | Span ID |
| `host` | keyword | Hostname or pod name |
| `tenant_id` | keyword | Tenant identifier |
| `anomaly_score` | float | Z-score from anomaly detection (0 if normal) |
| `is_anomaly` | boolean | Whether the document triggered an anomaly alert |
| `batch_id` | keyword | Upload batch identifier (for file uploads) |
| `environment` | keyword | Environment tag (production, staging, dev) |
| `region` | keyword | Cloud region |

<Note>
Custom OTLP attributes are flattened as top-level fields. For example, `{"key": "user.id", "value": {"stringValue": "12345"}}` becomes `"user.id": "12345"` in the indexed document.
</Note>
