import { logger } from "../utils/logger";

/** A running page recording, as the browser kit hands it out (see `./recorder`). */
export interface LiveRecorder {
  stop(): void;
  getNode(id: number): Node | null;
  takeFullSnapshot(): void;
}

export const LIVE_FLUSH_MS = 250;
export const LIVE_SNAPSHOT_MS = 60_000;
const RETRY_MS = 2_000;
/** Below the server's 5000 events per batch. */
const MAX_BATCH_EVENTS = 2_000;
/** Past this the replay is too far behind: restart it from a full snapshot. */
const MAX_QUEUED_EVENTS = 20_000;

/** JSON array of events, gzip-compressed where the browser can. */
export async function encodeEvents(events: unknown[]): Promise<Blob> {
  const json = JSON.stringify(events);
  if (typeof CompressionStream !== "undefined" && typeof Response !== "undefined") {
    try {
      const body = new Response(json).body;
      if (body) {
        const gzip = body.pipeThrough(new CompressionStream("gzip"));
        return new Blob([await new Response(gzip).arrayBuffer()]);
      }
    } catch {
      // Sent uncompressed: the server accepts both.
    }
  }
  return new Blob([json], { type: "application/json" });
}

/**
 * Queues recorded events and sends them in batches: one request in flight,
 * every {@link LIVE_FLUSH_MS} while there is something to send, with a full
 * snapshot every {@link LIVE_SNAPSHOT_MS} so a late viewer can rebuild the page.
 * `send` rejects for an error worth retrying; the batch is then sent again.
 */
export class LiveStream {
  private queue: unknown[] = [];
  private recorder: LiveRecorder | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private stopped = false;
  private abort = new AbortController();

  constructor(private send: (body: Blob, signal: AbortSignal) => Promise<void>) {}

  /** The recording started: events may already be queued (its first snapshot). */
  attach(recorder: LiveRecorder): void {
    if (this.stopped) {
      recorder.stop();
      return;
    }
    this.recorder = recorder;
    this.snapshotTimer = setInterval(() => recorder.takeFullSnapshot(), LIVE_SNAPSHOT_MS);
  }

  push(event: unknown): void {
    if (this.stopped) return;
    this.queue.push(event);
    if (this.queue.length > MAX_QUEUED_EVENTS) {
      this.queue = [];
      this.recorder?.takeFullSnapshot();
    }
    this.schedule(LIVE_FLUSH_MS);
  }

  getNode(id: number): Node | null {
    return this.recorder?.getNode(id) ?? null;
  }

  /** Stop recording and drop what was not sent; an in-flight batch is aborted. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.queue = [];
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.flushTimer = null;
    this.snapshotTimer = null;
    this.abort.abort();
    try {
      this.recorder?.stop();
    } catch (error) {
      logger.warn("Stopping the live view recording failed:", error);
    }
    this.recorder = null;
  }

  private schedule(delay: number): void {
    if (this.stopped || this.flushTimer || this.inFlight || this.queue.length === 0) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.queue.length === 0) return;
    this.inFlight = true;
    const batch = this.queue.splice(0, MAX_BATCH_EVENTS);
    let delay = LIVE_FLUSH_MS;
    try {
      const body = await encodeEvents(batch);
      if (!this.stopped) await this.send(body, this.abort.signal);
    } catch (error) {
      if (!this.stopped) {
        logger.warn("Sending the live view failed, retrying:", error);
        this.queue.unshift(...batch);
        delay = RETRY_MS;
      }
    } finally {
      this.inFlight = false;
      this.schedule(delay);
    }
  }
}
