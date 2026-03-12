/**
 * Routes an OpenAI tool_call to the correct LogClaw API function.
 */
import { createClient } from "./client.ts";
import {
  listIncidents,
  getIncident,
  updateIncident,
  forwardIncident,
  bulkUpdateIncidents,
} from "./tools/incidents.ts";
import { searchLogs, getAnomalies } from "./tools/logs.ts";
import { serviceHealth } from "./tools/health.ts";

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  apiKey: string,
  endpoint?: string,
): Promise<unknown> {
  const { logclawFetch } = createClient(apiKey, endpoint);

  switch (name) {
    case "list_incidents":
      return await listIncidents(logclawFetch, args);
    case "get_incident":
      return await getIncident(logclawFetch, args);
    case "update_incident":
      return await updateIncident(logclawFetch, args);
    case "forward_incident":
      return await forwardIncident(logclawFetch, args);
    case "search_logs":
      return await searchLogs(logclawFetch, args);
    case "get_anomalies":
      return await getAnomalies(logclawFetch, args);
    case "service_health":
      return await serviceHealth(logclawFetch);
    case "bulk_update":
      return await bulkUpdateIncidents(logclawFetch, args);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
