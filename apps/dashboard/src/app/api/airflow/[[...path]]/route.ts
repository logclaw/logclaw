import { createProxyHandler } from "@/lib/proxy";
export const { GET, POST, PUT, DELETE, PATCH } = createProxyHandler(
  "AIRFLOW_ENDPOINT",
  "http://localhost:28080",
);
