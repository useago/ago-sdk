import React, { useEffect, useRef, useState } from "react";
import { resolveBarState, type VoiceStatus } from "../../voice/types";
import type { UseAgoVoiceResult } from "../hooks/useAgoVoice";
import {
  CloseIcon,
  ensureVoiceStyles,
  focusVoiceButton,
  MicOffIcon,
  VOICE_TOKENS,
  voiceControlStyle,
  voiceErrorMessage,
  voiceLabel,
  VoiceSpinner,
  type AgoVoiceLabelKey,
  type AgoVoiceLabels,
} from "./voiceShared";

export interface AgoVoiceBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The single-object handoff from `useAgoVoice()`. */
  voice: UseAgoVoiceResult;
  /** Copy overrides (every state label and per-error copy is overridable). */
  labels?: AgoVoiceLabels;
}

const KNOWN_STATUSES: VoiceStatus[] = [
  "idle",
  "requesting-permission",
  "connecting",
  "live",
  "reconnecting",
  "error",
  "ended",
];

const ACTIVE_STATUSES = [
  "requesting-permission",
  "connecting",
  "live",
  "reconnecting",
];

/** How long the "Call ended" state stays visible before the bar fades away. */
export const VOICE_BAR_ENDED_MS = 1200;

/**
 * The in-call status bar: status text, mic input-level meter, mute and
 * end-call. It NEVER renders transcript text (captions belong in the message
 * list, see `<AgoVoiceCaptions>`). In-flow, no z-index, inherits the host
 * font.
 *
 * A controlled presentation primitive over `useAgoVoice`: it never creates a
 * session of its own. It renders nothing while the session is idle.
 *
 * @experimental Component props may still move while voice is in its
 * staff-gated rollout. The hook shape and vocabulary it renders are stable.
 */
