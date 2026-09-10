import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/api/HttpClient";
import { AgoClient } from "../src/client/AgoClient";
import type { AgoConfig } from "../src/client/types";
import { createAgo } from "../src/auto/createAgo";

function captureRequests() {
  const requests: { body?: Record<string, unknown>; headers: Headers }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = init.body instanceof FormData
      ? Object.fromEntries(init.body.entries())
      : init.body ? JSON.parse(String(init.body)) : undefined;
    if (typeof body?.client_context === "string") {
      body.client_context = JSON.parse(body.client_context);
    }
    requests.push({ body, headers: new Headers(init.headers) });
    return new Response('data: {"message_id":"m1","thread":{"id":"t1"},"content":"OK","status":"DONE"}\n\n');
  }));
  return requests;
}

afterEach(() => vi.unstubAllGlobals());

describe.each([false, true])("SDK language (multipart: %s)", (multipart) => {
  const options = () => ({ files: multipart ? [new File(["text"], "note.txt")] : undefined });

  it.each([["fr_FR", "fr-FR"], ["de", "de"], ["pt-BR", "pt-BR"], ["ja-JP", "ja-JP"]])(
    "sends the host interface language %s as Accept-Language",
    async (language, expected) => {
      const requests = captureRequests();
      const client = new AgoClient({ baseUrl: "https://example.test", language });
      client.setContext("account", { data: { plan: "Pro" } });
      try {
        await client.sendMessage("Hello", options());
        expect(requests[0].headers.get("Accept-Language")).toBe(expected);
        const entries = requests[0].body?.client_context.entries;
        expect(entries).toEqual({ account: { data: { plan: "Pro" } } });
      } finally {
        client.destroy();
      }
    },
  );

  it("updates and clears the override while leaving another client independent", async () => {
    const requests = captureRequests();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const other = new AgoClient({ baseUrl: "https://example.test", language: "ja" });
    try {
      await client.sendMessage("default", options());
      client.updateConfig({ language: "fr" });
      await client.sendMessage("French", options());
      client.updateConfig({ language: undefined, userJwt: "token" });
      await client.sendMessage("still French", options());
      client.updateConfig({ language: "de" });
      await client.sendMessage("German", options());
      client.updateConfig({ language: null });
      await client.sendMessage("browser default", options());
      await other.sendMessage("Japanese", options());
      expect(requests.map(r => r.headers.get("Accept-Language"))).toEqual([null, "fr", "fr", "de", null, "ja"]);
      for (const request of requests) expect(request.body?.client_context).toBeUndefined();
      expect(requests[4].headers.get("Authorization")).toBe("Bearer token");
    } finally {
      client.destroy();
      other.destroy();
    }
  });
});

it.each(["", "French", "fr\r\nX-Injected: yes", "../../etc", 123, {}])(
  "rejects invalid language %j before changing client configuration",
  async (invalid) => {
    const language = invalid as AgoConfig["language"];
    const requests = captureRequests();
    expect(() => new AgoClient({ baseUrl: "https://example.test", language }))
      .toThrow(expect.objectContaining({ code: "config_invalid_language" }));
    const client = new AgoClient({ baseUrl: "https://example.test", language: "fr", userJwt: "original" });
    try {
      expect(() => client.updateConfig({ language, userJwt: "changed" }))
        .toThrow(expect.objectContaining({ code: "config_invalid_language" }));
      await client.sendMessage("unchanged");
      expect(requests[0].headers.get("Accept-Language")).toBe("fr");
      expect(requests[0].headers.get("Authorization")).toBe("Bearer original");
    } finally {
      client.destroy();
    }
  },
);

it("also sends the override on ordinary JSON requests and clears it on update", async () => {
  const fetchMock = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  const http = new HttpClient({ baseUrl: "https://example.test", language: "es" });
  await http.get("/api/sdk/v1/config");
  await http.post("/api/sdk/v1/proactive/events", { events: [] });
  http.updateConfig({ language: null });
  await http.get("/api/sdk/v1/config");
  expect(fetchMock.mock.calls.map(call => new Headers((call as unknown as [string, RequestInit])[1].headers).get("Accept-Language")))
    .toEqual(["es", "es", null]);
});

it("refreshes the request language on a continued turn after an interface language change", async () => {
  const requests = captureRequests();
  const client = new AgoClient({ baseUrl: "https://example.test", language: "fr" });
  try {
    await client.sendMessage("first");
    client.updateConfig({ language: "de" });
    await client.continueMessage("m1");
    expect(requests[1].headers.get("Accept-Language")).toBe("de");
    expect(requests[1].body?.client_context).toBeUndefined();
  } finally {
    client.destroy();
  }
});

it("preserves the explicit language through createAgo", async () => {
  const requests = captureRequests();
  const client = createAgo({ baseUrl: "https://example.test", language: "fr_FR" });
  try {
    await client.sendMessage("Hello");
    expect(requests[0].headers.get("Accept-Language")).toBe("fr-FR");
  } finally {
    client.destroy();
  }
});

it("returns translated knowledge sources when reloading the same conversation after a language change", async () => {
  const titles: Record<string, string> = { en: "Set up your domain", fr: "Configurer votre domaine" };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const language = new Headers(init.headers).get("Accept-Language")!;
    return Response.json({
      id: "c1", title: "Domain setup", messages: [{
        id: "m1", content: "Existing answer", role: "assistant", status: "DONE",
        created_at: "2026-09-10T10:00:00Z",
        sources: [{ id: "source-1", title: titles[language], url: "https://example.test/help" },
          { id: "source-2", title: "Original title without translation", url: null }],
      }],
    });
  }));
  const client = new AgoClient({ baseUrl: "https://example.test", language: "en" });
  try {
    const english = await client.getConversation("c1");
    client.updateConfig({ language: "fr" });
    const french = await client.getConversation("c1");
    expect(english.id).toBe(french.id);
    expect(english.messages?.[0].sources?.[0]).toEqual({
      id: "source-1", title: titles.en, url: "https://example.test/help",
    });
    expect(french.messages?.[0].sources?.[0]).toEqual({
      id: "source-1", title: titles.fr, url: "https://example.test/help",
    });
    expect(french.messages?.[0].sources?.[1]).toEqual({
      id: "source-2", title: "Original title without translation", url: undefined,
    });
    expect(french.messages?.[0].content).toBe("Existing answer");
  } finally {
    client.destroy();
  }
});

it.each([undefined, []])("leaves sources absent when a conversation has no citations (%j)", async (sources) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    id: "c1", title: "T", messages: [{ id: "m1", content: "Hello", role: "assistant", status: "DONE", sources }],
  })));
  const client = new AgoClient({ baseUrl: "https://example.test" });
  try {
    expect((await client.getConversation("c1")).messages?.[0].sources).toBeUndefined();
  } finally {
    client.destroy();
  }
});
