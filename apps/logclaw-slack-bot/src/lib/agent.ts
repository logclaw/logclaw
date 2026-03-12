/**
 * AI agent loop using OpenAI function calling.
 * Takes a user message, runs tool calls in a loop, returns final text.
 */
import { TOOL_DEFINITIONS } from "./tool-defs.js";
import { executeToolCall } from "./dispatcher.js";

const SYSTEM_PROMPT = `You are LogClaw, an AI-powered incident management assistant in Slack.

You help SRE and DevOps teams manage incidents by querying tickets, searching logs, checking anomalies, and taking actions like acknowledging or resolving incidents.

TOOLS AVAILABLE:
- list_incidents: Search and filter incidents by severity, state, service
- get_incident: Get full details of a specific incident (root cause, timeline, evidence)
- update_incident: Change incident state (acknowledge, investigate, mitigate, resolve) or add notes
- forward_incident: Send an incident to PagerDuty, Jira, ServiceNow, OpsGenie, or Slack
- search_logs: Search raw logs by service, level, time range, query text
- get_anomalies: View recent anomaly detections (Z-score analysis)
- service_health: Check LogClaw pipeline health
- bulk_update: Update multiple incidents at once

FORMATTING RULES:
- Use Slack mrkdwn: *bold*, \`code\`, _italic_
- Keep responses concise (under 2000 characters)
- For incident lists, use a compact format:
  \`:rotating_light: \`TICK-0001\` *Title* | critical | identified\`
- For actions, confirm what you did briefly
- If no results found, say so clearly

BEHAVIOR:
- Always use tools to get real data — never make up incident IDs or details
- For ambiguous queries, ask for clarification
- For destructive actions (resolve, bulk update), confirm what you're about to do`;

const MAX_ITERATIONS = 5;
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
}

export async function runAgentLoop(
  userMessage: string,
  openaiKey: string,
  logclawKey: string,
  conversationHistory: ChatMessage[] = [],
  model = "gpt-4o-mini",
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        temperature: 0.1,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`OpenAI API error ${res.status}: ${err.slice(0, 200)}`);
      // Try fallback model on first failure
      if (i === 0 && model === "gpt-4o-mini") {
        return await runAgentLoop(userMessage, openaiKey, logclawKey, conversationHistory, "gpt-4o");
      }
      return "⚠️ AI service temporarily unavailable. Try again shortly.";
    }

    const data: OpenAIResponse = await res.json();
    const choice = data.choices?.[0];
    if (!choice) {
      return "⚠️ Unexpected AI response. Please try again.";
    }

    // Add assistant message to history
    messages.push({
      role: "assistant",
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
    });

    // If no tool calls, we're done — return the text
    if (choice.finish_reason === "stop" || !choice.message.tool_calls?.length) {
      return choice.message.content || "I processed your request but have no additional information to share.";
    }

    // Execute tool calls
    for (const toolCall of choice.message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        // LLM sent invalid JSON
        args = {};
      }

      let result: unknown;
      try {
        result = await executeToolCall(
          toolCall.function.name,
          args,
          logclawKey,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        result = { error: msg };
      }

      // Truncate large tool results to keep context manageable
      let resultStr = JSON.stringify(result);
      if (resultStr.length > 8000) {
        resultStr = resultStr.slice(0, 8000) + "...(truncated)";
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: resultStr,
      });
    }
  }

  return "I reached the maximum reasoning steps. Please try a simpler or more specific query.";
}
