import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { attachWebMCP } from "../src/webmcp/attachWebMCP";
import type {
  ModelContextLike,
  ModelContextToolLike,
} from "../src/webmcp/types";

/** One tool as the fake registry holds it, plus the signal that removes it. */
interface FakeEntry {
  tool: ModelContextToolLike;
  signal?: AbortSignal;
}

/**
 * Stands in for `document.modelContext`, with the contract that matters here:
 * there is no unregister, a tool lives until its `signal` aborts.
 */
class FakeModelContext implements ModelContextLike {
  entries = new Map<string, FakeEntry>();
  registerCalls = 0;

  async registerTool(
    tool: ModelContextToolLike,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    this.registerCalls++;
    this.entries.set(tool.name, { tool, signal: options?.signal });
    options?.signal?.addEventListener("abort", () => {
      this.entries.delete(tool.name);
    });
  }

  names(): string[] {
    return [...this.entries.keys()].sort();
  }

  get(name: string): ModelContextToolLike {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`No tool "${name}" registered`);
    return entry.tool;
  }

  call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return Promise.resolve(this.get(name).execute(args));
  }
}

function installModelContext(mc?: FakeModelContext): FakeModelContext {
  const fake = mc ?? new FakeModelContext();
  Object.defineProperty(document, "modelContext", {
    value: fake,
    configurable: true,
    writable: true,
  });
  return fake;
}

function removeModelContext(): void {
  Reflect.deleteProperty(document, "modelContext");
}

const echo = {
  name: "echo",
  description: "Echo the input back",
  parameters: { type: "object" as const, properties: {} },
  handler: (args: Record<string, unknown>) => ({ echoed: args }),
};

