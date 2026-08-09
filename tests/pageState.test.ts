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

  it("ignores unknown control keys cleanly", async () => {
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
    expect(result).toEqual({ success: true, applied: { statusFilter: "all" } });
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
});
