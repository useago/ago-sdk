import { describe, it, expect } from "vitest";
import { NudgeGovernor } from "../src/proactive/NudgeGovernor";
import type { StorageLike } from "../src/state/createStore";
import type { ProactiveTrigger } from "../src/proactive/types";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const trigger = (overrides: Partial<ProactiveTrigger> = {}): ProactiveTrigger => ({
  id: "t1",
  when: {},
  intervene: { type: "static", message: "Need a hand?" },
  ...overrides,
});

/** A governor with the kill-switch already enabled (the common test baseline). */
function enabledGovernor(
  options: ConstructorParameters<typeof NudgeGovernor>[0] = {}
): NudgeGovernor {
  const governor = new NudgeGovernor({ storage: memoryStorage(), ...options });
  governor.setKillSwitch(true);
  return governor;
}

describe("NudgeGovernor", () => {
  it("is disabled by default: the kill-switch must be explicitly enabled", () => {
    const governor = new NudgeGovernor({ storage: memoryStorage() });
    expect(governor.canFire(trigger())).toBe(false);
    governor.setKillSwitch(true);
    expect(governor.canFire(trigger())).toBe(true);
    governor.setKillSwitch(false);
    expect(governor.canFire(trigger())).toBe(false);
  });

  it("respects a persisted user opt-out across instances", () => {
    const storage = memoryStorage();
    const governor = new NudgeGovernor({ storage });
    governor.setKillSwitch(true);
    governor.optOut();
    expect(governor.isOptedOut()).toBe(true);
    expect(governor.canFire(trigger())).toBe(false);

    // A fresh instance on the same storage (page reload) stays opted out.
    const reloaded = new NudgeGovernor({ storage });
    reloaded.setKillSwitch(true);
    expect(reloaded.isOptedOut()).toBe(true);
    expect(reloaded.canFire(trigger())).toBe(false);

    reloaded.optIn();
    expect(reloaded.canFire(trigger())).toBe(true);
  });

  it("suppresses while the user is engaged or a turn is in flight", () => {
    const governor = enabledGovernor();
    governor.setEngaged(true);
    expect(governor.canFire(trigger())).toBe(false);
    governor.setEngaged(false);
    governor.setTurnInFlight(true);
    expect(governor.canFire(trigger())).toBe(false);
    governor.setTurnInFlight(false);
    expect(governor.canFire(trigger())).toBe(true);
  });

  it("holds a single-nudge slot", () => {
    const governor = enabledGovernor();
    governor.occupySlot();
    expect(governor.canFire(trigger())).toBe(false);
    governor.releaseSlot();
    expect(governor.canFire(trigger())).toBe(true);
  });

  it("enforces the per-trigger cooldown from the persisted last-fired time", () => {
    const storage = memoryStorage();
    const governor = new NudgeGovernor({ storage });
    governor.setKillSwitch(true);
    const t = trigger({ cooldownMs: 10_000 });
    const now = 1_000_000;

    governor.recordFired(t.id, now);
    expect(governor.canFire(t, now + 9_999)).toBe(false);
    expect(governor.canFire(t, now + 10_000)).toBe(true);

    // Persisted: a reload within the cooldown still blocks.
    const reloaded = new NudgeGovernor({ storage });
    reloaded.setKillSwitch(true);
    expect(reloaded.canFire(t, now + 5_000)).toBe(false);
  });

  it("caps nudges per session (in-memory)", () => {
    const governor = enabledGovernor({ frequencyCap: { perSession: 2 } });
    governor.recordNudgeShown();
    expect(governor.canFire(trigger())).toBe(true);
    governor.recordNudgeShown();
    expect(governor.canFire(trigger())).toBe(false);
  });

  it("caps nudges per day with a date rollover (persisted)", () => {
    const storage = memoryStorage();
    const governor = new NudgeGovernor({ storage, frequencyCap: { perDay: 1 } });
    governor.setKillSwitch(true);

    const monday = new Date("2026-07-06T10:00:00").getTime();
    governor.recordNudgeShown(monday);
    expect(governor.canFire(trigger(), monday + 1000)).toBe(false);

    // Persisted across reloads within the same day.
    const reloaded = new NudgeGovernor({ storage, frequencyCap: { perDay: 1 } });
    reloaded.setKillSwitch(true);
    expect(reloaded.canFire(trigger(), monday + 2000)).toBe(false);

    // Next day rolls the counter over.
    const tuesday = new Date("2026-07-07T10:00:00").getTime();
    expect(reloaded.canFire(trigger(), tuesday)).toBe(true);
    reloaded.recordNudgeShown(tuesday);
    expect(reloaded.canFire(trigger(), tuesday + 1000)).toBe(false);
  });

  it("remembers dismissals, with optional per-trigger resurfaceAfterMs", () => {
    const governor = enabledGovernor();
    const now = 5_000_000;

    const resurfacing = trigger({ id: "t-resurface", resurfaceAfterMs: 60_000 });
    governor.recordDismissed(resurfacing.id, now);
    expect(governor.canFire(resurfacing, now + 59_999)).toBe(false);
    expect(governor.canFire(resurfacing, now + 60_000)).toBe(true);

    // Default suppression window is 24h.
    const plain = trigger({ id: "t-plain" });
    governor.recordDismissed(plain.id, now);
    expect(governor.canFire(plain, now + 23 * 60 * 60 * 1000)).toBe(false);
    expect(governor.canFire(plain, now + 24 * 60 * 60 * 1000)).toBe(true);
  });
});
