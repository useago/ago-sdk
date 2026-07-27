import React from "react";
import type { AgoVoiceError, AgoVoiceErrorCode } from "../../voice/errors";

/**
 * Every overridable copy key of the voice components: one key per bar state,
 * the consent and control labels, and one `error-<code>` key per voice error
 * code so per-error copy is overridable too.
 */
export type AgoVoiceLabelKey =
  | "start"
  | "requesting-permission"
  | "connecting"
  | "listening"
  | "user-speaking"
  | "agent-thinking"
  | "agent-speaking"
  | "muted"
  | "reconnecting"
  | "degraded"
  | "ended"
  | "consent-title"
  | "consent-body"
  | "consent-accept"
  | "consent-cancel"
  | "mute"
  | "unmute"
  | "end"
  | "cancel"
  | "retry"
  | "dismiss"
  | "meter"
  | "user-speaking-indicator"
  | `error-${AgoVoiceErrorCode}`;

/** The `labels` prop shape of every voice component. English defaults. */
export type AgoVoiceLabels = Partial<Record<AgoVoiceLabelKey, string>>;

/** English defaults for every non-error label key. */
export const DEFAULT_VOICE_LABELS: Record<
  Exclude<AgoVoiceLabelKey, `error-${AgoVoiceErrorCode}`>,
  string
> = {
  start: "Start voice call",
  "requesting-permission": "Waiting for microphone…",
  connecting: "Connecting…",
  listening: "Listening",
  "user-speaking": "Listening",
  "agent-thinking": "Thinking…",
  "agent-speaking": "Speaking",
  muted: "Muted",
  reconnecting: "Reconnecting…",
  degraded: "Connection degraded",
  ended: "Call ended",
  "consent-title": "Start a voice call?",
  "consent-body":
    "Your microphone will be shared with the voice agent and the conversation is transcribed into this chat.",
  "consent-accept": "Start call",
  "consent-cancel": "Cancel",
  mute: "Mute",
  unmute: "Unmute",
  end: "End call",
  cancel: "Cancel",
  retry: "Retry",
  dismiss: "Dismiss",
  meter: "Microphone level",
  "user-speaking-indicator": "You are speaking",
};

/** Resolve one label: consumer override, then the English default. */
export function voiceLabel(
  labels: AgoVoiceLabels | undefined,
  key: AgoVoiceLabelKey,
  fallback?: string
): string {
  const override = labels?.[key];
  if (override !== undefined) return override;
  const preset = (DEFAULT_VOICE_LABELS as Record<string, string>)[key];
  return preset ?? fallback ?? key;
}

/**
 * UI copy for a voice error: the `error-<code>` label override when provided,
 * otherwise the error's registry message without the trailing docs pointer.
 */
export function voiceErrorMessage(
  error: AgoVoiceError,
  labels?: AgoVoiceLabels
): string {
  const override = labels?.[`error-${error.code as AgoVoiceErrorCode}`];
  if (override !== undefined) return override;
  return error.message.replace(/\s*See https?:\/\/\S+$/, "");
}

/**
 * Theming contract of the voice components. Every visible color/radius reads a
 * `--ago-voice-*` token, falling back into the widget's `--ago-*` tokens where
 * one exists, then a hard default. See docs/general/voice.md for the table.
 *
 * @experimental The token set may still grow while voice is in its
 * staff-gated rollout.
 */
export const VOICE_TOKENS = {
  surface: "var(--ago-voice-surface, var(--ago-panel-background, #fff))",
  border: "var(--ago-voice-border, var(--ago-border-color, #dee3e8))",
  text: "var(--ago-voice-text, var(--ago-text-color, #30373e))",
  textMuted:
    "var(--ago-voice-text-muted, var(--ago-muted-text-color, #6b6d6f))",
  accent: "var(--ago-voice-accent, var(--ago-accent-color, #1b5fc4))",
  destructive: "var(--ago-voice-destructive, #b3261e)",
  focusRing:
    "var(--ago-voice-focus-ring, var(--ago-voice-accent, var(--ago-accent-color, #1b5fc4)))",
  radius: "var(--ago-voice-radius, var(--ago-radius, 12px))",
  meterFill:
    "var(--ago-voice-meter-fill, var(--ago-voice-accent, var(--ago-accent-color, #1b5fc4)))",
} as const;

