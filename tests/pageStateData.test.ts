import { describe, it, expect, vi, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { FunctionRegistry } from "../src/functions/FunctionRegistry";
import type { AgoStateControl } from "../src/functions/types";

// The synthesized function's handler isn't public API, so reach the registry
// the same way the SSE loop does internally.
function execute(client: AgoClient, name: string, args: Record<string, unknown>) {
  const registry = (client as unknown as { functionRegistry: FunctionRegistry })
    .functionRegistry;
  return registry.execute(name, args);
}

function schemaOf(client: AgoClient, name: string) {
  return client.getRegisteredFunctions().find((s) => s.name === name);
}

/**
 * A page whose rows only catch up with the filter after `latencyMs`, the way a
 * real query does. `set()` returns immediately; `rows` lag behind.
 */
function fakePage(latencyMs: number) {
  const page = {
    rows: ["old-row"] as unknown,
    loading: false,
    setCalls: 0,
    control: null as unknown as AgoStateControl,
  };
  page.control = {
    name: "query",
    description: "Search text",
    schema: { type: "string" },
    get: () => "",
    set: (value) => {
      page.setCalls++;
      page.loading = true;
      setTimeout(() => {
        page.rows = [`row-for-${String(value)}`];
        page.loading = false;
      }, latencyMs);
    },
  };
  return page;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("registerPageStateFunction without a data source", () => {
  it("returns exactly { success, applied } — unchanged from before", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction([
      {
        name: "statusFilter",
        description: "Filter by status",
        schema: { type: "string" },
        set: () => {},
      },
    ]);

    const result = await execute(client, "setPageState", {
      statusFilter: "pending",
    });

    expect(Object.keys(result as object).sort()).toEqual(["applied", "success"]);
    expect(result).toEqual({ success: true, applied: { statusFilter: "pending" } });
  });

  it("registers no readPageData companion and says nothing about data", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction([
      {
        name: "statusFilter",
        description: "Filter by status",
        schema: { type: "string" },
        set: () => {},
      },
    ]);

    expect(client.getRegisteredFunctions().map((f) => f.name)).toEqual([
      "setPageState",
    ]);
    expect(schemaOf(client, "setPageState")!.description).not.toContain(
      "Returns the resulting page data"
    );
  });
});

describe("registerPageStateFunction with a data source", () => {
  it("waits for isLoading to go false before reading the snapshot", async () => {
    vi.useFakeTimers();
    const page = fakePage(300);
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction([page.control], {
      data: {
        description: "The rows matching the current filters.",
        get: () => page.rows,
        isLoading: () => page.loading,
      },
    });

    const pending = execute(client, "setPageState", { query: "dupont" });
    // The rows are still the previous search's at this point.
    expect(page.rows).toEqual(["old-row"]);

    await vi.advanceTimersByTimeAsync(1_000);
    const result = (await pending) as { data: unknown };

    // Reading without waiting would hand back ["old-row"], which is worse than
    // returning nothing: the agent would report the previous search's results.
    expect(result.data).toEqual(["row-for-dupont"]);
  });

  it("returns whatever is there once settleTimeoutMs elapses", async () => {
    vi.useFakeTimers();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      {
        settleTimeoutMs: 500,
        data: {
          description: "The rows.",
          get: () => ["stuck-row"],
          // Never settles — a page that keeps polling, or a buggy flag.
          isLoading: () => true,
        },
      }
    );

    const pending = execute(client, "setPageState", { query: "x" });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await pending).toEqual({
      success: true,
      applied: { query: "x" },
      data: ["stuck-row"],
    });
  });

  it("applies only the controls actually passed, ignoring undefined", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const sortSet = vi.fn();
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
        {
          name: "sort",
          description: "Sort order",
          schema: { type: "string" },
          set: sortSet,
        },
      ],
      { data: { description: "The rows.", get: () => ["a"] } }
    );

    const result = (await execute(client, "setPageState", {
      query: "dupont",
      sort: undefined,
    })) as { applied: Record<string, unknown> };

    expect(result.applied).toEqual({ query: "dupont" });
    expect(sortSet).not.toHaveBeenCalled();
  });

  it("announces in the description what it returns", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      {
        data: {
          description: "The users matching the current filters.",
          get: () => [],
        },
      }
    );

    expect(schemaOf(client, "setPageState")!.description).toContain(
      "Returns the resulting page data once it has loaded: The users matching the current filters."
    );
  });

  it("keeps the snapshot out of the page-state dynamic context", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          get: () => "dupont",
          set: () => {},
        },
      ],
      { data: { description: "The rows.", get: () => ["row-a", "row-b"] } }
    );

    const entry = client.getContextSnapshot()?.entries["page-state:setPageState"];
    // Only control values ride along on every message; the rows do not.
    expect(entry?.data).toEqual({ query: "dupont" });
  });

  it("re-reads get/isLoading on every tick, so a later render wins", async () => {
    vi.useFakeTimers();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    // Stands in for a ref that a re-render swaps out mid-wait.
    let source = { get: () => ["stale"], isLoading: () => true };
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      {
        data: {
          description: "The rows.",
          get: () => source.get(),
          isLoading: () => source.isLoading(),
        },
      }
    );

    const pending = execute(client, "setPageState", { query: "x" });
    await vi.advanceTimersByTimeAsync(200);
    source = { get: () => ["fresh"], isLoading: () => false };
    await vi.advanceTimersByTimeAsync(1_000);

    expect((await pending) as { data: unknown }).toMatchObject({
      data: ["fresh"],
    });
  });

  it("warns once when the client is in placeholder mode", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new AgoClient({
      baseUrl: "https://example.test",
      clientFunctionsMode: "placeholder",
      debug: true,
    });
    const register = () =>
      client.registerPageStateFunction(
        [
          {
            name: "query",
            description: "Search text",
            schema: { type: "string" },
            set: () => {},
          },
        ],
        { data: { description: "The rows.", get: () => [] } }
      );

    register();
    register();

    const hits = warn.mock.calls.filter((call) =>
      String(call.join(" ")).includes("clientFunctionsMode")
    );
    expect(hits).toHaveLength(1);
  });
});

