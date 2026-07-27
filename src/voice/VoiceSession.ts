import type { HttpClient } from "../api/HttpClient";
import type { ClientFunctionSchema } from "../functions/types";
import type { ContextSnapshot } from "../state/ClientContextRegistry";
import { EventEmitter } from "../utils/eventEmitter";
import { logger } from "../utils/logger";
import { AgoVoiceError } from "./errors";
import { VoiceApi } from "./VoiceApi";
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  rmsLevel,
} from "./worklets/dsp";
import captureWorkletSource from "./worklets/ago-pcm-capture.worklet.js?raw";
import playbackWorkletSource from "./worklets/ago-pcm-playback.worklet.js?raw";
import {
  VOICE_SPEAKING_HOLD_MS,
  VOICE_SPEAKING_LEVEL_THRESHOLD,
} from "./types";
import type {
  AgoVoiceEvents,
  VoiceAvailability,
  VoiceAvailabilityReport,
  VoiceCaption,
  VoiceClientFunctionInvocation,
  VoiceClientFunctionResult,
  VoiceEndedReason,
  VoiceFlags,
  VoiceServerFrame,
  VoiceSessionGrant,
  VoiceSessionState,
  VoiceStartOptions,
  VoiceStatus,
  VoiceTurn,
  VoiceUnavailableReason,
} from "./types";

/** Deadlines and backoff of the session engine (exported for tests). */
export const VOICE_TIMEOUTS = {
  /** WebSocket must reach OPEN within this window. */
  wsOpenMs: 10000,
  /** The `ready` frame must arrive within this window after the socket opens. */
  readyMs: 10000,
  /** A reconnect (mint + open + ready) must complete within this window. */
  reconnectOverallMs: 20000,
  /** Jittered backoff before a retry: base + random * jitter. */
  backoffBaseMs: 400,
  backoffJitterMs: 400,
  /** Grace period for the server to persist turns and acknowledge `end`. */
  endAckMs: 5000,
} as const;

const WS_OPEN = 1;
const MAX_BUFFERED_AUDIO_BYTES = 1_000_000;

export interface VoiceSessionDeps {
  http: HttpClient;
  getAgent: () => string | undefined;
  getPermission: () => string | undefined;
  getClientFunctions?: () => ClientFunctionSchema[];
  getClientContext?: () => ContextSnapshot | null;
  executeClientFunction?: (
    invocation: VoiceClientFunctionInvocation,
  ) => Promise<VoiceClientFunctionResult>;
  onClientStateChanged?: (handler: () => void) => () => void;
  /** Default `true`: the first start() pauses on consentPending. */
  requireConsent?: boolean;
  /** Forward every session event onto the client emitter. */
  forward?: <K extends keyof AgoVoiceEvents>(
    event: K,
    data: AgoVoiceEvents[K],
  ) => void;
}

function micError(err: unknown): AgoVoiceError {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new AgoVoiceError("no-mic");
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return new AgoVoiceError("mic-busy");
  }
  return new AgoVoiceError("mic-denied");
}

interface AudioGraph {
  ctx: AudioContext;
  capture: AudioWorkletNode;
  captureSink: GainNode;
  playback: AudioWorkletNode;
}

/**
 * Framework-agnostic voice session engine: mic to PCM16 over WebSocket to the
 * voice backend, and agent audio back.
 *
 * Invariants:
 * - At most one active generation. Every async continuation checks it still
 *   owns the generation (a monotonic token bumped by start/stop/destroy) and
 *   disposes late resources, so stop() cancels a start() at ANY point:
 *   permission dialog, between mic and mint, worklet load, or while the
 *   socket is still CONNECTING (the socket is closed unconditionally).
 * - All audio sends go through the session's CURRENT socket reference, so
 *   frames reach the new socket after a reconnect.
 * - Frames from a stale socket are dropped by the generation/socket check.
 * - Exactly one terminal event (`voice:error` or `voice:ended`) per generation.
 * - A reconnect never re-acquires the mic and pins the adopted thread.
 * - One retry budget per generation, shared across mint retry, token re-mint,
 *   reconnect and backend_unavailable. 429 is never auto-retried.
 * - stop() is idempotent from every state; start() after stop begins a new
 *   generation; no events are emitted after destroy().
 */
export class VoiceSession {
  private readonly emitter = new EventEmitter<AgoVoiceEvents>();
  private readonly api: VoiceApi;
  private readonly requireConsent: boolean;

  private generation = 0;
  private destroyed = false;
  private stopping = false;
  private terminalEmitted = true;
  private retryUsed = false;

  private consentAccepted = false;
  private pendingStartOptions: VoiceStartOptions | undefined;

