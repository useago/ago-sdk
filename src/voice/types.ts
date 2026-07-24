/**
 * Public vocabulary of the voice subsystem.
 *
 * The engine keeps THREE orthogonal axes instead of one flat union:
 * - lifecycle {@link VoiceStatus} (idle, requesting-permission, connecting,
 *   live, reconnecting, error, ended)
 * - turn-taking {@link VoiceTurn} while live
 * - boolean {@link VoiceFlags} (muted, degraded, consentPending)
 *
 * A flat union cannot represent live+muted+degraded at once. UIs consume the
 * derived {@link resolveBarState} view, which folds the axes back into the 11
 * bar states of the shipped voice UI.
 *
 * The status, turn, event and error-code vocabulary here is STABLE for the
 * 1.x line.
 */

/** Connection lifecycle of a voice session. */
export type VoiceStatus =
  | "idle"
  | "requesting-permission"
  | "connecting"
  | "live"
  | "reconnecting"
  | "error"
  | "ended";

/** Turn-taking sub-state while `status === "live"`. */
export type VoiceTurn =
  | "listening"
  | "user-speaking"
  | "agent-thinking"
  | "agent-speaking";

/** Boolean flags orthogonal to status and turn. */
export interface VoiceFlags {
  muted: boolean;
  degraded: boolean;
  consentPending: boolean;
}

/**
 * The 11 derived bar states of the shipped voice UI. Components render this
 * single value; the engine keeps the orthogonal axes it is derived from.
 */
export type VoiceBarState =
  | "requesting-permission"
  | "connecting"
  | "listening"
  | "user-speaking"
  | "agent-thinking"
  | "agent-speaking"
  | "muted"
  | "reconnecting"
  | "degraded"
  | "error"
  | "ended";

/**
 * Fold the three state axes into the single bar state the voice UI renders.
 * Lifecycle beats flags beats turn; among flags, muted beats degraded (a muted
 * mic is the user's own doing and must stay visible over link quality).
 */
export function resolveBarState(
  status: VoiceStatus,
  turn: VoiceTurn,
  flags: Pick<VoiceFlags, "muted" | "degraded">
): VoiceBarState {
  if (status === "requesting-permission") return "requesting-permission";
  if (status === "connecting") return "connecting";
  if (status === "reconnecting") return "reconnecting";
  if (status === "error") return "error";
  if (status === "ended") return "ended";
  // status is "live" (or "idle", where the bar is not rendered)
  if (flags.muted) return "muted";
  if (flags.degraded) return "degraded";
  switch (turn) {
    case "user-speaking":
      return "user-speaking";
    case "agent-thinking":
      return "agent-thinking";
    case "agent-speaking":
      return "agent-speaking";
    default:
      return "listening";
  }
}

/** Availability of voice for the current tenant, agent, auth and environment. */
export type VoiceAvailability =
  | "loading"
  | "available"
  | "policy-unavailable"
  | "unsupported";

/** Why voice is unavailable (paired with a non-available {@link VoiceAvailability}). */
export type VoiceUnavailableReason =
  | "tenant-disabled"
  | "agent-not-voice"
  | "jwt-missing"
  | "insecure-context"
  | "worklet-unsupported"
  | "csp-blocked";

/** Result of `client.voice.checkAvailability()`, the one-read diagnostic. */
export interface VoiceAvailabilityReport {
  availability: VoiceAvailability;
  unavailableReason?: VoiceUnavailableReason;
  checks: {
    secureContext: boolean;
    workletSupported: boolean;
    /** "jwt" when a bearer token is configured, "anonymous" otherwise. */
    authKind: "jwt" | "anonymous";
    /** Tenant voice gate from the SDK config endpoint; undefined when unknown. */
    tenantEnabled?: boolean;
    /** Agent voice gate from the SDK config endpoint; undefined when unknown. */
    agentIsVoiceAgent?: boolean;
  };
}

/** One live or finalized transcript caption. */
export interface VoiceCaption {
  role: "user" | "assistant";
  text: string;
  final: boolean;
  /** Assistant turn cut off by barge-in, finalized with the text heard so far. */
  interrupted?: boolean;
}

/**
 * Ack for one transcript turn persisted by the backend. Reconciliation MUST
 * key on `messageId`: turn indexes reset on every reconnect (each connection
 * is a new server session) and therefore collide across sockets.
 */
