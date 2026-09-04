import type { ActivityEntry } from "../activity/ActivityLedger";
import type { ClientFunctionSchema } from "../functions/types";
import type { ContextSnapshot } from "../state/ClientContextRegistry";
import type {
  ProactiveNudgeInstance,
  ProactiveOptions,
} from "../proactive/types";

/**
 * SDK Configuration
 */
export interface AgoConfig {
  /** API base URL (e.g., https://YOUR-DOMAIN.useago.com) */
  baseUrl: string;
  /** Per-visitor anonymous ID (X-User-Anon-Id header). Auto-generated if not provided. */
  widgetId?: string;
  /** Default agent (id or slug) for new conversations. Shorthand for `defaultAgentId`. */
  agent?: string;
  /** Default agent ID for new conversations. Prefer `agent`. */
  defaultAgentId?: string;
  /** Permission name to apply to all requests (sent as `X-Widget-Permission`). Mirrors the widget's `window.AGO.permission`. */
  permission?: string;
  /** User email for identification */
  userEmail?: string;
  /** JWT token for authenticated users */
  userJwt?: string;
  /** Enable debug logging */
  debug?: boolean;
  /**
   * Warn on the console when a reply completes with empty content and no tool
   * calls (the usual cause is an unknown `agent` slug, which the backend
   * currently answers with an empty 200). Default `true`. The `message:empty`
   * event fires regardless of this setting.
   */
  warnOnEmptyReply?: boolean;
  /**
   * How the agent loop treats client function calls (requires backend support):
   * - `"pause"` (default): the turn stops on client function call(s) with status
   *   `WAITING_CLIENT`; once every result is submitted, the SDK resumes the SAME
   *   turn via `POST /messages/{id}/continue`, so the agent sees the real results.
   * - `"placeholder"` (legacy): the turn continues immediately on a placeholder
   *   result; the real result is only visible to the agent on later turns.
   * Older backends ignore the flag, so `"pause"` degrades to legacy behavior.
   */
  clientFunctionsMode?: ClientFunctionsMode;
  /**
   * Gate client function calls behind explicit user approval. Return `true` for
   * an invocation the user must approve/reject before it runs; return `false`
   * (or omit the policy) to let it run immediately as before.
   *
   * Only effective in pause mode (`clientFunctionsMode: "pause"`) — a gated call
   * holds at `WAITING_CLIENT`, the SDK emits `function:awaiting-approval`, and it
   * runs (and the turn resumes) only after `approveFunction(invocationId)`; a
   * `rejectFunction(invocationId)` submits a rejection so the agent sees the
   * decline. In placeholder mode there is no pause to hold, so the policy is a
   * no-op and the call runs normally. A per-function `requiresApproval: true`
   * also gates a call; the policy and the flag OR together.
   */
  approvalPolicy?: (invocation: ClientFunctionInvocation) => boolean;
  /**
   * Max serialized size (bytes) of a client function result before the SDK
   * replaces it with a flagged, truncated preview. Everything a handler
   * returns is sent into the LLM context, so this caps runaway payloads
   * (raw API responses, full tables). Default `50000`. Override per function
   * with `maxResultBytes` on its definition; `Infinity` disables the guard.
   */
  maxFunctionResultBytes?: number;
  /**
   * Max number of recent actions kept in the in-memory activity ledger that
   * rides along as the `activity:recent` context entry. Older entries drop
   * first. Default `10`. Larger values give the agent more history at the cost
   * of tokens on every message. Each entry's `data` is also size-clamped (long
   * strings truncated, large arrays capped) so one event can't bloat the context.
   */
  maxActivityEntries?: number;
  /**
   * Enable the proactive mode: declarative triggers evaluated client-side
   * against friction signals (dwell/idle time, rage clicks, route bounces…)
   * that can surface a nudge before the user opens the chat. Equivalent to
   * calling `createAgoProactive(client, proactive)` — the resulting controller
   * is available as `client.proactive`. Requires the tenant-level kill-switch
   * (`GET /api/sdk/v1/config` → `proactive.enabled`) to be on; disabled by
   * default otherwise.
   */
  proactive?: ProactiveOptions;
  /**
   * Mirror every registered client function into the browser's WebMCP registry
   * (`document.modelContext`), so an external agent can call the same functions
   * the in-app agent calls. Off by default; no-ops without WebMCP.
   *
   * A mirrored function runs immediately: the approval gate
   * ({@link approvalPolicy}, `requiresApproval`) covers the agent loop only.
   * Keep anything that must not run unattended out with `webmcp: false` on its
   * definition.
   */
  webmcp?: boolean;
}

