import { attachmentsFromFiles } from "../utils/attachments";
import { EventEmitter } from "../utils/eventEmitter";
import { AgoError } from "./errors";
import type {
  AgoClientEvents,
  AgoMessage,
  ClientFunctionInvocation,
  Conversation,
  FunctionCallState,
  FunctionCallStatus,
  SendMessageOptions,
  StopMessageResult,
  ToolCallData,
} from "./types";

/** Events of one conversation, as `conversation.on(...)` delivers them. */
export type AgoConversationEvents = Pick<
  AgoClientEvents,
  | "message:start"
  | "message:chunk"
  | "message:answer-complete"
  | "message:complete"
  | "message:waiting-client"
  | "message:stopped"
  | "message:error"
  | "conversation:title"
  | "toolCall:received"
  | "function:invoke"
  | "function:awaiting-approval"
  | "function:result"
> & {
  /** A draft conversation received its server id from the first frame of its first answer. */
  id: { previousId: string; id: string };
};

/** What `conversation.getSnapshot()` returns: a new object after every change. */
export interface AgoConversationSnapshot {
  /** Server id, or a local `draft-…` id until the first answer starts. */
  id: string;
  isDraft: boolean;
  title: string;
  /** Every message, hidden ones included (filter on `hidden` to display). */
  messages: AgoMessage[];
  /** An answer is running, paused on a client function, queued, or being polled. */
  isGenerating: boolean;
  /** The conversation's history is being fetched. */
  isLoading: boolean;
  error: Error | null;
}

/** `client.sendMessage` options minus the conversation, which the object fixes. */
export type ConversationSendOptions = Omit<SendMessageOptions, "conversationId">;

/** The turn a frame belongs to, as the conversation sees it. */
export interface TurnRef {
  id: string;
  messageId: string | null;
}

/** @internal What a conversation needs from its client. */
export interface ConversationHost {
  runSend(
    conversation: AgoConversation,
    content: string,
    options: ConversationSendOptions,
  ): Promise<AgoMessage>;
  stopConversation(conversation: AgoConversation): Promise<StopMessageResult | null>;
  hasTurn(conversation: AgoConversation): boolean;
  isActive(conversation: AgoConversation): boolean;
  getConversation(conversationId: string): Promise<Conversation>;
  fetchConversation(conversationId: string): Promise<Conversation>;
  stopMessage(messageId: string): Promise<StopMessageResult>;
  emitStopped(conversation: AgoConversation, messageId: string): void;
  rekeyed(conversation: AgoConversation, previousId: string): void;
  retain(conversation: AgoConversation): void;
  release(conversation: AgoConversation): void;
  generatingChanged(): void;
}

/** Throws the SDK's error for a message with no text. */
export function assertMessageContent(content: unknown): void {
  if (typeof content !== "string" || !content.trim()) {
    throw new AgoError(
      "Add message text before sending, including when attaching files. " +
        "See docs/general/core.md#file-attachments.",
      "message_empty_content",
    );
  }
}

const POLL_INTERVAL_MS = 2_000;
const POLL_MAX_MS = 5 * 60_000;
const TERMINAL: ReadonlySet<AgoMessage["status"]> = new Set([
  "DONE",
  "CANCELED",
  "ERROR",
]);

/**
 * One conversation: its messages with their live activity, its answer and its
 * Stop. Get one with `client.conversation(id)` (or `client.conversation()` for
 * a new one); the same id always returns the same object while it is alive.
 *
 * ```ts
 * const conversation = client.conversation("c-123");
 * conversation.subscribe(() => render(conversation.getSnapshot()));
 * await conversation.sendMessage("Where is my order?");
 * ```
 */
export class AgoConversation {
  private currentId: string;
  private draft: boolean;
  private title = "";
  private messages: AgoMessage[] = [];
  private error: Error | null = null;
  private isLoading = false;
  private loadPromise: Promise<Conversation> | null = null;
  private loaded = false;
  private snapshot: AgoConversationSnapshot;
  private listeners = new Set<() => void>();
  private emitter = new EventEmitter<AgoConversationEvents>();
  private handlerCount = 0;
  /** Sends waiting for the running answer to end, oldest first. */
  private queue: Array<{ release: () => void; cancel: (error: Error) => void }> = [];
  /** A queued send was released and is about to start its turn. */
  private handingOff = false;
  /** Order in which local messages were created, to merge them with a server load. */
  private localSeq = new Map<string, number>();
  private seq = 0;
  /** `mark`: the `seq` when polling started; messages created after it are kept by each poll. */
  private poll: {
    messageId: string;
    startedAt: number;
    mark: number;
    timer?: ReturnType<typeof setTimeout>;
  } | null = null;
  private wasGenerating = false;
  /** Keys of id-less client-function calls (placeholder mode), by invocation. */
  private callKeys = new WeakMap<ClientFunctionInvocation, string>();

