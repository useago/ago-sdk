import { describe, it, expect, vi, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { FunctionRegistry } from "../src/functions/FunctionRegistry";
import type { AgoPageStateResult, AgoStateControl } from "../src/functions/types";

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
  it("returns exactly the result without data — unchanged from before", async () => {
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

    expect(Object.keys(result as object).sort()).toEqual(["applied", "success", "unchanged"]);
    expect(result).toEqual({ success: true, applied: ["statusFilter"], unchanged: [] });
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
    const result = (await pending) as Required<AgoPageStateResult>;

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
      applied: ["query"],
      unchanged: [],
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
    })) as AgoPageStateResult;

    expect(result.applied).toEqual(["query"]);
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

    expect((await pending) as Required<AgoPageStateResult>).toMatchObject({
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

  it("trims the rows but never success or applied or unchanged", async () => {
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
    })) as Required<
      AgoPageStateResult<{
        truncation: {
          truncated: boolean;
          returnedItems: number;
          totalItems: number;
          hint: string;
        };
        items: unknown[];
      }>
    >;

    // The confirmation that the filter was applied always survives.
    expect(result.success).toBe(true);
    expect(result.applied).toEqual(["query"]);
    expect(result.unchanged).toEqual([]);

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

    const result = (await execute(client, "setPageState", { query: "d" })) as Required<
      AgoPageStateResult<{
        totalResults: number;
        users: unknown[];
        truncation: {
          truncated: boolean;
          returnedItems: number;
          totalItems: number;
        };
      }>
    >;

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

    const result = (await execute(client, "setPageState", { query: "d" })) as Required<
      AgoPageStateResult<{
        totalItems: number;
        truncated: boolean;
        rows: unknown[];
        truncation: { returnedItems: number; totalItems: number };
      }>
    >;

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

    const result = (await execute(client, "setPageState", { query: "d" })) as Required<
      AgoPageStateResult<{ truncated: boolean }>
    >;

    // The whole point: the agent still learns the filter was applied.
    expect(result.success).toBe(true);
    expect(result.applied).toEqual(["query"]);
    expect(result.unchanged).toEqual([]);
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

    const result = (await execute(client, "setPageState", { query: "d" })) as Required<
      AgoPageStateResult<{ truncated: boolean; preview: string }>
    >;

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
      applied: ["query"],
      unchanged: [],
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

  it("drops a stale companion when re-registered without a data source", async () => {
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
    // A vanilla/Vue app navigating to a page with no data source, without
    // unregistering first. The old companion would still answer with page A.
    client.registerPageStateFunction([control]);

    expect(client.getRegisteredFunctions().map((f) => f.name)).toEqual([
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

describe("page data with verdicts", () => {
  it("all-rejected call still returns the data snapshot", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [{ name: "limit", description: "Limit.", schema: { type: "number" }, set: () => {} }],
      { data: { description: "Rows.", get: () => ["row-a"] } }
    );

    const result = (await execute(client, "setPageState", { limit: "bad" })) as AgoPageStateResult;

    expect(result.success).toBe(false);
    expect(result.rejected).toHaveProperty("limit");
    expect(result).toHaveProperty("data", ["row-a"]);
  });

  it("all-unchanged call still returns the data snapshot", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [{ name: "status", description: "Status.", schema: { type: "string" }, get: () => "draft", set: () => {} }],
      { data: { description: "Rows.", get: () => ["row-a"] } }
    );

    const result = (await execute(client, "setPageState", { status: "draft" })) as AgoPageStateResult;

    expect(result.success).toBe(true);
    expect(result.unchanged).toContain("status");
    expect(result.applied).toHaveLength(0);
    expect(result).toHaveProperty("data", ["row-a"]);
  });

  it("all-dropped call still returns the data snapshot", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [{ name: "q", description: "Query.", schema: { type: "string" }, set: () => {} }],
      { data: { description: "Rows.", get: () => ["row-a"] } }
    );

    const result = (await execute(client, "setPageState", { q: null })) as AgoPageStateResult;

    expect(result.success).toBe(true);
    expect(result.applied).toHaveLength(0);
    expect(result).toHaveProperty("data", ["row-a"]);
  });

  it("empty-payload call still returns the data snapshot", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [{ name: "q", description: "Query.", schema: { type: "string" }, set: () => {} }],
      { data: { description: "Rows.", get: () => ["row-a"] } }
    );

    const result = (await execute(client, "setPageState", {})) as AgoPageStateResult;

    expect(result.success).toBe(true);
    expect(result).toHaveProperty("data", ["row-a"]);
  });

  it("long rejection with page data stays within budget and preserves verdict", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const longNames = Array.from({ length: 105 }, (_, i) => `option-${"x".repeat(20)}-${i}`);
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    client.registerPageStateFunction(
      [
        { name: "choice", description: "Pick.", schema: { type: "string", enum: longNames }, set: () => {} },
        { name: "query", description: "Search.", schema: { type: "string" }, set: () => {} },
      ],
      { data: { description: "Rows.", get: () => rows, maxResultBytes: 2_000 } }
    );

    const result = (await execute(client, "setPageState", {
      choice: "nope",
      query: "dupont",
    })) as AgoPageStateResult;

    expect(result).not.toHaveProperty("preview");
    expect(result.success).toBe(false);
    expect(result.applied).toContain("query");
    expect(result.rejected).toHaveProperty("choice");
    expect(result).toHaveProperty("data");
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(2_000);
  });

  it("truncation budgets against the full envelope including rejected and unchanged", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const bigRows = Array.from({ length: 400 }, (_, i) => ({
      id: i,
      name: `user-${i}`,
      bio: "x".repeat(80),
    }));
    client.registerPageStateFunction(
      [
        { name: "query", description: "Search.", schema: { type: "string" }, set: () => {} },
        { name: "status", description: "Status.", schema: { type: "string" }, get: () => "draft", set: () => {} },
        { name: "limit", description: "Limit.", schema: { type: "number" }, set: () => {} },
      ],
      { data: { description: "Rows.", get: () => bigRows, maxResultBytes: 4_000 } }
    );

    const result = (await execute(client, "setPageState", {
      query: "dupont",
      status: "draft",
      limit: "bad",
    })) as AgoPageStateResult;

    expect(result.success).toBe(false);
    expect(result.applied).toContain("query");
    expect(result.unchanged).toContain("status");
    expect(result.rejected).toHaveProperty("limit");
    expect(result).toHaveProperty("data");
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(4_000);
  });
});

