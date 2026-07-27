// Voice subsystem (also wired into the core client as `client.voice`).
//
// This entry carries the full engine, including the audio worklet sources.
// The core bundle only ships the tiny controller and loads the engine through
// a dynamic import on first use.

export { VoiceSession, VOICE_TIMEOUTS } from "./VoiceSession";
export type { VoiceSessionDeps } from "./VoiceSession";

export { VoiceApi } from "./VoiceApi";
export type { MintSessionOptions, VoiceConfigFlags } from "./VoiceApi";

export { AgoVoiceError, serverReasonToCode } from "./errors";
export type { AgoVoiceErrorCode, AgoVoiceErrorOptions } from "./errors";

export { createVoiceController } from "./controller";
export type { AgoVoice, VoiceControllerDeps } from "./controller";

export {
  resolveBarState,
  VOICE_SPEAKING_HOLD_MS,
  VOICE_SPEAKING_LEVEL_THRESHOLD,
} from "./types";
export type {
  AgoVoiceEvents,
  AgoVoiceOptions,
  VoiceAvailability,
  VoiceAvailabilityReport,
  VoiceActivity,
  VoiceBarState,
  VoiceCaption,
  VoiceClientFrame,
  VoiceEndedReason,
  VoiceFlags,
  VoicePersistedAck,
  VoiceServerFrame,
  VoiceSessionGrant,
  VoiceSessionState,
  VoiceStartOptions,
  VoiceStatus,
  VoiceStatusEvent,
  VoiceTurn,
  VoiceUnavailableReason,
} from "./types";

export {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  downsampleToInt16,
  floatToInt16,
  PlaybackQueue,
  rmsLevel,
  VOICE_WIRE_SAMPLE_RATE,
} from "./worklets/dsp";
export type { DownsampleResult } from "./worklets/dsp";
