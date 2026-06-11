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
