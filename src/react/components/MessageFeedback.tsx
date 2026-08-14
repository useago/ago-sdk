import React, { useState } from "react";
import type { AgoClient } from "../../client/AgoClient";
import type { FeedbackRating, FeedbackReason } from "../../client/types";
import { FEEDBACK_REASONS } from "../../client/types";
import { useFeedback } from "../hooks/useFeedback";

/** Every string the feedback row shows, so a non-English app can translate it. */
export interface MessageFeedbackLabels {
  helpful: string;
  notHelpful: string;
  whatWentWrong: string;
  reasons: Record<FeedbackReason, string>;
  commentPlaceholder: string;
  send: string;
  thanks: string;
}

export const DEFAULT_MESSAGE_FEEDBACK_LABELS: MessageFeedbackLabels = {
  helpful: "Helpful",
  notHelpful: "Not helpful",
  whatWentWrong: "What went wrong?",
  reasons: {
    inaccurate: "Inaccurate",
    incomplete: "Incomplete",
    information_not_found: "Information not found",
    technical_issue: "Technical issue",
  },
  commentPlaceholder: "Anything else? (optional)",
  send: "Send",
  thanks: "Thanks, this was reported.",
};

export interface MessageFeedbackProps {
  /** The answer being judged. */
  messageId: string;
  /** The AGO client. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
  /**
   * After a thumbs-down, open the panel asking what went wrong. Defaults to
   * `true`; pass `false` to collect thumbs only.
   */
  askWhy?: boolean;
  /** Override any of the strings (reason labels can be overridden one by one). */
  labels?: Partial<Omit<MessageFeedbackLabels, "reasons">> & {
    reasons?: Partial<Record<FeedbackReason, string>>;
  };
  /**
   * Called after a report was accepted by the API. Fires once per accepted
   * report, so a thumbs-down followed by the panel calls it twice: first for
   * the bare thumb, then for the detailed report.
   */
  onSubmit?: (report: {
    messageId: string;
    rating: FeedbackRating;
    reasons: FeedbackReason[];
    comment?: string;
  }) => void;
  /** Called when a report could not be sent. */
  onError?: (error: Error) => void;
  className?: string;
}

const ghostButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  // 44px is Apple's HIG minimum touch target, the floor every control in this
  // SDK's UI sits at. The glyph stays 16px; only the hit area grows, with
  // negative margins so the row keeps its small, unobtrusive look.
  width: "44px",
  height: "44px",
  margin: "-8px",
  padding: 0,
  border: "none",
  borderRadius: "8px",
  background: "transparent",
  cursor: "pointer",
  lineHeight: 1,
};

/**
 * Thumbs under an answer, and a "what went wrong?" panel after a thumbs-down.
 *
 * ```tsx
 * <MessageFeedback messageId={message.id} />
 * ```
 *
 * The thumb is sent as soon as it is clicked, so the signal survives a user who
 * ignores the panel; sending the panel then files the detailed report (reasons
 * and comment), which is what shows up in the AGO feedback dashboard.
 */
