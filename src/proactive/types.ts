import type { StorageLike } from "../state/createStore";
import type { SignalCollectorTuning, SignalsSnapshot } from "../signals/types";

/**
 * Conditions of a proactive trigger. Pure conjunction: EVERY specified matcher
 * must pass against the current {@link SignalsSnapshot}. Numeric fields are
 * `>=` thresholds.
 */
export interface ProactiveTriggerWhen {
  /**
   * Route pattern the current pathname must match. Supports the SDK's route
   * styles: exact (`/billing`), `:param` segments (`/users/:id`), single-segment
   * wildcards (`/a/*` / `/b`), and a trailing `/*` that matches one or more
   * remaining segments (`/dossier/*`).
   */
  route?: string;
  /** Min time since the last user activity, ms. */
  idleMs?: number;
  /** Min time spent on the current route, ms. */
  dwellMs?: number;
  /**
   * Partial deep match against the registered page state (funnel step,
   * filters…). Every key present here must deep-match the live value.
   */
  pageState?: Partial<Record<string, unknown>>;
  /** Min rage-click bursts on the current route. */
  rageClicks?: number;
  /** Min A→B→A→B route oscillations this session. */
  routeBounces?: number;
  /** Per-field minimum error counts (field NAME → min count). */
  fieldErrors?: Record<string, number>;
}

/**
 * Optional action attached to a nudge. Accepting a `functionName` action
 * executes the registered client function (same `FunctionRegistry` path as
 * agent-invoked calls); `setPageState` applies values through the registered
 * page-state controls.
 */
export type NudgeAction =
  | { label: string; functionName: string; arguments?: Record<string, unknown> }
  | { label: string; setPageState: Record<string, unknown> };

/** A declarative proactive trigger. */
export interface ProactiveTrigger {
  /** Stable id, used for cooldowns, dismissal memory, and analytics. */
  id: string;
  /** Conjunction of matchers (see {@link ProactiveTriggerWhen}). */
  when: ProactiveTriggerWhen;
  /**
   * Min time between two firings of this trigger (persisted across reloads).
   * A firing is the moment the trigger passes the gates — including an agent
   * evaluation that decides NOT to intervene, so a persistent condition can't
   * hammer the evaluate endpoint. Default 60 000.
   */
  cooldownMs?: number;
  /**
   * `'agent'` asks the backend's fast-LLM second filter whether (and how) to
   * intervene; a `static` object shows the given message with no network call.
   */
  intervene: "agent" | { type: "static"; message: string; action?: NudgeAction };
  /**
   * What the agent should help with. Sent to the evaluate endpoint, and used to
   * pre-seed the chat turn when the user accepts the nudge.
   */
  goal?: string;
  /**
   * User-voice line used to OPEN the conversation when the user accepts this
   * nudge and no conversation exists yet — a hidden kickoff cannot start one
   * (the backend rejects it). Sent as a visible user message, so write it in
   * the app's language ("Oui, aidez-moi à choisir !"). When a conversation is
   * already open, the SDK sends a hidden meta kickoff instead and this field
   * is unused. Without it, accepting with no open conversation skips the chat
   * pre-seed (the nudge action still runs).
   */
  kickoff?: string;
  /**
   * How long a dismissal of this trigger's nudge suppresses it (persisted).
   * Default 24h.
   */
  resurfaceAfterMs?: number;
}

/** Options for {@link createAgoProactive} / `AgoConfig.proactive`. */
export interface ProactiveOptions {
  triggers: ProactiveTrigger[];
  /**
   * Global caps on nudges actually shown. `perSession` is in-memory (page
   * lifetime); `perDay` is persisted in localStorage with a date rollover —
   * best-effort by design (private browsing resets it); the costly LLM path is
   * additionally capped server-side.
   */
  frequencyCap?: { perSession?: number; perDay?: number };
  /** Evaluation tick, ms. Default 1000. Zero network per tick. */
  tickMs?: number;
  /** Storage backend for persisted governance state. Default `localStorage`. */
  storage?: StorageLike;
  /** Storage key for persisted governance state. Default `"ago_proactive"`. */
  storageKey?: string;
  /** Tuning of the signal detectors (rage-click window, throttles…). */
  signals?: SignalCollectorTuning;
  /**
   * Local demos and tests ONLY: bypass the remote kill-switch. When set, the
   * `GET /config` fetch is skipped and the kill-switch takes this value.
   * Leave unset in production — the tenant admin controls the feature, and
   * the evaluate endpoint stays gated server-side regardless.
   */
  enabledOverride?: boolean;
}

