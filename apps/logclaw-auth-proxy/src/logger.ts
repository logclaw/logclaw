import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { LoggerProvider, BatchLogRecordProcessor, ConsoleLogRecordExporter } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const tenantId = process.env.TENANT_ID || "unknown";
const serviceName = process.env.OTEL_SERVICE_NAME || "logclaw-auth-proxy";

const resource = new Resource({
  [SEMRESATTRS_SERVICE_NAME]: serviceName,
  "tenant.id": tenantId,
});

const provider = new LoggerProvider({ resource });

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (otlpEndpoint) {
  provider.addLogRecordProcessor(
    new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${otlpEndpoint}/v1/logs` }))
  );
}
// Always emit to stdout (K8s log driver fallback)
provider.addLogRecordProcessor(new BatchLogRecordProcessor(new ConsoleLogRecordExporter()));

logs.setGlobalLoggerProvider(provider);
const _logger = logs.getLogger(serviceName);

function emit(severityNumber: SeverityNumber, severityText: string, message: string, attrs?: Record<string, unknown>) {
  _logger.emit({
    severityNumber,
    severityText,
    body: message,
    attributes: { "tenant.id": tenantId, ...attrs },
  });
}

export const logger = {
  info: (msg: string, attrs?: Record<string, unknown>) => emit(SeverityNumber.INFO, "INFO", msg, attrs),
  warn: (msg: string, attrs?: Record<string, unknown>) => emit(SeverityNumber.WARN, "WARN", msg, attrs),
  error: (msg: string, attrs?: Record<string, unknown>) => emit(SeverityNumber.ERROR, "ERROR", msg, attrs),
};

export function shutdownLogger(): Promise<void> {
  return provider.shutdown();
}