  /** @internal Created by `client.conversation()`. */
  constructor(
    private host: ConversationHost,
    id: string,
    draft: boolean,
  ) {
    this.currentId = id;
    this.draft = draft;
    this.snapshot = this.buildSnapshot();
  }

  /** Server id, or a local `draft-…` id until the first answer starts. */
  get id(): string {
    return this.currentId;
  }

  get isDraft(): boolean {
    return this.draft;
  }

  // ─────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────

  /**
   * Send a message in this conversation. The user message shows at once. While
   * an answer is running, the message waits and is sent when that answer ends:
   * a conversation answers one message at a time.
   */
  async sendMessage(
    content: string,
    options: ConversationSendOptions = {},
  ): Promise<AgoMessage> {
    assertMessageContent(content);
    this.host.retain(this);
    const userMessage: AgoMessage = {
      id: `local-${++this.seq}`,
      conversationId: this.currentId,
      content,
      role: "user",
      status: "DONE",
      hidden: options.hidden || undefined,
      attachments:
        options.files && options.files.length > 0
          ? attachmentsFromFiles(options.files)
          : undefined,
      createdAt: new Date(),
    };
    this.localSeq.set(userMessage.id, this.seq);
    this.messages = [...this.messages, userMessage];
    this.error = null;

    try {
      if (this.isGenerating()) {
        const released = new Promise<void>((release, cancel) =>
          this.queue.push({ release, cancel }),
        );
        this.notify();
        await released;
        this.handingOff = false;
      } else {
        this.notify();
      }
      return await this.host.runSend(this, content, options);
    } catch (error) {
      this.messages = this.messages.filter((m) => m.id !== userMessage.id);
      this.error = error instanceof Error ? error : new Error(String(error));
      this.notify();
      this.drain();
      this.host.release(this);
      throw error;
    }
  }

  /**
   * Stop this conversation's answer (a queued message is then sent). Resolves
   * with the backend's verdict, or `null` when nothing was generating.
   */
  stop(): Promise<StopMessageResult | null> {
    return this.host.stopConversation(this);
  }

  /** An answer is running, paused on a client function, queued, or being polled. */
  isGenerating(): boolean {
    return (
      this.host.hasTurn(this) ||
      this.poll !== null ||
      this.queue.length > 0 ||
      this.handingOff
    );
  }

  /** Every message, hidden ones included. */
  getMessages(): AgoMessage[] {
    return this.messages;
  }

  /** The current state, as a new object after every change (for `useSyncExternalStore`). */
  getSnapshot = (): AgoConversationSnapshot => this.snapshot;

