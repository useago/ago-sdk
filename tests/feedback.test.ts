import { afterEach, describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { AgoError } from "../src/client/errors";

function stubFetch(body: unknown = {}) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function bodyOf(fetchMock: ReturnType<typeof stubFetch>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

const CONVERSATION = {
  id: "conv-1",
  title: "Thread",
  created_at: "2026-07-01T00:00:00Z",
  last_message_at: "2026-07-01T00:10:00Z",
  messages: [
    {
      id: "m1",
      content: "hi",
      role: "user",
      status: "DONE",
      created_at: "2026-07-01T00:00:00Z",
    },
    {
      id: "m2",
      content: "Hello!",
      role: "assistant",
      status: "DONE",
      created_at: "2026-07-01T00:00:05Z",
    },
    {
      id: "m3",
      content: "Anything else?",
      role: "assistant",
      status: "DONE",
      created_at: "2026-07-01T00:00:10Z",
    },
  ],
};

describe("submitFeedback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the rating to the message's feedback endpoint", async () => {
    const fetchMock = stubFetch();
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    await client.submitFeedback("m2", "positive");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://x.example.com/api/sdk/v1/messages/m2/feedback",
    );
    expect(bodyOf(fetchMock)).toEqual({ rating: "positive" });
  });

  it("sends reasons and comment when the user says what went wrong", async () => {
    const fetchMock = stubFetch();
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    await client.submitFeedback("m2", "negative", {
      reasons: ["inaccurate", "information_not_found"],
      comment: "  The price is from last year.  ",
    });

    expect(bodyOf(fetchMock)).toEqual({
      rating: "negative",
      reasons: ["inaccurate", "information_not_found"],
      // Trimmed client-side so a stray newline doesn't become a "comment".
      comment: "The price is from last year.",
    });
  });

  it("de-duplicates reasons, which the backend would refuse on length", async () => {
    const fetchMock = stubFetch();
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    // The backend caps the list at the number of reasons that exist and checks
    // that length before it looks at the values, so five entries is a 422 even
    // when they are all the same valid reason.
    await client.submitFeedback("m2", "negative", {
      reasons: [
        "inaccurate",
        "inaccurate",
        "incomplete",
        "inaccurate",
        "incomplete",
      ],
    });

    expect(bodyOf(fetchMock)).toEqual({
      rating: "negative",
      reasons: ["inaccurate", "incomplete"],
    });
  });

  it("omits empty details so a bare rating stays a bare rating", async () => {
    const fetchMock = stubFetch();
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    await client.submitFeedback("m2", "negative", { reasons: [], comment: "  " });

    expect(bodyOf(fetchMock)).toEqual({ rating: "negative" });
  });
});

describe("submitConversationFeedback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the report to the conversation's last answer", async () => {
    const fetchMock = stubFetch(CONVERSATION);
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    const messageId = await client.submitConversationFeedback(
      "conv-1",
      "negative",
      { reasons: ["technical_issue"], comment: "It never answered." },
    );

    expect(messageId).toBe("m3");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://x.example.com/api/sdk/v1/conversations/conv-1",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://x.example.com/api/sdk/v1/messages/m3/feedback",
    );
    expect(bodyOf(fetchMock, 1)).toEqual({
      rating: "negative",
      reasons: ["technical_issue"],
      comment: "It never answered.",
    });
  });

  it("skips the lookup when the caller already knows the last message", async () => {
    const fetchMock = stubFetch();
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    const messageId = await client.submitConversationFeedback(
      "conv-1",
      "negative",
      { lastMessageId: "m9" },
    );

    expect(messageId).toBe("m9");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://x.example.com/api/sdk/v1/messages/m9/feedback",
    );
    // `lastMessageId` is routing, not payload.
    expect(bodyOf(fetchMock)).toEqual({ rating: "negative" });
  });

  it("ignores hidden answers when picking the message to report", async () => {
    const fetchMock = stubFetch({
      ...CONVERSATION,
      messages: [
        ...CONVERSATION.messages,
        {
          id: "m4",
          content: "auto-continue nudge",
          role: "assistant",
          status: "DONE",
          created_at: "2026-07-01T00:00:20Z",
          hidden: true,
        },
      ],
    });
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    expect(await client.submitConversationFeedback("conv-1", "negative")).toBe(
      "m3",
    );
    expect(fetchMock.mock.calls[1][0]).toContain("/messages/m3/feedback");
  });

  it("skips an answer that is still streaming", async () => {
    const fetchMock = stubFetch({
      ...CONVERSATION,
      messages: [
        ...CONVERSATION.messages,
        {
          id: "m4",
          content: "",
          role: "assistant",
          status: "IN_PROGRESS",
          created_at: "2026-07-01T00:00:20Z",
        },
      ],
    });
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    // The turn in flight is not something the user can judge yet, so the report
    // lands on the last answer they actually read.
    expect(await client.submitConversationFeedback("conv-1", "negative")).toBe(
      "m3",
    );
    expect(fetchMock.mock.calls[1][0]).toContain("/messages/m3/feedback");
  });

  it("explains itself when the conversation has no answer yet", async () => {
    stubFetch({ ...CONVERSATION, messages: [CONVERSATION.messages[0]] });
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    await expect(
      client.submitConversationFeedback("conv-1", "negative"),
    ).rejects.toMatchObject({
      code: "feedback_no_message",
    });
    await expect(
      client.submitConversationFeedback("conv-1", "negative"),
    ).rejects.toBeInstanceOf(AgoError);
  });
});
