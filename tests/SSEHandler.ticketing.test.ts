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
  it("maps the ticketing fields of a form tool call onto camelCase", async () => {
    const onToolCall = vi.fn();
    const handler = new SSEHandler({ onToolCall });
    const payload = {
      tool_call_data: true,
      type: "form",
      id: "tc-1",
      status: "waiting_input",
      tool_name: "ago_ticketing",
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
    await handler.processStream(
      sseResponse([`data: ${JSON.stringify(payload)}\n\n`]),
    );
    expect(onToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tc-1",
        type: "form",
        toolName: "ago_ticketing",
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
  });
});
