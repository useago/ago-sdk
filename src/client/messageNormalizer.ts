import type {
  AgoMessage,
  ConversationInteraction,
  MessageApproval,
  MessageOutcome,
  MessageProgress,
  ToolCallData,
} from "./types";
import { mapAttachment } from "../utils/attachments";
import { AgoStreamError } from "./errors";

export function mapToolCall(tc: Record<string, unknown>): ToolCallData {
  return {
    id: String(tc.id ?? ""),
    type: (tc.type as ToolCallData["type"]) ?? "status_message",
    status: String(tc.status ?? "unknown"),
    toolName: (tc.tool_name as string) ?? "",
    toolDisplayName: tc.tool_display_name as string | undefined,
    toolType: (tc.tool_type as string | null | undefined) ?? undefined,
    messageId: (tc.message_id as string | null | undefined) ?? undefined,
    conversationId: (tc.thread as { id?: string } | undefined)?.id,
    message: tc.message as string | undefined,
    formSchema: tc.form_schema as ToolCallData["formSchema"],
    data: tc.data as Record<string, unknown> | undefined,
    functionName: tc.function_name as string | undefined,
    arguments: tc.arguments as Record<string, unknown> | undefined,
    displayMode: tc.display_mode as ToolCallData["displayMode"],
    askToTalkToHuman: tc.ask_to_talk_to_human as boolean | undefined,
    allowedToCreateTicket: tc.allowed_to_create_ticket as boolean | undefined,
    ticket: tc.ticket as ToolCallData["ticket"],
    mode: tc.mode as ToolCallData["mode"],
    ticketFormId: tc.ticket_form_id as string | undefined,
    embedHtml: tc.embed_html as string | undefined,
    embedDescription: tc.embed_description as string | undefined,
  };
}

type RawMessage = {
  id?: string;
  message_id?: string;
  conversation_id?: string;
  content?: string;
  role?: AgoMessage["role"] | "system";
  status?: string;
  created_at?: string;
  hidden?: boolean;
  agent?: AgoMessage["agent"] | null;
  sources?: Array<{ id: string; title: string; url?: string | null }>;
  tool_call_data?: Array<Record<string, unknown>>;
  attachments?: Array<Record<string, unknown>>;
  follow_up_replies?: string[];
  progress?: MessageProgress | null;
  approval?: {
    id: string;
    status: MessageApproval["status"];
    actions: MessageApproval["actions"];
    allowed_decisions: MessageApproval["allowedDecisions"];
    expires_at: string | null;
  } | null;
  outcome?: MessageOutcome | null;
  can_stop?: boolean;
};

export function normalizeInteraction(raw: {
  can_send_message: boolean;
  blocking_message_id: string | null;
}): ConversationInteraction {
  return {
    canSendMessage: raw.can_send_message,
    blockingMessageId: raw.blocking_message_id,
  };
}

export function normalizeMessage(
  raw: RawMessage,
  conversationId = "",
  complete = false,
  history = false,
): AgoMessage {
  if (
    complete &&
    (typeof raw.id !== "string" ||
      !raw.id ||
      typeof raw.conversation_id !== "string" ||
      !raw.conversation_id ||
      (raw.role !== "user" &&
        raw.role !== "assistant" &&
        !(history && raw.role === "system" && raw.hidden === true)) ||
      typeof raw.status !== "string" ||
      ![
        "IN_PROGRESS",
        "DONE",
        "ERROR",
        "TODO",
        "CANCELED",
        "WAITING_CLIENT",
        "WAITING_APPROVAL",
        "PAUSED",
      ].includes(raw.status) ||
      typeof raw.content !== "string" ||
      typeof raw.created_at !== "string" ||
      Number.isNaN(Date.parse(raw.created_at)))
  )
    throw new AgoStreamError("Invalid message snapshot.");
  const collection = <T>(items: T[] | undefined): T[] | undefined =>
    items && (complete || items.length > 0) ? items : undefined;
  const approval =
    raw.approval === null
      ? null
      : raw.approval && {
          id: raw.approval.id,
          status: raw.approval.status,
          actions: raw.approval.actions,
          allowedDecisions: raw.approval.allowed_decisions,
          expiresAt: raw.approval.expires_at,
        };
  return {
    id: raw.id ?? raw.message_id ?? "",
    conversationId: raw.conversation_id ?? conversationId,
    content: raw.content ?? "",
    role: (raw.role ?? "assistant") as AgoMessage["role"],
    status: (raw.status ?? "DONE") as AgoMessage["status"],
    createdAt: new Date(raw.created_at ?? 0),
    hidden: raw.hidden,
    agent: raw.agent ?? undefined,
    sources: collection(
      raw.sources?.map(({ id, title, url }) => ({
        id,
        title,
        url: url ?? undefined,
      })),
    ),
    toolCalls: collection(raw.tool_call_data?.map(mapToolCall)),
    attachments: collection(raw.attachments?.map(mapAttachment)),
    followUpReplies: collection(raw.follow_up_replies),
    progress: raw.progress,
    approval,
    outcome: raw.outcome,
    canStop: raw.can_stop,
  };
}
