import type { ContextSnapshot } from "../state/ClientContextRegistry";

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
}

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
  createdAt: Date;
}

export type MessageStatus =
  | "IN_PROGRESS"
  | "DONE"
  | "ERROR"
  | "TODO"
  | "CANCELED";

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
  "toolCall:received": ToolCallData;
  "toolCall:form": ToolCallData;
  "function:invoke": ClientFunctionInvocation;
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
}

export type AgoEventName = keyof AgoClientEvents;
export type AgoEventHandler<K extends AgoEventName> = (
  data: AgoClientEvents[K],
) => void;
