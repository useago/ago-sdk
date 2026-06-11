import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { autoDetectConfig, createAgo } from "../src/auto/createAgo";

describe("autoDetectConfig", () => {
  beforeEach(() => {
    // Clean up
    delete (window as Record<string, unknown>).AGO;
    document.querySelectorAll('meta[name^="ago-"]').forEach((el) => el.remove());
    document.body.removeAttribute("data-ago-base-url");
    document.body.removeAttribute("data-ago-widget-id");
  });

  it("returns null when no config is found", () => {
    expect(autoDetectConfig()).toBeNull();
  });

  it("detects config from window.AGO (agent shorthand)", () => {
    (window as Record<string, unknown>).AGO = {
      basepath: "https://api.test.com",
      widgetId: "wid-1",
      agent: "agent-1",
      permission: "premium-user",
      email: "user@test.com",
    };

    const config = autoDetectConfig();
    expect(config).toEqual({
      baseUrl: "https://api.test.com",
      widgetId: "wid-1",
      agent: "agent-1",
      permission: "premium-user",
      userEmail: "user@test.com",
      userJwt: undefined,
      debug: undefined,
    });
  });

  it("falls back to window.AGO.defaultAgent when agent is unset", () => {
    (window as Record<string, unknown>).AGO = {
      basepath: "https://api.test.com",
      defaultAgent: "agent-legacy",
    };

    const config = autoDetectConfig();
    expect(config!.agent).toBe("agent-legacy");
  });

  it("detects permission from override", () => {
    const config = autoDetectConfig({
      baseUrl: "https://test.useago.com",
      permission: "vip",
    });
    expect(config!.permission).toBe("vip");
  });

  it("accepts defaultAgentId override and exposes it as agent", () => {
    const config = autoDetectConfig({
      baseUrl: "https://test.useago.com",
      defaultAgentId: "agent-from-override",
    });
    expect(config!.agent).toBe("agent-from-override");
  });

  it("detects config from meta tags", () => {
    const addMeta = (name: string, content: string) => {
      const meta = document.createElement("meta");
      meta.setAttribute("name", name);
      meta.setAttribute("content", content);
      document.head.appendChild(meta);
    };

    addMeta("ago-base-url", "https://meta.test.com");
    addMeta("ago-widget-id", "meta-wid");

    const config = autoDetectConfig();
    expect(config).not.toBeNull();
    expect(config!.baseUrl).toBe("https://meta.test.com");
    expect(config!.widgetId).toBe("meta-wid");
  });

  it("detects config from data attributes on body", () => {
    document.body.setAttribute("data-ago-base-url", "https://body.test.com");
    document.body.setAttribute("data-ago-widget-id", "body-wid");

    const config = autoDetectConfig();
    expect(config).not.toBeNull();
    expect(config!.baseUrl).toBe("https://body.test.com");
    expect(config!.widgetId).toBe("body-wid");
  });

  it("applies overrides", () => {
    (window as Record<string, unknown>).AGO = {
      basepath: "https://api.test.com",
    };

    const config = autoDetectConfig({ debug: true, baseUrl: "https://override.com" });
    expect(config!.debug).toBe(true);
    expect(config!.baseUrl).toBe("https://override.com");
  });
});

describe("createAgo", () => {
  it("throws when no config is detected", () => {
    delete (window as Record<string, unknown>).AGO;
    expect(() => createAgo()).toThrow("could not detect AGO configuration");
  });

  it("creates client with explicit overrides", () => {
    const client = createAgo({ baseUrl: "https://test.useago.com" });
    expect(client).toBeDefined();
    client.destroy();
  });
});
