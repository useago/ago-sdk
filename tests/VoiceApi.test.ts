import { describe, it, expect, beforeEach } from "vitest";
import { AgoApiError } from "../src/client/errors";
import { AgoVoiceError } from "../src/voice/errors";
import { VoiceApi } from "../src/voice/VoiceApi";
import { FakeHttp } from "./helpers/voiceStubs";

function jwtRequired403(): AgoApiError {
  return new AgoApiError("HTTP 403: jwt_required", "jwt_required", 403, "api_error");
}

describe("VoiceApi.mintSession", () => {
  let http: FakeHttp;
  let api: VoiceApi;

  beforeEach(() => {
    http = new FakeHttp();
    api = new VoiceApi(http.asHttpClient());
  });

  it("posts to the SDK mint endpoint with snake_case body and normalizes the grant", async () => {
    http.post.mockResolvedValueOnce({
      token: "tok-9",
      wsUrl: "wss://t.api.useago.com/v1/voice",
      threadId: "th-1",
    });
    const grant = await api.mintSession({
      agentId: "admin-helper",
      permissionId: "perm-1",
      conversationId: "th-1",
    });
    expect(http.post).toHaveBeenCalledWith(
      "/api/sdk/v1/voice/mint-session-token",
      {
        agent_id: "admin-helper",
        permission_id: "perm-1",
        conversation_id: "th-1",
      }
    );
    expect(grant).toEqual({
      token: "tok-9",
      wsUrl: "wss://t.api.useago.com/v1/voice",
      threadId: "th-1",
    });
  });

  it("accepts snake_case response fields", async () => {
    http.post.mockResolvedValueOnce({
      token: "tok-9",
      ws_url: "wss://t.api.useago.com/v1/voice",
      thread_id: "th-2",
    });
    const grant = await api.mintSession({});
    expect(grant.wsUrl).toBe("wss://t.api.useago.com/v1/voice");
    expect(grant.threadId).toBe("th-2");
  });

  it("jwt_required 403 with a getUserJwt provider: refresh then retry once", async () => {
    http.refreshUserJwt.mockResolvedValueOnce(true);
    http.post
      .mockRejectedValueOnce(jwtRequired403())
      .mockResolvedValueOnce({ token: "tok-2", wsUrl: "wss://x/v1/voice" });

    const grant = await api.mintSession({ agentId: "a" });
    expect(http.refreshUserJwt).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(grant.token).toBe("tok-2");
  });

  it("jwt_required 403 without a provider: no retry, actionable jwt-required error", async () => {
    http.refreshUserJwt.mockResolvedValueOnce(false);
    http.post.mockRejectedValueOnce(jwtRequired403());

    const err = await api.mintSession({}).catch((e) => e as AgoVoiceError);
    expect(err).toBeInstanceOf(AgoVoiceError);
    expect((err as AgoVoiceError).code).toBe("jwt-required");
    expect((err as AgoVoiceError).serverReason).toBe("jwt_required");
    expect((err as AgoVoiceError).message).toContain("userJwt/getUserJwt");
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it("jwt_required persisting after a refresh retry surfaces jwt-required", async () => {
    http.refreshUserJwt.mockResolvedValueOnce(true);
    http.post
      .mockRejectedValueOnce(jwtRequired403())
      .mockRejectedValueOnce(jwtRequired403());

    const err = await api.mintSession({}).catch((e) => e as AgoVoiceError);
    expect((err as AgoVoiceError).code).toBe("jwt-required");
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it("429 maps to rate-limited and is not retried", async () => {
    http.post.mockRejectedValueOnce(
      new AgoApiError("HTTP 429", "http_error", 429, "api_error")
    );
    const err = await api.mintSession({}).catch((e) => e as AgoVoiceError);
    expect((err as AgoVoiceError).code).toBe("rate-limited");
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it("non-jwt 403 maps to voice-unavailable (policy gate)", async () => {
    http.post.mockRejectedValueOnce(
      new AgoApiError("HTTP 403", "voice_disabled", 403, "api_error")
    );
    const err = await api.mintSession({}).catch((e) => e as AgoVoiceError);
    expect((err as AgoVoiceError).code).toBe("voice-unavailable");
    expect((err as AgoVoiceError).serverReason).toBe("voice_disabled");
  });

  it("network/5xx failures map to the retryable mint-failed code", async () => {
    http.post.mockRejectedValueOnce(
      new AgoApiError("HTTP 500", "http_error", 500, "api_error")
    );
    const err = await api.mintSession({}).catch((e) => e as AgoVoiceError);
    expect((err as AgoVoiceError).code).toBe("mint-failed");
    expect((err as AgoVoiceError).retryable).toBe(true);
  });

  it("a mint response missing token/wsUrl is a mint-failed error", async () => {
    http.post.mockResolvedValueOnce({ token: "tok-only" });
    const err = await api.mintSession({}).catch((e) => e as AgoVoiceError);
    expect((err as AgoVoiceError).code).toBe("mint-failed");
  });
});

describe("VoiceApi.getVoiceConfig", () => {
  it("reads gates from the selected permission and matches its agent", async () => {
    const http = new FakeHttp();
    http.get.mockResolvedValueOnce({
      permissions: [
        {
          id: "p-other",
          name: "other",
          voice_enabled: false,
          agents: [{ id: "a1", name: "helper", isVoiceAgent: false }],
        },
        {
          id: "p-admin",
          name: "admin",
          voice_enabled: true,
          agents: [
            { id: "a2", name: "admin-helper", isVoiceAgent: true },
          ],
        },
      ],
    });
    const api = new VoiceApi(http.asHttpClient());
    const flags = await api.getVoiceConfig("admin-helper", "p-admin");
    expect(flags).toEqual({ tenantEnabled: true, agentIsVoiceAgent: true });
  });

  it("defaults to the first permission and first agent", async () => {
    const http = new FakeHttp();
    http.get.mockResolvedValueOnce({
      permissions: [
        {
          voice_enabled: false,
          agents: [{ id: "a1", isVoiceAgent: true }],
        },
      ],
    });
    const api = new VoiceApi(http.asHttpClient());
    const flags = await api.getVoiceConfig();
    expect(flags).toEqual({ tenantEnabled: false, agentIsVoiceAgent: true });
  });

  it("selects the permission containing the configured agent", async () => {
    const http = new FakeHttp();
    http.get.mockResolvedValueOnce({
      permissions: [
        {
          id: "p-default",
          voice_enabled: false,
          agents: [{ name: "other", isVoiceAgent: false }],
        },
        {
          id: "p-admin",
          voice_enabled: true,
          agents: [{ name: "admin-helper", isVoiceAgent: true }],
        },
      ],
    });
    const api = new VoiceApi(http.asHttpClient());
    const flags = await api.getVoiceConfig("admin-helper");
    expect(flags).toEqual({ tenantEnabled: true, agentIsVoiceAgent: true });
  });

  it("can select a permission by name", async () => {
    const http = new FakeHttp();
    http.get.mockResolvedValueOnce({
      permissions: [
        { name: "default", voice_enabled: false, agents: [] },
        {
          name: "staff",
          voice_enabled: true,
          agents: [{ name: "admin-helper", isVoiceAgent: true }],
        },
      ],
    });
    const api = new VoiceApi(http.asHttpClient());
    const flags = await api.getVoiceConfig("admin-helper", "staff");
    expect(flags).toEqual({ tenantEnabled: true, agentIsVoiceAgent: true });
  });

  it("keeps compatibility with top-level pre-release fixtures", async () => {
    const http = new FakeHttp();
    http.get.mockResolvedValueOnce({
      voiceEnabled: false,
      agents: [{ id: "a1", isVoiceAgent: true }],
    });
    const api = new VoiceApi(http.asHttpClient());
    const flags = await api.getVoiceConfig();
    expect(flags).toEqual({ tenantEnabled: false, agentIsVoiceAgent: true });
  });

  it("leaves gates undefined when absent", async () => {
    const http = new FakeHttp();
    http.get.mockResolvedValueOnce({});
    const api = new VoiceApi(http.asHttpClient());
    const flags = await api.getVoiceConfig("x");
    expect(flags).toEqual({
      tenantEnabled: undefined,
      agentIsVoiceAgent: undefined,
    });
  });
});
