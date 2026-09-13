import { describe, it, expect, vi, afterEach } from "vitest";
import { FunctionRegistry } from "../src/functions/FunctionRegistry";
import { TOOL_BUDGETS, overBudget } from "../src/functions/budgets";
import { logger } from "../src/utils/logger";

type Schema = Parameters<typeof overBudget>[0];

const schema = (over: Partial<Schema> = {}): Schema => ({
  name: "listFlights",
  description: "The flights currently on screen.",
  parameters: { type: "object", properties: {} },
  ...over,
});

describe("tool budgets", () => {
  afterEach(() => {
    logger.disable();
    vi.restoreAllMocks();
  });

  it("passes a schema that fits every budget", () => {
    expect(overBudget(schema())).toEqual([]);
  });

  it("reports each over-budget field with its size", () => {
    const over = overBudget(
      schema({
        name: "a".repeat(31),
        description: "b".repeat(501),
        parameters: {
          type: "object",
          properties: {
            ["c".repeat(31)]: { type: "string" },
            page: { type: "string", description: "d".repeat(151) },
          },
        },
      }),
    );

    expect(over).toEqual([
      "name (31/30)",
      "description (501/500)",
      `"${"c".repeat(31)}" name (31/30)`,
      '"page" description (151/150)',
    ]);
  });

  it("tolerates a registration missing the fields the types require", () => {
    const over = overBudget(
      schema({
        description: undefined,
        parameters: undefined,
      }),
    );

    expect(over).toEqual([]);
  });

  it("accepts a field exactly on its budget", () => {
    expect(
      overBudget(schema({ description: "b".repeat(TOOL_BUDGETS.description) })),
    ).toEqual([]);
  });

  it("warns at registration, naming the fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.enable();

    new FunctionRegistry().register("navigateToPage", () => null, {
      description: "b".repeat(3584),
      parameters: {
        type: "object",
        properties: { page: { type: "string", description: "d".repeat(151) } },
      },
    });

    const message = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(message).toContain("description (3584/500)");
    expect(message).toContain('"page" description (151/150)');
  });

  it("stays silent for a function within budget", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.enable();

    new FunctionRegistry().register("listFlights", () => null, {
      description: "The flights currently on screen.",
      parameters: { type: "object", properties: {} },
    });

    expect(warn).not.toHaveBeenCalled();
  });
});
