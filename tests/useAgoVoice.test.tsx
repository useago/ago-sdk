import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgoProvider } from "../src/react/context/AgoContext";
import {
  useAgoVoice,
  type UseAgoVoiceResult,
} from "../src/react/hooks/useAgoVoice";
import {
  createMockClient,
  mockVoiceConversation,
  type MockAgoClient,
} from "../src/testing";
import { AgoVoiceError } from "../src/voice/errors";

// React's act() requires this flag outside of @testing-library.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function mountHook(
  client: MockAgoClient,
  { strict = false }: { strict?: boolean } = {}
) {
  const holder: { current: UseAgoVoiceResult | null } = { current: null };
  function Harness() {
    holder.current = useAgoVoice();
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  const tree = (
    <AgoProvider client={client}>
      <Harness />
    </AgoProvider>
  );
  await act(async () => {
    root.render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
  });
  return { root, container, result: () => holder.current! };
}

describe("useAgoVoice — subscription", () => {
  it("returns the exact UseAgoVoiceResult surface", async () => {
    const client = createMockClient();
    const { result } = await mountHook(client);

    const voice = result();
    expect(voice.availability).toBe("available");
    expect(voice.status).toBe("idle");
    expect(voice.turn).toBe("listening");
    expect(voice.muted).toBe(false);
    expect(voice.degraded).toBe(false);
    expect(voice.consentPending).toBe(false);
    expect(voice.captions).toEqual([]);
    expect(voice.level).toBe(0);
    expect(voice.error).toBeUndefined();
    expect(voice.endedReason).toBeUndefined();
    expect(voice.conversationId).toBeUndefined();
    for (const fn of [
      voice.start,
      voice.stop,
      voice.toggleMute,
      voice.acceptConsent,
      voice.cancelConsent,
      voice.retry,
      voice.dismissError,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("re-renders on session events (status, captions, level)", async () => {
    const client = createMockClient();
    const { result } = await mountHook(client);

    await act(async () => {
      client.voice.__setVoiceState({
        status: "live",
        turn: "agent-speaking",
        captions: [{ role: "assistant", text: "Hello", final: false }],
        level: 0.4,
      });
    });

    expect(result().status).toBe("live");
    expect(result().turn).toBe("agent-speaking");
    expect(result().captions[0]?.text).toBe("Hello");
    // Level updates ride the voice:level event.
    await act(async () => {
      client.voice.__setVoiceState({ level: 0.8 });
      client.voice.__emitVoiceEvent("voice:level", 0.8);
    });
    expect(result().level).toBe(0.8);
  });

  it("does not own the session: unmounting does not stop a live call", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const handle = mockVoiceConversation(client, {
      turns: [{ user: "hi", assistant: "hello there" }],
    });
    await handle.play();
    await vi.advanceTimersByTimeAsync(700);
    expect(client.voice.getState().status).toBe("live");

    const { root } = await mountHook(client);
    await act(async () => root.unmount());

    expect(client.__callsFor("voice.stop")).toHaveLength(0);
    expect(client.voice.getState().status).toBe("live");
  });
});

describe("useAgoVoice — StrictMode", () => {
  it("revive re-subscribes without killing a live call (both phases)", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    mockVoiceConversation(client, {
      turns: [{ user: "hi", assistant: "streamed reply text here" }],
    });
    // The call is live BEFORE mounting: the controller owns it, not the hook.
    await client.voice.start();
    client.voice.acceptConsent();
    await vi.advanceTimersByTimeAsync(700);
    expect(client.voice.getState().status).toBe("live");

    // StrictMode mounts, simulates unmount, and remounts: the cleanup of the
    // first phase must not stop the session, and the second phase must be
    // subscribed again.
    const { result } = await mountHook(client, { strict: true });
    expect(client.__callsFor("voice.stop")).toHaveLength(0);
    expect(result().status).toBe("live");

    // Events emitted after the remount still reach the hook: the second
    // phase's subscription is live.
    await act(async () => {
      client.voice.__setVoiceState({ turn: "agent-thinking" });
    });
    expect(result().turn).toBe("agent-thinking");
  });
});

describe("useAgoVoice — availability warning", () => {
  it("warns once, naming the failed gate and fix, when policy-unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = createMockClient({
      voice: {
        availability: "policy-unavailable",
        unavailableReason: "tenant-disabled",
      },
    });

    // Two components mount the hook against the same client: one warning.
    const holder: { a?: UseAgoVoiceResult; b?: UseAgoVoiceResult } = {};
    function A() {
      holder.a = useAgoVoice();
      return null;
    }
    function B() {
      holder.b = useAgoVoice();
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <A />
          <B />
        </AgoProvider>
      );
    });

    const voiceWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes("[AGO] voice")
    );
    expect(voiceWarnings).toHaveLength(1);
    expect(String(voiceWarnings[0][0])).toContain("tenant-disabled");
    expect(String(voiceWarnings[0][0])).toContain("Ask AGO to enable voice");
    expect(holder.a?.availability).toBe("policy-unavailable");
    expect(holder.a?.unavailableReason).toBe("tenant-disabled");
  });

  it("warns for unsupported environments too (insecure-context)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = createMockClient({
      voice: {
        availability: "unsupported",
        unavailableReason: "insecure-context",
      },
    });
    await mountHook(client);
    const voiceWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes("[AGO] voice")
    );
    expect(voiceWarnings).toHaveLength(1);
    expect(String(voiceWarnings[0][0])).toContain("HTTPS");
  });

  it("does not warn when voice is available", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = createMockClient();
    await mountHook(client);
    const voiceWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes("[AGO] voice")
    );
    expect(voiceWarnings).toHaveLength(0);
  });
});

describe("useAgoVoice — error handling", () => {
  it("dismissError hides the error and presents idle; retry restarts with the last options", async () => {
    const client = createMockClient({ voice: { requireConsent: false } });
    const { result } = await mountHook(client);

    await act(async () => {
      await result().start({ inputDeviceId: "headset-1" });
    });
    await act(async () => {
      client.voice.stop();
    });
    await act(async () => {
      client.voice.__setVoiceState({
        status: "error",
        error: new AgoVoiceError("mint-failed"),
      });
    });
    expect(result().status).toBe("error");
    expect(result().error?.code).toBe("mint-failed");

    await act(async () => {
      result().dismissError();
    });
    expect(result().status).toBe("idle");
    expect(result().error).toBeUndefined();

    await act(async () => {
      result().retry();
    });
    const starts = client.__callsFor("voice.start");
    expect(starts).toHaveLength(2);
    // retry() reuses the options of the last start().
    expect(starts[1].args[0]).toEqual({ inputDeviceId: "headset-1" });
  });
});
