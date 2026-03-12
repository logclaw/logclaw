/**
 * KV-backed workspace installation storage.
 * Maps Slack team_id → { botToken, teamName, logclawApiKey }.
 */

export interface Installation {
  botToken: string;
  teamId: string;
  teamName: string;
  logclawApiKey?: string; // linked after OAuth callback
  installedAt: string; // ISO timestamp
}

const KEY_PREFIX = "team:";

export async function getInstallation(
  kv: KVNamespace,
  teamId: string,
): Promise<Installation | null> {
  const data = await kv.get<Installation>(`${KEY_PREFIX}${teamId}`, "json");
  return data;
}

export async function saveInstallation(
  kv: KVNamespace,
  teamId: string,
  installation: Installation,
): Promise<void> {
  await kv.put(`${KEY_PREFIX}${teamId}`, JSON.stringify(installation));
}

export async function linkApiKey(
  kv: KVNamespace,
  teamId: string,
  logclawApiKey: string,
): Promise<boolean> {
  const existing = await getInstallation(kv, teamId);
  if (!existing) return false;

  existing.logclawApiKey = logclawApiKey;
  await saveInstallation(kv, teamId, existing);
  return true;
}

export async function deleteInstallation(
  kv: KVNamespace,
  teamId: string,
): Promise<void> {
  await kv.delete(`${KEY_PREFIX}${teamId}`);
}
