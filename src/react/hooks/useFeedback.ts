import { useCallback, useRef, useState } from "react";
import type { AgoClient } from "../../client/AgoClient";
import { AgoError } from "../../client/errors";
import type { FeedbackDetails, FeedbackRating } from "../../client/types";
import { useOptionalAgoClient } from "../context/AgoContext";

export interface UseFeedbackOptions {
  /** The AGO client instance. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
}

export interface UseFeedbackResult {
  /**
   * The rating already sent for each message, keyed by message id. Use it to
   * light up the thumb the user picked (and to re-render after a change of
   * mind: sending a new rating overwrites the previous one).
   */
  ratings: Record<string, FeedbackRating>;
  /** Report one answer. */
  submitFeedback: (
    messageId: string,
    rating: FeedbackRating,
    details?: FeedbackDetails
  ) => Promise<void>;
  /** Report the conversation; lands on its last answer, whose id is returned. */
  submitConversationFeedback: (
    conversationId: string,
    rating: FeedbackRating,
    details?: FeedbackDetails & { lastMessageId?: string }
  ) => Promise<string>;
  /** True while a report is in flight. */
  isSubmitting: boolean;
  /** The last failure, or null. Cleared when a new report starts. */
  error: Error | null;
}

/**
 * Hook to report answers that did not work.
 *
 * ```tsx
 * const { ratings, submitFeedback } = useFeedback();
 *
 * <button onClick={() => submitFeedback(message.id, "negative", {
 *   reasons: ["inaccurate"],
 * })} aria-pressed={ratings[message.id] === "negative"}>
 *   👎
 * </button>
 * ```
 *
 * A bare rating is a reaction. Adding a reason or a comment files the report in
 * the AGO feedback dashboard, where someone can act on it.
 */
export function useFeedback({
  client: clientProp,
}: UseFeedbackOptions = {}): UseFeedbackResult {
  const contextClient = useOptionalAgoClient();
  const client = clientProp || contextClient;

  if (!client) {
    throw new AgoError(
      "useFeedback requires an AgoClient. Either pass it as options.client or wrap your app in <AgoProvider>.",
      "missing_client"
    );
  }

  const [ratings, setRatings] = useState<Record<string, FeedbackRating>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // The rating is recorded once the API accepted it, so a failed report never
  // lights a thumb up. That makes two quick clicks a race: click down, click up,
  // and the slower response would win. Stamping each click and dropping a
  // response that a newer click has superseded keeps the last click on screen.
  const clickSeq = useRef(new Map<string, number>());

  const nextSeq = (messageId: string): number => {
    const seq = (clickSeq.current.get(messageId) ?? 0) + 1;
    clickSeq.current.set(messageId, seq);
    return seq;
  };

  const isLatest = (messageId: string, seq: number): boolean =>
    clickSeq.current.get(messageId) === seq;

  const submitFeedback = useCallback(
    async (
      messageId: string,
      rating: FeedbackRating,
      details?: FeedbackDetails
    ) => {
      const seq = nextSeq(messageId);
      setIsSubmitting(true);
      setError(null);
      try {
        await client.submitFeedback(messageId, rating, details);
        if (isLatest(messageId, seq)) {
          setRatings((current) => ({ ...current, [messageId]: rating }));
        }
      } catch (err) {
        const failure =
          err instanceof Error ? err : new Error("Failed to submit feedback");
        setError(failure);
        throw failure;
      } finally {
        setIsSubmitting(false);
      }
    },
    [client]
  );

  const submitConversationFeedback = useCallback(
    async (
      conversationId: string,
      rating: FeedbackRating,
      details?: FeedbackDetails & { lastMessageId?: string }
    ) => {
      const seq = nextSeq(conversationId);
      setIsSubmitting(true);
      setError(null);
      try {
        const messageId = await client.submitConversationFeedback(
          conversationId,
          rating,
          details
        );
        if (isLatest(conversationId, seq)) {
          setRatings((current) => ({ ...current, [messageId]: rating }));
        }
        return messageId;
      } catch (err) {
        const failure =
          err instanceof Error ? err : new Error("Failed to submit feedback");
        setError(failure);
        throw failure;
      } finally {
        setIsSubmitting(false);
      }
    },
    [client]
  );

  return {
    ratings,
    submitFeedback,
    submitConversationFeedback,
    isSubmitting,
    error,
  };
}
