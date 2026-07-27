import { describe, expect, it } from "vitest";
import type { AgoClientEvents, AgoEventName } from "../src/client/types";

// TYPE-COMPATIBILITY FIXTURE (see CHANGELOG 1.6.0): the AgoClientEvents union
// widened with the voice:* events. That is source-breaking for consumers that
// keep an exhaustive Record<AgoEventName, ...>: this literal fails to compile
// until every voice key is added, which is exactly the migration such
// consumers must make. The runtime assertions below pin the key set so the
// fixture cannot silently drift from the union.
const EVENT_LABELS: Record<AgoEventName, string> = {
  "context:changed": "context changed",
  "message:start": "message started",
  "message:chunk": "message chunk",
  "stream:message": "raw stream message",
  "message:answer-complete": "answer complete",
  "message:complete": "message complete",
  "message:waiting-client": "waiting on client functions",
  "message:empty": "empty reply",
  "message:error": "message error",
  "conversation:loaded": "conversation loaded",
  "toolCall:received": "tool call received",
  "toolCall:form": "tool call form",
  "function:invoke": "function invoked",
  "function:awaiting-approval": "function awaiting approval",
  "function:result": "function result",
  "form:submitted": "form submitted",
  "form:error": "form error",
  "connection:status": "connection status",
  "nudge:ready": "nudge ready",
  "nudge:shown": "nudge shown",
  "nudge:dismissed": "nudge dismissed",
  "nudge:accepted": "nudge accepted",
  "activity:recorded": "activity recorded",
  // The 1.6.0 widening: voice events joined the client emitter.
  "voice:status": "voice status",
  "voice:transcript": "voice transcript",
  "voice:turn-final": "voice turn final",
  "voice:persisted": "voice turn persisted",
  "voice:thread-ready": "voice thread ready",
  "voice:level": "voice mic level",
  "voice:error": "voice error",
  "voice:ended": "voice ended",
};

// A voice event payload must be assignable through the widened union.
type VoiceStatusPayload = AgoClientEvents["voice:status"];

describe("AgoClientEvents widening (1.6.0)", () => {
  it("exhaustive Record<AgoEventName, ...> consumers must now cover the voice events", () => {
    const voiceKeys = (Object.keys(EVENT_LABELS) as AgoEventName[]).filter(
      (key) => key.startsWith("voice:")
    );
    expect(voiceKeys.sort()).toEqual([
      "voice:ended",
      "voice:error",
      "voice:level",
      "voice:persisted",
      "voice:status",
      "voice:thread-ready",
      "voice:transcript",
      "voice:turn-final",
    ]);
  });

  it("voice:status payload carries the three state axes", () => {
    const payload: VoiceStatusPayload = {
      status: "live",
      turn: "agent-speaking",
      muted: false,
      degraded: false,
      consentPending: false,
    };
    expect(payload.status).toBe("live");
  });
});
