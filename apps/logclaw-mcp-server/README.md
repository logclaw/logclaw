# LogClaw MCP Server

Connect your AI coding tools to [LogClaw](https://logclaw.ai) incidents, logs, and anomalies via the [Model Context Protocol](https://modelcontextprotocol.io).

Works with **Claude Code**, **Cursor**, **Windsurf**, and any MCP-compatible client.

## Quick start

```bash
npx logclaw-mcp-server
```

## Setup

### Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "logclaw": {
      "command": "npx",
      "args": ["-y", "logclaw-mcp-server"],
      "env": {
        "LOGCLAW_ENDPOINT": "https://ticket.logclaw.ai",
        "LOGCLAW_API_KEY": "lc_proj_..."
      }
    }
  }
}
```

### Cursor / Windsurf

Add to `.cursor/mcp.json` or `.windsurf/mcp.json`:

```json
{
  "mcpServers": {
    "logclaw": {
      "command": "npx",
      "args": ["-y", "logclaw-mcp-server"],
      "env": {
        "LOGCLAW_ENDPOINT": "https://ticket.logclaw.ai",
        "LOGCLAW_API_KEY": "lc_proj_..."
      }
    }
  }
}
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LOGCLAW_API_KEY` | Yes | Your LogClaw project API key |
| `LOGCLAW_ENDPOINT` | No | Auth proxy endpoint (default: `https://ticket.logclaw.ai`) |

## Tools

| Tool | Description |
|------|-------------|
| `logclaw_list_incidents` | List and filter incidents by severity, state, service, or search query |
| `logclaw_get_incident` | Get full incident details — root cause, causal chain, evidence logs, traces, timeline, blast radius |
| `logclaw_update_incident` | Transition incident state (acknowledge, investigate, mitigate, resolve) or add a note |
| `logclaw_search_logs` | Search raw logs by service, level, time range, and query |
| `logclaw_get_anomalies` | Get recent anomaly detections (Z-score analysis on error rates) |
| `logclaw_service_health` | Check LogClaw pipeline health status and latency |

## Example prompts

Once connected, you can ask your AI assistant:

- "What incidents are open right now?"
- "Show me the root cause for TICK-0037"
- "Search for ERROR logs from auth-service in the last 30 minutes"
- "Are there any critical anomalies?"
- "Acknowledge TICK-0042 and add a note that I'm looking into it"

## Self-hosted

If you're running LogClaw on your own infrastructure, point `LOGCLAW_ENDPOINT` to your auth proxy:

```bash
LOGCLAW_ENDPOINT=https://logclaw.internal.company.com LOGCLAW_API_KEY=lc_proj_... npx logclaw-mcp-server
```

## License

MIT
