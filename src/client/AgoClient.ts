import { ActivityLedger } from "../activity/ActivityLedger";
import type { ActivityEntry, ActivityInput } from "../activity/ActivityLedger";
import { HttpClient } from "../api/HttpClient";
import type {
  FormCollectorDefinition,
  FormCollectorSchema,
  SubmitConfig,
} from "../forms/createFormCollector";
import { FunctionRegistry } from "../functions/FunctionRegistry";
import type {
  AgoPageStateOptions,
  AgoStateControl,
  ClientFunctionDefinition,
  ClientFunctionHandler,
  ClientFunctionRegisterOptions,
  ClientFunctionSchema,
} from "../functions/types";
import { createAgoProactive } from "../proactive/createAgoProactive";
import type { ProactiveController } from "../proactive/types";
import { ClientContextRegistry } from "../state/ClientContextRegistry";
import type {
  ContextEntry,
  ContextSnapshot,
  DynamicContextProvider,
} from "../state/ClientContextRegistry";
import { computePageStateDelta } from "../state/pageStateDelta";
import type { PageStateBaseline } from "../state/pageStateDelta";
import { SSEHandler } from "../streaming/SSEHandler";
import { mapAttachment } from "../utils/attachments";
import { EventEmitter } from "../utils/eventEmitter";
import { logger } from "../utils/logger";
import { AgoError } from "./errors";
import { validateConfig } from "./validateConfig";
import type {
  AgoConfig,
  AgoClientEvents,
  AgoEventName,
  AgoEventHandler,
  AgoMessage,
  ClientFunctionInvocation,
  ClientFunctionsMode,
  Conversation,
  PaginatedResult,
  SendMessageOptions,
  SubmitToolCallResult,
  ToolCallData,
} from "./types";

type NavRoute = { name: string; path: string; description: string };

/**
 * Hook run before a paused turn is resumed, so the app controls WHEN the
 * continuation fires (e.g. wait for the destination page to mount after a
 * navigation). It must resolve — throwing or hanging blocks the resume; on
 * timeout-style situations resolve anyway and let the agent conclude.
 */
export type ResumeGate = (info: {
  conversationId: string;
  messageId: string;
}) => Promise<void> | void;

/**
 * Auto-resume bookkeeping for one paused turn. The resume fires only when BOTH
 * signals landed: the stream closed as WAITING_CLIENT (the backend persisted the
 * pause) AND a submit response reported `resume.ready` (every waiting call got
 * its result). Either can arrive first — submits run while the stream is still
 * open, and resuming before the pause is persisted would 409.
 */
