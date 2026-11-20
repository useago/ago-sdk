import type {
  AgoMessage,
  ConversationMarker,
  HandoffState,
  MessageRole,
  RawHandoff,
} from "../client/types";

/** The backend's role values ("Staff", "System"...) mapped onto {@link MessageRole}. */
export function normalizeRole(role: unknown): MessageRole {
  const value = typeof role === "string" ? role.toLowerCase() : "";
  if (value === "user" || value === "staff" || value === "system") return value;
  return "assistant";
}

/** `null` while the AI answers (no handoff, or a state the SDK does not know). */
export function parseHandoff(raw: RawHandoff | null | undefined): HandoffState | null {
  if (!raw || (raw.state !== "waiting" && raw.state !== "human")) return null;
  const requestedAt = raw.requested_at ? new Date(raw.requested_at) : null;
  return {
    state: raw.state,
    agentName: raw.agent_name || null,
    requestedAt: requestedAt && !Number.isNaN(requestedAt.getTime()) ? requestedAt : null,
  };
}

export function sameHandoff(a: HandoffState | null, b: HandoffState | null): boolean {
  if (!a || !b) return a === b;
  return a.state === b.state && a.agentName === b.agentName;
}

export function isHandedOff(handoff: HandoffState | null | undefined): boolean {
  return handoff?.state === "waiting" || handoff?.state === "human";
}

/**
 * Parse the JSON content of a `system` message into a marker. Returns `null`
 * for anything else (other system events, malformed JSON), which a UI must
 * not render.
 */
export function parseConversationMarker(content: unknown): ConversationMarker | null {
  if (typeof content !== "string" || !content.trim().startsWith("{")) return null;
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const raw = data as { event?: unknown; available?: unknown; agent_name?: unknown };
  const agentName =
    typeof raw.agent_name === "string" && raw.agent_name ? raw.agent_name : null;
  switch (raw.event) {
    case "handoff_requested":
      return { event: "handoff_requested", available: raw.available !== false };
    case "handoff_accepted":
      return { event: "handoff_accepted", agentName };
    case "handoff_transferred":
      return { event: "handoff_transferred", agentName };
    case "handoff_ended":
      return { event: "handoff_ended" };
    default:
      return null;
  }
}

/**
 * Attach each `staff` message's author name, read from the markers before it:
 * an accept or transfer names the agent who answers from then on. Messages
 * after the last marker fall back to the current handoff's agent.
 */
export function annotateStaffNames(
  messages: AgoMessage[],
  handoff: HandoffState | null,
): void {
  let current: string | null = null;
  for (const message of messages) {
    const marker = message.marker;
    if (marker && (marker.event === "handoff_accepted" || marker.event === "handoff_transferred")) {
      current = marker.agentName;
    } else if (marker?.event === "handoff_ended") {
      current = null;
    }
    if (message.role === "staff") {
      const name = current ?? handoff?.agentName ?? null;
      if (name) message.staffName = name;
    }
  }
}
