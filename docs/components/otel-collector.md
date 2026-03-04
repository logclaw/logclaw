---
title: OTel Collector
description: OTLP-native log ingestion gateway using OpenTelemetry Collector.
---

# OTel Collector

The OpenTelemetry Collector is LogClaw's **sole ingestion gateway**. It accepts logs via OTLP (the CNCF industry standard) and forwards them to Kafka for processing.

## Why OTLP?

OTLP is supported natively by every major observability vendor — Datadog, Splunk, Grafana, AWS CloudWatch, GCP Cloud Logging, and Azure Monitor. If your app already uses OpenTelemetry, point it at LogClaw and you're done. No custom integrations needed.

## Endpoints

| Transport | Port | Path | Use Case |
|-----------|------|------|----------|
| gRPC | `4317` | — | High-throughput, binary Protobuf. Recommended for production SDKs and OTel agents. |
| HTTP/JSON | `4318` | `/v1/logs` | Human-readable JSON. Good for curl, scripts, and debugging. |

Both ports are exposed on the `logclaw-otel-collector` Kubernetes service.

## Pipeline

```
OTLP Receiver (gRPC + HTTP)
       │
       ▼
Memory Limiter (800 MiB limit, 200 MiB spike)
       │
       ▼
Resource Processor (inject tenant_id)
       │
       ▼
Batch Processor (1000 per batch, 5s timeout)
       │
       ▼
Kafka Exporter (raw-logs topic, otlp_json, lz4)
```

### Collector Configuration

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: "0.0.0.0:4317"
      http:
        endpoint: "0.0.0.0:4318"

processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 800
    spike_limit_mib: 200
  resource:
    attributes:
      - key: tenant_id
        value: "{{ .Values.global.tenantId }}"
        action: upsert
  batch:
    send_batch_size: 1000
    timeout: 5s

exporters:
  kafka:
    brokers:
      - "{{ .Values.global.kafkaBrokers }}"
    topic: "raw-logs"
    encoding: otlp_json
    producer:
      compression: lz4
      max_message_bytes: 10485760

extensions:
  health_check:
    endpoint: "0.0.0.0:13133"

service:
  extensions: [health_check]
  pipelines:
    logs:
      receivers: [otlp]
      processors: [memory_limiter, resource, batch]
      exporters: [kafka]
```

## Health Check

```bash
curl http://localhost:13133/
# Expected: {"status":"Server available", ...}
```

## Helm Values

```yaml
logclaw-otel-collector:
  replicaCount: 3
  image:
    repository: otel/opentelemetry-collector-contrib
    tag: "0.114.0"
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 50
    targetCPUUtilizationPercentage: 60
```

## Scaling

The OTel Collector supports horizontal pod autoscaling. For high-throughput deployments:

| Tier | Replicas | HPA |
|------|----------|-----|
| standard | 1 | Disabled |
| ha | 3 | Optional |
| ultra-ha | 5+ | Recommended (min 5, max 50) |

See the [OTLP Integration Guide](/otlp-integration) for SDK examples and troubleshooting.
