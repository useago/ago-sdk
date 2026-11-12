import type { AgoMessage } from "../client/types";
import type { UiCatalog } from "../i18n/types";
import {
  BORDER_COLOR,
  MUTED_TEXT_COLOR,
  PANEL_BACKGROUND,
  TEXT_COLOR,
  css,
  div,
} from "./styles";

export function renderResponseState(
  message: AgoMessage,
  labels: UiCatalog["responseState"],
  pending: boolean,
  failed: boolean,
  decide: (id: string, decision: "approve" | "reject") => void,
): HTMLElement | null {
  if (
    !message.progress &&
    !message.approval &&
    !message.outcome &&
    message.status !== "PAUSED"
  )
    return null;
  const root = div({
    maxWidth: "100%",
    minWidth: "0",
    overflowWrap: "anywhere",
    color: TEXT_COLOR,
    fontSize: "13px",
    marginBottom: "10px",
  });
  root.className = "ago-response-state";
  const line = (text: string): HTMLElement => {
    const el = div({ marginBottom: "4px", whiteSpace: "pre-wrap" });
    el.textContent = text;
    root.appendChild(el);
    return el;
  };
  if (message.progress) {
    line(labels.progress);
    for (const step of message.progress.steps ?? []) {
      const status = {
        pending: labels.pending,
        in_progress: labels.inProgress,
        completed: labels.completed,
        failed: labels.failed,
        not_completed: labels.notCompleted,
      }[step.status];
      line(`${step.name}: ${status}${step.reason ? ` — ${step.reason}` : ""}`);
    }
    if (message.progress.activity.length) line(labels.activity);
    for (const activity of message.progress.activity) line(activity.text);
    if (message.progress.truncated) line(labels.truncated);
  }
  const approval = message.approval;
  if (approval) {
    const card = div({
      border: `1px solid ${BORDER_COLOR}`,
      backgroundColor: PANEL_BACKGROUND,
      borderRadius: "10px",
      padding: "10px",
      minWidth: "0",
      marginTop: "8px",
    });
    card.className = "ago-response-state__approval";
    const title = div({ fontWeight: "600" });
    title.textContent =
      approval.status === "pending" ? labels.waiting : labels[approval.status];
    card.appendChild(title);
    for (const action of approval.actions) {
      const name = div({ fontWeight: "600", marginTop: "8px" });
      name.textContent = action.name;
      const args = document.createElement("pre");
      args.textContent = JSON.stringify(action.arguments, null, 2);
      css(args, {
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        maxWidth: "100%",
        margin: "4px 0",
        color: MUTED_TEXT_COLOR,
      });
      card.append(name, args);
    }
    const buttons = div({
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      marginTop: "8px",
    });
    for (const decision of approval.allowedDecisions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = pending ? labels.submitting : labels[decision];
      button.disabled = pending;
      css(button, {
        minHeight: "44px",
        padding: "6px 12px",
        border: `1px solid ${BORDER_COLOR}`,
        borderRadius: "8px",
        backgroundColor: PANEL_BACKGROUND,
        color: TEXT_COLOR,
        font: "inherit",
        cursor: pending ? "default" : "pointer",
      });
      button.addEventListener("click", () => decide(approval.id, decision));
      buttons.appendChild(button);
    }
    if (approval.allowedDecisions.length) card.appendChild(buttons);
    if (failed) {
      const error = div({ color: TEXT_COLOR, marginTop: "8px" });
      error.setAttribute("role", "alert");
      error.textContent = labels.decisionFailed;
      card.appendChild(error);
    }
    root.appendChild(card);
  }
  if (message.status === "PAUSED") line(labels.paused);
  if (message.outcome === "incomplete") line(labels.incomplete);
  if (message.outcome === "failed") line(labels.failed);
  return root;
}
