import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgoVoiceCaptions } from "../src/react/components/AgoVoiceCaptions";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useAgoVoice } from "../src/react/hooks/useAgoVoice";
import { createMockClient, type MockAgoClient } from "../src/testing";
import type { VoiceSessionState } from "../src/voice/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

async function mountCaptions(client: MockAgoClient) {
  function Rig() {
    const voice = useAgoVoice();
    return <AgoVoiceCaptions voice={voice} data-testid="captions" />;
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
  const captions = () =>
    container.querySelector<HTMLElement>('[data-testid="captions"]');
  return { container, set, captions };
}

describe("AgoVoiceCaptions", () => {
  it("renders nothing while idle", async () => {
    const client = createMockClient();
    const { captions } = await mountCaptions(client);
    expect(captions()).toBeNull();
  });

  it("streams the assistant's partial caption in an aria-live=off region", async () => {
    const client = createMockClient();
    const { set, captions } = await mountCaptions(client);
    await set({
      status: "live",
      turn: "agent-speaking",
      captions: [{ role: "assistant", text: "Your order shipped", final: false }],
    });
    const el = captions();
    expect(el).not.toBeNull();
    expect(el!.getAttribute("aria-live")).toBe("off");
    expect(
      el!.querySelector(".ago-voice-captions-assistant")!.textContent
    ).toBe("Your order shipped");
  });

  it("shows the user speaking indicator instead of user text (user captions are final-only)", async () => {
    const client = createMockClient();
    const { set, captions } = await mountCaptions(client);
    await set({
      status: "live",
      turn: "user-speaking",
      // Even if a user partial ever appeared in state, it is never rendered.
      captions: [{ role: "user", text: "USER-PARTIAL", final: false }],
    });
    const el = captions();
    expect(el).not.toBeNull();
    expect(el!.querySelector(".ago-voice-captions-user")).not.toBeNull();
    expect(el!.querySelectorAll(".ago-voice-dot")).toHaveLength(3);
    expect(el!.textContent).not.toContain("USER-PARTIAL");
  });

  it("keeps captions on screen through a reconnect", async () => {
    const client = createMockClient();
    const { set, captions } = await mountCaptions(client);
    await set({
      status: "reconnecting",
      captions: [{ role: "assistant", text: "kept through reconnect", final: false }],
    });
    expect(captions()!.textContent).toContain("kept through reconnect");
  });

  it("clears when the session ends", async () => {
    const client = createMockClient();
    const { set, captions } = await mountCaptions(client);
    await set({
      status: "live",
      turn: "agent-speaking",
      captions: [{ role: "assistant", text: "bye", final: false }],
    });
    expect(captions()).not.toBeNull();
    await set({ status: "ended" });
    expect(captions()).toBeNull();
  });
});
