---
title: API Reference
description: Dashboard proxy API endpoints for LogClaw services.
---

# API Reference

The LogClaw dashboard exposes proxy API routes that forward requests to backend services.
All endpoints are accessible via the dashboard's Next.js server.

## Ingestion

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/otel/v1/logs` | Ingest logs via OTLP HTTP/JSON. Proxied to the OTel Collector on port 4318. |

## OpenSearch

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/opensearch/_cat/indices` | List all OpenSearch indices. |
| `POST` | `/api/opensearch/<index>/_search` | Search logs in a specific index. |

## Ticketing Agent

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/ticketing/api/incidents` | List all incidents. |
| `POST` | `/api/ticketing/api/incidents/:id/:action` | Transition an incident (acknowledge, resolve, escalate). |
| `GET` | `/api/ticketing/api/v1/config` | Get the full runtime configuration. |
| `PATCH` | `/api/ticketing/api/v1/config/platforms` | Update ticketing platform settings (PagerDuty, Jira, etc.). |
| `PATCH` | `/api/ticketing/api/v1/config/routing` | Update per-severity routing rules. |
| `PATCH` | `/api/ticketing/api/v1/config/anomaly` | Update anomaly detection thresholds. |
| `PATCH` | `/api/ticketing/api/v1/config/llm` | Update LLM provider configuration. |
| `POST` | `/api/ticketing/api/v1/test-connection` | Test connectivity to a ticketing platform. |
| `POST` | `/api/ticketing/api/v1/test-llm` | Test connectivity to the LLM provider. |

## Bridge

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/bridge/health` | Bridge service health check. |
| `GET` | `/api/bridge/metrics` | Prometheus-format metrics. |
| `GET` | `/api/bridge/config` | Current Bridge runtime configuration. |
| `PATCH` | `/api/bridge/config` | Update Bridge runtime configuration. |

## ML Engine (Feast)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/feast/health` | Feast feature server health check. |

## Airflow

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/airflow/health` | Airflow scheduler and webserver health. |

## Infrastructure Agent

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agent/health` | Agent liveness check. |
| `GET` | `/api/agent/ready` | Agent readiness check. |
| `GET` | `/api/agent/metrics` | Infrastructure metrics (CPU, memory, disk). |

## Authentication

All dashboard API routes are currently unauthenticated proxies intended for internal cluster use.
Access control is enforced at the Kubernetes NetworkPolicy level — only pods within the tenant
namespace can reach the backend services.

For external access, deploy an ingress controller with authentication (OIDC, mTLS) in front of
the dashboard service.
