import { createHash } from "crypto";
import { Pool } from "pg";

export interface ValidatedKey {
  projectId: string;
  tenantId: string;
  orgId: string;
  keyPrefix: string;
}

// Key cache: maps SHA256 hash → {validatedKey, timestamp}
const keyCache = new Map<string, { data: ValidatedKey; timestamp: number }>();
const CACHE_TTL_MS = (process.env.API_KEY_CACHE_TTL || "3600") ? parseInt(process.env.API_KEY_CACHE_TTL || "3600") * 1000 : 3600000;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export async function validateApiKey(
  key: string,
  dbPool: Pool
): Promise<ValidatedKey | null> {
  const hash = hashApiKey(key);

  // Check cache first
  const cached = keyCache.get(hash);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

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
      return null;
    }

    const row = result.rows[0];
    const validatedKey: ValidatedKey = {
      projectId: row.project_id,
      tenantId: row.tenant_id,
      orgId: row.org_id,
      keyPrefix: row.key_prefix,
    };

    // Cache the result
    keyCache.set(hash, { data: validatedKey, timestamp: Date.now() });

    // Fire-and-forget: update lastUsed
    dbPool.query(`UPDATE api_keys SET last_used = NOW() WHERE key_hash = $1`, [hash]).catch((err: unknown) => {
      console.error("Failed to update lastUsed:", err);
    });

    return validatedKey;
  } catch (error) {
    console.error("Database error during key validation:", error);
    return null;
  }
}

export function clearKeyCache(): void {
  keyCache.clear();
}
