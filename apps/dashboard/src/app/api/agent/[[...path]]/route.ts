import { createProxyHandler } from "@/lib/proxy";
export const { GET, POST, PUT, DELETE, PATCH } = createProxyHandler(
  "AGENT_ENDPOINT",
  "http://localhost:8084",
);
