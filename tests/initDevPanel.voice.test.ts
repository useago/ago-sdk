import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initDevPanel } from "../src/devtools";
import { createMockClient } from "../src/testing";
import { AgoVoiceError } from "../src/voice/errors";

describe("initDevPanel — voice section", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("renders a voice section and tracks the protocol status line", () => {
    const client = createMockClient();
    initDevPanel({ client });

    const statusEl = document.querySelector(".dev-voice-status");
    expect(statusEl).not.toBeNull();
    expect(statusEl!.textContent).toBe("idle");

    client.__emitEvent("voice:status", {
      status: "live",
      turn: "agent-speaking",
      muted: true,
      degraded: false,
      consentPending: false,
    });
    expect(statusEl!.textContent).toBe("live · agent-speaking · muted");
  });

  it("logs finals, persisted acks, thread adoption, errors and session end", () => {
    const client = createMockClient();
    initDevPanel({ client });
    const log = document.querySelector(".dev-voice-log")!;

    client.__emitEvent("voice:thread-ready", { threadId: "t-1" });
    client.__emitEvent("voice:turn-final", {
      role: "assistant",
      text: "answer text",
      final: true,
      interrupted: true,
    });
    client.__emitEvent("voice:persisted", {
      messageId: "m-9",
      role: "assistant",
    });
    client.__emitEvent("voice:error", new AgoVoiceError("connect-failed"));
    client.__emitEvent("voice:ended", { reason: "idle" });

    const text = log.textContent!;
    expect(text).toContain("thread-ready t-1");
    expect(text).toContain("assistant final (interrupted): answer text");
    expect(text).toContain("persisted assistant → m-9");
    expect(text).toContain("error connect-failed");
    expect(text).toContain("ended (idle)");
  });

  it("does not log voice:level (per-frame, would flood the panel)", () => {
    const client = createMockClient();
    initDevPanel({ client });
    const log = document.querySelector(".dev-voice-log")!;
    client.__emitEvent("voice:level", 0.7);
    expect(log.textContent).toBe("");
  });
});
