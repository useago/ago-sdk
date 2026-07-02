import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { FunctionRegistry } from "../src/functions/FunctionRegistry";

function schemaOf(client: AgoClient, name: string) {
  return client.getRegisteredFunctions().find((s) => s.name === name);
}

function execute(client: AgoClient, name: string, args: Record<string, unknown>) {
  const registry = (client as unknown as { functionRegistry: FunctionRegistry })
    .functionRegistry;
  return registry.execute(name, args);
}

const ROUTES = [
  { name: "dashboard", path: "/", description: "Home dashboard" },
  { name: "users", path: "/users", description: "User list" },
  { name: "userDetail", path: "/users/:id", description: "A single user" },
  { name: "settings", path: "/settings", description: "App settings" },
];

describe("registerNavigationFunction", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    document.title = "";
  });

  it("registers the navigateToPage function with a page enum", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(vi.fn(), ROUTES);

    const schema = schemaOf(client, "navigateToPage");
    expect(schema).toBeDefined();
    expect(schema!.parameters.properties.page).toMatchObject({
      enum: ["dashboard", "users", "userDetail", "settings"],
    });
  });

  it("exposes each route param as an explicit top-level string argument", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(vi.fn(), ROUTES);

    const schema = schemaOf(client, "navigateToPage")!;
    expect(schema.description).toContain('- "userDetail" (requires "id"): A single user');
    expect(schema.description).toContain('- "users": User list');
    expect(schema.parameters.properties.id).toMatchObject({ type: "string" });
    expect(schema.parameters.properties.id.description).toContain('"userDetail"');
    expect(schema.parameters.required).toEqual(["page"]);
  });

  it("adds no param arguments when no route is parameterised", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(
      vi.fn(),
      ROUTES.filter((r) => !r.path.includes(":"))
    );

    const schema = schemaOf(client, "navigateToPage")!;
    expect(Object.keys(schema.parameters.properties)).toEqual(["page"]);
    expect(schema.description).not.toContain("requires");
  });

  it("navigates to a static route", async () => {
    const navigate = vi.fn();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(navigate, ROUTES);

    const result = await execute(client, "navigateToPage", { page: "settings" });

    expect(navigate).toHaveBeenCalledWith("/settings");
    expect(result).toEqual({ success: true, navigatedTo: "/settings" });
  });

  it("fills :params from top-level arguments", async () => {
    const navigate = vi.fn();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(navigate, ROUTES);

    const result = await execute(client, "navigateToPage", {
      page: "userDetail",
      id: 42,
    });

    expect(navigate).toHaveBeenCalledWith("/users/42");
    expect(result).toEqual({ success: true, navigatedTo: "/users/42" });
  });

  it("URL-encodes param values", async () => {
    const navigate = vi.fn();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(navigate, ROUTES);

    await execute(client, "navigateToPage", {
      page: "userDetail",
      id: "a/b c",
    });

    expect(navigate).toHaveBeenCalledWith("/users/a%2Fb%20c");
  });

  it("accepts params nested under a params object or a JSON string of one", async () => {
    const navigate = vi.fn();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(navigate, ROUTES);

    await execute(client, "navigateToPage", {
      page: "userDetail",
      params: { id: "7" },
    });
    expect(navigate).toHaveBeenCalledWith("/users/7");

    await execute(client, "navigateToPage", {
      page: "userDetail",
      params: '{"id":"8"}',
    });
    expect(navigate).toHaveBeenCalledWith("/users/8");
  });

  it("returns a correctable error when params are missing, without navigating", async () => {
    const navigate = vi.fn();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(navigate, ROUTES);

    const result = (await execute(client, "navigateToPage", {
      page: "userDetail",
    })) as { success: boolean; error: string };

    expect(navigate).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('needs "id"');
    expect(result.error).toContain('{ "page": "userDetail", "id": "..." }');
  });

  it("ignores param arguments on a static route", async () => {
    const navigate = vi.fn();
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(navigate, ROUTES);

    const result = await execute(client, "navigateToPage", {
      page: "users",
      id: "42",
    });

    expect(navigate).toHaveBeenCalledWith("/users");
    expect(result).toEqual({ success: true, navigatedTo: "/users" });
  });

  it("reports the current page (by route name) plus url and title as context", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(vi.fn(), ROUTES);

    window.history.pushState({}, "", "/users");
    document.title = "Users";

    const entry = client.getContextSnapshot()?.entries["current-page"];
    expect(entry).toMatchObject({
      name: "Current page",
      data: { page: "users", title: "Users" },
    });
    expect(String(entry?.data?.url)).toContain("/users");
  });

  it("is live: it reflects the page after navigation", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(vi.fn(), ROUTES);

    window.history.pushState({}, "", "/");
    expect(client.getContextSnapshot()?.entries["current-page"].data).toMatchObject({
      page: "dashboard",
    });

    window.history.pushState({}, "", "/settings");
    expect(client.getContextSnapshot()?.entries["current-page"].data).toMatchObject({
      page: "settings",
    });
  });

  it("matches parameterised routes", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(vi.fn(), ROUTES);

    window.history.pushState({}, "", "/users/42");
    expect(client.getContextSnapshot()?.entries["current-page"].data).toMatchObject({
      page: "userDetail",
    });
  });

  it("still reports the url when the pathname matches no route", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(vi.fn(), ROUTES);

    window.history.pushState({}, "", "/nowhere");
    const data = client.getContextSnapshot()?.entries["current-page"].data;
    expect(data).not.toHaveProperty("page");
    expect(String(data?.url)).toContain("/nowhere");
  });

  it("unregister removes both the function and the current-page context", () => {
    const client = new AgoClient({ baseUrl: "https://example.test" });
    client.registerNavigationFunction(vi.fn(), ROUTES);
    expect(schemaOf(client, "navigateToPage")).toBeDefined();
    expect(client.getContextSnapshot()?.entries["current-page"]).toBeDefined();

    client.unregisterNavigationFunction();

    expect(schemaOf(client, "navigateToPage")).toBeUndefined();
    expect(client.getContextSnapshot()).toBeNull();
  });
});