  private status: VoiceStatus = "idle";
  private turn: VoiceTurn = "listening";
  private flags: VoiceFlags = {
    muted: false,
    degraded: false,
    consentPending: false,
  };
  private captions: VoiceCaption[] = [];
  private level = 0;
  private error: AgoVoiceError | undefined;
  private endedReason: VoiceEndedReason | undefined;
  private threadId: string | null = null;

  private availability: VoiceAvailability = "loading";
  private unavailableReason: VoiceUnavailableReason | undefined;
  private cspBlockedDirective: string | undefined;

  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private audio: AudioGraph | null = null;
  private lastVoiceAt = 0;
  private assistantAudioPending = false;
  private transcriptMode: "delta" | "snapshot" = "delta";

  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private endAckTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private detachClientState: (() => void) | null = null;

  constructor(private deps: VoiceSessionDeps) {
    this.api = new VoiceApi(deps.http);
    this.requireConsent = deps.requireConsent !== false;
    this.detachClientState =
      deps.onClientStateChanged?.(() => this.sendClientState()) ?? null;
  }

  // ── Events ─────────────────────────────────────────────────────────────

  on<K extends keyof AgoVoiceEvents>(
    event: K,
    handler: (data: AgoVoiceEvents[K]) => void,
  ): void {
    this.emitter.on(event, handler);
  }

  off<K extends keyof AgoVoiceEvents>(
    event: K,
    handler: (data: AgoVoiceEvents[K]) => void,
  ): void {
    this.emitter.off(event, handler);
  }

  private emit<K extends keyof AgoVoiceEvents>(
    event: K,
    data: AgoVoiceEvents[K],
  ): void {
    if (this.destroyed) return;
    this.emitter.emit(event, data);
    this.deps.forward?.(event, data);
  }

  // ── State ──────────────────────────────────────────────────────────────

  getState(): VoiceSessionState {
    return {
      availability: this.availability,
      unavailableReason: this.unavailableReason,
      status: this.status,
      turn: this.turn,
      muted: this.flags.muted,
      degraded: this.flags.degraded,
      consentPending: this.flags.consentPending,
      captions: [...this.captions],
      level: this.level,
      error: this.error,
      endedReason: this.endedReason,
      conversationId: this.threadId ?? undefined,
    };
  }

  private emitStatus(): void {
    this.emit("voice:status", {
      status: this.status,
      turn: this.turn,
      muted: this.flags.muted,
      degraded: this.flags.degraded,
      consentPending: this.flags.consentPending,
    });
  }

  private setStatus(status: VoiceStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emitStatus();
  }

  private setTurn(turn: VoiceTurn): void {
    if (this.turn === turn) return;
    this.turn = turn;
    this.emitStatus();
  }

  private setFlags(partial: Partial<VoiceFlags>): void {
    const next = { ...this.flags, ...partial };
    if (
      next.muted === this.flags.muted &&
      next.degraded === this.flags.degraded &&
      next.consentPending === this.flags.consentPending
    ) {
      return;
    }
    this.flags = next;
    this.emitStatus();
  }

  private setLevel(level: number): void {
    if (level === this.level && level === 0) return;
    this.level = level;
    this.emit("voice:level", level);
  }

  private owns(gen: number): boolean {
    return !this.destroyed && this.generation === gen;
  }

  private ownsSocket(gen: number, ws: WebSocket): boolean {
    return this.owns(gen) && this.ws === ws;
  }

