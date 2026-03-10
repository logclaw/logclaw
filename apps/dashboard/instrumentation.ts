// Next.js auto-loads this file and calls register() on server startup.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    const { logs, SeverityNumber } = await import("@opentelemetry/api-logs");
    const {
      LoggerProvider,
      BatchLogRecordProcessor,
      ConsoleLogRecordExporter,
    } = await import("@opentelemetry/sdk-logs");
    const { OTLPLogExporter } = await import(
      "@opentelemetry/exporter-logs-otlp-http"
    );
    const { Resource } = await import("@opentelemetry/resources");

    const tenantId = process.env.TENANT_ID || "unknown";
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    const resource = new Resource({
      "service.name":
        process.env.OTEL_SERVICE_NAME || "logclaw-dashboard",
      "tenant.id": tenantId,
    });

    const loggerProvider = new LoggerProvider({ resource });

    if (otlpEndpoint) {
      loggerProvider.addLogRecordProcessor(
        new BatchLogRecordProcessor(
          new OTLPLogExporter({ url: `${otlpEndpoint}/v1/logs` }),
        ),
      );
    }
    // Always emit to stdout (K8s log driver fallback)
    loggerProvider.addLogRecordProcessor(
      new BatchLogRecordProcessor(new ConsoleLogRecordExporter()),
    );

    logs.setGlobalLoggerProvider(loggerProvider);

    const sdk = new NodeSDK({ resource });
    sdk.start();

    process.on("SIGTERM", () => {
      sdk
        .shutdown()
        .finally(() => loggerProvider.shutdown())
        .catch(console.error);
    });
  }
}