/** See {@link AgoConfig.clientFunctionsMode}. */
export type ClientFunctionsMode = "placeholder" | "pause";

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
  /** Existing conversation ID */
  conversationId?: string;
  /** Override default agent */
  agentId?: string;
  /** File attachments */
  files?: File[];
  /**
   * Mark this message as hidden. The backend keeps it in the model's context but
   * flags it so the UI never displays it. Used by auto-continuation to nudge the
   * agent after a navigation without polluting the visible transcript.
   * Requires backend support for the `hidden` flag; older backends ignore it.
   */
  hidden?: boolean;
  /** Per-message override of {@link AgoConfig.clientFunctionsMode}. */
  clientFunctionsMode?: ClientFunctionsMode;
}

/**
 * An uploaded file attached to a message.
 *
 * `url` is a presigned, time-limited URL the backend generates per request (or a
 * local `blob:` URL for an optimistic preview). `isSafeImage` is the backend's
 * verdict that the file is a real, script-free image safe to embed inline; the
 * UI only renders an `<img>` when it is true and otherwise shows a download link.
 */
export interface AgoAttachment {
  id: string;
  name: string;
  /** MIME type reported by the backend (e.g. `image/png`). */
  contentType?: string;
  /** Size in bytes. */
  fileSize?: number;
  /** Presigned download/preview URL, or a local `blob:` URL before upload. */
  url?: string;
  /** True only when the backend verified the file is a safe inline image. */
  isSafeImage: boolean;
}

/**
 * Message from AGO
 */
export interface AgoMessage {
  id: string;
  conversationId: string;
  content: string;
  role: "user" | "assistant";
  status: MessageStatus;
  agent?: AgoAgent;
  sources?: AgoSource[];
  toolCalls?: ToolCallData[];
  followUpReplies?: string[];
  /** Uploaded files on this message (usually the user's). */
  attachments?: AgoAttachment[];
  /**
   * True when the backend flagged this message as hidden (e.g. an
   * auto-continuation nudge). Kept in the model's context but not displayed;
   * UI helpers like `useMessages`/`ChatWidget` filter these out.
   */
  hidden?: boolean;
  createdAt: Date;
}

export type MessageStatus =
  | "IN_PROGRESS"
  | "DONE"
  | "ERROR"
  | "TODO"
  | "CANCELED"
  /**
   * The turn paused on client function call(s) (pause mode): the agent waits for
   * every waiting call to be submitted, then the turn resumes via
   * `continueMessage`. Not a final state.
   */
  | "WAITING_CLIENT";

/**
 * Response of `POST /tool-calls/{id}/submit`. `resume` is only present when the
 * tool call belongs to a turn paused on client functions (pause mode): `ready`
 * flips to `true` once ALL waiting calls of that message are submitted, meaning
 * the turn can be resumed via `continueMessage(resume.message_id)`.
 */
export interface SubmitToolCallResult {
  status: string;
  result?: unknown;
  /** Set when `status` is `"error"`. */
  error?: string;
  /** The ticket a ticketing `form` tool call resolved to, when it did. */
  ticket?: { ticket_id: string; ticket_url?: string; [key: string]: unknown };
  resume?: {
    message_id: string;
    ready: boolean;
  };
}

// ── Tickets and the SDK config ─────────────────────────────────────

/** An option of a ticket form field (`GET /config` → `ticket_form.fields[].options[]`). */
export interface TicketFieldOption {
  id: string;
  /** Label shown to the user. */
  name?: string;
  /** Value submitted. Falls back to `name` when absent. */
  value?: string;
  /** Preselected when the form opens. */
  default: boolean;
  /** A note shown under the field once this option is picked. */
  message?: string;
  messageType: "info" | "warning" | "danger";
}

/** A custom field of a ticket form. */
export interface TicketField {
  id: string;
  /** The key the ticketing backend expects; used as the submit key when set. */
  externalId?: string;
  title?: string;
  /** Field kind, e.g. `"text"`, `"checkbox"`, `"tagger"`. */
  type?: string;
  required: boolean;
  /** Carried in the submission but never shown. */
  hidden: boolean;
  position: number;
  /** Non-empty turns the field into a select. */
  options: TicketFieldOption[];
  /** Show this field only when the parent field holds `conditionalFieldValue`. */
  conditionalFieldId?: string;
  conditionalFieldValue?: string;
}

/** The ticket form an agent's `ago_ticketing` tool opens in the conversation. */
export interface TicketForm {
  id: string;
  name?: string;
  /** `"form"` renders the SDK's own fields; `"embed"` hosts third-party HTML. */
  mode: "form" | "embed";
  showSubject: boolean;
  showBody: boolean;
  showPriority: boolean;
  showTypology: boolean;
  fields: TicketField[];
}

