import React, { useEffect } from "react";
import type { AgoClient } from "../../client/AgoClient";
import {
  useProactiveNudge,
  type UseProactiveNudgeOptions,
} from "../hooks/useProactiveNudge";

export interface AgoNudgeProps {
  /** The AGO client instance. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
  /**
   * Called after accepting a nudge that expands into the chat (agent-sourced
   * or with a `goal`) — open your chat UI here. The conversation is already
   * pre-seeded with a hidden kickoff message.
   */
  onExpand?: UseProactiveNudgeOptions["onExpand"];
  /** Auto-dismiss after this many ms. Off by default (nudges stay until acted on). */
  autoHideMs?: number;
  /** Corner to anchor to (near the chat launcher). Default `"bottom-right"`. */
  position?: "bottom-right" | "bottom-left";
  /** Label of the open-chat affordance. Default `"Open chat"`. */
  openChatLabel?: string;
  /** Additional CSS class (consumer hook only; the SDK ships no CSS for it). */
  className?: string;
}

/**
 * Prebuilt proactive-nudge toast: a small, always-dismissable bubble anchored
 * near the chat launcher. Never modal — it never blocks the page. Renders the
 * nudge message, its optional action button, and an "open chat" affordance
 * for nudges that expand into a conversation.
 */
export const AgoNudge: React.FC<AgoNudgeProps> = ({
  client,
  onExpand,
  autoHideMs,
  position = "bottom-right",
  openChatLabel = "Open chat",
  className = "",
}) => {
  const { nudge, accept, dismiss } = useProactiveNudge({ client, onExpand });

  // Optional auto-hide, reset per nudge instance.
  useEffect(() => {
    if (!nudge || !autoHideMs) return;
    const timer = setTimeout(() => dismiss(), autoHideMs);
    return () => clearTimeout(timer);
  }, [nudge, autoHideMs, dismiss]);

  if (!nudge) return null;

  const expands = nudge.source === "agent" || Boolean(nudge.goal);

  return (
    <div
      className={`ago-nudge ${className}`}
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "90px", // clears a typical 56-64px launcher bubble
        ...(position === "bottom-left" ? { left: "20px" } : { right: "20px" }),
        zIndex: 2147483000,
        maxWidth: "320px",
        padding: "14px 16px",
        backgroundColor: "#fff",
        color: "#03182f",
        border: "1px solid #dee3e8",
        borderRadius: "16px",
        boxShadow: "rgba(15, 15, 15, 0.12) 0px 4px 20px 0px",
        fontFamily:
          '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: "14px",
        lineHeight: 1.5,
        textAlign: "left",
      }}
    >
      <button
        type="button"
        className="ago-nudge__close"
        aria-label="Dismiss"
        onClick={dismiss}
        style={{
          position: "absolute",
          top: "6px",
          right: "8px",
          border: "none",
          background: "transparent",
          color: "#6b6d6f",
          fontSize: "16px",
          lineHeight: 1,
          cursor: "pointer",
          padding: "4px",
        }}
      >
        ×
      </button>

      <div className="ago-nudge__message" style={{ paddingRight: "16px" }}>
        {nudge.message}
      </div>

      {(nudge.action || expands) && (
        <div
          className="ago-nudge__actions"
          style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}
        >
          {nudge.action && (
            <button
              type="button"
              className="ago-nudge__action"
              onClick={() => void accept()}
              style={{
                border: "none",
                borderRadius: "10px",
                padding: "6px 12px",
                backgroundColor: "#03182f",
                color: "#e8f0fe",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {nudge.action.label}
            </button>
          )}
          {expands && (
            <button
              type="button"
              className="ago-nudge__expand"
              onClick={() => void accept()}
              style={{
                border: "1px solid #dee3e8",
                borderRadius: "10px",
                padding: "6px 12px",
                backgroundColor: "#fff",
                color: "#03182f",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {openChatLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
