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
   * The main answer text is finished (the backend emitted `status: "DONE"`) but
   * follow-up replies may still be streaming. Fires once, before {@link onComplete},
   * with the message as it stands at that moment (no `followUpReplies` yet).
   */
  onAnswerComplete?: (message: AgoMessage) => void;
  onComplete?: (message: AgoMessage) => void;
  onError?: (error: Error) => void;
}

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
  // Client-function invocations already dispatched this stream, keyed by name +
  // arguments. The backend emits the same call under two SSE shapes (see below),
  // so this guards a handler from running twice (e.g. a duplicate form submit).
  private firedClientFunctions = new Set<string>();

  constructor(private callbacks: SSEHandlerCallbacks) {}

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
    // The id is absent on the raw-state form, so key on the stable function name
    // + arguments rather than the invocation id.
    if (data.type === "client_function" && data.function_name) {
      const key = `${data.function_name}::${stableStringify(data.arguments ?? {})}`;
      if (!this.firedClientFunctions.has(key)) {
        this.firedClientFunctions.add(key);
        this.callbacks.onClientFunction?.({
          invocationId: data.id || "",
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
    this.callbacks.onComplete?.(message);
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