export const VOICE_STYLE_ID = "ago-voice-styles";

// The one injected stylesheet: only what inline styles cannot express
// (keyframes and media queries). Every rule is scoped under an ago-prefixed
// class so nothing can leak into the host app.
const VOICE_CSS = `
@keyframes ago-voice-spin { to { transform: rotate(360deg); } }
@keyframes ago-voice-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes ago-voice-blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
.ago-voice-focusable:focus-visible {
  outline: 2px solid ${VOICE_TOKENS.focusRing};
  outline-offset: 2px;
}
.ago-voice-spinner { animation: ago-voice-spin 0.8s linear infinite; }
.ago-voice-bar-ended { animation: ago-voice-fade-out 0.4s ease 0.8s forwards; }
.ago-voice-dot { animation: ago-voice-blink 1.2s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .ago-voice-spinner, .ago-voice-bar-ended, .ago-voice-dot { animation: none !important; }
}
@media (forced-colors: active) {
  .ago-voice-meter-fill { background: CanvasText !important; }
  .ago-voice-meter { border: 1px solid CanvasText; }
}
`;

/**
 * Inject the scoped voice stylesheet once. SSR-guarded (no document, no-op)
 * and idempotent; called from component effects, never at import time.
 */
export function ensureVoiceStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(VOICE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = VOICE_STYLE_ID;
  style.textContent = VOICE_CSS;
  document.head.appendChild(style);
}

/**
 * Return focus to the mounted `<AgoVoiceButton>` (it renders a
 * `data-ago-voice-button` attribute). Used on call end and error dismiss so
 * keyboard users land back where the call started.
 */
export function focusVoiceButton(): void {
  if (typeof document === "undefined") return;
  document
    .querySelector<HTMLElement>("[data-ago-voice-button]")
    ?.focus();
}

/** Base style shared by every voice control; all targets are at least 44px. */
export const voiceControlStyle: React.CSSProperties = {
  minWidth: "44px",
  minHeight: "44px",
  boxSizing: "border-box",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  padding: "0 12px",
  border: `1px solid ${VOICE_TOKENS.border}`,
  borderRadius: VOICE_TOKENS.radius,
  background: "transparent",
  color: VOICE_TOKENS.text,
  fontFamily: "inherit",
  fontSize: "13px",
  fontWeight: 600,
  lineHeight: 1.2,
  cursor: "pointer",
};

export function MicIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
      <path d="M19 11a7 7 0 0 1-14 0H3a9 9 0 0 0 8 8.94V22h2v-2.06A9 9 0 0 0 21 11h-2Z" />
    </svg>
  );
}

export function MicOffIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M15 11V5a3 3 0 0 0-5.94-.6L15 10.34V11Z" />
      <path d="M9 11.66V11h-.66L9 11.66Z" />
      <path d="M19 11a7 7 0 0 1-.36 2.22l1.52 1.52A8.94 8.94 0 0 0 21 11h-2Z" />
      <path d="M3.27 2 2 3.27l7 7V11a3 3 0 0 0 4.24 2.73l1.46 1.46A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.92V22h2v-4.08a8.9 8.9 0 0 0 2.65-.86l4.08 4.08L21 19.73 3.27 2Z" />
    </svg>
  );
}

export function CloseIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" />
    </svg>
  );
}

export function VoiceSpinner(): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="ago-voice-spinner"
      style={{
        display: "inline-block",
        width: "14px",
        height: "14px",
        flex: "none",
        boxSizing: "border-box",
        border: `2px solid ${VOICE_TOKENS.border}`,
        borderBlockStartColor: VOICE_TOKENS.accent,
        borderRadius: "50%",
      }}
    />
  );
}
