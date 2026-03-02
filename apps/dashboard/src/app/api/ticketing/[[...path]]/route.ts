import { createProxyHandler } from "@/lib/proxy";
export const { GET, POST, PUT, DELETE, PATCH } = createProxyHandler(
  "TICKETING_ENDPOINT",
  "http://localhost:18081",
);
