import type { HttpClient } from "../api/HttpClient";
import { AgoApiError } from "../client/errors";
import type { AgoClientEvents, Conversation, HandoffState } from "../client/types";
import { readSSEData } from "../streaming/readSSEData";
import { logger } from "../utils/logger";
import { isHandedOff, parseHandoff, sameHandoff } from "./handoff";
import type { RawHandoff } from "../client/types";

const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

type Emit = <K extends "handoff:changed" | "conversation:updated">(
  event: K,
  data: AgoClientEvents[K],
) => void;

export interface LiveConversationDeps {
  http: Pick<HttpClient, "getStream" | "put">;
  emit: Emit;
  /** Fetch a conversation without emitting `conversation:loaded`; must report its handoff back. */
  fetchConversation: (id: string) => Promise<Conversation>;
  /** A turn is streaming for this conversation right now. */
  isStreaming: (id: string) => boolean;
  /** Query string announcing client capabilities (`""` or `"?remote_assist=1"`). */
  streamQuery: () => Promise<string>;
  /** The live stream (re)connected for the active conversation. */
  onReady?: (conversationId: string) => void;
  /** The live stream reported a remote-assistance change. */
  onRemoteAssistUpdate?: (conversationId: string) => void;
  /** The active conversation changed. */
  onActiveChange?: (conversationId: string | null) => void;
  /** A conversation's handoff state changed. */
  onHandoffChange?: (conversationId: string, handoff: HandoffState | null) => void;
}

interface OpenStream {
  conversationId: string;
  controller: AbortController;
}

/**
 * Follows the conversation the visitor is looking at while a human handles it:
 * tracks each conversation's handoff state, keeps the live SSE stream open only
 * while the active one is `waiting` or `human`, refetches it on `update`
 * frames, and sends read receipts while it is actually visible.
 */
export class LiveConversation {
  private handoffs = new Map<string, HandoffState | null>();
  private activeId: string | null = null;
  private visible = true;
  private stream: OpenStream | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  /** A 4xx refused the stream for this conversation: wait for a state change. */
  private refusedFor: string | null = null;
  /** Conversations whose refetch waits for the current turn to end. */
  private deferred = new Set<string>();
  private refetching = new Map<string, Promise<void>>();
  private refetchAgain = new Set<string>();
  private connectedOnce = new Set<string>();
  private removeVisibilityListener: (() => void) | null = null;

  constructor(private deps: LiveConversationDeps) {}

  getHandoff(conversationId: string): HandoffState | null {
    return this.handoffs.get(conversationId) ?? null;
  }

  hasHandoff(conversationId: string): boolean {
    return this.handoffs.has(conversationId);
  }

  getActive(): string | null {
    return this.activeId;
  }

  /** Whether the live stream is open (or connecting) for the active conversation. */
  isStreamOpen(): boolean {
    return this.stream !== null;
  }

