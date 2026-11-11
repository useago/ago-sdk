import { normalizeInteraction, normalizeMessage } from "./messageNormalizer";
import type { Conversation } from "./types";

export type RawConversation = {
  id: string;
  title: string;
  viewer_id?: string;
  created_at?: string | null;
  last_message_at?: string | null;
  interaction?: {
    can_send_message: boolean;
    blocking_message_id: string | null;
  };
  messages: Parameters<typeof normalizeMessage>[0][];
};

export function mapConversation(raw: RawConversation): Conversation {
  return {
    id: raw.id,
    title: raw.title,
    lastMessageDate: new Date(raw.last_message_at ?? raw.created_at ?? 0),
    messages: raw.messages.map((message) =>
      normalizeMessage(message, raw.id, !!raw.interaction),
    ),
    interaction: raw.interaction
      ? normalizeInteraction(raw.interaction)
      : undefined,
  };
}