type PendingResume = {
  conversationId: string;
  /** Stream closed with WAITING_CLIENT — the backend accepts a continue now. */
  waitingConfirmed: boolean;
  /** A submit response reported every waiting call submitted. */
  resultsReady: boolean;
  /** Guards double-continue (e.g. duplicate submit responses). */
  started: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve which registered route a pathname corresponds to, so the agent can be
 * told the current page by the same name it uses to navigate.
 *
 * Precedence: exact path, then parameterised path (`/users/:id`), then the
 * longest static path that prefixes the pathname (nested routes). Returns
 * `undefined` when nothing matches.
 */
/** Names of the `:param` placeholders in a route path, in order. */
function routeParamNames(path: string): string[] {
  return path
    .split("/")
    .filter((seg) => seg.startsWith(":"))
    .map((seg) => seg.slice(1));
}

/**
 * Fill the `:param` placeholders of a route path with agent-supplied values.
 * Returns the resolved path plus the placeholders that had no value, so the
 * caller can send the agent a correctable error instead of a broken URL.
 */
function fillRouteParams(
  path: string,
  params: Record<string, unknown>
): { path: string; missing: string[] } {
  const missing: string[] = [];
  const filled = path
    .split("/")
    .map((seg) => {
      if (!seg.startsWith(":")) return seg;
      const name = seg.slice(1);
      const value = params[name];
      if (value === undefined || value === null || value === "") {
        missing.push(name);
        return seg;
      }
      return encodeURIComponent(String(value));
    })
    .join("/");
  return { path: filled, missing };
}

function matchRoute(pathname: string, routes: NavRoute[]): NavRoute | undefined {
  const exact = routes.find((r) => r.path === pathname);
  if (exact) return exact;

  const parameterised = routes.find((r) => {
    if (!r.path.includes(":")) return false;
    const pattern =
      "^" +
      r.path
        .split("/")
        .map((seg) => (seg.startsWith(":") ? "[^/]+" : escapeRegExp(seg)))
        .join("/") +
      "/?$";
    return new RegExp(pattern).test(pathname);
  });
  if (parameterised) return parameterised;

  return routes
    .filter((r) => r.path !== "/" && pathname.startsWith(r.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/** Context key under which the recent-activity window rides along with messages. */
const ACTIVITY_CONTEXT_KEY = "activity:recent";

/** Context key for the page-state changes since the last message. */
const STATE_DELTA_CONTEXT_KEY = "state:delta";

/**
 * Main SDK client for AGO Chat integration
 */
export class AgoClient {
  private httpClient: HttpClient;
  private functionRegistry: FunctionRegistry;
  private contextRegistry: ClientContextRegistry;
  private eventEmitter: EventEmitter<AgoClientEvents>;
  private activityLedger: ActivityLedger;
  private lastSentPageState: PageStateBaseline | null = null;
  private config: AgoConfig;

  /** Conversations already warned about an empty reply (one warning each). */
  private warnedEmptyConversations = new Set<string>();

  /** Paused turns awaiting auto-resume, keyed by assistant message id. */
  private pendingResumes = new Map<string, PendingResume>();

  /**
   * Client function invocations held pending user approval, keyed by
   * invocationId (the tool-call id). Populated when {@link requiresApproval}
   * matches; drained by {@link approveFunction} / {@link rejectFunction}.
   */
  private pendingApprovals = new Map<string, ClientFunctionInvocation>();

  /** App-provided gate deciding WHEN a paused turn resumes (see {@link registerResumeGate}). */
  private resumeGate: ResumeGate | null = null;

  /**
   * Proactive-mode controller, set when the client was created with
   * `proactive` options or when `createAgoProactive(client, opts)` was called.
   * `null` otherwise.
   */
  proactive: ProactiveController | null = null;

  constructor(config: AgoConfig) {
    validateConfig(config, "AgoClient");
    this.config = config;
    this.activityLedger = new ActivityLedger(config.maxActivityEntries);
    this.httpClient = new HttpClient(config);
    this.functionRegistry = new FunctionRegistry({
      maxResultBytes: config.maxFunctionResultBytes,
    });
    this.contextRegistry = new ClientContextRegistry();
    this.eventEmitter = new EventEmitter();
    this.registerActivityContext();

    if (config.debug) {
      logger.enable();
    }

    if (config.proactive) {
      createAgoProactive(this, config.proactive);
    }

    logger.log("AgoClient initialized");
  }

  // ─────────────────────────────────────────────────────────────────
  // Messaging
  // ─────────────────────────────────────────────────────────────────

  /**
   * Send a message and receive a streaming response
   */
  async sendMessage(
    content: string,
    options?: SendMessageOptions
  ): Promise<AgoMessage> {
    const clientFunctions = this.functionRegistry.getSchemas();

    const clientContext = this.buildSendContext();

    const configAgent = this.config.agent || this.config.defaultAgentId;

    const mode = this.resolveClientFunctionsMode(options);

    const body: Record<string, unknown> = {
      content,
      conversation_id: options?.conversationId,
      agent_id: options?.agentId || configAgent,
    };

    // Include client functions if any are registered
    if (clientFunctions.length > 0) {
      body.client_functions = clientFunctions;
      if (mode === "pause") {
        body.client_functions_mode = mode;
      }
    }

    // Include client-supplied context if any is registered
    if (clientContext) {
      body.client_context = clientContext;
    }

    // Hidden messages stay in the model's context but are not displayed.
    if (options?.hidden) {
      body.hidden = true;
    }

    let response: Response;

    if (options?.files && options.files.length > 0) {
      // Use FormData for file uploads
      const formData = new FormData();
      formData.append("content", content);

      if (options.conversationId) {
        formData.append("conversation_id", options.conversationId);
      }

      if (options.agentId || configAgent) {
        formData.append("agent_id", options.agentId || configAgent || "");
      }

      if (clientFunctions.length > 0) {
        formData.append("client_functions", JSON.stringify(clientFunctions));
        if (mode === "pause") {
          formData.append("client_functions_mode", mode);
        }
      }

      if (clientContext) {
        formData.append("client_context", JSON.stringify(clientContext));
      }

      if (options.hidden) {
        formData.append("hidden", "true");
      }

      for (const file of options.files) {
        formData.append("files", file);
      }

      response = await this.httpClient.postFormData("/api/sdk/v1/messages", formData);
    } else {
      response = await this.httpClient.postStream("/api/sdk/v1/messages", body);
    }

    return this.processSSEResponse(response);
  }

  private async processSSEResponse(response: Response): Promise<AgoMessage> {
    // One stream == one assistant message. Client-function invocations are
    // deliberately NOT in the final message's `toolCalls` (SSEHandler filters
    // `type === "client_function"`), and their payloads carry no messageId, so
    // an action-only turn (agent runs a function, replies with no text) is
    // tracked with this closure-local flag instead.
    let sawClientFunction = false;

    const handler = new SSEHandler({
      onRawChunk: (data) => {
        this.eventEmitter.emit("stream:message", data);
      },
      onStart: (data) => {
        this.eventEmitter.emit("message:start", data);
      },
      onChunk: (data) => {
        this.eventEmitter.emit("message:chunk", data);
      },
      onToolCall: (toolCall) => {
        this.eventEmitter.emit("toolCall:received", toolCall);

        if (toolCall.type === "form") {
          this.eventEmitter.emit("toolCall:form", toolCall);
        }
      },
      onClientFunction: async (data) => {
        sawClientFunction = true;
        this.eventEmitter.emit("function:invoke", data);
        this.recordAgentAction(data);
        // Gate on approval only when there's a pause to hold onto (invocationId
        // present == pause mode). Otherwise run immediately, as before.
        if (data.invocationId && this.requiresApproval(data)) {
          this.pendingApprovals.set(data.invocationId, data);
          this.eventEmitter.emit("function:awaiting-approval", data);
          return;
        }
        await this.handleClientFunctionInvocation(data);
      },
      onTitle: (data) => {
        this.eventEmitter.emit("conversation:title", data);
      },
      onAnswerComplete: (message) => {
        this.eventEmitter.emit("message:answer-complete", message);
      },
      onWaitingClient: (data) => {
        this.eventEmitter.emit("message:waiting-client", data);
        this.markResumeSignal(data.messageId, data.conversationId, "waitingConfirmed");
      },
      onComplete: (message) => {
        this.eventEmitter.emit("message:complete", message);
      },
      onError: (error) => {
        this.eventEmitter.emit("message:error", {
          error: error.message,
          code: error instanceof AgoError ? error.code : undefined,
        });
      },
    });

    const message = await handler.processStream(response);
    if (message.status !== "WAITING_CLIENT") {
      this.maybeFlagEmptyReply(message, sawClientFunction);
    }
    return message;
  }

  // ─────────────────────────────────────────────────────────────────
  // Pause / resume (client_functions_mode: "pause")
  // ─────────────────────────────────────────────────────────────────

  private resolveClientFunctionsMode(
    options?: SendMessageOptions
  ): ClientFunctionsMode {
    return (
      options?.clientFunctionsMode ?? this.config.clientFunctionsMode ?? "pause"
    );
  }

  /**
   * Register a gate deciding WHEN a paused turn resumes. The SDK still decides
   * *whether* (it resumes once every waiting result is submitted); the gate only
   * delays the continue call — e.g. `useAgoAutoContinueAfterNavigation` waits for
   * the destination page to register its page state. One gate at a time (last
   * registration wins). Returns an unregister function.
   */
  registerResumeGate(gate: ResumeGate): () => void {
    this.resumeGate = gate;
    return () => {
      if (this.resumeGate === gate) this.resumeGate = null;
    };
  }

  /**
   * Resume a turn paused on client function results (`WAITING_CLIENT`).
   *
   * Sends the CURRENT page's registered functions and context — the page may
   * have changed since the pause (that's the point of pausing on a navigation) —
   * and streams the continuation through the same event pipeline as
   * `sendMessage`, so `message:chunk` / `message:complete` (or another
   * `message:waiting-client` for chained pauses) fire as usual.
   *
   * The SDK calls this automatically after submitting the waiting results; call
   * it manually only for custom flows (e.g. after restoring a reloaded page via
   * {@link resumePendingClientFunctions}).
   */
  async continueMessage(messageId: string): Promise<AgoMessage> {
    const clientFunctions = this.functionRegistry.getSchemas();
    const clientContext = this.buildSendContext();

    const body: Record<string, unknown> = {};
    if (clientFunctions.length > 0) {
      body.client_functions = clientFunctions;
    }
    if (clientContext) {
      body.client_context = clientContext;
    }

    const response = await this.httpClient.postStream(
      `/api/sdk/v1/messages/${messageId}/continue`,
      body
    );
    return this.processSSEResponse(response);
  }

  /**
   * Record one of the two auto-resume preconditions for a paused turn and fire
   * the resume when both are in (see {@link PendingResume}).
   */
  private markResumeSignal(
    messageId: string,
    conversationId: string,
    signal: "waitingConfirmed" | "resultsReady"
  ): void {
    if (!messageId) return;
    const pending: PendingResume = this.pendingResumes.get(messageId) ?? {
      conversationId,
      waitingConfirmed: false,
      resultsReady: false,
      started: false,
    };
    pending[signal] = true;
    if (conversationId) pending.conversationId = conversationId;
    this.pendingResumes.set(messageId, pending);

    if (!pending.waitingConfirmed || !pending.resultsReady || pending.started) {
      return;
    }
    pending.started = true;
    void this.runAutoResume(messageId, pending.conversationId);
  }

  private async runAutoResume(
    messageId: string,
    conversationId: string
  ): Promise<void> {
    try {
      if (this.resumeGate) {
        await this.resumeGate({ conversationId, messageId });
      }
    } catch (gateError) {
      // The gate is a "when", not a "whether": never let it strand a paused
      // turn — resume anyway and let the agent conclude with what it has.
      logger.warn("Resume gate threw; resuming anyway:", gateError);
    }

    this.pendingResumes.delete(messageId);

    try {
      await this.continueMessage(messageId);
    } catch (error) {
      // A 409 means the turn moved on (new user message abandoned it, or a
      // concurrent continue won). That is a normal outcome, not an app error.
      logger.warn("Auto-resume of paused turn failed:", error);
    }
  }

  /**
   * Detect a reply that completed as DONE with no content and no activity —
   * today's backend answers an unknown `agent` slug with an empty 200, which
   * otherwise fails silently. Emits `message:empty` (always) and warns on the
   * console once per conversation (unless `warnOnEmptyReply: false`).
   *
   * Deferred with setTimeout(0) so both land AFTER `sendMessage` resolves:
   * `await client.sendMessage(...)` followed by `client.waitFor("message:empty")`
   * must not race. TEMPORARY heuristic: remove once the backend returns an
   * explicit error for unknown agents (see TODOS.md, backend issue).
   */
  private maybeFlagEmptyReply(message: AgoMessage, sawClientFunction: boolean): void {
    const isEmpty =
      message.status === "DONE" &&
      (message.content ?? "").trim() === "" &&
      !sawClientFunction &&
      !(message.toolCalls && message.toolCalls.length > 0) &&
      !(message.followUpReplies && message.followUpReplies.length > 0);

    if (!isEmpty) return;

    setTimeout(() => {
      this.eventEmitter.emit("message:empty", {
        conversationId: message.conversationId ?? "",
        messageId: message.id ?? "",
      });

      if (this.config.warnOnEmptyReply === false) return;

      const conversationKey = message.conversationId || "(no conversation)";
      if (this.warnedEmptyConversations.has(conversationKey)) return;
      this.warnedEmptyConversations.add(conversationKey);

      const agent = this.config.agent || this.config.defaultAgentId;
      if (!message.id) {
        // Stream completed without any message data at all. Live backends
        // currently answer an UNKNOWN AGENT SLUG this way too (empty 200, no
        // envelope), so name both causes when an agent is configured.
        console.warn(
          "[AGO] The stream completed without any message data. Possible causes: " +
            (agent ? `the agent "${agent}" may not exist for this tenant, or ` : "") +
            "`baseUrl` does not point at an AGO endpoint that returns server-sent " +
            "events. Listen for the `message:empty` event to handle this in your " +
            "app; silence this warning with `warnOnEmptyReply: false`."
        );
      } else {
        console.warn(
          "[AGO] Reply completed with empty content. Possible causes: " +
            (agent
              ? `the agent "${agent}" may not exist for this tenant, `
              : "an unknown `agent` slug, ") +
            "or the agent replied with no text. Listen for the `message:empty` " +
            "event to handle this in your app; silence this warning with " +
            "`warnOnEmptyReply: false`."
        );
      }
    }, 0);
  }

  private async handleClientFunctionInvocation(data: {
    invocationId: string;
    functionName: string;
    arguments: Record<string, unknown>;
    conversationId: string;
  }): Promise<void> {
    let result: unknown;
    let error: string | undefined;

    try {
      result = await this.functionRegistry.execute(data.functionName, data.arguments);
    } catch (err) {
      error = err instanceof Error ? err.message : "Unknown error";
      logger.error("Client function execution failed:", err);
    }

    // Submit result back to backend using existing tool-call submit endpoint.
    // The raw state SSE event carries no invocationId — in that flow the backend
    // already continued with a placeholder, so we just emit the local event.
    if (data.invocationId) {
      try {
        const submitResult = await this.submitToolCallForm(data.invocationId, {
          result,
          error,
          _type: "client_function_result",
        });
        // Pause mode: the backend flags when EVERY waiting call of the paused
        // turn has its result. Combined with the stream's WAITING_CLIENT close,
        // this triggers the auto-resume (see markResumeSignal).
        if (submitResult?.resume?.ready) {
          this.markResumeSignal(
            submitResult.resume.message_id,
            data.conversationId,
            "resultsReady"
          );
        }
      } catch (submitError) {
        logger.error("Failed to submit function result:", submitError);
      }
    }

    this.eventEmitter.emit("function:result", {
      invocationId: data.invocationId,
      result,
      error,
    });
  }

  /**
   * Whether a client function invocation must wait for explicit user approval.
   * True when the {@link AgoConfig.approvalPolicy} returns true OR the function
   * was registered with `requiresApproval: true` — the two OR together.
   */
  private requiresApproval(invocation: ClientFunctionInvocation): boolean {
    const policy = this.config.approvalPolicy;
    if (policy) {
      try {
        if (policy(invocation)) return true;
      } catch (err) {
        // A throwing policy must never strand a turn — treat it as "no gate".
        logger.warn("approvalPolicy threw; not gating this call:", err);
      }
    }
    return this.functionRegistry.get(invocation.functionName)?.requiresApproval === true;
  }

  /**
   * Approve a client function call held by the approval gate: run it, submit its
   * result, and let the paused turn resume. No-op if the invocation is unknown
   * (already handled, or never gated).
   */
  async approveFunction(invocationId: string): Promise<void> {
    const data = this.pendingApprovals.get(invocationId);
    if (!data) return;
    this.pendingApprovals.delete(invocationId);
    await this.handleClientFunctionInvocation(data);
  }

  /**
   * Reject a client function call held by the approval gate: submit a rejection
   * result so the agent sees the user declined, and let the paused turn resume
   * (the agent decides what to do next). No-op if the invocation is unknown.
   */
  async rejectFunction(invocationId: string): Promise<void> {
    const data = this.pendingApprovals.get(invocationId);
    if (!data) return;
    this.pendingApprovals.delete(invocationId);

    const rejection = { approved: false, reason: "user_rejected" };
    try {
      const submitResult = await this.submitToolCallForm(invocationId, {
        result: rejection,
        _type: "client_function_result",
      });
      if (submitResult?.resume?.ready) {
        this.markResumeSignal(
          submitResult.resume.message_id,
          data.conversationId,
          "resultsReady"
        );
      }
    } catch (submitError) {
      logger.error("Failed to submit function rejection:", submitError);
    }

    this.eventEmitter.emit("function:result", {
      invocationId,
      result: rejection,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Conversations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get a page of conversations, newest-first. `pageSize` is capped at 100 by
   * the backend (default 50). Returns the `{ data, has_more, total }` envelope
   * so callers can page; `total` counts across all pages.
   */
  async getConversations(options?: {
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<Conversation>> {
    const query = new URLSearchParams();
    if (options?.page !== undefined) query.set("page", String(options.page));
    if (options?.pageSize !== undefined)
      query.set("page_size", String(options.pageSize));
    const qs = query.toString();

    const response = await this.httpClient.get<{
      data?: Array<{
        id: string;
        title?: string | null;
        created_at?: string | null;
        last_message_at?: string | null;
      }>;
      has_more?: boolean;
      total?: number;
    }>(`/api/sdk/v1/conversations${qs ? `?${qs}` : ""}`);

    const rows = Array.isArray(response.data) ? response.data : [];
    const data: Conversation[] = rows.map((row) => ({
      id: String(row.id),
      title: row.title ?? "",
      lastMessageDate: new Date(row.last_message_at ?? row.created_at ?? 0),
    }));

    return {
      data,
      hasMore: response.has_more ?? false,
      total: response.total ?? data.length,
    };
  }

  /**
   * Get a specific conversation with messages
   */
  async getConversation(conversationId: string): Promise<Conversation> {
    const response = await this.httpClient.get<{
      id: string;
      title: string;
      created_at?: string | null;
      last_message_at?: string | null;
      messages: Array<{
        id: string;
        content: string;
        role: "user" | "assistant";
        status: string;
        created_at: string;
        hidden?: boolean;
        tool_call_data?: Array<Record<string, unknown>>;
        attachments?: Array<Record<string, unknown>>;
      }>;
    }>(`/api/sdk/v1/conversations/${conversationId}`);

    const conversation: Conversation = {
      id: response.id,
      title: response.title,
      lastMessageDate: new Date(
        response.last_message_at ?? response.created_at ?? 0
      ),
      messages: response.messages.map((m) => ({
        id: m.id,
        conversationId: response.id,
        content: m.content,
        role: m.role,
        status: m.status as AgoMessage["status"],
        createdAt: new Date(m.created_at),
        hidden: m.hidden,
        toolCalls: AgoClient.mapPersistedToolCalls(m.tool_call_data),
        attachments:
          m.attachments && m.attachments.length > 0
            ? m.attachments.map(mapAttachment)
            : undefined,
      })),
    };

    // Let stateful helpers (e.g. createFormCollector) replay the conversation's
    // tool calls to restore their state. Fires only on an explicit server load —
    // never during live streaming — so it can't clobber freshly built state.
    this.eventEmitter.emit("conversation:loaded", conversation);

    return conversation;
  }

  /**
   * Map the backend's snake_case `tool_call_data` entries onto the camelCase
   * {@link ToolCallData} shape used everywhere else in the SDK. Mirrors
   * `SSEHandler.parseToolCall` so persisted and streamed tool calls match.
   */
  private static mapPersistedToolCalls(
    raw?: Array<Record<string, unknown>>
  ): ToolCallData[] | undefined {
    if (!raw || raw.length === 0) return undefined;
    return raw.map((tc) => ({
      id: String(tc.id ?? ""),
      type: (tc.type as ToolCallData["type"]) ?? "status_message",
      status: String(tc.status ?? "unknown"),
      toolName: (tc.tool_name as string) ?? "",
      toolDisplayName: tc.tool_display_name as string | undefined,
      message: tc.message as string | undefined,
      formSchema: tc.form_schema as ToolCallData["formSchema"],
      data: tc.data as Record<string, unknown> | undefined,
      functionName: tc.function_name as string | undefined,
      arguments: tc.arguments as Record<string, unknown> | undefined,
    }));
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId: string): Promise<AgoMessage[]> {
    const conversation = await this.getConversation(conversationId);
    return conversation.messages || [];
  }

  /**
   * Resume a turn left paused on client function results by a page reload.
   *
   * A paused turn (pause mode) survives a full reload: the backend keeps the
   * assistant message in `WAITING_CLIENT` with its waiting tool calls. After
   * restoring the conversation (`getConversation`) and re-registering the page's
   * functions, call this: it re-executes each waiting client function through the
   * registry, submits the results, and continues the turn.
   *
   * Opt-in on purpose — re-running functions on reload can be surprising (e.g. a
   * navigation function would navigate again), so the app decides. Returns the
   * resumed turn's final message, or `null` when there was nothing to resume,
   * some waiting function is not registered on this page, or a waiting call is
   * gated by the approval policy (it is held for `approveFunction` /
   * `rejectFunction` and the turn stays paused, exactly as on the live stream).
   */
  async resumePendingClientFunctions(
    conversation: Conversation
  ): Promise<AgoMessage | null> {
    const paused = [...(conversation.messages ?? [])]
      .reverse()
      .find((m) => m.role === "assistant" && m.status === "WAITING_CLIENT");
    if (!paused) return null;

    const waitingCalls = (paused.toolCalls ?? []).filter(
      (tc) =>
        tc.type === "client_function" &&
        tc.status === "waiting_input" &&
        tc.functionName
    );

    const registered = new Set(
      this.functionRegistry.getSchemas().map((f) => f.name)
    );
    const missing = waitingCalls.filter((tc) => !registered.has(tc.functionName!));
    if (missing.length > 0) {
      logger.warn(
        "Cannot resume paused turn: function(s) not registered on this page:",
        missing.map((tc) => tc.functionName)
      );
      return null;
    }

    let ready = waitingCalls.length === 0;
    for (const call of waitingCalls) {
      const invocation: ClientFunctionInvocation = {
        invocationId: call.id,
        functionName: call.functionName!,
        arguments: call.arguments ?? {},
        conversationId: conversation.id,
      };
      // Apply the same approval gate as the live stream (see onClientFunction):
      // a gated call must not run unattended on reload. Hold it for
      // approveFunction / rejectFunction and keep the turn paused.
      if (this.requiresApproval(invocation)) {
        this.pendingApprovals.set(call.id, invocation);
        // The backend already persisted this turn as WAITING_CLIENT (that's why
        // it restored paused), so record the "waiting confirmed" resume signal
        // now. Without it, a later approveFunction/rejectFunction would submit
        // the result (resultsReady) but never fire the auto-resume, stranding the
        // turn forever — the live path gets this signal from the stream close.
        this.markResumeSignal(paused.id, conversation.id, "waitingConfirmed");
        this.eventEmitter.emit("function:awaiting-approval", invocation);
        ready = false;
        continue;
      }
      let result: unknown;
      let error: string | undefined;
      try {
        result = await this.functionRegistry.execute(
          call.functionName!,
          call.arguments ?? {}
        );
      } catch (err) {
        error = err instanceof Error ? err.message : "Unknown error";
        logger.error("Client function execution failed:", err);
      }
      const submitResult = await this.submitToolCallForm(call.id, {
        result,
        error,
        _type: "client_function_result",
      });
      ready = submitResult?.resume?.ready ?? ready;
    }

    if (!ready) return null;
    return this.continueMessage(paused.id);
  }

  // ─────────────────────────────────────────────────────────────────
  // Tool Calls
  // ─────────────────────────────────────────────────────────────────

  /**
   * Submit form data for a tool call. The response's `resume` field (pause mode
   * only) tells whether the paused turn is ready to be resumed.
   */
  async submitToolCallForm(
    toolCallId: string,
    formData: Record<string, unknown>
  ): Promise<SubmitToolCallResult> {
    return this.httpClient.post<SubmitToolCallResult>(
      `/api/sdk/v1/tool-calls/${toolCallId}/submit`,
      { formData }
    );
  }

  /**
   * Confirm a tool call
   */
  async confirmToolCall(toolCallId: string): Promise<void> {
    await this.httpClient.post(`/api/tool-calls/${toolCallId}/confirm/`);
  }

  /**
   * Reject a tool call
   */
  async rejectToolCall(toolCallId: string): Promise<void> {
    await this.httpClient.post(`/api/tool-calls/${toolCallId}/reject/`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Forms
  // ─────────────────────────────────────────────────────────────────

  /**
   * Fetch a backend-stored form collector definition by name (the single source
   * of truth for the form's description, schema, and submit target). Used by
   * `loadFormCollector` / the name-only form of `useFormCollector` so the schema
   * lives in the backend instead of being hardcoded in client code.
   */
  async getFormCollector(name: string): Promise<FormCollectorDefinition> {
    const response = await this.httpClient.get<{
      name: string;
      description: string;
      schema: FormCollectorSchema;
      submit?: SubmitConfig | null;
    }>(`/api/sdk/v1/forms/${encodeURIComponent(name)}`);

    return {
      name: response.name,
      description: response.description,
      schema: response.schema,
      // Backend stores null for "collect only"; the SDK uses `undefined`/`false`.
      submit: response.submit ?? undefined,
    };
  }

  /**
   * Relay a completed form collector's values to a server-configured destination.
   *
   * Used by `createFormCollector` / `useFormCollector` in `{ via: "backend" }` mode:
   * the browser never holds the destination name, URL, or its secret — the backend
   * resolves the destination from the named form's stored definition and forwards
   * the values from the server.
   */
  async submitFormCollector(
    name: string,
    values: Record<string, unknown>
  ): Promise<unknown> {
    return this.httpClient.post("/api/sdk/v1/forms/submit", {
      name,
      values,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Feedback
  // ─────────────────────────────────────────────────────────────────

  /**
   * Submit feedback for a message
   */
  async submitFeedback(
    messageId: string,
    rating: "positive" | "negative"
  ): Promise<void> {
    await this.httpClient.post(`/api/sdk/v1/messages/${messageId}/feedback`, {
      rating,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Client-side Functions
  // ─────────────────────────────────────────────────────────────────

  /**
   * Register a client-side function that AGO can call.
   * Accepts either a definition object or (name, handler, schema) args.
   *
   * ```ts
   * // Single-object (preferred)
   * client.registerFunction({
   *   name: "lookupOrder",
   *   description: "Look up an order",
   *   parameters: { type: "object", properties: { id: { type: "string" } } },
   *   handler: async (args) => fetchOrder(args.id),
   * });
   *
   * // Classic 3-arg form
   * client.registerFunction("lookupOrder", handler, schema);
   * ```
   */
  registerFunction(definition: ClientFunctionDefinition): void;
  registerFunction(
    name: string,
    handler: ClientFunctionHandler,
    schema: ClientFunctionRegisterOptions
  ): void;
  registerFunction(
    nameOrDef: string | ClientFunctionDefinition,
    handler?: ClientFunctionHandler,
    schema?: ClientFunctionRegisterOptions
  ): void {
    if (typeof nameOrDef === "object") {
      this.functionRegistry.register(nameOrDef);
    } else {
      this.functionRegistry.register(nameOrDef, handler!, schema!);
    }
  }

  /**
   * Short alias for `registerFunction`. Also accepts an array of definitions.
   *
   * ```ts
   * client.register(lookupOrder);
   * client.register([lookupOrder, cancelOrder]);
   * ```
   */
  register(
    definition: ClientFunctionDefinition | ClientFunctionDefinition[]
  ): void {
    if (Array.isArray(definition)) {
      for (const def of definition) {
        this.functionRegistry.register(def);
      }
    } else {
      this.functionRegistry.register(definition);
    }
  }

  /**
   * Unregister a client-side function
   */
  unregisterFunction(name: string): boolean {
    return this.functionRegistry.unregister(name);
  }

  /**
   * Get all registered function schemas
   */
  getRegisteredFunctions(): ClientFunctionSchema[] {
    return this.functionRegistry.getSchemas();
  }

  /**
   * Execute a registered client function locally, through the same
   * FunctionRegistry path (result-size guard, error wrapping) as agent-invoked
   * calls. Used by proactive nudge actions, where the user's explicit click on
   * the action button constitutes the approval — nothing is submitted to the
   * backend (there is no tool call to answer).
   */
  async executeClientFunction(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    return this.functionRegistry.execute(name, args);
  }

  /**
   * Register a navigation function that lets AGO navigate users to different pages.
   *
   * Also registers a dynamic context entry (`current-page`) that reports the page
   * the user is currently on, by route name, on every message. This is what lets
   * the agent know *where* it is after it navigates (e.g. so auto-continuation
   * can apply page state on the destination), not just how to navigate away.
   *
   * Routes may contain `:param` placeholders (`/users/:id`). Each distinct
   * placeholder becomes a top-level string argument of `navigateToPage`
   * (`{ page: "userDetail", id: "42" }`), so one route covers every detail
   * page of an entity. Flat arguments only: nested object parameters are not
   * reliably rendered to the model, so placeholders must not be named `page`.
   *
   * @param navigate - A callback that performs the navigation (e.g. react-router's navigate)
   * @param routes - Map of route names to paths, with descriptions for the LLM
   */
  registerNavigationFunction(
    navigate: (path: string) => void,
    routes: Array<{ name: string; path: string; description: string }>
  ): void {
    const routeNames = routes.map((r) => r.name);
    const routeDescriptions = routes
      .map((r) => {
        const params = routeParamNames(r.path);
        const paramNote =
          params.length > 0
            ? ` (requires ${params.map((p) => `"${p}"`).join(", ")})`
            : "";
        return `- "${r.name}"${paramNote}: ${r.description}`;
      })
      .join("\n");

    // One top-level argument per distinct placeholder, listing the pages that
    // need it. Flat scalar properties are what schemas support end to end.
    const paramUsage = new Map<string, string[]>();
    for (const r of routes) {
      for (const param of routeParamNames(r.path)) {
        paramUsage.set(param, [...(paramUsage.get(param) ?? []), r.name]);
      }
    }

    const properties: ClientFunctionSchema["parameters"]["properties"] = {
      page: {
        type: "string",
        description: "The page to navigate to",
        enum: routeNames,
      },
    };
    for (const [param, usedBy] of paramUsage) {
      if (param === "page") {
        logger.error(
          'registerNavigationFunction: a ":page" placeholder collides with the "page" argument and is ignored. Rename the placeholder.'
        );
        continue;
      }
      properties[param] = {
        type: "string",
        description: `Value for ":${param}" in the page path. Required when page is ${usedBy
          .map((n) => `"${n}"`)
          .join(" or ")}.`,
      };
    }

    this.registerFunction(
      "navigateToPage",
      async (args) => {
        const pageName = args.page as string;
        const route = routes.find((r) => r.name === pageName);
        if (!route) {
          return { success: false, error: `Unknown page: ${pageName}` };
        }

        // Params arrive as top-level arguments. Some models still nest them
        // under a "params" object (or a JSON string of one); accept those too.
        let nested: Record<string, unknown> = {};
        if (typeof args.params === "string") {
          try {
            nested = JSON.parse(args.params) as Record<string, unknown>;
          } catch {
            // fall through to the missing-params error below
          }
        } else if (args.params && typeof args.params === "object") {
          nested = args.params as Record<string, unknown>;
        }

        const values: Record<string, unknown> = {};
        for (const name of routeParamNames(route.path)) {
          values[name] = args[name] ?? nested[name];
        }

        const { path, missing } = fillRouteParams(route.path, values);
        if (missing.length > 0) {
          const example = missing.map((m) => `"${m}": "..."`).join(", ");
          return {
            success: false,
            error: `Page "${pageName}" needs ${missing
              .map((m) => `"${m}"`)
              .join(", ")}. Retry with { "page": "${pageName}", ${example} }.`,
          };
        }

        navigate(path);
        return { success: true, navigatedTo: path };
      },
      {
        description: `Navigate the user to a page in the application. Available pages:\n${routeDescriptions}`,
        parameters: {
          type: "object",
          properties,
          required: ["page"],
        },
      }
    );

    // Report the current page (by route name) as dynamic context, re-evaluated
    // on every message. Without this the agent knows how to navigate but never
    // which page the user is actually on.
    this.addDynamicContext("current-page", () => {
      if (typeof window === "undefined" || !window.location) return null;
      const url = window.location.href;
      const title = typeof document !== "undefined" ? document.title : undefined;
      const match = matchRoute(window.location.pathname, routes);

      const data: Record<string, unknown> = { url };
      if (match) data.page = match.name;
      if (title) data.title = title;

      return {
        name: "Current page",
        description: "The page the user is currently viewing.",
        data,
      };
    });
  }

  /**
   * Unregister the navigation function and its `current-page` context provider.
   */
  unregisterNavigationFunction(): void {
    this.unregisterFunction("navigateToPage");
    this.removeDynamicContext("current-page");
  }

  /**
   * Register a "page state" function that lets AGO change the current page's
   * state (filters, sort, view mode, selection…) and reads the current state
   * back as dynamic context. This is the state-mutation mirror of
   * {@link registerNavigationFunction}.
   *
   * It does two things:
   * - Synthesizes ONE client function (default name `setPageState`) whose
   *   properties are the controls — all optional, so the agent sets only the
   *   ones the user asked for.
   * - Registers a dynamic context provider (keyed `page-state:<fnName>`) that
   *   reports each control's current `get()` value on every message.
   *
   * ```ts
   * client.registerPageStateFunction([
   *   {
   *     name: "statusFilter",
   *     description: "Filter the list by review status",
   *     schema: { type: "string", enum: ["all", "pending", "approved"] },
   *     get: () => filters.status,
   *     set: (v) => setFilters({ ...filters, status: v }),
   *   },
   * ]);
   * ```
   */
  registerPageStateFunction(
    controls: AgoStateControl[],
    opts?: AgoPageStateOptions
  ): void {
    const fnName = opts?.functionName ?? "setPageState";
    const byName = new Map(controls.map((c) => [c.name, c]));

    const controlDescriptions = controls
      .map((c) => `- "${c.name}": ${c.description}`)
      .join("\n");

    this.registerFunction(
      fnName,
      async (args) => {
        const applied: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args)) {
          if (value === undefined) continue;
          const control = byName.get(key);
          // Ignore unknown controls cleanly.
          if (!control) continue;
          await control.set(value);
          applied[key] = value;
        }
        return { success: true, applied };
      },
      {
        description: `Change the state of the current page. Set ONLY the controls the user explicitly asked for; leave the others unset. Available controls:\n${controlDescriptions}`,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            controls.map((c) => [
              c.name,
              { ...c.schema, description: c.description },
            ])
          ),
          // All optional: the agent sets only what the user asked for.
        },
        requiresApproval: opts?.requiresApproval,
      }
    );

    // Surface the current value of every control that can be read, so the agent
    // knows what to change. Re-evaluated on every message (like navigation is
    // static, this mirror is live).
    this.addDynamicContext(`page-state:${fnName}`, () => {
      const readable = controls.filter((c) => typeof c.get === "function");
      if (readable.length === 0) return null;
      const data: Record<string, unknown> = {};
      for (const control of readable) {
        data[control.name] = control.get!();
      }
      return {
        name: "Page state",
        description: "Current, editable state of the page the user is viewing.",
        data,
      };
    });
  }

  /**
   * Unregister a page state function and its dynamic context provider.
   * Mirror of unregistering `navigateToPage`.
   */
  unregisterPageStateFunction(functionName?: string): void {
    const fnName = functionName ?? "setPageState";
    this.unregisterFunction(fnName);
    this.removeDynamicContext(`page-state:${fnName}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Client Context
  // ─────────────────────────────────────────────────────────────────

  /**
   * Register or update a piece of client-side context.
   * This context is sent with every message so the AI understands the user's situation.
   *
   * ```ts
   * client.setContext("order-page", {
   *   name: "Order detail",
   *   description: "User is viewing order #123",
   *   data: { orderId: "123", status: "shipped" },
   * });
   * ```
   */
  setContext(key: string, entry: ContextEntry): void {
    this.contextRegistry.set(key, entry);
    this.notifyContextChanged();
  }

  /**
   * Remove a previously registered context entry.
   */
  removeContext(key: string): boolean {
    const removed = this.contextRegistry.remove(key);
    if (removed) this.notifyContextChanged();
    return removed;
  }

  /**
   * Register a dynamic context provider. The callback is invoked every time
   * a message is sent, so the AI always gets the freshest data.
   *
   * Use this for context that lives outside React state — global stores,
   * refs, or computed values.
   *
   * ```ts
   * client.addDynamicContext("cart", () => ({
   *   name: "Checkout",
   *   data: { itemCount: cart.items.length, total: cart.total },
   * }));
   * ```
   */
  addDynamicContext(key: string, provider: DynamicContextProvider): void {
    this.contextRegistry.addDynamicProvider(key, provider);
    this.notifyContextChanged();
  }

  /**
   * Remove a dynamic context provider.
   */
  removeDynamicContext(key: string): boolean {
    const removed = this.contextRegistry.removeDynamicProvider(key);
    if (removed) this.notifyContextChanged();
    return removed;
  }

  /**
   * Broadcast that the client-side context changed by emitting `context:changed`
   * with the fresh snapshot. The context-mutating methods call this automatically;
   * stateful helpers whose context lives in a store (e.g. `createFormCollector`)
   * call it when their store updates so observers like the dev panel stay live.
   */
  notifyContextChanged(): void {
    this.eventEmitter.emit("context:changed", this.contextRegistry.getSnapshot());
  }

  /**
   * @internal Surface a form collector's submit outcome on the client event bus.
   * Used by {@link createFormCollector} so consumers can listen via
   * `client.on("form:submitted" | "form:error", ...)` without exposing a generic
   * `emit`.
   */
  emitFormEvent<K extends "form:submitted" | "form:error">(
    event: K,
    data: AgoClientEvents[K],
  ): void {
    this.eventEmitter.emit(event, data);
  }

  /**
   * @internal Surface a proactive nudge event on the client event bus. Used by
   * the proactive engine (see {@link createAgoProactive}) so consumers can
   * listen via `client.on("nudge:ready" | "nudge:shown" | ...)` without
   * exposing a generic `emit`.
   */
  emitProactiveEvent<
    K extends "nudge:ready" | "nudge:shown" | "nudge:dismissed" | "nudge:accepted",
  >(event: K, data: AgoClientEvents[K]): void {
    this.eventEmitter.emit(event, data);
  }

  /**
   * @internal Transport shared with SDK-internal attachments (proactive
   * engine, event tracker) so their calls carry the same auth headers as
   * every other SDK request.
   */
  getHttp(): HttpClient {
    return this.httpClient;
  }

  /** @internal The agent (id or slug) the client is configured to talk to. */
  getConfiguredAgent(): string | undefined {
    return this.config.agent || this.config.defaultAgentId;
  }

  /**
   * Enable automatic capture of the current browser page (URL + title).
   * Injected as a dynamic context entry named `browser-page`.
   */
  enableAutoPageContext(): void {
    this.addDynamicContext("browser-page", () => {
      const url = typeof window !== "undefined" ? window.location.href : undefined;
      const title = typeof document !== "undefined" ? document.title : undefined;
      if (!url && !title) return null;
      return {
        name: "Browser page",
        description: "Current page the user is viewing",
        data: { url, title },
      };
    });
  }

  /**
   * Get the current context snapshot.
   */
  getContextSnapshot(): ContextSnapshot | null {
    return this.contextRegistry.getSnapshot();
  }

  // Snapshot for an outgoing message: advances the page-state baseline and
  // appends a `state:delta` entry describing what changed since the last send.
  private buildSendContext(): ContextSnapshot | null {
    const snapshot = this.contextRegistry.getSnapshot();
    const entries = snapshot?.entries ?? {};
    const { changes, baseline } = computePageStateDelta(
      this.lastSentPageState,
      entries
    );
    this.lastSentPageState = baseline;
    if (changes.length === 0) return snapshot;
    return {
      entries: {
        ...entries,
        [STATE_DELTA_CONTEXT_KEY]: {
          name: "State changes",
          description:
            "Fields in the page state that changed since your last message, " +
            "as field: <old> -> <new>.",
          data: { changes },
        },
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Activity ledger
  // ─────────────────────────────────────────────────────────────────

  /**
   * Record something the user just did so the agent is aware of it on the next
   * message. `actor` defaults to `"user"`. Keep `summary` short and high-signal
   * (no raw payloads, secrets, or PII).
   */
  recordActivity(entry: ActivityInput): void {
    this.addActivity(entry);
  }

  /** Recent user + agent actions, oldest first (a copy). */
  getRecentActivity(): ActivityEntry[] {
    return this.activityLedger.getRecent();
  }

  clearActivity(): void {
    this.activityLedger.clear();
  }

  private addActivity(entry: ActivityInput): void {
    const recorded = this.activityLedger.add(entry);
    this.eventEmitter.emit("activity:recorded", recorded);
  }

  private recordAgentAction(data: ClientFunctionInvocation): void {
    const fn = data.functionName;
    const args = data.arguments;
    let name: string;
    let summary: string;
    if (fn === "navigateToPage") {
      const page = args?.page;
      name = "agent.navigate";
      summary = page ? `Agent navigated to "${String(page)}"` : "Agent navigated";
    } else if (fn === "setPageState") {
      name = "agent.page_state";
      summary = "Agent changed the page state";
    } else {
      name = `agent.${fn}`;
      summary = `Agent ran "${fn}"`;
    }
    this.addActivity({
      actor: "agent",
      name,
      summary,
      ...(args && Object.keys(args).length > 0 ? { data: { arguments: args } } : {}),
    });
  }

  // Re-registered from reviveAfterDestroy (destroy clears the context registry,
  // but the ledger itself survives on the instance).
  private registerActivityContext(): void {
    this.contextRegistry.addDynamicProvider(ACTIVITY_CONTEXT_KEY, () => {
      const events = this.activityLedger.getRecent();
      if (events.length === 0) return null;
      return {
        name: "Recent activity",
        description:
          "Recent actions by the user and the agent in the app, oldest first. " +
          "Use this to understand what just happened before this message.",
        data: { events },
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────

  /**
   * Subscribe to an event
   */
  on<K extends AgoEventName>(event: K, handler: AgoEventHandler<K>): void {
    this.eventEmitter.on(event, handler);
  }

  /**
   * Unsubscribe from an event
   */
  off<K extends AgoEventName>(event: K, handler: AgoEventHandler<K>): void {
    this.eventEmitter.off(event, handler);
  }

  /**
   * Subscribe to an event once — auto-unsubscribes after the first call.
   */
  once<K extends AgoEventName>(event: K, handler: AgoEventHandler<K>): void {
    this.eventEmitter.once(event, handler);
  }

  /**
   * Returns a Promise that resolves the next time `event` fires.
   *
   * ```ts
   * const msg = await client.waitFor("message:complete", { timeout: 10000 });
   * ```
   */
  waitFor<K extends AgoEventName>(
    event: K,
    options?: { timeout?: number }
  ): Promise<AgoClientEvents[K]> {
    return this.eventEmitter.waitFor(event, options);
  }

  // ─────────────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────────────

  /**
   * Update client configuration
   *
   * Validates the MERGED config before committing: omitting a key (or passing
   * it as `undefined`, common with spread-built partials) keeps the current
   * value; an explicit empty/non-string `baseUrl` throws `config_missing_base_url`
   * and leaves the client unchanged (no half-updated state).
   */
  updateConfig(config: Partial<AgoConfig>): void {
    // Normalize explicit `undefined` to "absent" (standard optional-property
    // semantics) so it cannot clobber the stored value through the spread.
    const cleaned: Partial<AgoConfig> = {};
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        (cleaned as Record<string, unknown>)[key] = value;
      }
    }

    const merged = { ...this.config, ...cleaned };
    validateConfig(merged, "AgoClient.updateConfig");

    this.config = merged;
    this.httpClient.updateConfig(cleaned);

    if (cleaned.debug !== undefined) {
      if (cleaned.debug) {
        logger.enable();
      } else {
        logger.disable();
      }
    }

    if (cleaned.maxFunctionResultBytes !== undefined) {
      this.functionRegistry.setDefaultMaxResultBytes(
        cleaned.maxFunctionResultBytes
      );
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.proactive?.destroy();
    this.proactive = null;
    this.eventEmitter.removeAllListeners();
    this.functionRegistry.clear();
    this.contextRegistry.clear();
    this.pendingResumes.clear();
    this.pendingApprovals.clear();
    this.resumeGate = null;
    logger.log("AgoClient destroyed");
  }

  /**
   * @internal Re-attach constructor-owned attachments after a {@link destroy}.
   *
   * React StrictMode's simulated unmount runs `useAgo`'s cleanup — which
   * destroys the memoized client — then remounts with the SAME instance.
   * Hooks re-register their functions, listeners and context on their own in
   * their re-run effects; the proactive controller is the only
   * constructor-owned attachment, so it must be revived explicitly.
   */
  reviveAfterDestroy(): void {
    this.registerActivityContext();
    if (this.config.proactive && !this.proactive) {
      createAgoProactive(this, this.config.proactive);
    }
  }
}
