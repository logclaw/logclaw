import { createProxyHandler } from "@/lib/proxy";
export const { GET, POST, PUT, DELETE, PATCH } = createProxyHandler(
  "OPENSEARCH_ENDPOINT",
  "http://localhost:9200",
  { authEnv: ["OPENSEARCH_USER", "OPENSEARCH_PASSWORD"] },
);
