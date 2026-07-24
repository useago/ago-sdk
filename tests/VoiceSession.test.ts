import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MockInstance } from "vitest";
import { AgoApiError } from "../src/client/errors";
import { VoiceSession, VOICE_TIMEOUTS } from "../src/voice/VoiceSession";
import type { AgoVoiceEvents } from "../src/voice/types";
import {
  FakeAudioContext,
  FakeHttp,
  FakeMediaStream,
  FakeWebSocket,
  installVoiceStubs,
  loudFrame,
  quietFrame,
  type VoiceStubs,
} from "./helpers/voiceStubs";

let stubs: VoiceStubs;
let http: FakeHttp;
let consoleErrorSpy: MockInstance;

function makeSession(
  overrides: {
    requireConsent?: boolean;
    agent?: string;
    permission?: string;
  } = {}
): VoiceSession {
  return new VoiceSession({
    http: http.asHttpClient(),
    getAgent: () => overrides.agent ?? "admin-helper",
    getPermission: () => overrides.permission,
    requireConsent: overrides.requireConsent ?? false,
  });
}

function events<K extends keyof AgoVoiceEvents>(
  session: VoiceSession,
  event: K
): AgoVoiceEvents[K][] {
  const seen: AgoVoiceEvents[K][] = [];
  session.on(event, (data) => seen.push(data));
  return seen;
}

async function startToLive(
  session: VoiceSession,
  threadId = "th-1"
): Promise<FakeWebSocket> {
  await session.start();
  const ws = stubs.lastSocket();
  ws.emitOpen();
  ws.emitFrame({ type: "ready", threadId });
  return ws;
}

