import { logger } from "../utils/logger";
import type {
  Signal,
  SignalCollectorTuning,
  SignalsSnapshot,
} from "./types";

export interface SignalCollectorOptions extends SignalCollectorTuning {
  /**
   * Reads the current page state (the registered `AgoStateControl.get()`
   * snapshot). Wired by `createAgoProactive` to the client's `page-state:*`
   * dynamic context entries so funnel state is available to trigger matchers
   * without new plumbing.
   */
  getPageState?: () => Record<string, unknown> | null;
}

interface RecentClick {
  at: number;
  x: number;
  y: number;
  /** Cheap fingerprint of the page state at click time — a click that CHANGES
   * page state is a working control, not a rage click. */
  stateKey: string;
}

const DEFAULT_ACTIVITY_THROTTLE_MS = 250;
const DEFAULT_RAGE_CLICK_COUNT = 3;
const DEFAULT_RAGE_CLICK_WINDOW_MS = 1000;
const DEFAULT_RAGE_CLICK_RADIUS_PX = 24;
const DEFAULT_MAX_RECENT_ROUTES = 10;
const DEFAULT_MAX_SIGNALS = 50;

/** DOM events that count as "the user is active". All passive, all cheap. */
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
] as const;

/**
 * Framework-agnostic collector of client-side friction signals: per-route
 * dwell time, idle time, route bounces (A→B→A→B), rage clicks, and app-pushed
 * field error counters. Attached to an `AgoClient` by `createAgoProactive`,
 * the same way `ClientContextRegistry` is attached.
 *
 * Route observation is poll-on-demand rather than a `history.pushState` patch:
 * the SDK must never mutate host globals (see CLAUDE.md scoping rules), so the
 * current pathname is (re)checked on `popstate`/`hashchange`, on throttled user
 * activity, and on every `getSnapshot()` — the proactive engine's ~1s tick
 * makes that an effective 1s poll, plenty for multi-second dwell thresholds.
 *
 * Privacy: only enums, counters, and paths are recorded. Field VALUES are never
 * read — `signalFieldError(fieldName)` takes the field name only.
 *
 * Listeners are passive and throttled, attached only by `start()` (i.e. only
 * when proactive mode is configured) and fully removed by `destroy()`.
 */
export class SignalCollector {
  private readonly getPageState?: () => Record<string, unknown> | null;
  private readonly activityThrottleMs: number;
  private readonly rageClickCount: number;
  private readonly rageClickWindowMs: number;
  private readonly rageClickRadiusPx: number;
  private readonly maxRecentRoutes: number;
  private readonly maxSignals: number;

  private started = false;
  private teardowns: Array<() => void> = [];

  private route = "";
  private routeEnteredAt = 0;
  private lastActivityAt = 0;
  private lastHeavyActivityAt = 0;

  private recentRoutes: string[] = [];
  private routeBounces = 0;
  private rageClicks = 0;
  private fieldErrors: Record<string, number> = {};
  private recentClicks: RecentClick[] = [];
  private signals: Signal[] = [];
  private listeners = new Set<(signal: Signal) => void>();

  constructor(options: SignalCollectorOptions = {}) {
    this.getPageState = options.getPageState;
    this.activityThrottleMs =
      options.activityThrottleMs ?? DEFAULT_ACTIVITY_THROTTLE_MS;
    this.rageClickCount = options.rageClickCount ?? DEFAULT_RAGE_CLICK_COUNT;
    this.rageClickWindowMs =
      options.rageClickWindowMs ?? DEFAULT_RAGE_CLICK_WINDOW_MS;
    this.rageClickRadiusPx =
      options.rageClickRadiusPx ?? DEFAULT_RAGE_CLICK_RADIUS_PX;
    this.maxRecentRoutes = options.maxRecentRoutes ?? DEFAULT_MAX_RECENT_ROUTES;
    this.maxSignals = options.maxSignals ?? DEFAULT_MAX_SIGNALS;
  }

  /**
   * Attach the DOM listeners and start tracking. Idempotent; no-op outside a
   * browser (SSR).
   */
  start(): void {
    if (this.started) return;
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    this.started = true;

    const now = Date.now();
    this.route = this.currentPathname();
    this.routeEnteredAt = now;
    this.lastActivityAt = now;
    this.recentRoutes = [this.route];

    const listen = (
      target: Window | Document,
      event: string,
      handler: (e: Event) => void
    ) => {
      target.addEventListener(event, handler, { passive: true });
      this.teardowns.push(() => target.removeEventListener(event, handler));
    };

    const onActivity = () => this.recordActivity();
    for (const event of ACTIVITY_EVENTS) {
      listen(window, event, onActivity);
    }

    listen(document, "visibilitychange", () => {
      // Coming back to the tab is activity; going hidden is not (idle grows,
      // and the engine skips evaluation while hidden anyway).
      if (document.visibilityState === "visible") this.recordActivity();
    });

    listen(window, "popstate", () => this.checkRoute());
    listen(window, "hashchange", () => this.checkRoute());
    listen(window, "click", (e) => this.onClick(e as MouseEvent));

    logger.log("SignalCollector started");
  }

  /** Remove every listener and reset transient buffers. */
  destroy(): void {
    for (const teardown of this.teardowns) teardown();
    this.teardowns = [];
    this.listeners.clear();
    this.recentClicks = [];
    this.started = false;
    logger.log("SignalCollector destroyed");
  }

