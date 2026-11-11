import { vi } from "vitest";

/** One open streaming request the test feeds frame by frame. */
export interface FakeStream {
  url: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
  push(frame: Record<string, unknown>): void;
  end(): void;
}

export interface FakeCall {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

export interface FakeServer {
  fetch: ReturnType<typeof vi.fn>;
  streams: FakeStream[];
  calls: FakeCall[];
  /** Answer of `POST /tool-calls/{id}/submit`. */
  onSubmit: (toolCallId: string, body: Record<string, unknown>) => unknown;
  /** Answer of `GET /conversations/{id}`, in the API's snake_case shape. */
  onConversation: (conversationId: string) => unknown;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A backend whose message streams stay open until the test ends them, so
 * several answers can be interleaved. Aborting a request errors its body, as
 * fetch does.
 */
export function createFakeServer(): FakeServer {
  const server: FakeServer = {
    streams: [],
    calls: [],
    onSubmit: () => ({ status: "completed" }),
    onConversation: (id) => ({ id, title: "", messages: [] }),
    fetch: vi.fn(),
  };
  server.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    server.calls.push({ url: u, method: init?.method ?? "GET", body });
    if (u.endsWith("/stop")) return json({ status: "stopping", message_status: "IN_PROGRESS" });
    const submit = u.match(/\/tool-calls\/([^/]+)\/submit$/);
    if (submit) return json(server.onSubmit(submit[1], body ?? {}));
    const conversation = u.match(/\/conversations\/([^/?]+)$/);
    if (conversation) return json(server.onConversation(conversation[1]));
    if (u.endsWith("/messages") || u.endsWith("/continue")) {
      const encoder = new TextEncoder();
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const signal = init?.signal ?? undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          signal?.addEventListener("abort", () => {
            try {
              c.error(new DOMException("The operation was aborted.", "AbortError"));
            } catch {
              // already closed
            }
          });
        },
      });
      server.streams.push({
        url: u,
        body: body ?? {},
        signal,
        push: (frame) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)),
        end: () => controller.close(),
      });
      return new Response(stream, { status: 200 });
    }
    return json({ ok: true });
  });
  return server;
}

/** Let pending stream reads and promise chains run. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}
