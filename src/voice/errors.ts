import { AgoError } from "../client/errors";

/**
 * Closed registry of voice error codes. Kebab-case, stable for the 1.x line.
 * Server snake_case reasons are mapped in (see {@link serverReasonToCode});
 * the raw server value is preserved as `serverReason`.
 */
export type AgoVoiceErrorCode =
  | "mic-denied"
  | "no-mic"
  | "mic-busy"
  | "mic-lost"
  | "insecure-context"
  | "worklet-unsupported"
  | "csp-blocked"
  | "audio-init-failed"
  | "jwt-required"
  | "mint-failed"
  | "rate-limited"
  | "connect-failed"
  | "connection-lost"
  | "invalid-token"
  | "origin-not-allowed"
  | "kill-switch"
  | "concurrent-cap"
  | "daily-minutes-cap"
  | "backend-unavailable"
  | "server-error"
  | "voice-unavailable"
  | "session-active"
  | "session-destroyed";

const DOC_URL_BASE =
  "https://github.com/useago/ago-sdk/blob/main/docs/general/voice.md#error-codes";

interface CodeEntry {
  message: string;
  retryable: boolean;
}

const REGISTRY: Record<AgoVoiceErrorCode, CodeEntry> = {
  "mic-denied": {
    message:
      "Microphone blocked. Allow microphone access in the browser's address bar, then retry.",
    retryable: true,
  },
  "no-mic": {
    message: "No microphone found on this device.",
    retryable: false,
  },
  "mic-busy": {
    message:
      "The microphone is in use by another application. Close it, then retry.",
    retryable: true,
  },
  "mic-lost": {
    message: "The microphone was disconnected or revoked during the call.",
    retryable: false,
  },
  "insecure-context": {
    message:
      "Voice requires a secure context (HTTPS; localhost is the only HTTP exception).",
    retryable: false,
  },
  "worklet-unsupported": {
    message: "This browser does not support the AudioWorklet APIs voice needs.",
    retryable: false,
  },
  "csp-blocked": {
    message:
      "The page's Content-Security-Policy blocked the audio worklet. Allow blob: " +
      "in worker-src (and script-src on some browsers).",
    retryable: false,
  },
  "audio-init-failed": {
    message: "Audio initialization failed. Voice is not supported here.",
    retryable: false,
  },
  "jwt-required": {
    message:
      "Voice requires an authenticated AGO user. Anonymous widget IDs and " +
      "userEmail do not qualify. Provide a signed JWT via userJwt/getUserJwt, " +
      "then retry.",
    retryable: false,
  },
  "mint-failed": {
    message: "Could not create a voice session. Retry in a moment.",
    retryable: true,
  },
  "rate-limited": {
    message: "Too many voice session requests. Wait before retrying.",
    retryable: false,
  },
  "connect-failed": {
    message: "Could not connect to the voice service.",
    retryable: true,
  },
  "connection-lost": {
    message: "The voice connection was lost.",
    retryable: true,
  },
  "invalid-token": {
    message: "The voice session token was rejected (expired or already used).",
    retryable: true,
  },
  "origin-not-allowed": {
    message:
      "This page's origin is not allow-listed for voice. Ask AGO to add the exact origin (scheme, host and port).",
    retryable: false,
  },
  "kill-switch": {
    message: "Voice is temporarily disabled by the operator.",
    retryable: false,
  },
  "concurrent-cap": {
    message: "Voice is busy (concurrent session cap reached). Try again later.",
    retryable: false,
  },
  "daily-minutes-cap": {
    message: "The daily voice minutes cap was reached. Try again tomorrow.",
    retryable: false,
  },
  "backend-unavailable": {
    message: "The voice backend is temporarily unavailable.",
    retryable: true,
  },
  "server-error": {
    message: "The voice server reported an error.",
    retryable: false,
  },
  "voice-unavailable": {
    message:
      "Voice is not enabled for this tenant or agent. Ask AGO to enable it.",
    retryable: false,
  },
  "session-active": {
    message:
      "A voice session is already active. Call stop() before starting another one.",
    retryable: false,
  },
  "session-destroyed": {
    message: "This voice session was destroyed. Create a new client to use voice.",
    retryable: false,
  },
};

/** Map of server snake_case error reasons to registry codes. */
const SERVER_REASON_TO_CODE: Record<string, AgoVoiceErrorCode> = {
  invalid_token: "invalid-token",
  origin_not_allowed: "origin-not-allowed",
  kill_switch: "kill-switch",
  concurrent_cap: "concurrent-cap",
  daily_minutes_cap: "daily-minutes-cap",
  backend_unavailable: "backend-unavailable",
  jwt_required: "jwt-required",
};

/** Resolve a server snake_case reason to a registry code (unknown reasons map
 *  to `server-error`; the raw value survives as `serverReason`). */
export function serverReasonToCode(reason: string): AgoVoiceErrorCode {
  return SERVER_REASON_TO_CODE[reason] ?? "server-error";
}

export interface AgoVoiceErrorOptions {
  /** Override the registry message (the registry default is appended context). */
  message?: string;
  /** Extra detail appended to the message (e.g. the blocked CSP directive). */
  detail?: string;
  /** Seconds to wait before a retry makes sense (server-provided). */
  retryAfter?: number;
  /** Raw server reason (snake_case) this error was mapped from. */
  serverReason?: string;
  statusCode?: number;
}

/**
 * Voice error. `code` is the stable compatibility surface (kebab-case, closed
 * registry). Instances are always `console.error`'d when emitted as
 * `voice:error`, matching the SDK's error-surfacing behavior.
 */
export class AgoVoiceError extends AgoError {
  readonly retryable: boolean;
  readonly retryAfter?: number;
  readonly docUrl: string;
  readonly serverReason?: string;

  constructor(code: AgoVoiceErrorCode, options: AgoVoiceErrorOptions = {}) {
    const entry = REGISTRY[code];
    const docUrl = `${DOC_URL_BASE.split("#")[0]}#${code}`;
    const base = options.message ?? entry.message;
    const detail = options.detail ? ` (${options.detail})` : "";
    super(`${base}${detail} See ${docUrl}`, code, options.statusCode);
    this.name = "AgoVoiceError";
    this.retryable = entry.retryable;
    this.retryAfter = options.retryAfter;
    this.docUrl = docUrl;
    this.serverReason = options.serverReason;
  }

  /** Build a voice error from a server `error` frame or typed HTTP reason. */
  static fromServerReason(
    reason: string,
    options: Omit<AgoVoiceErrorOptions, "serverReason"> = {}
  ): AgoVoiceError {
    return new AgoVoiceError(serverReasonToCode(reason), {
      ...options,
      serverReason: reason,
    });
  }
}
