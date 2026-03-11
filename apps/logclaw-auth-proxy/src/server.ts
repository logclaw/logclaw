import express, { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { Pool } from "pg";
import { logger, shutdownLogger } from "./logger.js";
import { validateApiKey, ValidatedKey } from "./auth.js";
import {
  injectTenantIdIntoOtlp,
  stripTenantIdFromBody,
  stripTenantIdFromQuery,
  getTenantIdHeader,
} from "./tenant-enforcer.js";
import { forwardToOtelCollectorHttp, forwardToConsoleApi, forwardToTicketingAgent, routeToBackend } from "./forwarding.js";

const app = express();
const dbPool = new Pool({
  connectionString: process.env.DB_URL || "postgresql://localhost/logclaw",
  max: 10,
});

// Middleware: Parse JSON
app.use(express.json({ limit: "50mb" }));
app.use(express.raw({ type: "application/x-protobuf", limit: "50mb" }));

// ── Pre-auth IP rate limiter (DoS protection for unauthenticated floods) ──
// Keyed by IP only. Low limit — legitimate callers always send an API key.
app.use(
  rateLimit({
    windowMs: 60_000,
    max: parseInt(process.env.RATE_LIMIT_UNAUTH_RPM || "200"),
    keyGenerator: (req: Request) => req.ip || "unknown",
    skip: (req: Request) => Boolean(req.headers["x-logclaw-api-key"]),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded" },
  })
);

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

// ── Post-auth per-tenantId rate limiters ──
// OTEL BatchLogRecordProcessor: 512 records/batch, 5s flush → 12 req/min per
// SDK instance. 6000 req/min = DoS threshold only (~500 concurrent pods).
// OTEL SDKs drop batches on 429 — this limit must never fire under normal load.
const tenantKeyExtractor = (req: Request): string =>
  (req as any).validatedKey?.tenantId || req.ip || "unknown";

const ingestLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT_INGESTION_RPM || "6000"),
  keyGenerator: tenantKeyExtractor,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Ingestion rate limit exceeded — retry after 1 minute" },
});

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: parseInt(process.env.RATE_LIMIT_API_RPM || "300"),
  keyGenerator: tenantKeyExtractor,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "API rate limit exceeded — retry after 1 minute" },
});

app.use("/v1/logs", ingestLimiter);
app.use(/^\/api\//, apiLimiter);
app.use(/^\/ticketing\//, apiLimiter);

// Middleware: Log requests
app.use((req: Request, res: Response, next: NextFunction) => {
  const validated = (req as any).validatedKey;
  logger.info("request", { method: req.method, path: req.path, tenantId: validated?.tenantId || "none" });
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
    const fwdHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      // Skip hop-by-hop headers that must not be forwarded
      if (!["connection", "transfer-encoding", "content-length", "keep-alive"].includes(key.toLowerCase())) {
        fwdHeaders[key] = value;
      }
    });
    res.status(response.status).set(fwdHeaders).send(responseBody);
  } catch (error: any) {
    logger.error("Forward to OTel Collector failed", { error: error?.message });
    res.status(502).json({ error: "Failed to forward request to OTel Collector" });
  }
});

// ── Ticketing Agent endpoints (incidents API — auth + tenant isolation) ──
// Ingress rewrites uat-ticket.logclaw.ai/* → /ticketing/* so this route
// catches all ticketing requests. We strip the /ticketing prefix, inject
// the validated tenant_id as a query param, and forward to the agent.
app.all(/^\/ticketing\//, async (req: Request, res: Response) => {
  const validated = (req as any).validatedKey as ValidatedKey;

  try {
    // Strip caller's tenant_id (anti-spoofing)
    const cleanQuery = stripTenantIdFromQuery(req.query as Record<string, any>);

    // Inject validated tenant_id
    cleanQuery.tenant_id = validated.tenantId;

    // Remove /ticketing prefix → forward to ticketing agent
    const backendPath = req.path.replace(/^\/ticketing/, "") || "/";
    const queryString = new URLSearchParams(cleanQuery as Record<string, string>).toString();
    const fullPath = queryString ? `${backendPath}?${queryString}` : backendPath;

    const hasBody = !["GET", "HEAD", "DELETE"].includes(req.method.toUpperCase()) &&
      req.body !== undefined && req.body !== null && Object.keys(req.body).length > 0;

    const response = await forwardToTicketingAgent(fullPath, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        ...getTenantIdHeader(validated.tenantId),
      },
      body: hasBody ? req.body : undefined,
      timeout: 30000,
    });

    const responseBody = await response.text();
    const fwdHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (!["connection", "transfer-encoding", "content-length", "keep-alive"].includes(key.toLowerCase())) {
        fwdHeaders[key] = value;
      }
    });
    res.status(response.status).set(fwdHeaders).send(responseBody);
  } catch (error: any) {
    logger.error("Forward to Ticketing Agent failed", { error: error?.message });
    res.status(502).json({ error: "Failed to forward request to Ticketing Agent" });
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
    const hasBody = !["GET", "HEAD", "DELETE"].includes(req.method.toUpperCase()) &&
      cleanBody !== undefined && cleanBody !== null && Object.keys(cleanBody).length > 0;
    const response = await forwardToConsoleApi(path, {
      method: req.method,
      headers: {
        ...Object.fromEntries(
          Object.entries(req.headers).filter(([k]) => !["host", "content-length"].includes(k))
        ),
        "content-type": "application/json",
        ...getTenantIdHeader(validated.tenantId),
      },
      body: hasBody ? cleanBody : undefined,
      timeout: 30000,
    });

    const responseBody = await response.text();
    const fwdHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (!["connection", "transfer-encoding", "content-length", "keep-alive"].includes(key.toLowerCase())) {
        fwdHeaders[key] = value;
      }
    });
    res.status(response.status).set(fwdHeaders).send(responseBody);
  } catch (error: any) {
    logger.error("Forward to Console API failed", { error: error?.message });
    res.status(502).json({ error: "Failed to forward request to Console API" });
  }
});

// Error handling
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error("Unhandled error", { error: err?.message });
  res.status(500).json({ error: "Internal server error" });
});

// Start server
const PORT = parseInt(process.env.PORT || "4318");
const GRPC_PORT = parseInt(process.env.GRPC_PORT || "4317");

app.listen(PORT, "0.0.0.0", () => {
  logger.info("Auth Proxy started", {
    port: PORT,
    otelCollector: process.env.OTEL_COLLECTOR_HTTP_ENDPOINT,
    consoleApi: process.env.CONSOLE_API_ENDPOINT,
    ticketingAgent: process.env.TICKETING_AGENT_ENDPOINT,
  });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down gracefully");
  await shutdownLogger();
  await dbPool.end();
  process.exit(0);
});

export default app;
