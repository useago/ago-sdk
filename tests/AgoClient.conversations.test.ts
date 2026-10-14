import { describe, it, expect, vi, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { BackgroundAgentRunState } from "../src/index";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Captures the URL each fetch is called with, so we can assert query params.
function stubFetchJson(body: unknown) {
  const fetchMock = vi.fn(async () => jsonResponse(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const LIST = {
  object: "list",
  data: [
    {
      object: "conversation",
      id: "c1",
      title: "First",
      created_at: "2026-07-01T00:00:00Z",
      last_message_at: "2026-07-20T10:00:00Z",
    },
    {
      object: "conversation",
      id: "c2",
      title: "",
      created_at: "2026-07-02T00:00:00Z",
      last_message_at: null,
    },
  ],
  has_more: true,
  total: 42,
};

describe("getConversations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the { data, has_more, total } envelope into a PaginatedResult", async () => {
    stubFetchJson(LIST);
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    const result = await client.getConversations();

    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(42);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toEqual({
      id: "c1",
      title: "First",
      lastMessageDate: new Date("2026-07-20T10:00:00Z"),
    });
    // Empty title stays "", and a null last_message_at falls back to created_at.
    expect(result.data[1].title).toBe("");
    expect(result.data[1].lastMessageDate).toEqual(
      new Date("2026-07-02T00:00:00Z")
    );
  });

  it("sends page and page_size in the query when given", async () => {
    const fetchMock = stubFetchJson({ data: [], has_more: false, total: 0 });
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    await client.getConversations({ page: 2, pageSize: 100 });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/sdk/v1/conversations?");
    expect(url).toContain("page=2");
    expect(url).toContain("page_size=100");
  });

  it("omits the query string when no options are given", async () => {
    const fetchMock = stubFetchJson({ data: [], has_more: false, total: 0 });
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    await client.getConversations();

    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /\/api\/sdk\/v1\/conversations$/
    );
  });

  it("tolerates a missing data array and defaults total to the page length", async () => {
    stubFetchJson({});
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    const result = await client.getConversations();

    expect(result.data).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.total).toBe(0);
  });
});

describe("getConversation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["getConversation", "getMessages"] as const)(
    "%s preserves background run state independently from message delivery status",
    async (method) => {
      const checklist = [
        { name: "Refund order", status: "not_completed" as const, reason: "API unavailable" },
      ];
      stubFetchJson({
        id: "c1",
        title: "Refunds",
        messages: [{
          id: "m1", content: "Refund could not be processed", role: "assistant",
          status: "DONE", created_at: "2026-07-20T10:00:00Z",
          background_agent: {
            run_id: "r1", execution_status: "done", outcome: "incomplete",
            checklist, completion_notice: "Review the remaining work.",
          },
        }],
      });
      const client = new AgoClient({ baseUrl: "https://x.example.com" });
      const messages = method === "getMessages"
        ? await client.getMessages("c1")
        : (await client.getConversation("c1")).messages!;
      const expected: BackgroundAgentRunState = {
        runId: "r1", executionStatus: "done", outcome: "incomplete", checklist,
        completionNotice: "Review the remaining work.",
      };
      expect(messages[0].backgroundAgent).toEqual(expected);
      expect(messages[0].status).toBe("DONE");
    },
  );

  it("keeps absent or null run state undefined and preserves unknown historical outcomes", async () => {
    const message = {
      content: "Report", role: "assistant", status: "DONE", created_at: "2026-07-20T10:00:00Z",
    };
    stubFetchJson({
      id: "c1", title: "History",
      messages: [
        { ...message, id: "m1" },
        { ...message, id: "m2", background_agent: null },
        { ...message, id: "m3", background_agent: {
          run_id: "r1", execution_status: "done", outcome: null,
          checklist: null, completion_notice: null,
        } },
        { ...message, id: "m4", status: "IN_PROGRESS", background_agent: {
          run_id: "r2", execution_status: "running", outcome: null,
          checklist: [{ name: "Review", status: "in_progress", reason: null }],
          completion_notice: null,
        } },
      ],
    });
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    const { messages } = await client.getConversation("c1");
    expect(messages?.[0].backgroundAgent).toBeUndefined();
    expect(messages?.[1].backgroundAgent).toBeUndefined();
    expect(messages?.[2].backgroundAgent).toEqual({
      runId: "r1", executionStatus: "done", outcome: null,
      checklist: null, completionNotice: null,
    });
    expect(messages?.[3].backgroundAgent).toEqual({
      runId: "r2", executionStatus: "running", outcome: null,
      checklist: [{ name: "Review", status: "in_progress", reason: null }],
      completionNotice: null,
    });
  });

  it("maps persisted follow_up_replies onto followUpReplies so a reloaded thread re-renders the pills", async () => {
    stubFetchJson({
      id: "c1",
      title: "T",
      messages: [
        { id: "m1", content: "Hi", role: "user", status: "DONE", created_at: "2026-07-20T10:00:00Z" },
        {
          id: "m2",
          content: "Here you go",
          role: "assistant",
          status: "DONE",
          created_at: "2026-07-20T10:00:01Z",
          follow_up_replies: ["Track my order", "Add a user"],
        },
      ],
    });
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    const conv = await client.getConversation("c1");

    expect(conv.messages?.[1].followUpReplies).toEqual(["Track my order", "Add a user"]);
    // A message with no suggestions stays undefined (nothing to render).
    expect(conv.messages?.[0].followUpReplies).toBeUndefined();
  });

  it("leaves followUpReplies undefined when the field is absent or empty", async () => {
    stubFetchJson({
      id: "c1",
      title: "T",
      messages: [
        { id: "m1", content: "x", role: "assistant", status: "DONE", created_at: "2026-07-20T10:00:00Z" },
        {
          id: "m2",
          content: "y",
          role: "assistant",
          status: "DONE",
          created_at: "2026-07-20T10:00:01Z",
          follow_up_replies: [],
        },
      ],
    });
    const client = new AgoClient({ baseUrl: "https://x.example.com" });

    const conv = await client.getConversation("c1");

    expect(conv.messages?.[0].followUpReplies).toBeUndefined();
    expect(conv.messages?.[1].followUpReplies).toBeUndefined();
  });
});