describe("page data truncation", () => {
  const bigRows = Array.from({ length: 400 }, (_, i) => ({
    id: i,
    name: `user-${i}`,
    bio: "x".repeat(80),
  }));

  it("trims the rows but never success or applied", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      {
        data: {
          description: "The rows.",
          get: () => bigRows,
          maxResultBytes: 4_000,
        },
      }
    );

    const result = (await execute(client, "setPageState", {
      query: "dupont",
    })) as {
      success: boolean;
      applied: Record<string, unknown>;
      data: {
        truncation: {
          truncated: boolean;
          returnedItems: number;
          totalItems: number;
          hint: string;
        };
        items: unknown[];
      };
    };

    // The confirmation that the filter was applied always survives.
    expect(result.success).toBe(true);
    expect(result.applied).toEqual({ query: "dupont" });

    expect(result.data.truncation.truncated).toBe(true);
    expect(result.data.truncation.totalItems).toBe(400);
    expect(result.data.truncation.returnedItems).toBeGreaterThan(0);
    expect(result.data.truncation.returnedItems).toBeLessThan(400);
    // Whole rows, not a string cut mid-object.
    expect(result.data.items).toHaveLength(result.data.truncation.returnedItems);
    expect(result.data.items[0]).toEqual(bigRows[0]);
    expect(result.data.truncation.hint).toContain("narrow the filters");
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(
      4_000
    );
  });

  it("trims the sole array of a wrapper object, keeping its siblings", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      {
        data: {
          description: "The rows.",
          get: () => ({ totalResults: 400, users: bigRows }),
          maxResultBytes: 4_000,
        },
      }
    );

    const result = (await execute(client, "setPageState", { query: "d" })) as {
      data: {
        totalResults: number;
        users: unknown[];
        truncation: {
          truncated: boolean;
          returnedItems: number;
          totalItems: number;
        };
      };
    };

    expect(result.data.totalResults).toBe(400);
    expect(result.data.truncation.truncated).toBe(true);
    expect(result.data.truncation.totalItems).toBe(400);
    expect(result.data.users).toHaveLength(result.data.truncation.returnedItems);
    expect(result.data.users[0]).toEqual(bigRows[0]);
  });

  it("never overwrites a real field of the snapshot with truncation metadata", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      {
        data: {
          description: "The rows.",
          // The page's own paging counts share names with the metadata.
          get: () => ({ totalItems: 4820, truncated: false, rows: bigRows }),
          maxResultBytes: 4_000,
        },
      }
    );

    const result = (await execute(client, "setPageState", { query: "d" })) as {
      data: {
        totalItems: number;
        truncated: boolean;
        rows: unknown[];
        truncation: { returnedItems: number; totalItems: number };
      };
    };

    // The page says 4820 results exist server-side. Reporting 400 (the rows it
    // happened to load) would make the agent tell the user the wrong count.
    expect(result.data.totalItems).toBe(4820);
    expect(result.data.truncated).toBe(false);
    expect(result.data.truncation.totalItems).toBe(400);
    expect(result.data.rows).toHaveLength(result.data.truncation.returnedItems);
  });

  it("falls back to a preview when the siblings alone blow the budget", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      {
        data: {
          description: "The rows.",
          // Trimming `users` to zero still leaves `facets` far over budget.
          get: () => ({ facets: "z".repeat(20_000), users: bigRows }),
          maxResultBytes: 4_000,
        },
      }
    );

    const result = (await execute(client, "setPageState", { query: "d" })) as {
      success: boolean;
      applied: Record<string, unknown>;
      data: { truncated: boolean };
    };

    // The whole point: the agent still learns the filter was applied.
    expect(result.success).toBe(true);
    expect(result.applied).toEqual({ query: "d" });
    expect(result.data.truncated).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(
      4_000
    );
  });

  it("falls back to a preview when the snapshot is not a list", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      {
        data: {
          description: "A blob.",
          get: () => ({ blob: "y".repeat(5_000) }),
          maxResultBytes: 1_000,
        },
      }
    );

    const result = (await execute(client, "setPageState", { query: "d" })) as {
      success: boolean;
      data: { truncated: boolean; preview: string };
    };

    expect(result.success).toBe(true);
    expect(result.data.truncated).toBe(true);
    expect(typeof result.data.preview).toBe("string");
    // The preview must be sized against the budget, or the registry's own
    // guard fires and takes `success`/`applied` down with it.
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(
      1_000
    );
  });

  it("leaves a snapshot under the ceiling untouched", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const rows = [{ id: 1, name: "dupont" }];
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      { data: { description: "The rows.", get: () => rows } }
    );

    expect(await execute(client, "setPageState", { query: "dupont" })).toEqual({
      success: true,
      applied: { query: "dupont" },
      data: rows,
    });
  });
});

