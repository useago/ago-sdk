import type { AgoVoice } from "../voice/controller";
import { AgoVoiceError } from "../voice/errors";
import type {
  AgoVoiceEvents,
  VoiceAvailability,
  VoiceAvailabilityReport,
  VoiceCaption,
  VoiceEndedReason,
  VoiceSessionState,
  VoiceStartOptions,
  VoiceUnavailableReason,
} from "../voice/types";
import type { VoiceSession } from "../voice/VoiceSession";

/** One scripted voice exchange: what the user says, what the agent answers. */
export interface MockVoiceTurn {
  user: string;
  assistant: string;
}

/** Options of {@link mockVoiceConversation}. */
export interface MockVoiceConversationOptions {
  /** The exchanges to play, in order. */
  turns: MockVoiceTurn[];
  /** Delay between scripted steps in ms (default 300). Timer-driven, so fake
   *  timers step it deterministically and real timers animate it. */
  stepMs?: number;
  /** Thread id reported on `voice:thread-ready` and persisted acks. */
  conversationId?: string;
  /** Reason reported when the scripted call ends (default `"ended"`). */
  endedReason?: VoiceEndedReason;
}

/** Handle returned by {@link mockVoiceConversation}. */
export interface MockVoiceConversationHandle {
  /** Start programmatically (start + accept consent), skipping the button. */
  play: () => Promise<void>;
  /** Resolves once the scripted conversation has fully ended. */
  finished: Promise<void>;
}

/** Voice options of `createMockClient`. */
export interface MockVoiceOptions {
  /** Default `true`, like the real engine: first start() pauses on consent. */
  requireConsent?: boolean;
  /** Availability the mock reports (default `"available"`). */
  availability?: VoiceAvailability;
  unavailableReason?: VoiceUnavailableReason;
}

/** The mock `client.voice`: a scriptable stand-in for the voice controller. */
export interface MockVoiceController extends AgoVoice {
  /** Merge state directly and emit `voice:status` (low-level test hook). */
  __setVoiceState(partial: Partial<VoiceSessionState>): void;
  /** Emit a voice event as if the engine produced it. */
  __emitVoiceEvent<K extends keyof AgoVoiceEvents>(
    event: K,
    data: AgoVoiceEvents[K]
  ): void;
  /** Arm a scripted conversation (used by {@link mockVoiceConversation}). */
  __arm(options: MockVoiceConversationOptions): MockVoiceConversationHandle;
}

const ACTIVE_STATUSES = [
  "requesting-permission",
  "connecting",
  "live",
  "reconnecting",
];

/**
 * Create a mock voice controller: the full `client.voice` surface with no
 * microphone, WebSocket, or backend. Deterministic and timer-driven, so the
 * voice components animate end-to-end in jsdom or Storybook.
 */
