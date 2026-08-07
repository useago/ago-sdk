import type {
  AgoMessage,
  AgoSource,
  ToolCallData,
  SSEChunkData,
} from "../client/types";
import { AgoStreamError } from "../client/errors";
import { logger } from "../utils/logger";

/**
 * Deterministic JSON serialization with object keys sorted recursively, so the
 * same arguments produce the same string regardless of key order across the two
 * SSE shapes the backend emits for a client-function call.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

export interface SSEHandlerCallbacks {
  /**
   * Every raw SSE chunk parsed off the stream, fired before it's interpreted into
   * the higher-level callbacks below. The verbatim payload, for debugging/logging.
   */
  onRawChunk?: (data: SSEChunkData) => void;
  onStart?: (data: { conversationId: string; messageId: string }) => void;
  onChunk?: (data: { content: string; conversationId: string; messageId: string }) => void;
  onToolCall?: (toolCall: ToolCallData) => void;
  onClientFunction?: (data: {
    invocationId: string;
    functionName: string;
    arguments: Record<string, unknown>;
    conversationId: string;
  }) => void;
  /**
   * The conversation's title was generated and streamed (the backend emits it
   * once, near the end of the first turn).
   */
  onTitle?: (data: { conversationId: string; title: string }) => void;
  /**
   * The main answer text is finished (the backend emitted `status: "DONE"`) but
   * follow-up replies may still be streaming. Fires once, before {@link onComplete},
   * with the message as it stands at that moment (no `followUpReplies` yet).
   */
  onAnswerComplete?: (message: AgoMessage) => void;
  /**
   * The turn paused on client function call(s) (pause mode): the backend closed
   * the stream with `status: "WAITING_CLIENT"` and the tool call ids awaiting a
   * result. {@link onComplete} does NOT fire for this stream — the turn is not
   * over; it resumes in a separate request once every result is submitted.
   */
  onWaitingClient?: (data: {
    conversationId: string;
    messageId: string;
    waitingToolCallIds: string[];
  }) => void;
  onComplete?: (message: AgoMessage) => void;
  onError?: (error: Error) => void;
}

export interface SSEHandlerOptions {
  /**
   * Signal of the fetch feeding this stream. When it fires the read rejects,
   * and that is a deliberate stop rather than a failure: the handler keeps the
   * text produced so far, ends the message as `CANCELED`, and does NOT call
   * `onError`.
   */
  signal?: AbortSignal;
}

/** Placeholder id for the raw-state form, which carries no invocation id. */
const NO_INVOCATION_ID = "";

/**
 * Handles SSE streaming responses from AGO backend
 */
export class SSEHandler {
  private buffer = "";
  private message: Partial<AgoMessage> = {};
  private toolCalls: ToolCallData[] = [];
  private sources: AgoSource[] = [];
  private followUpReplies: string[] = [];
  private isFirstChunk = true;
  private answerCompleteEmitted = false;
  private waitingClientEmitted = false;
  // Client-function invocations already dispatched this stream: name+arguments
  // -> the invocation ids seen for that shape. The backend emits the same call
  // under two SSE shapes (see handleChunk), so this guards a handler from
  // running twice, while still letting the agent call one function repeatedly.
  private firedClientFunctions = new Map<string, Set<string>>();

  constructor(
    private callbacks: SSEHandlerCallbacks,
    private options: SSEHandlerOptions = {}
  ) {}

  /**
   * Process a streaming response
   */
  async processStream(response: Response): Promise<AgoMessage> {
    if (!response.body) {
      throw new AgoStreamError(
        "Response has no body. The endpoint did not return a stream: check that " +
          "`baseUrl` points at an AGO API and nothing (proxy, mock) strips the SSE body.",
        "stream_no_body"
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const text = decoder.decode(value, { stream: true });
        this.buffer += text;
        this.processBuffer();
      }

      // Process any remaining data
      if (this.buffer.trim()) {
        this.processBuffer();
      }

      return this.buildFinalMessage();
    } catch (error) {
      // The caller closed the stream (see `AgoClient.stop`). Not a failure:
      // finish the message as CANCELED with whatever text already arrived, so
      // the partial answer stays on screen and `onComplete` still fires once.
      if (this.options.signal?.aborted) {
        this.message.status = "CANCELED";
        return this.buildFinalMessage();
      }
      const streamError =
        error instanceof Error
          ? error
          : new AgoStreamError(
              "Stream processing failed mid-flight. The connection may have dropped; retry the message."
            );
      this.callbacks.onError?.(streamError);
      throw streamError;
    } finally {
      reader.releaseLock();
    }
  }

