---
title: Ticketing API
description: Incident management and runtime configuration API for the Ticketing Agent.
---

# Ticketing API

The Ticketing Agent provides APIs for incident management, platform configuration, severity routing, and connectivity testing.

**Base URL:** `http://logclaw-ticketing-agent:18081`
**Dashboard proxy:** `/api/ticketing/*`

---

## Incidents

### List Incidents

```
GET /api/incidents
```

Returns all tracked incidents with their current state and metadata.

#### Response

```json
[
  {
    "id": "inc-20240301-001",
    "title": "High error rate on payment-api",
    "severity": "critical",
    "status": "open",
    "service": "payment-api",
    "anomalyScore": 4.2,
    "affectedServices": ["payment-api", "order-engine", "notification-svc"],
    "traceId": "abcdef1234567890",
    "createdAt": "2024-03-01T15:30:00Z",
    "updatedAt": "2024-03-01T15:30:00Z",
    "platforms": ["pagerduty", "jira", "slack"]
  }
]
```

### Acknowledge Incident

```
POST /api/incidents/:id/acknowledge
```

Transition an incident from `open` to `acknowledged`.

#### Response

```json
{
  "id": "inc-20240301-001",
  "status": "acknowledged",
  "acknowledgedAt": "2024-03-01T15:35:00Z"
}
```

### Resolve Incident

```
POST /api/incidents/:id/resolve
```

Transition an incident to `resolved`.

#### Response

```json
{
  "id": "inc-20240301-001",
  "status": "resolved",
  "resolvedAt": "2024-03-01T16:00:00Z"
}
```

### Escalate Incident

```
POST /api/incidents/:id/escalate
```

Escalate an incident to higher-priority platforms.

#### Response

```json
{
  "id": "inc-20240301-001",
  "status": "escalated",
  "escalatedAt": "2024-03-01T15:45:00Z",
  "escalatedTo": ["pagerduty"]
}
```

---

## Runtime Configuration

### Get Full Configuration

```
GET /api/v1/config
```

Returns the complete runtime configuration including all platform settings, routing rules, anomaly thresholds, and LLM configuration.

#### Response

```json
{
  "platforms": {
    "pagerduty": { "enabled": true, "routingKey": "****" },
    "jira": { "enabled": true, "baseUrl": "https://org.atlassian.net" },
    "servicenow": { "enabled": false },
    "opsgenie": { "enabled": false },
    "slack": { "enabled": true, "webhookUrl": "****" }
  },
  "routing": {
    "critical": ["pagerduty", "slack", "jira"],
    "high": ["jira", "slack"],
    "medium": ["jira"],
    "low": ["slack"]
  },
  "anomaly": {
    "minimumScore": 0.85,
    "lookbackWindow": "15m"
  },
  "llm": {
    "provider": "openai",
    "model": "gpt-4"
  }
}
```

<Note>
Sensitive fields (API keys, tokens, passwords) are masked with `****` in the response. Use the PATCH endpoints to update them.
</Note>

### Update Platform Settings

```
PATCH /api/v1/config/platforms
```

Update one or more ticketing platform configurations.

#### Request Body

```json
{
  "pagerduty": {
    "enabled": true,
    "routingKey": "your-pagerduty-routing-key"
  },
  "slack": {
    "enabled": true,
    "webhookUrl": "https://hooks.slack.com/services/T.../B.../..."
  }
}
```

#### Required Fields Per Platform

| Platform | Required Fields |
|----------|----------------|
| PagerDuty | `routingKey` |
| Jira | `baseUrl`, `apiToken`, `userEmail` |
| ServiceNow | `instanceUrl`, `username`, `password` |
| OpsGenie | `apiKey` |
| Slack | `webhookUrl` |

#### Response

```json
{
  "status": "ok",
  "updated": ["pagerduty", "slack"]
}
```

### Update Routing Rules

```
PATCH /api/v1/config/routing
```

Configure which platforms receive incidents for each severity level.

#### Request Body

```json
{
  "critical": ["pagerduty", "slack", "jira"],
  "high": ["jira", "slack"],
  "medium": ["jira"],
  "low": ["slack"]
}
```

#### Response

```json
{
  "status": "ok",
  "routing": {
    "critical": ["pagerduty", "slack", "jira"],
    "high": ["jira", "slack"],
    "medium": ["jira"],
    "low": ["slack"]
  }
}
```

### Update Anomaly Settings

```
PATCH /api/v1/config/anomaly
```

#### Request Body

```json
{
  "minimumScore": 0.9,
  "lookbackWindow": "30m"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `minimumScore` | number | `0.85` | Minimum anomaly score to trigger incident creation |
| `lookbackWindow` | string | `15m` | Time window for anomaly grouping and deduplication |

### Update LLM Settings

```
PATCH /api/v1/config/llm
```

#### Request Body

```json
{
  "provider": "openai",
  "model": "gpt-4",
  "apiKey": "sk-..."
}
```

---

## Connectivity Testing

### Test Platform Connection

```
POST /api/v1/test-connection
```

Verify connectivity to a ticketing platform.

#### Request Body

```json
{
  "platform": "pagerduty"
}
```

#### Success Response

```json
{
  "status": "ok",
  "platform": "pagerduty",
  "message": "Connection successful"
}
```

#### Failure Response

```json
{
  "status": "error",
  "platform": "pagerduty",
  "message": "Invalid routing key"
}
```

### Test LLM Connection

```
POST /api/v1/test-llm
```

Verify connectivity to the configured LLM provider.

#### Success Response

```json
{
  "status": "ok",
  "provider": "openai",
  "model": "gpt-4",
  "message": "LLM connection successful"
}
```