  /**
   * Listen to every change of the snapshot. The first subscriber loads the
   * conversation's history. Returns the unsubscribe function.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.host.retain(this);
    if (!this.draft && !this.loaded && !this.loadPromise) {
      this.load().catch(() => {
        // Surfaced through the snapshot's `error`.
      });
    }
    return () => {
      if (!this.listeners.delete(listener)) return;
      this.host.release(this);
    };
  };

  /** Subscribe to this conversation's events only. Returns the unsubscribe function. */
  on<K extends keyof AgoConversationEvents>(
    event: K,
    handler: (data: AgoConversationEvents[K]) => void,
  ): () => void {
    this.emitter.on(event, handler);
    this.handlerCount++;
    this.host.retain(this);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.emitter.off(event, handler);
      this.handlerCount--;
      this.host.release(this);
    };
  }

  /**
   * Fetch the conversation's history from the server (once; later calls reuse
   * the first result). Messages already streamed locally are kept.
   */
  load(): Promise<Conversation> {
    if (this.draft) {
      return Promise.resolve({
        id: this.currentId,
        title: this.title,
        lastMessageDate: new Date(),
        messages: this.messages,
      });
    }
    if (!this.loadPromise) {
      this.isLoading = true;
      this.notify();
      const mark = this.seq;
      this.loadPromise = this.host.getConversation(this.currentId).then(
        (conversation) => {
          this.applyServerMessages(conversation.messages ?? [], mark);
          this.title = conversation.title?.trim() || this.title;
          this.isLoading = false;
          this.loaded = true;
          this.notify();
          this.updatePolling();
          return conversation;
        },
        (error) => {
          this.isLoading = false;
          this.loadPromise = null;
          this.error = error instanceof Error ? error : new Error(String(error));
          this.notify();
          throw error;
        },
      );
    }
    return this.loadPromise;
  }

  // ─────────────────────────────────────────────────────────────────
  // Fed by the client, from the turn's own stream
  // ─────────────────────────────────────────────────────────────────

  /** @internal */
  _dispatch<K extends keyof AgoConversationEvents>(
    event: K,
    data: AgoConversationEvents[K],
  ): void {
    this.emitter.emit(event, data);
  }

  /** @internal */
  _isRetained(): boolean {
    return this.listeners.size > 0 || this.handlerCount > 0 || this.isGenerating();
  }

  /** @internal The draft's first frame named the server conversation. */
  _rekey(id: string): void {
    if (!this.draft || id === this.currentId) return;
    const previousId = this.currentId;
    this.currentId = id;
    this.draft = false;
    this.loaded = true;
    this.messages = this.messages.map((m) => ({ ...m, conversationId: id }));
    this.host.rekeyed(this, previousId);
    this.notify();
    this.emitter.emit("id", { previousId, id });
  }

  /** @internal */
  _turnStarted(): void {
    this.stopPolling();
    this.notify();
  }

  /** @internal The turn learned its message id (or resumed a known one). */
  _messageStarted(turn: TurnRef): void {
    this.updateAssistant(turn, (m) => ({ ...m, status: "IN_PROGRESS" }));
  }

  /** @internal */
  _appendText(turn: TurnRef, text: string): void {
    this.updateAssistant(turn, (m) => ({ ...m, content: m.content + text }));
  }

  /** @internal The backend replaced the whole text (retry reset, error message). */
  _setText(turn: TurnRef, text: string): void {
    this.updateAssistant(turn, (m) => ({ ...m, content: text }));
  }

  /** @internal */
  _toolCall(turn: TurnRef, call: ToolCallData): void {
    this.updateAssistant(turn, (m) => {
      const calls = m.toolCalls ?? [];
      const index = calls.findIndex((c) => c.id === call.id);
      if (index < 0) {
        return { ...m, toolCalls: [...calls, { ...call, contentOffset: m.content.length }] };
      }
      const next = [...calls];
      next[index] = { ...call, contentOffset: calls[index].contentOffset };
      return { ...m, toolCalls: next };
    });
  }

  /** @internal */
  _functionInvoked(turn: TurnRef, invocation: ClientFunctionInvocation): void {
    const key = invocation.invocationId || `local-call-${++this.seq}`;
    if (!invocation.invocationId) this.callKeys.set(invocation, key);
    this.updateAssistant(turn, (m) => ({
      ...m,
      functionCalls: [
        ...(m.functionCalls ?? []),
        {
          invocationId: key,
          functionName: invocation.functionName,
          arguments: invocation.arguments,
          status: "running",
          contentOffset: m.content.length,
        },
      ],
    }));
  }

  /** @internal */
  _functionStatus(
    invocation: ClientFunctionInvocation | string,
    status: FunctionCallStatus,
    error?: string,
  ): void {
    const key =
      typeof invocation === "string"
        ? invocation
        : this.callKeys.get(invocation) ?? invocation.invocationId;
    if (!key) return;
    let changed = false;
    this.messages = this.messages.map((m) => {
      if (!m.functionCalls?.some((c) => c.invocationId === key)) return m;
      changed = true;
      return {
        ...m,
        functionCalls: m.functionCalls.map(
          (c): FunctionCallState =>
            c.invocationId === key
              ? { ...c, status, ...(error ? { error } : {}) }
              : c,
        ),
      };
    });
    if (changed) this.notify();
  }

  /** @internal */
  _title(title: string): void {
    this.title = title;
    this.notify();
  }

  /** @internal */
  _answerComplete(turn: TurnRef, message: AgoMessage): void {
    this.updateAssistant(turn, (m) => this.mergeFinal(m, message));
  }

  /** @internal */
  _waiting(turn: TurnRef): void {
    this.updateAssistant(turn, (m) => ({ ...m, status: "WAITING_CLIENT" }));
  }

  /** @internal */
  _complete(turn: TurnRef, message: AgoMessage): void {
    this.updateAssistant(turn, (m) => this.mergeFinal(m, message));
  }

  /** @internal An empty stopped answer is dropped rather than left blank. */
  _stopped(turn: TurnRef): void {
    const key = this.assistantKey(turn);
    const entry = this.messages.find((m) => m.id === key);
    if (!entry) return;
    const empty =
      !entry.content.trim() && !entry.toolCalls?.length && !entry.functionCalls?.length;
    this.messages = empty
      ? this.messages.filter((m) => m.id !== key)
      : this.messages.map((m) =>
          m.id === key && !TERMINAL.has(m.status) ? { ...m, status: "CANCELED" } : m,
        );
    this.notify();
  }

  /** @internal */
  _error(turn: TurnRef, error: Error): void {
    this.error = error;
    if (this.messages.some((m) => m.id === this.assistantKey(turn))) {
      this.updateAssistant(turn, (m) => ({ ...m, status: "ERROR" }));
    } else {
      this.notify();
    }
  }

  /** @internal The turn closed for good (not a pause). */
  _turnEnded(): void {
    this.notify();
    this.drain();
  }

  /** @internal The client's active conversation changed to or from this one. */
  _activeChanged(): void {
    this.updatePolling();
  }

  /** @internal Stop the polled answer of a reloaded page, if any. */
  async _stopPolled(): Promise<StopMessageResult | null> {
    const poll = this.poll;
    if (!poll) return null;
    this.stopPolling();
    this.messages = this.messages.map((m) =>
      m.id === poll.messageId ? { ...m, status: "CANCELED" } : m,
    );
    this.notify();
    this.drain();
    let result: StopMessageResult | null = null;
    try {
      result = await this.host.stopMessage(poll.messageId);
    } catch {
      // The local state is already stopped; the server finishes on its own.
    }
    this.host.emitStopped(this, poll.messageId);
    return result;
  }

  /** @internal The client was destroyed: drop queued sends and timers. */
  _dispose(): void {
    this.stopPolling();
    const queued = this.queue;
    this.queue = [];
    this.handingOff = false;
    this.listeners.clear();
    for (const send of queued) {
      send.cancel(
        new AgoError(
          "The client was destroyed before this message was sent.",
          "client_destroyed",
        ),
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────

  /** Release the oldest queued send once nothing runs any more. */
  private drain(): void {
    if (this.handingOff || this.host.hasTurn(this) || this.poll) return;
    const next = this.queue.shift();
    if (!next) return;
    this.handingOff = true;
    next.release();
  }

  private assistantKey(turn: TurnRef): string {
    return turn.messageId ?? `pending-${turn.id}`;
  }

  /** Update the turn's assistant message, creating it (or adopting its pending entry) first. */
  private updateAssistant(turn: TurnRef, update: (message: AgoMessage) => AgoMessage): void {
    const key = this.assistantKey(turn);
    let index = this.messages.findIndex((m) => m.id === key);
    if (index < 0 && turn.messageId) {
      index = this.messages.findIndex((m) => m.id === `pending-${turn.id}`);
    }
    const base: AgoMessage =
      index >= 0
        ? { ...this.messages[index], id: key }
        : {
            id: key,
            conversationId: this.currentId,
            content: "",
            role: "assistant",
            status: "IN_PROGRESS",
            createdAt: new Date(),
          };
    const next = update(base);
    if (index >= 0) {
      this.messages = this.messages.map((m, i) => (i === index ? next : m));
    } else {
      this.localSeq.set(key, ++this.seq);
      this.messages = [...this.messages, next];
    }
    this.notify();
  }

  /**
   * Fold a stream's final message into the live entry. The live text spans
   * every stream of the turn (a resumed turn streams only what comes after the
   * pause), so it wins whenever it has any.
   */
  private mergeFinal(entry: AgoMessage, message: AgoMessage): AgoMessage {
    const toolCalls = [...(entry.toolCalls ?? [])];
    for (const call of message.toolCalls ?? []) {
      const index = toolCalls.findIndex((c) => c.id === call.id);
      if (index < 0) toolCalls.push({ ...call, contentOffset: entry.content.length });
      else toolCalls[index] = { ...call, contentOffset: toolCalls[index].contentOffset };
    }
    return {
      ...entry,
      ...message,
      id: entry.id,
      conversationId: this.currentId,
      content: entry.content || message.content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      functionCalls: entry.functionCalls,
      createdAt: entry.createdAt,
    };
  }

  /**
   * Replace the messages with the server's, keeping what only exists locally:
   * the answer still streaming, and messages created after the load started.
   */
  private applyServerMessages(server: AgoMessage[], mark: number): void {
    const serverIds = new Set(server.map((m) => m.id));
    const streaming = this.host.hasTurn(this);
    const live = new Map(
      this.messages
        .filter((m) => m.role === "assistant" && streaming && !TERMINAL.has(m.status))
        .map((m) => [m.id, m]),
    );
    const merged = server.map((m) => live.get(m.id) ?? { ...m, conversationId: this.currentId });
    const localOnly = this.messages.filter(
      (m) => !serverIds.has(m.id) && (live.has(m.id) || (this.localSeq.get(m.id) ?? 0) > mark),
    );
    this.messages = [...merged, ...localOnly];
  }

  /** Poll the active conversation while a reload left its last answer running. */
  private updatePolling(): void {
    const last = [...this.messages].reverse().find((m) => m.role === "assistant");
    const shouldPoll =
      !this.draft &&
      this.host.isActive(this) &&
      !this.host.hasTurn(this) &&
      last?.status === "IN_PROGRESS";
    if (!shouldPoll || !last) {
      if (this.poll) {
        this.stopPolling();
        this.notify();
        this.drain();
      }
      return;
    }
    if (this.poll?.messageId === last.id) return;
    this.stopPolling();
    this.poll = { messageId: last.id, startedAt: Date.now(), mark: this.seq };
    this.schedulePoll();
    this.notify();
  }

  private schedulePoll(): void {
    const poll = this.poll;
    if (!poll) return;
    poll.timer = setTimeout(() => void this.pollOnce(poll), POLL_INTERVAL_MS);
  }

  private async pollOnce(poll: NonNullable<AgoConversation["poll"]>): Promise<void> {
    if (this.poll !== poll) return;
    if (Date.now() - poll.startedAt >= POLL_MAX_MS) {
      this.messages = this.messages.map((m) =>
        m.id === poll.messageId ? { ...m, status: "ERROR" } : m,
      );
      this.stopPolling();
      this.notify();
      this.drain();
      return;
    }
    try {
      const conversation = await this.host.fetchConversation(this.currentId);
      if (this.poll !== poll) return;
      this.applyServerMessages(conversation.messages ?? [], poll.mark);
      if (conversation.title?.trim()) this.title = conversation.title.trim();
    } catch {
      // A failed poll is retried on the next tick, until the cap.
    }
    if (this.poll !== poll) return;
    const status = this.messages.find((m) => m.id === poll.messageId)?.status;
    if (status === "IN_PROGRESS") {
      this.notify();
      this.schedulePoll();
      return;
    }
    // Finished, or paused on a client function (the app's resume flow takes over).
    this.stopPolling();
    this.notify();
    this.drain();
  }

  private stopPolling(): void {
    if (this.poll?.timer !== undefined) clearTimeout(this.poll.timer);
    this.poll = null;
  }

  private buildSnapshot(): AgoConversationSnapshot {
    return {
      id: this.currentId,
      isDraft: this.draft,
      title: this.title,
      messages: this.messages,
      isGenerating: this.isGenerating(),
      isLoading: this.isLoading,
      error: this.error,
    };
  }

  private notify(): void {
    this.snapshot = this.buildSnapshot();
    if (this.snapshot.isGenerating !== this.wasGenerating) {
      this.wasGenerating = this.snapshot.isGenerating;
      this.host.generatingChanged();
    }
    for (const listener of [...this.listeners]) listener();
  }
}
