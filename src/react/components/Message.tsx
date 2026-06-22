import React from "react";
import type { AgoAttachment, AgoMessage } from "../../client/types";
import {
  canInlineImage,
  formatFileSize,
  safeAttachmentUrl,
} from "../../utils/attachments";
import { Markdown } from "./Markdown";

// ── Subcomponents ───────────────────────────────────────────────────

/**
 * Render one uploaded file. Only files the backend verified as safe images are
 * embedded inline as an `<img>`; everything else (and any unverified or spoofed
 * type) renders as a download link, never embedded. See `utils/attachments`.
 */
const AttachmentCard: React.FC<{ attachment: AgoAttachment; isUser: boolean }> = ({
  attachment,
  isUser,
}) => {
  const href = safeAttachmentUrl(attachment.url);

  if (canInlineImage(attachment)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: "inline-block", textDecoration: "none" }}
      >
        <img
          src={href}
          alt={attachment.name}
          loading="lazy"
          style={{
            maxWidth: "180px",
            maxHeight: "160px",
            objectFit: "cover",
            borderRadius: "10px",
            border: "1px solid #dee3e8",
            display: "block",
          }}
        />
      </a>
    );
  }

  const size = formatFileSize(attachment.fileSize);
  const inner = (
    <>
      <span style={{ fontSize: "16px", lineHeight: 1, flexShrink: 0 }} aria-hidden>
        📄
      </span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "160px",
          }}
          title={attachment.name}
        >
          {attachment.name}
        </span>
        {size && (
          <span style={{ fontSize: "11px", color: "#6b6d6f" }}>{size}</span>
        )}
      </span>
    </>
  );

  const cardStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "10px",
    border: "1px solid #dee3e8",
    backgroundColor: isUser ? "rgba(255,255,255,0.12)" : "#fff",
    color: isUser ? "#fff" : "#30373e",
    fontSize: "13px",
    textDecoration: "none",
    maxWidth: "220px",
  };

  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" style={cardStyle}>
      {inner}
    </a>
  ) : (
    <div style={cardStyle}>{inner}</div>
  );
};

const SourceCard: React.FC<{
  source: { id: string; title: string; url?: string };
  index: number;
}> = ({ source, index }) => {
  const card = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        minWidth: 0,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: "18px",
          height: "18px",
          borderRadius: "3px",
          border: "1px solid #1b5fc4",
          color: "#1b5fc4",
          fontSize: "11px",
          fontWeight: 500,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f0f4ff",
        }}
      >
        {index + 1}
      </div>
      <div
        style={{
          fontSize: "12px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "#30373e",
        }}
        title={source.title}
      >
        {source.title}
      </div>
    </div>
  );

  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    padding: "8px 10px",
    border: "1px solid #dee3e8",
    borderRadius: "8px",
    backgroundColor: "#fff",
    cursor: source.url ? "pointer" : "default",
    textDecoration: "none",
    color: "inherit",
    minWidth: 0,
    transition: "border-color 0.15s",
  };

  if (source.url) {
    return (
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        style={containerStyle}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = "#1b5fc4";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = "#dee3e8";
        }}
      >
        {card}
      </a>
    );
  }

  return <div style={containerStyle}>{card}</div>;
};

const StreamingDots: React.FC = () => (
  <div style={{ display: "flex", gap: "4px", padding: "4px 0" }}>
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          backgroundColor: "#b5bfc8",
          animation: "ago-pulse 1.2s ease-in-out infinite",
          animationDelay: `${i * 0.2}s`,
        }}
      />
    ))}
    <style>{`
      @keyframes ago-pulse {
        0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
        40% { opacity: 1; transform: scale(1); }
      }
    `}</style>
  </div>
);

// ── Main component ──────────────────────────────────────────────────

export interface MessageProps {
  message: AgoMessage;
  className?: string;
  /** Show the agent name above assistant messages. Defaults to `false`. */
  showAgentName?: boolean;
  /**
   * Whether this is the last message in the list. Follow-up suggestions only
   * render on the last message. Defaults to `false`.
   */
  isLast?: boolean;
  /**
   * Called when the user clicks a suggested follow-up reply. When omitted the
   * follow-up buttons render but are not interactive (backwards-compatible).
   */
  onFollowUpClick?: (reply: string) => void;
}

export const Message: React.FC<MessageProps> = ({
  message,
  className = "",
  showAgentName = false,
  isLast = false,
  onFollowUpClick,
}) => {
  const isUser = message.role === "user";
  const isStreaming = message.status === "IN_PROGRESS";

  return (
    <div
      className={`ago-message ago-message--${message.role} ${className}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        marginBottom: "16px",
      }}
    >
      {/* Agent name for assistant messages */}
      {!isUser && showAgentName && message.agent && (
        <div
          className="ago-message__agent"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
            fontWeight: 500,
            color: "#30373e",
            marginBottom: "6px",
            padding: "0 4px",
          }}
        >
          {message.agent.displayName || message.agent.name}
        </div>
      )}

      {/* Sources (above message content, like the main app) */}
      {!isUser && message.sources && message.sources.length > 0 && (
        <div
          className="ago-message__sources"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "6px",
            marginBottom: "10px",
            width: "100%",
            maxWidth: "85%",
          }}
        >
          {message.sources.map((source, i) => (
            <SourceCard key={source.id} source={source} index={i} />
          ))}
        </div>
      )}

      {/* Attachments (uploaded files), above the message bubble */}
      {message.attachments && message.attachments.length > 0 && (
        <div
          className="ago-message__attachments"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            marginBottom: "6px",
            justifyContent: isUser ? "flex-end" : "flex-start",
            maxWidth: "75%",
          }}
        >
          {message.attachments.map((attachment) => (
            <AttachmentCard
              key={attachment.id}
              attachment={attachment}
              isUser={isUser}
            />
          ))}
        </div>
      )}

      {/* Message bubble — hidden for an attachment-only message (no empty box). */}
      {(message.content || isStreaming) && (
        <div
          className="ago-message__content"
          style={{
            maxWidth: isUser ? "75%" : "100%",
            padding: isUser ? "10px 14px" : "2px 8px",
            borderRadius: isUser ? "16px" : "0",
            backgroundColor: isUser ? "#03182f" : "transparent",
            color: isUser ? "#fff" : "#30373e",
            wordBreak: "break-word",
            fontSize: "16px",
            lineHeight: "1.6",
          }}
        >
          {message.content ? (
            <Markdown content={message.content} />
          ) : (
            isStreaming && <StreamingDots />
          )}
        </div>
      )}

      {/* Follow-up replies — only on the last message, so stale suggestions
          disappear once the user sends their next message. */}
      {isLast &&
        message.followUpReplies &&
        message.followUpReplies.length > 0 && (
          <div
            className="ago-message__followups"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              marginTop: "10px",
            }}
          >
            {message.followUpReplies.map((reply, i) => (
              <button
                key={i}
                type="button"
                className="ago-message__followup-btn"
                disabled={!onFollowUpClick}
                onClick={
                  onFollowUpClick ? () => onFollowUpClick(reply) : undefined
                }
                style={{
                  minHeight: "36px",
                  padding: "6px 14px",
                  fontSize: "13px",
                  borderRadius: "16px",
                  border: "1px solid #dee3e8",
                  backgroundColor: "#fff",
                  color: "#30373e",
                  cursor: onFollowUpClick ? "pointer" : "default",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "#1b5fc4";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor =
                    "#dee3e8";
                }}
              >
                {reply}
              </button>
            ))}
          </div>
        )}
    </div>
  );
};
