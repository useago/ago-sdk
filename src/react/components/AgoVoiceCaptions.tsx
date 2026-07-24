import React, { useEffect } from "react";
import type { UseAgoVoiceResult } from "../hooks/useAgoVoice";
import {
  ensureVoiceStyles,
  VOICE_TOKENS,
  voiceLabel,
  type AgoVoiceLabels,
} from "./voiceShared";

export interface AgoVoiceCaptionsProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** The single-object handoff from `useAgoVoice()`. */
  voice: UseAgoVoiceResult;
  /** Copy overrides. */
  labels?: AgoVoiceLabels;
}

/**
 * The transient live-caption layer, rendered in the message list (never in
 * the bar): the assistant's streaming caption, and a speaking indicator on
 * the user side. User captions are FINAL-ONLY on the wire, so the user side
 * shows the indicator until the final transcript lands (through
 * `voice:persisted` / `voice:turn-final`, which your message list renders).
 *
 * The region is `aria-live="off"`: streamed captions must not be announced
 * per token. Captions are retained through a reconnect.
 *
 * A controlled presentation primitive over `useAgoVoice`: it never creates a
 * session of its own.
 *
 * @experimental Component props may still move while voice is in its
 * staff-gated rollout. The hook shape and vocabulary it renders are stable.
 */
export const AgoVoiceCaptions = React.forwardRef<
  HTMLDivElement,
  AgoVoiceCaptionsProps
>(function AgoVoiceCaptions(
  { voice, labels, className = "", style, ...rest },
  ref
) {
  useEffect(() => {
    ensureVoiceStyles();
  }, []);

  const live = voice.status === "live" || voice.status === "reconnecting";
  const assistant = voice.captions.find(
    (caption) => caption.role === "assistant" && !caption.final
  );
  const userSpeaking = voice.status === "live" && voice.turn === "user-speaking";

  if (!live || (!assistant && !userSpeaking)) return null;

  return (
    <div
      {...rest}
      ref={ref}
      aria-live="off"
      className={`ago-voice-captions ${className}`.trim()}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        fontFamily: "inherit",
        fontSize: "14px",
        lineHeight: 1.5,
        color: VOICE_TOKENS.text,
        textAlign: "start",
        ...style,
      }}
    >
      {userSpeaking && (
        <div
          className="ago-voice-captions-user"
          aria-label={voiceLabel(labels, "user-speaking-indicator")}
          style={{
            alignSelf: "flex-end",
            display: "inline-flex",
            gap: "4px",
            padding: "6px 10px",
            borderRadius: VOICE_TOKENS.radius,
            background: VOICE_TOKENS.border,
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden="true"
              className="ago-voice-dot"
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: VOICE_TOKENS.textMuted,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
      )}
      {assistant && (
        <div
          className="ago-voice-captions-assistant"
          style={{ alignSelf: "flex-start", minWidth: 0 }}
        >
          {assistant.text}
        </div>
      )}
    </div>
  );
});
