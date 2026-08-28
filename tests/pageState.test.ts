import { describe, it, expect, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { AgoPageStateResult, AgoStateControl } from "../src/functions/types";

function execute(client: AgoClient, name: string, args: Record<string, unknown>) {
  return client.executeClientFunction(name, args);
}

function schemaOf(client: AgoClient, name: string) {
  return client.getRegisteredFunctions().find((s) => s.name === name);
}

describe("registerPageStateFunction", () => {
  it("synthesizes one property per control, none required, propagating enums", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction([
      {
        name: "statusFilter",
        description: "Filter by status",
        schema: { type: "string", enum: ["all", "pending", "approved"] },
        set: () => {},
      },
      {
        name: "tags",
        description: "Selected tags",
        schema: { type: "array", items: { type: "string", enum: ["a", "b"] } },
        set: () => {},
      },
    ]);

    const schema = schemaOf(client, "setPageState");
    expect(schema).toBeDefined();
    // One synthesized function, not one per control.
    expect(client.getRegisteredFunctions()).toHaveLength(1);

    const props = schema!.parameters.properties;
    expect(Object.keys(props)).toEqual(["statusFilter", "tags"]);
    // No control is required, and the wire schema says so explicitly: an
    // absent `required` can be read as "all properties required" downstream.
    expect(schema!.parameters.required).toEqual([]);
    // Enum and per-field schema are propagated, description injected.
    expect(props.statusFilter).toMatchObject({
      type: "string",
      enum: ["all", "pending", "approved"],
      description: "Filter by status",
    });
    expect(props.tags).toMatchObject({
      type: "array",
      items: { type: "string", enum: ["a", "b"] },
      description: "Selected tags",
    });
  });

  it("uses a read-only description when no controls are registered", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction([]);

    const schema = schemaOf(client, "setPageState");
    expect(schema).toBeDefined();
    expect(schema!.description).toContain("no editable state");
    expect(schema!.description).not.toContain("Available controls");
  });

  it("appends the data suffix to the read-only description", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction([], {
      data: {
        description: "The profile of the open user.",
        get: () => ({ id: "u" }),
      },
    });

    const schema = schemaOf(client, "setPageState");
    expect(schema!.description).toContain("no editable state");
    expect(schema!.description).not.toContain("readPageData");
    expect(schema!.description).toContain("The profile of the open user.");
  });

  it("respects a custom functionName", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [{ name: "sort", description: "Sort order", schema: { type: "string" }, set: () => {} }],
      { functionName: "applyView" }
    );
    expect(schemaOf(client, "applyView")).toBeDefined();
    expect(schemaOf(client, "setPageState")).toBeUndefined();
  });

  it("calls set() only for controls present in args and returns { success, applied }", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const setStatus = vi.fn();
    const setSort = vi.fn();
    client.registerPageStateFunction([
      { name: "statusFilter", description: "Filter", schema: { type: "string" }, set: setStatus },
      { name: "sort", description: "Sort", schema: { type: "string" }, set: setSort },
    ]);

    const result = await execute(client, "setPageState", { statusFilter: "pending" });

    expect(setStatus).toHaveBeenCalledWith("pending");
    expect(setSort).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, applied: ["statusFilter"], unchanged: [] });
  });

  describe("unknown control rejection", () => {
    it("REJECT: unknown control names the registered controls", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setStatus = vi.fn();
      client.registerPageStateFunction([
        { name: "statusFilter", description: "Filter", schema: { type: "string" }, set: setStatus },
        { name: "sort", description: "Sort order", schema: { type: "string" }, set: () => {} },
      ]);

      const result = await execute(client, "setPageState", {
        statusFilter: "all",
        bogus: "nope",
      });

      expect(setStatus).toHaveBeenCalledWith("all");
      expect(result).toEqual({
        success: false,
        applied: ["statusFilter"],
        unchanged: [],
        rejected: {
          bogus: '"bogus" is not a registered control. Available controls: "statusFilter", "sort".',
        },
      });
    });

    it('REJECT: unknown "" proves lookup precedes DROP', async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setStatus = vi.fn();
      client.registerPageStateFunction([
        { name: "statusFilter", description: "Filter", schema: { type: "string" }, set: setStatus },
      ]);

      const result = await execute(client, "setPageState", {
        statusFilter: "all",
        bogus: "",
      });

      expect(setStatus).toHaveBeenCalledWith("all");
      expect(result).toEqual({
        success: false,
        applied: ["statusFilter"],
        unchanged: [],
        rejected: {
          bogus: '"bogus" is not a registered control. Available controls: "statusFilter".',
        },
      });
    });

    it("REJECT: available controls capped at 100", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const controls = Array.from({ length: 105 }, (_, i) => ({
        name: `ctrl-${i}`,
        description: `Control ${i}`,
        schema: { type: "string" as const },
        set: () => {},
      }));
      client.registerPageStateFunction(controls);

      const result = await execute(client, "setPageState", { unknown: "x" }) as AgoPageStateResult;

      expect(result.success).toBe(false);
      const reason = result.rejected?.unknown;
      expect(reason).toContain('"unknown" is not a registered control.');
      expect(reason).toContain('"ctrl-0"');
      expect(reason).toContain('"ctrl-99"');
      expect(reason).not.toContain('"ctrl-100"');
      expect(reason).toContain("(5 more not shown)");
    });
  });

  it("DROP undefined values", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const setStatus = vi.fn();
    client.registerPageStateFunction([
      { name: "statusFilter", description: "Filter", schema: { type: "string" }, set: setStatus },
    ]);

    const result = await execute(client, "setPageState", { statusFilter: undefined });

    expect(setStatus).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, applied: [], unchanged: [] });
  });

  it('DROP "" on a non-clearable control instead of erasing the field', async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const setTextFilter = vi.fn();
    client.registerPageStateFunction([
      { name: "textFilter", description: "My Custom string filter", schema: { type: "string" }, set: setTextFilter },
    ]);

    const result = await execute(client, "setPageState", { textFilter: "" });

    expect(setTextFilter).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, applied: [], unchanged: [] });
  });

  it("DROP null, the placeholder JSON can actually carry", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const setTextFilter = vi.fn();
    client.registerPageStateFunction([
      { name: "textFilter", description: "Filter", schema: { type: "string" }, set: setTextFilter },
    ]);

    const result = await execute(client, "setPageState", { textFilter: null });

    expect(setTextFilter).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, applied: [], unchanged: [] });
  });

  it('clearable string enum: "" is an instruction to clear, advertised once', async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let status = "draft";
    const setStatus = vi.fn((v: unknown) => {
      status = v as string;
    });
    const control: AgoStateControl = {
      name: "status",
      description: "Publication status.",
      schema: { type: "string", enum: ["draft", "live"] },
      clearable: true,
      get: () => status,
      set: setStatus,
    };
    client.registerPageStateFunction([control]);

    const props = schemaOf(client, "setPageState")!.parameters.properties;
    expect(props.status.enum).toEqual(["draft", "live", ""]);
    expect(props.status.description).toBe('Publication status. Pass "" to clear it.');
    // The advertised schema is synthesized, never the caller's own object: a
    // second registration must not stack another "" onto it.
    expect(control.schema.enum).toEqual(["draft", "live"]);

    const result = await execute(client, "setPageState", { status: "" });

    expect(setStatus).toHaveBeenCalledWith("");
    expect(result).toEqual({ success: true, applied: ["status"], unchanged: [] });
    expect(status).toEqual("");
  });

  it("clearable free text: gains the hint, but no enum that would forbid text", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let search = "dupont";
    const setSearch = vi.fn((v: unknown) => {
      search = v as string;
    });
    client.registerPageStateFunction([
      {
        name: "search",
        description: "Search text.",
        schema: { type: "string" },
        clearable: true,
        get: () => search,
        set: setSearch,
      },
    ]);

    const props = schemaOf(client, "setPageState")!.parameters.properties;
    expect(props.search.description).toBe('Search text. Pass "" to clear it.');
    // An enum here would let the agent send "" and nothing else.
    expect(props.search.enum).toBeUndefined();

    const result = await execute(client, "setPageState", { search: "" });

    expect(setSearch).toHaveBeenCalledWith("");
    expect(result).toEqual({ success: true, applied: ["search"], unchanged: [] });
  });

  it("clearable on a non-string control has no effect", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const setLimit = vi.fn();
    client.registerPageStateFunction([
      {
        name: "limit",
        description: "Rows per page.",
        schema: { type: "number" },
        clearable: true,
        set: setLimit,
      },
    ]);

    const props = schemaOf(client, "setPageState")!.parameters.properties;
    expect(props.limit.description).toBe("Rows per page.");

    const result = await execute(client, "setPageState", { limit: "" });

    expect(setLimit).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, applied: [], unchanged: [] });
  });

  it("awaits async set() handlers", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const order: string[] = [];
    const control: AgoStateControl = {
      name: "sort",
      description: "Sort",
      schema: { type: "string" },
      set: async (value) => {
        await Promise.resolve();
        order.push(String(value));
      },
    };
    client.registerPageStateFunction([control]);

    await execute(client, "setPageState", { sort: "asc" });
    expect(order).toEqual(["asc"]);
  });

  it("surfaces current get() values as dynamic context", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    let status = "all";
    client.registerPageStateFunction([
      { name: "statusFilter", description: "Filter", schema: { type: "string" }, get: () => status, set: (v) => { status = v as string; } },
      { name: "sort", description: "Sort (no getter)", schema: { type: "string" }, set: () => {} },
    ]);

    let snapshot = client.getContextSnapshot();
    expect(snapshot?.entries["page-state:setPageState"]).toMatchObject({
      name: "Page state",
      data: { statusFilter: "all" },
    });
    // Only controls with a get() appear.
    expect(
      snapshot?.entries["page-state:setPageState"].data
    ).not.toHaveProperty("sort");

    // The provider is live: it reflects the latest value.
    status = "pending";
    snapshot = client.getContextSnapshot();
    expect(snapshot?.entries["page-state:setPageState"].data).toEqual({
      statusFilter: "pending",
    });
  });

  it("reports no page-state context when no control has a get()", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction([
      { name: "sort", description: "Sort", schema: { type: "string" }, set: () => {} },
    ]);
    const snapshot = client.getContextSnapshot();
    expect(snapshot?.entries["page-state:setPageState"]).toBeUndefined();
  });

  it("unregister removes both the function and the dynamic context", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction([
      { name: "statusFilter", description: "Filter", schema: { type: "string" }, get: () => "all", set: () => {} },
    ]);
    expect(schemaOf(client, "setPageState")).toBeDefined();
    expect(client.getContextSnapshot()?.entries["page-state:setPageState"]).toBeDefined();

    client.unregisterPageStateFunction();

    expect(schemaOf(client, "setPageState")).toBeUndefined();
    expect(client.getContextSnapshot()).toBeNull();
  });

  describe("type validation", () => {
    it("REJECT: string sent to a number control", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setLimit = vi.fn();
      client.registerPageStateFunction([
        { name: "limit", description: "Rows per page.", schema: { type: "number" }, set: setLimit },
      ]);

      const result = await execute(client, "setPageState", { limit: "ten" });

      expect(setLimit).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { limit: 'Expected type "number", got "string".' },
      });
    });

    it("REJECT: NaN is not a valid number", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setLimit = vi.fn();
      client.registerPageStateFunction([
        { name: "limit", description: "Rows per page.", schema: { type: "number" }, set: setLimit },
      ]);

      const result = await execute(client, "setPageState", { limit: NaN });

      expect(setLimit).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { limit: "Expected a finite number." },
      });
    });

    it("REJECT: Infinity is not a valid number", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setLimit = vi.fn();
      client.registerPageStateFunction([
        { name: "limit", description: "Rows per page.", schema: { type: "number" }, set: setLimit },
      ]);

      const result = await execute(client, "setPageState", { limit: Infinity });

      expect(setLimit).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { limit: "Expected a finite number." },
      });
    });

    it("REJECT: number sent to a string control", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setName = vi.fn();
      client.registerPageStateFunction([
        { name: "name", description: "Agent name.", schema: { type: "string" }, set: setName },
      ]);

      const result = await execute(client, "setPageState", { name: 42 });

      expect(setName).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { name: 'Expected type "string", got "number".' },
      });
    });

    it("REJECT: string sent to a boolean control", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setBg = vi.fn();
      client.registerPageStateFunction([
        { name: "isBackground", description: "Run in background.", schema: { type: "boolean" }, set: setBg },
      ]);

      const result = await execute(client, "setPageState", { isBackground: "true" });

      expect(setBg).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { isBackground: 'Expected type "boolean", got "string".' },
      });
    });

    it("REJECT: string sent to an array control", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setTools = vi.fn();
      client.registerPageStateFunction([
        { name: "tools", description: "Selected tools.", schema: { type: "array", items: { type: "string" } }, set: setTools },
      ]);

      const result = await execute(client, "setPageState", { tools: "hammer" });

      expect(setTools).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { tools: 'Expected type "array", got "string".' },
      });
    });

    it("REJECT: array sent to a string control", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setName = vi.fn();
      client.registerPageStateFunction([
        { name: "name", description: "Agent name.", schema: { type: "string" }, set: setName },
      ]);

      const result = await execute(client, "setPageState", { name: ["a", "b"] });

      expect(setName).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { name: 'Expected type "string", got "array".' },
      });
    });

    it("a valid type still reaches set()", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setLimit = vi.fn();
      client.registerPageStateFunction([
        { name: "limit", description: "Rows per page.", schema: { type: "number" }, set: setLimit },
      ]);

      const result = await execute(client, "setPageState", { limit: 25 });

      expect(setLimit).toHaveBeenCalledWith(25);
      expect(result).toEqual({ success: true, applied: ["limit"], unchanged: [] });
    });

    it("rejection does not block valid siblings", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setName = vi.fn();
      const setLimit = vi.fn();
      client.registerPageStateFunction([
        { name: "name", description: "Agent name.", schema: { type: "string" }, set: setName },
        { name: "limit", description: "Rows per page.", schema: { type: "number" }, set: setLimit },
      ]);

      const result = await execute(client, "setPageState", { name: "Bot", limit: "ten" });

      expect(setName).toHaveBeenCalledWith("Bot");
      expect(setLimit).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: ["name"],
        unchanged: [],
        rejected: { limit: 'Expected type "number", got "string".' },
      });
    });
  });

  describe("enum and items validation", () => {
    it("REJECT: array item whose type differs from items.type", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setTags = vi.fn();
      client.registerPageStateFunction([
        { name: "tags", description: "Tags.", schema: { type: "array", items: { type: "string" } }, set: setTags },
      ]);

      const result = await execute(client, "setPageState", { tags: ["ok", 42, "fine"] });

      expect(setTags).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { tags: 'Array item at index 1: expected type "string", got "number".' },
      });
    });

    it("REJECT: NaN inside a number array", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setScores = vi.fn();
      client.registerPageStateFunction([
        { name: "scores", description: "Scores.", schema: { type: "array", items: { type: "number" } }, set: setScores },
      ]);

      const result = await execute(client, "setPageState", { scores: [1, NaN, 3] });

      expect(setScores).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { scores: "Array item at index 1: expected a finite number." },
      });
    });

    it("REJECT: scalar outside schema.enum", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setStatus = vi.fn();
      client.registerPageStateFunction([
        { name: "status", description: "Status.", schema: { type: "string", enum: ["draft", "live"] }, set: setStatus },
      ]);

      const result = await execute(client, "setPageState", { status: "banana" });

      expect(setStatus).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { status: '"banana" is not an allowed value. Allowed values: "draft", "live".' },
      });
    });

    it("REJECT: enum alternatives capped at 100", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setCity = vi.fn();
      const cities = Array.from({ length: 105 }, (_, i) => `city-${i}`);
      client.registerPageStateFunction([
        { name: "city", description: "City.", schema: { type: "string", enum: cities }, set: setCity },
      ]);

      const result = await execute(client, "setPageState", { city: "nowhere" }) as AgoPageStateResult;

      expect(setCity).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      const reason = result.rejected?.city;
      expect(reason).toContain('"nowhere" is not an allowed value.');
      expect(reason).toContain('"city-0"');
      expect(reason).toContain('"city-99"');
      expect(reason).not.toContain('"city-100"');
      expect(reason).toContain("(5 more not shown)");
    });

    it("REJECT: array item outside items.enum", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setTags = vi.fn();
      client.registerPageStateFunction([
        { name: "tags", description: "Tags.", schema: { type: "array", items: { type: "string", enum: ["a", "b", "c"] } }, set: setTags },
      ]);

      const result = await execute(client, "setPageState", { tags: ["a", "x"] });

      expect(setTags).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { tags: 'Array item "x" is not an allowed value. Allowed values: "a", "b", "c".' },
      });
    });

    it('clearable string enum: "" passes the runtime enum check', async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setStatus = vi.fn();
      client.registerPageStateFunction([
        {
          name: "status",
          description: "Status.",
          schema: { type: "string", enum: ["draft", "live"] },
          clearable: true,
          get: () => "draft",
          set: setStatus,
        },
      ]);

      const result = await execute(client, "setPageState", { status: "" });

      expect(setStatus).toHaveBeenCalledWith("");
      expect(result).toEqual({ success: true, applied: ["status"], unchanged: [] });
    });

    it("a valid enum value still reaches set()", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setStatus = vi.fn();
      client.registerPageStateFunction([
        { name: "status", description: "Status.", schema: { type: "string", enum: ["draft", "live"] }, set: setStatus },
      ]);

      const result = await execute(client, "setPageState", { status: "live" });

      expect(setStatus).toHaveBeenCalledWith("live");
      expect(result).toEqual({ success: true, applied: ["status"], unchanged: [] });
    });
  });

  describe("setter outcomes", () => {
    it("REJECT: synchronous { result: rejected, reason } is not applied", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      client.registerPageStateFunction([
        {
          name: "model",
          description: "Model.",
          schema: { type: "string" },
          set: () => ({ result: "rejected" as const, reason: "Unknown model." }),
        },
      ]);

      const result = await execute(client, "setPageState", { model: "gpt-9" });

      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { model: "Unknown model." },
      });
    });

    it("REJECT: blank reason uses a default message", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      client.registerPageStateFunction([
        {
          name: "model",
          description: "Model.",
          schema: { type: "string" },
          set: () => ({ result: "rejected" as const, reason: "" }),
        },
      ]);

      const result = await execute(client, "setPageState", { model: "gpt-9" });

      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { model: "The page rejected this field's update." },
      });
    });

    it("REJECT: async { result: rejected } is awaited and handled identically", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      client.registerPageStateFunction([
        {
          name: "model",
          description: "Model.",
          schema: { type: "string" },
          set: async () => {
            await Promise.resolve();
            return { result: "rejected" as const, reason: "Not available." };
          },
        },
      ]);

      const result = await execute(client, "setPageState", { model: "gpt-9" });

      expect(result).toEqual({
        success: false,
        applied: [],
        unchanged: [],
        rejected: { model: "Not available." },
      });
    });

    it("UNCHANGED: { result: unchanged } appears in unchanged, not applied", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      let current = "pending";
      client.registerPageStateFunction([
        {
          name: "status",
          description: "Status.",
          schema: { type: "string" },
          get: () => current,
          set: (v) => {
            current = v as string;
            return { result: "unchanged" as const };
          },
        },
      ]);

      const result = await execute(client, "setPageState", { status: "pending" });

      expect(current).toBe("pending");
      expect(result).toEqual({ success: true, applied: [], unchanged: ["status"] });
    });

    it("APPLY: unrecognized JS return value is treated as void/applied", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      client.registerPageStateFunction([
        {
          name: "name",
          description: "Name.",
          schema: { type: "string" },
          set: (v) => (v as string).toUpperCase() as unknown as void,
        },
      ]);

      const result = await execute(client, "setPageState", { name: "Bot" });

      expect(result).toEqual({ success: true, applied: ["name"], unchanged: [] });
    });

    it("thrown setter remains a function execution error, not a verdict", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      client.registerPageStateFunction([
        {
          name: "status",
          description: "Status.",
          schema: { type: "string" },
          set: () => { throw new Error("DB down"); },
        },
      ]);

      await expect(
        execute(client, "setPageState", { status: "live" })
      ).rejects.toThrow("DB down");
    });
  });

  describe("generic equality (SKIP)", () => {
    it("equal scalar with get() skips set and appears in unchanged", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setStatus = vi.fn();
      client.registerPageStateFunction([
        { name: "status", description: "Status.", schema: { type: "string" }, get: () => "draft", set: setStatus },
      ]);

      const result = await execute(client, "setPageState", { status: "draft" });

      expect(setStatus).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, applied: [], unchanged: ["status"] });
    });

    it("equal arrays with same members in same order are unchanged", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setTags = vi.fn();
      client.registerPageStateFunction([
        {
          name: "tags",
          description: "Tags.",
          schema: { type: "array", items: { type: "string" } },
          get: () => ["a", "b"],
          set: setTags,
        },
      ]);

      const result = await execute(client, "setPageState", { tags: ["a", "b"] });

      expect(setTags).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, applied: [], unchanged: ["tags"] });
    });

    it("nested objects with different key order are unchanged", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setConfig = vi.fn();
      client.registerPageStateFunction([
        {
          name: "config",
          description: "Config.",
          schema: { type: "array" },
          get: () => [{ b: 2, a: 1 }],
          set: setConfig,
        },
      ]);

      const result = await execute(client, "setPageState", { config: [{ a: 1, b: 2 }] });

      expect(setConfig).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, applied: [], unchanged: ["config"] });
    });

    it("reordered arrays apply (order is significant)", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setTags = vi.fn();
      client.registerPageStateFunction([
        {
          name: "tags",
          description: "Tags.",
          schema: { type: "array", items: { type: "string" } },
          get: () => ["a", "b"],
          set: setTags,
        },
      ]);

      const result = await execute(client, "setPageState", { tags: ["b", "a"] });

      expect(setTags).toHaveBeenCalledWith(["b", "a"]);
      expect(result).toEqual({ success: true, applied: ["tags"], unchanged: [] });
    });

    it("non-empty to [] applies, [] to [] is unchanged", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setFull = vi.fn();
      const setEmpty = vi.fn();
      client.registerPageStateFunction([
        {
          name: "full",
          description: "Full.",
          schema: { type: "array", items: { type: "string" } },
          get: () => ["x"],
          set: setFull,
        },
        {
          name: "empty",
          description: "Empty.",
          schema: { type: "array", items: { type: "string" } },
          get: () => [],
          set: setEmpty,
        },
      ]);

      const result = await execute(client, "setPageState", { full: [], empty: [] });

      expect(setFull).toHaveBeenCalledWith([]);
      expect(setEmpty).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, applied: ["full"], unchanged: ["empty"] });
    });

    it("no get() proceeds to set; page-resolved unchanged still reports unchanged", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setApplied = vi.fn();
      client.registerPageStateFunction([
        {
          name: "blind",
          description: "No getter.",
          schema: { type: "string" },
          set: setApplied,
        },
        {
          name: "semantic",
          description: "Page resolves.",
          schema: { type: "string" },
          set: () => ({ result: "unchanged" as const }),
        },
      ]);

      const result = await execute(client, "setPageState", { blind: "x", semantic: "x" });

      expect(setApplied).toHaveBeenCalledWith("x");
      expect(result).toEqual({ success: true, applied: ["blind"], unchanged: ["semantic"] });
    });
  });

  describe("verdict composition", () => {
    it("one call covers APPLY, SKIP, REJECT, DROP, and unknown", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const setApply = vi.fn();
      const setSkip = vi.fn();
      const setRejectType = vi.fn();
      const setRejectEnum = vi.fn();
      const setDrop = vi.fn();
      client.registerPageStateFunction([
        { name: "applied", description: "Applied.", schema: { type: "string" }, set: setApply },
        { name: "skipped", description: "Skipped.", schema: { type: "string" }, get: () => "same", set: setSkip },
        { name: "badType", description: "Type mismatch.", schema: { type: "number" }, set: setRejectType },
        { name: "badEnum", description: "Enum miss.", schema: { type: "string", enum: ["a", "b"] }, set: setRejectEnum },
        { name: "dropped", description: "Dropped.", schema: { type: "string" }, set: setDrop },
      ]);

      const result = await execute(client, "setPageState", {
        applied: "new",
        skipped: "same",
        badType: "not-a-number",
        badEnum: "z",
        dropped: null,
        unknown: "x",
      }) as AgoPageStateResult;

      expect(setApply).toHaveBeenCalledWith("new");
      expect(setSkip).not.toHaveBeenCalled();
      expect(setRejectType).not.toHaveBeenCalled();
      expect(setRejectEnum).not.toHaveBeenCalled();
      expect(setDrop).not.toHaveBeenCalled();

      expect(result.success).toBe(false);
      expect(result.applied).toEqual(expect.arrayContaining(["applied"]));
      expect(result.applied).toHaveLength(1);
      expect(result.unchanged).toEqual(expect.arrayContaining(["skipped"]));
      expect(result.unchanged).toHaveLength(1);
      expect(result.rejected).toBeDefined();
      expect(Object.keys(result.rejected!)).toEqual(expect.arrayContaining(["badType", "badEnum", "unknown"]));
      expect(Object.keys(result.rejected!)).toHaveLength(3);
    });

    it("rejected omitted when empty, success true", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      client.registerPageStateFunction([
        { name: "x", description: "X.", schema: { type: "string" }, set: () => {} },
      ]);

      const result = await execute(client, "setPageState", { x: "val" });

      expect(result).toEqual({ success: true, applied: ["x"], unchanged: [] });
      expect(result).not.toHaveProperty("rejected");
    });

    it("success is false if and only if rejected is non-empty", async () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      client.registerPageStateFunction([
        { name: "good", description: "Good.", schema: { type: "string" }, set: () => {} },
        { name: "bad", description: "Bad.", schema: { type: "number" }, set: () => {} },
      ]);

      const result = await execute(client, "setPageState", { good: "ok", bad: "nope" }) as AgoPageStateResult;

      expect(result.success).toBe(false);
      expect(result.applied).toContain("good");
      expect(result.rejected).toHaveProperty("bad");
    });
  });

  it("unregister targets the matching custom functionName", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction(
      [{ name: "sort", description: "Sort", schema: { type: "string" }, get: () => "asc", set: () => {} }],
      { functionName: "applyView" }
    );
    client.unregisterPageStateFunction("applyView");
    expect(schemaOf(client, "applyView")).toBeUndefined();
    expect(client.getContextSnapshot()).toBeNull();
  });
});
