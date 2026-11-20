import type { ConversationMarker, HandoffState } from "../client/types";
import { MUTED_TEXT_COLOR } from "./styles";

/** Texts of the live human takeover (see `UiCatalog.handoff`). */
export interface HandoffLabels {
  waiting: string;
  talkingWith: string;
  talkingWithAnonymous: string;
  requested: string;
  requestedUnavailable: string;
  accepted: string;
  acceptedAnonymous: string;
  transferred: string;
  transferredAnonymous: string;
  ended: string;
  /** Name shown on a staff reply when the agent's name is unknown. */
  staffFallback: string;
}

function named(template: string, anonymous: string, name: string | null): string {
  return name ? template.replace("{name}", () => name) : anonymous;
}

/** The centered line a conversation marker renders as. */
export function markerText(marker: ConversationMarker, labels: HandoffLabels): string {
  switch (marker.event) {
    case "handoff_requested":
      return marker.available ? labels.requested : labels.requestedUnavailable;
    case "handoff_accepted":
      return named(labels.accepted, labels.acceptedAnonymous, marker.agentName);
    case "handoff_transferred":
      return named(labels.transferred, labels.transferredAnonymous, marker.agentName);
    case "handoff_ended":
      return labels.ended;
  }
}

/** The status line under the conversation while handed off, or `null`. */
export function handoffStatusText(
  handoff: HandoffState | null,
  labels: HandoffLabels,
): string | null {
  if (handoff?.state === "waiting") return labels.waiting;
  if (handoff?.state === "human") {
    return named(labels.talkingWith, labels.talkingWithAnonymous, handoff.agentName);
  }
  return null;
}

function centeredLine(text: string, className: string): HTMLElement {
  const line = document.createElement("div");
  line.className = className;
  line.textContent = text;
  Object.assign(line.style, {
    textAlign: "center",
    color: MUTED_TEXT_COLOR,
    fontSize: "12px",
    lineHeight: "18px",
    margin: "8px 16px 16px",
    overflowWrap: "anywhere",
  });
  return line;
}

export function renderMarkerLine(text: string): HTMLElement {
  const line = centeredLine(text, "ago-message ago-message--system ago-handoff-marker");
  line.setAttribute("role", "note");
  return line;
}

export function renderHandoffStatus(text: string): HTMLElement {
  const line = centeredLine(text, "ago-handoff-status");
  line.setAttribute("role", "status");
  return line;
}
