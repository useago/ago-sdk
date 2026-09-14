import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { TOOL_BUDGETS } from "../src/functions/budgets";
import type { FunctionRegistry } from "../src/functions/FunctionRegistry";
import type { NavRoute } from "../src/functions/navigation";

function schemaOf(client: AgoClient, name: string) {
  return client.getRegisteredFunctions().find((s) => s.name === name);
}

function execute(
  client: AgoClient,
  name: string,
  args: Record<string, unknown>
) {
  const registry = (client as unknown as { functionRegistry: FunctionRegistry })
    .functionRegistry;
  return registry.execute(name, args);
}

const SECTIONED: NavRoute[] = [
  { name: "dashboard", path: "/", description: "Home dashboard", section: "Analytics" },
  { name: "reports", path: "/reports", description: "Saved reports", section: "Analytics" },
  { name: "users", path: "/users", description: "User list", section: "Admin" },
  { name: "userDetail", path: "/users/:id", description: "A single user", section: "Admin" },
];

const FLAT: NavRoute[] = SECTIONED.map(({ section: _section, ...rest }) => rest);

/** A table the size of a real admin app, to check the description budget. */
const BIG: NavRoute[] = Array.from({ length: 52 }, (_, i) => ({
  name: `page-number-${i}`,
  path: `/page-${i}`,
  description: `The ${i}th page, which does a reasonably long list of things.`,
  section: `Section ${i % 7}`,
}));

const client = () => new AgoClient({ baseUrl: "https://example.test" });

describe('registerNavigationFunction with catalogue: "onDemand"', () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("keeps the catalogue out of navigateToPage's description", () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), SECTIONED, { catalogue: "onDemand" });

    const description = schemaOf(c, "navigateToPage")!.description;
    expect(description).not.toContain("Home dashboard");
    expect(description).toContain("listPages");
    // Section names live in listPages' own enum; repeating them here would be
    // the same text twice in one prompt.
    expect(description).not.toContain("Analytics");
  });

  it("stays inside the description budget for a 52-route table", () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), BIG, { catalogue: "onDemand" });

    expect(schemaOf(c, "navigateToPage")!.description.length).toBeLessThanOrEqual(
      TOOL_BUDGETS.description
    );
    expect(schemaOf(c, "listPages")!.description.length).toBeLessThanOrEqual(
      TOOL_BUDGETS.description
    );
  });

  it("keeps the page enum as the index, and the :param arguments", () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), SECTIONED, { catalogue: "onDemand" });

    const { properties, required } = schemaOf(c, "navigateToPage")!.parameters;
    expect(properties.page.enum).toEqual([
      "dashboard",
      "reports",
      "users",
      "userDetail",
    ]);
    expect(properties.id.description).toContain('"userDetail"');
    expect(required).toEqual(["page"]);
  });

  it("registers listPages as read-only, and not as navigating", () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), SECTIONED, { catalogue: "onDemand" });

    const listPages = c
      .getFunctionRegistrations()
      .find((fn) => fn.name === "listPages");
    expect(listPages?.webmcp).toEqual({ annotations: { readOnlyHint: true } });

    const navigate = c
      .getFunctionRegistrations()
      .find((fn) => fn.name === "navigateToPage");
    expect(navigate?.webmcp).toEqual({ navigates: true });
  });

  it("offers a section parameter only when routes declare one", () => {
    const sectioned = client();
    sectioned.registerNavigationFunction(vi.fn(), SECTIONED, {
      catalogue: "onDemand",
    });
    expect(
      schemaOf(sectioned, "listPages")!.parameters.properties.section.enum
    ).toEqual(["Analytics", "Admin"]);

    const flat = client();
    flat.registerNavigationFunction(vi.fn(), FLAT, { catalogue: "onDemand" });
    const params = schemaOf(flat, "listPages")!.parameters;
    expect(params.properties).toEqual({});
    // Explicitly empty, not omitted: an absent `required` reads as "all".
    expect(params.required).toEqual([]);
  });

  it("requires a section, so no answer can blow the output budget", async () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), SECTIONED, { catalogue: "onDemand" });

    expect(schemaOf(c, "listPages")!.parameters.required).toEqual(["section"]);

    // Models drop required arguments, so the omission has to be correctable
    // rather than answered with the whole catalogue.
    const result = await execute(c, "listPages", {});
    expect(result).toEqual({
      pages: [],
      sections: ["Analytics", "Admin"],
      error: '"section" is required. Pick one and call again.',
    });
  });

  it("returns every page when no route declares a section", async () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), FLAT, { catalogue: "onDemand" });

    const result = (await execute(c, "listPages", {})) as {
      pages: Array<{ name: string; description: string }>;
    };
    expect(result.pages).toHaveLength(4);
    expect(result.pages[0]).toEqual({
      name: "dashboard",
      description: "Home dashboard",
    });
  });

  it("filters by section, case-insensitively", async () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), SECTIONED, { catalogue: "onDemand" });

    const result = (await execute(c, "listPages", { section: "admin" })) as {
      pages: Array<{ name: string; section?: string }>;
    };
    expect(result.pages.map((p) => p.name)).toEqual(["users", "userDetail"]);
    // The caller asked for one section; repeating it on every row is filler.
    expect(result.pages[0].section).toBeUndefined();
  });

  it("answers an unknown section with the valid ones instead of throwing", async () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), SECTIONED, { catalogue: "onDemand" });

    const result = await execute(c, "listPages", { section: "Nope" });
    expect(result).toEqual({
      pages: [],
      sections: ["Analytics", "Admin"],
      error: "Unknown section: Nope",
    });
  });

  it("hands the page names back on an unknown page, so a wrong guess self-heals", async () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), SECTIONED, { catalogue: "onDemand" });

    const result = (await execute(c, "navigateToPage", {
      page: "dashbaord",
    })) as { success: boolean; pages: string[] };
    expect(result.success).toBe(false);
    expect(result.pages).toEqual([
      "dashboard",
      "reports",
      "users",
      "userDetail",
    ]);
  });

  it("navigates exactly as inline does", async () => {
    const navigate = vi.fn();
    const c = client();
    c.registerNavigationFunction(navigate, SECTIONED, {
      catalogue: "onDemand",
    });

    await expect(
      execute(c, "navigateToPage", { page: "userDetail", id: "42" })
    ).resolves.toEqual({ success: true, navigatedTo: "/users/42" });
    expect(navigate).toHaveBeenCalledWith("/users/42");
  });
});

