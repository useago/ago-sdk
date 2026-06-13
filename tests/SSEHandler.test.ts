import { describe, it, expect, vi } from "vitest";
import { SSEHandler } from "../src/streaming/SSEHandler";

// Helper to create a mock ReadableStream from SSE data
function createMockSSEStream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let chunkIndex = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunkIndex < chunks.length) {
        controller.enqueue(encoder.encode(chunks[chunkIndex]));
        chunkIndex++;
      } else {
        controller.close();
      }
    },
  });

  return new Response(stream);
}

describe("SSEHandler", () => {
  describe("processStream", () => {
    it("should parse basic SSE message with content", async () => {
      const onChunk = vi.fn();
      const onComplete = vi.fn();

      const handler = new SSEHandler({
        onChunk,
        onComplete,
      });

      const response = createMockSSEStream([
        'data: {"content":"Hello ","message_id":"msg-1","thread":{"id":"thread-1"}}\n\n',
        'data: {"content":"world","message_id":"msg-1","thread":{"id":"thread-1"}}\n\n',
        'data: {"status":"DONE","message_id":"msg-1","thread":{"id":"thread-1"}}\n\n',
      ]);

      const result = await handler.processStream(response);

      expect(result.id).toBe("msg-1");
      expect(result.conversationId).toBe("thread-1");
      expect(result.content).toBe("Hello world");
      expect(result.status).toBe("DONE");
    });

    it("fires onRawChunk once per parsed SSE message, with the verbatim payload", async () => {
      const onRawChunk = vi.fn();

      const handler = new SSEHandler({ onRawChunk });

      const response = createMockSSEStream([
        ': heartbeat\n\n',
        'data: {"content":"Hi","message_id":"msg-1","thread":{"id":"thread-1"}}\n\n',
        'data: {"status":"DONE","message_id":"msg-1","thread":{"id":"thread-1"}}\n\n',
      ]);

      await handler.processStream(response);

      // The heartbeat comment is not a message, so only the two data lines fire.
      expect(onRawChunk).toHaveBeenCalledTimes(2);
      expect(onRawChunk).toHaveBeenNthCalledWith(1, {
        content: "Hi",
        message_id: "msg-1",
        thread: { id: "thread-1" },
      });
      expect(onRawChunk).toHaveBeenNthCalledWith(2, {
        status: "DONE",
        message_id: "msg-1",
        thread: { id: "thread-1" },
      });
    });

    it("fires onAnswerComplete on the DONE edge, before onComplete and without follow-ups", async () => {
      const order: string[] = [];
      const onAnswerComplete = vi.fn(() => order.push("answer-complete"));
      const onComplete = vi.fn(() => order.push("complete"));

      const handler = new SSEHandler({ onAnswerComplete, onComplete });

      const response = createMockSSEStream([
        'data: {"content":"Hello world","message_id":"msg-1","thread":{"id":"thread-1"}}\n\n',
        'data: {"status":"DONE","message_id":"msg-1","thread":{"id":"thread-1"}}\n\n',
        'data: {"follow_up_replies":["Pricing","Demo"],"message_id":"msg-1","thread":{"id":"thread-1"}}\n\n',
      ]);

      await handler.processStream(response);

      // Answer-complete fires exactly once, with the answer but no follow-ups yet.
      expect(onAnswerComplete).toHaveBeenCalledTimes(1);
      const answerMsg = onAnswerComplete.mock.calls[0][0];
      expect(answerMsg.content).toBe("Hello world");
      expect(answerMsg.status).toBe("DONE");
      expect(answerMsg.followUpReplies).toBeUndefined();

      // It precedes onComplete, whose message carries the follow-up replies.
      expect(order).toEqual(["answer-complete", "complete"]);
      const finalMsg = onComplete.mock.calls[0][0];
      expect(finalMsg.followUpReplies).toEqual(["Pricing", "Demo"]);
    });

    it("does not fire onAnswerComplete when the stream never reaches DONE", async () => {
      const onAnswerComplete = vi.fn();
      const handler = new SSEHandler({ onAnswerComplete });

      const response = createMockSSEStream([
        'data: {"content":"partial","message_id":"msg-1","thread":{"id":"t-1"}}\n\n',
      ]);
      await handler.processStream(response);

      expect(onAnswerComplete).not.toHaveBeenCalled();
    });

    it("should handle chunked SSE messages", async () => {
      const onChunk = vi.fn();

      const handler = new SSEHandler({
        onChunk,
      });

      // Simulate chunks that split across SSE message boundaries
      const response = createMockSSEStream([
        'data: {"content":"Part 1","message_id":"msg-1","thread":{"id":"t-1"}}\n',
        '\ndata: {"content":" Part 2","message_id":"msg-1","thread":{"id":"t-1"}}\n\n',
      ]);

      const result = await handler.processStream(response);

      expect(result.content).toBe("Part 1 Part 2");
    });

    it("should emit onStart event on first chunk with IDs", async () => {
      const onStart = vi.fn();

      const handler = new SSEHandler({
        onStart,
      });

      const response = createMockSSEStream([
        'data: {"content":"Hi","message_id":"msg-1","thread":{"id":"thread-1"}}\n\n',
      ]);

      await handler.processStream(response);

      expect(onStart).toHaveBeenCalledWith({
        conversationId: "thread-1",
        messageId: "msg-1",
      });
    });

    it("should handle client_function tool calls", async () => {
      const onClientFunction = vi.fn();

      const handler = new SSEHandler({
        onClientFunction,
      });

      const response = createMockSSEStream([
        'data: {"tool_call_data":true,"type":"client_function","id":"inv-1","function_name":"openCart","arguments":{"productId":"123"},"thread":{"id":"t-1"}}\n\n',
      ]);

      await handler.processStream(response);

      expect(onClientFunction).toHaveBeenCalledWith({
        invocationId: "inv-1",
        functionName: "openCart",
        arguments: { productId: "123" },
        conversationId: "t-1",
      });
    });

    it("should handle client_function raw state events without tool_call_data", async () => {
      const onClientFunction = vi.fn();
      const onToolCall = vi.fn();

      const handler = new SSEHandler({
        onClientFunction,
        onToolCall,
      });

      const response = createMockSSEStream([
        'data: {"type":"client_function","function_name":"navigateToPage","arguments":{"page":"products"},"thread":{"id":"t-1"}}\n\n',
      ]);

      await handler.processStream(response);

      expect(onClientFunction).toHaveBeenCalledWith({
        invocationId: "",
        functionName: "navigateToPage",
        arguments: { page: "products" },
        conversationId: "t-1",
      });
      expect(onToolCall).not.toHaveBeenCalled();
    });

    it("runs a client_function once when the backend emits both SSE shapes for one call", async () => {
      const onClientFunction = vi.fn();

      const handler = new SSEHandler({
        onClientFunction,
      });

      // The backend can emit the same invocation twice: once as the raw state
      // dict (no tool_call_data, no id) and once as the tool_call_data UI event.
      // The handler must fire only once so a form submit isn't POSTed twice.
      const response = createMockSSEStream([
        'data: {"type":"client_function","function_name":"submit_order","arguments":{},"thread":{"id":"t-1"}}\n\n',
        'data: {"tool_call_data":true,"type":"client_function","id":"inv-9","function_name":"submit_order","arguments":{},"thread":{"id":"t-1"}}\n\n',
      ]);

      await handler.processStream(response);

      expect(onClientFunction).toHaveBeenCalledTimes(1);
    });

    it("runs distinct client_function calls even when names repeat with different args", async () => {
      const onClientFunction = vi.fn();

      const handler = new SSEHandler({
        onClientFunction,
      });

      const response = createMockSSEStream([
        'data: {"type":"client_function","function_name":"update_order","arguments":{"qty":1},"thread":{"id":"t-1"}}\n\n',
        'data: {"type":"client_function","function_name":"update_order","arguments":{"qty":2},"thread":{"id":"t-1"}}\n\n',
      ]);

      await handler.processStream(response);

      expect(onClientFunction).toHaveBeenCalledTimes(2);
    });

    it("should handle regular tool calls", async () => {
      const onToolCall = vi.fn();

      const handler = new SSEHandler({
        onToolCall,
      });

      const response = createMockSSEStream([
        'data: {"tool_call_data":true,"type":"form","id":"tc-1","status":"waiting_input","tool_name":"feedback","thread":{"id":"t-1"}}\n\n',
      ]);

      await handler.processStream(response);

      expect(onToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "tc-1",
          type: "form",
          status: "waiting_input",
          toolName: "feedback",
        })
      );
    });

    it("should ignore heartbeat comments", async () => {
      const onChunk = vi.fn();

      const handler = new SSEHandler({
        onChunk,
      });

      const response = createMockSSEStream([
        ": heartbeat\n\n",
        'data: {"content":"Hi","message_id":"m1","thread":{"id":"t1"}}\n\n',
        ": heartbeat\n\n",
      ]);

      await handler.processStream(response);

      // Should only have one chunk call (for actual content)
      expect(onChunk).toHaveBeenCalledTimes(1);
    });

    it("should handle agent information", async () => {
      const handler = new SSEHandler({});

      const response = createMockSSEStream([
        'data: {"agent":{"id":"agent-1","name":"helper","display_name":"Helper Bot"},"message_id":"m1","thread":{"id":"t1"}}\n\n',
        'data: {"content":"Hello","message_id":"m1","thread":{"id":"t1"}}\n\n',
      ]);

      const result = await handler.processStream(response);

      expect(result.agent).toEqual({
        id: "agent-1",
        name: "helper",
        displayName: "Helper Bot",
      });
    });

    it("should handle knowledge sources", async () => {
      const handler = new SSEHandler({});

      // Backend sends knowledge_sources with nested knowledge_document
      const response = createMockSSEStream([
        'data: {"knowledge_sources":[{"knowledge_document":{"id":"src-1","title":"Doc 1","use_external_link":true,"external_link_url":"https://example.com/1"},"position":1},{"knowledge_document":{"id":"src-2","title":"Doc 2","use_external_link":false,"internal_link_url":"https://internal.com/2"},"position":2}],"message_id":"m1","thread":{"id":"t1"}}\n\n',
      ]);

      const result = await handler.processStream(response);

      expect(result.sources).toHaveLength(2);
      expect(result.sources![0]).toEqual({
        id: "src-1",
        title: "Doc 1",
        url: "https://example.com/1",
      });
      expect(result.sources![1]).toEqual({
        id: "src-2",
        title: "Doc 2",
        url: "https://internal.com/2",
      });
    });

    it("should handle follow-up replies", async () => {
      const handler = new SSEHandler({});

      const response = createMockSSEStream([
        'data: {"follow_up_replies":["Option 1","Option 2"],"message_id":"m1","thread":{"id":"t1"}}\n\n',
      ]);

      const result = await handler.processStream(response);

      expect(result.followUpReplies).toEqual(["Option 1", "Option 2"]);
    });
  });
});