export const MessageFeedback: React.FC<MessageFeedbackProps> = ({
  messageId,
  client,
  askWhy = true,
  labels: labelOverrides,
  onSubmit,
  onError,
  className = "",
}) => {
  const labels: MessageFeedbackLabels = {
    ...DEFAULT_MESSAGE_FEEDBACK_LABELS,
    ...labelOverrides,
    reasons: {
      ...DEFAULT_MESSAGE_FEEDBACK_LABELS.reasons,
      ...labelOverrides?.reasons,
    },
  };

  const { ratings, submitFeedback } = useFeedback({ client });
  const rating = ratings[messageId];
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [comment, setComment] = useState("");
  const [reported, setReported] = useState(false);
  const [isSending, setIsSending] = useState(false);

  /** Resolves true once the API accepted the report. */
  const send = async (
    next: FeedbackRating,
    details?: { reasons: FeedbackReason[]; comment: string }
  ): Promise<boolean> => {
    try {
      await submitFeedback(messageId, next, details);
      onSubmit?.({
        messageId,
        rating: next,
        reasons: details?.reasons ?? [],
        comment: details?.comment || undefined,
      });
      return true;
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  };

  const rate = (next: FeedbackRating): void => {
    void send(next);
    setDetailsOpen(next === "negative" && askWhy && !reported);
  };

  const toggleReason = (reason: FeedbackReason): void => {
    setReasons((current) =>
      current.includes(reason)
        ? current.filter((r) => r !== reason)
        : [...current, reason]
    );
  };

  // Nothing ticked and nothing typed would re-send the thumb that already went
  // out, and answer "thanks, this was reported" to an empty report.
  const hasDetails = reasons.length > 0 || comment.trim().length > 0;

  const submitDetails = (): void => {
    if (!hasDetails || isSending) return;
    // Held down for the round-trip so one impatient double-click cannot file the
    // same report twice, and the user is only thanked once the report is in: a
    // 422 (an over-long comment), a 403, or a dropped connection leaves the
    // panel as it was, text included, so they can send it again.
    setIsSending(true);
    void send(rating ?? "negative", { reasons, comment: comment.trim() }).then(
      (accepted) => {
        setIsSending(false);
        if (!accepted) return;
        setReported(true);
        setDetailsOpen(false);
      }
    );
  };

  return (
    <div
      className={`ago-feedback ${className}`}
      style={{ marginTop: "6px", width: "100%", maxWidth: "85%" }}
    >
      <div
        className="ago-feedback__actions"
        style={{ display: "flex", alignItems: "center", gap: "2px" }}
      >
        <ThumbButton
          direction="up"
          label={labels.helpful}
          selected={rating === "positive"}
          onClick={() => rate("positive")}
        />
        <ThumbButton
          direction="down"
          label={labels.notHelpful}
          selected={rating === "negative"}
          onClick={() => rate("negative")}
        />
      </div>

      {reported && (
        <div
          className="ago-feedback__thanks"
          role="status"
          style={{ marginTop: "6px", fontSize: "13px", color: "#6b6d6f" }}
        >
          {labels.thanks}
        </div>
      )}

      {detailsOpen && !reported && (
        <div
          className="ago-feedback__panel"
          role="group"
          aria-label={labels.whatWentWrong}
          style={{
            marginTop: "8px",
            padding: "12px",
            border: "1px solid #dee3e8",
            borderRadius: "16px",
            backgroundColor: "#fff",
          }}
        >
          <div
            style={{
              fontSize: "13px",
              fontWeight: 500,
              color: "#30373e",
              marginBottom: "8px",
            }}
          >
            {labels.whatWentWrong}
          </div>

          <div
            className="ago-feedback__reasons"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              marginBottom: "8px",
            }}
          >
            {FEEDBACK_REASONS.map((reason) => {
              const on = reasons.includes(reason);
              return (
                <button
                  key={reason}
                  type="button"
                  className="ago-feedback__reason"
                  aria-pressed={on}
                  onClick={() => toggleReason(reason)}
                  style={{
                    // Same 44px floor as the suggested-reply pills these mimic.
                    minHeight: "44px",
                    padding: "4px 12px",
                    fontSize: "13px",
                    fontFamily: "inherit",
                    borderRadius: "999px",
                    border: `1px solid ${on ? "#1b5fc4" : "#dee3e8"}`,
                    backgroundColor: "transparent",
                    color: on ? "#1b5fc4" : "#30373e",
                    cursor: "pointer",
                  }}
                >
                  {labels.reasons[reason]}
                </button>
              );
            })}
          </div>

          <textarea
            className="ago-feedback__comment"
            rows={2}
            value={comment}
            placeholder={labels.commentPlaceholder}
            aria-label={labels.commentPlaceholder}
            onChange={(e) => setComment(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 10px",
              fontSize: "14px",
              fontFamily: "inherit",
              color: "#30373e",
              border: "1px solid #dee3e8",
              borderRadius: "10px",
              backgroundColor: "transparent",
              resize: "vertical",
            }}
          />

          <button
            type="button"
            className="ago-feedback__send"
            onClick={submitDetails}
            disabled={!hasDetails || isSending}
            style={{
              marginTop: "8px",
              minHeight: "44px",
              padding: "6px 16px",
              fontSize: "14px",
              fontFamily: "inherit",
              borderRadius: "10px",
              border: "none",
              backgroundColor: hasDetails ? "#03182f" : "#b5bfc8",
              color: "#fff",
              opacity: isSending ? 0.6 : 1,
              cursor: hasDetails && !isSending ? "pointer" : "default",
            }}
          >
            {labels.send}
          </button>
        </div>
      )}
    </div>
  );
};

const ThumbButton: React.FC<{
  direction: "up" | "down";
  label: string;
  selected: boolean;
  onClick: () => void;
}> = ({ direction, label, selected, onClick }) => (
  <button
    type="button"
    className={`ago-feedback__thumb ago-feedback__thumb--${direction}`}
    aria-label={label}
    aria-pressed={selected}
    title={label}
    onClick={onClick}
    style={{ ...ghostButton, color: selected ? "#1b5fc4" : "#6b6d6f" }}
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={direction === "down" ? { transform: "rotate(180deg)" } : undefined}
    >
      <path
        d="M7 22h9.3a2 2 0 0 0 2-1.7l1.4-9A2 2 0 0 0 17.7 9H14V5a3 3 0 0 0-3-3l-4 10z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M7 22V12H4.5A1.5 1.5 0 0 0 3 13.5v7A1.5 1.5 0 0 0 4.5 22z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  </button>
);
