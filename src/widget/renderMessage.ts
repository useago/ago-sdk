/**
 * Pure view builders for the framework-agnostic chat widget: a single message
 * (bubble, sources, attachments, suggested replies), the form-submitted notice,
 * the streaming dots, and the launcher glyph.
 *
 * These take their data and presentation options as arguments and never touch the
 * widget's mutable state, so they live outside the `mountChatWidget` closure.
 * Message content is rendered as GitHub-flavored markdown by {@link renderMarkdown},
 * which HTML-escapes all message text first.
 */

import type { AgoAttachment, AgoMessage, ToolCallData } from "../client/types";
import {
  canInlineImage,
  formatFileSize,
  safeAttachmentUrl,
} from "../utils/attachments";
import { renderMarkdown } from "./renderMarkdown";
import {
  ACCENT_COLOR,
  AGENT_BUBBLE_BACKGROUND,
  BORDER_COLOR,
  BRAND_COLOR,
  BRAND_TEXT_COLOR,
  css,
  div,
  MESSAGE_RADIUS,
  MESSAGE_RADIUS_IMESSAGE,
  MESSAGES_BACKGROUND,
  MUTED_TEXT_COLOR,
  PANEL_BACKGROUND,
  TEXT_COLOR,
} from "./styles";

/** Presentation options for {@link renderMessage} (what it used to close over). */
export interface RenderMessageOptions {
  /** Whether this is the last message in the thread (gates follow-up replies). */
  isLast: boolean;
  /** Last bubble of a same-sender block (gets the iMessage tail). */
  isLastOfBlock: boolean;
  /** Bubble shape preset. */
  bubbleStyle: "default" | "imessage";
  /** Show the agent name above assistant messages. */
  showAgentName: boolean;
  /** Render assistant messages inside a filled bubble. */
  agentBubble: boolean;
  /** Whether suggested-reply pills are interactive. */
  followUpEnabled: boolean;
  /** Click handler for a suggested reply (omitted when non-interactive). */
  followUpHandler?: (reply: string) => void;
  /** Small viewport: widen bubbles to reclaim horizontal space. */
  isMobile?: boolean;
  /**
   * The feedback row to show under this answer (thumbs, then the "what went
   * wrong?" panel), already built by the caller. It is passed in rather than
   * built here because it is bound to state the widget owns, and building it
   * from inside this module would make rendering a message mutate that state.
   */
  feedbackRow?: HTMLElement | null;
  /**
   * Render one tool call attached to the message (a ticket form, a status
   * line). Called once per entry of `message.toolCalls`, in order; a null
   * result skips that call. Like `feedbackRow`, the caller owns any state the
   * node needs across re-renders.
   */
  renderToolCall?: (
    toolCall: ToolCallData,
    message: AgoMessage,
  ) => HTMLElement | null;
}

/**
 * Uploaded files, shown above the bubble. Only backend-verified safe images
 * embed inline as an `<img>`; everything else is a download link (no XSS
 * surface). Shared by both message renderers.
 */
