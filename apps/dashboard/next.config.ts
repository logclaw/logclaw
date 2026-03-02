import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    const target = process.env.API_PROXY_TARGET || "http://localhost:8080";
    return [
      {
        source: "/api/opensearch/:path*",
        destination: `${process.env.OPENSEARCH_ENDPOINT || "http://localhost:9200"}/:path*`,
      },
      {
        source: "/api/vector/:path*",
        destination: `${process.env.VECTOR_ENDPOINT || "http://localhost:18080"}/:path*`,
      },
      {
        source: "/api/ticketing/:path*",
        destination: `${process.env.TICKETING_ENDPOINT || "http://localhost:18081"}/:path*`,
      },
      {
        source: "/api/bridge/:path*",
        destination: `${process.env.BRIDGE_ENDPOINT || "http://localhost:8080"}/:path*`,
      },
      {
        source: "/api/feast/:path*",
        destination: `${process.env.FEAST_ENDPOINT || "http://localhost:6567"}/:path*`,
      },
      {
        source: "/api/airflow/:path*",
        destination: `${process.env.AIRFLOW_ENDPOINT || "http://localhost:28080"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