/** One permission's configuration in {@link SdkConfig}. */
export interface SdkPermissionConfig {
  id?: string;
  name?: string;
  displayName?: string;
  agents: Array<{ id: string; name?: string }>;
  ticketForm?: TicketForm;
  fileAttachmentsEnabled: boolean;
  voiceEnabled: boolean;
}

/** Response of `GET /api/sdk/v1/config` (see `AgoClient.getConfig`). */
export interface SdkConfig {
  permissions: SdkPermissionConfig[];
  proactive: { enabled: boolean };
}

/** Input of `AgoClient.createTicket` (`POST /api/sdk/v1/tickets`). */
export interface CreateTicketInput {
  subject: string;
  body: string;
  priority?: string;
  typology?: string;
  /** Conversation the ticket is filed from. */
  conversationId?: string;
  /** Reporter email, for a visitor the SDK does not otherwise identify. */
  email?: string;
  customFields?: Array<{ id: string; value: string }>;
  files?: File[];
  ticketFormId?: string;
}

/** Response of `AgoClient.createTicket`. */
export interface CreateTicketResult {
  id: string;
  url?: string;
}

/** The ticket the agent pre-filled on a ticketing `form` tool call. */
export interface ToolCallTicketPrefill {
  subject?: string;
  body?: string;
  typology?: string;
  priority?: string;
  tag?: string;
  products?: string[];
  /** Keyed by the field's external id, or a lowercased, underscored title. */
  custom_fields?: Record<string, string>;
}

/**
 * Response of `POST /messages/{id}/stop` (see `AgoClient.stopMessage`).
 *
 * - `"stopping"` — the request was accepted; the turn unwinds at its next safe
 *   point and finalizes as `CANCELED`, keeping the text produced so far.
 * - `"not_running"` — the turn had already finished. Harmless.
 * - `"not_supported"` — a background agent run, which cannot be stopped once
 *   started.
 */
export interface StopMessageResult {
  status: "stopping" | "not_running" | "not_supported";
  /** The message's status when the stop was requested. */
  messageStatus?: MessageStatus;
}

/** Thumbs up / thumbs down on an answer. */
export type FeedbackRating = "positive" | "negative";

/**
 * What went wrong with an answer. These are the four buckets the AGO feedback
 * dashboard filters and charts on.
 */
export type FeedbackReason =
  /** The answer states something false. */
  | "inaccurate"
  /** The answer is right but stops short. */
  | "incomplete"
  /** The agent could not find the information. */
  | "information_not_found"
  /** Something broke: the widget, a tool call, the stream. */
  | "technical_issue";

/** The four values of {@link FeedbackReason}, in dashboard order. */
export const FEEDBACK_REASONS: readonly FeedbackReason[] = [
  "inaccurate",
  "incomplete",
  "information_not_found",
  "technical_issue",
];

/**
 * Why the user is reporting a message (see `AgoClient.submitFeedback`).
 *
 * A rating on its own is a reaction (the thumbs count). Add a reason or a
 * comment and the report also lands in the feedback dashboard, the analytics
 * and the CSV export, where someone can act on it.
 */
export interface FeedbackDetails {
  /** What went wrong. Several can apply at once. */
  reasons?: FeedbackReason[];
  /** The user's own words. Trimmed server-side; 5000 characters max. */
  comment?: string;
}

/**
 * Agent information
 */
export interface AgoAgent {
  id: string;
  name: string;
  displayName?: string;
}

/**
 * Knowledge source citation
 */
export interface AgoSource {
  id: string;
  title: string;
  url?: string;
}

/**
 * Conversation/Thread
 */
export interface Conversation {
  id: string;
  title: string;
  lastMessageDate: Date;
  messages?: AgoMessage[];
}

/**
 * A page of list results, mirroring the API's `{ data, has_more, total }`
 * envelope. `total` is the count across all pages, not just this page.
 */
export interface PaginatedResult<T> {
  data: T[];
  hasMore: boolean;
  total: number;
}

/**
 * Tool call data from SSE stream
 */
