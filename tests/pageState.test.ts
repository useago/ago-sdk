import { describe, it, expect, vi } from "vitest";
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
    expect(result).toEqual({ success: true, applied: { statusFilter: "pending" } });
  });

  it("applies known controls and reports unknown ones instead of silently skipping", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const setStatus = vi.fn();
    client.registerPageStateFunction([
      { name: "statusFilter", description: "Filter", schema: { type: "string" }, set: setStatus },
    ]);

    const result = await execute(client, "setPageState", {
      statusFilter: "all",
      bogus: "nope",
    });

    expect(setStatus).toHaveBeenCalledWith("all");
    // The known control still lands, but `success` is false and the agent is
    // told which name was wrong — reporting success here is what let the agent
    // believe it had changed the page when it had not.
    expect(result).toMatchObject({
      success: false,
      applied: { statusFilter: "all" },
      unknownControls: ["bogus"],
    });
    expect((result as { hint: string }).hint).toContain("statusFilter");
  });

  it("reports a control whose setter throws without failing the whole call", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const setStatus = vi.fn();
    client.registerPageStateFunction([
      { name: "statusFilter", description: "Filter", schema: { type: "string" }, set: setStatus },
      {
        name: "sort",
        description: "Sort",
        schema: { type: "string" },
        set: () => {
          throw new Error("sort backend is down");
        },
      },
    ]);

    const result = await execute(client, "setPageState", {
      statusFilter: "all",
      sort: "price",
    });

    // Previously the throw rejected the handler, so the agent was told the call
    // failed while statusFilter had already been applied — it then retried and
    // double-applied it.
    expect(setStatus).toHaveBeenCalledWith("all");
    expect(result).toMatchObject({
      success: false,
      applied: { statusFilter: "all" },
      failed: [{ control: "sort", error: "sort backend is down" }],
    });
  });

  it("caps how many unknown control names it echoes back", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerPageStateFunction([
      { name: "statusFilter", description: "Filter", schema: { type: "string" }, set: () => {} },
    ]);

    const args: Record<string, unknown> = {};
    for (let i = 0; i < 30; i++) args[`bogus${i}`] = "x";
    const result = (await execute(client, "setPageState", args)) as {
      unknownControls: string[];
    };

    expect(result.unknownControls).toHaveLength(10);
    expect(result.unknownControls.every((n) => n.length <= 64)).toBe(true);
  });

  it("skips undefined values", async () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    const setStatus = vi.fn();
    client.registerPageStateFunction([
      { name: "statusFilter", description: "Filter", schema: { type: "string" }, set: setStatus },
    ]);

    const result = await execute(client, "setPageState", { statusFilter: undefined });

    expect(setStatus).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, applied: {} });
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

  // A React route transition mounts the destination page before unmounting the
  // one it replaces, so both hooks are alive under `setPageState` at once. The
  // outgoing page's cleanup used to delete the incoming page's registration and
  // its `readPageData` companion, leaving the agent with no page state at all.
  describe("two pages mounted at once (route transition)", () => {
    const ctl = (name: string, set = () => {}) => ({
      name,
      description: `${name} control`,
      schema: { type: "string" as const },
      get: () => "x",
      set,
    });

    it("the outgoing page's disposer leaves the incoming page's controls in place", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });

      const disposeA = client.registerPageStateFunction([ctl("sort")]); // page A
      client.registerPageStateFunction([ctl("lactose")]); // page B mounts
      disposeA(); // page A unmounts

      const schema = schemaOf(client, "setPageState");
      expect(schema).toBeDefined();
      expect(Object.keys(schema!.parameters.properties)).toEqual(["lactose"]);
    });

    it("restores the previous page's controls if the newer page disposes first", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });

      client.registerPageStateFunction([ctl("sort")]);
      const disposeB = client.registerPageStateFunction([ctl("lactose")]);

      disposeB();

      const schema = schemaOf(client, "setPageState");
      expect(Object.keys(schema!.parameters.properties)).toEqual(["sort"]);
    });

    it("the outgoing page's disposer keeps the incoming page's readPageData", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });
      const source = (description: string) => ({
        description,
        get: () => [description],
      });

      const disposeA = client.registerPageStateFunction([ctl("sort")], {
        data: source("rows"),
      });
      client.registerPageStateFunction([ctl("lactose")], { data: source("flavors") });
      disposeA();

      const companion = schemaOf(client, "readPageData");
      expect(companion).toBeDefined();
      expect(companion!.description).toContain("flavors");
    });

    it("clears everything once both pages have disposed", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });

      const disposeA = client.registerPageStateFunction([ctl("sort")], {
        data: { description: "rows", get: () => [] },
      });
      const disposeB = client.registerPageStateFunction([ctl("lactose")], {
        data: { description: "flavors", get: () => [] },
      });
      disposeA();
      disposeB();

      expect(schemaOf(client, "setPageState")).toBeUndefined();
      expect(schemaOf(client, "readPageData")).toBeUndefined();
      expect(client.getContextSnapshot()).toBeNull();
    });

    // Regression: registering a page-state function WITHOUT a data source used
    // to remove `readPageData` by name, which popped the companion belonging to
    // a sibling that was still mounted (a modal over a page with page data).
    it("registering without a data source leaves a live sibling's readPageData alone", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });

      client.registerPageStateFunction([ctl("sort")], {
        data: { description: "rows", get: () => [] },
      });
      // A second owner with no data source, mounted while the first is alive.
      client.registerPageStateFunction([ctl("lactose")]);

      expect(schemaOf(client, "readPageData")?.description).toContain("rows");
    });

    // Regression: `readPageData` is a name a host app can use for its own
    // function. Cleanup must never remove it.
    it("never removes a readPageData the host app registered itself", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });

      client.registerFunction("readPageData", async () => ({ mine: true }), {
        description: "host app's own reader",
        parameters: { type: "object", properties: {} },
      });

      const dispose = client.registerPageStateFunction([ctl("sort")], {
        data: { description: "rows", get: () => [] },
      });
      dispose();

      // The SDK's companion is gone; the host's function is untouched.
      expect(schemaOf(client, "readPageData")?.description).toBe(
        "host app's own reader"
      );

      // And a later page-state registration without data must not touch it.
      client.registerPageStateFunction([ctl("lactose")]);
      expect(schemaOf(client, "readPageData")?.description).toBe(
        "host app's own reader"
      );

      // Neither does the name-based teardown once our own stack is empty.
      client.unregisterPageStateFunction();
      client.unregisterPageStateFunction();
      expect(schemaOf(client, "readPageData")?.description).toBe(
        "host app's own reader"
      );
    });

    it("a disposer is idempotent and never pops another page's registration", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });

      const disposeA = client.registerPageStateFunction([ctl("sort")]);
      client.registerPageStateFunction([ctl("lactose")]);

      disposeA();
      disposeA();

      const schema = schemaOf(client, "setPageState");
      expect(Object.keys(schema!.parameters.properties)).toEqual(["lactose"]);
    });

    // The name-keyed API cannot know which owner is calling it, so it stays
    // last-writer-wins — same contract as `unregisterFunction(name)`.
    it("unregisterPageStateFunction(name) removes the most recent registration", () => {
      const client = new AgoClient({ baseUrl: "https://example.test" });

      client.registerPageStateFunction([ctl("sort")]);
      client.registerPageStateFunction([ctl("lactose")]);
      client.unregisterPageStateFunction();

      const schema = schemaOf(client, "setPageState");
      expect(Object.keys(schema!.parameters.properties)).toEqual(["sort"]);
    });
  });
});
