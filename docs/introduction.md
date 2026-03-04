---
title: Introduction
description: AI-powered log intelligence platform with real-time anomaly detection, trace correlation, and OTLP-native ingestion.
---

# Welcome to LogClaw

LogClaw is an **enterprise-grade, Kubernetes-native log intelligence platform**. It combines real-time anomaly detection, trace-correlated incident ticketing, and GitOps-native multi-tenancy into a single deployment stack.

<img
  className="block dark:hidden"
  src="/logo/light.svg"
  alt="LogClaw"
  width="180"
/>
<img
  className="hidden dark:block"
  src="/logo/dark.svg"
  alt="LogClaw"
  width="180"
/>

## Why LogClaw?

<CardGroup cols={2}>
  <Card title="OTLP-Native Ingestion" icon="plug">
    Uses OpenTelemetry Protocol as the sole ingestion interface. Any OTel SDK, agent, or collector works out of the box — no custom integrations.
  </Card>
  <Card title="AI-Powered Detection" icon="brain">
    Statistical anomaly scoring on error rates, automatic trace correlation across services, and blast radius computation — all in real time.
  </Card>
  <Card title="Multi-Platform Ticketing" icon="ticket">
    Route incidents to PagerDuty, Jira, ServiceNow, OpsGenie, Slack, or Zammad simultaneously with per-severity routing rules.
  </Card>
  <Card title="GitOps-Native Tenancy" icon="code-branch">
    Add a YAML file, push to main, and ArgoCD deploys a fully isolated tenant stack in 30 minutes. Namespace-per-tenant — no shared data plane.
  </Card>
</CardGroup>

## How It Works

```
Apps ──OTLP──▶ OTel Collector ──▶ Kafka ──▶ Bridge (ETL + Anomaly + Trace Correlation)
  (gRPC :4317)                                        │
  (HTTP :4318)                          ┌──────────────┴──────────────┐
                                        ▼                             ▼
                                  OpenSearch                   Ticketing Agent
                                (search + analytics)       (PagerDuty, Jira, etc.)
                                        │
                                        ▼
                                   Dashboard
                              (Next.js pipeline UI)
```

## Core Components

| Component | Role | Technology |
|-----------|------|------------|
| **OTel Collector** | OTLP gRPC/HTTP receiver, batching, tenant enrichment | OpenTelemetry Collector Contrib |
| **Kafka** | Durable event bus — raw logs + enriched logs topics | Strimzi KRaft |
| **Bridge** | OTLP ETL, anomaly detection, trace correlation, OpenSearch indexer | Python, Kafka |
| **OpenSearch** | Full-text search, log analytics, visualization | OpenSearch + Dashboards |
| **Ticketing Agent** | AI SRE — deduplicated, trace-correlated incident tickets | Python, LangChain |
| **ML Engine** | Feature Store + model inference serving | Feast, KServe |
| **Airflow** | ML pipeline orchestration and retraining DAGs | Apache Airflow |
| **Infrastructure Agent** | Cluster health collection — Kafka lag, Flink, OpenSearch, ESO | Go |
| **Dashboard** | Web UI for log ingestion, incidents, anomalies, and config | Next.js |

## Quick Start

<Steps>
  <Step title="Clone the repository">
    ```bash
    git clone https://github.com/logclaw/logclaw.git
    cd logclaw
    ```
  </Step>
  <Step title="Start local development environment">
    ```bash
    ./scripts/setup-dev.sh
    ```
    This creates a Kind cluster, installs all operators and services, and runs a smoke test. Takes ~20 minutes on a 16 GB machine.
  </Step>
  <Step title="Send your first log">
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
              "severityText": "INFO",
              "body": {"stringValue": "Hello from LogClaw!"}
            }]
          }]
        }]
      }'
    ```
  </Step>
</Steps>

## Next Steps

<CardGroup cols={2}>
  <Card title="Architecture" icon="sitemap" href="/architecture">
    Understand the deployment model, data flow, and component interactions.
  </Card>
  <Card title="Tenant Onboarding" icon="rocket" href="/onboarding">
    Provision a new tenant from zero to fully operational in 30 minutes.
  </Card>
  <Card title="OTLP Integration" icon="plug" href="/otlp-integration">
    Send logs from any language or framework using OpenTelemetry SDKs.
  </Card>
  <Card title="Local Development" icon="laptop-code" href="/local-development">
    Set up a local dev environment with Docker Compose or Kind.
  </Card>
  <Card title="Dashboard Guide" icon="chart-line" href="/components/dashboard">
    Explore the web UI for log ingestion, incident management, and pipeline monitoring.
  </Card>
  <Card title="API Reference" icon="code" href="/api-reference/overview">
    Full API documentation for every LogClaw service.
  </Card>
</CardGroup>
