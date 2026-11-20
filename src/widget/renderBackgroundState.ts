import type { AgoMessage } from "../client/types";
import type { UiCatalog } from "../i18n/types";
import {
  ACCENT_COLOR,
  AGENT_BUBBLE_BACKGROUND,
  BORDER_COLOR,
  MUTED_TEXT_COLOR,
  PANEL_BACKGROUND,
  TEXT_COLOR,
  css,
  div,
} from "./styles";

/** Build the message progress and approval controls, or return null when absent. */
export function renderBackgroundState(
  message: AgoMessage,
  labels: UiCatalog["backgroundState"],
  pending: boolean,
  failed: boolean,
  decide: (id: string, decision: "approve" | "reject") => void,
): HTMLElement | null {
  if (
    !message.progress &&
    !message.approval &&
    !message.outcome &&
    message.status !== "PAUSED" &&
    message.status !== "WAITING_APPROVAL"
  )
    return null;
  const root = div({
    maxWidth: "100%", minWidth: "0", overflowWrap: "anywhere", color: TEXT_COLOR,
    fontSize: "13px", marginBottom: "10px", border: `1px solid ${BORDER_COLOR}`,
    borderRadius: "var(--ago-radius, 16px)", backgroundColor: PANEL_BACKGROUND, padding: "12px",
  });
  root.className = "ago-background-state";
  root.dataset.messageId = message.id;
  const header = div({ fontWeight: "600", display: "flex", gap: "8px", alignItems: "center" });
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.style.color = ACCENT_COLOR;
  icon.textContent = message.outcome === "completed" ? "✓" : message.outcome ? "!" : "◉";
  const title = document.createElement("span");
  title.textContent = message.outcome ? labels[message.outcome] :
    message.status === "WAITING_APPROVAL" ? labels.waiting :
    message.status === "PAUSED" ? labels.paused : labels.inProgress;
  header.append(icon, title);
  root.appendChild(header);
  const approval = message.approval;
  if (approval && (approval.actions.length > 0 || approval.allowedDecisions.length > 0)) {
    const card = document.createElement("details");
    card.open = approval.status === "pending";
    card.dataset.approvalId = approval.id;
    card.dataset.approvalStatus = approval.status;
    css(card, {
      border: `1px solid ${BORDER_COLOR}`,
      backgroundColor: PANEL_BACKGROUND,
      borderRadius: "10px",
      padding: "10px",
      minWidth: "0",
      marginTop: "8px",
    });
    card.className = "ago-background-state__approval";
    const title = document.createElement("summary");
    css(title, { fontWeight: "600", cursor: "pointer", minHeight: "44px", alignContent: "center" });
    title.textContent = `${labels.approval} · ${approval.status === "pending" ? labels.waiting : labels[approval.status]}`;
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
  const progress = message.progress;
  if (progress) {
    const section = document.createElement("section");
    section.setAttribute("aria-label", labels.progress);
    section.style.marginTop = "10px";
    const steps = progress.steps ?? [];
    if (steps.length) {
      const completed = steps.filter((step) => step.status === "completed").length;
      const bar = div({ height: "6px", borderRadius: "6px", backgroundColor: BORDER_COLOR, overflow: "hidden" });
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-label", labels.progress);
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", String(steps.length));
      bar.setAttribute("aria-valuenow", String(completed));
      bar.appendChild(div({ height: "100%", width: `${completed / steps.length * 100}%`, backgroundColor: ACCENT_COLOR }));
      const count = div({ marginTop: "5px", color: MUTED_TEXT_COLOR });
      count.textContent = labels.checklistCount.replace("{completed}", String(completed)).replace("{total}", String(steps.length));
      const heading = div({ fontWeight: "600", marginTop: "10px" });
      heading.textContent = labels.progress;
      const list = document.createElement("ol");
      css(list, { listStyle: "none", margin: "4px 0 0", padding: "0" });
      const markers = { pending: "○", in_progress: "◉", completed: "✓", failed: "!", not_completed: "−" };
      const statuses = { pending: labels.pending, in_progress: labels.inProgress, completed: labels.completed, failed: labels.failed, not_completed: labels.notCompleted };
      steps.forEach((step, index) => {
        const item = document.createElement("li");
        css(item, { display: "flex", gap: "8px", padding: "5px 0" });
        const marker = document.createElement("span");
        marker.setAttribute("aria-hidden", "true");
        css(marker, { width: "16px", flexShrink: "0", textAlign: "center", color: ACCENT_COLOR });
        marker.textContent = markers[step.status];
        const content = div({ minWidth: "0" });
        const name = div({ fontWeight: "500" });
        name.textContent = `${index + 1}. ${step.name} `;
        const status = document.createElement("span");
        css(status, { color: MUTED_TEXT_COLOR, fontWeight: "400" });
        status.textContent = `· ${statuses[step.status]}`;
        name.appendChild(status);
        content.appendChild(name);
        if (step.reason) {
          const reason = div({ color: MUTED_TEXT_COLOR, marginTop: "2px" });
          reason.textContent = step.reason;
          content.appendChild(reason);
        }
        item.append(marker, content);
        list.appendChild(item);
      });
      section.append(bar, count, heading, list);
    }
    if (progress.activity.length) {
      const activity = div({ marginTop: "10px" });
      const heading = div({ fontWeight: "600", marginBottom: "5px" });
      heading.textContent = labels.activity;
      const log = div({ maxHeight: "128px", overflowY: "auto", padding: "8px", borderRadius: "8px", backgroundColor: AGENT_BUBBLE_BACKGROUND, fontFamily: "monospace", fontSize: "12px" });
      log.className = "ago-background-state__activity-log";
      for (const entry of progress.activity) {
        const item = div({ paddingBlock: "2px", whiteSpace: "pre-wrap" });
        item.textContent = entry.text;
        log.appendChild(item);
      }
      activity.append(heading, log);
      section.appendChild(activity);
    }
    if (progress.truncated) {
      const truncated = div({ marginTop: "8px", color: MUTED_TEXT_COLOR });
      truncated.textContent = labels.truncated;
      section.appendChild(truncated);
    }
    root.appendChild(section);
  }
  return root;
}