  private processBuffer(): void {
    // SSE messages are separated by double newlines
    const parts = this.buffer.split("\n\n");

    // Keep the last part (might be incomplete)
    this.buffer = parts.pop() || "";

    for (const part of parts) {
      if (!part.trim()) continue;

      // Handle SSE format: "data: {...}" or ": heartbeat"
      const lines = part.split("\n");

      for (const line of lines) {
        if (line.startsWith(": ")) {
          // Comment/heartbeat, ignore
          continue;
        }

        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          try {
            const data = JSON.parse(jsonStr) as SSEChunkData;
            this.handleChunk(data);
          } catch (error) {
            logger.warn("Failed to parse SSE data:", jsonStr, error);
          }
        }
      }
    }
  }

  private handleChunk(data: SSEChunkData): void {
    // Surface the raw message first, so a logger sees the exact wire payload
    // regardless of which higher-level event (if any) it maps to below.
    this.callbacks.onRawChunk?.(data);

    // Handle message ID and conversation ID
    if (data.message_id && !this.message.id) {
      this.message.id = data.message_id;
    }

    if (data.thread?.id) {
      this.message.conversationId = data.thread.id;

      // Emit start event on first chunk with IDs
      if (this.isFirstChunk && this.message.id) {
        this.isFirstChunk = false;
        this.callbacks.onStart?.({
          conversationId: this.message.conversationId,
          messageId: this.message.id,
        });
      }
    }

    // A streamed title (generated once at the end of the first turn) — surface
    // it so a UI can update its header without a refetch.
    if (data.title && this.message.conversationId) {
      this.callbacks.onTitle?.({
        conversationId: this.message.conversationId,
        title: data.title,
      });
    }

    // Handle content
    if (data.content !== undefined) {
      this.message.content = (this.message.content || "") + data.content;
      if (this.message.conversationId && this.message.id) {
        this.callbacks.onChunk?.({
          content: data.content,
          conversationId: this.message.conversationId,
          messageId: this.message.id,
        });
      }
    }

    // Handle full content replacement
    if (data.full_content !== undefined) {
      this.message.content = data.full_content;
    }

    // Handle status
    if (data.status) {
      this.message.status = data.status;
    }

    // Handle agent
    if (data.agent) {
      this.message.agent = {
        id: data.agent.id,
        name: data.agent.name,
        displayName: data.agent.display_name,
      };
    }

    // Handle knowledge sources
    if (data.knowledge_sources) {
      this.sources = data.knowledge_sources.map((s) => {
        const doc = s.knowledge_document;
        return {
          id: doc.id,
          title: doc.title,
          url: doc.use_external_link ? doc.external_link_url : doc.internal_link_url,
        };
      });
    }

    // Client-side function invocation — fires from either the tool_call_data UI
    // event or the raw state dict streamed by the backend (which has no
    // tool_call_data flag). Either form is enough to run the registered handler,
    // but the backend can emit BOTH for one call, so dedupe to run it once.
    //
    // Keying on name + arguments alone is not enough: an agent can legitimately
    // call the same function twice in one turn with the same arguments (a
    // zero-argument function like `readPageData` collapses to one key every
    // time). Swallowing the second means its result is never submitted, the
    // backend never sees every result, and the paused turn never resumes. So
    // the invocation id breaks the tie when the backend provides one.
    if (data.type === "client_function" && data.function_name) {
      const key = `${data.function_name}::${stableStringify(data.arguments ?? {})}`;
      const invocationId = data.id || "";
      const seenIds = this.firedClientFunctions.get(key);

      let fire = false;
      if (!seenIds) {
        this.firedClientFunctions.set(key, new Set([invocationId]));
        fire = true;
      } else if (invocationId && !seenIds.has(invocationId)) {
        if (seenIds.has(NO_INVOCATION_ID)) {
          // We saw this call in its id-less raw-state form first. This is the
          // same call arriving with its id, not a new one: adopt the id.
          seenIds.delete(NO_INVOCATION_ID);
          seenIds.add(invocationId);
        } else {
          // Same shape, a different invocation id: a genuinely separate call.
          seenIds.add(invocationId);
          fire = true;
        }
      }

      if (fire) {
        this.callbacks.onClientFunction?.({
          invocationId,
          functionName: data.function_name,
          arguments: data.arguments || {},
          conversationId: this.message.conversationId || "",
        });
      }
    }

    // Handle standard tool call UI events
    if (data.tool_call_data && data.type && data.type !== "client_function") {
      const toolCall = this.parseToolCall(data);
      this.callbacks.onToolCall?.(toolCall);

      const existingIndex = this.toolCalls.findIndex((t) => t.id === toolCall.id);
      if (existingIndex >= 0) {
        this.toolCalls[existingIndex] = toolCall;
      } else {
        this.toolCalls.push(toolCall);
      }
    }

    // Handle follow-up replies
    if (data.follow_up_replies) {
      this.followUpReplies = data.follow_up_replies;
    }

    // The main answer text just finished (backend emitted `status: "DONE"`).
    // Surface it now so the UI can show the answer and re-enable input while the
    // follow-up replies are still being generated. Fires once, before onComplete.
    if (
      this.message.status === "DONE" &&
      !this.answerCompleteEmitted &&
      this.message.id
    ) {
      this.answerCompleteEmitted = true;
      this.callbacks.onAnswerComplete?.(this.buildMessage());
    }

    // The turn paused on client function call(s) (pause mode). The backend sends
    // this as the stream's final event, with the tool calls awaiting a result.
    if (
      this.message.status === "WAITING_CLIENT" &&
      !this.waitingClientEmitted &&
      this.message.id
    ) {
      this.waitingClientEmitted = true;
      this.callbacks.onWaitingClient?.({
        conversationId: this.message.conversationId || "",
        messageId: this.message.id,
        waitingToolCallIds: data.waiting_tool_call_ids ?? [],
      });
    }
  }

  private parseToolCall(data: SSEChunkData): ToolCallData {
    return {
      id: data.id || "",
      type: (data.type as ToolCallData["type"]) || "status_message",
      status: data.status || "unknown",
      toolName: data.tool_name || "",
      toolDisplayName: data.tool_display_name,
      message: data.message,
      formSchema: data.form_schema,
      data: data.data,
      functionName: data.function_name,
      arguments: data.arguments,
    };
  }

  /** Snapshot the accumulated message. Shared by the answer-complete and final builds. */
  private buildMessage(): AgoMessage {
    return {
      id: this.message.id || "",
      conversationId: this.message.conversationId || "",
      content: this.message.content || "",
      role: "assistant",
      status: this.message.status || "DONE",
      agent: this.message.agent,
      sources: this.sources.length > 0 ? this.sources : undefined,
      toolCalls: this.toolCalls.length > 0 ? this.toolCalls : undefined,
      followUpReplies:
        this.followUpReplies.length > 0 ? this.followUpReplies : undefined,
      createdAt: new Date(),
    };
  }

  private buildFinalMessage(): AgoMessage {
    const message = this.buildMessage();
    // A paused turn is not complete: onComplete stays silent for this stream and
    // fires at the end of the resumed one, so one logical turn completes once.
    if (message.status !== "WAITING_CLIENT") {
      this.callbacks.onComplete?.(message);
    }
    return message;
  }
}

/**
 * Check if an error is a network error that should trigger polling fallback
 */
export function isStreamNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("load failed") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("abort")
  );
}