  /**
   * App-pushed signal: a form field produced a (repeated) validation error.
   * Pass the field NAME only — values are never read, so no PII is collected.
   */
  signalFieldError(fieldName: string): void {
    this.checkRoute();
    const count = (this.fieldErrors[fieldName] ?? 0) + 1;
    this.fieldErrors[fieldName] = count;
    this.pushSignal({
      type: "field_error",
      route: this.route,
      at: Date.now(),
      count,
      meta: { field: fieldName },
    });
  }

  /**
   * Subscribe to raw signals (route changes, bounces, rage clicks, field
   * errors). Returns an unsubscribe function. Used by the proactive engine to
   * evaluate promptly instead of waiting for the next tick.
   */
  subscribe(listener: (signal: Signal) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The typed-signal ring buffer (most recent last, bounded). */
  getSignals(): Signal[] {
    return [...this.signals];
  }

  /**
   * Aggregated snapshot of the current friction state. Re-checks the route
   * first, so calling this on a periodic tick doubles as the route poll.
   *
   * `pageState: false` skips the page-state read — used by the
   * `friction_signals` dynamic context provider, both because page state
   * already rides in `client_context` under its own `page-state:*` entries and
   * because reading it from inside a context provider would recurse.
   */
  getSnapshot(opts?: { pageState?: boolean }): SignalsSnapshot {
    this.checkRoute();
    const now = Date.now();
    return {
      route: this.route,
      dwellMs: this.started ? now - this.routeEnteredAt : 0,
      idleMs: this.started ? now - this.lastActivityAt : 0,
      rageClicks: this.rageClicks,
      routeBounces: this.routeBounces,
      fieldErrors: { ...this.fieldErrors },
      recentRoutes: [...this.recentRoutes],
      pageState: opts?.pageState === false ? null : this.readPageState(),
    };
  }

  // ───────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────

  private currentPathname(): string {
    return typeof window !== "undefined" && window.location
      ? window.location.pathname
      : "";
  }

  private readPageState(): Record<string, unknown> | null {
    if (!this.getPageState) return null;
    try {
      return this.getPageState() ?? null;
    } catch (err) {
      logger.warn("SignalCollector getPageState threw:", err);
      return null;
    }
  }

  private recordActivity(): void {
    const now = Date.now();
    this.lastActivityAt = now;
    // Heavier work (route polling) is throttled; the timestamp update above is
    // the only thing that runs on every mousemove.
    if (now - this.lastHeavyActivityAt >= this.activityThrottleMs) {
      this.lastHeavyActivityAt = now;
      this.checkRoute();
    }
  }

  /** Compare the live pathname with the tracked one; handle a route change. */
  private checkRoute(): void {
    if (!this.started) return;
    const pathname = this.currentPathname();
    if (pathname === this.route) return;

    const now = Date.now();
    const previous = this.route;
    this.route = pathname;
    this.routeEnteredAt = now;

    // Per-route friction resets: these describe the CURRENT page.
    this.rageClicks = 0;
    this.fieldErrors = {};
    this.recentClicks = [];

    this.recentRoutes.push(pathname);
    if (this.recentRoutes.length > this.maxRecentRoutes) {
      this.recentRoutes.splice(0, this.recentRoutes.length - this.maxRecentRoutes);
    }

    this.pushSignal({
      type: "route_change",
      route: pathname,
      at: now,
      meta: { from: previous },
    });

    // Bounce detection: the last four routes form A→B→A→B.
    const r = this.recentRoutes;
    const n = r.length;
    if (
      n >= 4 &&
      r[n - 1] === r[n - 3] &&
      r[n - 2] === r[n - 4] &&
      r[n - 1] !== r[n - 2]
    ) {
      this.routeBounces += 1;
      this.pushSignal({
        type: "route_bounce",
        route: pathname,
        at: now,
        count: this.routeBounces,
        meta: { between: `${r[n - 2]}↔${r[n - 1]}` },
      });
    }
  }

  private onClick(e: MouseEvent): void {
    this.recordActivity();
    // A click that navigated is not a rage click: checkRoute (via
    // recordActivity) already cleared the buffer if the route changed.
    const now = Date.now();
    const stateKey = this.pageStateKey();
    const click: RecentClick = { at: now, x: e.clientX, y: e.clientY, stateKey };

    // Drop clicks outside the time window.
    this.recentClicks = this.recentClicks.filter(
      (c) => now - c.at <= this.rageClickWindowMs
    );

    const first = this.recentClicks[0];
    const sameSpot =
      !first ||
      (Math.abs(click.x - first.x) <= this.rageClickRadiusPx &&
        Math.abs(click.y - first.y) <= this.rageClickRadiusPx);
    // Page state changed since the burst started → the clicks are DOING
    // something; start a fresh burst.
    const sameState = !first || first.stateKey === stateKey;

    if (!sameSpot || !sameState) {
      this.recentClicks = [click];
      return;
    }

    this.recentClicks.push(click);
    if (this.recentClicks.length >= this.rageClickCount) {
      this.rageClicks += 1;
      this.recentClicks = [];
      this.pushSignal({
        type: "rage_click",
        route: this.route,
        at: now,
        count: this.rageClicks,
      });
    }
  }

  /** Cheap fingerprint of the page state, for "did this click change anything". */
  private pageStateKey(): string {
    const state = this.readPageState();
    if (!state) return "";
    try {
      return JSON.stringify(state);
    } catch {
      return "";
    }
  }

  private pushSignal(signal: Signal): void {
    this.signals.push(signal);
    if (this.signals.length > this.maxSignals) {
      this.signals.splice(0, this.signals.length - this.maxSignals);
    }
    for (const listener of this.listeners) {
      try {
        listener(signal);
      } catch (err) {
        logger.error("Signal listener threw:", err);
      }
    }
  }
}
