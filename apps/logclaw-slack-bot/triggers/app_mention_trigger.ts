import { Trigger } from "deno-slack-api/types.ts";
import {
  TriggerContextData,
  TriggerEventTypes,
  TriggerTypes,
} from "deno-slack-api/mod.ts";
import { MentionWorkflow } from "../workflows/mention_workflow.ts";

/**
 * Fires whenever someone @mentions the LogClaw bot in a channel.
 * Passes the message text, user, channel, and timestamp to the workflow.
 */
const AppMentionTrigger: Trigger<typeof MentionWorkflow.definition> = {
  type: TriggerTypes.Event,
  name: "LogClaw mention trigger",
  description: "Starts the AI agent when someone @mentions LogClaw",
  workflow: `#/workflows/${MentionWorkflow.definition.callback_id}`,
  event: {
    event_type: TriggerEventTypes.AppMentioned,
    channel_ids: [], // empty = all channels where the bot is added
  },
  inputs: {
    text: { value: TriggerContextData.Event.AppMentioned.text },
    user_id: { value: TriggerContextData.Event.AppMentioned.user_id },
    channel_id: { value: TriggerContextData.Event.AppMentioned.channel_id },
    message_ts: { value: TriggerContextData.Event.AppMentioned.message_ts },
  },
};

export default AppMentionTrigger;
