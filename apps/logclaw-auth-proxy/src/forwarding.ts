import fetch, { Response } from "node-fetch";
import { Readable } from "stream";

export interface ForwardOptions {
  method: string;
  headers: Record<string, string>;
  body?: any;
  timeout?: number;
}

/**
 * Forward request to OTel Collector HTTP endpoint
 */
export async function forwardToOtelCollectorHttp(
  path: string,
  options: ForwardOptions
): Promise<Response> {
  const endpoint = process.env.OTEL_COLLECTOR_HTTP_ENDPOINT || "http://logclaw-otel-collector:4318";
  const url = `${endpoint}${path}`;

  const fetchOptions: any = {
    method: options.method,
    headers: options.headers,
    timeout: options.timeout || 120000, // 120s for streaming
  };

  if (options.body) {
    fetchOptions.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, fetchOptions);
    return response;
  } catch (error) {
    console.error(`Failed to forward to OTel Collector: ${url}`, error);
    throw error;
  }
}

/**
 * Forward request to Console API endpoint
 */
export async function forwardToConsoleApi(
  path: string,
  options: ForwardOptions
): Promise<Response> {
  const endpoint = process.env.CONSOLE_API_ENDPOINT || "http://logclaw-enterprise:3000";
  const url = `${endpoint}${path}`;

  const fetchOptions: any = {
    method: options.method,
    headers: options.headers,
    timeout: options.timeout || 30000,
  };

  if (options.body) {
    fetchOptions.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, fetchOptions);
    return response;
  } catch (error) {
    console.error(`Failed to forward to Console API: ${url}`, error);
    throw error;
  }
}

/**
 * Forward request to Ticketing Agent endpoint
 */
export async function forwardToTicketingAgent(
  path: string,
  options: ForwardOptions
): Promise<Response> {
  const endpoint = process.env.TICKETING_AGENT_ENDPOINT || "http://logclaw-ticketing-agent:8080";
  const url = `${endpoint}${path}`;

  const fetchOptions: any = {
    method: options.method,
    headers: options.headers,
    timeout: options.timeout || 30000,
  };

  if (options.body) {
    fetchOptions.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, fetchOptions);
    return response;
  } catch (error) {
    console.error(`Failed to forward to Ticketing Agent: ${url}`, error);
    throw error;
  }
}

/**
 * Determine which backend to use based on path
 */
export function routeToBackend(path: string): "otel" | "console" | "ticketing" {
  if (path.startsWith("/v1/logs")) {
    return "otel";
  }
  if (path.startsWith("/ticketing/")) {
    return "ticketing";
  }
  if (path.startsWith("/api/")) {
    return "console";
  }
  // Default to console for unknown paths
  return "console";
}
