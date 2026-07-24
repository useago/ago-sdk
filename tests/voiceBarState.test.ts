import { describe, it, expect } from "vitest";
import { resolveBarState } from "../src/voice/types";
import type { VoiceStatus, VoiceTurn } from "../src/voice/types";

const OFF = { muted: false, degraded: false };

describe("resolveBarState", () => {
  it("maps lifecycle statuses straight through", () => {
    expect(resolveBarState("requesting-permission", "listening", OFF)).toBe(
      "requesting-permission"
    );
    expect(resolveBarState("connecting", "listening", OFF)).toBe("connecting");
    expect(resolveBarState("reconnecting", "listening", OFF)).toBe(
      "reconnecting"
    );
    expect(resolveBarState("error", "listening", OFF)).toBe("error");
    expect(resolveBarState("ended", "listening", OFF)).toBe("ended");
  });

  it("maps the live turn axis", () => {
    expect(resolveBarState("live", "listening", OFF)).toBe("listening");
    expect(resolveBarState("live", "user-speaking", OFF)).toBe("user-speaking");
    expect(resolveBarState("live", "agent-thinking", OFF)).toBe(
      "agent-thinking"
    );
    expect(resolveBarState("live", "agent-speaking", OFF)).toBe(
      "agent-speaking"
    );
  });

  it("muted wins over any live turn", () => {
    const flags = { muted: true, degraded: false };
    const turns: VoiceTurn[] = [
      "listening",
      "user-speaking",
      "agent-thinking",
      "agent-speaking",
    ];
    for (const turn of turns) {
      expect(resolveBarState("live", turn, flags)).toBe("muted");
    }
  });

  it("degraded wins over the turn but not over muted", () => {
    expect(
      resolveBarState("live", "agent-speaking", { muted: false, degraded: true })
    ).toBe("degraded");
    expect(
      resolveBarState("live", "listening", { muted: true, degraded: true })
    ).toBe("muted");
  });

  it("lifecycle wins over flags (reconnecting stays reconnecting while muted)", () => {
    expect(
      resolveBarState("reconnecting", "listening", {
        muted: true,
        degraded: true,
      })
    ).toBe("reconnecting");
    expect(
      resolveBarState("error", "listening", { muted: true, degraded: true })
    ).toBe("error");
  });

  it("covers the full status x flags table", () => {
    const statuses: VoiceStatus[] = [
      "requesting-permission",
      "connecting",
      "live",
      "reconnecting",
      "error",
      "ended",
    ];
    for (const status of statuses) {
      for (const muted of [false, true]) {
        for (const degraded of [false, true]) {
          const state = resolveBarState(status, "listening", {
            muted,
            degraded,
          });
          if (status !== "live") {
            expect(state).toBe(status);
          } else if (muted) {
            expect(state).toBe("muted");
          } else if (degraded) {
            expect(state).toBe("degraded");
          } else {
            expect(state).toBe("listening");
          }
        }
      }
    }
  });
});
