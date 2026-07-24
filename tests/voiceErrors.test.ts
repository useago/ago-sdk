import { describe, it, expect } from "vitest";
import { AgoError } from "../src/client/errors";
import { AgoVoiceError, serverReasonToCode } from "../src/voice/errors";

describe("serverReasonToCode", () => {
  it("maps every known snake_case server reason to its kebab code", () => {
    expect(serverReasonToCode("invalid_token")).toBe("invalid-token");
    expect(serverReasonToCode("origin_not_allowed")).toBe("origin-not-allowed");
    expect(serverReasonToCode("kill_switch")).toBe("kill-switch");
    expect(serverReasonToCode("concurrent_cap")).toBe("concurrent-cap");
    expect(serverReasonToCode("daily_minutes_cap")).toBe("daily-minutes-cap");
    expect(serverReasonToCode("backend_unavailable")).toBe(
      "backend-unavailable"
    );
    expect(serverReasonToCode("jwt_required")).toBe("jwt-required");
  });

  it("maps unknown reasons to server-error instead of throwing", () => {
    expect(serverReasonToCode("some_future_reason")).toBe("server-error");
  });
});

describe("AgoVoiceError", () => {
  it("extends AgoError with a stable kebab code (no second taxonomy)", () => {
    const err = new AgoVoiceError("mic-denied");
    expect(err).toBeInstanceOf(AgoError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgoVoiceError");
    expect(err.code).toBe("mic-denied");
  });

  it("carries retryable, docUrl, and optional retryAfter/serverReason", () => {
    const err = new AgoVoiceError("concurrent-cap", {
      retryAfter: 30,
      serverReason: "concurrent_cap",
    });
    expect(err.retryable).toBe(false);
    expect(err.retryAfter).toBe(30);
    expect(err.serverReason).toBe("concurrent_cap");
    expect(err.docUrl).toContain("voice.md");
    expect(err.docUrl).toContain("#concurrent-cap");
    expect(err.message).toContain(err.docUrl);
  });

  it("fromServerReason preserves the raw reason and retryAfter", () => {
    const err = AgoVoiceError.fromServerReason("daily_minutes_cap", {
      retryAfter: 3600,
    });
    expect(err.code).toBe("daily-minutes-cap");
    expect(err.serverReason).toBe("daily_minutes_cap");
    expect(err.retryAfter).toBe(3600);
  });

  it("fromServerReason keeps unknown reasons visible as serverReason", () => {
    const err = AgoVoiceError.fromServerReason("brand_new_reason");
    expect(err.code).toBe("server-error");
    expect(err.serverReason).toBe("brand_new_reason");
  });

  it("jwt-required carries the actionable JWT message", () => {
    const err = new AgoVoiceError("jwt-required");
    expect(err.message).toContain("authenticated AGO user");
    expect(err.message).toContain("userJwt/getUserJwt");
    expect(err.message).toContain("Anonymous widget IDs and userEmail");
  });

  it("insecure-context names the HTTPS requirement and localhost exception", () => {
    const err = new AgoVoiceError("insecure-context");
    expect(err.message).toContain("secure context");
    expect(err.message).toContain("localhost");
  });

  it("appends details (e.g. the blocked CSP directive) to the message", () => {
    const err = new AgoVoiceError("csp-blocked", {
      detail: "blocked directive: worker-src",
    });
    expect(err.message).toContain("worker-src");
  });

  it("retryable flags match the registry semantics", () => {
    expect(new AgoVoiceError("mic-denied").retryable).toBe(true);
    expect(new AgoVoiceError("mint-failed").retryable).toBe(true);
    expect(new AgoVoiceError("connection-lost").retryable).toBe(true);
    expect(new AgoVoiceError("backend-unavailable").retryable).toBe(true);
    expect(new AgoVoiceError("rate-limited").retryable).toBe(false);
    expect(new AgoVoiceError("jwt-required").retryable).toBe(false);
    expect(new AgoVoiceError("kill-switch").retryable).toBe(false);
    expect(new AgoVoiceError("insecure-context").retryable).toBe(false);
  });
});
