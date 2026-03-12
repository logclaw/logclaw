import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { AiAgentFunction } from "../functions/ai_agent_function.ts";

/**
 * Workflow triggered by an @mention of the LogClaw bot.
 * Passes inputs straight to the AI agent function.
 */
export const MentionWorkflow = DefineWorkflow({
  callback_id: "mention_workflow",
  title: "LogClaw AI Agent",
  description: "Handles @LogClaw mentions using an AI agent with incident tools",
  input_parameters: {
    properties: {
      text: { type: Schema.types.string },
      user_id: { type: Schema.slack.types.user_id },
      channel_id: { type: Schema.slack.types.channel_id },
      message_ts: { type: Schema.types.string },
    },
    required: ["text", "user_id", "channel_id", "message_ts"],
  },
});

MentionWorkflow.addStep(AiAgentFunction, {
  text: MentionWorkflow.inputs.text,
  user_id: MentionWorkflow.inputs.user_id,
  channel_id: MentionWorkflow.inputs.channel_id,
  message_ts: MentionWorkflow.inputs.message_ts,
});
