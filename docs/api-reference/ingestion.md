---
title: Ingestion API
description: OTLP log ingestion endpoints via the OpenTelemetry Collector.
---

# Ingestion API

Logs are ingested into LogClaw exclusively via **OTLP (OpenTelemetry Protocol)**. The OTel Collector accepts both gRPC and HTTP transports.

## Send Logs (HTTP/JSON)

<ParamField path="method" type="string" default="POST">
  HTTP method
</ParamField>

```
POST /v1/logs
```

Send log records in OTLP HTTP/JSON format.

**LogClaw Cloud (managed):** `POST https://console.logclaw.ai/api/ingest/v1/logs`
**Via Dashboard proxy (self-hosted):** `POST /api/otel/v1/logs`
**Direct (self-hosted):** `POST http://logclaw-otel-collector:4318/v1/logs`

### Authentication

<Note>
**LogClaw Cloud** requires an API key via the `x-logclaw-api-key` header. Get your key from [console.logclaw.ai](https://console.logclaw.ai) under **Settings → API Keys**. See [API Keys](/api-keys) for details.

**Self-hosted** deployments do not require authentication — access is controlled at the Kubernetes NetworkPolicy level.
</Note>

### Request Headers

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `x-logclaw-api-key` | `lc_proj_...` (required for LogClaw Cloud, not needed for self-hosted) |

### Request Body

```json
{
  "resourceLogs": [
    {
      "resource": {
        "attributes": [
          {
            "key": "service.name",
            "value": { "stringValue": "payment-api" }
          },
          {
            "key": "host.name",
            "value": { "stringValue": "pod-abc123" }
          }
        ]
      },
      "scopeLogs": [
        {
          "logRecords": [
            {
              "timeUnixNano": "1709312400000000000",
              "severityText": "ERROR",
              "severityNumber": 17,
              "body": {
                "stringValue": "Connection refused to database"
              },
              "traceId": "abcdef1234567890abcdef1234567890",
              "spanId": "abcdef1234567890",
              "attributes": [
                {
                  "key": "environment",
                  "value": { "stringValue": "production" }
                },
                {
                  "key": "region",
                  "value": { "stringValue": "us-east-1" }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### Response

**200 OK**
```json
{
  "partialSuccess": {}
}
```

An empty `partialSuccess` object means all records were accepted.

### OTLP Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resourceLogs` | array | Yes | Array of resource log groups |
| `resource.attributes` | array | No | Resource-level attributes (service.name, host.name, etc.) |
| `scopeLogs` | array | Yes | Array of scope log groups |
| `logRecords` | array | Yes | Array of individual log records |
| `timeUnixNano` | string | No | Timestamp in nanoseconds since epoch |
| `severityText` | string | No | Severity level: TRACE, DEBUG, INFO, WARN, ERROR, FATAL |
| `severityNumber` | integer | No | Numeric severity (1-24) |
| `body.stringValue` | string | Yes | The log message |
| `traceId` | string | No | 32-character hex trace ID |
| `spanId` | string | No | 16-character hex span ID |
| `attributes` | array | No | Additional key-value attributes |

### Attribute Value Types

OTLP attributes support multiple value types:

```json
{"key": "name", "value": {"stringValue": "hello"}}
{"key": "count", "value": {"intValue": "42"}}
{"key": "ratio", "value": {"doubleValue": 3.14}}
{"key": "enabled", "value": {"boolValue": true}}
```

## Send Logs (gRPC)

```
grpc://logclaw-otel-collector:4317
```

Use the OTLP gRPC exporter from any OpenTelemetry SDK. This is the **recommended** transport for production workloads — binary Protobuf is more compact and efficient than JSON.

See the [OTLP Integration Guide](/otlp-integration) for SDK examples in Python, Java, Node.js, and Go.

## Health Check

```
GET http://logclaw-otel-collector:13133/
```

**Response:**
```json
{
  "status": "Server available",
  "upSince": "2024-01-15T10:30:00Z",
  "uptime": "48h30m"
}
```

## Examples

### curl — Single Log (LogClaw Cloud)

```bash
curl -X POST https://console.logclaw.ai/api/ingest/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-logclaw-api-key: $LOGCLAW_API_KEY" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "my-app"}}
        ]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "'$(date +%s)000000000'",
          "severityText": "ERROR",
          "body": {"stringValue": "Connection timeout"}
        }]
      }]
    }]
  }'
```

### curl — Single Log (Self-Hosted)

```bash
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "my-app"}}
        ]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "'$(date +%s)000000000'",
          "severityText": "ERROR",
          "body": {"stringValue": "Connection timeout"}
        }]
      }]
    }]
  }'
```

### curl — Batch (Multiple Records)

```bash
curl -X POST http://localhost:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "batch-test"}}
        ]
      },
      "scopeLogs": [{
        "logRecords": [
          {
            "timeUnixNano": "'$(date +%s)000000000'",
            "severityText": "INFO",
            "body": {"stringValue": "Request started"}
          },
          {
            "timeUnixNano": "'$(date +%s)000000000'",
            "severityText": "ERROR",
            "body": {"stringValue": "Database connection failed"}
          },
          {
            "timeUnixNano": "'$(date +%s)000000000'",
            "severityText": "WARN",
            "body": {"stringValue": "Retrying in 5 seconds"}
          }
        ]
      }]
    }]
  }'
```
