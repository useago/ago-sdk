import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { attachWebMCP } from "../src/webmcp/attachWebMCP";
import type {
  ModelContextLike,
  ModelContextToolLike,
} from "../src/webmcp/types";

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

  call(
    name: string,
    args: Record<string, unknown> = {},
    options?: { signal?: AbortSignal }
  ): Promise<unknown> {
    return Promise.resolve(this.get(name).execute(args, options));
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
      await vi.waitFor(() => expect(mc.names()).toEqual([]));
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

      client.register({ ...echo, parameters: { type: "object", properties: {} } });

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mc.registerCalls).toBe(1);
      expect(mc.names()).toEqual(["echo"]);
    });

    it("leaves the tool alone across a useAgoFunction re-render", async () => {
      client.register(echo);
      await vi.waitFor(() => expect(mc.registerCalls).toBe(1));

      // What the hook does when `parameters` changes identity: the effect
      // cleanup unregisters, then the effect registers again.
      client.unregisterFunction("echo");
      client.register({ ...echo, parameters: { type: "object", properties: {} } });

      await new Promise((resolve) => setTimeout(resolve, 0));
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

    it("retries once after a registerTool rejection", async () => {
      vi.spyOn(mc, "registerTool").mockRejectedValueOnce(
        new Error("invalid tool name")
      );
      vi.spyOn(console, "error").mockImplementation(() => {});

      client.register(echo);

      await vi.waitFor(() => expect(mc.names()).toEqual(["echo"]));
    });

    it("stops retrying a tool that keeps being rejected", async () => {
      const failing = vi
        .spyOn(mc, "registerTool")
        .mockRejectedValue(new Error("invalid tool name"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      client.register(echo);
      await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(2));

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(failing).toHaveBeenCalledTimes(2);
      expect(mc.names()).toEqual([]);
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

  describe("navigation", () => {
    // The bridge waits for 150ms of registry quiet, capped at 4000ms.
    const goTo = (handler: () => unknown) => ({
      ...echo,
      name: "goToPage",
      webmcp: { navigates: true },
      handler,
    });
    /** Runs the pending microtasks (the bridge syncs in one) under fake timers. */
    const flush = () => vi.advanceTimersByTimeAsync(0);

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("marks the built-in navigateToPage as navigating", () => {
      client.registerNavigationFunction(() => {}, [
        { name: "home", path: "/", description: "The home page" },
      ]);

      const fn = client
        .getFunctionRegistrations()
        .find((f) => f.name === "navigateToPage");
      expect(fn?.webmcp).toEqual({ navigates: true });
    });

    it("holds the call until the destination page has registered", async () => {
      client.register(
        goTo(() => {
          // The route swap, one tick later: the departing page's function goes,
          // the destination's arrives.
          setTimeout(() => {
            client.unregisterFunction("departing");
            client.register({ ...echo, name: "arriving" });
          }, 20);
          return { success: true };
        })
      );
      client.register({ ...echo, name: "departing" });
      await flush();

      let settled = false;
      const call = mc.call("goToPage").then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe(false);
      expect(mc.names()).toEqual(["departing", "goToPage"]);

      await vi.advanceTimersByTimeAsync(170);
      await call;
      expect(mc.names()).toEqual(["arriving", "goToPage"]);
    });

    it("extends the wait while registrations keep arriving", async () => {
      client.register(
        goTo(() => {
          setTimeout(() => client.register({ ...echo, name: "first" }), 10);
          setTimeout(() => client.register({ ...echo, name: "second" }), 120);
          return { success: true };
        })
      );
      await flush();

      let settled = false;
      const call = mc.call("goToPage").then(() => {
        settled = true;
      });

      // Without the second registration this would have settled at 160ms.
      await vi.advanceTimersByTimeAsync(161);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(120);
      await call;
      expect(settled).toBe(true);
    });

    it("gives up at the first-change grace when nothing registers", async () => {
      client.register(goTo(() => ({ success: true })));
      await flush();

      let settled = false;
      const call = mc.call("goToPage").then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(599);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(2);
      await call;
      expect(settled).toBe(true);
    });

    it("hands the wait over to the settle once the transition starts", async () => {
      client.register(
        goTo(() => {
          // Late enough that the grace would have fired first.
          setTimeout(() => {
            client.unregisterFunction("departing");
            client.register({ ...echo, name: "arriving" });
          }, 550);
          return { success: true };
        })
      );
      client.register({ ...echo, name: "departing" });
      await flush();

      let settled = false;
      const call = mc.call("goToPage").then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(610);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(100);
      await call;
      expect(mc.names()).toEqual(["arriving", "goToPage"]);
    });

    it("still gives up at the readiness cap when changes never stop", async () => {
      const churn = setInterval(() => {
        client.register({ ...echo, name: `churn-${Date.now()}` });
      }, 100);
      client.register(goTo(() => ({ success: true })));
      await flush();

      let settled = false;
      const call = mc.call("goToPage").then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(3999);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(2);
      await call;
      expect(settled).toBe(true);
      clearInterval(churn);
    });

    it("does not hold a function that is not marked as navigating", async () => {
      client.register(echo);
      await flush();

      await expect(mc.call("echo", { a: 1 })).resolves.toEqual({
        echoed: { a: 1 },
      });
    });

    it("skips the wait when the handler reports it did not navigate", async () => {
      const refused = { success: false, error: "Unknown page: nope" };
      client.register(goTo(() => refused));
      await flush();

      await expect(mc.call("goToPage")).resolves.toEqual(refused);
    });

    it("stops waiting when the caller aborts the execution", async () => {
      client.register(goTo(() => ({ success: true })));
      await flush();

      const controller = new AbortController();
      let settled = false;
      const call = mc
        .call("goToPage", {}, { signal: controller.signal })
        .then(() => {
          settled = true;
        });

      await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe(false);

      controller.abort();
      await call;
      expect(settled).toBe(true);
    });

    it("stops waiting when the bridge detaches", async () => {
      const bare = new AgoClient({ baseUrl: "https://example.test" });
      const detach = attachWebMCP(bare);
      bare.register(goTo(() => ({ success: true })));
      await flush();

      let settled = false;
      const call = mc.call("goToPage").then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe(false);

      detach();
      await call;
      expect(settled).toBe(true);
      bare.destroy();
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