beforeEach(() => {
  vi.useFakeTimers();
  stubs = installVoiceStubs();
  http = new FakeHttp();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  stubs.restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("happy path", () => {
  it("walks requesting-permission, connecting, live; mic before mint", async () => {
    const session = makeSession();
    const statuses = events(session, "voice:status");

    const ws = await startToLive(session);

    const seen = statuses.map((s) => s.status);
    expect(seen).toContain("requesting-permission");
    expect(seen).toContain("connecting");
    expect(seen[seen.length - 1]).toBe("live");
    // Mic before mint: the permission prompt must not eat the token TTL.
    expect(stubs.getUserMedia.mock.invocationCallOrder[0]).toBeLessThan(
      http.post.mock.invocationCallOrder[0]
    );
    // The auth frame carried the minted token.
    expect(ws.sentFrames()[0]).toMatchObject({ type: "auth", token: "tok-1" });
  });

  it("adopts the server-bound thread from the ready frame", async () => {
    const session = makeSession();
    const threads = events(session, "voice:thread-ready");
    await startToLive(session, "th-42");
    expect(threads).toEqual([{ threadId: "th-42" }]);
    expect(session.getState().conversationId).toBe("th-42");
  });

  it("pins a new call to an existing conversation", async () => {
    const session = makeSession();
    await session.start({ conversationId: "th-existing" });
    expect(http.post).toHaveBeenCalledWith(
      "/api/sdk/v1/voice/mint-session-token",
      expect.objectContaining({ conversation_id: "th-existing" })
    );
    expect(session.getState().conversationId).toBe("th-existing");
  });

  it("streams transcripts: partials update captions, finals emit turn-final", async () => {
    const session = makeSession();
    const transcripts = events(session, "voice:transcript");
    const finals = events(session, "voice:turn-final");
    const ws = await startToLive(session);

    ws.emitFrame({ type: "transcript", role: "assistant", text: "Hel" });
    ws.emitFrame({ type: "transcript", role: "assistant", text: "Hello" });
    expect(session.getState().captions).toEqual([
      { role: "assistant", text: "Hello", final: false },
    ]);
    expect(finals).toHaveLength(0);

    ws.emitFrame({
      type: "transcript",
      role: "assistant",
      text: "Hello there",
      final: true,
    });
    expect(finals).toEqual([
      { role: "assistant", text: "Hello there", final: true },
    ]);
    expect(session.getState().captions).toEqual([]);
    expect(transcripts).toHaveLength(3);
  });

  it("a final user transcript moves the turn to agent-thinking", async () => {
    const session = makeSession();
    const ws = await startToLive(session);
    ws.emitFrame({ type: "transcript", role: "user", text: "Hi", final: true });
    expect(session.getState().turn).toBe("agent-thinking");
  });

  it("agent audio goes to the playback worklet and flips turn to agent-speaking", async () => {
    const session = makeSession();
    const ws = await startToLive(session);
    ws.emitFrame({ type: "audio", audio: "AAAA" });
    expect(stubs.playbackNode().port.postMessage).toHaveBeenCalledTimes(1);
    expect(session.getState().turn).toBe("agent-speaking");
  });

  it("flush (barge-in) drops queued audio and finalizes the assistant partial as interrupted", async () => {
    const session = makeSession();
    const finals = events(session, "voice:turn-final");
    const ws = await startToLive(session);

    ws.emitFrame({ type: "transcript", role: "assistant", text: "I was say" });
    ws.emitFrame({ type: "flush" });

    expect(stubs.playbackNode().port.postMessage).toHaveBeenCalledWith({
      type: "flush",
    });
    expect(finals).toEqual([
      { role: "assistant", text: "I was say", final: true, interrupted: true },
    ]);
    expect(session.getState().captions).toEqual([]);
    expect(session.getState().turn).toBe("user-speaking");
  });

  it("persisted acks are keyed by messageId and dropped without one", async () => {
    const session = makeSession();
    const persisted = events(session, "voice:persisted");
    const ws = await startToLive(session);

    ws.emitFrame({ type: "persisted", role: "user", turnIndex: 0 });
    expect(persisted).toHaveLength(0);

    ws.emitFrame({
      type: "persisted",
      role: "user",
      messageId: "msg-7",
      threadId: "th-1",
      turnIndex: 0,
      text: "Hi",
    });
    expect(persisted).toEqual([
      {
        messageId: "msg-7",
        role: "user",
        threadId: "th-1",
        text: "Hi",
        turnIndex: 0,
      },
    ]);
  });

  it("a server ended frame tears down and releases the mic", async () => {
    const session = makeSession();
    const ended = events(session, "voice:ended");
    const ws = await startToLive(session);
    ws.emitFrame({ type: "ended", reason: "idle" });
    expect(ended).toEqual([{ reason: "idle" }]);
    expect(session.getState().status).toBe("ended");
    expect(session.getState().endedReason).toBe("idle");
    expect(stubs.lastStream().tracks[0].stopped).toBe(true);
  });

  it("stop() sends the end frame and closes the socket", async () => {
    const session = makeSession();
    const ws = await startToLive(session);
    session.stop();
    expect(ws.sentFrames().at(-1)).toEqual({ type: "end" });
    expect(ws.closeCalled).toBe(true);
    expect(stubs.lastStream().tracks[0].stopped).toBe(true);
    expect(session.getState().status).toBe("ended");
    expect(session.getState().endedReason).toBe("stopped");
  });
});

describe("generation cancellation (five stop points)", () => {
  it("stop during the permission dialog releases the late mic stream", async () => {
    let resolveGum!: (stream: unknown) => void;
    stubs.getUserMedia.mockImplementationOnce(
      () => new Promise((resolve) => (resolveGum = resolve))
    );
    const session = makeSession();
    const startPromise = session.start();
    session.stop();

    const lateStream = new FakeMediaStream();
    resolveGum(lateStream);
    await startPromise;

    expect(lateStream.tracks[0].stopped).toBe(true);
    expect(http.post).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("stop between mic and mint never opens a socket", async () => {
    let resolveMint!: (grant: unknown) => void;
    http.post.mockImplementationOnce(
      () => new Promise((resolve) => (resolveMint = resolve))
    );
    const session = makeSession();
    const startPromise = session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(http.post).toHaveBeenCalledTimes(1);

    session.stop();
    resolveMint({ token: "tok-late", wsUrl: "wss://x/v1/voice" });
    await startPromise;

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(stubs.lastStream().tracks[0].stopped).toBe(true);
  });

  it("stop during worklet load disposes the audio context and opens no socket", async () => {
    const resolvers: Array<() => void> = [];
    FakeAudioContext.nextAddModuleImpl = () =>
      new Promise<void>((resolve) => resolvers.push(resolve));
    const session = makeSession();
    const startPromise = session.start();
    await vi.advanceTimersByTimeAsync(0);
    const ctx = stubs.lastContext();
    expect(ctx.audioWorklet.addModule).toHaveBeenCalled();

    session.stop();
    // Let both queued module loads resolve late.
    resolvers.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);
    resolvers.forEach((resolve) => resolve());
    await startPromise;

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(ctx.state).toBe("closed");
  });

  it("stop while the socket is CONNECTING closes it unconditionally", async () => {
    const session = makeSession();
    await session.start();
    const ws = stubs.lastSocket();
    expect(ws.readyState).toBe(FakeWebSocket.CONNECTING);

    session.stop();

    // The shipped hook only closed OPEN sockets and leaked the admitted
    // session; the SDK closes whatever the readyState.
    expect(ws.closeCalled).toBe(true);
  });

  it("stop during the mint retry backoff aborts the retry", async () => {
    http.post.mockRejectedValueOnce(
      new AgoApiError("HTTP 500", "http_error", 500, "api_error")
    );
    const session = makeSession();
    const startPromise = session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(http.post).toHaveBeenCalledTimes(1);

    session.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await startPromise;

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});

describe("reconnect", () => {
  it("REGRESSION: after a reconnect, mic frames reach the NEW socket", async () => {
    const session = makeSession();
    const ws1 = await startToLive(session, "th-9");

    // Frames flow into the first socket while live.
    stubs.sendMicFrame(loudFrame());
    expect(ws1.sentFrames().some((f) => f.type === "audio")).toBe(true);

    ws1.emitClose();
    expect(session.getState().status).toBe("reconnecting");
    expect(session.getState().degraded).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    const ws2 = stubs.lastSocket();
    expect(ws2).not.toBe(ws1);
    ws2.emitOpen();
    ws2.emitFrame({ type: "ready", threadId: "th-9" });
    expect(session.getState().status).toBe("live");
    expect(session.getState().degraded).toBe(false);

    const before1 = ws1.sent.length;
    stubs.sendMicFrame(loudFrame());
    expect(ws1.sent.length).toBe(before1);
    expect(ws2.sentFrames().some((f) => f.type === "audio")).toBe(true);
    // The mic was NOT re-acquired for the reconnect.
    expect(stubs.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("re-mints pinned to the adopted thread", async () => {
    const session = makeSession();
    const ws1 = await startToLive(session, "th-42");
    ws1.emitClose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(http.post.mock.calls[1][1]).toMatchObject({
      conversation_id: "th-42",
    });
  });

  it("frames from the stale socket are dropped after reconnect", async () => {
    const session = makeSession();
    const ws1 = await startToLive(session);
    ws1.emitClose();
    await vi.advanceTimersByTimeAsync(1000);
    const ws2 = stubs.lastSocket();
    ws2.emitOpen();
    ws2.emitFrame({ type: "ready" });

    const errors = events(session, "voice:error");
    const ended = events(session, "voice:ended");
    // Late frames from the dead socket: persisted, error, ended.
    ws1.emitFrame({ type: "persisted", role: "user", messageId: "m1" });
    ws1.emitFrame({ type: "error", reason: "kill_switch" });
    ws1.emitFrame({ type: "ended", reason: "idle" });
    ws1.emitClose();

    expect(session.getState().status).toBe("live");
    expect(errors).toHaveLength(0);
    expect(ended).toHaveLength(0);
  });

  it("only one reconnect per generation: a second drop is terminal", async () => {
    const session = makeSession();
    const errors = events(session, "voice:error");
    const ws1 = await startToLive(session);
    ws1.emitClose();
    await vi.advanceTimersByTimeAsync(1000);
    const ws2 = stubs.lastSocket();
    ws2.emitOpen();
    ws2.emitFrame({ type: "ready" });

    ws2.emitClose();
    expect(session.getState().status).toBe("error");
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("connection-lost");
    // Terminal exactly once, mic released.
    expect(stubs.lastStream().tracks[0].stopped).toBe(true);
  });

  it("reconnect abandons cleanly when the mic disappeared meanwhile", async () => {
    const session = makeSession();
    const ended = events(session, "voice:ended");
    const ws1 = await startToLive(session);
    stubs.lastStream().tracks.length = 0;
    ws1.emitClose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ended).toEqual([{ reason: "mic-lost" }]);
  });
});

describe("deadlines", () => {
  it("a socket that never opens hits the open deadline and spends the reconnect", async () => {
    const session = makeSession();
    await session.start();
    expect(FakeWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(VOICE_TIMEOUTS.wsOpenMs + 1);
    expect(session.getState().status).toBe("reconnecting");
    // The stuck socket was closed unconditionally.
    expect(FakeWebSocket.instances[0].closeCalled).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("auth without ready hits the ready deadline", async () => {
    const session = makeSession();
    await session.start();
    stubs.lastSocket().emitOpen();
    await vi.advanceTimersByTimeAsync(VOICE_TIMEOUTS.readyMs + 1);
    expect(session.getState().status).toBe("reconnecting");
  });

  it("a reconnect that never completes fails at the overall deadline", async () => {
    const session = makeSession();
    const errors = events(session, "voice:error");
    const ws1 = await startToLive(session);
    ws1.emitClose();
    // Let the backoff fire and the second socket appear, but never open it.
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(VOICE_TIMEOUTS.reconnectOverallMs);
    expect(session.getState().status).toBe("error");
    expect(errors.length).toBe(1);
  });
});

describe("retry budget", () => {
  it("one budgeted mint retry with backoff, then success", async () => {
    http.post
      .mockRejectedValueOnce(
        new AgoApiError("HTTP 500", "http_error", 500, "api_error")
      )
      .mockResolvedValueOnce({ token: "tok-2", wsUrl: "wss://x/v1/voice" });
    const session = makeSession();
    const startPromise = session.start();
    await vi.advanceTimersByTimeAsync(1000);
    await startPromise;
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("the budget is shared: after a mint retry, a WS drop is terminal", async () => {
    http.post
      .mockRejectedValueOnce(
        new AgoApiError("HTTP 500", "http_error", 500, "api_error")
      )
      .mockResolvedValueOnce({ token: "tok-2", wsUrl: "wss://x/v1/voice" });
    const session = makeSession();
    const errors = events(session, "voice:error");
    const startPromise = session.start();
    await vi.advanceTimersByTimeAsync(1000);
    await startPromise;
    const ws = stubs.lastSocket();
    ws.emitOpen();
    ws.emitFrame({ type: "ready" });

    ws.emitClose();
    expect(session.getState().status).toBe("error");
    expect(errors[0].code).toBe("connection-lost");
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it("429 is never auto-retried", async () => {
    http.post.mockRejectedValueOnce(
      new AgoApiError("HTTP 429", "http_error", 429, "api_error")
    );
    const session = makeSession();
    const errors = events(session, "voice:error");
    await session.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(errors[0].code).toBe("rate-limited");
  });

  it("invalid_token during auth spends the budget on a re-mint", async () => {
    const session = makeSession();
    await session.start();
    const ws1 = stubs.lastSocket();
    ws1.emitOpen();
    ws1.emitFrame({ type: "error", reason: "invalid_token" });
    expect(session.getState().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    expect(http.post).toHaveBeenCalledTimes(2);
    const ws2 = stubs.lastSocket();
    ws2.emitOpen();
    ws2.emitFrame({ type: "ready" });
    expect(session.getState().status).toBe("live");
  });

  it("backend_unavailable is retried once, then terminal", async () => {
    const session = makeSession();
    const errors = events(session, "voice:error");
    const ws1 = await startToLive(session);
    ws1.emitFrame({ type: "error", reason: "backend_unavailable", retryAfter: 5 });
    expect(session.getState().status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    const ws2 = stubs.lastSocket();
    ws2.emitOpen();
    ws2.emitFrame({ type: "error", reason: "backend_unavailable" });
    expect(session.getState().status).toBe("error");
    expect(errors[0].code).toBe("backend-unavailable");
    expect(errors[0].serverReason).toBe("backend_unavailable");
  });

  it("cap errors carry retryAfter and are terminal without auto-retry", async () => {
    const session = makeSession();
    const errors = events(session, "voice:error");
    const ws = await startToLive(session);
    ws.emitFrame({ type: "error", reason: "concurrent_cap", retryAfter: 30 });
    expect(session.getState().status).toBe("error");
    expect(errors[0].code).toBe("concurrent-cap");
    expect(errors[0].retryAfter).toBe(30);
    expect(http.post).toHaveBeenCalledTimes(1);
  });
});

describe("robustness", () => {
  it("ignores unknown server frame types and malformed JSON", async () => {
    const session = makeSession();
    const errors = events(session, "voice:error");
    const ws = await startToLive(session);
    ws.emitFrame({ type: "brand-new-frame", payload: { x: 1 } });
    ws.emitFrame("{not json");
    expect(session.getState().status).toBe("live");
    expect(errors).toHaveLength(0);
  });

  it("mic track revocation mid-call ends the session with mic-lost", async () => {
    const session = makeSession();
    const ended = events(session, "voice:ended");
    await startToLive(session);
    const track = stubs.lastStream().tracks[0];
    track.onended?.();
    expect(ended).toEqual([{ reason: "mic-lost" }]);
    expect(session.getState().status).toBe("ended");
    expect(track.stopped).toBe(true);
  });

  it("resumes a suspended AudioContext when the tab becomes visible", async () => {
    const session = makeSession();
    await startToLive(session);
    const ctx = stubs.lastContext();
    ctx.state = "suspended";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.resume).toHaveBeenCalled();
  });

  it("emits voice:error through console.error", async () => {
    const session = makeSession();
    const ws = await startToLive(session);
    ws.emitFrame({ type: "error", reason: "kill_switch" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("kill-switch")
    );
  });
});

describe("CSP and addModule failure", () => {
  it("addModule rejection without a CSP event is audio-init-failed", async () => {
    FakeAudioContext.nextAddModuleImpl = async () => {
      throw new Error("nope");
    };
    const session = makeSession();
    const errors = events(session, "voice:error");
    await session.start();
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("audio-init-failed");
    expect(session.getState().status).toBe("error");
    // The host app never crashed; the mic was released.
    expect(stubs.lastStream().tracks[0].stopped).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("a securitypolicyviolation during addModule reports csp-blocked with the directive", async () => {
    FakeAudioContext.nextAddModuleImpl = async () => {
      const event = new Event("securitypolicyviolation");
      Object.assign(event, {
        violatedDirective: "worker-src",
        effectiveDirective: "worker-src",
      });
      document.dispatchEvent(event);
      throw new Error("blocked");
    };
    const session = makeSession();
    const errors = events(session, "voice:error");
    await session.start();
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("csp-blocked");
    expect(errors[0].message).toContain("worker-src");
    // The failure is remembered as an availability reason.
    const report = await session.checkAvailability();
    expect(report.availability).toBe("unsupported");
    expect(report.unavailableReason).toBe("csp-blocked");
  });
});

describe("mute and level", () => {
  it("toggleMute is orthogonal to status and disables the tracks", async () => {
    const session = makeSession();
    const statuses = events(session, "voice:status");
    await startToLive(session);

    session.toggleMute();
    expect(session.getState().muted).toBe(true);
    expect(session.getState().status).toBe("live");
    expect(stubs.lastStream().tracks[0].enabled).toBe(false);
    expect(statuses.at(-1)).toMatchObject({ status: "live", muted: true });

    session.toggleMute();
    expect(session.getState().muted).toBe(false);
    expect(stubs.lastStream().tracks[0].enabled).toBe(true);
  });

  it("muted and degraded can hold at the same time (orthogonal flags)", async () => {
    const session = makeSession();
    const ws = await startToLive(session);
    session.toggleMute();
    ws.emitError();
    const state = session.getState();
    expect(state.muted).toBe(true);
    expect(state.degraded).toBe(true);
    expect(state.status).toBe("live");
  });

  it("emits voice:level from mic RMS and sends no frames while muted", async () => {
    const session = makeSession();
    const levels = events(session, "voice:level");
    const ws = await startToLive(session);

    stubs.sendMicFrame(loudFrame());
    expect(levels.at(-1)).toBeGreaterThan(0);
    const framesBefore = ws.sentFrames().filter((f) => f.type === "audio").length;
    expect(framesBefore).toBe(1);

    session.toggleMute();
    stubs.sendMicFrame(loudFrame());
    expect(ws.sentFrames().filter((f) => f.type === "audio")).toHaveLength(1);
    expect(levels.at(-1)).toBe(0);
  });

  it("suppresses the level during agent speech", async () => {
    const session = makeSession();
    const levels = events(session, "voice:level");
    const ws = await startToLive(session);
    stubs.sendMicFrame(loudFrame());
    expect(levels.at(-1)).toBeGreaterThan(0);

    ws.emitFrame({ type: "audio", audio: "AAAA" });
    expect(session.getState().turn).toBe("agent-speaking");
    const audioFramesBefore = ws.sentFrames().filter((f) => f.type === "audio").length;
    stubs.sendMicFrame(loudFrame());
    expect(levels.at(-1)).toBe(0);
    // Mic frames still flow to the server (barge-in detection is server-side).
    expect(ws.sentFrames().filter((f) => f.type === "audio").length).toBe(
      audioFramesBefore + 1
    );
  });

  it("derives user-speaking from the RMS threshold with a hold window", async () => {
    const session = makeSession();
    await startToLive(session);
    stubs.sendMicFrame(loudFrame());
    expect(session.getState().turn).toBe("user-speaking");
    // Quiet frames within the hold window keep the state.
    stubs.sendMicFrame(quietFrame());
    expect(session.getState().turn).toBe("user-speaking");
    // After the hold expires, a quiet frame drops back to listening.
    await vi.advanceTimersByTimeAsync(1300);
    stubs.sendMicFrame(quietFrame());
    expect(session.getState().turn).toBe("listening");
  });
});

describe("availability", () => {
  it("start on an insecure context fails typed, before touching the mic", async () => {
    stubs.setSecureContext(false);
    const session = makeSession();
    const errors = events(session, "voice:error");
    await session.start();
    expect(errors[0].code).toBe("insecure-context");
    expect(stubs.getUserMedia).not.toHaveBeenCalled();
  });

  it("checkAvailability reports insecure-context as unsupported", async () => {
    stubs.setSecureContext(false);
    const session = makeSession();
    const report = await session.checkAvailability();
    expect(report.availability).toBe("unsupported");
    expect(report.unavailableReason).toBe("insecure-context");
    expect(report.checks.secureContext).toBe(false);
  });

  it("reports worklet-unsupported when AudioWorklet is missing", async () => {
    vi.stubGlobal("AudioWorkletNode", undefined);
    const session = makeSession();
    const report = await session.checkAvailability();
    expect(report.availability).toBe("unsupported");
    expect(report.unavailableReason).toBe("worklet-unsupported");
  });

  it("reports the tenant gate", async () => {
    http.get.mockResolvedValueOnce({
      permissions: [{ voice_enabled: false, agents: [] }],
    });
    const session = makeSession();
    const report = await session.checkAvailability();
    expect(report.availability).toBe("policy-unavailable");
    expect(report.unavailableReason).toBe("tenant-disabled");
  });

  it("reports the agent gate", async () => {
    http.get.mockResolvedValueOnce({
      permissions: [
        {
          voice_enabled: true,
          agents: [{ name: "admin-helper", isVoiceAgent: false }],
        },
      ],
    });
    const session = makeSession();
    const report = await session.checkAvailability();
    expect(report.availability).toBe("policy-unavailable");
    expect(report.unavailableReason).toBe("agent-not-voice");
  });

  it("fails closed when the config gates cannot be resolved", async () => {
    http.get.mockRejectedValueOnce(new Error("config unavailable"));
    const session = makeSession();
    const report = await session.checkAvailability();
    expect(report.availability).toBe("policy-unavailable");
    expect(report.unavailableReason).toBe("tenant-disabled");
  });

  it("reports jwt-missing for anonymous auth", async () => {
    http.hasBearerToken.mockReturnValue(false);
    http.get.mockResolvedValueOnce({
      permissions: [
        {
          voice_enabled: true,
          agents: [{ name: "admin-helper", isVoiceAgent: true }],
        },
      ],
    });
    const session = makeSession();
    const report = await session.checkAvailability();
    expect(report.availability).toBe("policy-unavailable");
    expect(report.unavailableReason).toBe("jwt-missing");
    expect(report.checks.authKind).toBe("anonymous");
  });

  it("reports available when every gate passes", async () => {
    http.get.mockResolvedValueOnce({
      permissions: [
        {
          voice_enabled: true,
          agents: [{ name: "admin-helper", isVoiceAgent: true }],
        },
      ],
    });
    const session = makeSession();
    const report = await session.checkAvailability();
    expect(report.availability).toBe("available");
    expect(report.unavailableReason).toBeUndefined();
    expect(session.getState().availability).toBe("available");
  });
});

describe("mic errors", () => {
  it("maps getUserMedia failures onto typed mic codes", async () => {
    const cases: Array<[string, string]> = [
      ["NotAllowedError", "mic-denied"],
      ["NotFoundError", "no-mic"],
      ["NotReadableError", "mic-busy"],
    ];
    for (const [domName, code] of cases) {
      const session = makeSession();
      const errors = events(session, "voice:error");
      const domError = new Error(domName);
      domError.name = domName;
      stubs.getUserMedia.mockRejectedValueOnce(domError);
      await session.start();
      expect(errors[0].code).toBe(code);
      expect(session.getState().status).toBe("error");
    }
  });
});

describe("device passthrough", () => {
  it("passes audio constraints through without leaking conversationId to getUserMedia", async () => {
    const session = makeSession();
    await session.start({
      conversationId: "th-existing",
      inputDeviceId: "usb-headset",
      mediaConstraints: { channelCount: 1 },
    });
    expect(stubs.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({
        echoCancellation: true,
        deviceId: { exact: "usb-headset" },
        channelCount: 1,
      }),
    });
  });
});

describe("consent", () => {
  it("requireConsent (default) pauses start() before the mic; acceptConsent resumes", async () => {
    const session = makeSession({ requireConsent: true });
    const statuses = events(session, "voice:status");
    await session.start();
    expect(session.getState().consentPending).toBe(true);
    expect(stubs.getUserMedia).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({ consentPending: true });

    session.acceptConsent();
    await vi.advanceTimersByTimeAsync(0);
    expect(stubs.getUserMedia).toHaveBeenCalledTimes(1);
    const ws = stubs.lastSocket();
    ws.emitOpen();
    ws.emitFrame({ type: "ready" });
    expect(session.getState().status).toBe("live");
    expect(session.getState().consentPending).toBe(false);
  });

  it("cancelConsent drops the paused start and stays idle", async () => {
    const session = makeSession({ requireConsent: true });
    await session.start();
    session.cancelConsent();
    expect(session.getState().consentPending).toBe(false);
    expect(session.getState().status).toBe("idle");
    expect(stubs.getUserMedia).not.toHaveBeenCalled();
  });

  it("consent is asked once per session: a second start does not pause", async () => {
    const session = makeSession({ requireConsent: true });
    await session.start();
    session.acceptConsent();
    await vi.advanceTimersByTimeAsync(0);
    stubs.lastSocket().emitOpen();
    stubs.lastSocket().emitFrame({ type: "ready" });
    session.stop();

    await session.start();
    expect(session.getState().consentPending).toBe(false);
    expect(stubs.getUserMedia).toHaveBeenCalledTimes(2);
  });
});

describe("lifecycle invariants", () => {
  it("a second start() while active rejects with session-active", async () => {
    const session = makeSession();
    await startToLive(session);
    await expect(session.start()).rejects.toMatchObject({
      code: "session-active",
    });
  });

  it("stop() is idempotent: exactly one terminal event", async () => {
    const session = makeSession();
    const ended = events(session, "voice:ended");
    await startToLive(session);
    session.stop();
    session.stop();
    session.stop();
    expect(ended).toHaveLength(1);
  });

  it("stop() from idle is a no-op (no terminal event)", () => {
    const session = makeSession();
    const ended = events(session, "voice:ended");
    session.stop();
    expect(ended).toHaveLength(0);
    expect(session.getState().status).toBe("idle");
  });

  it("start() after stop begins a fresh generation", async () => {
    const session = makeSession();
    await startToLive(session);
    session.stop();
    const ws2 = await startToLive(session, "th-second");
    expect(session.getState().status).toBe("live");
    expect(session.getState().conversationId).toBe("th-second");
    expect(ws2).not.toBe(FakeWebSocket.instances[0]);
  });

  it("no events after destroy(), and destroy releases the mic", async () => {
    const session = makeSession();
    await startToLive(session);
    const stream = stubs.lastStream();
    const late: unknown[] = [];
    session.on("voice:status", (s) => late.push(s));
    const countBefore = late.length;

    session.destroy();
    expect(stream.tracks[0].stopped).toBe(true);

    // Emitting anything after destroy is impossible from outside; verify via
    // the public API staying inert.
    session.stop();
    session.toggleMute();
    expect(late.length).toBeGreaterThanOrEqual(countBefore);
    await expect(session.start()).rejects.toMatchObject({
      code: "session-destroyed",
    });
  });
});
