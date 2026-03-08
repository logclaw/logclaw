import express, { Request, Response, NextFunction } from "express";
import { Pool } from "pg";
import { validateApiKey, ValidatedKey } from "./auth.js";
import {
  injectTenantIdIntoOtlp,
  stripTenantIdFromBody,
  stripTenantIdFromQuery,
  getTenantIdHeader,
} from "./tenant-enforcer.js";
import { forwardToOtelCollectorHttp, forwardToConsoleApi, routeToBackend } from "./forwarding.js";

const app = express();
const dbPool = new Pool({
  connectionString: process.env.DB_URL || "postgresql://localhost/logclaw",
  max: 10,
});

// Middleware: Parse JSON
app.use(express.json({ limit: "50mb" }));
app.use(express.raw({ type: "application/x-protobuf", limit: "50mb" }));

// Middleware: API Key validation
app.use(async (req: Request, res: Response, next: NextFunction) => {
  // Skip auth for health endpoint
  if (req.path === "/health") {
    return next();
  }

  const apiKey = req.headers["x-logclaw-api-key"] as string;
  if (!apiKey) {
    return res.status(401).json({ error: "Missing x-logclaw-api-key header" });
  }

  const validated = await validateApiKey(apiKey, dbPool);
  if (!validated) {
    return res.status(401).json({ error: "Invalid or revoked API key" });
  }

  // Attach validated key info to request
  (req as any).validatedKey = validated;
  next();
});

// Middleware: Log requests
app.use((req: Request, res: Response, next: NextFunction) => {
  const validated = (req as any).validatedKey;
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - tenant: ${validated?.tenantId || "none"}`);
  next();
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// OTLP ingestion endpoint
app.post("/v1/logs", async (req: Request, res: Response) => {
  const validated = (req as any).validatedKey as ValidatedKey;

  try {
    // Inject tenant_id into OTLP payload
    const body = req.body as any;
    const enrichedBody = injectTenantIdIntoOtlp(body, validated.tenantId);

    // Forward to OTel Collector
    const response = await forwardToOtelCollectorHttp("/v1/logs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-logclaw-tenant-id": validated.tenantId,
      },
      body: enrichedBody,
      timeout: 120000,
    });

    const responseBody = await response.text();
    res.status(response.status).set(response.headers).send(responseBody);
  } catch (error: any) {
    console.error("Error forwarding to OTel Collector:", error);
    res.status(502).json({ error: "Failed to forward request to OTel Collector" });
  }
});

// API endpoints (queries, reads, admin)
app.all(/^\/api\//, async (req: Request, res: Response) => {
  const validated = (req as any).validatedKey as ValidatedKey;

  try {
    // Strip any tenant_id from query params
    const cleanQuery = stripTenantIdFromQuery(req.query as Record<string, any>);

    // Strip any tenant_id from body
    let cleanBody = req.body;
    if (typeof req.body === "object" && req.body !== null) {
      cleanBody = stripTenantIdFromBody(req.body);
    }

    // Prepare path with clean query params
    let path = req.path;
    const queryString = new URLSearchParams(cleanQuery as Record<string, string>).toString();
    if (queryString) {
      path += `?${queryString}`;
    }

    // Forward to Console API with tenant ID header
    const response = await forwardToConsoleApi(path, {
      method: req.method,
      headers: {
        ...Object.fromEntries(
          Object.entries(req.headers).filter(([k]) => !["host", "content-length"].includes(k))
        ),
        "content-type": "application/json",
        ...getTenantIdHeader(validated.tenantId),
      },
      body: cleanBody,
      timeout: 30000,
    });

    const responseBody = await response.text();
    res.status(response.status).set(response.headers).send(responseBody);
  } catch (error: any) {
    console.error("Error forwarding to Console API:", error);
    res.status(502).json({ error: "Failed to forward request to Console API" });
  }
});

// Error handling
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
const PORT = parseInt(process.env.PORT || "4318");
const GRPC_PORT = parseInt(process.env.GRPC_PORT || "4317");

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Auth Proxy] Listening on HTTP port ${PORT}`);
  console.log(`[Auth Proxy] Forwarding to OTel Collector: ${process.env.OTEL_COLLECTOR_HTTP_ENDPOINT}`);
  console.log(`[Auth Proxy] Forwarding to Console API: ${process.env.CONSOLE_API_ENDPOINT}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[Auth Proxy] Received SIGTERM, shutting down gracefully...");
  await dbPool.end();
  process.exit(0);
});

export default app;
