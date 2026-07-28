import { describe, it, expect, vi, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";

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
