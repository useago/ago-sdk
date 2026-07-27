import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgoVoiceButton } from "../src/react/components/AgoVoiceButton";
import type { AgoVoiceButtonProps } from "../src/react/components/AgoVoiceButton";
import { AgoProvider } from "../src/react/context/AgoContext";
import { useAgoVoice } from "../src/react/hooks/useAgoVoice";
import { createMockClient, type MockAgoClient } from "../src/testing";

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

type RigProps = Omit<AgoVoiceButtonProps, "voice">;

async function mountButton(client: MockAgoClient, props: RigProps = {}) {
  function Rig(rigProps: RigProps) {
    const voice = useAgoVoice();
    return <AgoVoiceButton voice={voice} {...rigProps} />;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <AgoProvider client={client}>
        <Rig {...props} />
      </AgoProvider>
    );
  });
  return { container };
}

function click(el: Element | null) {
  expect(el).not.toBeNull();
  (el as HTMLElement).click();
}

describe("AgoVoiceButton — gating", () => {
  it("renders nothing while availability is not available (never a dangling mic)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = createMockClient({
      voice: {
        availability: "policy-unavailable",
        unavailableReason: "agent-not-voice",
      },
    });
    const { container } = await mountButton(client);
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders the mic when voice is available, with a >=44px target and a focus-ring class", async () => {
    const client = createMockClient();
    const { container } = await mountButton(client);
    const button = container.querySelector<HTMLButtonElement>(
      "[data-ago-voice-button]"
    );
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe("Start voice call");
    expect(button!.getAttribute("aria-pressed")).toBe("false");
    expect(button!.style.minWidth).toBe("44px");
    expect(button!.style.minHeight).toBe("44px");
    expect(button!.className).toContain("ago-voice-focusable");
    // The scoped stylesheet is injected once, SSR-guarded and idempotent.
    expect(document.getElementById("ago-voice-styles")).not.toBeNull();
  });
});

describe("AgoVoiceButton — consent flow (default true)", () => {
  it("first click pauses on the built-in disclosure instead of starting the mic", async () => {
    const client = createMockClient();
    const { container } = await mountButton(client);

    await act(async () => {
      click(container.querySelector("[data-ago-voice-button]"));
    });

    expect(client.voice.getState().consentPending).toBe(true);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Start a voice call?");
    const accept = container.querySelector<HTMLButtonElement>(
      ".ago-voice-consent-accept"
    );
    const cancel = container.querySelector<HTMLButtonElement>(
      ".ago-voice-consent-cancel"
    );
    expect(accept).not.toBeNull();
    expect(cancel).not.toBeNull();
    expect(accept!.style.minHeight).toBe("44px");
    expect(cancel!.style.minHeight).toBe("44px");
    // Focus moves into the disclosure so keyboard users can act on it.
    expect(document.activeElement).toBe(accept);
  });

  it("anchors the built-in disclosure to the inline end of the mic", async () => {
    const client = createMockClient();
    const { container } = await mountButton(client);

    await act(async () => {
      click(container.querySelector("[data-ago-voice-button]"));
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.style.insetInlineEnd).toBe("0");
    expect(dialog!.style.insetInlineStart).toBe("");
  });

  it("accept starts the session; the disclosure closes", async () => {
    const client = createMockClient();
    const { container } = await mountButton(client);
    await act(async () => {
      click(container.querySelector("[data-ago-voice-button]"));
    });
    await act(async () => {
      click(container.querySelector(".ago-voice-consent-accept"));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(client.voice.getState().status).toBe("requesting-permission");
  });

  it("cancel drops the paused start and returns focus to the button", async () => {
    const client = createMockClient();
    const { container } = await mountButton(client);
    await act(async () => {
      click(container.querySelector("[data-ago-voice-button]"));
    });
    await act(async () => {
      click(container.querySelector(".ago-voice-consent-cancel"));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(client.voice.getState().status).toBe("idle");
    expect(client.voice.getState().consentPending).toBe(false);
    expect(document.activeElement).toBe(
      container.querySelector("[data-ago-voice-button]")
    );
  });

  it("consent labels are overridable", async () => {
    const client = createMockClient();
    const { container } = await mountButton(client, {
      labels: {
        "consent-title": "Parler avec l'assistant ?",
        "consent-accept": "Demarrer",
        "consent-cancel": "Annuler",
      },
    });
    await act(async () => {
      click(container.querySelector("[data-ago-voice-button]"));
    });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog!.textContent).toContain("Parler avec l'assistant ?");
    expect(
      container.querySelector(".ago-voice-consent-accept")!.textContent
    ).toBe("Demarrer");
    expect(
      container.querySelector(".ago-voice-consent-cancel")!.textContent
    ).toBe("Annuler");
  });

  it("renderConsent replaces the built-in disclosure", async () => {
    const client = createMockClient();
    const { container } = await mountButton(client, {
      renderConsent: ({ accept, cancel }) => (
        <div data-testid="custom-consent">
          <button type="button" onClick={accept}>
            yes
          </button>
          <button type="button" onClick={cancel}>
            no
          </button>
        </div>
      ),
    });
    await act(async () => {
      click(container.querySelector("[data-ago-voice-button]"));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const custom = container.querySelector('[data-testid="custom-consent"]');
    expect(custom).not.toBeNull();
    await act(async () => {
      click(custom!.querySelectorAll("button")[0]);
    });
    expect(client.voice.getState().status).toBe("requesting-permission");
  });

  it("starts without a disclosure when requireConsent is false", async () => {
    const client = createMockClient({ voice: { requireConsent: false } });
    const { container } = await mountButton(client);
    await act(async () => {
      click(container.querySelector("[data-ago-voice-button]"));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(client.voice.getState().status).toBe("requesting-permission");
  });
});

describe("AgoVoiceButton — active call and prop forwarding", () => {
  it("acts as an end-call toggle while the session is active", async () => {
    const client = createMockClient({ voice: { requireConsent: false } });
    const { container } = await mountButton(client);
    await act(async () => {
      click(container.querySelector("[data-ago-voice-button]"));
    });
    const button = container.querySelector<HTMLButtonElement>(
      "[data-ago-voice-button]"
    )!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("End call");
    await act(async () => {
      click(button);
    });
    expect(client.__callsFor("voice.stop")).toHaveLength(1);
  });

  it("forwards className, style, id, data-*, aria-* and ref to the button", async () => {
    const client = createMockClient();
    const ref = React.createRef<HTMLButtonElement>();
    function Rig() {
      const voice = useAgoVoice();
      return (
        <AgoVoiceButton
          voice={voice}
          ref={ref}
          id="my-mic"
          className="host-class"
          style={{ marginInlineStart: "4px" }}
          data-testid="mic"
          aria-label="Talk to the assistant"
        />
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
    const button = container.querySelector<HTMLButtonElement>("#my-mic");
    expect(button).not.toBeNull();
    expect(button!.className).toContain("host-class");
    expect(button!.style.marginInlineStart).toBe("4px");
    expect(button!.getAttribute("data-testid")).toBe("mic");
    expect(button!.getAttribute("aria-label")).toBe("Talk to the assistant");
    expect(ref.current).toBe(button);
  });
});
