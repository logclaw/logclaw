import { DefineDatastore, Schema } from "deno-slack-sdk/mod.ts";

/**
 * Stores conversation history per Slack thread so the AI agent
 * can handle follow-up questions ("what about that second one?").
 *
 * Key: "C_CHANNEL_ID:TS" (channel + thread root timestamp)
 * messages: JSON-serialised array of { role, content } pairs
 */
export const ConversationStore = DefineDatastore({
  name: "conversations",
  primary_key: "thread_id",
  attributes: {
    thread_id: { type: Schema.types.string },
    messages: { type: Schema.types.string }, // JSON array of {role, content}
    updated_at: { type: Schema.types.number },
  },
});
