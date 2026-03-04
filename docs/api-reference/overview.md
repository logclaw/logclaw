---
title: API Reference
description: Complete API documentation for all LogClaw services.
---

# API Reference

LogClaw exposes APIs through two access patterns:

1. **Dashboard Proxy** — the Next.js Dashboard proxies requests to backend services under `/api/<service>/`. Use this for browser-based access and when the Dashboard is your entry point.

2. **Direct Service Access** — each backend service exposes its own API on its Kubernetes ClusterIP service. Use this for programmatic access from within the cluster.

## Service Endpoints

| Service | Dashboard Proxy | Direct (in-cluster) | Port |
|---------|----------------|---------------------|------|
| [OTel Collector](/api-reference/ingestion) | `/api/otel/*` | `logclaw-otel-collector:4318` | 4317 (gRPC), 4318 (HTTP) |
| [Bridge](/api-reference/bridge) | `/api/bridge/*` | `logclaw-bridge:8080` | 8080 |
| [OpenSearch](/api-reference/opensearch) | `/api/opensearch/*` | `logclaw-opensearch:9200` | 9200 |
| [Ticketing Agent](/api-reference/ticketing) | `/api/ticketing/*` | `logclaw-ticketing-agent:18081` | 18081 |
| [Infrastructure Agent](/api-reference/agent) | `/api/agent/*` | `logclaw-agent:8080` | 8080 |
| Airflow | `/api/airflow/*` | `logclaw-airflow-webserver:8080` | 8080 |
| Feast | `/api/feast/*` | `logclaw-feast:6567` | 6567 |

## Authentication

All Dashboard API routes are unauthenticated proxies intended for **internal cluster use**. Access control is enforced at the Kubernetes NetworkPolicy level — only pods within the tenant namespace can reach backend services.

For external access, deploy an ingress controller with authentication (OIDC, mTLS) in front of the Dashboard service.

<Note>
OpenSearch requests through the Dashboard proxy include Basic Auth headers automatically when `OPENSEARCH_USER` and `OPENSEARCH_PASSWORD` environment variables are set.
</Note>

## Common Response Formats

### Health Checks

All services implement a standard health check:

```json
{
  "status": "ok"
}
```

### Error Responses

```json
{
  "error": "description of the error",
  "status": 500
}
```

### Proxy Errors

When a backend service is unreachable, the Dashboard returns:

```json
{
  "error": "Service unavailable",
  "status": 502
}
```
