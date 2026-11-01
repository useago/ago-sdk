// @vitest-environment node
// React Native has no `window`, `document` or `localStorage`, its built-in
// `fetch` has no streaming body, and some engines lack `TextDecoder`. The node
// environment gives the same blank slate; each test stubs the rest.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { AgoFetch, AgoNativeFile } from "../src/client/types";
import * as native from "../src/native";
import { toAgoFile } from "../src/native/toAgoFile";
import { createFallbackDecoder } from "../src/streaming/utf8";
import { attachmentsFromFiles } from "../src/utils/attachments";

const BASE_URL = "https://playground.api.useago.com";

const SSE =
  'data: {"message_id":"m1","conversation_id":"c1","content":"Bonjour é 👋"}\n\n' +
  'data: {"done":true}\n\n';

/** A streaming reply cut at `splitAt` bytes (inside a multi-byte char when it lands there). */
function streamingResponse(splitAt?: number): Response {
  const bytes = new TextEncoder().encode(SSE);
  const at = splitAt ?? bytes.length;
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, at));
        if (at < bytes.length) controller.enqueue(bytes.slice(at));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

/** What React Native's built-in fetch returns: no `body`, the payload via `text()`. */
function bodylessResponse(text = SSE): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: null,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

/** Stand-in for React Native's FormData: keeps parts as-is, like RN does. */
class NativeFormData {
  parts: Array<[string, unknown]> = [];
  append(key: string, value: unknown) {
    this.parts.push([key, value]);
  }
}

