import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgoVoiceBar } from "../src/react/components/AgoVoiceBar";
import { AgoVoiceButton } from "../src/react/components/AgoVoiceButton";
import { AgoVoiceCaptions } from "../src/react/components/AgoVoiceCaptions";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useAgoVoice } from "../src/react/hooks/useAgoVoice";
import { createMockClient, mockVoiceConversation } from "../src/testing";
import type { VoicePersistedAck } from "../src/voice/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function VoicePanel() {
  const voice = useAgoVoice();
  return (
    <div>
      <AgoVoiceButton voice={voice} />
      <AgoVoiceBar voice={voice} data-testid="bar" />
      <AgoVoiceCaptions voice={voice} data-testid="captions" />
    </div>
  );
}

describe("mockVoiceConversation — full lifecycle in jsdom", () => {
  it("drives consent, permission, connecting, live turns with captions and acks, then ended", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const handle = mockVoiceConversation(client, {
      turns: [
        {
          user: "Where is my order?",
          assistant: "Order 1042 shipped this morning and arrives Thursday.",
        },
      ],
      stepMs: 100,
      conversationId: "conv-42",
    });

    const persisted: VoicePersistedAck[] = [];
    client.on("voice:persisted", (ack) => persisted.push(ack));
    const threadReady = vi.fn();
    client.on("voice:thread-ready", threadReady);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <AgoProvider client={client}>
          <VoicePanel />
        </AgoProvider>
      );
    });
    const bar = () =>
      container.querySelector<HTMLElement>('[data-testid="bar"]');
    const captions = () =>
      container.querySelector<HTMLElement>('[data-testid="captions"]');

    // Consent through the button, exactly like a user would.
    await act(async () => {
      container
        .querySelector<HTMLElement>("[data-ago-voice-button]")!
        .click();
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      container
        .querySelector<HTMLElement>(".ago-voice-consent-accept")!
        .click();
    });

    // requesting-permission, then connecting, then live.
    expect(bar()!.textContent).toContain("Waiting for microphone…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(bar()!.textContent).toContain("Connecting…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(client.voice.getState().status).toBe("live");
    expect(threadReady).toHaveBeenCalledWith({ threadId: "conv-42" });

    // User speaking: level pulses drive the meter, indicator shows in captions.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(bar()!.querySelector('[role="meter"]')).not.toBeNull();
    expect(captions()!.querySelector(".ago-voice-captions-user")).not.toBeNull();

    // User final lands: persisted ack, agent thinking.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      messageId: "mock-voice-user-1",
      role: "user",
      threadId: "conv-42",
    });
    expect(bar()!.textContent).toContain("Thinking…");

    // Assistant streams its caption into the captions region (never the bar).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const partial = captions()!.querySelector(
      ".ago-voice-captions-assistant"
    )!.textContent!;
    expect(partial.length).toBeGreaterThan(0);
    expect(
      "Order 1042 shipped this morning and arrives Thursday.".startsWith(partial)
    ).toBe(true);
    expect(bar()!.textContent).not.toContain("Order 1042");

    // Remaining assistant chunks, then the final caption + persisted ack.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(persisted).toHaveLength(2);
    expect(persisted[1]).toMatchObject({
      messageId: "mock-voice-assistant-1",
      role: "assistant",
    });

    // The scripted call ends.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await handle.finished;
    expect(bar()!.textContent).toContain("Call ended");

    // The bar fades and focus returns to the mic button.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector("[data-ago-voice-button]")
    );
  });

  it("play() drives the same lifecycle programmatically (no UI needed)", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const handle = mockVoiceConversation(client, {
      turns: [
        { user: "hi", assistant: "hello" },
        { user: "thanks", assistant: "any time" },
      ],
      stepMs: 50,
    });

    const finals: string[] = [];
    client.on("voice:turn-final", (caption) =>
      finals.push(`${caption.role}:${caption.text}`)
    );

    await handle.play();
    await vi.advanceTimersByTimeAsync(5000);
    await handle.finished;

    expect(finals).toEqual([
      "user:hi",
      "assistant:hello",
      "user:thanks",
      "assistant:any time",
    ]);
    expect(client.voice.getState().status).toBe("ended");
    expect(client.voice.getState().endedReason).toBe("ended");
  });

  it("stop() mid-script ends cleanly and resolves finished", async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const handle = mockVoiceConversation(client, {
      turns: [{ user: "hi", assistant: "hello" }],
      stepMs: 100,
    });
    await handle.play();
    await vi.advanceTimersByTimeAsync(250);
    client.voice.stop();
    await handle.finished;
    expect(client.voice.getState().status).toBe("ended");
    expect(client.voice.getState().endedReason).toBe("stopped");
    // No stray timers keep mutating state afterwards.
    const after = client.voice.getState();
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.voice.getState()).toEqual(after);
  });
});
