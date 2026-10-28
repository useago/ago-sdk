import { describe, expect, it, vi } from "vitest";
import { SSEHandler } from "../src/streaming/SSEHandler";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("SSEHandler: ticketing form tool call", () => {
  it("maps a form over its running tool call without changing the assistant status", async () => {
    const onToolCall = vi.fn();
    const handler = new SSEHandler({ onToolCall });
    const payload = {
      tool_call_data: true,
      type: "form",
      id: "tc-1",
      status: "waiting_input",
      tool_name: "ago_ticketing",
      tool_type: "ago_ticketing",
      message_id: "m-1",
      display_mode: "display",
      ask_to_talk_to_human: true,
      allowed_to_create_ticket: false,
      ticket: {
        subject: "Login broken",
        typology: "Question",
        priority: "Normal",
        custom_fields: { product: "app" },
      },
      mode: "embed",
      ticket_form_id: "tf-1",
      embed_html: "<form></form>",
      embed_description: "Fill in",
      thread: { id: "t-1" },
    };
    const message = await handler.processStream(
      sseResponse([
        'data: {"message_id":"m-1","thread":{"id":"t-1"},"status":"IN_PROGRESS"}\n\n',
        'data: {"tool_call_data":true,"id":"tc-1","type":"progress_indicator","status":"running","tool_type":null,"message_id":null}\n\n',
        `data: ${JSON.stringify(payload)}\n\n`,
      ]),
    );
    expect(onToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tc-1",
        type: "form",
        toolName: "ago_ticketing",
        toolType: "ago_ticketing",
        messageId: "m-1",
        conversationId: "t-1",
        displayMode: "display",
        askToTalkToHuman: true,
        allowedToCreateTicket: false,
        ticket: {
          subject: "Login broken",
          typology: "Question",
          priority: "Normal",
          custom_fields: { product: "app" },
        },
        mode: "embed",
        ticketFormId: "tf-1",
        embedHtml: "<form></form>",
        embedDescription: "Fill in",
      }),
    );
    expect(onToolCall).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: "tc-1", type: "progress_indicator", toolType: undefined, messageId: undefined,
    }));
    expect(message.status).toBe("IN_PROGRESS");
    expect(message.toolCalls).toEqual([
      expect.objectContaining({ id: "tc-1", type: "form", status: "waiting_input" }),
    ]);
  });
});