/** Minimal XMLHttpRequest double: records the request, answers asynchronously. */
class FakeXhr {
  static last: FakeXhr | null = null;
  static reply = { status: 200, text: "", hang: false };
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  aborted = false;
  status = 0;
  statusText = "";
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
    if (FakeXhr.reply.hang) return;
    setTimeout(() => {
      this.status = FakeXhr.reply.status;
      this.responseText = FakeXhr.reply.text;
      this.onload?.();
    }, 0);
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

function fakeXhr(status: number, text: string, opts: { hang?: boolean } = {}) {
  FakeXhr.last = null;
  FakeXhr.reply = { status, text, hang: !!opts.hang };
  return FakeXhr;
}

const photo: AgoNativeFile = {
  uri: "file:///data/user/0/app/cache/photo.jpg",
  name: "photo.jpg",
  type: "image/jpeg",
  size: 1234,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("config.fetch", () => {
  it("streams replies through the configured fetch, not the global one", async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const customFetch = vi.fn<AgoFetch>(async () => streamingResponse());
    const client = new AgoClient({ baseUrl: BASE_URL, fetch: customFetch });

    const reply = await client.sendMessage("hi");

    expect(reply.content).toBe("Bonjour é 👋");
    expect(reply.status).toBe("DONE");
    expect(customFetch).toHaveBeenCalledTimes(1);
    expect(customFetch.mock.calls[0][0]).toBe(`${BASE_URL}/api/sdk/v1/messages`);
    expect(globalFetch).not.toHaveBeenCalled();
    client.destroy();
  });

  it("is used for JSON requests too", async () => {
    const customFetch = vi.fn<AgoFetch>(
      async () =>
        new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 }),
    );
    const client = new AgoClient({ baseUrl: BASE_URL, fetch: customFetch });

    await client.getConversations();

    expect(customFetch).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it("can be swapped with updateConfig", async () => {
    const first = vi.fn<AgoFetch>(async () => streamingResponse());
    const second = vi.fn<AgoFetch>(async () => streamingResponse());
    const client = new AgoClient({ baseUrl: BASE_URL, fetch: first });

    client.updateConfig({ fetch: second });
    await client.sendMessage("hi");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    client.destroy();
  });
});

describe("replies without a streaming body", () => {
  it("reads the whole SSE payload in one piece", async () => {
    const client = new AgoClient({
      baseUrl: BASE_URL,
      fetch: async () => bodylessResponse(),
    });
    const completed = vi.fn();
    client.on("message:complete", completed);

    const reply = await client.sendMessage("hi");

    expect(reply.content).toBe("Bonjour é 👋");
    expect(completed).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it("processes a final event that lacks its trailing blank line", async () => {
    const client = new AgoClient({
      baseUrl: BASE_URL,
      fetch: async () =>
        bodylessResponse('data: {"message_id":"m1","content":"Salut"}'),
    });

    const reply = await client.sendMessage("hi");

    expect(reply.content).toBe("Salut");
    client.destroy();
  });

  it("still reports stream_no_body when there is nothing to read", async () => {
    const client = new AgoClient({
      baseUrl: BASE_URL,
      fetch: async () => bodylessResponse(""),
    });

    await expect(client.sendMessage("hi")).rejects.toMatchObject({
      code: "stream_no_body",
    });
    client.destroy();
  });
});

describe("without TextDecoder", () => {
  it("decodes a multi-byte character split across chunks", async () => {
    vi.stubGlobal("TextDecoder", undefined);
    // Cut inside the 4-byte emoji.
    const splitAt = new TextEncoder().encode(SSE).indexOf(0xf0) + 2;
    const client = new AgoClient({
      baseUrl: BASE_URL,
      fetch: async () => streamingResponse(splitAt),
    });

    const reply = await client.sendMessage("hi");

    expect(reply.content).toBe("Bonjour é 👋");
    client.destroy();
  });

  it("fallback decoder matches TextDecoder on every split point", () => {
    const text = "aé€👋z";
    const bytes = new TextEncoder().encode(text);
    for (let at = 0; at <= bytes.length; at++) {
      const decoder = createFallbackDecoder();
      const out = decoder.decode(bytes.slice(0, at)) + decoder.decode(bytes.slice(at));
      expect(out).toBe(text);
    }
  });

  it("fallback decoder replaces a stray continuation byte", () => {
    expect(createFallbackDecoder().decode(new Uint8Array([0x61, 0x80, 0x62]))).toBe(
      "a\ufffdb",
    );
  });
});

describe("anonymous id storage", () => {
  function anonIdOf(fetchMock: ReturnType<typeof vi.fn<AgoFetch>>): string {
    const init = fetchMock.mock.calls[0][1];
    return (init.headers as Record<string, string>)["X-User-Anon-Id"];
  }

  it("persists the generated id in config.storage and reuses it", async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };

    const firstFetch = vi.fn<AgoFetch>(async () => streamingResponse());
    const first = new AgoClient({ baseUrl: BASE_URL, storage, fetch: firstFetch });
    await first.sendMessage("hi");

    const secondFetch = vi.fn<AgoFetch>(async () => streamingResponse());
    const second = new AgoClient({ baseUrl: BASE_URL, storage, fetch: secondFetch });
    await second.sendMessage("hi");

    expect(data.get("ago_widget_id")).toBe(anonIdOf(firstFetch));
    expect(anonIdOf(secondFetch)).toBe(anonIdOf(firstFetch));
    first.destroy();
    second.destroy();
  });

  it("works in memory when there is no storage at all", async () => {
    const fetchMock = vi.fn<AgoFetch>(async () => streamingResponse());
    const client = new AgoClient({ baseUrl: BASE_URL, fetch: fetchMock });

    await client.sendMessage("hi");

    expect(anonIdOf(fetchMock)).toMatch(/\S+/);
    client.destroy();
  });

  it("survives a storage that throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("locked");
      },
      setItem: () => {
        throw new Error("locked");
      },
    };
    expect(() => new AgoClient({ baseUrl: BASE_URL, storage }).destroy()).not.toThrow();
  });
});