describe("no-data-source result size", () => {
  it("leaves an envelope exactly at the byte ceiling untouched", async () => {
    const reason = 'Exact é "reason".';
    const expected = {
      success: false,
      applied: [],
      unchanged: [],
      rejected: { choice: reason },
    };
    const exactBytes = new TextEncoder().encode(JSON.stringify(expected)).length;
    const client = new AgoClient({
      baseUrl: "https://example.test",
      maxFunctionResultBytes: exactBytes,
    });
    client.registerPageStateFunction([
      {
        name: "choice",
        description: "Pick.",
        schema: { type: "string" },
        set: () => ({ result: "rejected", reason }),
      },
    ]);

    expect(await execute(client, "setPageState", { choice: "x" })).toEqual(expected);
  });

  it("long rejection alternatives do not let the registry replace success and rejected", async () => {
    const client = new AgoClient({
      baseUrl: "https://example.test",
      maxFunctionResultBytes: 2_000,
    });
    const longNames = Array.from({ length: 105 }, (_, i) => `option-${"x".repeat(20)}-${i}`);
    client.registerPageStateFunction([
      { name: "choice", description: "Pick.", schema: { type: "string", enum: longNames }, set: () => {} },
    ]);

    const result = (await execute(client, "setPageState", { choice: "nope" })) as AgoPageStateResult;

    expect(result).not.toHaveProperty("truncated");
    expect(result.success).toBe(false);
    expect(result.rejected).toHaveProperty("choice");
    expect(result.rejected?.choice).toContain('"nope" is not an allowed value.');
    expect(result.rejected?.choice).toContain("[truncated]");
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(2_000);
  });

  it("keeps leading reasons and truncates later ones by their serialized byte cost", async () => {
    const client = new AgoClient({
      baseUrl: "https://example.test",
      maxFunctionResultBytes: 300,
    });
    const firstReason = "The first rejection stays useful.";
    const longReason = `Escaped: ${'"\\é'.repeat(500)}`;
    client.registerPageStateFunction([
      {
        name: "first",
        description: "First.",
        schema: { type: "string" },
        set: () => ({ result: "rejected", reason: firstReason }),
      },
      {
        name: "second",
        description: "Second.",
        schema: { type: "string" },
        set: () => ({ result: "rejected", reason: longReason }),
      },
      {
        name: "third",
        description: "Third.",
        schema: { type: "string" },
        set: () => ({ result: "rejected", reason: longReason }),
      },
    ]);

    const result = (await execute(client, "setPageState", {
      first: "x",
      second: "x",
      third: "x",
    })) as AgoPageStateResult;

    expect(result).not.toHaveProperty("truncated");
    expect(result.rejected?.first).toBe(firstReason);
    expect(result.rejected?.second).toContain("Escaped:");
    expect(result.rejected?.second).toContain("[truncated]");
    expect(result.rejected?.third).toBe(" … [truncated]");
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(300);
  });

  it("falls back to the registry preview when the verdict structure alone is too large", async () => {
    const client = new AgoClient({
      baseUrl: "https://example.test",
      maxFunctionResultBytes: 200,
    });
    client.registerPageStateFunction([]);
    const args = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`unknown-${i}`, "x"])
    );

    const result = (await execute(client, "setPageState", args)) as {
      truncated: boolean;
      maxBytes: number;
    };

    expect(result.truncated).toBe(true);
    expect(result.maxBytes).toBe(200);
  });
});