export function buildAttachments(
  attachments: AgoAttachment[],
  opts: {
    isUser: boolean;
    /** Text color inside a download card. */
    cardColor: string;
    /** Background of a download card. */
    cardBackground: string;
  },
): HTMLElement {
  const wrap = div({
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginBottom: "6px",
    justifyContent: opts.isUser ? "flex-end" : "flex-start",
    maxWidth: "75%",
  });
  wrap.className = "ago-message__attachments";
  for (const att of attachments) {
    const href = safeAttachmentUrl(att.url);
    if (canInlineImage(att) && href) {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      css(link, { display: "inline-block", textDecoration: "none" });
      const img = document.createElement("img");
      img.src = href;
      img.alt = att.name;
      img.loading = "lazy";
      css(img, {
        maxWidth: "180px",
        maxHeight: "160px",
        objectFit: "cover",
        borderRadius: "10px",
        border: `1px solid ${BORDER_COLOR}`,
        display: "block",
      });
      link.appendChild(img);
      wrap.appendChild(link);
      continue;
    }

    const card = href
      ? document.createElement("a")
      : document.createElement("div");
    if (href && card instanceof HTMLAnchorElement) {
      card.href = href;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
    }
    css(card, {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 12px",
      borderRadius: "10px",
      border: `1px solid ${BORDER_COLOR}`,
      backgroundColor: opts.cardBackground,
      color: opts.cardColor,
      fontSize: "13px",
      textDecoration: "none",
      maxWidth: "220px",
    });
    const icon = document.createElement("span");
    icon.textContent = "📄";
    icon.setAttribute("aria-hidden", "true");
    css(icon, { fontSize: "16px", lineHeight: "1", flexShrink: "0" });
    const meta = div({
      display: "flex",
      flexDirection: "column",
      minWidth: "0",
    });
    const name = div({
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      maxWidth: "160px",
    });
    name.textContent = att.name;
    name.title = att.name;
    meta.appendChild(name);
    const size = formatFileSize(att.fileSize);
    if (size) {
      const sizeEl = div({ fontSize: "11px", color: MUTED_TEXT_COLOR });
      sizeEl.textContent = size;
      meta.appendChild(sizeEl);
    }
    card.append(icon, meta);
    wrap.appendChild(card);
  }
  return wrap;
}

/** Style preset for the suggested-reply pills of {@link buildFollowUps}. */
export type FollowUpLook = "classic" | "embed";

/**
 * The row of suggested-reply pills under the last answer. `classic` is the
 * inline/side look (44px pills, brand hover outline); `embed` reproduces the
 * hosted widget's chips (white, neutral border, light hover).
 */
export function buildFollowUps(
  replies: string[],
  opts: {
    enabled: boolean;
    handler?: (reply: string) => void;
    look?: FollowUpLook;
  },
): HTMLElement {
  const embed = opts.look === "embed";
  const followups = div({
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: embed ? "16px" : "10px",
  });
  followups.className = "ago-message__followups";
  for (const reply of replies) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ago-message__followup-btn";
    btn.textContent = reply;
    btn.disabled = !opts.enabled;
    css(
      btn,
      embed
        ? {
            display: "inline-flex",
            alignItems: "center",
            padding: "8px",
            fontSize: "14px",
            lineHeight: "20px",
            font: "inherit",
            color: "#525252",
            backgroundColor: "#fff",
            border: "1px solid #e5e5e5",
            borderRadius: "12px",
            boxShadow: "0 1px 2px 0 rgba(0,0,0,0.05)",
            cursor: opts.enabled ? "pointer" : "default",
            transition: "background-color 0.15s",
          }
        : {
            // Suggested replies are the primary tap target of the whole suggestion
            // pattern; 36px left them under the 44px comfortable minimum.
            minHeight: "44px",
            padding: "6px 14px",
            fontSize: "14px",
            borderRadius: MESSAGE_RADIUS,
            border: `1px solid ${BORDER_COLOR}`,
            backgroundColor: PANEL_BACKGROUND,
            color: TEXT_COLOR,
            cursor: opts.enabled ? "pointer" : "default",
            transition: "border-color 0.15s",
          },
    );
    if (opts.handler) {
      const handler = opts.handler;
      btn.addEventListener("click", () => handler(reply));
    }
    btn.addEventListener("mouseenter", () => {
      if (embed) btn.style.backgroundColor = "#fafafa";
      else btn.style.borderColor = ACCENT_COLOR;
    });
    btn.addEventListener("mouseleave", () => {
      if (embed) btn.style.backgroundColor = "#fff";
      else btn.style.borderColor = BORDER_COLOR;
    });
    followups.appendChild(btn);
  }
  return followups;
}