describe("readPageData companion", () => {
  it("returns the snapshot without touching any control", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const set = vi.fn();
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set,
        },
      ],
      { data: { description: "The rows.", get: () => ["row-a"] } }
    );

    const schema = schemaOf(client, "readPageData");
    expect(schema).toBeDefined();
    expect(schema!.parameters.properties).toEqual({});
    expect(schema!.description).toContain("without changing anything");

    expect(await execute(client, "readPageData", {})).toEqual({
      data: ["row-a"],
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("derives its name from a custom functionName", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      {
        functionName: "setListState",
        data: { description: "The rows.", get: () => [] },
      }
    );

    expect(client.getRegisteredFunctions().map((f) => f.name).sort()).toEqual([
      "readSetListStateData",
      "setListState",
    ]);
  });

  it("leaves a host function of the same name alone", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const hostHandler = vi.fn(async () => "host");
    client.registerFunction("readPageData", hostHandler, {
      description: "The host app's own function",
      parameters: { type: "object", properties: {} },
    });

    // No data source, so this registration never creates a companion.
    client.registerPageStateFunction([
      {
        name: "query",
        description: "Search text",
        schema: { type: "string" },
        set: () => {},
      },
    ]);
    client.unregisterPageStateFunction();

    expect(client.getRegisteredFunctions().map((f) => f.name)).toEqual([
      "readPageData",
    ]);
  });

  it("drops the companion when the registration that created it is disposed", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const control: AgoStateControl = {
      name: "query",
      description: "Search text",
      schema: { type: "string" },
      set: () => {},
    };

    const dispose = client.registerPageStateFunction([control], {
      data: { description: "Page A rows.", get: () => ["page-a-row"] },
    });
    // A vanilla/Vue app navigating to a page with no data source. Tear the old
    // registration down first, then register the new one: the companion goes
    // with the registration that created it, so it can't answer with page A.
    dispose();
    client.registerPageStateFunction([control]);

    expect(client.getRegisteredFunctions().map((f) => f.name)).toEqual([
      "setPageState",
    ]);
  });

  it("layers rather than replaces when re-registered without disposing first", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const control: AgoStateControl = {
      name: "query",
      description: "Search text",
      schema: { type: "string" },
      set: () => {},
    };

    client.registerPageStateFunction([control], {
      data: { description: "Page A rows.", get: () => ["page-a-row"] },
    });
    client.registerPageStateFunction([control]);

    // Page A's registration was never disposed, so it is still live and keeps
    // its companion. Removing it by name here would be indistinguishable from
    // a second owner (a modal, a side panel) mounting alongside page A, and
    // would silently delete that owner's tool. Callers that mean "replace"
    // dispose first, as the test above does and as the React hooks do.
    expect(client.getRegisteredFunctions().map((f) => f.name).sort()).toEqual([
      "readPageData",
      "setPageState",
    ]);
  });

  it("is unregistered along with the page-state function", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [
        {
          name: "query",
          description: "Search text",
          schema: { type: "string" },
          set: () => {},
        },
      ],
      { data: { description: "The rows.", get: () => [] } }
    );
    expect(client.getRegisteredFunctions()).toHaveLength(2);

    client.unregisterPageStateFunction();

    expect(client.getRegisteredFunctions()).toHaveLength(0);
    expect(client.getContextSnapshot()?.entries["page-state:setPageState"]).toBeUndefined();
  });
});