export interface VoicePersistedAck {
  /** Authoritative persisted message id. The reconciliation key. */
  messageId: string;
  role: "user" | "assistant";
  threadId?: string;
  /** First chars of the persisted content (disambiguates acks after a failed turn). */
  text?: string;
  /** Informational only. Never use as a key: it resets per connection. */
  turnIndex?: number;
}

/** A freshly minted, single-use voice session grant from the mint endpoint. */
export interface VoiceSessionGrant {
  token: string;
  wsUrl: string;
  threadId?: string;
}

/** Options for `voice.start()`. */
export interface VoiceStartOptions {
  /**
   * Existing conversation to continue. When omitted, the backend creates a
   * conversation and reports it through `voice:thread-ready`.
   */
  conversationId?: string;
  /** Preferred input device (enterprise headsets). Passed as `deviceId: { exact }`. */
  inputDeviceId?: string;
  /** Extra `getUserMedia` audio constraints merged over the SDK defaults. */
  mediaConstraints?: MediaTrackConstraints;
}

/** Voice options on `AgoConfig`. */
export interface AgoVoiceOptions {
  /**
   * Require an explicit consent step before the microphone is touched.
   * Default `true`: the first `start()` pauses with `consentPending` until
   * `acceptConsent()` (or `cancelConsent()`) is called.
   */
  requireConsent?: boolean;
}

/**
 * Why a session ended. Known values plus any server-provided reason string
 * (e.g. "idle", "max_duration", "superseded").
 */
export type VoiceEndedReason = "stopped" | "mic-lost" | (string & {});

/**
 * Snapshot of the whole session state, shaped to back `UseAgoVoiceResult`.
 */
export interface VoiceSessionState {
  availability: VoiceAvailability;
  unavailableReason?: VoiceUnavailableReason;
  status: VoiceStatus;
  turn: VoiceTurn;
  muted: boolean;
  degraded: boolean;
  consentPending: boolean;
  /** Latest partial caption per role (transient live captions). */
  captions: VoiceCaption[];
  /** Live mic input level 0..1 (suppressed to 0 while the agent speaks or muted). */
  level: number;
  error?: import("./errors").AgoVoiceError;
  endedReason?: VoiceEndedReason;
  /** Thread the session writes to (server-adopted on the `ready` frame). */
  conversationId?: string;
}

/** Payload of the `voice:status` event. */
export interface VoiceStatusEvent {
  status: VoiceStatus;
  turn: VoiceTurn;
  muted: boolean;
  degraded: boolean;
  consentPending: boolean;
}

/** Events emitted by a voice session (and forwarded onto the client emitter). */
export interface AgoVoiceEvents {
  "voice:status": VoiceStatusEvent;
  /** Every transcript caption, partial and final. */
  "voice:transcript": VoiceCaption;
  /** A finalized turn (including barge-in interrupted assistant turns). */
  "voice:turn-final": VoiceCaption;
  /** A turn was persisted by the backend. Key on `messageId`, never `turnIndex`. */
  "voice:persisted": VoicePersistedAck;
  /** The server confirmed which thread the session writes to. */
  "voice:thread-ready": { threadId: string };
  /** Normalized mic input level 0..1 (0 while muted or during agent speech). */
  "voice:level": number;
  "voice:error": import("./errors").AgoVoiceError;
  "voice:ended": { reason: VoiceEndedReason };
}

// ── Wire protocol ────────────────────────────────────────────────────────

/** Client to server frames. */
export type VoiceClientFrame =
  | { type: "auth"; token: string; threadId?: string }
  | { type: "audio"; audio: string }
  | { type: "end" };

/**
 * Server to client frames. UNKNOWN frame types must be ignored (never throw):
 * the protocol is expected to grow and old SDKs must not crash host apps.
 */
export interface VoiceServerFrame {
  type:
    | "ready"
    | "audio"
    | "flush"
    | "transcript"
    | "persisted"
    | "error"
    | "ended"
    | (string & {});
  audio?: string;
  role?: "user" | "assistant";
  text?: string;
  final?: boolean;
  reason?: string;
  retryAfter?: number;
  threadId?: string;
  turnIndex?: number;
  messageId?: string;
}

/** Mic level above which the user counts as speaking (user transcription is
 *  final-only on the wire, so the mic level is the only mid-utterance signal). */
export const VOICE_SPEAKING_LEVEL_THRESHOLD = 0.12;
/** How long after the last loud frame the user-speaking state is held. */
export const VOICE_SPEAKING_HOLD_MS = 1200;