describe("listPages lifecycle", () => {
  it("is not registered under the default inline catalogue", () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), FLAT);
    expect(schemaOf(c, "listPages")).toBeUndefined();
  });

  it("is dropped when the catalogue flips back to inline", () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), SECTIONED, { catalogue: "onDemand" });
    expect(schemaOf(c, "listPages")).toBeDefined();

    // Re-registering without the companion must not leave it answering for the
    // previous route table.
    c.registerNavigationFunction(vi.fn(), FLAT);
    expect(schemaOf(c, "listPages")).toBeUndefined();
  });

  it("is removed by unregisterNavigationFunction", () => {
    const c = client();
    c.registerNavigationFunction(vi.fn(), SECTIONED, { catalogue: "onDemand" });
    expect(c.getContextSnapshot()?.entries["current-page"]).toBeDefined();

    c.unregisterNavigationFunction();

    expect(schemaOf(c, "navigateToPage")).toBeUndefined();
    expect(schemaOf(c, "listPages")).toBeUndefined();
    expect(c.getContextSnapshot()).toBeNull();
  });
});

describe("inline catalogue", () => {
  it("generates the same description whether or not sections are declared", () => {
    // Sections are an onDemand feature; declaring them must not change what the
    // inline catalogue emits.
    const withSections = client();
    withSections.registerNavigationFunction(vi.fn(), SECTIONED);

    const without = client();
    without.registerNavigationFunction(vi.fn(), FLAT);

    expect(schemaOf(withSections, "navigateToPage")!.description).toBe(
      schemaOf(without, "navigateToPage")!.description
    );
  });
});