export interface ToolCallData {
  id: string;
  type: ToolCallType;
  status: string;
  toolName: string;
  toolDisplayName?: string;
  message?: string;
  formSchema?: FormSchema;
  data?: Record<string, unknown>;
  // For client functions
  functionName?: string;
  arguments?: Record<string, unknown>;
  /**
   * Where the hosted widget shows the call: in the collapsible "reasoning"
   * section, in the message body, or both. Absent means collapsible only.
   */
  displayMode?: "collapsible" | "display" | "both";
  // For the ticketing `form` tool call (`toolName: "ago_ticketing"`)
  /** The user asked to talk to a human. */
  askToTalkToHuman?: boolean;
  /** `false` when the tenant blocks ticket creation for this visitor. */
  allowedToCreateTicket?: boolean;
  /** Fields the agent pre-filled from the conversation. */
  ticket?: ToolCallTicketPrefill;
  /** `"embed"` hosts third-party HTML (`embedHtml`); otherwise the SDK's form. */
  mode?: "form" | "embed";
  ticketFormId?: string;
  embedHtml?: string;
  embedDescription?: string;
}

export type ToolCallType =
  | "form"
  | "confirmation_input"
  | "status_message"
  | "progress_indicator"
  | "client_function"
  | "reasoning"
  | "mcp_ui_resource";

/**
 * Form schema for tool calls requiring user input
 */
export interface FormSchema {
  type: "object";
  properties: Record<string, FormField>;
  required?: string[];
}

export interface FormField {
  type: "string" | "number" | "boolean" | "array";
  title?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
}

/**
 * Client-side function types
 */
export interface FunctionSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description?: string;
        enum?: string[];
      }
    >;
    required?: string[];
  };
}

export type ClientFunction = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

export interface FunctionDefinition {
  name: string;
  schema: FunctionSchema;
  handler: ClientFunction;
}

export interface ClientFunctionInvocation {
  invocationId: string;
  functionName: string;
  arguments: Record<string, unknown>;
  conversationId: string;
}

/**
 * SSE stream chunk data
 */
export interface SSEChunkData {
  content?: string;
  full_content?: string;
  message_id?: string;
  status?: MessageStatus;
  thread?: { id: string };
  /** Generated conversation title, streamed once at the end of the first turn. */
  title?: string;
  agent?: { id: string; name: string; display_name?: string };
  knowledge_sources?: Array<{
    knowledge_document: {
      id: string;
      title: string;
      use_external_link: boolean;
      external_link_url?: string;
      internal_link_url?: string;
    };
    position: number;
  }>;
  tool_call_data?: boolean;
  type?: string;
  id?: string;
  tool_name?: string;
  tool_display_name?: string;
  function_name?: string;
  arguments?: Record<string, unknown>;
  form_schema?: FormSchema;
  message?: string;
  data?: Record<string, unknown>;
  follow_up_replies?: string[];
  satisfaction_feedback?: unknown;
  ask_to_talk_to_human?: boolean;
  allowed_to_create_ticket?: boolean;
  ticket?: ToolCallTicketPrefill;
  mode?: "form" | "embed";
  ticket_form_id?: string;
  embed_html?: string;
  embed_description?: string;
  display_mode?: "collapsible" | "display" | "both";
  /** Tool call ids still awaiting a client result, sent with the final `WAITING_CLIENT` event. */
  waiting_tool_call_ids?: string[];
}

/**
 * SDK Events
 */
