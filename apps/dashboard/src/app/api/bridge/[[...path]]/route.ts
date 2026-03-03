import { createProxyHandler } from "@/lib/proxy";
export const { GET, POST, PUT, DELETE, PATCH } = createProxyHandler(
  "BRIDGE_ENDPOINT",
  "http://localhost:8080",
);
