import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgoVoiceBar } from "../src/react/components/AgoVoiceBar";
import { AgoVoiceButton } from "../src/react/components/AgoVoiceButton";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useAgoVoice } from "../src/react/hooks/useAgoVoice";
import { createMockClient, type MockAgoClient } from "../src/testing";
import { AgoVoiceError } from "../src/voice/errors";
import type { VoiceSessionState, VoiceStatus } from "../src/voice/types";

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

async function mountBar(
  client: MockAgoClient,
  {
    withButton = false,
    labels,
  }: { withButton?: boolean; labels?: Record<string, string> } = {}
) {
  function Rig() {
    const voice = useAgoVoice();
    return (
      <>
        {withButton && <AgoVoiceButton voice={voice} />}
        <AgoVoiceBar voice={voice} labels={labels} data-testid="bar" />
      </>
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <AgoProvider client={client}>
        <Rig />
      </AgoProvider>
    );
  });
  const set = async (partial: Partial<VoiceSessionState>) => {
    await act(async () => {
      client.voice.__setVoiceState(partial);
    });
  };
  const bar = () => container.querySelector<HTMLElement>('[data-testid="bar"]');
  return { container, set, bar };
}

describe("AgoVoiceBar — state x UI matrix", () => {
  it("renders nothing while idle", async () => {
    const client = createMockClient();
    const { bar } = await mountBar(client);
    expect(bar()).toBeNull();
  });

  it("requesting-permission: waiting copy, Cancel, no End yet", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);
    await set({ status: "requesting-permission" });
    expect(bar()!.textContent).toContain("Waiting for microphone…");
    expect(bar()!.querySelector(".ago-voice-cancel")).not.toBeNull();
    expect(bar()!.querySelector(".ago-voice-end")).toBeNull();
  });

  it("connecting: spinner, copy, End", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);
    await set({ status: "connecting" });
    expect(bar()!.textContent).toContain("Connecting…");
    expect(bar()!.querySelector(".ago-voice-spinner")).not.toBeNull();
    expect(bar()!.querySelector(".ago-voice-end")).not.toBeNull();
  });

  it("live meter shows only while the user is the speaker, and reflects the level", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);

    await set({ status: "live", turn: "user-speaking", level: 0.5 });
    const meter = bar()!.querySelector<HTMLElement>('[role="meter"]');
    expect(meter).not.toBeNull();
    expect(meter!.getAttribute("aria-valuenow")).toBe("50");
    expect(meter!.getAttribute("aria-valuemin")).toBe("0");
    expect(meter!.getAttribute("aria-valuemax")).toBe("100");

    await set({ turn: "agent-speaking" });
    expect(bar()!.querySelector('[role="meter"]')).toBeNull();
  });

  it("never renders transcript text (captions belong to the message list)", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);
    await set({
      status: "live",
      turn: "agent-speaking",
      captions: [
        { role: "assistant", text: "SECRET-CAPTION-TEXT", final: false },
      ],
    });
    expect(bar()!.textContent).not.toContain("SECRET-CAPTION-TEXT");
    expect(bar()!.textContent).toContain("Speaking");
  });

  it("muted: MicOff copy, Unmute + End, no meter", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);
    await set({ status: "live", turn: "listening", muted: true });
    expect(bar()!.textContent).toContain("Muted");
    expect(bar()!.querySelector(".ago-voice-unmute")).not.toBeNull();
    expect(bar()!.querySelector(".ago-voice-mute")).toBeNull();
    expect(bar()!.querySelector('[role="meter"]')).toBeNull();
    expect(bar()!.querySelector(".ago-voice-end")).not.toBeNull();
  });

  it("reconnecting: copy and End stays actionable", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);
    await set({ status: "reconnecting" });
    expect(bar()!.textContent).toContain("Reconnecting…");
    const end = bar()!.querySelector<HTMLButtonElement>(".ago-voice-end");
    expect(end).not.toBeNull();
    await act(async () => end!.click());
    expect(client.__callsFor("voice.stop")).toHaveLength(1);
  });

  it("degraded: sub-line under the turn status, Mute + End", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);
    await set({ status: "live", turn: "listening", degraded: true });
    expect(bar()!.querySelector(".ago-voice-degraded")!.textContent).toBe(
      "Connection degraded"
    );
    expect(bar()!.textContent).toContain("Listening");
    expect(bar()!.querySelector(".ago-voice-mute")).not.toBeNull();
    expect(bar()!.querySelector(".ago-voice-end")).not.toBeNull();
  });

  it("error replaces bar content: message, Retry primary, icon dismiss; retry restarts", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);
    await set({
      status: "error",
      error: new AgoVoiceError("mic-denied"),
    });
    expect(bar()!.textContent).toContain("Microphone blocked");
    // The docs pointer is stripped from the UI copy.
    expect(bar()!.textContent).not.toContain("http");
    expect(bar()!.querySelector(".ago-voice-end")).toBeNull();
    expect(bar()!.querySelector('[role="meter"]')).toBeNull();

    const retry = bar()!.querySelector<HTMLButtonElement>(".ago-voice-retry");
    expect(retry).not.toBeNull();
    await act(async () => retry!.click());
    expect(client.__callsFor("voice.start")).toHaveLength(1);
  });

  it("per-error copy is overridable through labels", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client, {
      labels: { "error-mic-denied": "Micro bloque, autorisez-le puis reessayez" },
    });
    await set({ status: "error", error: new AgoVoiceError("mic-denied") });
    expect(bar()!.textContent).toContain(
      "Micro bloque, autorisez-le puis reessayez"
    );
  });

  it("dismiss clears the error, unmounts the bar and returns focus to the mic button", async () => {
    const client = createMockClient();
    const { set, bar, container } = await mountBar(client, {
      withButton: true,
    });
    await set({ status: "error", error: new AgoVoiceError("mint-failed") });
    const dismiss = bar()!.querySelector<HTMLButtonElement>(
      ".ago-voice-dismiss"
    );
    expect(dismiss).not.toBeNull();
    expect(dismiss!.getAttribute("aria-label")).toBe("Dismiss");
    await act(async () => dismiss!.click());
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector("[data-ago-voice-button]")
    );
  });

  it('ended: "Call ended" for ~1.2s, then the bar goes away and focus returns to the button', async () => {
    vi.useFakeTimers();
    const client = createMockClient();
    const { set, bar, container } = await mountBar(client, {
      withButton: true,
    });
    await set({ status: "ended", endedReason: "stopped" });
    expect(bar()!.textContent).toContain("Call ended");
    expect(bar()!.className).toContain("ago-voice-bar-ended");
    // No controls in the ended state.
    expect(bar()!.querySelector("button")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(bar()).toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector("[data-ago-voice-button]")
    );
  });

  it("unknown future status renders as a generic status with End (no crash)", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);
    await set({ status: "hologram" as VoiceStatus });
    expect(bar()).not.toBeNull();
    expect(bar()!.textContent).toContain("hologram");
    expect(bar()!.querySelector(".ago-voice-end")).not.toBeNull();
  });

  it("status labels are overridable", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client, {
      labels: { connecting: "Numerotation" },
    });
    await set({ status: "connecting" });
    expect(bar()!.textContent).toContain("Numerotation");
  });
});

