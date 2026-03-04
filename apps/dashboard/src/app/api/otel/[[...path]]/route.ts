import { createProxyHandler } from "@/lib/proxy";
export const { GET, POST, PUT, DELETE, PATCH } = createProxyHandler(
  "OTEL_COLLECTOR_ENDPOINT",
  "http://localhost:4318",
);