  private isActive(): boolean {
    return (
      this.flags.consentPending ||
      this.status === "requesting-permission" ||
      this.status === "connecting" ||
      this.status === "live" ||
      this.status === "reconnecting"
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Start a voice session. With `requireConsent` (the default) the first call
   * pauses with `consentPending: true` until {@link acceptConsent} resumes it
   * or {@link cancelConsent} drops it; it does not reject.
   */
  async start(options?: VoiceStartOptions): Promise<void> {
    if (this.destroyed) throw new AgoVoiceError("session-destroyed");
    if (this.isActive()) throw new AgoVoiceError("session-active");

    if (this.requireConsent && !this.consentAccepted) {
      this.pendingStartOptions = options;
      this.setFlags({ consentPending: true });
      return;
    }
    await this.launch(options);
  }

  /** Accept the consent gate; resumes a start() paused on consentPending. */
  acceptConsent(): void {
    if (this.destroyed) return;
    this.consentAccepted = true;
    if (!this.flags.consentPending) return;
    const options = this.pendingStartOptions;
    this.pendingStartOptions = undefined;
    this.setFlags({ consentPending: false });
    void this.launch(options);
  }

  /** Decline the consent gate; drops the paused start() and stays idle. */
  cancelConsent(): void {
    if (this.destroyed || !this.flags.consentPending) return;
    this.pendingStartOptions = undefined;
    this.setFlags({ consentPending: false });
  }

  /** Idempotent from every state. Cancels any in-flight start(). */
  stop(): void {
    if (this.destroyed || this.stopping) return;
    this.pendingStartOptions = undefined;
    this.stopping = true;
    this.clearTimers();
    this.teardownAudio();
    this.setLevel(0);
    if (this.flags.consentPending) this.setFlags({ consentPending: false });

    const gen = this.generation;
    const ws = this.ws;
    if (!this.terminalEmitted && ws?.readyState === WS_OPEN) {
      try {
        ws.send(JSON.stringify({ type: "end" }));
      } catch {
        this.finishGeneration(gen, "stopped");
        return;
      }
      // Keep the transport alive until the gateway confirms its persistence
      // queue is flushed. Older/unhealthy gateways are bounded by this timer.
      this.endAckTimer = setTimeout(() => {
        this.endAckTimer = null;
        if (this.owns(gen) && this.stopping) {
          this.finishGeneration(gen, "stopped");
        }
      }, VOICE_TIMEOUTS.endAckMs);
      return;
    }

    this.generation++;
    this.closeSocket(false);
    if (!this.terminalEmitted) {
      this.terminalEmitted = true;
      this.endedReason = "stopped";
      this.setStatus("ended");
      this.emit("voice:ended", { reason: "stopped" });
    }
    this.stopping = false;
  }

  /** Stops any live session, releases the mic, and silences the emitter. */
  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    // stop() defers its terminal event when it waits for the gateway's
    // end-ack. destroy() is the hard release primitive and cannot leave a
    // generation without its terminal event, so finalize now if stop()
    // deferred (this emits voice:ended before removeAllListeners() below).
    if (!this.terminalEmitted) {
      this.finishGeneration(this.generation, "stopped");
    }
    // destroy() is the hard release primitive. Unlike a user stop, its
    // contract cannot leave a transport/timer alive waiting for an ack.
    this.generation++;
    this.clearTimers();
    this.closeSocket(false);
    this.teardownAudio();
    this.destroyed = true;
    this.stopping = false;
    this.detachClientState?.();
    this.detachClientState = null;
    this.emitter.removeAllListeners();
  }

  /** Mute/unmute the mic (track disabled: no audio leaves the device). */
  toggleMute(): void {
    if (this.destroyed) return;
    const muted = !this.flags.muted;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.setFlags({ muted });
    if (muted) this.setLevel(0);
  }

  /**
   * One-read readiness diagnostic: prints and returns every gate voice
   * depends on (secure context, worklet support, auth kind, tenant gate,
   * agent gate).
   */
  async checkAvailability(): Promise<VoiceAvailabilityReport> {
    const secureContext =
      typeof window !== "undefined" && window.isSecureContext !== false;
    const workletSupported =
      typeof AudioWorkletNode !== "undefined" &&
      typeof window !== "undefined" &&
      typeof (
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: unknown })
          .webkitAudioContext
      ) !== "undefined";
    const authKind: "jwt" | "anonymous" = this.api.hasUserJwt()
      ? "jwt"
      : "anonymous";

    let tenantEnabled: boolean | undefined;
    let agentIsVoiceAgent: boolean | undefined;
    try {
      const gates = await this.api.getVoiceConfig(
        this.deps.getAgent(),
        this.deps.getPermission(),
      );
      tenantEnabled = gates.tenantEnabled;
      agentIsVoiceAgent = gates.agentIsVoiceAgent;
    } catch (err) {
      logger.debug("Voice config fetch failed:", err);
    }

    let availability: VoiceAvailability = "available";
    let unavailableReason: VoiceUnavailableReason | undefined;
    if (!secureContext) {
      availability = "unsupported";
      unavailableReason = "insecure-context";
    } else if (!workletSupported) {
      availability = "unsupported";
      unavailableReason = "worklet-unsupported";
    } else if (this.cspBlockedDirective !== undefined) {
      availability = "unsupported";
      unavailableReason = "csp-blocked";
    } else if (authKind !== "jwt") {
      availability = "policy-unavailable";
      unavailableReason = "jwt-missing";
    } else if (tenantEnabled !== true) {
      availability = "policy-unavailable";
      unavailableReason = "tenant-disabled";
    } else if (agentIsVoiceAgent !== true) {
      availability = "policy-unavailable";
      unavailableReason = "agent-not-voice";
    }

