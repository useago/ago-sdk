import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import type { VoiceStatusEvent } from "../src/voice/types";
import {
  FakeWebSocket,
  installVoiceStubs,
  type VoiceStubs,
} from "./helpers/voiceStubs";

let stubs: VoiceStubs;

function mintResponse() {
  return new Response(
    JSON.stringify({ token: "tok-1", wsUrl: "wss://voice.test/v1/voice" }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function makeClient(): AgoClient {
  return new AgoClient({
    baseUrl: "https://tenant.api.useago.com",
    agent: "admin-helper",
    userJwt: "jwt-1",
    voice: { requireConsent: false },
  });
}

async function startToLive(client: AgoClient): Promise<FakeWebSocket> {
  await client.voice.start();
  const ws = stubs.lastSocket();
  ws.emitOpen();
  ws.emitFrame({ type: "ready", threadId: "th-1" });
  return ws;
}

beforeEach(() => {
  stubs = installVoiceStubs();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => mintResponse())
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  stubs.restore();
  vi.restoreAllMocks();
});

describe("client.voice", () => {
  it("is a lazy singleton controller", () => {
    const client = makeClient();
    const voice = client.voice;
    expect(client.voice).toBe(voice);
    expect(voice.getState().status).toBe("idle");
    expect(voice.getState().availability).toBe("loading");
    client.destroy();
  });

  it("touching client.voice does not hit the network or browser APIs", () => {
    const client = makeClient();
    void client.voice;
    void client.voice.getState();
    expect(fetch).not.toHaveBeenCalled();
    expect(stubs.getUserMedia).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
    client.destroy();
  });

  it("runs a session end to end and forwards voice:* events onto the client emitter", async () => {
    const client = makeClient();
    const statuses: VoiceStatusEvent[] = [];
    const threads: Array<{ threadId: string }> = [];
    client.on("voice:status", (s) => statuses.push(s));
    client.on("voice:thread-ready", (t) => threads.push(t));

    await startToLive(client);

    expect(statuses.map((s) => s.status)).toContain("live");
    expect(threads).toEqual([{ threadId: "th-1" }]);
    // The mint rode the shared HttpClient with auth headers.
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://tenant.api.useago.com/api/sdk/v1/voice/mint-session-token"
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer jwt-1"
    );
    client.destroy();
  });

  it("a second start() while a session is active refuses with session-active", async () => {
    const client = makeClient();
    await startToLive(client);
    await expect(client.voice.start()).rejects.toMatchObject({
      code: "session-active",
    });
    client.destroy();
  });

  it("client.destroy() stops the live session and releases the mic", async () => {
    const client = makeClient();
    await startToLive(client);
    const stream = stubs.lastStream();
    expect(stream.tracks[0].stopped).toBe(false);

    client.destroy();
    await vi.waitFor(() => {
      expect(stream.tracks[0].stopped).toBe(true);
    });
    expect(stubs.lastSocket().closeCalled).toBe(true);
  });

  it("voice stays usable after destroy + reviveAfterDestroy (StrictMode)", async () => {
    const client = makeClient();
    const first = client.voice;
    await startToLive(client);

    client.destroy();
    client.reviveAfterDestroy();

    const revived = client.voice;
    expect(revived).not.toBe(first);
    expect(revived.getState().status).toBe("idle");
    await startToLive(client);
    expect(revived.getState().status).toBe("live");
    client.destroy();
  });

  it("stop() before the engine finished loading still cancels the start", async () => {
    const client = makeClient();
    const startPromise = client.voice.start();
    client.voice.stop();
    await startPromise.catch(() => undefined);
    await vi.waitFor(() => {
      // Whatever progress start() made, no socket survives a stop.
      for (const ws of FakeWebSocket.instances) {
        expect(ws.closeCalled || ws.readyState === FakeWebSocket.CLOSED).toBe(
          true
        );
      }
    });
    client.destroy();
  });

  it("checkAvailability() is reachable from the facade", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const client = makeClient();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          permissions: [
            {
              voice_enabled: true,
              agents: [{ name: "admin-helper", isVoiceAgent: true }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const report = await client.voice.checkAvailability();
    expect(report.availability).toBe("available");
    expect(report.checks.authKind).toBe("jwt");
    client.destroy();
  });

  it("rechecks availability when an async user JWT reaches the client", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const configResponse = () =>
      new Response(
        JSON.stringify({
          permissions: [
            {
              voice_enabled: true,
              agents: [{ name: "admin-helper", isVoiceAgent: true }],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      configResponse()
    );
    const client = new AgoClient({
      baseUrl: "https://tenant.api.useago.com",
      agent: "admin-helper",
      voice: { requireConsent: false },
    });

    const initial = await client.voice.checkAvailability();
    expect(initial.unavailableReason).toBe("jwt-missing");

    client.updateConfig({ userJwt: "jwt-after-mount" });

    await vi.waitFor(() => {
      expect(client.voice.getState().availability).toBe("available");
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    client.destroy();
  });
});
