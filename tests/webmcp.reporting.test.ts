import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type {
  ModelContextLike,
  ModelContextToolLike,
} from "../src/webmcp/types";

/** Minimal stand-in for `document.modelContext`: enough to call a mirrored tool. */
class FakeModelContext implements ModelContextLike {
  tools = new Map<string, ModelContextToolLike>();

  async registerTool(
    tool: ModelContextToolLike,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener("abort", () => {
      this.tools.delete(tool.name);
    });
  }

  call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`No tool "${name}" registered`);
    return Promise.resolve(tool.execute(args));
  }
}

const CALLS_PATH = "/api/sdk/v1/client-function-calls";

interface Reported {
  url: string;
  body: Record<string, unknown>;
  keepalive?: boolean;
}

const echo = {
  name: "echo",
  description: "Echo the input back",
  parameters: {
    type: "object" as const,
    properties: { word: { type: "string" } },
  },
  handler: (args: Record<string, unknown>) => ({ echoed: args, success: true }),
};

describe("WebMCP call reporting", () => {
  let mc: FakeModelContext;
  let client: AgoClient;
  let reports: Reported[];

  beforeEach(() => {
    mc = new FakeModelContext();
    Object.defineProperty(document, "modelContext", {
      value: mc,
      configurable: true,
      writable: true,
    });

    reports = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        if (href.includes(CALLS_PATH)) {
          reports.push({
            url: href,
            body: JSON.parse(String(init?.body)),
            keepalive: init?.keepalive,
          });
        }
        return new Response(JSON.stringify({ recorded: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    client = new AgoClient({
      baseUrl: "https://example.test",
      agent: "support",
      webmcp: true,
    });
  });

  afterEach(() => {
    client.destroy();
    Reflect.deleteProperty(document, "modelContext");
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("reports one call, with the function's own declaration", async () => {
    client.register(echo);
    await vi.waitFor(() => expect(mc.tools.has("echo")).toBe(true));

    await mc.call("echo", { word: "hi" });
    await vi.waitFor(() => expect(reports).toHaveLength(1));

    const { body } = reports[0];
    expect(body.function_name).toBe("echo");
    expect(body.client_functions).toEqual([
      {
        name: "echo",
        description: "Echo the input back",
        parameters: { type: "object", properties: { word: { type: "string" } } },
      },
    ]);
    expect(body.arguments).toEqual({ word: "hi" });
    expect(body.error).toBeNull();
    expect(typeof body.duration_ms).toBe("number");
  });

  it("never attributes the call to the configured agent", async () => {
    client.register(echo);
    await vi.waitFor(() => expect(mc.tools.has("echo")).toBe(true));

    await mc.call("echo");
    await vi.waitFor(() => expect(reports).toHaveLength(1));

    expect(reports[0].body).not.toHaveProperty("agent");
  });

  it("reports the result the handler returned, whole", async () => {
    client.register({
      ...echo,
      handler: () => ({ success: false, detail: "out of stock", rows: [1, 2] }),
    });
    await vi.waitFor(() => expect(mc.tools.has("echo")).toBe(true));

    await mc.call("echo");
    await vi.waitFor(() => expect(reports).toHaveLength(1));

    expect(reports[0].body.result).toEqual({
      success: false,
      detail: "out of stock",
      rows: [1, 2],
    });
  });

  it("reports a result that is not an object", async () => {
    client.register({ ...echo, handler: () => ["a", "b"] });
    await vi.waitFor(() => expect(mc.tools.has("echo")).toBe(true));

    await mc.call("echo");
    await vi.waitFor(() => expect(reports).toHaveLength(1));

    expect(reports[0].body.result).toEqual(["a", "b"]);
  });

  it("declares a function once, then stops resending it", async () => {
    client.register(echo);
    await vi.waitFor(() => expect(mc.tools.has("echo")).toBe(true));

    await mc.call("echo");
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    // The name is marked declared in the POST's resolve handler, so let the
    // first response settle before the second call.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await mc.call("echo");
    await vi.waitFor(() => expect(reports).toHaveLength(2));

    expect(reports[0].body.client_functions).toHaveLength(1);
    expect(reports[1].body).not.toHaveProperty("client_functions");
  });

  it("keeps the declaration on the next call when the report failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    client.register(echo);
    await vi.waitFor(() => expect(mc.tools.has("echo")).toBe(true));
    await mc.call("echo");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = String(url);
        if (href.includes(CALLS_PATH)) {
          reports.push({ url: href, body: JSON.parse(String(init?.body)) });
        }
        return new Response(JSON.stringify({ recorded: true }), { status: 200 });
      })
    );

    await mc.call("echo");
    await vi.waitFor(() => expect(reports).toHaveLength(1));

    expect(reports[0].body.client_functions).toHaveLength(1);
  });

  it("uses keepalive only for a function that navigates", async () => {
    client.register(echo);
    client.register({
      ...echo,
      name: "goTo",
      webmcp: { navigates: true },
      handler: () => ({ ok: true }),
    });
    await vi.waitFor(() => expect(mc.tools.has("goTo")).toBe(true));

    await mc.call("echo");
    await mc.call("goTo");
    await vi.waitFor(() => expect(reports).toHaveLength(2));

    expect(reports[0].keepalive).toBeFalsy();
    expect(reports[1].keepalive).toBe(true);
  });

  it("reports the message and no result when the handler throws", async () => {
    client.register({
      ...echo,
      handler: () => {
        throw new Error("boom");
      },
    });
    await vi.waitFor(() => expect(mc.tools.has("echo")).toBe(true));

    await expect(mc.call("echo")).rejects.toThrow();
    await vi.waitFor(() => expect(reports).toHaveLength(1));

    expect(reports[0].body.error).toContain("boom");
    expect(reports[0].body.result).toBeNull();
  });

  it("reuses one tab id across calls in the same tab", async () => {
    client.register(echo);
    await vi.waitFor(() => expect(mc.tools.has("echo")).toBe(true));

    await mc.call("echo");
    await mc.call("echo");
    await vi.waitFor(() => expect(reports).toHaveLength(2));

    expect(reports[0].body.tab_id).toBeTruthy();
    expect(reports[1].body.tab_id).toBe(reports[0].body.tab_id);
  });

  it("never fails the call when reporting fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    client.register(echo);
    await vi.waitFor(() => expect(mc.tools.has("echo")).toBe(true));

    await expect(mc.call("echo", { word: "hi" })).resolves.toEqual({
      echoed: { word: "hi" },
      success: true,
    });
  });

  it("does not report a call the AGO agent made", async () => {
    client.register(echo);
    await vi.waitFor(() => expect(mc.tools.has("echo")).toBe(true));

    await client.executeClientFunction("echo", { word: "hi" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reports).toHaveLength(0);
  });
});
