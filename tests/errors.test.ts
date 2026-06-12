import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AgoApiError,
  AgoError,
  AgoFunctionError,
  AgoNetworkError,
  AgoStreamError,
} from "../src/client/errors";
import { HttpClient } from "../src/api/HttpClient";
import { SSEHandler } from "../src/streaming/SSEHandler";
import { FunctionRegistry } from "../src/functions/FunctionRegistry";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("error sites carry problem + cause + fix + stable code", () => {
  it("network failure: AgoNetworkError with protocol/reachability hint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    const http = new HttpClient({ baseUrl: "https://unreachable.example.com" });

    try {
      await http.postStream("/api/sdk/v1/messages", {});
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as AgoNetworkError;
      expect(err).toBeInstanceOf(AgoNetworkError);
      expect(err.code).toBe("network_error");
      expect(err.message).toContain("protocol");
    }
  });

  it("no-body response: AgoStreamError with stream_no_body code and hint", async () => {
    const handler = new SSEHandler({});
    try {
      // new Response(null) has a null body — the documented fixture.
      await handler.processStream(new Response(null));
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as AgoStreamError;
      expect(err).toBeInstanceOf(AgoStreamError);
      expect(err.code).toBe("stream_no_body");
      expect(err.message).toContain("baseUrl");
    }
  });

  it("API error response: doc_url is surfaced in the message and on the field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                type: "invalid_request_error",
                code: "agent_not_found",
                message: "Agent not found.",
                doc_url: "https://docs.example.com/errors#agent_not_found",
              },
            }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          )
      )
    );
    const http = new HttpClient({ baseUrl: "https://x.example.com" });

    try {
      await http.post("/api/sdk/v1/messages", {});
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as AgoApiError;
      expect(err).toBeInstanceOf(AgoApiError);
      expect(err.docUrl).toBe("https://docs.example.com/errors#agent_not_found");
      expect(err.message).toContain("See https://docs.example.com/errors#agent_not_found");
    }
  });

  it("non-JSON HTTP errors: status-keyed hints for 401/403/404", async () => {
    for (const [status, hint] of [
      [401, "userJwt"],
      [403, "userJwt"],
      [404, "baseUrl"],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("nope", { status }))
      );
      const http = new HttpClient({ baseUrl: "https://x.example.com" });
      try {
        await http.post("/api/sdk/v1/messages", {});
        expect.unreachable("should have thrown");
      } catch (e) {
        const err = e as AgoApiError;
        expect(err.code).toBe("http_error");
        expect(err.statusCode).toBe(status);
        expect(err.message).toContain(hint);
      }
    }
  });

  it("FunctionRegistry misuse throws a coded AgoError with the fix", () => {
    const registry = new FunctionRegistry();
    try {
      registry.register("lookupOrder", undefined as never, undefined as never);
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = e as AgoError;
      expect(err).toBeInstanceOf(AgoError);
      expect(err.code).toBe("function_invalid_registration");
      expect(err.message).toContain("registerFunction({ name, parameters, handler })");
    }
  });
});

describe("error convention conformance", () => {
  it("every exported error class sets a stable code", () => {
    const instances: AgoError[] = [
      new AgoError("m", "some_code"),
      new AgoApiError("m", "api_code", 400, "api_error"),
      new AgoNetworkError("m"),
      new AgoStreamError("m"),
      new AgoFunctionError("m", "fn"),
    ];
    for (const err of instances) {
      expect(typeof err.code).toBe("string");
      expect(err.code.length).toBeGreaterThan(0);
      expect(err.code).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("no new plain `throw new Error(` sites appear in src/ (whitelist frozen)", () => {
    // Plain Errors dodge the codes convention. These pre-existing sites are
    // framework-idiom misuse errors (provider-context guards, target lookup,
    // form-collector schema guard) and are deliberately whitelisted. Adding a
    // NEW plain throw fails this test: use AgoError with a stable code instead.
    const whitelist = new Set([
      "src/forms/createFormCollector.ts",
      "src/widget/createChatWidget.ts",
      "src/vue/composables/useAgo.ts",
      "src/react/context/AgoContext.tsx",
      "src/react/hooks/useConversation.ts",
      "src/react/hooks/useChat.ts",
      "src/react/hooks/useMessages.ts",
    ]);

    const srcRoot = join(__dirname, "..", "src");
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          const rel = full.slice(join(__dirname, "..").length + 1);
          if (
            readFileSync(full, "utf8").includes("throw new Error(") &&
            !whitelist.has(rel)
          ) {
            offenders.push(rel);
          }
        }
      }
    };
    walk(srcRoot);

    expect(offenders).toEqual([]);
  });
});
