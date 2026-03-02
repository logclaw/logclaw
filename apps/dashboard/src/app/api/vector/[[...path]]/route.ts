import { createProxyHandler } from "@/lib/proxy";
export const { GET, POST, PUT, DELETE, PATCH } = createProxyHandler(
  "VECTOR_ENDPOINT",
  "http://localhost:18080",
);
