/**
 * Typed friction signals collected client-side by the {@link SignalCollector}.
 *
 * Privacy rule: signals carry **enums, counters, and paths only** — never field
 * values or free text — so no PII ever leaves the page through this channel.
 */
export type SignalType =
  | "route_change"
  | "route_bounce"
  | "rage_click"
  | "field_error";

/** One entry of the collector's ring buffer. */
export interface Signal {
  type: SignalType;
  /** Pathname the signal happened on. */
  route: string;
  /** Epoch ms. */
  at: number;
  /** Optional counter (e.g. how many errors this field has produced so far). */
  count?: number;
  /** Small, PII-free metadata (field names, previous route…). */
  meta?: Record<string, string | number>;
}

/**
 * Aggregated view of the current friction state. Registered as a dynamic
 * context provider (key `friction_signals`) so it rides along as
 * `client_context` on every message, and sent as `signals` to the proactive
 * evaluate endpoint.
 */
export interface SignalsSnapshot {
  /** Current pathname. */
  route: string;
  /** Time spent on the current route, ms. */
  dwellMs: number;
  /** Time since the last user activity (pointer/key/scroll/touch), ms. */
  idleMs: number;
  /** Rage-click bursts detected on the current route. */
  rageClicks: number;
  /**
   * A→B→A→B route oscillations detected in the recent route sequence. Rolling
   * session counter (cross-route by nature); trigger cooldowns and dismissal
   * memory keep it from re-firing forever.
   */
  routeBounces: number;
  /** App-pushed field error counters (field NAME → count), current route only. */
  fieldErrors: Record<string, number>;
  /** Most recent pathnames, oldest first (bounded). */
  recentRoutes: string[];
  /**
   * Merged `AgoStateControl.get()` snapshot of the registered page-state
   * controls (funnel step, filters…), or `null` when none are registered.
   */
  pageState: Record<string, unknown> | null;
}

/** Tuning knobs for the collector's detectors. All optional. */
export interface SignalCollectorTuning {
  /** Min gap between heavy activity work (route checks, notifications), ms. Default 250. */
  activityThrottleMs?: number;
  /** Rage click: clicks needed to count a burst. Default 3. */
  rageClickCount?: number;
  /** Rage click: max time between first and last click of a burst, ms. Default 1000. */
  rageClickWindowMs?: number;
  /** Rage click: max radius between clicks of a burst, px. Default 24. */
  rageClickRadiusPx?: number;
  /** Max routes kept in the recent-route sequence. Default 10. */
  maxRecentRoutes?: number;
  /** Max typed signals kept in the ring buffer. Default 50. */
  maxSignals?: number;
}
