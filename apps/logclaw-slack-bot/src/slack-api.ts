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
): Promise<SlackResponse> {
  const body: Record<string, unknown> = { channel, text };
  if (threadTs) body.thread_ts = threadTs;

  return slackFetch(token, "chat.postMessage", body);
}

export async function updateMessage(
  token: string,
  channel: string,
  ts: string,
  text: string,
): Promise<SlackResponse> {
  return slackFetch(token, "chat.update", { channel, ts, text });
}

async function slackFetch(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<SlackResponse> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Slack API ${method} HTTP ${res.status}`);
  }

  const data = (await res.json()) as SlackResponse;
  if (!data.ok) {
    console.error(`Slack API ${method} error: ${data.error}`);
  }
  return data;
}
