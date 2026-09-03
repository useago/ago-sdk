/**
 * The bubble widget's message renderer, a value-for-value port of the hosted
 * widget's `UserMessage` / `BotMessage` in embed mode:
 *
 * - user: a right-aligned white card (70% max width, 16px radius, 16px padding),
 *   raw text with preserved line breaks, attachments above the text;
 * - assistant: a padded row with a spinner header while streaming, the sources
 *   grid, tool calls, markdown (or a pulse skeleton before the first token),
 *   a destructive alert on error, the follow-up chips, and thumbs up/down.
 *
 * Pure view builder: state that must survive a re-render (feedback, forms) is
 * handed in as ready-made nodes by the widget, like `renderMessage`.
 */

import type { AgoMessage, ToolCallData } from "../client/types";
import {
  canInlineImage,
  formatFileSize,
  safeAttachmentUrl,
} from "../utils/attachments";
import { alertCircleIcon, downloadIcon, spokeSpinnerIcon } from "./icons";
import { renderMarkdown } from "./renderMarkdown";
import { buildFollowUps } from "./renderMessage";
import {
  AGENT_BUBBLE_BACKGROUND,
  AGENT_BUBBLE_TEXT,
  css,
  div,
  NEUTRAL_BORDER,
  PRIMARY_ACCENT,
  PRIMARY_FOREGROUND,
  SHADOW_SM,
  TEXT_COLOR,
  USER_BUBBLE_BACKGROUND_EMBED,
  USER_BUBBLE_TEXT_EMBED,
} from "./styles";
import type { WidgetLabels } from "./types";

export interface RenderEmbedMessageOptions {
  /** Whether this is the last message in the thread (gates follow-up replies). */
  isLast: boolean;
  /** Whether suggested-reply pills are interactive. */
  followUpEnabled: boolean;
  followUpHandler?: (reply: string) => void;
  /** The host set `colors.agentMessage`: paint the bot row with it. */
  agentRowTinted: boolean;
  /** The host set `colors.agentMessageFont`. */
  agentRowTextTinted: boolean;
  labels: Pick<WidgetLabels, "errorTitle" | "errorDescription">;
  /** The thumbs row for a finished answer, built by the widget. */
  actionsRow?: HTMLElement | null;
  /** See {@link RenderMessageOptions.renderToolCall}. */
  renderToolCall?: (
    toolCall: ToolCallData,
    message: AgoMessage,
  ) => HTMLElement | null;
}

