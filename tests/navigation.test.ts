import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";

function schemaOf(client: AgoClient, name: string) {
  return client.getRegisteredFunctions().find((s) => s.name === name);
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
