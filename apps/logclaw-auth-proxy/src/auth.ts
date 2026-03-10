import { createHash } from "crypto";
import { Pool } from "pg";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

export interface ValidatedKey {
  projectId: string;
  tenantId: string;
  orgId: string;
  keyPrefix: string;
}

// Valid key cache: hash → {data, expiresAt}
// Invalid key cache: hash → expiresAt (negative cache — avoids DB hit on bad keys)
const VALID_TTL_MS  = parseInt(process.env.API_KEY_CACHE_TTL_VALID  || "3600") * 1000; // 1 hour
const INVALID_TTL_MS = parseInt(process.env.API_KEY_CACHE_TTL_INVALID || "30")   * 1000; // 30 seconds

interface CacheEntry { data: ValidatedKey; expiresAt: number }
const validCache   = new Map<string, CacheEntry>();
const invalidCache = new Map<string, number>(); // hash → expiresAt

// Evict expired entries every 10 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of validCache)   { if (e.expiresAt <= now) validCache.delete(k); }
  for (const [k, t] of invalidCache) { if (t <= now)           invalidCache.delete(k); }
}, 10 * 60 * 1000).unref();

const logger = () => logs.getLogger("logclaw-auth-proxy");

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function validateApiKey(
  key: string,
  dbPool: Pool
): Promise<ValidatedKey | null> {
  const hash = hashApiKey(key);
  const now = Date.now();

  // Valid cache hit
  const valid = validCache.get(hash);
  if (valid && valid.expiresAt > now) return valid.data;

  // Negative cache hit — known-bad key, skip DB
  const invalidExp = invalidCache.get(hash);
  if (invalidExp && invalidExp > now) return null;

  try {
    const result = await dbPool.query(
      `SELECT
        ak.id, ak.key_prefix,
        p.id as project_id, p.tenant_id, p.org_id
      FROM api_keys ak
      JOIN projects p ON ak.project_id = p.id
      WHERE ak.key_hash = $1 AND ak.revoked = false
      LIMIT 1`,
      [hash]
    );

    if (result.rows.length === 0) {
      invalidCache.set(hash, now + INVALID_TTL_MS);
      return null;
    }

    const row = result.rows[0];
    const data: ValidatedKey = {
      projectId: row.project_id,
      tenantId: row.tenant_id,
      orgId: row.org_id,
      keyPrefix: row.key_prefix,
    };

    validCache.set(hash, { data, expiresAt: now + VALID_TTL_MS });

    // Fire-and-forget: update lastUsed
    dbPool
      .query(`UPDATE api_keys SET last_used = NOW() WHERE key_hash = $1`, [hash])
      .catch((err: unknown) => {
        logger().emit({
          severityNumber: SeverityNumber.WARN,
          severityText: "WARN",
          body: "Failed to update api_key last_used",
          attributes: { error: String(err) },
        });
      });

    return data;
  } catch (error) {
    logger().emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: "Database error during API key validation",
      attributes: { error: String(error) },
    });
    return null;
  }
}

export function clearKeyCache(): void {
  validCache.clear();
  invalidCache.clear();
}
