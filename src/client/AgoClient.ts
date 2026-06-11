import { HttpClient } from "../api/HttpClient";
import { FunctionRegistry } from "../functions/FunctionRegistry";
import type { ClientFunctionDefinition, ClientFunctionHandler, ClientFunctionSchema } from "../functions/types";
import { ClientContextRegistry } from "../state/ClientContextRegistry";
import type {
  ContextEntry,
  ContextSnapshot,
  DynamicContextProvider,
} from "../state/ClientContextRegistry";
import { SSEHandler } from "../streaming/SSEHandler";
import { EventEmitter } from "../utils/eventEmitter";
import { logger } from "../utils/logger";
import type {
  AgoConfig,
  AgoClientEvents,
  AgoEventName,
  AgoEventHandler,
  AgoMessage,
  Conversation,
  SendMessageOptions,
  ToolCallData,
} from "./types";

/**
 * Main SDK client for AGO Chat integration
 */
export class AgoClient {
  private httpClient: HttpClient;
  private functionRegistry: FunctionRegistry;
  private contextRegistry: ClientContextRegistry;
  private eventEmitter: EventEmitter<AgoClientEvents>;
  private config: AgoConfig;

  constructor(config: AgoConfig) {
    this.config = config;
    this.httpClient = new HttpClient(config);
    this.functionRegistry = new FunctionRegistry();
    this.contextRegistry = new ClientContextRegistry();
    this.eventEmitter = new EventEmitter();

    if (config.debug) {
      logger.enable();
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

    const clientContext = this.contextRegistry.getSnapshot();

    const configAgent = this.config.agent || this.config.defaultAgentId;

    const body: Record<string, unknown> = {
      content,
      conversation_id: options?.conversationId,
      agent_id: options?.agentId || configAgent,
    };

    // Include client functions if any are registered
    if (clientFunctions.length > 0) {
      body.client_functions = clientFunctions;
    }

    // Include client-supplied context if any is registered
    if (clientContext) {
      body.client_context = clientContext;
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
      }

      if (clientContext) {
        formData.append("client_context", JSON.stringify(clientContext));
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
    const handler = new SSEHandler({
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
        this.eventEmitter.emit("function:invoke", data);
        await this.handleClientFunctionInvocation(data);
      },
      onAnswerComplete: (message) => {
        this.eventEmitter.emit("message:answer-complete", message);
      },
      onComplete: (message) => {
        this.eventEmitter.emit("message:complete", message);
      },
      onError: (error) => {
        this.eventEmitter.emit("message:error", { error: error.message });
      },
    });

    return handler.processStream(response);
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
        await this.submitToolCallForm(data.invocationId, {
          result,
          error,
          _type: "client_function_result",
        });
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

  // ─────────────────────────────────────────────────────────────────
  // Conversations
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get list of conversations
   */
  async getConversations(): Promise<Conversation[]> {
    const response = await this.httpClient.get<{
      count: number;
      items: Array<{
        id: string;
        title: string;
        last_message_date: string;
      }>;
    }>("/api/sdk/v1/conversations");

    return response.items.map((item) => ({
      id: item.id,
      title: item.title,
      lastMessageDate: new Date(item.last_message_date),
    }));
  }

  /**
   * Get a specific conversation with messages
   */
  async getConversation(conversationId: string): Promise<Conversation> {
    const response = await this.httpClient.get<{
      id: string;
      title: string;
      last_message_date: string;
      messages: Array<{
        id: string;
        content: string;
        role: "user" | "assistant";
        status: string;
        created_at: string;
        tool_call_data?: Array<Record<string, unknown>>;
      }>;
    }>(`/api/sdk/v1/conversations/${conversationId}`);

    const conversation: Conversation = {
      id: response.id,
      title: response.title,
      lastMessageDate: new Date(response.last_message_date),
      messages: response.messages.map((m) => ({
        id: m.id,
        conversationId: response.id,
        content: m.content,
        role: m.role,
        status: m.status as AgoMessage["status"],
        createdAt: new Date(m.created_at),
        toolCalls: AgoClient.mapPersistedToolCalls(m.tool_call_data),
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

  // ─────────────────────────────────────────────────────────────────
  // Tool Calls
  // ─────────────────────────────────────────────────────────────────

  /**
   * Submit form data for a tool call
   */
  async submitToolCallForm(
    toolCallId: string,
    formData: Record<string, unknown>
  ): Promise<void> {
    await this.httpClient.post(`/api/sdk/v1/tool-calls/${toolCallId}/submit`, {
      formData,
    });
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
   * Relay a completed form collector's values to a server-configured destination.
   *
   * Used by `createFormCollector` / `useFormCollector` in `{ via: "backend" }` mode:
   * the browser never holds the destination URL or its secret — the backend resolves
   * `destination` (a named, opted-in tool) and forwards the values from the server.
   */
  async submitFormCollector(
    destination: string,
    values: Record<string, unknown>
  ): Promise<unknown> {
    return this.httpClient.post("/api/sdk/v1/forms/submit", {
      destination,
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
    schema: Omit<ClientFunctionSchema, "name">
  ): void;
  registerFunction(
    nameOrDef: string | ClientFunctionDefinition,
    handler?: ClientFunctionHandler,
    schema?: Omit<ClientFunctionSchema, "name">
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
   * Register a navigation function that lets AGO navigate users to different pages.
   * @param navigate - A callback that performs the navigation (e.g. react-router's navigate)
   * @param routes - Map of route names to paths, with descriptions for the LLM
   */
  registerNavigationFunction(
    navigate: (path: string) => void,
    routes: Array<{ name: string; path: string; description: string }>
  ): void {
    const routeNames = routes.map((r) => r.name);
    const routeDescriptions = routes
      .map((r) => `- "${r.name}": ${r.description}`)
      .join("\n");

    this.registerFunction(
      "navigateToPage",
      async (args) => {
        const pageName = args.page as string;
        const route = routes.find((r) => r.name === pageName);
        if (!route) {
          return { success: false, error: `Unknown page: ${pageName}` };
        }
        navigate(route.path);
        return { success: true, navigatedTo: route.path };
      },
      {
        description: `Navigate the user to a page in the application. Available pages:\n${routeDescriptions}`,
        parameters: {
          type: "object",
          properties: {
            page: {
              type: "string",
              description: "The page to navigate to",
              enum: routeNames,
            },
          },
          required: ["page"],
        },
      }
    );
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
   */
  updateConfig(config: Partial<AgoConfig>): void {
    this.config = { ...this.config, ...config };
    this.httpClient.updateConfig(config);

    if (config.debug !== undefined) {
      config.debug ? logger.enable() : logger.disable();
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.eventEmitter.removeAllListeners();
    this.functionRegistry.clear();
    this.contextRegistry.clear();
    logger.log("AgoClient destroyed");
  }
}
