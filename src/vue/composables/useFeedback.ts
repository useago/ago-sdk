import { ref } from "vue";
import type { AgoClient } from "../../client/AgoClient";
import type { FeedbackDetails, FeedbackRating } from "../../client/types";
import { useAgo } from "./useAgo";

export interface UseFeedbackOptions {
  client?: AgoClient;
}

/**
 * Composable to report answers that did not work.
 *
 * ```ts
 * const { ratings, submitFeedback } = useFeedback();
 *
 * await submitFeedback(message.id, "negative", { reasons: ["inaccurate"] });
 * ```
 *
 * A bare rating is a reaction. Adding a reason or a comment files the report in
 * the AGO feedback dashboard, where someone can act on it. `ratings` holds what
 * was sent per message id, so a thumb can render as selected.
 */
export function useFeedback(options: UseFeedbackOptions = {}) {
  const client = options.client ?? useAgo();

  const ratings = ref<Record<string, FeedbackRating>>({});
  const isSubmitting = ref(false);
  const error = ref<Error | null>(null);
  // The rating is recorded once the API accepted it, so a failed report never
  // lights a thumb up. That makes two quick clicks a race: click down, click up,
  // and the slower response would win. Stamping each click and dropping a
  // response that a newer click has superseded keeps the last click on screen.
  const clickSeq = new Map<string, number>();

  function nextSeq(key: string): number {
    const seq = (clickSeq.get(key) ?? 0) + 1;
    clickSeq.set(key, seq);
    return seq;
  }

  const isLatest = (key: string, seq: number): boolean =>
    clickSeq.get(key) === seq;

  async function submitFeedback(
    messageId: string,
    rating: FeedbackRating,
    details?: FeedbackDetails
  ) {
    const seq = nextSeq(messageId);
    isSubmitting.value = true;
    error.value = null;
    try {
      await client.submitFeedback(messageId, rating, details);
      if (isLatest(messageId, seq)) {
        ratings.value = { ...ratings.value, [messageId]: rating };
      }
    } catch (err) {
      const failure =
        err instanceof Error ? err : new Error("Failed to submit feedback");
      error.value = failure;
      throw failure;
    } finally {
      isSubmitting.value = false;
    }
  }

  /** Report the conversation; lands on its last answer, whose id is returned. */
  async function submitConversationFeedback(
    conversationId: string,
    rating: FeedbackRating,
    details?: FeedbackDetails & { lastMessageId?: string }
  ) {
    const seq = nextSeq(conversationId);
    isSubmitting.value = true;
    error.value = null;
    try {
      const messageId = await client.submitConversationFeedback(
        conversationId,
        rating,
        details
      );
      if (isLatest(conversationId, seq)) {
        ratings.value = { ...ratings.value, [messageId]: rating };
      }
      return messageId;
    } catch (err) {
      const failure =
        err instanceof Error ? err : new Error("Failed to submit feedback");
      error.value = failure;
      throw failure;
    } finally {
      isSubmitting.value = false;
    }
  }

  return {
    ratings,
    isSubmitting,
    error,
    submitFeedback,
    submitConversationFeedback,
  };
}
