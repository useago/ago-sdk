import React, { useEffect, useRef } from "react";
import type { UseAgoVoiceResult } from "../hooks/useAgoVoice";
import {
  ensureVoiceStyles,
  focusVoiceButton,
  MicIcon,
  VOICE_TOKENS,
  voiceControlStyle,
  voiceLabel,
  type AgoVoiceLabels,
} from "./voiceShared";

/** Props passed to a custom {@link AgoVoiceButtonProps.renderConsent}. */
export interface AgoVoiceRenderConsentProps {
  /** Accept the disclosure and start the call. */
  accept: () => void;
  /** Decline the disclosure; nothing starts, focus stays on the button. */
  cancel: () => void;
}

export interface AgoVoiceButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The single-object handoff from `useAgoVoice()`. */
  voice: UseAgoVoiceResult;
  /** Copy overrides (all consent and control labels are overridable). */
  labels?: AgoVoiceLabels;
  /**
   * Replace the built-in minimal consent disclosure with your own UI. Rendered
   * while `voice.consentPending` is true; call `accept`/`cancel` from it.
   */
  renderConsent?: (props: AgoVoiceRenderConsentProps) => React.ReactNode;
}

const ACTIVE_STATUSES = [
  "requesting-permission",
  "connecting",
  "live",
  "reconnecting",
];

/**
 * The mic affordance: renders nothing until `availability` resolves to
 * `"available"` (never a disabled dangling mic), starts a session on click,
 * and shows the built-in consent disclosure the first time (two buttons,
 * labels-overridable, `renderConsent` escape hatch). While a call is active it
 * acts as a toggle that ends the call.
 *
 * A controlled presentation primitive over `useAgoVoice`: it never creates a
 * session of its own.
 *
 * @experimental Component props may still move while voice is in its
 * staff-gated rollout. The hook shape and vocabulary it renders are stable.
 */
export const AgoVoiceButton = React.forwardRef<
  HTMLButtonElement,
  AgoVoiceButtonProps
>(function AgoVoiceButton(
  { voice, labels, renderConsent, className = "", style, onClick, ...rest },
  ref
) {
  useEffect(() => {
    ensureVoiceStyles();
  }, []);

  // Move focus into the disclosure when it opens so keyboard users can act on
  // it immediately; cancel puts focus back on the button.
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (voice.consentPending && !renderConsent) acceptRef.current?.focus();
  }, [voice.consentPending, renderConsent]);

  if (voice.availability !== "available") return null;

  const active =
    voice.consentPending || ACTIVE_STATUSES.includes(voice.status);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (voice.consentPending) {
      voice.cancelConsent();
      return;
    }
    if (active) {
      voice.stop();
      return;
    }
    void voice.start().catch(() => {
      // Failures surface through voice:error and the bar; a synchronous
      // rejection here (double click racing session-active) is benign.
    });
  };

  const consentUi = voice.consentPending
    ? renderConsent
      ? renderConsent({
          accept: voice.acceptConsent,
          cancel: voice.cancelConsent,
        })
      : buildConsent(voice, labels, acceptRef)
    : null;

  return (
    <span
      className="ago-voice"
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        {...rest}
        ref={ref}
        type="button"
        data-ago-voice-button=""
        className={`ago-voice-button ago-voice-focusable ${className}`.trim()}
        aria-label={
          rest["aria-label"] ??
          voiceLabel(labels, active ? "end" : "start")
        }
        aria-pressed={active}
        onClick={handleClick}
        style={{
          ...voiceControlStyle,
          padding: "0",
          width: "44px",
          ...(active
            ? {
                background: VOICE_TOKENS.accent,
                borderColor: VOICE_TOKENS.accent,
                color: VOICE_TOKENS.surface,
              }
            : {}),
          ...style,
        }}
      >
        <MicIcon />
      </button>
      {consentUi}
    </span>
  );
});

function buildConsent(
  voice: UseAgoVoiceResult,
  labels: AgoVoiceLabels | undefined,
  acceptRef: React.RefObject<HTMLButtonElement>
): React.ReactElement {
  const handleCancel = () => {
    voice.cancelConsent();
    focusVoiceButton();
  };
  return (
    <div
      role="dialog"
      aria-label={voiceLabel(labels, "consent-title")}
      className="ago-voice-consent"
      style={{
        position: "absolute",
        insetBlockEnd: "calc(100% + 8px)",
        insetInlineStart: 0,
        boxSizing: "border-box",
        minWidth: "240px",
        maxWidth: "320px",
        padding: "14px 16px",
        background: VOICE_TOKENS.surface,
        color: VOICE_TOKENS.text,
        border: `1px solid ${VOICE_TOKENS.border}`,
        borderRadius: VOICE_TOKENS.radius,
        boxShadow: "rgba(15, 15, 15, 0.12) 0px 4px 20px 0px",
        fontFamily: "inherit",
        fontSize: "13px",
        lineHeight: 1.5,
        textAlign: "start",
      }}
    >
      <div
        className="ago-voice-consent-title"
        style={{ fontWeight: 600, marginBlockEnd: "4px" }}
      >
        {voiceLabel(labels, "consent-title")}
      </div>
      <div
        className="ago-voice-consent-body"
        style={{ color: VOICE_TOKENS.textMuted, marginBlockEnd: "10px" }}
      >
        {voiceLabel(labels, "consent-body")}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          ref={acceptRef}
          type="button"
          className="ago-voice-consent-accept ago-voice-focusable"
          onClick={voice.acceptConsent}
          style={{
            ...voiceControlStyle,
            background: VOICE_TOKENS.accent,
            borderColor: VOICE_TOKENS.accent,
            color: VOICE_TOKENS.surface,
          }}
        >
          {voiceLabel(labels, "consent-accept")}
        </button>
        <button
          type="button"
          className="ago-voice-consent-cancel ago-voice-focusable"
          onClick={handleCancel}
          style={voiceControlStyle}
        >
          {voiceLabel(labels, "consent-cancel")}
        </button>
      </div>
    </div>
  );
}
