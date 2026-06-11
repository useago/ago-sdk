import { describe, it, expect, vi } from "vitest";
import { defineFunction } from "../src/functions/defineFunction";
import { FunctionRegistry } from "../src/functions/FunctionRegistry";

describe("defineFunction", () => {
  it("should return the same definition object", () => {
    const handler = vi.fn();
    const def = defineFunction({
      name: "test",
      description: "A test function",
      parameters: { type: "object", properties: {} },
      handler,
    });

    expect(def.name).toBe("test");
    expect(def.handler).toBe(handler);
  });

  it("should work with FunctionRegistry.register", async () => {
    const registry = new FunctionRegistry();
    const handler = vi.fn().mockReturnValue({ ok: true });

    const def = defineFunction({
      name: "greet",
      description: "Say hello",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name to greet" },
        },
        required: ["name"],
      },
      handler,
    });

    registry.register(def);

    expect(registry.has("greet")).toBe(true);
    expect(registry.getSchemas()[0].description).toBe("Say hello");

    await registry.execute("greet", { name: "World" });
    expect(handler).toHaveBeenCalledWith({ name: "World" });
  });
});
