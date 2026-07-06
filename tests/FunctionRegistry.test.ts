import { describe, it, expect, beforeEach } from "vitest";
import { FunctionRegistry } from "../src/functions/FunctionRegistry";

describe("FunctionRegistry", () => {
  let registry: FunctionRegistry;

  beforeEach(() => {
    registry = new FunctionRegistry();
  });

  describe("register", () => {
    it("should register a function", () => {
      const handler = () => ({ success: true });
      registry.register("testFunc", handler, {
        description: "A test function",
        parameters: {
          type: "object",
          properties: {},
        },
      });

      expect(registry.has("testFunc")).toBe(true);
      expect(registry.size).toBe(1);
    });

    it("should overwrite existing function with same name", () => {
      const handler1 = () => "first";
      const handler2 = () => "second";

      registry.register("testFunc", handler1, {
        description: "First",
        parameters: { type: "object", properties: {} },
      });

      registry.register("testFunc", handler2, {
        description: "Second",
        parameters: { type: "object", properties: {} },
      });

      expect(registry.size).toBe(1);
      const registered = registry.get("testFunc");
      expect(registered?.schema.description).toBe("Second");
    });
  });

  describe("unregister", () => {
    it("should remove a registered function", () => {
      registry.register("testFunc", () => {}, {
        description: "Test",
        parameters: { type: "object", properties: {} },
      });

      const result = registry.unregister("testFunc");

      expect(result).toBe(true);
      expect(registry.has("testFunc")).toBe(false);
    });

    it("should return false for non-existent function", () => {
      const result = registry.unregister("nonExistent");
      expect(result).toBe(false);
    });
  });

  describe("getSchemas", () => {
    it("should return all registered function schemas", () => {
      registry.register("func1", () => {}, {
        description: "Function 1",
        parameters: { type: "object", properties: {} },
      });

      registry.register("func2", () => {}, {
        description: "Function 2",
        parameters: { type: "object", properties: { id: { type: "string" } } },
      });

      const schemas = registry.getSchemas();

      expect(schemas).toHaveLength(2);
      expect(schemas[0].name).toBe("func1");
      expect(schemas[1].name).toBe("func2");
    });
  });

  describe("execute", () => {
    it("should execute a registered function", async () => {
      const handler = (args: { value: number }) => args.value * 2;

      registry.register("double", handler, {
        description: "Doubles a number",
        parameters: {
          type: "object",
          properties: { value: { type: "number" } },
        },
      });

      const result = await registry.execute("double", { value: 5 });

      expect(result).toBe(10);
    });

    it("should handle async functions", async () => {
      const handler = async (args: { delay: number }) => {
        await new Promise((resolve) => setTimeout(resolve, args.delay));
        return "done";
      };

      registry.register("asyncFunc", handler, {
        description: "Async function",
        parameters: {
          type: "object",
          properties: { delay: { type: "number" } },
        },
      });

      const result = await registry.execute("asyncFunc", { delay: 10 });

      expect(result).toBe("done");
    });

    it("should throw for non-existent function", async () => {
      await expect(registry.execute("nonExistent", {})).rejects.toThrow(
        'Function "nonExistent" is not registered'
      );
    });

    it("should wrap handler errors", async () => {
      const handler = () => {
        throw new Error("Handler error");
      };

      registry.register("errorFunc", handler, {
        description: "Error function",
        parameters: { type: "object", properties: {} },
      });

      await expect(registry.execute("errorFunc", {})).rejects.toThrow(
        "Handler error"
      );
    });
  });

  describe("result size guard", () => {
    const schema = {
      description: "Returns data",
      parameters: { type: "object" as const, properties: {} },
    };

    it("should return small results unchanged", async () => {
      registry.register("small", () => ({ ok: true }), schema);

      const result = await registry.execute("small", {});

      expect(result).toEqual({ ok: true });
    });

    it("should truncate results over the per-function limit", async () => {
      registry.register("big", () => ({ data: "x".repeat(500) }), {
        ...schema,
        maxResultBytes: 100,
      });

      const result = (await registry.execute("big", {})) as Record<
        string,
        unknown
      >;

      expect(result.truncated).toBe(true);
      expect(result.maxBytes).toBe(100);
      expect(result.originalBytes).toBeGreaterThan(100);
      expect(typeof result.preview).toBe("string");
      expect(result.hint).toContain('"big"');
    });

    it("should truncate results over the registry-level default", async () => {
      const limited = new FunctionRegistry({ maxResultBytes: 50 });
      limited.register("big", () => ({ data: "x".repeat(500) }), schema);

      const result = (await limited.execute("big", {})) as Record<
        string,
        unknown
      >;

      expect(result.truncated).toBe(true);
      expect(result.maxBytes).toBe(50);
    });

    it("should let a per-function limit exceed the registry default", async () => {
      const limited = new FunctionRegistry({ maxResultBytes: 50 });
      limited.register("allowed", () => ({ data: "x".repeat(500) }), {
        ...schema,
        maxResultBytes: Infinity,
      });

      const result = await limited.execute("allowed", {});

      expect(result).toEqual({ data: "x".repeat(500) });
    });

    it("should apply a limit updated via setDefaultMaxResultBytes", async () => {
      registry.register("big", () => ({ data: "x".repeat(500) }), schema);
      registry.setDefaultMaxResultBytes(50);

      const result = (await registry.execute("big", {})) as Record<
        string,
        unknown
      >;

      expect(result.truncated).toBe(true);
    });

    it("should pass non-serializable results through unchanged", async () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      registry.register("circular", () => circular, {
        ...schema,
        maxResultBytes: 10,
      });

      const result = await registry.execute("circular", {});

      expect(result).toBe(circular);
    });

    it("should not send maxResultBytes to the backend in schemas", () => {
      registry.register("big", () => ({}), {
        ...schema,
        maxResultBytes: 100,
      });

      const schemas = registry.getSchemas();

      expect(schemas[0]).not.toHaveProperty("maxResultBytes");
    });
  });

  describe("clear", () => {
    it("should remove all registered functions", () => {
      registry.register("func1", () => {}, {
        description: "F1",
        parameters: { type: "object", properties: {} },
      });
      registry.register("func2", () => {}, {
        description: "F2",
        parameters: { type: "object", properties: {} },
      });

      registry.clear();

      expect(registry.size).toBe(0);
    });
  });
});
