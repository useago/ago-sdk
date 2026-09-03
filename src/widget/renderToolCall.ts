/**
 * Small view builders for tool calls that are not the ticket form itself:
 * the info/warning status line an older form is replaced with, the purple
 * placeholder for a non-ticketing `form` call, and the "unknown type" notice.
 * Plus the one rule the hosted widget applies across a thread: only the most
 * recent `form` tool call renders as a form.
 */

import type { AgoMessage, ToolCallData } from "../client/types";
import { css, div } from "./styles";
import type { ToolCallFormLabels } from "./toolCallLabels";

/** The agent's built-in ticketing tool. */
export const TICKETING_TOOL_NAME = "ago_ticketing";

export function isTicketingCall(call: ToolCallData): boolean {
  return call.type === "form" && call.toolName === TICKETING_TOOL_NAME;
}

/** Id of the last `form` tool call across the thread, in message order. */
export function latestFormToolCallId(messages: AgoMessage[]): string | null {
  let latest: string | null = null;
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      if (call.type === "form") latest = call.id;
    }
  }
  return latest;
}

/** Whether any `form` tool call in the thread already produced a ticket. */
export function ticketCreatedInThread(messages: AgoMessage[]): boolean {
  return messages.some((m) =>
    (m.toolCalls ?? []).some((call) => {
      if (call.type !== "form") return false;
      const data = call.data as
        | { success?: unknown; ticket?: { ticket_id?: unknown } }
        | undefined;
      return data?.success === true && !!data.ticket?.ticket_id;
    }),
  );
}

/** The submitted ticket carried by a persisted `form` tool call, if any. */
export function submittedTicketOf(
  call: ToolCallData,
): { ticketId: string; ticketUrl?: string } | null {
  const data = call.data as
    | { success?: unknown; ticket?: { ticket_id?: unknown; ticket_url?: unknown } }
    | undefined;
  if (data?.success !== true || !data.ticket?.ticket_id) return null;
  return {
    ticketId: String(data.ticket.ticket_id),
    ticketUrl:
      typeof data.ticket.ticket_url === "string" && data.ticket.ticket_url
        ? data.ticket.ticket_url
        : undefined,
  };
}

const STATUS_PALETTE = {
  info: { border: "#bfdbfe", bg: "#eff6ff", text: "#1e40af" },
  warning: { border: "#fef08a", bg: "#fefce8", text: "#854d0e" },
  success: { border: "#bbf7d0", bg: "#f0fdf4", text: "#166534" },
  error: { border: "#fecaca", bg: "#fef2f2", text: "#991b1b" },
} as const;

/** `StatusMessage`: a colored line with an icon slot and pre-wrapped text. */
export function renderStatusMessage(
  message: string,
  variant: keyof typeof STATUS_PALETTE = "info",
  toolDisplayName?: string,
): HTMLElement {
  const palette = STATUS_PALETTE[variant];
  const box = div({
    margin: "8px 0",
    padding: "12px 16px",
    border: `1px solid ${palette.border}`,
    backgroundColor: palette.bg,
    color: palette.text,
    borderRadius: "8px",
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    fontSize: "14px",
    lineHeight: "20px",
  });
  box.className = `ago-toolcall-status ago-toolcall-status--${variant}`;
  box.setAttribute("role", "status");
  if (toolDisplayName) {
    const name = document.createElement("span");
    name.textContent = `${toolDisplayName}:`;
    css(name, { fontSize: "12px", fontWeight: "500", opacity: "0.7", flexShrink: "0" });
    box.appendChild(name);
  }
  const text = document.createElement("span");
  text.textContent = message;
  text.style.whiteSpace = "pre-wrap";
  box.appendChild(text);
  return box;
}

/** The placeholder the hosted widget shows for a `form` call it cannot render. */
export function renderGenericFormPlaceholder(
  call: ToolCallData,
  labels: ToolCallFormLabels,
): HTMLElement {
  const box = div({
    margin: "8px 0",
    padding: "12px 16px",
    border: "1px solid #e9d5ff",
    backgroundColor: "#faf5ff",
    color: "#6b21a8",
    borderRadius: "8px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    fontSize: "14px",
    lineHeight: "20px",
  });
  box.className = "ago-toolcall-form-placeholder";
  const row = div({ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" });
  if (call.toolName) {
    const name = document.createElement("span");
    name.textContent = `${call.toolName}:`;
    css(name, { fontSize: "12px", fontWeight: "500", opacity: "0.7" });
    row.appendChild(name);
  }
  if (call.message) {
    const msg = document.createElement("span");
    msg.textContent = call.message;
    row.appendChild(msg);
  }
  if (row.childElementCount > 0) box.appendChild(row);
  const note = div({ opacity: "0.8" });
  note.textContent = labels.genericFormComingSoon;
  if (call.formSchema) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(call.formSchema, null, 2);
    css(pre, {
      fontSize: "12px",
      lineHeight: "16px",
      marginTop: "8px",
      marginBottom: "0",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    });
    note.appendChild(pre);
  }
  box.appendChild(note);
  return box;
}

/** The red notice for a tool call type the widget does not know. */
export function renderUnknownToolCall(
  type: string,
  labels: ToolCallFormLabels,
): HTMLElement {
  const box = div({
    margin: "8px 0",
    padding: "12px",
    border: "1px solid #fecaca",
    backgroundColor: "#fef2f2",
    color: "#991b1b",
    borderRadius: "6px",
    fontSize: "14px",
    lineHeight: "20px",
  });
  box.className = "ago-toolcall-unknown";
  box.textContent = labels.unknownToolCall.replace("{type}", type);
  return box;
}
