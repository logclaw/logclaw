import { createProxyHandler } from "@/lib/proxy";
export const { GET, POST, PUT, DELETE, PATCH } = createProxyHandler(
  "OPENSEARCH_ENDPOINT",
  "http://localhost:9200",
);
