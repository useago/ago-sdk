import { logger } from "../utils/logger";
import type { ProactiveTrackedEvent } from "./types";

/**
 * Backend contract (backend built in parallel — keep in sync):
 *
 *   POST {baseUrl}/api/sdk/v1/proactive/events   (same auth headers as
 *   every SDK call — HttpClient adds them)
 *
 *   Request:
 *   { "events": [ { "client_nudge_id": "uuid", "trigger_id": "...",
 *       "source": "static" | "agent",
 *       "type": "shown" | "dismissed" | "accepted" | "converted",
 *       "message": "<nudge text, optional>", "agent": "<optional>",
 *       "occurred_at": "<ISO-8601>" } ] }
 *
 * Static nudge impressions ARE tracked here too (they never hit /evaluate, so
 * this endpoint is their only analytics path). Delivery is best-effort:
 * batched, debounced (~5s), flushed with `fetch(..., { keepalive: true })` on
 * page hide — NOT sendBeacon, which cannot carry the auth headers. Failures
 * drop the batch silently (debug log only).
 */
const FLUSH_INTERVAL_MS = 5_000;
const EVENTS_PATH = "/api/sdk/v1/proactive/events";

export interface ProactiveEventTrackerOptions {
  /** Authenticated JSON POST (wired to the client's HttpClient). */
  post: (
    path: string,
    body: unknown,
    options?: { keepalive?: boolean }
  ) => Promise<unknown>;
  /** Agent name from the client config, if any. */
  agent?: string;
  /** Debounce window before a batch is flushed. Default 5000ms. */
  flushIntervalMs?: number;
}

export class ProactiveEventTracker {
  private readonly post: ProactiveEventTrackerOptions["post"];
  private readonly agent?: string;
  private readonly flushIntervalMs: number;

  private queue: ProactiveTrackedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private teardowns: Array<() => void> = [];
  private destroyed = false;

  constructor(options: ProactiveEventTrackerOptions) {
    this.post = options.post;
    this.agent = options.agent;
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;

    // Flush-on-hide: the tab may never come back, so push what we have with
    // keepalive so the request survives the unload.
    if (typeof document !== "undefined") {
      const onVisibility = () => {
        if (document.visibilityState === "hidden") {
          this.flush({ keepalive: true });
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      this.teardowns.push(() =>
        document.removeEventListener("visibilitychange", onVisibility)
      );
    }
    if (typeof window !== "undefined") {
      const onPageHide = () => this.flush({ keepalive: true });
      window.addEventListener("pagehide", onPageHide);
      this.teardowns.push(() =>
        window.removeEventListener("pagehide", onPageHide)
      );
    }
  }

  /** Queue a tracking event; the batch flushes after ~5s or on page hide. */
  track(event: ProactiveTrackedEvent): void {
    if (this.destroyed) return;
    this.queue.push(event);
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  /** Send the queued batch now. Errors are swallowed (analytics only). */
  flush(options?: { keepalive?: boolean }): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) return;

    const events = this.queue;
    this.queue = [];

    const body = {
      events: events.map((e) => ({
        client_nudge_id: e.clientNudgeId,
        trigger_id: e.triggerId,
        source: e.source,
        type: e.type,
        ...(e.message !== undefined ? { message: e.message } : {}),
        ...(this.agent ? { agent: this.agent } : {}),
        occurred_at: new Date(e.occurredAt).toISOString(),
      })),
    };

    this.post(EVENTS_PATH, body, options).catch((err) => {
      // Best-effort analytics: never surface, never retry (a retry could
      // double-count impressions).
      logger.debug("Proactive event batch failed:", err);
    });
  }

  /** Flush what's left and remove the page-hide listeners. */
  destroy(): void {
    if (this.destroyed) return;
    this.flush({ keepalive: true });
    this.destroyed = true;
    for (const teardown of this.teardowns) teardown();
    this.teardowns = [];
  }
}
