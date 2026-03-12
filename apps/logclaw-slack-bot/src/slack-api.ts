/**
 * Minimal Slack Web API client — no SDK dependency, just fetch.
 */

const SLACK_API = "https://slack.com/api";

interface SlackResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

export async function postMessage(
  token: string,
  channel: string,
  text: string,
  threadTs?: string,
  blocks?: unknown[],
): Promise<SlackResponse> {
  const body: Record<string, unknown> = { channel, text };
  if (threadTs) body.thread_ts = threadTs;
  if (blocks?.length) body.blocks = blocks;

  return slackFetch(token, "chat.postMessage", body);
}

export async function updateMessage(
  token: string,
  channel: string,
  ts: string,
  text: string,
  blocks?: unknown[],
): Promise<SlackResponse> {
  const body: Record<string, unknown> = { channel, ts, text };
  if (blocks?.length) body.blocks = blocks;
  return slackFetch(token, "chat.update", body);
}

export async function publishHome(
  token: string,
  userId: string,
  hasApiKey: boolean,
): Promise<SlackResponse> {
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "🔥 LogClaw", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*AI SRE that watches your logs 24/7*\nQuery incidents, search logs, detect anomalies, and take actions — all from Slack.",
      },
    },
    { type: "divider" },
    ...(hasApiKey
      ? [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "✅ *Connected* — Your workspace is linked to LogClaw.\n\nTry mentioning `@LogClaw` in any channel:",
            },
          },
          {
            type: "rich_text",
            elements: [
              {
                type: "rich_text_preformatted",
                elements: [
                  { type: "text", text: "@LogClaw show me critical incidents\n@LogClaw search logs for 500 errors in the last hour\n@LogClaw what anomalies were detected today?\n@LogClaw acknowledge TICK-0042" },
                ],
              },
            ],
          },
        ]
      : [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "⚠️ *Not connected yet* — Link your LogClaw API key to get started.",
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "🔗 Connect LogClaw", emoji: true },
                url: "https://slack.logclaw.ai/oauth/install",
                style: "primary",
              },
            ],
          },
        ]),
    { type: "divider" },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "📖 <https://logclaw.ai/docs|Documentation> • 💬 <mailto:support@logclaw.ai|Support> • 🌐 <https://logclaw.ai|logclaw.ai>",
        },
      ],
    },
  ];

  return slackFetch(token, "views.publish", {
    user_id: userId,
    view: {
      type: "home",
      blocks,
    },
  });
}

async function slackFetch(
  token: string,
  method: string,
  body: Record<string, unknown>,
  retries = 1,
): Promise<SlackResponse> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  // Handle rate limiting with retry-after
  if (res.status === 429 && retries > 0) {
    const retryAfter = Number(res.headers.get("retry-after") || "2");
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return slackFetch(token, method, body, retries - 1);
  }

  if (!res.ok) {
    throw new Error(`Slack API ${method} HTTP ${res.status}`);
  }

  const data = (await res.json()) as SlackResponse;
  if (!data.ok) {
    // token_revoked / account_inactive → installation is stale
    if (data.error === "token_revoked" || data.error === "account_inactive" || data.error === "invalid_auth") {
      console.error(`Slack API ${method}: auth error "${data.error}" — installation may be stale`);
    } else {
      console.error(`Slack API ${method} error: ${data.error}`);
    }
  }
  return data;
}
