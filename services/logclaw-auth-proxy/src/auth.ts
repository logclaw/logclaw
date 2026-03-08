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
        ak.id, ak."keyPrefix",
        p.id as "projectId", p."tenantId", p."orgId"
      FROM "apiKeys" ak
      JOIN projects p ON ak."projectId" = p.id
      WHERE ak."keyHash" = $1 AND ak.revoked = false
      LIMIT 1`,
      [hash]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const validatedKey: ValidatedKey = {
      projectId: row.projectId,
      tenantId: row.tenantId,
      orgId: row.orgId,
      keyPrefix: row.keyPrefix,
    };

    // Cache the result
    keyCache.set(hash, { data: validatedKey, timestamp: Date.now() });

    // Fire-and-forget: update lastUsed
    dbPool.query(`UPDATE "apiKeys" SET "lastUsed" = NOW() WHERE "keyHash" = $1`, [hash]).catch((err: unknown) => {
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
