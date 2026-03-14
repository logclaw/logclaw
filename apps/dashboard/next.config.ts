import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@opentelemetry/sdk-node",
    "@opentelemetry/sdk-logs",
    "@opentelemetry/api-logs",
    "@opentelemetry/exporter-logs-otlp-http",
    "@opentelemetry/resources",
  ],
};

export default nextConfig;