function buildEmbedAttachments(message: AgoMessage): HTMLElement {
  const wrap = div({
    marginBottom: "12px",
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  });
  wrap.className = "ago-message__attachments";
  for (const att of message.attachments ?? []) {
    const href = safeAttachmentUrl(att.url);
    const chip = div({
      display: "flex",
      alignItems: "center",
      gap: "8px",
      backgroundColor: "#f3f4f6",
      borderRadius: "8px",
      padding: "8px 12px",
      fontSize: "14px",
      lineHeight: "20px",
      maxWidth: "100%",
      boxSizing: "border-box",
    });
    if (canInlineImage(att) && href) {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      css(link, {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        textDecoration: "none",
        color: "inherit",
      });
      const img = document.createElement("img");
      img.src = href;
      img.alt = att.name;
      img.loading = "lazy";
      css(img, {
        height: "128px",
        maxWidth: "100%",
        objectFit: "contain",
        borderRadius: "4px",
        display: "block",
      });
      const name = div({
        fontSize: "12px",
        lineHeight: "16px",
        color: "#4b5563",
        maxWidth: "150px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });
      name.textContent = att.name;
      link.append(img, name);
      chip.appendChild(link);
    } else {
      const card = href
        ? document.createElement("a")
        : document.createElement("span");
      if (href && card instanceof HTMLAnchorElement) {
        card.href = href;
        card.target = "_blank";
        card.rel = "noopener noreferrer";
        card.download = att.name;
      }
      css(card, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        textDecoration: "none",
        color: "inherit",
        minWidth: "0",
      });
      const name = document.createElement("span");
      name.textContent = att.name;
      name.title = att.name;
      css(name, {
        maxWidth: "150px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });
      card.append(downloadIcon({ size: 20 }), name);
      const size = formatFileSize(att.fileSize);
      if (size) {
        const sizeEl = document.createElement("span");
        sizeEl.textContent = size;
        css(sizeEl, { fontSize: "12px", lineHeight: "16px", color: "#6b7280" });
        card.appendChild(sizeEl);
      }
      chip.appendChild(card);
    }
    wrap.appendChild(chip);
  }
  return wrap;
}

function buildUserMessage(message: AgoMessage): HTMLElement {
  const wrap = div({ display: "flex", justifyContent: "flex-end" });
  const card = div({
    maxWidth: "70%",
    borderRadius: "16px",
    marginBottom: "16px",
    padding: "16px",
    backgroundColor: USER_BUBBLE_BACKGROUND_EMBED,
    color: USER_BUBBLE_TEXT_EMBED,
    boxSizing: "border-box",
    fontSize: "14px",
    lineHeight: "24px",
  });
  card.className = "ago-message__content";
  if (message.attachments?.length) {
    card.appendChild(buildEmbedAttachments(message));
  }
  // The reference shows the user's text raw (`whitespace-pre-wrap`), not as
  // markdown: what they typed is what they see.
  const text = div({
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  text.textContent = message.content;
  card.appendChild(text);
  wrap.appendChild(card);
  return wrap;
}

function buildSources(message: AgoMessage): HTMLElement {
  const grid = div({
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
    paddingBottom: "16px",
  });
  grid.className = "ago-message__sources";
  (message.sources ?? []).forEach((source, i) => {
    const card = source.url
      ? document.createElement("a")
      : document.createElement("div");
    if (source.url && card instanceof HTMLAnchorElement) {
      card.href = source.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
    }
    css(card, {
      display: "inline-flex",
      alignItems: "center",
      height: "48px",
      justifyContent: "flex-start",
      padding: "8px 16px",
      border: `1px solid ${NEUTRAL_BORDER}`,
      backgroundColor: "#fff",
      borderRadius: "6px",
      boxShadow: SHADOW_SM,
      fontSize: "14px",
      fontWeight: "500",
      color: TEXT_COLOR,
      textDecoration: "none",
      overflow: "hidden",
      boxSizing: "border-box",
      transition: "background-color 0.15s",
    });
    card.addEventListener("mouseenter", () => {
      card.style.backgroundColor = "#f5f5f5";
    });
    card.addEventListener("mouseleave", () => {
      card.style.backgroundColor = "#fff";
    });
    const inner = div({
      display: "flex",
      alignItems: "center",
      gap: "8px",
      width: "100%",
      minWidth: "0",
    });
    const badge = div({
      flexShrink: "0",
      width: "16px",
      height: "16px",
      borderRadius: "4px",
      border: `1px solid ${PRIMARY_ACCENT}`,
      color: PRIMARY_ACCENT,
      backgroundColor: PRIMARY_FOREGROUND,
      fontSize: "12px",
      lineHeight: "1",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    });
    badge.textContent = String(i + 1);
    const label = div({
      fontSize: "12px",
      lineHeight: "16px",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      minWidth: "0",
    });
    label.textContent = source.title;
    label.title = source.title;
    inner.append(badge, label);
    card.appendChild(inner);
    grid.appendChild(card);
  });
  return grid;
}

/** The destructive alert (`Alert variant="destructive"`): icon, title, body. */
export function buildEmbedAlert(
  title: string,
  description: string,
): HTMLElement {
  return buildErrorAlert({ errorTitle: title, errorDescription: description });
}

function buildErrorAlert(
  labels: Pick<WidgetLabels, "errorTitle" | "errorDescription">,
): HTMLElement {
  const alert = div({
    position: "relative",
    width: "100%",
    borderRadius: "12px",
    border: "1px solid rgba(239, 68, 68, 0.5)",
    padding: "12px 16px 12px 44px",
    fontSize: "14px",
    lineHeight: "20px",
    color: "#ef4444",
    backgroundColor: "#fff",
    boxSizing: "border-box",
  });
  alert.className = "ago-message__error";
  alert.setAttribute("role", "alert");
  const icon = alertCircleIcon({ size: 16 });
  css(icon, { position: "absolute", left: "16px", top: "16px" });
  const title = document.createElement("h5");
  title.textContent = labels.errorTitle;
  css(title, {
    margin: "0 0 4px",
    fontSize: "14px",
    fontWeight: "500",
    lineHeight: "1",
    letterSpacing: "-0.025em",
  });
  const desc = div({ fontSize: "14px", lineHeight: "1.625" });
  desc.textContent = labels.errorDescription;
  alert.append(icon, title, desc);
  return alert;
}

/** The pulse placeholder shown before the first token lands. */
export function buildSkeleton(): HTMLElement {
  const wrap = div({
    marginTop: "4px",
    animation: "ago-skeleton-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
  });
  wrap.className = "ago-message__skeleton";
  const bar = div({
    height: "16px",
    backgroundColor: "#f1f5f9",
    borderRadius: "4px",
    width: "75%",
    marginBottom: "10px",
  });
  wrap.appendChild(bar);
  return wrap;
}

/** The 20px spinning spokes shown in the bot row header while streaming. */
export function buildSpinner(): HTMLElement {
  const wrap = div({
    display: "flex",
    alignItems: "center",
    padding: "8px",
    gap: "8px",
  });
  wrap.className = "ago-message__spinner";
  const spinner = spokeSpinnerIcon({ size: 20 });
  css(spinner, {
    color: "#a1a1aa",
    animation: "ago-spin 1s linear infinite",
  });
  wrap.appendChild(spinner);
  return wrap;
}

function buildBotMessage(
  message: AgoMessage,
  opts: RenderEmbedMessageOptions,
): HTMLElement {
  const streaming =
    message.status === "IN_PROGRESS" || message.status === "WAITING_CLIENT";
  const row = div({
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    borderRadius: "16px",
    padding: "8px",
    marginBottom: "16px",
    boxSizing: "border-box",
  });
  row.className = "ago-message__row";
  if (opts.agentRowTinted) row.style.backgroundColor = AGENT_BUBBLE_BACKGROUND;
  if (opts.agentRowTextTinted) row.style.color = AGENT_BUBBLE_TEXT;

  const body = div({
    flex: "1",
    minWidth: "0",
    overflow: "hidden",
    padding: "0 4px",
    fontSize: "14px",
    lineHeight: "24px",
  });
  body.className = "ago-message__body";

  // Embed mode shows only the spinner in the header while the answer streams.
  if (streaming) body.appendChild(buildSpinner());

  if (message.sources?.length) body.appendChild(buildSources(message));

  if (opts.renderToolCall && message.toolCalls?.length) {
    for (const call of message.toolCalls) {
      const node = opts.renderToolCall(call, message);
      if (node) body.appendChild(node);
    }
  }

  if (message.status === "ERROR") {
    body.appendChild(buildErrorAlert(opts.labels));
  } else if (message.content) {
    const md = div({});
    md.className = "ago-message__markdown ago-message__content";
    md.appendChild(renderMarkdown(message.content));
    body.appendChild(md);
  } else if (streaming) {
    body.appendChild(buildSkeleton());
  }

  if (
    opts.isLast &&
    message.status === "DONE" &&
    message.followUpReplies?.length
  ) {
    body.appendChild(
      buildFollowUps(message.followUpReplies, {
        enabled: opts.followUpEnabled,
        handler: opts.followUpHandler,
        look: "embed",
      }),
    );
  }

  if (opts.actionsRow && !streaming) body.appendChild(opts.actionsRow);

  row.appendChild(body);
  return row;
}

export function renderEmbedMessage(
  message: AgoMessage,
  opts: RenderEmbedMessageOptions,
): HTMLElement {
  const wrap = div({});
  wrap.className = `ago-message ago-message--${message.role}`;
  wrap.dataset.messageId = message.id;
  wrap.dataset.messageRole = message.role;
  wrap.appendChild(
    message.role === "user"
      ? buildUserMessage(message)
      : buildBotMessage(message, opts),
  );
  return wrap;
}