export function renderMessage(
  message: AgoMessage,
  opts: RenderMessageOptions,
): HTMLElement {
  const {
    isLast,
    isLastOfBlock,
    bubbleStyle,
    showAgentName,
    agentBubble,
    followUpEnabled,
    followUpHandler,
    isMobile,
    feedbackRow,
  } = opts;
  const isUser = message.role === "user";
  const imessage = bubbleStyle === "imessage";
  const wrap = div({
    display: "flex",
    flexDirection: "column",
    alignItems: isUser ? "flex-end" : "flex-start",
    // Tighter stack within a same-sender block, full gap after it (iMessage).
    marginBottom: imessage && !isLastOfBlock ? "2px" : "16px",
  });
  wrap.className = `ago-message ago-message--${message.role}`;

  if (!isUser && showAgentName && message.agent) {
    const name = div({
      fontSize: "13px",
      fontWeight: "500",
      color: TEXT_COLOR,
      marginBottom: "6px",
      padding: "0 4px",
    });
    name.className = "ago-message__agent";
    name.textContent = message.agent.displayName || message.agent.name;
    wrap.appendChild(name);
  }

  if (!isUser && message.sources && message.sources.length > 0) {
    const sources = div({
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "6px",
      marginBottom: "10px",
      width: "100%",
      maxWidth: "85%",
    });
    sources.className = "ago-message__sources";
    message.sources.forEach((source, i) => {
      const card = source.url
        ? document.createElement("a")
        : document.createElement("div");
      if (source.url && card instanceof HTMLAnchorElement) {
        card.href = source.url;
        card.target = "_blank";
        card.rel = "noopener noreferrer";
      }
      css(card, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 10px",
        border: `1px solid ${BORDER_COLOR}`,
        borderRadius: "8px",
        backgroundColor: PANEL_BACKGROUND,
        textDecoration: "none",
        color: TEXT_COLOR,
        fontSize: "12px",
        overflow: "hidden",
      });
      const badge = div({
        flexShrink: "0",
        width: "18px",
        height: "18px",
        borderRadius: "3px",
        border: `1px solid ${ACCENT_COLOR}`,
        color: ACCENT_COLOR,
        fontSize: "11px",
        fontWeight: "500",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f0f4ff",
      });
      badge.textContent = String(i + 1);
      const label = div({
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });
      label.textContent = source.title;
      label.title = source.title;
      card.append(badge, label);
      sources.appendChild(card);
    });
    wrap.appendChild(sources);
  }

  if (message.attachments && message.attachments.length > 0) {
    wrap.appendChild(
      buildAttachments(message.attachments, {
        isUser,
        cardBackground: isUser ? "rgba(255,255,255,0.12)" : PANEL_BACKGROUND,
        cardColor: isUser ? BRAND_TEXT_COLOR : TEXT_COLOR,
      }),
    );
  }

  // Tool calls (a ticket form, a status line) sit between the sources and the
  // answer text, where the hosted widget puts them.
  if (!isUser && opts.renderToolCall && message.toolCalls?.length) {
    for (const call of message.toolCalls) {
      const node = opts.renderToolCall(call, message);
      if (node) wrap.appendChild(node);
    }
  }

  const bubbled = isUser || agentBubble || imessage;

  // An attachment-only message (files, no text) shows no empty bubble.
  const hasBubble =
    !!message.content ||
    message.status === "IN_PROGRESS" ||
    message.status === "WAITING_CLIENT";

  // Bubbles run wider on small viewports so long messages don't waste the screen
  // edge on a narrow device. Non-bubbled assistant text is already full width.
  const bubbleMaxWidth = bubbled
    ? imessage || isUser
      ? isMobile
        ? "88%"
        : "75%"
      : isMobile
        ? "92%"
        : "85%"
    : "100%";

  const bubble = div({
    maxWidth: bubbleMaxWidth,
    padding: bubbled ? "10px 14px" : "2px 8px",
    borderRadius: imessage
      ? MESSAGE_RADIUS_IMESSAGE
      : bubbled
        ? MESSAGE_RADIUS
        : "0",
    backgroundColor: isUser
      ? BRAND_COLOR
      : bubbled
        ? AGENT_BUBBLE_BACKGROUND
        : "transparent",
    color: isUser ? BRAND_TEXT_COLOR : TEXT_COLOR,
    // Break only words that would otherwise overflow (long URLs, hashes),
    // keeping normal words whole. Standard property; "anywhere" is avoided to
    // keep pre-15.4 Safari working.
    overflowWrap: "break-word",
    // Let the browser avoid last-line orphans (a lone "?" or short word).
    // Ignored by pre-2023 browsers, which simply wrap as before.
    textWrap: "pretty",
    fontSize: "16px",
    lineHeight: "1.6",
  });
  bubble.className = "ago-message__content";
  // iMessage tail on the last bubble of a same-sender block: a colored bulge
  // (fill) at the bottom corner, masked by a shape in the messages-area color
  // to carve out the curl (technique from CodePen swards/gxQmbj).
  if (imessage && isLastOfBlock) {
    bubble.style.position = "relative";
    const fill = div({
      position: "absolute",
      zIndex: "0",
      bottom: "-2px",
      width: "20px",
      height: "20px",
      background: isUser ? BRAND_COLOR : AGENT_BUBBLE_BACKGROUND,
    });
    fill.className = "ago-message__tail";
    const mask = div({
      position: "absolute",
      zIndex: "1",
      bottom: "-2px",
      width: "10px",
      height: "20px",
      background: MESSAGES_BACKGROUND,
    });
    mask.className = "ago-message__tail-mask";
    if (isUser) {
      fill.style.right = "-8px";
      fill.style.borderBottomLeftRadius = "16px 14px";
      mask.style.right = "-10px";
      mask.style.borderBottomLeftRadius = "10px";
    } else {
      fill.style.left = "-7px";
      fill.style.borderBottomRightRadius = "16px 14px";
      mask.style.left = "-10px";
      mask.style.borderBottomRightRadius = "10px";
    }
    bubble.append(fill, mask);
  }
  if (message.content) {
    // GitHub-flavored markdown, rendered by a dependency-free parser that
    // escapes all message text before it reaches the DOM (see renderMarkdown).
    bubble.appendChild(renderMarkdown(message.content));
  } else if (message.status === "IN_PROGRESS" || message.status === "WAITING_CLIENT") {
    bubble.appendChild(buildStreamingDots());
  }
  if (hasBubble) wrap.appendChild(bubble);

  // Thumbs sit right under the answer they judge, above any suggested replies.
  if (!isUser && feedbackRow) wrap.appendChild(feedbackRow);

  // Only on the last message, so stale suggestions disappear once the user
  // sends their next message.
  if (isLast && message.followUpReplies && message.followUpReplies.length > 0) {
    wrap.appendChild(
      buildFollowUps(message.followUpReplies, {
        enabled: followUpEnabled,
        handler: followUpHandler,
        look: "classic",
      }),
    );
  }

  return wrap;
}