/** A concrete nudge produced by the engine, carried by every `nudge:*` event. */
export interface ProactiveNudgeInstance {
  /** Client-generated uuid for this nudge instance (`client_nudge_id`). */
  id: string;
  triggerId: string;
  /** `static` = configured message; `agent` = backend LLM evaluation. */
  source: "static" | "agent";
  message: string;
  action?: NudgeAction;
  goal?: string;
  /** See {@link ProactiveTrigger.kickoff}. */
  kickoff?: string;
  createdAt: Date;
  /** Server-side nudge id (agent nudges only). */
  serverNudgeId?: string;
}

/**
 * Controller returned by {@link createAgoProactive} (also available as
 * `client.proactive`).
 */
export interface ProactiveController {
  /** Persistently opt this browser out of proactive nudges. */
  optOut(): void;
  /** Undo {@link optOut}. */
  optIn(): void;
  isOptedOut(): boolean;
  /**
   * Tell the governor the user is already engaged (e.g. the chat widget is
   * open) — nudges are suppressed while `true`. Call from the UI layer.
   */
  setEngaged(engaged: boolean): void;
  /** App-pushed field error counter (field NAME only — never values). */
  signalFieldError(fieldName: string): void;
  /** Current aggregated friction snapshot. */
  getSignalsSnapshot(): SignalsSnapshot;
  /** The nudge currently occupying the single-nudge slot, if any. */
  getActiveNudge(): ProactiveNudgeInstance | null;
  /**
   * Mark the nudge as displayed. Idempotent per nudge; counts it against the
   * frequency caps, tracks the impression, and emits `nudge:shown`.
   */
  shown(nudge: ProactiveNudgeInstance): void;
  /**
   * Accept the nudge: run its action (if any), emit `nudge:accepted`, track,
   * and — for agent nudges or nudges with a `goal` — pre-seed the chat with a
   * hidden kickoff message so the agent starts the turn with full context.
   */
  accept(nudge: ProactiveNudgeInstance): Promise<void>;
  /** Dismiss the nudge: suppress the trigger, track, emit `nudge:dismissed`. */
  dismiss(nudge: ProactiveNudgeInstance): void;
  /** Report a downstream conversion attributable to the nudge (analytics only). */
  markConverted(nudge: ProactiveNudgeInstance): void;
  /** Detach everything: listeners, timers, context provider, event flush. */
  destroy(): void;
}

// ─────────────────────────────────────────────────────────────────
// Backend API contract (backend built in parallel — keep in sync)
// ─────────────────────────────────────────────────────────────────

/**
 * Response of `POST {baseUrl}/api/sdk/v1/proactive/evaluate` (snake_case, as
 * on the wire). On 429 or any error the SDK treats the call as
 * `intervene: false`, silently (debug log only).
 */
export interface ProactiveEvaluateResponse {
  intervene: boolean;
  message: string | null;
  action: {
    label: string;
    function_name: string;
    arguments?: Record<string, unknown>;
  } | null;
  /** Server-generated nudge uuid. */
  nudge_id: string;
}

/** One entry of the `POST {baseUrl}/api/sdk/v1/proactive/events` batch. */
export interface ProactiveTrackedEvent {
  clientNudgeId: string;
  triggerId: string;
  source: "static" | "agent";
  type: "shown" | "dismissed" | "accepted" | "converted";
  /** Nudge text, optional. */
  message?: string;
  /** Epoch ms; serialized as ISO-8601 `occurred_at`. */
  occurredAt: number;
}
