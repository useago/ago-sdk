import { createStore, type Store, type StorageLike } from "../state/createStore";
import { logger } from "../utils/logger";
import type { ProactiveTrigger } from "./types";

/** Default per-trigger cooldown when the trigger doesn't set one. */
const DEFAULT_COOLDOWN_MS = 60_000;
/** Default suppression window after a dismissal (per trigger, persisted). */
const DEFAULT_RESURFACE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Storage key for the persisted governance state (`ago_` prefix rule). */
const DEFAULT_STORAGE_KEY = "ago_proactive";

/** Persisted slice of the governance state (localStorage, best-effort). */
interface GovernorPersistedState {
  optOut: boolean;
  /** Trigger id → epoch ms of the last firing (cooldowns). */
  lastFiredAt: Record<string, number>;
  /** Trigger id → epoch ms of the last dismissal. */
  dismissedAt: Record<string, number>;
  /** Daily cap counter with date rollover (local date, YYYY-MM-DD). */
  day: { date: string; count: number };
}

export interface NudgeGovernorOptions {
  frequencyCap?: { perSession?: number; perDay?: number };
  storage?: StorageLike;
  storageKey?: string;
}

function localDateKey(now: number): string {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Gatekeeper of the proactive engine: a nudge fires only when EVERY gate
 * passes —
 *
 * 1. server kill-switch (default DISABLED until the config endpoint confirms),
 * 2. persisted user opt-out,
 * 3. per-trigger cooldown (persisted last-fired timestamp),
 * 4. frequency caps: perSession (in-memory) + perDay (persisted, date rollover),
 * 5. dismissal memory (persisted, optional per-trigger `resurfaceAfterMs`),
 * 6. single-nudge slot, and suppression while the user is already engaged
 *    (chat widget open, or a message turn in flight).
 *
 * The persisted state is best-effort by design (private browsing resets it);
 * the costly LLM path is additionally capped server-side.
 */
export class NudgeGovernor {
  private readonly perSessionCap?: number;
  private readonly perDayCap?: number;
  private readonly store: Store<GovernorPersistedState>;

  /** Server kill-switch — DISABLED until the config endpoint says otherwise. */
  private killSwitchEnabled = false;
  /** UI-declared engagement (chat widget open). */
  private engaged = false;
  /** A message turn is streaming (or paused awaiting client results). */
  private turnInFlight = false;
  /** Single-nudge slot: held from fire (or evaluate start) to dismiss/accept. */
  private slotOccupied = false;
  /** Nudges shown this page lifetime. */
  private sessionCount = 0;

  constructor(options: NudgeGovernorOptions = {}) {
    this.perSessionCap = options.frequencyCap?.perSession;
    this.perDayCap = options.frequencyCap?.perDay;
    this.store = createStore<GovernorPersistedState>(
      {
        optOut: false,
        lastFiredAt: {},
        dismissedAt: {},
        day: { date: localDateKey(Date.now()), count: 0 },
      },
      { key: options.storageKey ?? DEFAULT_STORAGE_KEY, storage: options.storage }
    );
  }

  /** Flip the server kill-switch (from `GET /api/sdk/v1/config`). */
  setKillSwitch(enabled: boolean): void {
    this.killSwitchEnabled = enabled;
  }

  optOut(): void {
    this.store.set({ ...this.store.get(), optOut: true });
  }

  optIn(): void {
    this.store.set({ ...this.store.get(), optOut: false });
  }

  isOptedOut(): boolean {
    return this.store.get().optOut;
  }

  setEngaged(engaged: boolean): void {
    this.engaged = engaged;
  }

  setTurnInFlight(inFlight: boolean): void {
    this.turnInFlight = inFlight;
  }

  isSlotOccupied(): boolean {
    return this.slotOccupied;
  }

  occupySlot(): void {
    this.slotOccupied = true;
  }

  releaseSlot(): void {
    this.slotOccupied = false;
  }

  /** Run every gate for a trigger. All must pass. */
  canFire(trigger: ProactiveTrigger, now = Date.now()): boolean {
    if (!this.killSwitchEnabled) {
      return this.deny(trigger, "kill-switch (proactive disabled server-side)");
    }
    const state = this.store.get();
    if (state.optOut) return this.deny(trigger, "user opted out");
    if (this.engaged) return this.deny(trigger, "user engaged (widget open)");
    if (this.turnInFlight) return this.deny(trigger, "message turn in flight");
    if (this.slotOccupied) return this.deny(trigger, "nudge slot occupied");

    const lastFired = state.lastFiredAt[trigger.id];
    const cooldownMs = trigger.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    if (lastFired !== undefined && now - lastFired < cooldownMs) {
      return this.deny(trigger, "cooldown");
    }

    const dismissedAt = state.dismissedAt[trigger.id];
    const resurfaceAfterMs = trigger.resurfaceAfterMs ?? DEFAULT_RESURFACE_AFTER_MS;
    if (dismissedAt !== undefined && now - dismissedAt < resurfaceAfterMs) {
      return this.deny(trigger, "dismissed recently");
    }

    if (this.perSessionCap !== undefined && this.sessionCount >= this.perSessionCap) {
      return this.deny(trigger, "perSession cap");
    }
    if (this.perDayCap !== undefined && this.dayCount(now) >= this.perDayCap) {
      return this.deny(trigger, "perDay cap");
    }
    return true;
  }

  /**
   * Record that the trigger fired (a static nudge became ready, or an agent
   * evaluation was attempted). Starts the cooldown regardless of the evaluate
   * outcome, so a persistent condition can't hammer the backend.
   */
  recordFired(triggerId: string, now = Date.now()): void {
    const state = this.store.get();
    this.store.set({
      ...state,
      lastFiredAt: { ...state.lastFiredAt, [triggerId]: now },
    });
  }

  /** Count a nudge actually displayed against the frequency caps. */
  recordNudgeShown(now = Date.now()): void {
    this.sessionCount += 1;
    const state = this.store.get();
    const date = localDateKey(now);
    const day =
      state.day.date === date
        ? { date, count: state.day.count + 1 }
        : { date, count: 1 };
    this.store.set({ ...state, day });
  }

  /** Persist a dismissal (suppresses the trigger, see gate 5). */
  recordDismissed(triggerId: string, now = Date.now()): void {
    const state = this.store.get();
    this.store.set({
      ...state,
      dismissedAt: { ...state.dismissedAt, [triggerId]: now },
    });
  }

  /** Current perDay counter, rolled over to today's date. */
  private dayCount(now: number): number {
    const state = this.store.get();
    return state.day.date === localDateKey(now) ? state.day.count : 0;
  }

  private deny(trigger: ProactiveTrigger, reason: string): false {
    logger.debug(`NudgeGovernor: trigger "${trigger.id}" blocked — ${reason}`);
    return false;
  }
}
