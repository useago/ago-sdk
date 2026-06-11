import { AgoClient } from "../client/AgoClient";
import type {
  AgoConfig,
  AgoMessage,
  Conversation,
  AgoClientEvents,
  AgoEventName,
  SendMessageOptions,
} from "../client/types";
import type { ClientFunctionDefinition, ClientFunctionHandler, ClientFunctionSchema } from "../functions/types";

interface Observable<T> {
  subscribe(observer: { next?: (value: T) => void; error?: (err: unknown) => void }): { unsubscribe: () => void };
}

/**
 * Angular-style service wrapping AgoClient.
 * Provides RxJS-like Observables for streaming events and standard Promise-based methods.
 *
 * Usage with Angular DI:
 * ```ts
 * import { provideAgo, AgoService } from "@useago/sdk/angular";
 *
 * // In providers array:
 * provideAgo({ baseUrl: "https://YOUR-DOMAIN.useago.com" })
 *
 * // In component:
 * @Component({...})
 * export class ChatComponent {
 *   private ago = inject(AgoService);
 *   messages$ = this.ago.messages$;
 * }
 * ```
 *
 * Works without Angular DI too — just instantiate directly:
 * ```ts
 * const ago = new AgoService({ baseUrl: "https://YOUR-DOMAIN.useago.com" });
 * ```
 */
export class AgoService {
  private client: AgoClient;

  /** Observable of complete messages */
  readonly messages$: Observable<AgoMessage>;

  /** Observable of streaming chunks */
  readonly chunks$: Observable<{ content: string; conversationId: string; messageId: string }>;

  /** Observable of errors */
  readonly errors$: Observable<{ error: string; conversationId?: string; messageId?: string }>;

  /** Observable of message start events */
  readonly messageStart$: Observable<{ conversationId: string; messageId: string }>;

  constructor(config: AgoConfig) {
    this.client = new AgoClient(config);

    this.messages$ = this.fromEvent("message:complete");
    this.chunks$ = this.fromEvent("message:chunk");
    this.errors$ = this.fromEvent("message:error");
    this.messageStart$ = this.fromEvent("message:start");
  }

  /** Create a minimal Observable from an AgoClient event */
  private fromEvent<K extends AgoEventName>(event: K): Observable<AgoClientEvents[K]> {
    const client = this.client;
    return {
      subscribe(observer: { next?: (value: AgoClientEvents[K]) => void; error?: (err: unknown) => void }) {
        const handler = (data: AgoClientEvents[K]) => {
          observer.next?.(data);
        };
        client.on(event, handler);
        return {
          unsubscribe: () => client.off(event, handler),
        };
      },
    };
  }

  /** Send a message and get a streaming response */
  sendMessage(content: string, options?: SendMessageOptions): Promise<AgoMessage> {
    return this.client.sendMessage(content, options);
  }

  /** Get all conversations */
  getConversations(): Promise<Conversation[]> {
    return this.client.getConversations();
  }

  /** Get a specific conversation with messages */
  getConversation(id: string): Promise<Conversation> {
    return this.client.getConversation(id);
  }

  /** Get messages for a conversation */
  getMessages(conversationId: string): Promise<AgoMessage[]> {
    return this.client.getMessages(conversationId);
  }

  /** Submit form data for a tool call */
  submitToolCallForm(toolCallId: string, formData: Record<string, unknown>): Promise<void> {
    return this.client.submitToolCallForm(toolCallId, formData);
  }

  /** Confirm a tool call */
  confirmToolCall(toolCallId: string): Promise<void> {
    return this.client.confirmToolCall(toolCallId);
  }

  /** Reject a tool call */
  rejectToolCall(toolCallId: string): Promise<void> {
    return this.client.rejectToolCall(toolCallId);
  }

  /** Submit feedback for a message */
  submitFeedback(messageId: string, rating: "positive" | "negative"): Promise<void> {
    return this.client.submitFeedback(messageId, rating);
  }

  /** Register a client-side function */
  registerFunction(definition: ClientFunctionDefinition): void;
  registerFunction(name: string, handler: ClientFunctionHandler, schema: Omit<ClientFunctionSchema, "name">): void;
  registerFunction(
    nameOrDef: string | ClientFunctionDefinition,
    handler?: ClientFunctionHandler,
    schema?: Omit<ClientFunctionSchema, "name">
  ): void {
    if (typeof nameOrDef === "object") {
      this.client.registerFunction(nameOrDef);
    } else {
      this.client.registerFunction(nameOrDef, handler!, schema!);
    }
  }

  /** Unregister a client-side function */
  unregisterFunction(name: string): boolean {
    return this.client.unregisterFunction(name);
  }

  /** Register navigation routes */
  registerNavigationFunction(
    navigate: (path: string) => void,
    routes: Array<{ name: string; path: string; description: string }>
  ): void {
    this.client.registerNavigationFunction(navigate, routes);
  }

  /** Subscribe to a client event */
  on<K extends AgoEventName>(
    event: K,
    handler: (data: AgoClientEvents[K]) => void
  ): void {
    this.client.on(event, handler);
  }

  /** Unsubscribe from a client event */
  off<K extends AgoEventName>(
    event: K,
    handler: (data: AgoClientEvents[K]) => void
  ): void {
    this.client.off(event, handler);
  }

  /** Update client config */
  updateConfig(config: Partial<AgoConfig>): void {
    this.client.updateConfig(config);
  }

  /** Get the underlying AgoClient instance */
  getClient(): AgoClient {
    return this.client;
  }

  /** Destroy the service and clean up resources */
  destroy(): void {
    this.client.destroy();
  }
}
