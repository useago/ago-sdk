import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { AgoError } from "../src/client/errors";
import {
  validateConfig,
  __resetSuspectBaseUrlWarning,
} from "../src/client/validateConfig";

describe("validateConfig / AgoClient construction", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetSuspectBaseUrlWarning();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("throws a coded AgoError for an empty config object", () => {
    expect(() => new AgoClient({} as never)).toThrowError(AgoError);
    try {
      new AgoClient({} as never);
    } catch (e) {
      const err = e as AgoError;
      expect(err.code).toBe("config_missing_base_url");
      expect(err.message).toContain("baseUrl");
      expect(err.message).toContain("https://playground.api.useago.com");
    }
  });

  it("throws config_missing_base_url for undefined and null config", () => {
    for (const bad of [undefined, null]) {
      try {
        new AgoClient(bad as never);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect((e as AgoError).code).toBe("config_missing_base_url");
      }
    }
  });

  it("throws for empty-string and non-string baseUrl", () => {
    for (const baseUrl of ["", "   ", 42, {}, null]) {
      try {
        validateConfig({ baseUrl });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect((e as AgoError).code).toBe("config_missing_base_url");
      }
    }
  });

  it("allows '/'-relative baseUrl (same-origin proxy) without warning", () => {
    expect(() => new AgoClient({ baseUrl: "/ago-proxy" })).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("allows custom schemes without warning", () => {
    expect(
      () => new AgoClient({ baseUrl: "capacitor://localhost" })
    ).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns once per process for a baseUrl without protocol, without echoing the value", () => {
    new AgoClient({ baseUrl: "ago.api.useago.com" });
    new AgoClient({ baseUrl: "user:secret@other.example.com" });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const text = String(warnSpy.mock.calls[0][0]);
    expect(text).toContain("config_suspect_base_url");
    expect(text).not.toContain("ago.api.useago.com");
    expect(text).not.toContain("secret");
  });

  it("names the calling context in the error message", () => {
    try {
      validateConfig({}, "createAgo()");
    } catch (e) {
      expect((e as AgoError).message).toMatch(/^createAgo\(\):/);
    }
  });
});

describe("AgoClient.updateConfig validation", () => {
  it("ignores omitted and explicitly-undefined baseUrl (spread-built partials)", () => {
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    expect(() =>
      client.updateConfig({ baseUrl: undefined, userJwt: "tok" })
    ).not.toThrow();
    expect(() => client.updateConfig({ userEmail: "a@b.c" })).not.toThrow();
  });

  it("throws on explicit empty/non-string baseUrl and leaves state unchanged", () => {
    const client = new AgoClient({ baseUrl: "https://x.example.com" });
    expect(() => client.updateConfig({ baseUrl: "" })).toThrowError(AgoError);
    try {
      client.updateConfig({ baseUrl: "" });
    } catch (e) {
      expect((e as AgoError).code).toBe("config_missing_base_url");
    }
    // No half-updated state: a valid follow-up update still works off the old config.
    expect(() => client.updateConfig({ userJwt: "tok" })).not.toThrow();
  });
});
