/**
 * Tenant ID injection and anti-spoofing
 *
 * For OTLP: Strips existing tenant_id from resource attributes and injects correct one
 * For JSON API: Removes tenant_id from body/query params and enforces via header
 */

export interface OtlpResourceLogs {
  resourceLogs?: Array<{
    resource?: {
      attributes?: Array<{
        key: string;
        value: { stringValue?: string; intValue?: string; doubleValue?: number; boolValue?: boolean };
      }>;
    };
    scopeLogs?: Array<any>;
  }>;
}

/**
 * Injects tenant_id into OTLP request body
 * Strips any existing tenant_id to prevent spoofing
 */
export function injectTenantIdIntoOtlp(body: OtlpResourceLogs, tenantId: string): OtlpResourceLogs {
  if (!body.resourceLogs) {
    return body;
  }

  const modified = JSON.parse(JSON.stringify(body)); // Deep copy

  modified.resourceLogs.forEach((rl: any) => {
    if (!rl.resource) {
      rl.resource = { attributes: [] };
    }
    if (!rl.resource.attributes) {
      rl.resource.attributes = [];
    }

    // Strip any existing tenant_id
    rl.resource.attributes = rl.resource.attributes.filter(
      (attr: any) => attr.key !== "tenant_id"
    );

    // Inject correct tenant_id
    rl.resource.attributes.push({
      key: "tenant_id",
      value: { stringValue: tenantId },
    });
  });

  return modified;
}

/**
 * Removes tenant_id from JSON API request body (anti-spoofing)
 */
export function stripTenantIdFromBody(body: any): any {
  if (!body || typeof body !== "object") {
    return body;
  }

  const modified = { ...body };
  delete modified.tenant_id;
  delete modified.tenantId;

  return modified;
}

/**
 * Removes tenant_id from query parameters (anti-spoofing)
 */
export function stripTenantIdFromQuery(query: Record<string, any>): Record<string, any> {
  const modified = { ...query };
  delete modified.tenant_id;
  delete modified.tenantId;
  return modified;
}

/**
 * Extracts tenant_id from validated key
 */
export function getTenantIdHeader(tenantId: string): Record<string, string> {
  return {
    "x-logclaw-tenant-id": tenantId,
    "x-logclaw-tenant-source": "api-key", // marker that tenant_id came from validated key
  };
}
