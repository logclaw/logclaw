---
title: Infrastructure Agent API
description: Cluster health monitoring API from the Go-based infrastructure agent.
---

# Infrastructure Agent API

The Infrastructure Agent is a Go-based service that collects health metrics from Kubernetes infrastructure components and exposes them via HTTP endpoints.

**Base URL:** `http://logclaw-agent:8080`
**Dashboard proxy:** `/api/agent/*`

---

## Health Check

```
GET /health
```

Liveness probe endpoint.

### Response

```json
{
  "status": "ok"
}
```

---

## Readiness Check

```
GET /ready
```

Readiness probe endpoint. Returns `200` only when all collectors are initialized.

### Response (Ready)

```json
{
  "status": "ready",
  "collectors": {
    "kafka": "initialized",
    "flink": "initialized",
    "opensearch": "initialized",
    "eso": "initialized"
  }
}
```

### Response (Not Ready)

```json
{
  "status": "not_ready",
  "collectors": {
    "kafka": "initialized",
    "flink": "initializing",
    "opensearch": "initialized",
    "eso": "error"
  }
}
```

---

## Infrastructure Metrics

```
GET /metrics
```

Returns aggregated infrastructure metrics from all collectors. Used by the Dashboard's pipeline monitoring view.

### Response

```json
{
  "kafka": {
    "status": "healthy",
    "brokers": 3,
    "topics": {
      "raw-logs": {
        "partitions": 6,
        "consumerLag": 150
      },
      "enriched-logs": {
        "partitions": 6,
        "consumerLag": 0
      }
    }
  },
  "flink": {
    "status": "healthy",
    "jobs": [
      {
        "name": "logclaw-anomaly-detection",
        "state": "RUNNING",
        "taskManagers": 2,
        "uptime": "48h30m"
      }
    ]
  },
  "opensearch": {
    "status": "green",
    "nodes": 6,
    "indices": 15,
    "totalDocs": 1542000,
    "totalSizeBytes": 2147483648,
    "activePrimaryShards": 15,
    "activeShards": 30
  },
  "eso": {
    "status": "healthy",
    "externalSecrets": [
      {
        "name": "logclaw-ticketing-credentials",
        "status": "SecretSynced",
        "lastSyncTime": "2024-03-01T15:00:00Z"
      }
    ]
  }
}
```

### Metric Fields

#### Kafka

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Overall Kafka health: `healthy`, `degraded`, `down` |
| `brokers` | integer | Number of active Kafka brokers |
| `topics[].partitions` | integer | Number of partitions per topic |
| `topics[].consumerLag` | integer | Consumer lag (unconsumed messages) |

#### Flink

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Flink health: `healthy`, `degraded`, `down` |
| `jobs[].name` | string | Job deployment name |
| `jobs[].state` | string | Job state: `RUNNING`, `FAILED`, `SUSPENDED` |
| `jobs[].taskManagers` | integer | Number of active task managers |

#### OpenSearch

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Cluster health: `green`, `yellow`, `red` |
| `nodes` | integer | Total cluster nodes |
| `totalDocs` | integer | Total indexed documents |
| `totalSizeBytes` | integer | Total index storage in bytes |

#### External Secrets Operator

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | ESO health: `healthy`, `degraded`, `down` |
| `externalSecrets[].status` | string | Sync status: `SecretSynced`, `SecretSyncError` |
| `externalSecrets[].lastSyncTime` | string | ISO-8601 timestamp of last sync |

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOGCLAW_TENANT_ID` | Yes | — | Tenant identifier for filtering CRDs |
| `LOGCLAW_NAMESPACE` | No | Current namespace | Kubernetes namespace to watch |
| `PORT` | No | `8080` | HTTP server port |
