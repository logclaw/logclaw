---
title: API Reference
description: Complete API documentation for all LogClaw services with interactive playground.
---

# API Reference

LogClaw exposes APIs through three access patterns:

1. **LogClaw Cloud (otel.logclaw.ai)** — all endpoints are authenticated via `x-logclaw-api-key` header and routed through the Auth Proxy. Use this for LogClaw Cloud deployments. Every endpoint in this reference includes an interactive playground — paste your API key and send requests directly from the docs.

2. **Dashboard Proxy** — the Next.js Dashboard proxies requests to backend services under `/api/<service>/`. Use this for browser-based access in self-hosted deployments.

3. **Direct Service Access** — each backend service exposes its own API on its Kubernetes ClusterIP service. Use this for programmatic access from within the cluster.

## Authentication

<Note>
**LogClaw Cloud** requires an API key for all API requests. Include the `x-logclaw-api-key` header with every request:

```bash
curl -H "x-logclaw-api-key: lc_proj_your_key_here" \
  https://otel.logclaw.ai/api/agent/health
```

Generate keys from your project dashboard at [console.logclaw.ai](https://console.logclaw.ai) under **Settings → API Keys**. See [API Keys](/api-keys) for details.

**Self-hosted** deployments do not require API keys — access is controlled at the Kubernetes NetworkPolicy level.
</Note>

The Auth Proxy automatically injects the correct `tenant_id` into all requests based on your API key's project. You never need to specify a tenant ID manually.

## Try It Live

Every endpoint page includes an interactive **API Playground** on the right side. Enter your `x-logclaw-api-key` and send real requests to `otel.logclaw.ai` directly from the docs.

## Service Endpoints

| Service | Cloud (otel.logclaw.ai) | Dashboard Proxy | Direct (in-cluster) | Port |
|---------|------------------------|----------------|---------------------|------|
| [Ingestion](/api-reference/endpoints/send-logs) | `POST /v1/logs` | `/api/otel/v1/logs` | `logclaw-otel-collector:4318` | 4317 (gRPC), 4318 (HTTP) |
| [API Keys](/api-reference/endpoints/list-api-keys) | `/api/admin/api-keys` | `/api/admin/api-keys` | Dashboard internal | — |
| [Bridge](/api-reference/endpoints/bridge-health) | `/api/bridge/*` | `/api/bridge/*` | `logclaw-bridge:8080` | 8080 |
| [OpenSearch](/api-reference/endpoints/list-indices) | `/api/opensearch/*` | `/api/opensearch/*` | `logclaw-opensearch:9200` | 9200 |
| [Ticketing](/api-reference/endpoints/list-incidents) | `/api/ticketing/*` | `/api/ticketing/*` | `logclaw-ticketing-agent:18081` | 18081 |
| [Infrastructure](/api-reference/endpoints/agent-health) | `/api/agent/*` | `/api/agent/*` | `logclaw-agent:8080` | 8080 |
| Airflow | `/api/airflow/*` | `/api/airflow/*` | `logclaw-airflow-webserver:8080` | 8080 |
| Feast | `/api/feast/*` | `/api/feast/*` | `logclaw-feast:6567` | 6567 |

## All Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | [`/v1/logs`](/api-reference/endpoints/send-logs) | Ingest logs (OTLP/HTTP) |
| `GET` | [`/api/admin/api-keys`](/api-reference/endpoints/list-api-keys) | List API keys |
| `POST` | [`/api/admin/api-keys`](/api-reference/endpoints/create-api-key) | Create API key |
| `DELETE` | [`/api/admin/api-keys`](/api-reference/endpoints/revoke-api-key) | Revoke API key |
| `GET` | [`/api/bridge/health`](/api-reference/endpoints/bridge-health) | Bridge health |
| `GET` | [`/api/bridge/config`](/api-reference/endpoints/bridge-config) | Bridge configuration |
| `GET` | [`/api/ticketing/api/incidents`](/api-reference/endpoints/list-incidents) | List incidents |
| `GET` | [`/api/ticketing/api/v1/config`](/api-reference/endpoints/runtime-config) | Runtime configuration |
| `GET` | [`/api/agent/health`](/api-reference/endpoints/agent-health) | Agent liveness |
| `GET` | [`/api/agent/metrics`](/api-reference/endpoints/agent-metrics) | Infrastructure metrics |
| `GET` | [`/api/opensearch/_cat/indices`](/api-reference/endpoints/list-indices) | List indices |

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

### Authentication Errors

```json
{
  "error": "Missing x-logclaw-api-key header"
}
```

### Proxy Errors

When a backend service is unreachable, the Auth Proxy returns:

```json
{
  "error": "Failed to forward request to Console API",
  "status": 502
}
```