export const AgoVoiceBar = React.forwardRef<HTMLDivElement, AgoVoiceBarProps>(
  function AgoVoiceBar(
    { voice, labels, className = "", style, ...rest },
    ref
  ) {
    useEffect(() => {
      ensureVoiceStyles();
    }, []);

    // "Call ended" stays up ~1.2s, then the bar unmounts and focus returns to
    // the mic button. A new session resets the hidden flag.
    const [endedHidden, setEndedHidden] = useState(false);
    useEffect(() => {
      if (voice.status === "ended") {
        const timer = setTimeout(() => {
          setEndedHidden(true);
          focusVoiceButton();
        }, VOICE_BAR_ENDED_MS);
        return () => clearTimeout(timer);
      }
      setEndedHidden(false);
      return undefined;
    }, [voice.status]);

    // Focus moves to End when the call starts (the first state that has an
    // End control).
    const endRef = useRef<HTMLButtonElement>(null);
    const prevStatusRef = useRef(voice.status);
    useEffect(() => {
      const prev = prevStatusRef.current;
      prevStatusRef.current = voice.status;
      const started =
        (voice.status === "connecting" || voice.status === "live") &&
        (prev === "idle" ||
          prev === "requesting-permission" ||
          prev === "ended");
      if (started) endRef.current?.focus();
    }, [voice.status]);

    // Esc ends the call from anywhere on the page while one is active.
    const activeCall = ACTIVE_STATUSES.includes(voice.status);
    const stop = voice.stop;
    useEffect(() => {
      if (!activeCall || typeof document === "undefined") return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") stop();
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [activeCall, stop]);

    const known = KNOWN_STATUSES.includes(voice.status);
    // Unknown future status values render as a generic status (forward
    // compatibility: never an exhaustive-switch crash).
    const barState: string = known
      ? resolveBarState(voice.status, voice.turn, {
          muted: voice.muted,
          degraded: voice.degraded,
        })
      : voice.status;

    const engaged = known ? voice.status !== "idle" : true;
    if (!engaged || (voice.status === "ended" && endedHidden)) return null;

    const isError = barState === "error" && voice.error !== undefined;
    const isEnded = barState === "ended";

    // Degraded folds over the turn; keep the underlying turn label as the
    // main line and show "Connection degraded" as the sub-line.
    const mainLabelKey: string =
      barState === "degraded"
        ? resolveBarState(voice.status, voice.turn, {
            muted: voice.muted,
            degraded: false,
          })
        : barState;
    const statusLabel = voiceLabel(
      labels,
      mainLabelKey as AgoVoiceLabelKey,
      String(voice.status)
    );

    const showMeter = barState === "listening" || barState === "user-speaking";
    const showCancel = barState === "requesting-permission";
    const showEnd = !showCancel && !isError && !isEnded;
    const showMute = [
      "listening",
      "user-speaking",
      "agent-thinking",
      "agent-speaking",
      "degraded",
    ].includes(barState);
    const showUnmute = barState === "muted";

    const handleDismiss = () => {
      voice.dismissError();
      focusVoiceButton();
    };

    const level = Math.max(0, Math.min(1, voice.level));

    return (
      <div
        {...rest}
        ref={ref}
        className={`ago-voice-bar ${isEnded ? "ago-voice-bar-ended " : ""}${className}`.trim()}
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
          boxSizing: "border-box",
          minWidth: 0,
          padding: "8px 12px",
          background: VOICE_TOKENS.surface,
          color: VOICE_TOKENS.text,
          border: `1px solid ${VOICE_TOKENS.border}`,
          borderRadius: VOICE_TOKENS.radius,
          fontFamily: "inherit",
          fontSize: "14px",
          lineHeight: 1.4,
          textAlign: "start",
          ...style,
        }}
      >
        <div
          role="status"
          aria-live="polite"
          className="ago-voice-status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            minWidth: 0,
            flex: "1 1 auto",
          }}
        >
          {barState === "connecting" && <VoiceSpinner />}
          {barState === "muted" && <MicOffIcon />}
          {isError && voice.error ? (
            <span
              className="ago-voice-error-message"
              style={{ color: VOICE_TOKENS.destructive }}
            >
              {voiceErrorMessage(voice.error, labels)}
            </span>
          ) : (
            <span
              className="ago-voice-status-text"
              style={{ display: "inline-flex", flexDirection: "column" }}
            >
              <span>{statusLabel}</span>
              {barState === "degraded" && (
                <span
                  className="ago-voice-degraded"
                  style={{
                    fontSize: "12px",
                    color: VOICE_TOKENS.textMuted,
                  }}
                >
                  {voiceLabel(labels, "degraded")}
                </span>
              )}
            </span>
          )}
        </div>

        {showMeter && (
          <div
            role="meter"
            aria-label={voiceLabel(labels, "meter")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
            className="ago-voice-meter"
            style={{
              width: "64px",
              height: "6px",
              flex: "none",
              borderRadius: "3px",
              background: VOICE_TOKENS.border,
              overflow: "hidden",
            }}
          >
            <div
              className="ago-voice-meter-fill"
              style={{
                width: `${Math.round(level * 100)}%`,
                height: "100%",
                background: VOICE_TOKENS.meterFill,
              }}
            />
          </div>
        )}

        {!isEnded && (
          <div
            className="ago-voice-controls"
            style={{
              display: "flex",
              gap: "8px",
              marginInlineStart: "auto",
              flex: "none",
            }}
          >
            {isError ? (
              <>
                <button
                  type="button"
                  className="ago-voice-retry ago-voice-focusable"
                  onClick={voice.retry}
                  style={{
                    ...voiceControlStyle,
                    background: VOICE_TOKENS.accent,
                    borderColor: VOICE_TOKENS.accent,
                    color: VOICE_TOKENS.surface,
                  }}
                >
                  {voiceLabel(labels, "retry")}
                </button>
                <button
                  type="button"
                  className="ago-voice-dismiss ago-voice-focusable"
                  aria-label={voiceLabel(labels, "dismiss")}
                  onClick={handleDismiss}
                  style={{ ...voiceControlStyle, padding: "0", width: "44px" }}
                >
                  <CloseIcon />
                </button>
              </>
            ) : (
              <>
                {showMute && (
                  <button
                    type="button"
                    className="ago-voice-mute ago-voice-focusable"
                    onClick={voice.toggleMute}
                    style={voiceControlStyle}
                  >
                    {voiceLabel(labels, "mute")}
                  </button>
                )}
                {showUnmute && (
                  <button
                    type="button"
                    className="ago-voice-unmute ago-voice-focusable"
                    onClick={voice.toggleMute}
                    style={voiceControlStyle}
                  >
                    {voiceLabel(labels, "unmute")}
                  </button>
                )}
                {showCancel && (
                  <button
                    type="button"
                    className="ago-voice-cancel ago-voice-focusable"
                    onClick={voice.stop}
                    style={voiceControlStyle}
                  >
                    {voiceLabel(labels, "cancel")}
                  </button>
                )}
                {showEnd && (
                  <button
                    ref={endRef}
                    type="button"
                    className="ago-voice-end ago-voice-focusable"
                    onClick={voice.stop}
                    style={{
                      ...voiceControlStyle,
                      background: VOICE_TOKENS.destructive,
                      borderColor: VOICE_TOKENS.destructive,
                      color: VOICE_TOKENS.surface,
                    }}
                  >
                    {voiceLabel(labels, "end")}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }
);
