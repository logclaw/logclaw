import { Manifest } from "deno-slack-sdk/mod.ts";
import { MentionWorkflow } from "./workflows/mention_workflow.ts";
import { ConversationStore } from "./datastores/conversation_store.ts";

export default Manifest({
  name: "LogClaw",
  description:
    "AI-powered incident management agent. @mention to query incidents, search logs, take actions, and forward tickets to PagerDuty/Jira/ServiceNow/OpsGenie.",
  icon: "assets/icon.png",
  workflows: [MentionWorkflow],
  outgoingDomains: ["api.openai.com", "ticket.logclaw.ai"],
  datastores: [ConversationStore],
  botScopes: [
    "app_mentions:read",
    "chat:write",
    "channels:history",
    "groups:history",
    "datastore:read",
    "datastore:write",
  ],
});