export interface AgoClientEvents {
  /**
   * The client-side context changed: a context entry or dynamic provider was
   * added/removed, or a stateful helper (e.g. `createFormCollector`) updated its
   * store. Carries the fresh snapshot so observers — notably the dev panel — can
   * repaint without waiting for the next message. Fires for the form collector's
   * initial install too, so its missing fields show from the start of a conversation.
   */
  "context:changed": ContextSnapshot | null;
  "message:start": {
    conversationId: string;
    messageId: string;
  };
  "message:chunk": {
    content: string;
    conversationId: string;
    messageId: string;
  };
  /**
   * Every raw SSE message parsed off the stream, before the handler interprets it
   * into the higher-level `message:*` / `toolCall:*` / `function:*` events. Carries
   * the chunk verbatim so debugging tools (notably the dev panel) can log the exact
   * wire payload. Heartbeat comments are not messages and don't fire this.
   */
  "stream:message": SSEChunkData;
  /**
   * The main answer text is done (backend emitted `status: "DONE"`), but follow-up
   * replies may still be pending. Fires once, before `message:complete`.
   */
  "message:answer-complete": AgoMessage;
  "message:complete": AgoMessage;
  /**
   * The turn paused on client function call(s) (pause mode): the stream closed
   * with status `WAITING_CLIENT` instead of `DONE`. `message:complete` does NOT
   * fire for this stream — it fires when the resumed turn concludes, so one
   * logical turn still emits exactly one `message:complete`. The SDK submits the
   * function results and resumes automatically; listen to this to know the agent
   * is waiting on the page (e.g. to keep a "working…" indicator up).
   */
  "message:waiting-client": {
    conversationId: string;
    messageId: string;
    waitingToolCallIds: string[];
  };
  /**
   * A reply finished as `DONE` with empty content and no tool calls, client
   * functions, or follow-up replies — usually an unknown `agent` slug (the
   * backend currently answers those with an empty 200). Fires after
   * `message:complete` AND after `sendMessage` resolves, so subscribing right
   * after `await sendMessage(...)` still catches it. `messageId` and
   * `conversationId` are empty strings when the stream completed without any
   * message data at all (e.g. a proxy stripped the SSE stream).
   */
  "message:empty": {
    conversationId: string;
    messageId: string;
  };
  /**
   * The user stopped the turn (`client.stop()`): the stream was closed and the
   * backend was told to stop generating. Always fires, so this is the event to
   * finalize a UI on. When there was an answer to keep, a `message:complete`
   * carrying it with status `CANCELED` fires first; there is none when the stop
   * landed before the backend named the message (`messageId` is then an empty
   * string) or when the stopped turn was paused on client functions.
   */
  "message:stopped": {
    conversationId: string;
    messageId: string;
  };
  "message:error": {
    error: string;
    /** Stable error code (see configuration.md#error-codes) when the failure was an AgoError. */
    code?: string;
    conversationId?: string;
    messageId?: string;
  };
  /**
   * A full conversation was loaded from the server (e.g. after a page reload).
   * Carries the messages and their persisted tool calls so stateful helpers —
   * notably `createFormCollector` — can replay them to restore their state.
   */
  "conversation:loaded": Conversation;
  /**
   * The conversation's title was generated and streamed during a live turn
   * (the backend emits it once, at the end of the first turn). Lets the UI
   * update a header without a refetch.
   */
  "conversation:title": { conversationId: string; title: string };
  "toolCall:received": ToolCallData;
  "toolCall:form": ToolCallData;
  "function:invoke": ClientFunctionInvocation;
  /**
   * A client function call is held pending the user's approval (pause mode +
   * an {@link AgoConfig.approvalPolicy}/`requiresApproval` match). The turn stays
   * at `WAITING_CLIENT`; call `approveFunction(invocationId)` to run it and
   * resume, or `rejectFunction(invocationId)` to decline. Fires after
   * `function:invoke` (which still fires for every call) and instead of the
   * call running immediately.
   */
  "function:awaiting-approval": ClientFunctionInvocation;
  /**
   * A function was registered or unregistered, or the registry was cleared.
   * Carries the fresh schema list, so observers repaint without polling.
   */
  "functions:changed": ClientFunctionSchema[];
  "function:result": {
    invocationId: string;
    result: unknown;
    error?: string;
  };
  /**
   * A form collector submitted successfully. `result` is the raw submit response
   * (POST body / handler return value / backend relay result) — the third-party
   * API's answer. `values` is the submitted field set, `name` the collector name.
   */
  "form:submitted": {
    name: string;
    values: Record<string, unknown>;
    result: unknown;
  };
  /**
   * A form collector submit was attempted and failed at the network/server level
   * (HTTP non-2xx, or a thrown handler/fetch). `error` is the message. Validation
   * pre-checks (missing required fields, no submit target) are NOT errors and do
   * not fire this — they are returned to the caller as `{ ok: false }`.
   */
  "form:error": {
    name: string;
    values: Record<string, unknown>;
    error: string;
  };
  "connection:status": {
    connected: boolean;
  };
  /**
   * A proactive nudge passed every governor gate and is ready to display.
   * `useProactiveNudge` / `<AgoNudge>` consume this; custom UIs should call
   * `client.proactive.shown(nudge)` when they render it (impression tracking
   * + frequency caps), then `accept(nudge)` / `dismiss(nudge)`.
   */
  "nudge:ready": ProactiveNudgeInstance;
  /** A nudge was displayed to the user (fires once per nudge). */
  "nudge:shown": { nudge: ProactiveNudgeInstance };
  /** The user dismissed the nudge (its trigger is suppressed, see governor). */
  "nudge:dismissed": { nudge: ProactiveNudgeInstance };
  /** The user accepted the nudge (its action ran / the chat is being seeded). */
  "nudge:accepted": { nudge: ProactiveNudgeInstance };
  /** A user- or agent-action was recorded into the activity ledger. */
  "activity:recorded": ActivityEntry;
}

export type AgoEventName = keyof AgoClientEvents;
export type AgoEventHandler<K extends AgoEventName> = (
  data: AgoClientEvents[K],
) => void;
