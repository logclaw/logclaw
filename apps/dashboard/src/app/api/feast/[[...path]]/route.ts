import { createProxyHandler } from "@/lib/proxy";
export const { GET, POST, PUT, DELETE, PATCH } = createProxyHandler(
  "FEAST_ENDPOINT",
  "http://localhost:6567",
);
