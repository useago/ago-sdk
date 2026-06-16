import type { AgoClient } from "../client/AgoClient";
import type {
  AgoMessage,
  AgoClientEvents,
  ToolCallData,
  ClientFunctionInvocation,
} from "../client/types";

/**
 * Subscribe to complete messages with a simple callback. Returns an unsubscribe function.
 *
 * ```ts
 * const unsub = onMessage(client, (msg) => console.log(msg.content));
 * // later: unsub();
 * ```
 */
export function onMessage(
  client: AgoClient,
  callback: (message: AgoMessage) => void
): () => void {
  client.on("message:complete", callback);
  return () => client.off("message:complete", callback);
}

/**
 * Subscribe to streaming text chunks.
 *
 * ```ts
 * onMessageChunk(client, ({ content }) => {
 *   outputEl.textContent += content;
 * });
 * ```
 */
export function onMessageChunk(
  client: AgoClient,
  callback: (data: AgoClientEvents["message:chunk"]) => void
): () => void {
  client.on("message:chunk", callback);
  return () => client.off("message:chunk", callback);
}

/**
 * Subscribe to message start events.
 */
export function onMessageStart(
  client: AgoClient,
  callback: (data: AgoClientEvents["message:start"]) => void
): () => void {
  client.on("message:start", callback);
  return () => client.off("message:start", callback);
}

/**
 * Subscribe to message errors.
 */
export function onMessageError(
  client: AgoClient,
  callback: (data: AgoClientEvents["message:error"]) => void
): () => void {
  client.on("message:error", callback);
  return () => client.off("message:error", callback);
}

/**
 * Subscribe to tool call events.
 */
export function onToolCall(
  client: AgoClient,
  callback: (toolCall: ToolCallData) => void
): () => void {
  client.on("toolCall:received", callback);
  return () => client.off("toolCall:received", callback);
}

/**
 * Subscribe to successful form collector submissions. `result` is the submit
 * response (the third-party API's answer). Returns an unsubscribe function.
 *
 * ```ts
 * const unsub = onFormSubmitted(client, ({ name, result }) => {
 *   console.log(name, "submitted", result);
 * });
 * ```
 */
export function onFormSubmitted(
  client: AgoClient,
  callback: (data: AgoClientEvents["form:submitted"]) => void
): () => void {
  client.on("form:submitted", callback);
  return () => client.off("form:submitted", callback);
}

/**
 * Subscribe to failed form collector submissions (network/server failures).
 */
export function onFormError(
  client: AgoClient,
  callback: (data: AgoClientEvents["form:error"]) => void
): () => void {
  client.on("form:error", callback);
  return () => client.off("form:error", callback);
}

/**
 * Subscribe to client function invocations.
 */
export function onFunctionInvoke(
  client: AgoClient,
  callback: (data: ClientFunctionInvocation) => void
): () => void {
  client.on("function:invoke", callback);
  return () => client.off("function:invoke", callback);
}

/**
 * Send a message and iterate over chunks as an async generator.
 * Gives you full control over how you process the stream.
 *
 * ```ts
 * for await (const chunk of createMessageStream(client, "Hello!")) {
 *   console.log(chunk.type, chunk.data);
 * }
 * ```
 */
export async function* createMessageStream(
  client: AgoClient,
  content: string,
  options?: { conversationId?: string; agentId?: string; files?: File[] }
): AsyncGenerator<
  | { type: "start"; data: AgoClientEvents["message:start"] }
  | { type: "chunk"; data: AgoClientEvents["message:chunk"] }
  | { type: "complete"; data: AgoMessage }
  | { type: "error"; data: AgoClientEvents["message:error"] }
  | { type: "toolCall"; data: ToolCallData }
> {
  type StreamEvent =
    | { type: "start"; data: AgoClientEvents["message:start"] }
    | { type: "chunk"; data: AgoClientEvents["message:chunk"] }
    | { type: "complete"; data: AgoMessage }
    | { type: "error"; data: AgoClientEvents["message:error"] }
    | { type: "toolCall"; data: ToolCallData };

  const queue: StreamEvent[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const push = (event: StreamEvent) => {
    queue.push(event);
    resolve?.();
  };

  const onStart = (data: AgoClientEvents["message:start"]) => push({ type: "start", data });
  const onChunk = (data: AgoClientEvents["message:chunk"]) => push({ type: "chunk", data });
  const onComplete = (data: AgoMessage) => {
    push({ type: "complete", data });
    done = true;
    resolve?.();
  };
  const onError = (data: AgoClientEvents["message:error"]) => {
    push({ type: "error", data });
    done = true;
    resolve?.();
  };
  const onTool = (data: ToolCallData) => push({ type: "toolCall", data });

  client.on("message:start", onStart);
  client.on("message:chunk", onChunk);
  client.on("message:complete", onComplete);
  client.on("message:error", onError);
  client.on("toolCall:received", onTool);

  // Fire the request (don't await — we'll consume events via the generator)
  client.sendMessage(content, options).catch(() => {
    done = true;
    resolve?.();
  });

  try {
    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((r) => { resolve = r; });
        resolve = null;
      }
    }
  } finally {
    client.off("message:start", onStart);
    client.off("message:chunk", onChunk);
    client.off("message:complete", onComplete);
    client.off("message:error", onError);
    client.off("toolCall:received", onTool);
  }
}
