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

---

## Batch Operations

### Batch Update Incidents

```
POST /api/v1/incidents/batch
```

Perform bulk operations on multiple incidents at once. Supports acknowledge, resolve, and escalate actions.

#### Request Body

```json
{
  "ids": ["inc-20240301-001", "inc-20240301-002", "inc-20240301-003"],
  "action": "acknowledge"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | string[] | Yes | Array of incident IDs to update |
| `action` | string | Yes | One of: `acknowledge`, `resolve`, `escalate` |

#### Response

```json
{
  "updated": 3,
  "action": "acknowledge",
  "ids": ["inc-20240301-001", "inc-20240301-002", "inc-20240301-003"]
}
```

---

## Audit Trail

### Get Incident Audit Log

```
GET /api/v1/audit?incident_id=:id
```

Returns the full state-change audit trail for a specific incident. Every acknowledge, resolve, escalate, and reopen action is logged with a timestamp.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `incident_id` | string | Yes | The incident ID to retrieve the audit trail for |

#### Response

```json
{
  "incident_id": "inc-20240301-001",
  "entries": [
    {
      "action": "created",
      "timestamp": "2024-03-01T15:30:00Z",
      "details": "Incident created from anomaly detection"
    },
    {
      "action": "acknowledged",
      "timestamp": "2024-03-01T15:35:00Z",
      "details": "Status changed from open to acknowledged"
    },
    {
      "action": "escalated",
      "timestamp": "2024-03-01T15:45:00Z",
      "details": "Escalated to pagerduty"
    },
    {
      "action": "resolved",
      "timestamp": "2024-03-01T16:00:00Z",
      "details": "Status changed to resolved"
    }
  ]
}
```

---

## LLM Status

### Get LLM Provider Status

```
GET /api/v1/llm-status
```

Returns the current status and health of the configured LLM provider, including whether it is reachable and the configured model.

#### Response (Healthy)

```json
{
  "status": "ok",
  "provider": "openai",
  "model": "gpt-4",
  "available": true
}
```

#### Response (Degraded / Unreachable)

```json
{
  "status": "degraded",
  "provider": "openai",
  "model": "gpt-4",
  "available": false,
  "error": "Connection timeout after 5s"
}
```

<Note>
When the LLM provider is unreachable, the Ticketing Agent continues to create incidents using rule-based fallback RCA instead of AI-generated root cause analysis. The Dashboard displays a "Fallback" badge on affected incidents.
</Note>

---

## Deduplication

The Ticketing Agent automatically deduplicates incoming anomalies to prevent duplicate incidents. Two anomalies are considered duplicates when they share the same service name, severity level, and occur within the configured lookback window.

When a duplicate is detected:
- No new incident is created
- The existing incident's `updatedAt` timestamp is refreshed
- The anomaly count is incremented on the existing incident

Configure the deduplication window via the anomaly settings endpoint:

```
PATCH /api/v1/config/anomaly
```

```json
{
  "lookbackWindow": "30m"
}
```
