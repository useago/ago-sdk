import { attachmentsFromFiles } from "../utils/attachments";
import { EventEmitter } from "../utils/eventEmitter";
import { AgoError } from "./errors";
import { SSEHandler } from "../streaming/SSEHandler";
import { normalizeInteraction, normalizeMessage } from "./messageNormalizer";
import type {
  AgoClientEvents,
  AgoMessage,
  ClientFunctionInvocation,
  Conversation,
  ConversationInteraction,
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
  /** Whether the server currently accepts another message. */
  interaction: ConversationInteraction | null;
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
    localMessageId: string,
  ): Promise<AgoMessage>;
  stopConversation(conversation: AgoConversation): Promise<StopMessageResult | null>;
  hasTurn(conversation: AgoConversation): boolean;
  isActive(conversation: AgoConversation): boolean;
  userSent(conversation: AgoConversation): void;
  getConversation(conversationId: string): Promise<Conversation>;
  fetchConversation(conversationId: string): Promise<Conversation>;
  /** Ask the server to stop a polled message and emit its stop event while the session is current. */
  stopPolledMessage(conversation: AgoConversation, messageId: string): Promise<StopMessageResult | null>;
  rekeyed(conversation: AgoConversation, previousId: string): void;
  retain(conversation: AgoConversation): void;
  release(conversation: AgoConversation): void;
  generatingChanged(): void;
  /**
   * Fetch a message observation endpoint using the client's credentials.
   * Used for both the live SSE stream and status snapshots.
   * The caller reads the response and controls cancellation through signal.
   */
  fetchObservationResponse(path: string, signal: AbortSignal): Promise<Response>;
  /** Emit message:update to client listeners while this conversation remains active. */
  emitMessageUpdate(conversation: AgoConversation, message: AgoMessage): void;
  /** Emit conversation:update with the active conversation's interaction state. */
  emitInteractionUpdate(conversation: AgoConversation, interaction: ConversationInteraction): void;
  /**
   * Deliver an observed completion to client and conversation listeners while active.
   * The conversation must deduplicate completions before calling this method.
   */
  emitObservedCompletion(conversation: AgoConversation, message: AgoMessage): void;
  /**
   * Report observation connectivity through the client's connection:status event.
   * Access-loss errors reset the session instead; other errors report disconnected
   * status for the active conversation without clearing its state.
   */
  reportConnectionStatus(conversation: AgoConversation, connected: boolean, error?: Error): void;
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
  private interaction: ConversationInteraction | null = null;
  private followGeneration = 0;
  private observeBackground = true;
  private sessionGeneration = 0;
  private followController: AbortController | null = null;
  private followTimer: ReturnType<typeof setTimeout> | null = null;
  private observed = new Set<string>();
  private completed = new Set<string>();
  private error: Error | null = null;
  private isLoading = false;
  private loadPromise: Promise<Conversation> | null = null;
  private loaded = false;
  private snapshot: AgoConversationSnapshot;
  private listeners = new Set<() => void>();
  private forkListeners = new Set<(id: string) => void>();
  private emitter = new EventEmitter<AgoConversationEvents>();
  private handlerCount = 0;
  /** Sends waiting for the running answer to end, oldest first. */
  private queue: Array<{ release: () => void; cancel: (error: Error) => void }> = [];
  /** A queued send was released and is about to start its turn. */
  private handingOff = false;
  /** Order in which local messages were created, to merge them with a server load. */
  private localSeq = new Map<string, number>();
  private seq = 0;
  private poll: { messageId: string; startedAt: number; timer?: ReturnType<typeof setTimeout> } | null =
    null;
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
   * a conversation answers one message at a time. If the interaction state
   * blocks sending, rejects with `conversation_busy`, including when a queued
   * message reaches the front of the queue.
   */
  async sendMessage(
    content: string,
    options: ConversationSendOptions = {},
  ): Promise<AgoMessage> {
    assertMessageContent(content);
    this._assertCanSend();
    const sessionGeneration = this.sessionGeneration;
    this.host.retain(this);
    this.host.userSent(this);
    if (sessionGeneration !== this.sessionGeneration) {
      this.host.release(this);
      throw new AgoError("The request was detached from the current session.", "request_detached");
    }
    this.stopWaitingForPolled();
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
        this._assertCanSend();
      } else {
        this.notify();
      }
      if (sessionGeneration !== this.sessionGeneration) throw new AgoError("The request was detached from the current session.", "request_detached");
      return await this.host.runSend(this, content, options, userMessage.id);
    } catch (error) {
      if (sessionGeneration === this.sessionGeneration) {
        this.messages = this.messages.filter((m) => m.id !== userMessage.id);
        this.error = error instanceof Error ? error : new Error(String(error));
        this.notify();
        this.drain();
      }
      this.host.release(this);
      throw error;
    }
  }

  /**
   * Stop this conversation's answer (a queued message is then sent). Resolves
   * with the backend's verdict, or `null` when nothing was generating or the
   * interaction state blocks sending.
   */
  stop(): Promise<StopMessageResult | null> {
    if (this.interaction?.canSendMessage === false) return Promise.resolve(null);
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
      const sessionGeneration = this.sessionGeneration;
      this.loadPromise = this.host.getConversation(this.currentId).then(
        (conversation) => {
          if (sessionGeneration !== this.sessionGeneration) throw new AgoError("The request was detached from the current session.", "request_detached");
          this.applyServerMessages(conversation.messages ?? [], mark);
          this.interaction = conversation.interaction ?? null;
          this.title = conversation.title?.trim() || this.title;
          this.isLoading = false;
          this.loaded = true;
          this.notify();
          if (sessionGeneration !== this.sessionGeneration) throw new AgoError("The request was detached from the current session.", "request_detached");
          if (this.interaction && this.host.isActive(this)) {
            this.host.reportConnectionStatus(this, true);
            if (sessionGeneration !== this.sessionGeneration) throw new AgoError("The request was detached from the current session.", "request_detached");
            for (const message of this.messages) {
              if (!this.host.isActive(this)) break;
              this.host.emitMessageUpdate(this, message);
              if (sessionGeneration !== this.sessionGeneration) throw new AgoError("The request was detached from the current session.", "request_detached");
            }
            if (this.host.isActive(this)) this.host.emitInteractionUpdate(this, this.interaction);
          }
          this.updatePolling();
          this._updateBackgroundFollowing();
          if (!this.observeBackground && this.interaction?.canSendMessage === false) {
            this.loaded = false;
            this.loadPromise = null;
          }
          return conversation;
        },
        (error) => {
          if (sessionGeneration === this.sessionGeneration) {
            this.isLoading = false;
            this.loadPromise = null;
            this.error = error instanceof Error ? error : new Error(String(error));
            this.notify();
          }
          throw error;
        },
      );
    }
    return this.loadPromise;
  }

  // ─────────────────────────────────────────────────────────────────
  // Fed by the client, from the turn's own stream
  // ─────────────────────────────────────────────────────────────────

  /** @internal Check whether background work prevents sending a message. */
  _isBackgroundBusy(): boolean {
    return this.interaction?.canSendMessage === false;
  }

  /** @internal Refresh the observed message after an approval decision. */
  _refreshBackground(): void {
    const id = this.interaction?.blockingMessageId;
    if (!id || !this.observeBackground || !this.host.isActive(this)) return;
    this._stopBackgroundFollowing();
    void this._readBackgroundStatus(id, this.followGeneration);
  }

  /** @internal Apply a server snapshot to this conversation's message store. */
  _applyBackgroundSnapshot(snapshot: { interaction: ConversationInteraction; message: AgoMessage }, fromSend = false): void {
    const generation = this.followGeneration;
    const { message, interaction } = snapshot;
    if (message.conversationId !== this.currentId) return;
    const previous = this.messages.find((entry) => entry.id === message.id);
    if (previous && TERMINAL.has(previous.status) && !TERMINAL.has(message.status)) return;
    if (TERMINAL.has(message.status) && message.attachments?.some((file) => !file.url)) {
      this.observed.add(message.id);
      this._scheduleBackgroundStatus(message.id);
      return;
    }
    const index = this.messages.findIndex((entry) => entry.id === message.id);
    this.messages = index < 0 ? [...this.messages, message] : this.messages.map((entry, i) => i === index ? message : entry);
    this.interaction = interaction;
    if (!this.observeBackground && interaction.canSendMessage === false) {
      this.loaded = false;
      this.loadPromise = null;
    }
    if (fromSend || !TERMINAL.has(message.status)) this.observed.add(message.id);
    this.notify();
    if (generation !== this.followGeneration) return;
    this.host.emitMessageUpdate(this, message);
    if (generation !== this.followGeneration || !this.host.isActive(this)) return;
    this.host.emitInteractionUpdate(this, interaction);
    if (generation !== this.followGeneration || !this.host.isActive(this)) return;
    if (TERMINAL.has(message.status) && this.observed.has(message.id) && !this.completed.has(message.id)) {
      this.completed.add(message.id);
      this.host.emitObservedCompletion(this, message);
    }
  }

  /** @internal */
  _dispatch<K extends keyof AgoConversationEvents>(
    event: K,
    data: AgoConversationEvents[K],
    current?: () => boolean,
  ): void {
    if (current) this.emitter.emit(event, data, current);
    else this.emitter.emit(event, data);
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

  /** @internal Move a send that the server forked into another conversation. */
  _moveTurnTo(target: AgoConversation, turn: TurnRef, userMessageId: string): void {
    const keys = new Set([userMessageId, this.assistantKey(turn)]);
    const moved = this.messages.filter((message) => keys.has(message.id));
    this.messages = this.messages.filter((message) => !keys.has(message.id));
    target.messages = [...target.messages.filter((message) => !keys.has(message.id)), ...moved.map((message) => ({ ...message, conversationId: target.id }))];
    for (const message of moved) {
      this.localSeq.delete(message.id);
      target.localSeq.set(message.id, ++target.seq);
    }
    this.notify();
    target.notify();
    for (const listener of [...this.forkListeners]) listener(target.id);
  }

  /** @internal Subscribe to sends moved to another conversation; returns an unsubscribe function. */
  _subscribeToFork(listener: (id: string) => void): () => void {
    this.forkListeners.add(listener);
    return () => { this.forkListeners.delete(listener); };
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
    this._updateBackgroundFollowing();
  }

  /** @internal Suspend server observation while preserving local turns and selection. */
  _setBackgroundObservation(enabled: boolean): void {
    if (this.observeBackground === enabled) return;
    this.observeBackground = enabled;
    if (!enabled) {
      this._stopBackgroundFollowing();
      if (this.interaction?.canSendMessage === false) {
        this.loaded = false;
        this.loadPromise = null;
      }
    } else if (this.loaded) this._updateBackgroundFollowing();
  }

  /** @internal The client's active conversation changed to or from this one. */
  _activeChanged(): void {
    if (!this.host.isActive(this) && this.interaction?.canSendMessage === false) {
      this.loaded = false;
      this.loadPromise = null;
      this.observed.clear();
    }
    this.updatePolling();
    if (!this.host.isActive(this) || this.loaded) this._updateBackgroundFollowing();
  }

  /** @internal Stop the polled answer of a reloaded page, if any. */
  async _stopPolled(): Promise<StopMessageResult | null> {
    if (this.interaction?.canSendMessage === false) return null;
    const poll = this.poll;
    if (!poll) return null;
    const sessionGeneration = this.sessionGeneration;
    this.stopPolling();
    this.messages = this.messages.map((m) =>
      m.id === poll.messageId ? { ...m, status: "CANCELED" } : m,
    );
    this.notify();
    if (sessionGeneration !== this.sessionGeneration) return null;
    this.drain();
    return this.host.stopPolledMessage(this, poll.messageId);
  }

  /** @internal The client was destroyed: drop queued sends and timers. */
  _dispose(): void {
    this.stopPolling();
    this._stopBackgroundFollowing();
    const queued = this.queue;
    this.queue = [];
    this.handingOff = false;
    this.listeners.clear();
    this.forkListeners.clear();
    for (const send of queued) {
      send.cancel(
        new AgoError(
          "The client was destroyed before this message was sent.",
          "client_destroyed",
        ),
      );
    }
  }

  /** @internal Discard state belonging to the previous session. */
  _resetSession(destroyed = false): void {
    this.sessionGeneration++;
    this.stopPolling();
    this._stopBackgroundFollowing();
    const queued = this.queue;
    this.queue = [];
    this.handingOff = false;
    for (const send of queued) send.cancel(destroyed
      ? new AgoError("The client was destroyed before this message was sent.", "client_destroyed")
      : new AgoError("The request was detached from the current session.", "request_detached"));
    this.messages = [];
    this.title = "";
    this.error = null;
    this.isLoading = false;
    this.localSeq.clear();
    this.interaction = null;
    this.loaded = false;
    this.loadPromise = null;
    this.observed.clear();
    this.completed.clear();
    this.notify();
  }

  // ─────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────

  /** Reject a send while the conversation is busy. */
  private _assertCanSend(): void {
    if (this.interaction?.canSendMessage === false) {
      throw new AgoError("The conversation is busy.", "conversation_busy");
    }
  }

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
      (m) => !serverIds.has(m.id) && (live.has(m.id) || (streaming && m.role === "user" && this.localSeq.has(m.id)) || (this.localSeq.get(m.id) ?? 0) > mark),
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
      this.interaction?.canSendMessage !== false &&
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
    this.poll = { messageId: last.id, startedAt: Date.now() };
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
      this.applyServerMessages(conversation.messages ?? [], this.seq);
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

  /**
   * The user moved on from an answer a reload left running: send now instead
   * of waiting for it (it may have died on the server). Its final state shows
   * on the next load.
   */
  private stopWaitingForPolled(): void {
    const poll = this.poll;
    if (!poll || this.host.hasTurn(this)) return;
    this.stopPolling();
    this.messages = this.messages.map((m) =>
      m.id === poll.messageId ? { ...m, status: "ERROR" } : m,
    );
  }

  private stopPolling(): void {
    if (this.poll?.timer !== undefined) clearTimeout(this.poll.timer);
    this.poll = null;
  }

  /** Cancel background observation and invalidate pending reads. */
  private _stopBackgroundFollowing(): void {
    this.followGeneration++;
    this.followController?.abort();
    this.followController = null;
    if (this.followTimer !== null) clearTimeout(this.followTimer);
    this.followTimer = null;
  }

  /** Start or stop observation according to the active conversation state. */
  private _updateBackgroundFollowing(): void {
    if (this.observeBackground && this.host.isActive(this) && this.followTimer !== null) return;
    if (!this.observeBackground || !this.host.isActive(this) || this.host.hasTurn(this) || this.interaction?.canSendMessage !== false) {
      this._stopBackgroundFollowing();
      return;
    }
    if (this.followController || this.followTimer !== null) return;
    const message = this.messages.find((entry) => entry.id === this.interaction?.blockingMessageId);
    if (!message) return;
    this.observed.add(message.id);
    void this._followBackground(message, this.followGeneration);
  }

  /** Schedule a status read for a paused background message. */
  private _scheduleBackgroundStatus(messageId: string): void {
    if (!this.observeBackground || !this.host.isActive(this) || this.followTimer !== null) return;
    const generation = this.followGeneration;
    this.followTimer = setTimeout(() => {
      this.followTimer = null;
      void this._readBackgroundStatus(messageId, generation);
    }, POLL_INTERVAL_MS);
  }

  /** Follow updates for a background message until the observation ends. */
  private async _followBackground(message: AgoMessage, capturedFollowGeneration: number): Promise<void> {
    if (["WAITING_APPROVAL", "PAUSED"].includes(message.status)) {
      this._scheduleBackgroundStatus(message.id);
      return;
    }
    if (!this.observeBackground || !this.host.isActive(this) || capturedFollowGeneration !== this.followGeneration) return;
    const controller = new AbortController();
    this.followController = controller;
    try {
      const response = await this.host.fetchObservationResponse(`/api/sdk/v1/messages/${encodeURIComponent(message.id)}/events`, controller.signal);
      if (capturedFollowGeneration !== this.followGeneration) return;
      this.host.reportConnectionStatus(this, true);
      if (capturedFollowGeneration !== this.followGeneration) return;
      if (!response.body) {
        this._scheduleBackgroundStatus(message.id);
        return;
      }
      let latest = message;
      const handler = new SSEHandler({ onState: (snapshot) => {
        if (capturedFollowGeneration !== this.followGeneration) return;
        latest = snapshot.message;
        this._applyBackgroundSnapshot(snapshot);
      } }, { signal: controller.signal });
      await handler.processStream(response);
      if (capturedFollowGeneration === this.followGeneration && !TERMINAL.has(latest.status)) this._scheduleBackgroundStatus(latest.id);
    } catch (error) {
      if (capturedFollowGeneration !== this.followGeneration) return;
      this.host.reportConnectionStatus(this, false, error instanceof Error ? error : new Error(String(error)));
      this._scheduleBackgroundStatus(message.id);
    } finally {
      if (this.followController === controller) this.followController = null;
    }
  }

  /** Read the latest status of a paused background message. */
  private async _readBackgroundStatus(messageId: string, capturedFollowGeneration: number): Promise<void> {
    if (!this.observeBackground || !this.host.isActive(this) || capturedFollowGeneration !== this.followGeneration) return;
    const controller = new AbortController();
    this.followController = controller;
    try {
      const response = await this.host.fetchObservationResponse(`/api/sdk/v1/messages/${encodeURIComponent(messageId)}/status`, controller.signal);
      const raw = await response.json() as Parameters<typeof normalizeMessage>[0] & {
        interaction?: { can_send_message: boolean; blocking_message_id: string | null };
      };
      if (capturedFollowGeneration !== this.followGeneration) return;
      if (!raw.interaction) throw new AgoError("Incomplete message status snapshot.", "stream_error");
      const message = normalizeMessage(raw, this.currentId, true);
      this.host.reportConnectionStatus(this, true);
      if (capturedFollowGeneration !== this.followGeneration) return;
      this._applyBackgroundSnapshot({ interaction: normalizeInteraction(raw.interaction), message });
      if (capturedFollowGeneration === this.followGeneration && !TERMINAL.has(message.status)) {
        if (["WAITING_APPROVAL", "PAUSED"].includes(message.status)) this._scheduleBackgroundStatus(message.id);
        else void this._followBackground(message, capturedFollowGeneration);
      }
    } catch (error) {
      if (capturedFollowGeneration !== this.followGeneration) return;
      this.host.reportConnectionStatus(this, false, error instanceof Error ? error : new Error(String(error)));
      this._scheduleBackgroundStatus(messageId);
    } finally {
      if (this.followController === controller) this.followController = null;
    }
  }

  private buildSnapshot(): AgoConversationSnapshot {
    return {
      id: this.currentId,
      isDraft: this.draft,
      title: this.title,
      messages: this.messages,
      interaction: this.interaction,
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