    this.availability = availability;
    this.unavailableReason = unavailableReason;
    // Availability is part of getState(), while voice:status is the existing
    // state-snapshot notification consumed by the React hook. Emit even when
    // the lifecycle itself did not move so async auth/config updates become
    // visible without adding a second event vocabulary.
    this.emitStatus();

    console.info(
      "[AGO] voice availability: " +
        `${availability}${unavailableReason ? ` (${unavailableReason})` : ""}\n` +
        `  secure context:  ${secureContext}\n` +
        `  worklet support: ${workletSupported}\n` +
        `  auth kind:       ${authKind}\n` +
        `  tenant gate:     ${tenantEnabled ?? "unknown"}\n` +
        `  agent gate:      ${agentIsVoiceAgent ?? "unknown"}`,
    );

    return {
      availability,
      unavailableReason,
      checks: {
        secureContext,
        workletSupported,
        authKind,
        tenantEnabled,
        agentIsVoiceAgent,
      },
    };
  }

  // ── Generation lifecycle ───────────────────────────────────────────────

  private async launch(options?: VoiceStartOptions): Promise<void> {
    const gen = ++this.generation;
    this.terminalEmitted = false;
    this.retryUsed = false;
    this.error = undefined;
    this.endedReason = undefined;
    this.captions = [];
    this.threadId = options?.conversationId ?? null;
    this.assistantAudioPending = false;
    this.setFlags({ degraded: false });

    if (typeof window !== "undefined" && window.isSecureContext === false) {
      this.failGeneration(gen, new AgoVoiceError("insecure-context"));
      return;
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      this.failGeneration(gen, new AgoVoiceError("worklet-unsupported"));
      return;
    }

    this.setStatus("requesting-permission");

    // Mic BEFORE mint: the permission prompt can take arbitrarily long and
    // must not eat the short session-token TTL.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(options?.inputDeviceId
            ? { deviceId: { exact: options.inputDeviceId } }
            : {}),
          ...options?.mediaConstraints,
        },
      });
    } catch (err) {
      if (!this.owns(gen)) return;
      this.failGeneration(gen, micError(err));
      return;
    }
    if (!this.owns(gen)) {
      // Cancelled while the permission dialog was up: release the late mic.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (!this.owns(gen) || this.stopping) return;
        this.finishGeneration(gen, "mic-lost");
      };
    });
    if (this.flags.muted) {
      stream.getAudioTracks().forEach((t) => (t.enabled = false));
    }

    this.setStatus("connecting");

    const grant = await this.mintWithBudget(gen, this.threadId);
    if (!this.owns(gen) || !grant) return;
    this.threadId = grant.threadId ?? this.threadId;

    const ready = await this.initAudio(gen, stream);
    if (!this.owns(gen) || !ready) return;

    this.openSocket(grant, gen);
  }

  /**
   * Mint a grant, spending the shared retry budget once on a retryable mint
   * failure (jittered backoff). `jwt-required` was already handled inside
   * VoiceApi (refresh retry) and `rate-limited` (429) is never auto-retried.
   * Resolves null when the generation failed or was cancelled.
   */
  private async mintWithBudget(
    gen: number,
    threadId: string | null,
  ): Promise<VoiceSessionGrant | null> {
    try {
      return await this.mint(threadId);
    } catch (err) {
      if (!this.owns(gen)) return null;
      const voiceErr =
        err instanceof AgoVoiceError ? err : new AgoVoiceError("mint-failed");
      if (voiceErr.code !== "mint-failed" || this.retryUsed) {
        this.failGeneration(gen, voiceErr);
        return null;
      }
      this.retryUsed = true;
      await new Promise((resolve) => setTimeout(resolve, this.backoffDelay()));
      if (!this.owns(gen)) return null;
      try {
        return await this.mint(threadId);
      } catch (retryErr) {
        if (!this.owns(gen)) return null;
        this.failGeneration(
          gen,
          retryErr instanceof AgoVoiceError
            ? retryErr
            : new AgoVoiceError("mint-failed"),
        );
        return null;
      }
    }
  }

  private mint(threadId: string | null): Promise<VoiceSessionGrant> {
    return this.api.mintSession({
      agentId: this.deps.getAgent(),
      permissionId: this.deps.getPermission(),
      conversationId: threadId,
    });
  }

  private backoffDelay(): number {
    return (
      VOICE_TIMEOUTS.backoffBaseMs +
      Math.random() * VOICE_TIMEOUTS.backoffJitterMs
    );
  }

  // ── Audio graph ────────────────────────────────────────────────────────

  private async initAudio(gen: number, stream: MediaStream): Promise<boolean> {
    const AudioCtx =
      typeof window !== "undefined"
        ? (window.AudioContext ??
          (
            window as unknown as {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext)
        : undefined;
    if (!AudioCtx || typeof AudioWorkletNode === "undefined") {
      this.failGeneration(gen, new AgoVoiceError("worklet-unsupported"));
      return false;
    }

    let ctx: AudioContext | null = null;
    let captureUrl: string | null = null;
    let playbackUrl: string | null = null;
    let violatedDirective: string | undefined;
    const onViolation = (event: Event) => {
      const e = event as SecurityPolicyViolationEvent;
      violatedDirective = e.effectiveDirective || e.violatedDirective;
    };
    if (typeof document !== "undefined") {
      document.addEventListener("securitypolicyviolation", onViolation);
    }

    try {
      ctx = new AudioCtx();
      // Blob URLs are created here, at session start, never at import time.
      captureUrl = URL.createObjectURL(
        new Blob([captureWorkletSource], { type: "text/javascript" }),
      );
      playbackUrl = URL.createObjectURL(
        new Blob([playbackWorkletSource], { type: "text/javascript" }),
      );
      await ctx.audioWorklet.addModule(captureUrl);
      await ctx.audioWorklet.addModule(playbackUrl);

      if (!this.owns(gen)) {
        // Cancelled during worklet load: dispose the late context.
        void ctx.close();
        return false;
      }

      const source = ctx.createMediaStreamSource(stream);
      const capture = new AudioWorkletNode(ctx, "ago-pcm-capture-processor");
      const playback = new AudioWorkletNode(ctx, "ago-pcm-playback-processor");
      source.connect(capture);
      // AudioWorklets are pull-driven. Keep the capture processor in the
      // rendered graph through a silent sink so browsers do not prune it,
      // without monitoring the microphone through the speakers.
      const captureSink = ctx.createGain();
      captureSink.gain.value = 0;
      capture.connect(captureSink);
      captureSink.connect(ctx.destination);
      playback.connect(ctx.destination);
      this.audio = { ctx, capture, captureSink, playback };

      capture.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        this.handleCaptureFrame(gen, e.data);
      };
      playback.port.onmessage = (e: MessageEvent<{ type?: string }>) => {
        if (!this.owns(gen) || e.data?.type !== "drained") return;
        this.assistantAudioPending = false;
        if (this.turn === "agent-speaking") this.setTurn("listening");
      };

      this.visibilityHandler = () => {
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "visible" &&
          this.audio?.ctx.state === "suspended"
        ) {
          void this.audio.ctx.resume();
        }
      };
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", this.visibilityHandler);
      }

      return true;
    } catch (err) {
      if (ctx && ctx.state !== "closed") void ctx.close();
      if (!this.owns(gen)) return false;
      if (violatedDirective) {
        this.cspBlockedDirective = violatedDirective;
        this.availability = "unsupported";
        this.unavailableReason = "csp-blocked";
        this.failGeneration(
          gen,
          new AgoVoiceError("csp-blocked", {
            detail: `blocked directive: ${violatedDirective}`,
          }),
        );
      } else {
        logger.debug("Worklet addModule failed:", err);
        this.failGeneration(gen, new AgoVoiceError("audio-init-failed"));
      }
      return false;
    } finally {
      if (typeof document !== "undefined") {
        document.removeEventListener("securitypolicyviolation", onViolation);
      }
      if (captureUrl) URL.revokeObjectURL(captureUrl);
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    }
  }

  private handleCaptureFrame(gen: number, buffer: ArrayBuffer): void {
    if (!this.owns(gen)) return;
    if (this.flags.muted) {
      this.setLevel(0);
      return;
    }
    const level = rmsLevel(new Int16Array(buffer));
    const now = Date.now();
    if (level > VOICE_SPEAKING_LEVEL_THRESHOLD) {
      this.lastVoiceAt = now;
      if (this.turn === "listening") this.setTurn("user-speaking");
    } else if (
      this.turn === "user-speaking" &&
      now - this.lastVoiceAt > VOICE_SPEAKING_HOLD_MS
    ) {
      this.setTurn("listening");
    }
    // Level pulses during agent speech would read as "hearing me" while the
    // agent talks; the design contract suppresses them.
    this.setLevel(this.turn === "agent-speaking" ? 0 : level);

    // ALWAYS the session's current socket: after a reconnect this is the new
    // one (the shipped hook closed over the original socket and kept sending
    // into the dead one).
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED_AUDIO_BYTES) return;
    ws.send(
      JSON.stringify({ type: "audio", audio: arrayBufferToBase64(buffer) }),
    );
  }

  private teardownAudio(): void {
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.visibilityHandler = null;
    if (this.audio) {
      this.audio.capture.port.onmessage = null;
      this.audio.playback.port.onmessage = null;
      this.audio.capture.disconnect();
      this.audio.captureSink.disconnect();
      this.audio.playback.disconnect();
      if (this.audio.ctx.state !== "closed") void this.audio.ctx.close();
      this.audio = null;
    }
    this.assistantAudioPending = false;
    // Releases the mic (hardware light off).
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  // ── Socket ─────────────────────────────────────────────────────────────

  private openSocket(grant: VoiceSessionGrant, gen: number): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(grant.wsUrl);
    } catch (err) {
      logger.debug("WebSocket construction failed:", err);
      this.failGeneration(gen, new AgoVoiceError("connect-failed"));
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      if (!this.ownsSocket(gen, ws)) return;
      this.retryConnection(gen, new AgoVoiceError("connect-failed"));
    }, VOICE_TIMEOUTS.wsOpenMs);

    ws.onopen = () => {
      if (!this.ownsSocket(gen, ws)) return;
      let authFrame: string;
      try {
        authFrame = JSON.stringify({
          type: "auth",
          token: grant.token,
          threadId: grant.threadId ?? this.threadId ?? undefined,
          clientFunctions: this.deps.getClientFunctions?.() ?? [],
          clientContext: this.deps.getClientContext?.() ?? null,
        });
      } catch (error) {
        logger.warn("Voice client state was not serializable:", error);
        this.failGeneration(
          gen,
          new AgoVoiceError("connect-failed", {
            detail: "client state is not JSON-serializable",
          }),
        );
        return;
      }
      this.clearTimer("openTimer");
      try {
        ws.send(authFrame);
      } catch (error) {
        logger.debug("Voice auth socket send failed:", error);
        this.failGeneration(gen, new AgoVoiceError("connect-failed"));
        return;
      }
      this.readyTimer = setTimeout(() => {
        this.readyTimer = null;
        if (!this.ownsSocket(gen, ws) || this.status === "live") return;
        this.retryConnection(gen, new AgoVoiceError("connect-failed"));
      }, VOICE_TIMEOUTS.readyMs);
    };

    ws.onmessage = (event) => {
      if (!this.ownsSocket(gen, ws)) return;
      let value: unknown;
      try {
        value = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const frame = value as VoiceServerFrame;
      if (typeof frame.type !== "string") return;
      this.handleServerFrame(gen, frame);
    };

    ws.onclose = () => {
      if (!this.ownsSocket(gen, ws)) return;
      if (this.stopping) {
        this.finishGeneration(gen, "stopped");
        return;
      }
      this.clearTimer("openTimer");
      this.clearTimer("readyTimer");
      this.retryConnection(gen, new AgoVoiceError("connection-lost"));
    };

    ws.onerror = () => {
      if (!this.ownsSocket(gen, ws)) return;
      this.setFlags({ degraded: true });
    };
  }

  private closeSocket(sendEnd: boolean): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    if (sendEnd && ws.readyState === WS_OPEN) {
      try {
        ws.send(JSON.stringify({ type: "end" }));
      } catch {
        // ignore
      }
    }
    // Close UNCONDITIONALLY, whatever the readyState: a CONNECTING socket
    // left open becomes an admitted session burning a concurrency slot.
    try {
      ws.close();
    } catch {
      // ignore
    }
  }

  private sendClientState(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return;
    try {
      ws.send(
        JSON.stringify({
          type: "client_state",
          clientFunctions: this.deps.getClientFunctions?.() ?? [],
          clientContext: this.deps.getClientContext?.() ?? null,
        }),
      );
    } catch (error) {
      // A bad dynamic context update must not throw into the host application
      // or tear down an otherwise healthy call. The last valid state remains
      // authoritative until a subsequent serializable update arrives.
      logger.warn("Voice client state update was not serializable:", error);
    }
  }

  private async handleClientFunction(
    gen: number,
    frame: VoiceServerFrame,
  ): Promise<void> {
    const execute = this.deps.executeClientFunction;
    if (
      !execute ||
      !frame.invocationId ||
      !frame.functionName ||
      !this.owns(gen)
    ) {
      return;
    }

    const invocation: VoiceClientFunctionInvocation = {
      invocationId: frame.invocationId,
      functionName: frame.functionName,
      arguments: frame.arguments ?? {},
      conversationId: frame.conversationId ?? this.threadId ?? "",
      messageId: frame.messageId,
    };
    const originWs = this.ws;
    if (!originWs || originWs.readyState !== WS_OPEN) return;
    let outcome: VoiceClientFunctionResult;
    try {
      outcome = await execute(invocation);
    } catch (error) {
      outcome = {
        error:
          error instanceof Error ? error.message : "Client function failed",
      };
    }
    const ws = this.ws;
    if (
      !ws ||
      ws !== originWs ||
      ws.readyState !== WS_OPEN ||
      !this.ownsSocket(gen, ws)
    ) {
      return;
    }
    let resultFrame: string;
    try {
      resultFrame = JSON.stringify({
        type: "client_function_result",
        invocationId: invocation.invocationId,
        ...outcome,
        clientFunctions: this.deps.getClientFunctions?.() ?? [],
        clientContext: this.deps.getClientContext?.() ?? null,
      });
    } catch (error) {
      logger.warn("Voice client function result was not serializable:", error);
      resultFrame = JSON.stringify({
        type: "client_function_result",
        invocationId: invocation.invocationId,
        error: "client_function_result_not_serializable",
      });
    }
    try {
      ws.send(resultFrame);
    } catch (error) {
      // The socket may close between the readiness check and send().
      logger.debug("Voice client function result socket send failed:", error);
    }
  }

  /**
   * Spend the shared retry budget on one reconnect (re-mint pinned to the
   * adopted thread, reusing the existing mic and audio graph), or fail the
   * generation when the budget is gone.
   */
  private retryConnection(gen: number, failure: AgoVoiceError): void {
    if (!this.owns(gen)) return;
    if (this.retryUsed) {
      this.failGeneration(gen, failure);
      return;
    }
    this.retryUsed = true;
    this.closeSocket(false);
    this.setStatus("reconnecting");
    this.setFlags({ degraded: true });

    this.reconnectDeadlineTimer = setTimeout(() => {
      this.reconnectDeadlineTimer = null;
      if (!this.owns(gen) || this.status === "live") return;
      this.failGeneration(gen, new AgoVoiceError("connect-failed"));
    }, VOICE_TIMEOUTS.reconnectOverallMs);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void (async () => {
        if (!this.owns(gen)) return;
        if (!this.stream || this.stream.getAudioTracks().length === 0) {
          this.finishGeneration(gen, "mic-lost");
          return;
        }
        let grant: VoiceSessionGrant;
        try {
          // Re-mint pinned to the adopted thread so a reconnect can never
          // bind (or mint) a different thread.
          grant = await this.mint(this.threadId);
        } catch (err) {
          if (!this.owns(gen)) return;
          this.failGeneration(
            gen,
            err instanceof AgoVoiceError
              ? err
              : new AgoVoiceError("connect-failed"),
          );
          return;
        }
        if (!this.owns(gen)) return;
        grant = { ...grant, threadId: this.threadId ?? grant.threadId };
        this.openSocket(grant, gen);
      })();
    }, this.backoffDelay());
  }

  // ── Server frames ──────────────────────────────────────────────────────

  private handleServerFrame(gen: number, frame: VoiceServerFrame): void {
    switch (frame.type) {
      case "ready": {
        this.transcriptMode = frame.transcriptMode ?? "delta";
        this.clearTimer("readyTimer");
        this.clearTimer("reconnectDeadlineTimer");
        this.setStatus("live");
        this.setTurn("listening");
        this.setFlags({ degraded: false });
        // The ready frame is authoritative for the thread the session writes
        // to (it may have been created at validate time for a fresh chat).
        if (frame.threadId) {
          this.threadId = frame.threadId;
          this.emit("voice:thread-ready", { threadId: frame.threadId });
        }
        break;
      }
      case "audio": {
        if (frame.audio) {
          const playback = this.audio?.playback;
          if (playback) {
            this.assistantAudioPending = true;
            playback.port.postMessage(base64ToArrayBuffer(frame.audio));
            this.setTurn("agent-speaking");
          }
        }
        break;
      }
      case "flush": {
        // Barge-in: drop queued agent audio and finalize the assistant's
        // partial at the honest boundary (the text generated so far).
        this.audio?.playback.port.postMessage({ type: "flush" });
        this.assistantAudioPending = false;
        const assistantPartial = this.captions.find(
          (c) => c.role === "assistant",
        );
        if (assistantPartial?.text) {
          const finalized: VoiceCaption = {
            role: "assistant",
            text: assistantPartial.text,
            final: true,
            interrupted: true,
          };
          this.captions = this.captions.filter((c) => c.role !== "assistant");
          this.emit("voice:turn-final", finalized);
        }
        this.setTurn("user-speaking");
        break;
      }
      case "transcript": {
        if (
          (frame.role === "user" || frame.role === "assistant") &&
          typeof frame.text === "string"
        ) {
          const previous =
            this.transcriptMode === "delta" && !frame.final
              ? (this.captions.find((caption) => caption.role === frame.role)
                  ?.text ?? "")
              : "";
          const caption: VoiceCaption = {
            role: frame.role,
            text: `${previous}${frame.text}`,
            final: !!frame.final,
          };
          this.emit("voice:transcript", caption);
          if (frame.final) {
            this.captions = this.captions.filter((c) => c.role !== frame.role);
            this.emit("voice:turn-final", caption);
            if (frame.role === "user") {
              this.setTurn("agent-thinking");
            } else {
              // WebSocket ordering guarantees every audio frame for this turn
              // was delivered before its final transcript. The worklet uses
              // this marker to distinguish final drainage from a temporary
              // streaming underrun between audio chunks.
              this.audio?.playback.port.postMessage({ type: "end" });
              if (!this.assistantAudioPending) {
                // Transcript completion commonly precedes the playback worklet
                // draining its queued PCM. Keep the speaking state until the
                // worklet confirms that the audible output has finished.
                this.setTurn("listening");
              }
            }
          } else {
            this.captions = [
              ...this.captions.filter((c) => c.role !== frame.role),
              caption,
            ];
            if (frame.role === "user") this.setTurn("user-speaking");
          }
        }
        break;
      }
      case "persisted": {
        if (
          frame.messageId &&
          (frame.role === "user" || frame.role === "assistant")
        ) {
          this.emit("voice:persisted", {
            messageId: frame.messageId,
            role: frame.role,
            threadId: frame.threadId,
            text: frame.text,
            turnIndex: frame.turnIndex,
          });
        }
        break;
      }
      case "client_function": {
        void this.handleClientFunction(gen, frame);
        break;
      }
      case "activity": {
        const activity = frame.activity;
        if (
          activity &&
          typeof activity.id === "string" &&
          typeof activity.type === "string"
        ) {
          this.emit("voice:activity", activity);
        }
        break;
      }
      case "error": {
        if (this.stopping) {
          this.finishGeneration(gen, "stopped");
          return;
        }
        const reason = frame.reason ?? "server_error";
        // Token expiry between mint and open, or a transient backend outage:
        // both are worth the single budgeted retry (re-mint + reconnect).
        if (
          (reason === "invalid_token" || reason === "backend_unavailable") &&
          !this.retryUsed
        ) {
          this.retryConnection(
            gen,
            AgoVoiceError.fromServerReason(reason, {
              retryAfter: frame.retryAfter,
            }),
          );
          return;
        }
        this.failGeneration(
          gen,
          AgoVoiceError.fromServerReason(reason, {
            retryAfter: frame.retryAfter,
          }),
        );
        break;
      }
      case "ended": {
        this.finishGeneration(
          gen,
          this.stopping ? "stopped" : (frame.reason ?? "ended"),
        );
        break;
      }
      default:
        // Unknown frame types are ignored for forward compatibility: the
        // protocol will grow and old SDKs must never crash the host app.
        logger.debug("Ignoring unknown voice frame type:", frame.type);
        break;
    }
  }

  // ── Terminal transitions ───────────────────────────────────────────────

  private failGeneration(gen: number, error: AgoVoiceError): void {
    if (!this.owns(gen) || this.terminalEmitted) return;
    this.terminalEmitted = true;
    this.clearTimers();
    this.closeSocket(false);
    this.teardownAudio();
    this.setLevel(0);
    this.error = error;
    this.setStatus("error");
    console.error(`[AGO] voice error (${error.code}): ${error.message}`);
    this.emit("voice:error", error);
  }

  private finishGeneration(gen: number, reason: VoiceEndedReason): void {
    if (!this.owns(gen) || this.terminalEmitted) return;
    this.terminalEmitted = true;
    this.clearTimers();
    this.closeSocket(false);
    this.teardownAudio();
    this.setLevel(0);
    this.endedReason = reason;
    this.setStatus("ended");
    this.emit("voice:ended", { reason });
    this.stopping = false;
  }

  private clearTimer(
    name:
      | "openTimer"
      | "readyTimer"
      | "retryTimer"
      | "reconnectDeadlineTimer"
      | "endAckTimer",
  ): void {
    const timer = this[name];
    if (timer !== null) {
      clearTimeout(timer);
      this[name] = null;
    }
  }

  private clearTimers(): void {
    this.clearTimer("openTimer");
    this.clearTimer("readyTimer");
    this.clearTimer("retryTimer");
    this.clearTimer("reconnectDeadlineTimer");
    this.clearTimer("endAckTimer");
  }
}
