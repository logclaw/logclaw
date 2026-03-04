---
title: Ticketing Agent
description: AI SRE agent for automated incident detection, trace correlation, and multi-platform ticket management.
---

# Ticketing Agent

The Ticketing Agent is an **AI SRE agent** that consumes anomalies from the pipeline, correlates them with trace data, and creates deduplicated incident tickets across multiple platforms.

## Supported Platforms

<CardGroup cols={3}>
  <Card title="PagerDuty" icon="bell">
    Severity-based routing with auto-acknowledgment and escalation policies.
  </Card>
  <Card title="Jira" icon="ticket">
    Project/issue type mapping with custom fields and assignment rules.
  </Card>
  <Card title="ServiceNow" icon="clipboard">
    CMDB integration with assignment groups and priority mapping.
  </Card>
  <Card title="OpsGenie" icon="bullhorn">
    Team-based routing with on-call schedules and escalation.
  </Card>
  <Card title="Slack" icon="hashtag">
    Webhook notifications with thread updates for incident progression.
  </Card>
  <Card title="Zammad" icon="inbox">
    Self-hosted ticketing for air-gapped or on-prem deployments.
  </Card>
</CardGroup>

## How It Works

```
Kafka "enriched-logs" (anomaly events)
         │
         ▼
┌─────────────────────────┐
│    Anomaly Consumer     │  Consume anomaly-flagged documents
│    (Kafka consumer)     │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Deduplication Engine  │  Group by service + error pattern
│   (time window + hash)  │  Prevent duplicate tickets
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Trace Correlation     │  Attach request timeline
│   (blast radius)        │  Compute affected services
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   LLM Summarization     │  Generate human-readable
│   (optional)            │  incident summary
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Severity Router       │  Route to platforms based on
│   (per-severity rules)  │  configured routing rules
└────────────┬────────────┘
             │
    ┌────────┼────────┬──────────┐
    ▼        ▼        ▼          ▼
PagerDuty  Jira  ServiceNow   Slack ...
```

## Configuration

### Platform Configuration

Each platform requires specific credentials. These are stored in the cluster's secret store (AWS Secrets Manager, GCP Secret Manager, Vault, or Azure Key Vault) and synced via External Secrets Operator.

<Tabs>
  <Tab title="PagerDuty">
    | Field | Required | Description |
    |-------|----------|-------------|
    | `routingKey` | Yes | PagerDuty Events API v2 routing key |

    ```json
    {
      "pagerduty": {
        "enabled": true,
        "routingKey": "your-routing-key"
      }
    }
    ```
  </Tab>
  <Tab title="Jira">
    | Field | Required | Description |
    |-------|----------|-------------|
    | `baseUrl` | Yes | Jira instance URL (e.g. `https://yourorg.atlassian.net`) |
    | `apiToken` | Yes | Jira API token |
    | `userEmail` | Yes | Jira user email for authentication |
    | `projectKey` | No | Default project key (e.g. `SRE`) |

    ```json
    {
      "jira": {
        "enabled": true,
        "baseUrl": "https://yourorg.atlassian.net",
        "apiToken": "your-api-token",
        "userEmail": "sre@yourorg.com",
        "projectKey": "SRE"
      }
    }
    ```
  </Tab>
  <Tab title="ServiceNow">
    | Field | Required | Description |
    |-------|----------|-------------|
    | `instanceUrl` | Yes | ServiceNow instance URL |
    | `username` | Yes | ServiceNow username |
    | `password` | Yes | ServiceNow password |
    | `instance` | No | Short instance name |

    ```json
    {
      "servicenow": {
        "enabled": true,
        "instanceUrl": "https://yourorg.service-now.com",
        "username": "logclaw-integration",
        "password": "your-password"
      }
    }
    ```
  </Tab>
  <Tab title="OpsGenie">
    | Field | Required | Description |
    |-------|----------|-------------|
    | `apiKey` | Yes | OpsGenie API key |

    ```json
    {
      "opsgenie": {
        "enabled": true,
        "apiKey": "your-opsgenie-api-key"
      }
    }
    ```
  </Tab>
  <Tab title="Slack">
    | Field | Required | Description |
    |-------|----------|-------------|
    | `webhookUrl` | Yes | Slack incoming webhook URL |

    ```json
    {
      "slack": {
        "enabled": true,
        "webhookUrl": "https://hooks.slack.com/services/T.../B.../..."
      }
    }
    ```
  </Tab>
</Tabs>

### Severity Routing

Configure which platforms receive incidents based on severity:

```json
{
  "routing": {
    "critical": ["pagerduty", "slack", "jira"],
    "high": ["jira", "slack"],
    "medium": ["jira"],
    "low": ["slack"]
  }
}
```

### Anomaly Settings

| Parameter | Default | Description |
|-----------|---------|-------------|
| `minimumScore` | `0.85` | Minimum anomaly score to create an incident |
| `lookbackWindow` | `15m` | Time window for anomaly grouping |

```json
{
  "anomaly": {
    "minimumScore": 0.85,
    "lookbackWindow": "15m"
  }
}
```

### LLM Configuration

The agent optionally uses an LLM to generate human-readable incident summaries:

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4",
    "apiKey": "sk-..."
  }
}
```

## Incident Lifecycle

Incidents progress through these states:

```
OPEN → ACKNOWLEDGED → RESOLVED
  │                       ▲
  └── ESCALATED ──────────┘
```

| State | Description |
|-------|-------------|
| `open` | New incident, not yet acknowledged |
| `acknowledged` | Team has seen the incident |
| `resolved` | Issue has been fixed |
| `escalated` | Escalated to a higher-priority platform or team |

### Incident Actions

```bash
# List incidents
GET /api/incidents

# Acknowledge an incident
POST /api/incidents/:id/acknowledge

# Resolve an incident
POST /api/incidents/:id/resolve

# Escalate an incident
POST /api/incidents/:id/escalate
```

## Helm Values

```yaml
logclaw-ticketing-agent:
  config:
    pagerduty:
      enabled: true
    jira:
      enabled: true
      baseUrl: "https://yourorg.atlassian.net"
      projectKey: "SRE"
    servicenow:
      enabled: true
      instance: "yourorg"
    anomaly:
      minimumScore: 0.85
      lookbackWindow: "15m"
```

## Testing Connectivity

Test connectivity to each platform before going live:

```bash
# Test PagerDuty connection
POST /api/ticketing/api/v1/test-connection
{ "platform": "pagerduty" }

# Test LLM connection
POST /api/ticketing/api/v1/test-llm
```
