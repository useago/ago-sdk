import { useCallback, useEffect, useRef, useState } from "react";
import type { AgoClient } from "../../client/AgoClient";
import type { AgoVoice } from "../../voice/controller";
import type { AgoVoiceError } from "../../voice/errors";
import type {
  VoiceAvailability,
  VoiceCaption,
  VoiceEndedReason,
  VoiceSessionState,
  VoiceStartOptions,
  VoiceStatus,
  VoiceTurn,
  VoiceUnavailableReason,
} from "../../voice/types";
import { useOptionalAgoClient } from "../context/AgoContext";

export interface UseAgoVoiceOptions {
  /** The AGO client instance. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
}

/**
 * State and controls of the client's voice session. The single-object handoff
 * for the voice components: `<AgoVoiceButton voice={voice} />` etc.
 *
 * This shape (like the status/turn/event/error-code vocabulary it exposes) is
 * stable for the 1.x line.
 */
export interface UseAgoVoiceResult {
  /** Resolves post-mount. Render nothing while `"loading"`; never render a mic when unavailable. */
  availability: VoiceAvailability;
  /** Why voice is unavailable (paired with a non-available availability). */
  unavailableReason?: VoiceUnavailableReason;
  /** Connection lifecycle of the session. */
  status: VoiceStatus;
  /** Turn-taking sub-state while `status === "live"`. */
  turn: VoiceTurn;
  muted: boolean;
  degraded: boolean;
  /** A `start()` is paused on the consent gate (accept or cancel it). */
  consentPending: boolean;
  /** Transient live captions (assistant streams; user captions are final-only). */
  captions: VoiceCaption[];
  /** Live mic input level 0..1 (0 while muted or during agent speech). */
  level: number;
  error?: AgoVoiceError;
  endedReason?: VoiceEndedReason;
  /** Thread the session writes to, once the server confirms it. */
  conversationId?: string;
  /** Start a session (pauses on `consentPending` when consent is required). */
  start: (options?: VoiceStartOptions) => Promise<void>;
  /** End the session (idempotent; cancels an in-flight start). */
  stop: () => void;
  toggleMute: () => void;
  acceptConsent: () => void;
  cancelConsent: () => void;
  /** Start again after an error, reusing the last `start()` options. */
  retry: () => void;
  /** Clear a shown error without retrying (the bar unmounts). */
  dismissError: () => void;
}

// One availability probe per controller: StrictMode double-mounts and multiple
// voice components on a page must not re-run the diagnostic (or re-print it).
const availabilityProbes = new WeakMap<AgoVoice, Promise<unknown>>();
// One warning per controller when voice is unavailable.
const warnedControllers = new WeakSet<AgoVoice>();

const UNAVAILABLE_FIX: Record<VoiceUnavailableReason, string> = {
  "tenant-disabled":
    "voice is not enabled for this tenant. Ask AGO to enable voice for your tenant.",
  "agent-not-voice":
    "the configured agent is not a voice agent. Ask AGO to enable voice for this agent.",
  "jwt-missing":
    "no signed user JWT is configured. Pass userJwt or getUserJwt in the client config (userEmail and anonymous widget ids do not qualify).",
  "insecure-context":
    "the page is not a secure context. Serve it over HTTPS (localhost is the only HTTP exception).",
  "worklet-unsupported":
    "this browser lacks the AudioWorklet APIs voice needs.",
  "csp-blocked":
    "the page's Content-Security-Policy blocked the audio worklet. Allow blob: in worker-src (and script-src on some browsers).",
};

const SUBSCRIBED_EVENTS = [
  "voice:status",
  "voice:transcript",
  "voice:turn-final",
  "voice:level",
  "voice:error",
  "voice:ended",
  "voice:thread-ready",
] as const;

/**
 * Subscribe to the client's voice session (`client.voice`).
 *
 * The hook does NOT own the session: `client.voice` is the lazy singleton
 * owner (at most one active session per client), so several components can
 * share one call and a React StrictMode remount re-subscribes without killing
 * a live call. `client.destroy()` is what stops the session and releases the
 * microphone.
 *
 * On mount it resolves `availability` (once per client) and, when voice is
 * policy-unavailable or unsupported, logs one console warning naming the
 * failed gate and its fix.
 */
export function useAgoVoice(
  options: UseAgoVoiceOptions = {}
): UseAgoVoiceResult {
  const contextClient = useOptionalAgoClient();
  const client = options.client || contextClient;

  if (!client) {
    throw new Error(
      "useAgoVoice requires an AgoClient. Either pass it as options.client or wrap your app in <AgoProvider>."
    );
  }

  const voice = client.voice;

  const [state, setState] = useState<VoiceSessionState>(() => voice.getState());
  const [dismissed, setDismissed] = useState(false);
  const lastStartOptions = useRef<VoiceStartOptions | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const update = () => setState(voice.getState());
    for (const event of SUBSCRIBED_EVENTS) voice.on(event, update);
    // Resync: events emitted during a StrictMode unmount gap (or before this
    // effect ran) are reflected in the controller state, not in ours yet.
    update();

    let probe = availabilityProbes.get(voice);
    if (!probe) {
      probe = voice.checkAvailability().catch(() => undefined);
      availabilityProbes.set(voice, probe);
    }
    void probe.then(() => {
      if (cancelled) return;
      const next = voice.getState();
      setState(next);
      if (
        (next.availability === "policy-unavailable" ||
          next.availability === "unsupported") &&
        !warnedControllers.has(voice)
      ) {
        warnedControllers.add(voice);
        const reason = next.unavailableReason;
        const fix = reason
          ? UNAVAILABLE_FIX[reason]
          : "run client.voice.checkAvailability() for the full diagnostic.";
        console.warn(
          `[AGO] voice is ${next.availability}` +
            `${reason ? ` (${reason})` : ""}: ${fix} ` +
            "The voice UI will not render."
        );
      }
    });

    return () => {
      cancelled = true;
      // Unsubscribe only: never stop the session here. The controller owns it,
      // and a StrictMode revive must not kill a live call.
      for (const event of SUBSCRIBED_EVENTS) voice.off(event, update);
    };
  }, [voice]);

  // An error dismissal only makes sense while that error is still current.
  useEffect(() => {
    if (dismissed && state.status !== "error") setDismissed(false);
  }, [dismissed, state.status]);

  const start = useCallback(
    (startOptions?: VoiceStartOptions) => {
      lastStartOptions.current = startOptions;
      setDismissed(false);
      return voice.start(startOptions);
    },
    [voice]
  );

  const stop = useCallback(() => voice.stop(), [voice]);
  const toggleMute = useCallback(() => voice.toggleMute(), [voice]);
  const acceptConsent = useCallback(() => voice.acceptConsent(), [voice]);
  const cancelConsent = useCallback(() => voice.cancelConsent(), [voice]);

  const retry = useCallback(() => {
    setDismissed(false);
    void voice.start(lastStartOptions.current).catch(() => {
      // The engine surfaces failures through voice:error; a synchronous
      // rejection here (e.g. session-active from a double click) is benign.
    });
  }, [voice]);

  const dismissError = useCallback(() => setDismissed(true), []);

  const presentedStatus: VoiceStatus =
    dismissed && state.status === "error" ? "idle" : state.status;

  return {
    availability: state.availability,
    unavailableReason: state.unavailableReason,
    status: presentedStatus,
    turn: state.turn,
    muted: state.muted,
    degraded: state.degraded,
    consentPending: state.consentPending,
    captions: state.captions,
    level: state.level,
    error: dismissed ? undefined : state.error,
    endedReason: state.endedReason,
    conversationId: state.conversationId,
    start,
    stop,
    toggleMute,
    acceptConsent,
    cancelConsent,
    retry,
    dismissError,
  };
}
