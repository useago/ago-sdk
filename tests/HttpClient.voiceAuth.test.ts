import { describe, it, expect, afterEach, vi } from "vitest";
import { HttpClient } from "../src/api/HttpClient";
import { AgoApiError } from "../src/client/errors";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bare-reason error bodies", () => {
  it("surfaces {reason: 'jwt_required'} 403 bodies as the error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ reason: "jwt_required" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const http = new HttpClient({ baseUrl: "https://x.example.com" });
    const err = await http
      .post("/api/sdk/v1/voice/mint-session-token", {})
      .catch((e) => e as AgoApiError);
    expect(err).toBeInstanceOf(AgoApiError);
    expect((err as AgoApiError).code).toBe("jwt_required");
    expect((err as AgoApiError).statusCode).toBe(403);
  });

  it("keeps the http_error code for reason-less non-envelope bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const http = new HttpClient({ baseUrl: "https://x.example.com" });
    const err = await http.post("/x", {}).catch((e) => e as AgoApiError);
    expect((err as AgoApiError).code).toBe("http_error");
  });
});

describe("getUserJwt provider", () => {
  it("hasBearerToken reflects the configured auth", () => {
    expect(
      new HttpClient({ baseUrl: "https://x.example.com" }).hasBearerToken(),
    ).toBe(false);
    expect(
      new HttpClient({
        baseUrl: "https://x.example.com",
        userJwt: "jwt-1",
      }).hasBearerToken(),
    ).toBe(true);
  });

  it("refreshUserJwt updates the bearer used by later requests", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const http = new HttpClient({
      baseUrl: "https://x.example.com",
      userJwt: "old-jwt",
      getUserJwt: async () => "fresh-jwt",
    });

    expect(await http.refreshUserJwt()).toBe(true);
    await http.post("/x", {});
    const headers = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fresh-jwt");
  });

  it("returns false without a provider (no retry is possible)", async () => {
    const http = new HttpClient({ baseUrl: "https://x.example.com" });
    expect(await http.refreshUserJwt()).toBe(false);
  });

  it("returns false when the provider throws or yields an empty token", async () => {
    const throwing = new HttpClient({
      baseUrl: "https://x.example.com",
      getUserJwt: async () => {
        throw new Error("no session");
      },
    });
    expect(await throwing.refreshUserJwt()).toBe(false);

    const empty = new HttpClient({
      baseUrl: "https://x.example.com",
      getUserJwt: async () => "",
    });
    expect(await empty.refreshUserJwt()).toBe(false);
  });

  it("clears an existing bearer and lazy provider when explicitly set to null", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const http = new HttpClient({
      baseUrl: "https://x.example.com",
      userJwt: "old-jwt",
      getUserJwt: async () => "fresh-jwt",
    });

    http.updateConfig({ userJwt: null, getUserJwt: null });
    expect(http.hasBearerToken()).toBe(false);
    expect(http.canAuthenticateWithJwt()).toBe(false);
    expect(await http.refreshUserJwt()).toBe(false);

    await http.post("/x", {});
    const headers = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
