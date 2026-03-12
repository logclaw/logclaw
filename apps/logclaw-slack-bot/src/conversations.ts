/**
 * KV-backed thread conversation history.
 * Enables multi-turn follow-ups ("what about the second one?").
 */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const KEY_PREFIX = "conv:";
const MAX_TURNS = 10; // keep last N user+assistant pairs
const TTL_SECONDS = 24 * 60 * 60; // 24 hours

function threadKey(channelId: string, threadTs: string): string {
  return `${KEY_PREFIX}${channelId}:${threadTs}`;
}

export async function getHistory(
  kv: KVNamespace,
  channelId: string,
  threadTs: string,
): Promise<ChatMessage[]> {
  try {
    const data = await kv.get<ChatMessage[]>(threadKey(channelId, threadTs), "json");
    if (Array.isArray(data)) {
      return data.slice(-MAX_TURNS * 2);
    }
  } catch {
    // Corrupted data — start fresh
  }
  return [];
}

export async function saveHistory(
  kv: KVNamespace,
  channelId: string,
  threadTs: string,
  history: ChatMessage[],
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  const updated: ChatMessage[] = [
    ...history,
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantMessage },
  ].slice(-MAX_TURNS * 2);

  await kv.put(
    threadKey(channelId, threadTs),
    JSON.stringify(updated),
    { expirationTtl: TTL_SECONDS },
  );
}