// A success notice confirming a form was sent — mirrors the error block's shape
// (a styled block appended to the message area) but in green.
export function renderFormNotice(text: string): HTMLElement {
  const el = div({
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 14px",
    backgroundColor: "#f0fdf4",
    color: "#15803d",
    borderRadius: MESSAGE_RADIUS,
    marginTop: "8px",
    fontSize: "13px",
    border: "1px solid #bbf7d0",
  });
  el.className = "ago-form-notice";
  el.setAttribute("role", "status");
  const check = document.createElement("span");
  check.textContent = "✓";
  check.setAttribute("aria-hidden", "true");
  css(check, { fontWeight: "700" });
  const label = document.createElement("span");
  label.textContent = text;
  el.append(check, label);
  return el;
}

/** The three pulsing dots shown in an assistant bubble while a reply streams. */
export function buildStreamingDots(): HTMLElement {
  const wrap = div({ display: "flex", gap: "4px", padding: "4px 0" });
  for (let i = 0; i < 3; i++) {
    const dot = div({
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      // currentColor, not a fixed grey: the dots have to stay legible on a
      // light panel and on a dark sheet alike.
      backgroundColor: "currentColor",
      opacity: "0.55",
      animation: "ago-pulse 1.2s ease-in-out infinite",
      animationDelay: `${i * 0.2}s`,
    });
    wrap.appendChild(dot);
  }
  return wrap;
}

/** A dependency-free chat-bubble glyph for the launcher button. */
export function buildChatIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "26");
  svg.setAttribute("height", "26");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  const path = document.createElementNS(ns, "path");
  path.setAttribute(
    "d",
    "M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8 8.38 8.38 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5z",
  );
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}
