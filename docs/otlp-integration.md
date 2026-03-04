---
title: OTLP Integration Guide
description: Send logs to LogClaw from any language or framework using OpenTelemetry Protocol.
---

# OTLP Integration Guide

LogClaw uses **OTLP (OpenTelemetry Protocol)** as its sole log ingestion protocol. OTLP is the
CNCF industry standard supported by every major observability vendor — Datadog, Splunk, Grafana,
AWS CloudWatch, GCP Cloud Logging, and Azure Monitor all speak OTLP natively.

No custom integrations needed. If your app already uses OpenTelemetry, point it at LogClaw and
you're done.

## Endpoints

| Transport | Port | Path | Use Case |
|-----------|------|------|----------|
| gRPC | 4317 | — | High-throughput, binary Protobuf. Recommended for production SDKs and OTel agents. |
| HTTP/JSON | 4318 | `/v1/logs` | Human-readable JSON. Good for curl, scripts, and debugging. |

Both ports are exposed on the `logclaw-otel-collector` Kubernetes service.

## Quick Start — curl

The simplest way to send a log to LogClaw:

```bash
curl -X POST http://<collector>:4318/v1/logs \
  -H "Content-Type: application/json" \
  -d '{
    "resourceLogs": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "my-service"}}
        ]
      },
      "scopeLogs": [{
        "logRecords": [{
          "timeUnixNano": "'$(date +%s)000000000'",
          "severityText": "ERROR",
          "body": {"stringValue": "Connection refused to database"},
          "traceId": "abcdef1234567890abcdef1234567890",
          "spanId": "abcdef12345678",
          "attributes": [
            {"key": "environment", "value": {"stringValue": "production"}},
            {"key": "region", "value": {"stringValue": "us-east-1"}}
          ]
        }]
      }]
    }]
  }'
```

Expected response: `200 OK` with `{"partialSuccess":{}}`.

## SDK Integration

### Python

Install the OpenTelemetry Python SDK:

```bash
pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-grpc
```

```python
import logging
from opentelemetry import _logs as logs
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter
from opentelemetry.sdk.resources import Resource

# Configure the OTel log pipeline
resource = Resource.create({"service.name": "payment-api"})
provider = LoggerProvider(resource=resource)
provider.add_log_record_processor(
    BatchLogRecordProcessor(
        OTLPLogExporter(endpoint="http://<collector>:4317", insecure=True)
    )
)
logs.set_logger_provider(provider)

# Attach OTel handler to Python logging
handler = LoggingHandler(logger_provider=provider)
logging.getLogger().addHandler(handler)
logging.getLogger().setLevel(logging.INFO)

# Use standard Python logging — logs go to LogClaw automatically
logger = logging.getLogger("payment-api")
logger.error("Connection refused to database", extra={"trace_id": "abc123"})
```

### Java (Log4j2 + OTel Appender)

Add the OTel Log4j2 appender to your `pom.xml`:

```xml
<dependency>
  <groupId>io.opentelemetry.instrumentation</groupId>
  <artifactId>opentelemetry-log4j-appender-2.17</artifactId>
  <version>2.10.0-alpha</version>
</dependency>
```

Configure `log4j2.xml`:

```xml
<Configuration>
  <Appenders>
    <OpenTelemetry name="OTelAppender" />
  </Appenders>
  <Loggers>
    <Root level="INFO">
      <AppenderRef ref="OTelAppender" />
    </Root>
  </Loggers>
</Configuration>
```

Set the environment variable to point at LogClaw:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://<collector>:4317
export OTEL_RESOURCE_ATTRIBUTES=service.name=order-engine
```

### Node.js (Winston + OTel)

```bash
npm install @opentelemetry/sdk-logs @opentelemetry/exporter-logs-otlp-grpc \
  @opentelemetry/resources @opentelemetry/semantic-conventions