describe("WebMCP bridge", () => {
  let mc: FakeModelContext;
  let client: AgoClient;

  beforeEach(() => {
    mc = installModelContext();
    client = new AgoClient({ baseUrl: "https://example.test", webmcp: true });
  });

  afterEach(() => {
    client.destroy();
    removeModelContext();
    vi.restoreAllMocks();
  });

  describe("mirroring", () => {
    it("registers a WebMCP tool for each AGO function", async () => {
      client.register(echo);
      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));

      const tool = mc.get("echo");
      expect(tool.description).toBe("Echo the input back");
      expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
    });

    it("removes the tool when the function is unregistered", async () => {
      client.register(echo);
      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));

      client.unregisterFunction("echo");
      expect(mc.names()).toEqual([]);
    });

    it("carries the annotations from the webmcp metadata", async () => {
      client.register({
        ...echo,
        webmcp: { annotations: { readOnlyHint: true } },
      });
      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));

      expect(mc.get("echo").annotations).toEqual({ readOnlyHint: true });
    });

    it("skips a function that opted out with webmcp: false", async () => {
      client.register({ ...echo, webmcp: false });
      client.register({ ...echo, name: "visible" });

      await vi.waitFor(() => expect(mc.names()).toEqual(["visible"]));
    });

    it("does not re-register a function whose shape did not change", async () => {
      client.register(echo);
      await vi.waitFor(() => expect(mc.registerCalls).toBe(1));

      // What `useAgoFunction` does on a render: same shape, new object identity
      // and a new handler closure.
      client.register({ ...echo, parameters: { type: "object", properties: {} } });

      expect(mc.registerCalls).toBe(1);
      expect(mc.names()).toEqual(["echo"]);
    });

    it("re-registers when the description or schema actually changes", async () => {
      client.register(echo);
      await vi.waitFor(() => expect(mc.registerCalls).toBe(1));

      client.register({ ...echo, description: "Now it does something else" });
      await vi.waitFor(() => expect(mc.registerCalls).toBe(2));
      expect(mc.get("echo").description).toBe("Now it does something else");
    });

    it("detaching removes every mirrored tool", async () => {
      const bare = new AgoClient({ baseUrl: "https://example.test" });
      const detach = attachWebMCP(bare);
      bare.register(echo);
      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));

      detach();
      expect(mc.names()).toEqual([]);

      // And it stops tracking: a later registration is not mirrored.
      bare.register({ ...echo, name: "later" });
      expect(mc.names()).toEqual([]);
      bare.destroy();
    });

    it("no-ops when the browser has no WebMCP", () => {
      removeModelContext();
      const bare = new AgoClient({ baseUrl: "https://example.test" });

      const detach = attachWebMCP(bare);
      bare.register(echo);

      expect(() => detach()).not.toThrow();
      bare.destroy();
    });

    it("survives a registerTool rejection and retries on the next change", async () => {
      const failing = vi
        .spyOn(mc, "registerTool")
        .mockRejectedValueOnce(new Error("invalid tool name"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      client.register(echo);
      await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
      expect(mc.names()).toEqual([]);

      client.register({ ...echo, name: "other" });
      await vi.waitFor(() => expect(mc.names()).toEqual(["echo", "other"]));
    });
  });

  describe("execution", () => {
    it("routes a call through the registry", async () => {
      client.register(echo);
      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));

      await expect(mc.call("echo", { a: 1 })).resolves.toEqual({
        echoed: { a: 1 },
      });
    });

    it("applies the result-size guard", async () => {
      client.register({
        ...echo,
        name: "big",
        maxResultBytes: 50,
        handler: () => ({ blob: "x".repeat(500) }),
      });
      await vi.waitFor(() => expect(mc.names()).toEqual(["big"]));

      const result = (await mc.call("big")) as { truncated?: boolean };
      expect(result.truncated).toBe(true);
    });

    it("reaches the current handler after a re-registration", async () => {
      client.register(echo);
      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));

      client.register({ ...echo, handler: () => "second" });

      await expect(mc.call("echo")).resolves.toBe("second");
    });
  });

  describe("events", () => {
    it("reports the call as coming from webmcp", async () => {
      const invoked = vi.fn();
      const results = vi.fn();
      client.on("function:invoke", invoked);
      client.on("function:result", results);
      client.register(echo);
      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));

      await mc.call("echo", { a: 1 });

      expect(invoked).toHaveBeenCalledTimes(1);
      expect(invoked.mock.calls[0][0]).toMatchObject({
        functionName: "echo",
        conversationId: "",
      });
      expect(results.mock.calls[0][0].result).toEqual({ echoed: { a: 1 } });
    });

    it("reports a throwing handler on function:result", async () => {
      const results = vi.fn();
      client.on("function:result", results);
      client.register({
        ...echo,
        name: "boom",
        handler: () => {
          throw new Error("nope");
        },
      });
      await vi.waitFor(() => expect(mc.names()).toEqual(["boom"]));

      await expect(mc.call("boom")).rejects.toThrow(/nope/);
      expect(results.mock.calls[0][0].error).toMatch(/nope/);
    });
  });

  describe("approval", () => {
    // The gate covers the agent loop only: a mirrored function runs at once,
    // so an app that does not want that keeps it out of the bridge instead.
    const gated = {
      ...echo,
      name: "deleteThings",
      requiresApproval: true,
      handler: () => "deleted",
    };

    it("runs a requiresApproval function without waiting", async () => {
      const awaiting = vi.fn();
      client.on("function:awaiting-approval", awaiting);
      client.register(gated);
      await vi.waitFor(() => expect(mc.names()).toEqual(["deleteThings"]));

      await expect(mc.call("deleteThings")).resolves.toBe("deleted");
      expect(awaiting).not.toHaveBeenCalled();
    });

    it("ignores an approvalPolicy for external callers", async () => {
      const policyClient = new AgoClient({
        baseUrl: "https://example.test",
        webmcp: true,
        approvalPolicy: () => true,
      });
      const awaiting = vi.fn();
      policyClient.on("function:awaiting-approval", awaiting);
      policyClient.register(echo);
      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));

      await expect(mc.call("echo")).resolves.toEqual({ echoed: {} });
      expect(awaiting).not.toHaveBeenCalled();

      policyClient.destroy();
    });

    it("webmcp: false is how a gated function is kept out of the bridge", async () => {
      client.register({ ...gated, webmcp: false });
      client.register(echo);

      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));
    });
  });

  describe("lifecycle", () => {
    it("stays off unless the config asks for it", () => {
      const bare = new AgoClient({ baseUrl: "https://example.test" });
      bare.register(echo);

      expect(mc.names()).toEqual([]);
      bare.destroy();
    });

    it("re-attaches after a StrictMode destroy/revive", async () => {
      client.register(echo);
      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));

      client.destroy();
      expect(mc.names()).toEqual([]);

      client.reviveAfterDestroy();
      client.register(echo);
      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));
    });
  });
});
