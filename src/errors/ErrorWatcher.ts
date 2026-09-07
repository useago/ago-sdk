import { clampActivityData } from "../activity/ActivityLedger";
import { logger } from "../utils/logger";

/** How an error reached the watcher. */
export type CapturedErrorType =
  | "error"
  | "unhandledrejection"
  | "console"
  | "manual";

/** One JavaScript error captured on the page (deduplicated, see `count`). */
export interface CapturedError {
  type: CapturedErrorType;
  /** Error message, truncated to 500 chars. */
  message: string;
  /** Script URL the error came from, without its query string. */
  source?: string;
  line?: number;
  col?: number;
  /** Leading stack frames, truncated (see `maxStackChars`). */
  stack?: string;
  /** Pathname at capture time. */
  route: string;
  /** Epoch ms of the first occurrence. */
  firstAt: number;
  /** Epoch ms of the most recent occurrence. */
  lastAt: number;
  /** How many times this same error (type + message + source + line) fired. */
  count: number;
  /** App-provided context, manual reports only (size-clamped). */
  context?: Record<string, unknown>;
}

export interface ErrorWatcherOptions {
  /** Max distinct errors kept. Oldest dropped first. Default 10. */
  maxErrors?: number;
  /**
   * Errors older than this are pruned when the buffer is read, so a crash from
   * an hour ago does not confuse the agent. Default 600 000 (10 min).
   */
  maxAgeMs?: number;
  /** Max chars of stack kept per error. Default 2000. */
  maxStackChars?: number;
  /**
   * Redact or drop an error before it is stored. Return the (possibly edited)
   * error to keep it, `null` to drop it. Runs on every capture, so keep it cheap.
   */
  filter?: (error: CapturedError) => CapturedError | null;
}

export const DEFAULT_MAX_ERRORS = 10;
export const DEFAULT_MAX_ERROR_AGE_MS = 600_000;
export const DEFAULT_MAX_STACK_CHARS = 2000;
export const MAX_ERROR_MESSAGE_CHARS = 500;

/** Lines the SDK's own logger writes; never fed back to the agent. */
const SDK_LOG_PREFIX = "[AGO SDK]";
/** Cap on a stringified non-Error `console.error` argument. */
const MAX_CONSOLE_ARG_CHARS = 300;

type ConsoleError = (...data: unknown[]) => void;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `…[truncated ${text.length - max} chars]`;
}

function stripQuery(url: string): string {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
}

