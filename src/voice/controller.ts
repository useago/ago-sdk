import type { HttpClient } from "../api/HttpClient";
import type { AgoVoiceEvents, VoiceAvailabilityReport, VoiceSessionState, VoiceStartOptions } from "./types";
import type { VoiceSession } from "./VoiceSession";

/**
 * The `client.voice` surface: a lazy singleton controller over at most one
 * active {@link VoiceSession}.
 *
 * The controller itself ships in the core bundle; the session engine (and the
 * audio worklet sources) load through a dynamic import on first use, so
 * chat-only bundles carry none of it.
 *
 * @experimental The controller surface may still move while voice is in its
 * staff-gated rollout. The status/turn/event/error-code vocabulary it exposes
 * is stable.
 */
export interface AgoVoice {
  /**
   * Start a voice session. At most one session is active per client: calling
   * `start()` while one is active rejects with the `session-active` voice
   * error. With consent required (the default) the first call pauses with
   * `consentPending: true` instead of touching the microphone.
   */
  start(options?: VoiceStartOptions): Promise<void>;
  /** End the session (idempotent; cancels an in-flight start at any point). */
  stop(): void;
  /** Mute/unmute the microphone. */
  toggleMute(): void;
  /** Accept the consent gate; resumes a start() paused on consentPending. */
  acceptConsent(): void;
  /** Decline the consent gate; drops the paused start(). */
  cancelConsent(): void;
  /** Async readiness diagnostic (secure context, worklet, auth, gates). */
  checkAvailability(): Promise<VoiceAvailabilityReport>;
  /** Snapshot of the full session state. */
  getState(): VoiceSessionState;
  /** Subscribe to a voice event on the session's own emitter. */
  on<K extends keyof AgoVoiceEvents>(
    event: K,
    handler: (data: AgoVoiceEvents[K]) => void
  ): void;
  off<K extends keyof AgoVoiceEvents>(
    event: K,
    handler: (data: AgoVoiceEvents[K]) => void
  ): void;
  /** The underlying session engine (loads it on first call). */
  getSession(): Promise<VoiceSession>;
  /** Stop any live session, release the mic, and drop all listeners. */
  destroy(): void;
}

export interface VoiceControllerDeps {
  http: HttpClient;
  getAgent: () => string | undefined;
  getPermission: () => string | undefined;
  requireConsent?: boolean;
  forward: <K extends keyof AgoVoiceEvents>(
    event: K,
    data: AgoVoiceEvents[K]
  ) => void;
}

const INITIAL_STATE: VoiceSessionState = {
  availability: "loading",
  status: "idle",
  turn: "listening",
  muted: false,
  degraded: false,
  consentPending: false,
  captions: [],
  level: 0,
};

type PendingSubscription = {
  event: keyof AgoVoiceEvents;
  handler: (data: AgoVoiceEvents[keyof AgoVoiceEvents]) => void;
};

export function createVoiceController(deps: VoiceControllerDeps): AgoVoice {
  let sessionPromise: Promise<VoiceSession> | null = null;
  let session: VoiceSession | null = null;
  let destroyed = false;
  const pendingSubscriptions: PendingSubscription[] = [];

  function ensureSession(): Promise<VoiceSession> {
    if (!sessionPromise) {
      sessionPromise = import("./VoiceSession").then((mod) => {
        const created = new mod.VoiceSession({
          http: deps.http,
          getAgent: deps.getAgent,
          getPermission: deps.getPermission,
          requireConsent: deps.requireConsent,
          forward: deps.forward,
        });
        for (const sub of pendingSubscriptions) {
          created.on(sub.event, sub.handler);
        }
        pendingSubscriptions.length = 0;
        session = created;
        if (destroyed) created.destroy();
        return created;
      });
    }
    return sessionPromise;
  }

  /** Run an engine call once loaded, preserving call order through the same
   *  promise chain (a stop() queued behind a loading start() still wins via
   *  the engine's generation token). */
  function withSession(action: (s: VoiceSession) => void): void {
    if (session) {
      action(session);
      return;
    }
    if (sessionPromise) {
      void sessionPromise.then(action);
    }
  }

  return {
    async start(options?: VoiceStartOptions): Promise<void> {
      const s = await ensureSession();
      return s.start(options);
    },
    stop(): void {
      withSession((s) => s.stop());
    },
    toggleMute(): void {
      withSession((s) => s.toggleMute());
    },
    acceptConsent(): void {
      withSession((s) => s.acceptConsent());
    },
    cancelConsent(): void {
      withSession((s) => s.cancelConsent());
    },
    async checkAvailability(): Promise<VoiceAvailabilityReport> {
      const s = await ensureSession();
      return s.checkAvailability();
    },
    getState(): VoiceSessionState {
      return session ? session.getState() : { ...INITIAL_STATE, captions: [] };
    },
    on(event, handler): void {
      if (session) {
        session.on(event, handler);
      } else {
        // Queued until the engine loads (ensureSession flushes the queue).
        pendingSubscriptions.push({
          event,
          handler: handler as PendingSubscription["handler"],
        });
      }
    },
    off(event, handler): void {
      if (session) {
        session.off(event, handler);
        return;
      }
      const index = pendingSubscriptions.findIndex(
        (sub) =>
          sub.event === event &&
          sub.handler === (handler as PendingSubscription["handler"])
      );
      if (index >= 0) pendingSubscriptions.splice(index, 1);
    },
    getSession(): Promise<VoiceSession> {
      return ensureSession();
    },
    destroy(): void {
      destroyed = true;
      pendingSubscriptions.length = 0;
      withSession((s) => s.destroy());
    },
  };
}