```

```javascript
const { LoggerProvider, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-grpc');
const { Resource } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

const resource = new Resource({ [ATTR_SERVICE_NAME]: 'notification-svc' });
const loggerProvider = new LoggerProvider({ resource });

loggerProvider.addLogRecordProcessor(
  new BatchLogRecordProcessor(
    new OTLPLogExporter({ url: 'http://<collector>:4317' })
  )
);

const logger = loggerProvider.getLogger('notification-svc');
logger.emit({
  severityText: 'ERROR',
  body: 'Failed to send email notification',
  attributes: { 'user.id': '12345', environment: 'production' },
});
```

### Go

```bash
go get go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc
go get go.opentelemetry.io/otel/sdk/log
```

```go
package main

import (
    "context"
    "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc"
    sdklog "go.opentelemetry.io/otel/sdk/log"
    "go.opentelemetry.io/otel/sdk/resource"
    semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func main() {
    ctx := context.Background()
    exporter, _ := otlploggrpc.New(ctx,
        otlploggrpc.WithEndpoint("<collector>:4317"),
        otlploggrpc.WithInsecure(),
    )
    res, _ := resource.New(ctx,
        resource.WithAttributes(semconv.ServiceName("inventory-api")),
    )
    provider := sdklog.NewLoggerProvider(
        sdklog.WithResource(res),
        sdklog.WithProcessor(sdklog.NewBatchProcessor(exporter)),
    )
    defer provider.Shutdown(ctx)

    logger := provider.Logger("inventory-api")
    // Use logger to emit log records
    _ = logger
}
```

## Using an OTel Collector as a Sidecar / Agent

For production deployments, the recommended pattern is to run an OTel Collector as a DaemonSet
or sidecar that collects logs from your pods and forwards them to LogClaw's collector.

```yaml
# otel-agent-config.yaml
receivers:
  filelog:
    include: [/var/log/pods/*/*/*.log]
    operators:
      - type: container
        id: container-parser

exporters:
  otlp:
    endpoint: "logclaw-otel-collector.<namespace>.svc:4317"
    tls:
      insecure: true

service:
  pipelines:
    logs:
      receivers: [filelog]
      exporters: [otlp]
```

This automatically captures all pod stdout/stderr logs without any application code changes.

## OTLP Field Mapping

LogClaw's Bridge flattens the nested OTLP structure into canonical flat documents for OpenSearch:

| OTLP Field | LogClaw Field | Description |
|-------------|---------------|-------------|
| `resource.attributes["service.name"]` | `service` | Service name |
| `logRecord.body.stringValue` | `message` | Log message |
| `logRecord.severityText` | `level` | Log level (INFO, WARN, ERROR, etc.) |
| `logRecord.timeUnixNano` | `timestamp` | ISO-8601 timestamp |
| `logRecord.traceId` | `trace_id` | Distributed trace ID |
| `logRecord.spanId` | `span_id` | Span ID |
| `resource.attributes["host.name"]` | `host` | Hostname |
| `resource.attributes["tenant_id"]` | `tenant_id` | Tenant (injected by collector) |
| `logRecord.attributes[*]` | Flattened as top-level fields | Custom attributes |

## Dashboard File Upload

The LogClaw dashboard supports drag-and-drop log file upload. When you upload a JSON file through
the UI, the dashboard automatically converts each log entry to OTLP format using the built-in
`logsToOtlp()` converter and sends them to the OTel Collector via the `/api/otel/v1/logs` proxy.

Supported file formats:
- **JSON** — array of log objects `[{"message": "...", "level": "ERROR", ...}]`
- **NDJSON** — newline-delimited JSON (one log object per line)

## Troubleshooting

**Logs not appearing in OpenSearch?**

1. Check OTel Collector health:
   ```bash
   kubectl port-forward svc/logclaw-otel-collector 13133:13133
   curl http://localhost:13133/
   # Expected: {"status":"Server available","..."}
   ```

2. Check Collector logs for export errors:
   ```bash
   kubectl logs -l app.kubernetes.io/name=logclaw-otel-collector --tail=50
   ```

3. Verify Kafka topic has messages:
   ```bash
   kubectl exec -it logclaw-kafka-0 -- bin/kafka-console-consumer.sh \
     --bootstrap-server localhost:9092 --topic raw-logs --max-messages 1
   ```

4. Check Bridge OTLP ETL thread:
   ```bash
   kubectl logs -l app.kubernetes.io/name=logclaw-bridge --tail=50 | grep "otlp"
   ```

**Getting `connection refused`?**

Ensure you're using the correct port:
- gRPC → `:4317`
- HTTP/JSON → `:4318/v1/logs`

Do not use port 8080 — that was the legacy Vector endpoint and is no longer available.