describe("URI files", () => {
  it("uploads { uri, name, type } as-is through XMLHttpRequest", async () => {
    vi.stubGlobal("FormData", NativeFormData);
    vi.stubGlobal("XMLHttpRequest", fakeXhr(200, SSE));
    const customFetch = vi.fn<AgoFetch>();
    const client = new AgoClient({ baseUrl: BASE_URL, widgetId: "v1", fetch: customFetch });

    const reply = await client.sendMessage("Voici la photo", { files: [photo] });

    // No fetch can upload URI parts (expo/fetch rejects them), so XHR does.
    expect(customFetch).not.toHaveBeenCalled();
    const xhr = FakeXhr.last!;
    expect(xhr.url).toBe(`${BASE_URL}/api/sdk/v1/messages`);
    expect(xhr.headers["X-User-Anon-Id"]).toBe("v1");
    expect((xhr.body as NativeFormData).parts).toContainEqual(["files", photo]);
    expect(reply.content).toBe("Bonjour é 👋");
    client.destroy();
  });

  it("surfaces an HTTP error from the XHR upload", async () => {
    vi.stubGlobal("FormData", NativeFormData);
    vi.stubGlobal("XMLHttpRequest", fakeXhr(403, '{"error":"forbidden"}'));
    const client = new AgoClient({ baseUrl: BASE_URL });

    await expect(client.sendMessage("hi", { files: [photo] })).rejects.toMatchObject({
      statusCode: 403,
    });
    client.destroy();
  });

  it("aborts the XHR upload when the turn is stopped", async () => {
    vi.stubGlobal("FormData", NativeFormData);
    vi.stubGlobal("XMLHttpRequest", fakeXhr(200, SSE, { hang: true }));
    const client = new AgoClient({ baseUrl: BASE_URL });

    const pending = client.sendMessage("hi", { files: [photo] });
    await new Promise((r) => setTimeout(r, 0));
    await client.stop();

    await expect(pending).resolves.toMatchObject({ status: "CANCELED" });
    expect(FakeXhr.last!.aborted).toBe(true);
    client.destroy();
  });

  it("keeps config.fetch for browser files", async () => {
    const customFetch = vi.fn<AgoFetch>(async () => streamingResponse());
    const client = new AgoClient({ baseUrl: BASE_URL, fetch: customFetch });

    await client.sendMessage("hi", {
      files: [new File(["x"], "a.txt", { type: "text/plain" })],
    });

    expect(customFetch).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it("transcribes a recording given by URI", async () => {
    vi.stubGlobal("FormData", NativeFormData);
    vi.stubGlobal("XMLHttpRequest", fakeXhr(200, JSON.stringify({ text: "Bonjour" })));
    const recording: AgoNativeFile = {
      uri: "file:///cache/recording.m4a",
      name: "recording.m4a",
      type: "audio/m4a",
    };
    const client = new AgoClient({ baseUrl: BASE_URL, fetch: vi.fn<AgoFetch>() });

    await expect(client.transcribeAudio(recording)).resolves.toEqual({ text: "Bonjour" });

    expect((FakeXhr.last!.body as NativeFormData).parts).toEqual([["file", recording]]);
    client.destroy();
  });

  it("previews a picked image from its own URI", () => {
    expect(attachmentsFromFiles([photo])).toEqual([
      {
        id: "local-0-photo.jpg",
        name: "photo.jpg",
        contentType: "image/jpeg",
        fileSize: 1234,
        url: photo.uri,
        isSafeImage: true,
      },
    ]);
  });
});

describe("navigation without a URL bar", () => {
  const ROUTES = [
    { name: "orders", path: "/orders", description: "Order list" },
    { name: "order", path: "/orders/:id", description: "One order" },
  ];

  it("reports the current page from getCurrentPath", () => {
    let pathname = "/orders/42";
    const client = new AgoClient({ baseUrl: BASE_URL });
    client.registerNavigationFunction(vi.fn(), ROUTES, {
      getCurrentPath: () => pathname,
    });

    expect(client.getContextSnapshot()?.entries["current-page"].data).toEqual({
      path: "/orders/42",
      page: "order",
    });

    pathname = "/orders";
    expect(client.getContextSnapshot()?.entries["current-page"].data).toEqual({
      path: "/orders",
      page: "orders",
    });
    client.destroy();
  });

  it("reports nothing without window or getCurrentPath", () => {
    const client = new AgoClient({ baseUrl: BASE_URL });
    client.registerNavigationFunction(vi.fn(), ROUTES);

    expect(client.getContextSnapshot()?.entries["current-page"]).toBeUndefined();
    client.destroy();
  });
});

describe("@useago/sdk/native", () => {
  it("exposes the provider and hooks without DOM components", () => {
    expect(native.AgoProvider).toBeTypeOf("function");
    expect(native.useChat).toBeTypeOf("function");
    expect(native.useAgoNavigation).toBeTypeOf("function");
    expect(native).not.toHaveProperty("ChatWidget");
    expect(native).not.toHaveProperty("Markdown");
  });

  it("toAgoFile maps document and image picker assets", () => {
    expect(
      toAgoFile({ uri: "file:///a/report.pdf", name: "report.pdf", mimeType: "application/pdf", size: 10 }),
    ).toEqual({ uri: "file:///a/report.pdf", name: "report.pdf", type: "application/pdf", size: 10 });
    expect(
      toAgoFile({ uri: "file:///a/IMG_1.jpg", fileName: null, mimeType: "image/jpeg", fileSize: 20 }),
    ).toEqual({ uri: "file:///a/IMG_1.jpg", name: "IMG_1.jpg", type: "image/jpeg", size: 20 });
    expect(toAgoFile({ uri: "content://x/42" })).toEqual({
      uri: "content://x/42",
      name: "42",
      type: "application/octet-stream",
    });
  });
});