function isErrorLike(value: unknown): value is { message: string; stack?: string; name?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (isErrorLike(arg)) {
    const name = typeof arg.name === "string" && arg.name ? `${arg.name}: ` : "";
    return name + arg.message;
  }
  if (typeof arg === "object" && arg !== null) {
    try {
      return truncate(JSON.stringify(arg), MAX_CONSOLE_ARG_CHARS);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

/** Message + stack from anything that can be thrown or rejected with. */
function describeThrown(value: unknown): { message: string; stack?: string } {
  if (isErrorLike(value)) {
    const name = typeof value.name === "string" && value.name && value.name !== "Error"
      ? `${value.name}: `
      : "";
    return {
      message: name + value.message,
      stack: typeof value.stack === "string" ? value.stack : undefined,
    };
  }
  return { message: stringifyArg(value) };
}

/**
 * Captures the page's JavaScript errors so they can ride along as agent
 * context: uncaught exceptions (`window` `error` event), unhandled promise
 * rejections, every `console.error` call, and errors the app reports itself
 * via {@link report}.
 *
 * Errors are deduplicated by type + message + source + line (a repeat bumps
 * `count` and `lastAt`), capped at `maxErrors`, and pruned after `maxAgeMs`
 * when read. Messages and stacks are truncated so one error cannot bloat the
 * context.
 *
 * `console.error` capture wraps the console method. This is the one sanctioned
 * exception to the SDK's no-global-mutation rule: the wrapper always calls the
 * original, ignores the SDK's own `[AGO SDK]` lines, and is restored by
 * {@link destroy} when it is still installed (another library may have
 * wrapped it after us; in that case ours stays in the chain and keeps calling
 * through).
 *
 * Attached by `AgoClient` when `errorWatcher` is set in the config; usable
 * standalone. Listeners are attached only by `start()` and removed by
 * `destroy()`. No-op outside a browser (SSR).
 */
export class ErrorWatcher {
  private readonly maxErrors: number;
  private readonly maxAgeMs: number;
  private readonly maxStackChars: number;
  private readonly filter?: (error: CapturedError) => CapturedError | null;

  private started = false;
  private teardowns: Array<() => void> = [];
  private errors: CapturedError[] = [];
  private listeners = new Set<(error: CapturedError) => void>();
  /** True while a capture is being processed (a throw inside must not recurse). */
  private capturing = false;

  constructor(options: ErrorWatcherOptions = {}) {
    const max = Math.floor(options.maxErrors ?? DEFAULT_MAX_ERRORS);
    this.maxErrors = Number.isFinite(max) ? Math.max(1, max) : DEFAULT_MAX_ERRORS;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_ERROR_AGE_MS;
    this.maxStackChars = options.maxStackChars ?? DEFAULT_MAX_STACK_CHARS;
    this.filter = options.filter;
  }

  /** Attach the listeners and wrap `console.error`. Idempotent; no-op in SSR. */
  start(): void {
    if (this.started) return;
    if (typeof window === "undefined") return;
    this.started = true;

    const onError = (event: Event) => this.onErrorEvent(event as ErrorEvent);
    window.addEventListener("error", onError);
    this.teardowns.push(() => window.removeEventListener("error", onError));

    const onRejection = (event: Event) => this.onRejectionEvent(event);
    window.addEventListener("unhandledrejection", onRejection);
    this.teardowns.push(() =>
      window.removeEventListener("unhandledrejection", onRejection)
    );

    this.wrapConsoleError();

    logger.log("ErrorWatcher started");
  }

  /** Remove the listeners, restore `console.error`, drop subscribers. */
  destroy(): void {
    for (const teardown of this.teardowns) teardown();
    this.teardowns = [];
    this.listeners.clear();
    this.started = false;
    logger.log("ErrorWatcher destroyed");
  }

  /**
   * Record an error the app caught itself (error boundary, framework error
   * handler, try/catch). `context` is size-clamped before it is stored.
   */
  report(error: unknown, context?: Record<string, unknown>): void {
    const described = describeThrown(error);
    this.capture({
      type: "manual",
      message: described.message,
      stack: described.stack,
      ...(context ? { context: clampActivityData(context) } : {}),
    });
  }

  /** Subscribe to captures (fires once per capture, repeats included). */
  subscribe(listener: (error: CapturedError) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Errors still within `maxAgeMs`, oldest first (a copy). */
  getErrors(): CapturedError[] {
    this.prune();
    return this.errors.map((e) => ({ ...e }));
  }

  clear(): void {
    this.errors = [];
  }

  // ───────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────

  private onErrorEvent(event: ErrorEvent): void {
    // Resource load failures (img/script 404) dispatch a plain Event on the
    // element; they never reach a bubbling `window` listener, but guard anyway.
    if (typeof event.message !== "string" && !event.error) return;
    const described = event.error !== undefined && event.error !== null
      ? describeThrown(event.error)
      : { message: event.message ?? "" };
    this.capture({
      type: "error",
      message: described.message || event.message || "Unknown error",
      stack: described.stack,
      source: event.filename ? stripQuery(event.filename) : undefined,
      line: event.lineno || undefined,
      col: event.colno || undefined,
    });
  }

  private onRejectionEvent(event: Event): void {
    const reason = (event as { reason?: unknown }).reason;
    const described = describeThrown(reason);
    this.capture({
      type: "unhandledrejection",
      message: described.message || "Unhandled promise rejection",
      stack: described.stack,
    });
  }

  private wrapConsoleError(): void {
    if (typeof console === "undefined" || typeof console.error !== "function") {
      return;
    }
    const original: ConsoleError = console.error;
    const wrapped: ConsoleError = (...args: unknown[]) => {
      try {
        this.onConsoleError(args);
      } catch {
        // Never let the watcher break the host's logging.
      }
      return original.apply(console, args);
    };
    console.error = wrapped;
    this.teardowns.push(() => {
      // Restore only if we are still the outermost wrapper; otherwise leave the
      // chain intact (ours keeps calling through and is harmless).
      if (console.error === wrapped) console.error = original;
    });
  }

  private onConsoleError(args: unknown[]): void {
    if (args.length === 0) return;
    const first = args[0];
    if (typeof first === "string" && first.startsWith(SDK_LOG_PREFIX)) return;
    const errorArg = args.find(isErrorLike);
    const message = args.map(stringifyArg).join(" ");
    this.capture({
      type: "console",
      message,
      stack: errorArg && typeof errorArg.stack === "string" ? errorArg.stack : undefined,
    });
  }

  private capture(
    input: Omit<CapturedError, "route" | "firstAt" | "lastAt" | "count">
  ): void {
    if (this.capturing) return;
    this.capturing = true;
    try {
      const now = Date.now();
      const stack = input.stack !== undefined
        ? this.trimStack(input.stack, input.message)
        : undefined;
      let entry: CapturedError = {
        type: input.type,
        message: truncate(input.message, MAX_ERROR_MESSAGE_CHARS),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.line !== undefined ? { line: input.line } : {}),
        ...(input.col !== undefined ? { col: input.col } : {}),
        ...(stack ? { stack } : {}),
        route: this.currentPathname(),
        firstAt: now,
        lastAt: now,
        count: 1,
        ...(input.context !== undefined ? { context: input.context } : {}),
      };

      if (this.filter) {
        const kept = this.filter(entry);
        if (!kept) return;
        entry = kept;
      }

      this.prune(now);
      const key = fingerprint(entry);
      const existing = this.errors.find((e) => fingerprint(e) === key);
      if (existing) {
        existing.count += 1;
        existing.lastAt = now;
        if (entry.context !== undefined) existing.context = entry.context;
        this.notify(existing);
        return;
      }

      this.errors.push(entry);
      const overflow = this.errors.length - this.maxErrors;
      if (overflow > 0) this.errors.splice(0, overflow);
      this.notify(entry);
    } finally {
      this.capturing = false;
    }
  }

  private notify(error: CapturedError): void {
    const copy = { ...error };
    for (const listener of this.listeners) {
      try {
        listener(copy);
      } catch (err) {
        logger.error("ErrorWatcher listener threw:", err);
      }
    }
  }

  private prune(now: number = Date.now()): void {
    if (!Number.isFinite(this.maxAgeMs)) return;
    this.errors = this.errors.filter((e) => now - e.lastAt <= this.maxAgeMs);
  }

  /** Drop the leading "Name: message" line stacks repeat, then cap the length. */
  private trimStack(stack: string, message: string): string | undefined {
    let text = stack;
    const firstNewline = text.indexOf("\n");
    if (firstNewline !== -1 && text.slice(0, firstNewline).includes(message.slice(0, 80))) {
      text = text.slice(firstNewline + 1);
    }
    text = text.trim();
    if (!text) return undefined;
    return truncate(text, this.maxStackChars);
  }

  private currentPathname(): string {
    return typeof window !== "undefined" && window.location
      ? window.location.pathname
      : "";
  }
}

function fingerprint(e: CapturedError): string {
  return `${e.type}|${e.message}|${e.source ?? ""}|${e.line ?? ""}`;
}
