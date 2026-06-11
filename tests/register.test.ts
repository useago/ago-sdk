import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { withHandler } from "../src/helpers/factory";
import { showToast } from "../src/helpers/functions";

describe("AgoClient.register", () => {
  let client: AgoClient;

  beforeEach(() => {
    client = new AgoClient({ baseUrl: "https://example.test" });
  });

  afterEach(() => {
    client.destroy();
  });

  it("registers a single definition", () => {
    client.register({
      name: "lookupOrder",
      description: "Look up an order",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ ok: true }),
    });

    const schemas = client.getRegisteredFunctions();
    expect(schemas.map((s) => s.name)).toContain("lookupOrder");
  });

  it("registers an array of definitions in bulk", () => {
    const tools = [
      {
        name: "fn1",
        description: "d1",
        parameters: { type: "object" as const, properties: {} },
        handler: async () => null,
      },
      {
        name: "fn2",
        description: "d2",
        parameters: { type: "object" as const, properties: {} },
        handler: async () => null,
      },
    ];

    client.register(tools);

    const names = client.getRegisteredFunctions().map((s) => s.name);
    expect(names).toContain("fn1");
    expect(names).toContain("fn2");
  });
});

describe("withHandler", () => {
  it("returns a new definition with the provided handler", () => {
    const myHandler = vi.fn(async () => ({ shown: true }));
    const wired = withHandler(showToast, myHandler);

    expect(wired.name).toBe("showToast");
    expect(wired.description).toBe(showToast.description);
    expect(wired.parameters).toBe(showToast.parameters);
    expect(wired.handler).toBe(myHandler);
  });

  it("does not mutate the original definition", () => {
    const originalHandler = showToast.handler;
    const newHandler = vi.fn();

    withHandler(showToast, newHandler);

    expect(showToast.handler).toBe(originalHandler);
  });
});
