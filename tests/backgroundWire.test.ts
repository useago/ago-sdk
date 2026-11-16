import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { normalizeMessage } from "../src/client/messageNormalizer";
import { AgoClient } from "../src/client/AgoClient";
import { SSEHandler, isStreamNetworkError } from "../src/streaming/SSEHandler";
import { AgoApiError } from "../src/client/errors";

const fixture = (name: string) =>
  readFileSync(`tests/fixtures/background-sdk/${name}`, "utf8");
const json = (name: string) => JSON.parse(fixture(name));
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value));

function chunked(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, ++offset));
      },
    }),
  );
}

describe("background wire fixtures", () => {
  it.each([false, true])(
    "rejects malformed canonical state before callbacks (buffered=%s)",
    async (buffered) => {
      const data =
        'event: message\ndata: {"viewer_id":"viewer","interaction":{"can_send_message":false,"blocking_message_id":null},"message":{}}\n\n';
      const response = buffered
        ? ({ body: null, text: async () => data } as Response)
        : chunked(data);
      const onState = vi.fn();
      const onStart = vi.fn();
      const onComplete = vi.fn();
      await expect(
        new SSEHandler({ onState, onStart, onComplete }).processStream(
          response,
        ),
      ).rejects.toThrow("Invalid message snapshot");
      expect(onState).not.toHaveBeenCalled();
      expect(onStart).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
      const publicResponse = new Response(data);
      if (buffered)
        Object.defineProperty(publicResponse, "body", { value: null });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => publicResponse),
      );
      try {
        const client = new AgoClient({ baseUrl: "https://example.test" });
        const complete = vi.fn();
        const start = vi.fn();
        client.on("message:complete", complete);
        client.on("message:start", start);
        await expect(client.sendMessage("Hello")).rejects.toThrow(
          "Invalid message snapshot",
        );
        expect(start).not.toHaveBeenCalled();
        expect(complete).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it.each([false, true])(
    "does not treat a fatal API error after IDs as a network failure (buffered=%s)",
    async (buffered) => {
      const wire =
        'data: {"message_id":"m1","thread":{"id":"c1"},"status":"IN_PROGRESS"}\n\nevent: error\ndata: {"error":{"type":"permission_error","code":"denied","message":"Network policy denied the requested action","param":null,"doc_url":"https://example.test/errors#denied"}}\n\n';
      const response = new Response(wire);
      if (buffered) Object.defineProperty(response, "body", { value: null });
      const fetchMock = vi.fn(async () => response);
      vi.stubGlobal("fetch", fetchMock);
      try {
        const client = new AgoClient({ baseUrl: "https://example.test" });
        const complete = vi.fn();
        client.on("message:complete", complete);
        let caught: unknown;
        try {
          await client.sendMessage("Hello");
        } catch (error) {
          caught = error;
        }
        expect(caught).toMatchObject({
          code: "denied",
          statusCode: undefined,
          docUrl: "https://example.test/errors#denied",
        });
        expect(caught).toBeInstanceOf(AgoApiError);
        expect(isStreamNetworkError(caught as Error)).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(complete).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("retains network detection for ordinary connection errors", () => {
    expect(isStreamNetworkError(new Error("Network request failed"))).toBe(
      true,
    );
  });

  it("normalizes full authorized, redacted and final messages independently", () => {
    const authorized = normalizeMessage(
      json("status-approval-authorized.json"),
      "",
      true,
    );
    expect(authorized.createdAt).toBeInstanceOf(Date);
    expect(asJson(authorized)).toEqual(
      json("expected/authorized-wait.json").message,
    );
    const redacted = normalizeMessage(
      json("status-approval-redacted.json"),
      "",
      true,
    );
    expect(asJson(redacted)).toEqual(
      json("expected/redacted-wait-message.json"),
    );
    expect(redacted.approval?.actions).toEqual([]);
    expect(
      asJson(normalizeMessage(json("status-final.json"), "", true)),
    ).toEqual(json("expected/final-message.json"));
  });

  it("does not complete an unfinished canonical send at EOF", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(fixture("initial-send.sse"))),
    );
    try {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const complete = vi.fn();
      client.on("message:complete", complete);
      const message = await client.sendMessage("Start");
      expect(message.status).toBe("IN_PROGRESS");
      expect(complete).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the same mapping for public conversation history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(fixture("history-approval-authorized.json"), {
            status: 200,
          }),
      ),
    );
    try {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const conversation = await client.getConversation(
        "11111111-1111-4111-8111-111111111111",
      );
      const assistant = conversation.messages?.find(
        (message) => message.role === "assistant",
      );
      expect(asJson(assistant)).toEqual(
        json("expected/authorized-wait.json").message,
      );
      expect(conversation.interaction).toEqual(
        json("expected/authorized-wait.json").conversationUpdate.interaction,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("clears nullable and collection fields on full snapshots", () => {
    const raw = json("status-approval-authorized.json");
    const message = normalizeMessage(
      {
        ...raw,
        approval: null,
        progress: null,
        outcome: null,
        attachments: [],
        tool_call_data: [],
        sources: [],
        follow_up_replies: [],
      },
      "",
      true,
    );
    expect(message).toMatchObject({
      approval: null,
      progress: null,
      outcome: null,
      attachments: [],
      toolCalls: [],
      sources: [],
      followUpReplies: [],
    });
  });

  it("replaces legacy deltas with an unfinished named snapshot and keeps tool status isolated", async () => {
    const onState = vi.fn();
    const onComplete = vi.fn();
    const result = await new SSEHandler({ onState, onComplete }).processStream(
      chunked(fixture("initial-send.sse")),
    );
    expect(onState).toHaveBeenCalledOnce();
    expect(result.status).toBe("IN_PROGRESS");
    expect(onComplete).not.toHaveBeenCalled();
    expect(result.content).toBe(onState.mock.calls[0][0].message.content);
  });

  it("replaces authorized state with the redacted snapshot and preserves metadata", async () => {
    const states: Array<{
      verifiedUserId: string;
      message: unknown;
      interaction: unknown;
    }> = [];
    const handler = new SSEHandler({ onState: (state) => states.push(state) });
    const wire =
      fixture("follow-approval-authorized.sse") +
      fixture("follow-approval-redacted.sse");
    const result = await handler.processStream(chunked(wire));
    expect(asJson(states[0].message)).toEqual(
      json("expected/authorized-wait.json").message,
    );
    expect(asJson(result)).toEqual(json("expected/redacted-wait-message.json"));
    expect(states[1].interaction).toEqual(
      json("expected/authorized-wait.json").conversationUpdate.interaction,
    );
  });

  it.each([false, true])("reports a fatal error before IDs (buffered=%s)", async (buffered) => {
    const wire = fixture("fatal-pre-id.sse");
    const response = buffered ? ({ body: null, text: async () => wire } as Response) : chunked(wire);
      await expect(
        new SSEHandler({}).processStream(response),
      ).rejects.toMatchObject({
        code: "conversation_busy",
        statusCode: undefined,
        docUrl: "https://docs.useago.com/api/errors#conversation_busy",
      });
    },
  );
});
