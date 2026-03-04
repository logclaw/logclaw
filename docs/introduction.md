---
title: Introduction
description: AI-powered log intelligence platform with real-time anomaly detection and OTLP-native ingestion.
---

# LogClaw

LogClaw is an enterprise-grade, Kubernetes-native log intelligence platform. It combines real-time
anomaly detection, trace-correlated incident ticketing, and GitOps-native multi-tenancy into a
single deployment stack.

## Why LogClaw?

- **OTLP-native ingestion** — uses OpenTelemetry Protocol (OTLP) as the sole ingestion interface.
  No custom integrations needed. Any OTel SDK, agent, or collector works out of the box.
- **AI-powered incident detection** — statistical anomaly scoring on error rates, automatic trace
  correlation across services, and blast radius computation.
- **Multi-platform ticketing** — route incidents to PagerDuty, Jira, ServiceNow, OpsGenie, Slack,
  or in-cluster Zammad simultaneously, with per-severity routing rules.
- **Namespace-per-tenant isolation** — every tenant gets its own Kubernetes namespace with
  dedicated instances of every component. No shared data plane.
- **GitOps-native** — add a YAML file to `gitops/tenants/`, push to main, and ArgoCD deploys
  the full stack in 30 minutes.

## Stack Overview

```
Logs ──OTLP──▶ OTel Collector ──▶ Kafka ──▶ Bridge (OTLP ETL + anomaly + trace correlation)
                                                  │
                                    ┌─────────────┴─────────────┐
                                    ▼                           ▼
                              OpenSearch                 Ticketing Agent
                            (search + viz)           (PagerDuty, Jira, etc.)
                                    │
                                    ▼
                               Dashboard
                          (Next.js pipeline UI)
```

## Key Components

| Component | Role |
|-----------|------|
| **OTel Collector** | OTLP gRPC (:4317) and HTTP (:4318) receiver. Batches logs, enriches with tenant ID, writes to Kafka. |
| **Kafka** | Durable event bus (Strimzi KRaft). Raw logs topic for ingestion, enriched logs topic for processed data. |
| **Bridge** | OTLP ETL translator, anomaly detection, trace correlation, OpenSearch indexer, incident lifecycle engine. |
| **OpenSearch** | Full-text search, log analytics, and visualization. |
| **Ticketing Agent** | AI SRE agent. Creates deduplicated, trace-correlated incident tickets across 6 platforms. |
| **ML Engine** | Feast Feature Store + KServe/TorchServe for model inference. |
| **Airflow** | ML pipeline orchestration and model retraining DAGs. |
| **Dashboard** | Next.js web UI for log ingestion, incident management, anomaly visualization, and system config. |

## Quick Start

```bash
git clone https://github.com/logclaw/logclaw.git && cd logclaw
./scripts/setup-dev.sh
```

This creates a Kind cluster, installs all operators and services, and runs a smoke test.
Takes ~20 minutes on a 16 GB laptop.

## Next Steps

<CardGroup cols={2}>
  <Card title="Architecture" icon="sitemap" href="/architecture">
    Understand the deployment model and data flow.
  </Card>
  <Card title="Tenant Onboarding" icon="rocket" href="/onboarding">
    Provision a new tenant from zero to fully operational.
  </Card>
  <Card title="OTLP Integration" icon="plug" href="/otlp-integration">
    Send logs from any language or framework via OTLP.
  </Card>
  <Card title="Values Reference" icon="sliders" href="/values-reference">
    Full configuration reference for all Helm values.
  </Card>
</CardGroup>