  setActive(conversationId: string | null): void {
    if (conversationId === this.activeId) return;
    this.closeStream();
    this.activeId = conversationId;
    this.refusedFor = null;
    this.attempt = 0;
    if (conversationId) this.listenToVisibility();
    this.deps.onActiveChange?.(conversationId);
    this.sync();
    this.markRead();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) this.markRead();
  }

  /** Record a handoff state learned from any source. */
  updateHandoff(conversationId: string, raw: RawHandoff | null | undefined): void {
    this.setHandoff(conversationId, parseHandoff(raw));
  }

  setHandoff(conversationId: string, handoff: HandoffState | null): void {
    const known = this.handoffs.has(conversationId);
    const previous = this.handoffs.get(conversationId) ?? null;
    this.handoffs.set(conversationId, handoff);
    if (known && sameHandoff(previous, handoff)) return;
    if (known || handoff) {
      this.deps.emit("handoff:changed", { conversationId, handoff });
      this.deps.onHandoffChange?.(conversationId, handoff);
    }
    if (conversationId === this.activeId) {
      if (previous?.state !== handoff?.state) this.refusedFor = null;
      this.sync();
      // Opened before its state was known: the receipt setActive skipped.
      if (!isHandedOff(previous) && isHandedOff(handoff)) this.markRead();
    }
  }

  /** A turn ended: run the refetch an `update` frame asked for while it streamed. */
  onTurnEnd(conversationId: string | null): void {
    if (conversationId && this.deferred.delete(conversationId)) {
      void this.refetch(conversationId);
    }
  }

  /** Refetch a conversation (coalesced), then emit `conversation:updated`. */
  refetch(conversationId: string): Promise<void> {
    if (this.deps.isStreaming(conversationId)) {
      this.deferred.add(conversationId);
      return Promise.resolve();
    }
    const running = this.refetching.get(conversationId);
    if (running) {
      this.refetchAgain.add(conversationId);
      return running;
    }
    const run = (async () => {
      try {
        const conversation = await this.deps.fetchConversation(conversationId);
        if (conversationId === this.activeId) {
          this.deps.emit("conversation:updated", conversation);
          this.markRead();
        }
      } catch (error) {
        logger.warn("Refreshing the conversation failed:", error);
      } finally {
        this.refetching.delete(conversationId);
        if (this.refetchAgain.delete(conversationId)) void this.refetch(conversationId);
      }
    })();
    this.refetching.set(conversationId, run);
    return run;
  }

  /** Tell the backend the visitor sees the conversation (agents see "seen"). */
  markRead(): void {
    const id = this.activeId;
    if (!id || !this.visible || !isHandedOff(this.handoffs.get(id))) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    this.deps.http
      .put(`/api/sdk/v1/conversations/${encodeURIComponent(id)}/read`)
      .catch((error) => logger.warn("Read receipt failed:", error));
  }

  /** Close everything; the instance stays usable (StrictMode revives the client). */
  stop(): void {
    this.closeStream();
    this.activeId = null;
    this.deferred.clear();
    this.refetchAgain.clear();
    this.connectedOnce.clear();
    this.removeVisibilityListener?.();
    this.removeVisibilityListener = null;
  }

  private listenToVisibility(): void {
    if (this.removeVisibilityListener || typeof document === "undefined") return;
    const onChange = (): void => {
      if (document.visibilityState === "visible") this.markRead();
    };
    document.addEventListener("visibilitychange", onChange);
    this.removeVisibilityListener = () =>
      document.removeEventListener("visibilitychange", onChange);
  }

  private sync(): void {
    const id = this.activeId;
    const wanted = !!id && isHandedOff(this.handoffs.get(id)) && this.refusedFor !== id;
    if (!wanted) {
      this.closeStream();
      return;
    }
    if (this.stream || this.retryTimer) return;
    void this.open(id!);
  }

  private closeStream(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.stream?.controller.abort();
    this.stream = null;
  }

  private async open(conversationId: string): Promise<void> {
    const stream: OpenStream = { conversationId, controller: new AbortController() };
    this.stream = stream;
    const current = (): boolean =>
      this.stream === stream && !stream.controller.signal.aborted;
    try {
      const query = await this.deps.streamQuery();
      if (!current()) return;
      const response = await this.deps.http.getStream(
        `/api/sdk/v1/conversations/${encodeURIComponent(conversationId)}/live${query}`,
        { signal: stream.controller.signal },
      );
      if (!current()) return;
      await readSSEData(response, (frame) => {
        if (current()) this.handleFrame(conversationId, frame);
      });
      if (!current()) return;
      this.stream = null;
      this.scheduleReconnect(conversationId);
    } catch (error) {
      if (!current()) return;
      this.stream = null;
      const status = error instanceof AgoApiError ? error.statusCode : undefined;
      if (status !== undefined && status >= 400 && status < 500) {
        logger.warn(`Live stream refused (HTTP ${status}); not reconnecting.`);
        this.refusedFor = conversationId;
        return;
      }
      this.scheduleReconnect(conversationId);
    }
  }

  private scheduleReconnect(conversationId: string): void {
    const delay = Math.min(MIN_RETRY_MS * 2 ** this.attempt, MAX_RETRY_MS);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.activeId === conversationId) this.sync();
    }, delay);
  }

  private handleFrame(conversationId: string, frame: unknown): void {
    if (!frame || typeof frame !== "object") return;
    const data = frame as { type?: string; kind?: string; handoff?: RawHandoff | null };
    if (data.type === "ready") {
      this.attempt = 0;
      const reconnect = this.connectedOnce.has(conversationId);
      this.connectedOnce.add(conversationId);
      // Changes made while the stream was down are only visible on a refetch.
      if (reconnect) void this.refetch(conversationId);
      if ("handoff" in data) this.updateHandoff(conversationId, data.handoff);
      this.deps.onReady?.(conversationId);
      return;
    }
    if (data.type !== "update") return;
    if (data.kind === "remote_assist") {
      this.deps.onRemoteAssistUpdate?.(conversationId);
      return;
    }
    // Refetch before applying the state: a handoff that just ended closes this
    // stream, and its closing marker only arrives through the refetch.
    void this.refetch(conversationId);
    if ("handoff" in data) this.updateHandoff(conversationId, data.handoff);
  }
}
