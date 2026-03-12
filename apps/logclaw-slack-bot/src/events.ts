/**
 * Slack Events API handler.
 *
 * Receives app_mention events, verifies the Slack signature,
 * ACKs immediately (<3s), then processes the mention async
 * via ctx.waitUntil().
 */
import { Hono } from "hono";
import { getInstallation, deleteInstallation } from "./installations.js";
import { getHistory, saveHistory } from "./conversations.js";
import { postMessage, updateMessage, publishHome } from "./slack-api.js";
import { runAgentLoop, type AgentResult } from "./lib/agent.js";
import { buildBlocks } from "./formatters.js";

export const eventsApp = new Hono<{ Bindings: Env }>();

// ── Slack signature verification ─────────────────────────────────

async function verifySlackSignature(
  signingSecret: string,
  signature: string | null,
  timestamp: string | null,
  rawBody: string,
): Promise<boolean> {
  if (!signature || !timestamp) return false;

  // Reject if timestamp is more than 5 minutes old (replay attack protection)
  const ts = Number(timestamp);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sigBaseString));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return signature === `v0=${hex}`;
}

// ── Strip @mention prefix ────────────────────────────────────────

function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();
}

// ── POST /events — Slack Events API webhook ──────────────────────

eventsApp.post("/events", async (c) => {
  const rawBody = await c.req.text();
  const body = JSON.parse(rawBody);

  // 1. URL verification challenge (one-time Slack setup)
  if (body.type === "url_verification") {
    return c.json({ challenge: body.challenge });
  }

  // 2. Verify Slack signature
  const sig = c.req.header("x-slack-signature");
  const ts = c.req.header("x-slack-request-timestamp");
  const valid = await verifySlackSignature(c.env.SLACK_SIGNING_SECRET, sig, ts, rawBody);
  if (!valid) {
    return c.text("Invalid signature", 401);
  }

  // 3. Deduplication — skip if we've already processed this event
  const eventId = body.event_id as string | undefined;
  if (eventId) {
    const seen = await c.env.CONVERSATIONS.get(`dedup:${eventId}`);
    if (seen) {
      return c.text("", 200); // Already processed
    }
    // Mark as seen with 5-minute TTL
    await c.env.CONVERSATIONS.put(`dedup:${eventId}`, "1", { expirationTtl: 300 });
  }

  // 4. ACK immediately — Slack requires <3 second response
  const event = body.event;

  if (event?.type === "app_mention") {
    c.executionCtx.waitUntil(
      handleMention(c.env, event).catch((err) => {
        console.error("handleMention error:", err);
      }),
    );
  } else if (event?.type === "message" && event?.channel_type === "im" && !event?.bot_id && !event?.subtype) {
    // DM to the bot — treat like a mention (no @mention prefix needed)
    c.executionCtx.waitUntil(
      handleMention(c.env, { ...event, team: body.team_id }).catch((err) => {
        console.error("handleDM error:", err);
      }),
    );
  } else if (event?.type === "app_home_opened") {
    const teamId = body.team_id as string;
    c.executionCtx.waitUntil(
      handleAppHome(c.env, event, teamId).catch((err) => {
        console.error("handleAppHome error:", err);
      }),
    );
  } else if (event?.type === "app_uninstalled" || body.type === "event_callback" && event?.type === "app_uninstalled") {
    // Clean up installation data when app is removed
    const teamId = body.team_id as string;
    if (teamId) {
      c.executionCtx.waitUntil(
        deleteInstallation(c.env.SLACK_INSTALLATIONS, teamId).catch((err) => {
          console.error("deleteInstallation error:", err);
        }),
      );
    }
  } else if (event?.type === "tokens_revoked") {
    // Handle token revocations — clean up affected installations
    const teamId = body.team_id as string;
    if (teamId) {
      c.executionCtx.waitUntil(
        deleteInstallation(c.env.SLACK_INSTALLATIONS, teamId).catch((err) => {
          console.error("deleteInstallation (tokens_revoked) error:", err);
        }),
      );
    }
  }

  return c.text("", 200);
});

// ── App Home handler ─────────────────────────────────────────────

interface AppHomeEvent {
  type: string;
  user: string;
  tab: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  view?: any;
}

async function handleAppHome(env: Env, event: AppHomeEvent, teamId: string): Promise<void> {
  if (event.tab !== "home") return;
  if (!teamId) return;

  const installation = await getInstallation(env.SLACK_INSTALLATIONS, teamId);
  if (!installation) return;

  await publishHome(
    installation.botToken,
    event.user,
    !!installation.logclawApiKey,
  );
}

// ── Async mention handler ────────────────────────────────────────

interface SlackEvent {
  type: string;
  text: string;
  user: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  team: string;
}

async function handleMention(env: Env, event: SlackEvent): Promise<void> {
  const { text, user, channel, ts, thread_ts, team } = event;
  const threadTs = thread_ts || ts; // thread root or the message itself

  // 1. Look up workspace installation
  const installation = await getInstallation(env.SLACK_INSTALLATIONS, team);
  if (!installation) {
    console.error(`No installation found for team ${team}`);
    return;
  }

  if (!installation.logclawApiKey) {
    // Workspace installed but API key not linked yet
    await postMessage(
      installation.botToken,
      channel,
      `:warning: LogClaw is installed but not connected to a project yet.\n` +
        `Please visit <https://slack.logclaw.ai/oauth/install|Setup LogClaw> to link your API key.`,
      threadTs,
    );
    return;
  }

  // 2. Post "thinking" placeholder
  const thinking = await postMessage(
    installation.botToken,
    channel,
    `:hourglass_flowing_sand: <@${user}> Analyzing your request...`,
    threadTs,
  );

  // 3. Load conversation history for follow-up context
  const history = await getHistory(env.CONVERSATIONS, channel, threadTs);

  // 4. Run AI agent loop
  const cleanText = stripMention(text);
  let agentResult: AgentResult;
  try {
    agentResult = await runAgentLoop(
      cleanText,
      env.OPENAI_API_KEY,
      installation.logclawApiKey,
      history,
    );
  } catch (e: unknown) {
    console.error("Agent loop error:", e);
    agentResult = {
      text: ":warning: Something went wrong while processing your request. Please try again.",
      toolResults: [],
    };
  }

  // 5. Build Block Kit blocks from tool results
  const blocks = buildBlocks(agentResult.toolResults);
  const richBlocks = blocks.length > 0 ? blocks : undefined;

  // 6. Update thinking message with the real response + rich blocks
  if (thinking.ts) {
    await updateMessage(installation.botToken, channel, thinking.ts, agentResult.text, richBlocks);
  } else {
    // Fallback: post a new message if the update fails
    await postMessage(installation.botToken, channel, agentResult.text, threadTs, richBlocks);
  }

  // 7. Save conversation turn for follow-up context (text only, not blocks)
  await saveHistory(env.CONVERSATIONS, channel, threadTs, history, cleanText, agentResult.text);
}