export function createMockVoice(
  options: MockVoiceOptions = {},
  record: (method: string, args: unknown[]) => void = () => undefined
): MockVoiceController {
  const requireConsent = options.requireConsent !== false;

  type Handler = (data: AgoVoiceEvents[keyof AgoVoiceEvents]) => void;
  const listeners = new Map<keyof AgoVoiceEvents, Set<Handler>>();

  let state: VoiceSessionState = {
    availability: options.availability ?? "available",
    unavailableReason: options.unavailableReason,
    status: "idle",
    turn: "listening",
    muted: false,
    degraded: false,
    consentPending: false,
    captions: [],
    level: 0,
  };

  let consentAccepted = false;
  let destroyed = false;
  let generation = 0;
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let script: MockVoiceConversationOptions | null = null;
  let resolveFinished: (() => void) | null = null;

  function emit<K extends keyof AgoVoiceEvents>(
    event: K,
    data: AgoVoiceEvents[K]
  ): void {
    if (destroyed) return;
    const handlers = listeners.get(event);
    if (handlers) [...handlers].forEach((h) => h(data));
  }

  function setState(partial: Partial<VoiceSessionState>): void {
    state = { ...state, ...partial };
  }

  function emitStatus(): void {
    emit("voice:status", {
      status: state.status,
      turn: state.turn,
      muted: state.muted,
      degraded: state.degraded,
      consentPending: state.consentPending,
    });
  }

  function schedule(gen: number, delay: number, fn: () => void): void {
    const timer = setTimeout(() => {
      if (gen === generation && !destroyed) fn();
    }, delay);
    timers.push(timer);
  }

  function clearTimers(): void {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function isActive(): boolean {
    return state.consentPending || ACTIVE_STATUSES.includes(state.status);
  }

  function finishScript(): void {
    resolveFinished?.();
    resolveFinished = null;
  }

  /** Split text into at most four cumulative streaming chunks. */
  function streamChunks(text: string): string[] {
    const words = text.split(" ");
    const groups = Math.min(4, words.length);
    const perGroup = Math.ceil(words.length / groups);
    const chunks: string[] = [];
    for (let i = 1; i <= groups; i++) {
      chunks.push(words.slice(0, i * perGroup).join(" "));
    }
    return chunks;
  }

  function beginSession(): void {
    const gen = ++generation;
    const stepMs = script?.stepMs ?? 300;
    const threadId = script?.conversationId ?? "mock-voice-thread";
    let at = 0;
    const step = (fn: () => void): void => {
      at += stepMs;
      schedule(gen, at, fn);
    };

    setState({
      status: "requesting-permission",
      turn: "listening",
      captions: [],
      level: 0,
      error: undefined,
      endedReason: undefined,
      degraded: false,
    });
    emitStatus();

    step(() => {
      setState({ status: "connecting" });
      emitStatus();
    });
    step(() => {
      setState({ status: "live", turn: "listening", conversationId: threadId });
      emitStatus();
      emit("voice:thread-ready", { threadId });
    });

    for (const [index, turn] of (script?.turns ?? []).entries()) {
      // User side: level pulses and a speaking indicator, then a FINAL-ONLY
      // transcript (matching the wire protocol: user captions never stream).
      for (const level of [0.55, 0.72, 0.4]) {
        step(() => {
          setState({ turn: "user-speaking", level });
          if (level === 0.55) emitStatus();
          emit("voice:level", level);
        });
      }
      step(() => {
        const caption: VoiceCaption = {
          role: "user",
          text: turn.user,
          final: true,
        };
        setState({ turn: "agent-thinking", level: 0 });
        emit("voice:level", 0);
        emit("voice:transcript", caption);
        emit("voice:turn-final", caption);
        emitStatus();
        emit("voice:persisted", {
          messageId: `mock-voice-user-${index + 1}`,
          role: "user",
          threadId,
          text: turn.user.slice(0, 64),
          turnIndex: index * 2,
        });
      });

      // Assistant side: captions stream in cumulative chunks, then finalize
      // and persist.
      for (const [chunkIndex, text] of streamChunks(turn.assistant).entries()) {
        step(() => {
          const caption: VoiceCaption = {
            role: "assistant",
            text,
            final: false,
          };
          setState({ turn: "agent-speaking", captions: [caption] });
          if (chunkIndex === 0) emitStatus();
          emit("voice:transcript", caption);
        });
      }
      step(() => {
        const caption: VoiceCaption = {
          role: "assistant",
          text: turn.assistant,
          final: true,
        };
        setState({ turn: "listening", captions: [] });
        emit("voice:transcript", caption);
        emit("voice:turn-final", caption);
        emitStatus();
        emit("voice:persisted", {
          messageId: `mock-voice-assistant-${index + 1}`,
          role: "assistant",
          threadId,
          text: turn.assistant.slice(0, 64),
          turnIndex: index * 2 + 1,
        });
      });
    }

    if (script) {
      const reason = script.endedReason ?? "ended";
      step(() => {
        setState({ status: "ended", endedReason: reason, level: 0 });
        emitStatus();
        emit("voice:ended", { reason });
        finishScript();
      });
    }
  }

  const controller: MockVoiceController = {
    async start(startOptions?: VoiceStartOptions): Promise<void> {
      record("start", startOptions === undefined ? [] : [startOptions]);
      if (destroyed) throw new AgoVoiceError("session-destroyed");
      if (isActive()) throw new AgoVoiceError("session-active");
      if (requireConsent && !consentAccepted) {
        setState({ consentPending: true });
        emitStatus();
        return;
      }
      beginSession();
    },

    stop(): void {
      record("stop", []);
      if (destroyed) return;
      clearTimers();
      generation++;
      if (state.consentPending && !ACTIVE_STATUSES.includes(state.status)) {
        setState({ consentPending: false });
        emitStatus();
        return;
      }
      if (ACTIVE_STATUSES.includes(state.status)) {
        setState({
          status: "ended",
          consentPending: false,
          endedReason: "stopped",
          level: 0,
        });
        emitStatus();
        emit("voice:ended", { reason: "stopped" });
        finishScript();
      }
    },

    toggleMute(): void {
      record("toggleMute", []);
      if (destroyed) return;
      const muted = !state.muted;
      setState({ muted, level: muted ? 0 : state.level });
      emitStatus();
      if (muted) emit("voice:level", 0);
    },

    acceptConsent(): void {
      record("acceptConsent", []);
      if (destroyed) return;
      consentAccepted = true;
      if (!state.consentPending) return;
      setState({ consentPending: false });
      emitStatus();
      beginSession();
    },

    cancelConsent(): void {
      record("cancelConsent", []);
      if (destroyed || !state.consentPending) return;
      setState({ consentPending: false });
      emitStatus();
    },

    async checkAvailability(): Promise<VoiceAvailabilityReport> {
      record("checkAvailability", []);
      return {
        availability: state.availability,
        unavailableReason: state.unavailableReason,
        checks: {
          secureContext: true,
          workletSupported: true,
          authKind: "jwt",
          tenantEnabled: state.availability === "available",
          agentIsVoiceAgent: state.availability === "available",
        },
      };
    },

    getState(): VoiceSessionState {
      return { ...state, captions: [...state.captions] };
    },

    on(event, handler): void {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler as Handler);
    },

    off(event, handler): void {
      listeners.get(event)?.delete(handler as Handler);
    },

    getSession(): Promise<VoiceSession> {
      // The mock has no real engine; it stands in for the whole surface.
      return Promise.resolve(controller as unknown as VoiceSession);
    },

    destroy(): void {
      record("destroy", []);
      controller.stop();
      destroyed = true;
      listeners.clear();
    },

    __setVoiceState(partial: Partial<VoiceSessionState>): void {
      setState(partial);
      emitStatus();
    },

    __emitVoiceEvent(event, data): void {
      emit(event, data);
    },

    __arm(
      scriptOptions: MockVoiceConversationOptions
    ): MockVoiceConversationHandle {
      script = scriptOptions;
      const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });
      return {
        play: async () => {
          if (!isActive()) await controller.start();
          if (state.consentPending) controller.acceptConsent();
        },
        finished,
      };
    },
  };

  return controller;
}