describe("AgoVoiceBar — a11y", () => {
  it("the status region is role=status aria-live=polite and carries state only", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);
    await set({
      status: "live",
      turn: "agent-speaking",
      captions: [{ role: "assistant", text: "TRANSCRIPT", final: false }],
    });
    const status = bar()!.querySelector<HTMLElement>('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.getAttribute("aria-live")).toBe("polite");
    expect(status!.textContent).not.toContain("TRANSCRIPT");
  });

  it("focus moves to End when the call starts", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);
    await set({ status: "requesting-permission" });
    await set({ status: "connecting" });
    expect(document.activeElement).toBe(
      bar()!.querySelector(".ago-voice-end")
    );
  });

  it("Esc ends the call while one is active", async () => {
    const client = createMockClient();
    const { set } = await mountBar(client);
    await set({ status: "live", turn: "listening" });
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(client.__callsFor("voice.stop")).toHaveLength(1);
  });

  it("Esc does nothing when no call is active", async () => {
    const client = createMockClient();
    await mountBar(client);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(client.__callsFor("voice.stop")).toHaveLength(0);
  });

  it("every control is at least 44px", async () => {
    const client = createMockClient();
    const { set, bar } = await mountBar(client);
    await set({ status: "live", turn: "listening" });
    const buttons = bar()!.querySelectorAll<HTMLButtonElement>("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.style.minHeight).toBe("44px");
      expect(button.style.minWidth).toBe("44px");
    }
  });
});
