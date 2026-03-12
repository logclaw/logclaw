import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";
import { runAgentLoop } from "./lib/agent.ts";
import { ConversationStore } from "../datastores/conversation_store.ts";

/**
 * Function definition — declares inputs, outputs, and metadata
 * so the Slack Platform can validate the workflow step.
 */
export const AiAgentFunction = DefineFunction({
  callback_id: "ai_agent_function",
  title: "LogClaw AI Agent",
  description:
    "Runs the AI agent loop — queries incidents, searches logs, takes actions via OpenAI function calling.",
  source_file: "functions/ai_agent_function.ts",
  input_parameters: {
    properties: {
      text: { type: Schema.types.string, description: "The raw @mention message text" },
      user_id: { type: Schema.slack.types.user_id, description: "User who mentioned the bot" },
      channel_id: { type: Schema.slack.types.channel_id, description: "Channel of the mention" },
      message_ts: { type: Schema.types.string, description: "Timestamp of the mention message" },
    },
    required: ["text", "user_id", "channel_id", "message_ts"],
  },
  output_parameters: {
    properties: {},
    required: [],
  },
});

// ── Helpers ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
}

/** Strip the `<@BOT_ID>` mention prefix so the LLM sees clean text. */
function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();
}

/** Build a unique thread key from channel + message timestamp. */
function threadKey(channelId: string, ts: string): string {
  return `${channelId}:${ts}`;
}

const MAX_HISTORY_TURNS = 10; // keep last N user+assistant pairs

// ── Main function handler ───────────────────────────────────────────

export default SlackFunction(AiAgentFunction, async ({ inputs, client, env }) => {
  const { text, channel_id, user_id, message_ts } = inputs;

  // 1. Post a "thinking" placeholder immediately so the user gets feedback
  let thinkingTs: string | undefined;
  try {
    const thinkingRes = await client.chat.postMessage({
      channel: channel_id,
      thread_ts: message_ts,
      text: `:hourglass_flowing_sand: <@${user_id}> Analyzing your request...`,
    });
    thinkingTs = thinkingRes.ts;
  } catch (e) {
    console.error("Failed to post thinking message:", e);
  }

  // 2. Load conversation history from datastore (for follow-up context)
  let history: ChatMessage[] = [];
  const key = threadKey(channel_id, message_ts);
  try {
    const stored = await client.apps.datastore.get({
      datastore: ConversationStore.name,
      id: key,
    });
    if (stored.ok && stored.item?.messages) {
      const parsed = JSON.parse(stored.item.messages);
      if (Array.isArray(parsed)) {
        history = parsed.slice(-MAX_HISTORY_TURNS * 2); // keep bounded
      }
    }
  } catch (e) {
    console.warn("Conversation history load skipped:", e);
  }

  // 3. Run AI agent loop
  const cleanText = stripMention(text);
  let response: string;
  try {
    response = await runAgentLoop(
      cleanText,
      env.OPENAI_API_KEY,
      env.LOGCLAW_API_KEY,
      history,
    );
  } catch (e) {
    console.error("Agent loop error:", e);
    response =
      ":warning: Something went wrong while processing your request. Please try again.";
  }

  // 4. Update the thinking message with the real response (or post new)
  try {
    if (thinkingTs) {
      await client.chat.update({
        channel: channel_id,
        ts: thinkingTs,
        text: response,
      });
    } else {
      await client.chat.postMessage({
        channel: channel_id,
        thread_ts: message_ts,
        text: response,
      });
    }
  } catch (e) {
    console.error("Failed to post response:", e);
    // Last resort — try a fresh message
    try {
      await client.chat.postMessage({
        channel: channel_id,
        thread_ts: message_ts,
        text: response,
      });
    } catch (e2) {
      console.error("All message delivery failed:", e2);
    }
  }

  // 5. Save conversation turn to datastore for follow-up context
  try {
    const updatedHistory: ChatMessage[] = [
      ...history,
      { role: "user", content: cleanText },
      { role: "assistant", content: response },
    ].slice(-MAX_HISTORY_TURNS * 2);

    await client.apps.datastore.put({
      datastore: ConversationStore.name,
      item: {
        thread_id: key,
        messages: JSON.stringify(updatedHistory),
        updated_at: Date.now(),
      },
    });
  } catch (e) {
    console.warn("Conversation history save skipped:", e);
  }

  return { completed: true };
});
