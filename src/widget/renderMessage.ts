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

import type { AgoMessage } from "../client/types";
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

  // Uploaded files, above the bubble. Only backend-verified safe images embed
  // inline as an <img>; everything else is a download link (no XSS surface).
  if (message.attachments && message.attachments.length > 0) {
    const attachments = div({
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
      marginBottom: "6px",
      justifyContent: isUser ? "flex-end" : "flex-start",
      maxWidth: "75%",
    });
    attachments.className = "ago-message__attachments";
    for (const att of message.attachments) {
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
        attachments.appendChild(link);
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
        backgroundColor: isUser ? "rgba(255,255,255,0.12)" : PANEL_BACKGROUND,
        color: isUser ? BRAND_TEXT_COLOR : TEXT_COLOR,
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
      attachments.appendChild(card);
    }
    wrap.appendChild(attachments);
  }

  const bubbled = isUser || agentBubble || imessage;

  // An attachment-only message (files, no text) shows no empty bubble.
  const hasBubble = !!message.content || message.status === "IN_PROGRESS";

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
  } else if (message.status === "IN_PROGRESS") {
    bubble.appendChild(buildStreamingDots());
  }
  if (hasBubble) wrap.appendChild(bubble);

  // Only on the last message, so stale suggestions disappear once the user
  // sends their next message.
  if (isLast && message.followUpReplies && message.followUpReplies.length > 0) {
    const followups = div({
      display: "flex",
      flexWrap: "wrap",
      gap: "8px",
      marginTop: "10px",
    });
    followups.className = "ago-message__followups";
    for (const reply of message.followUpReplies) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ago-message__followup-btn";
      btn.textContent = reply;
      btn.disabled = !followUpEnabled;
      css(btn, {
        minHeight: "36px",
        padding: "6px 14px",
        fontSize: "14px",
        borderRadius: MESSAGE_RADIUS,
        border: `1px solid ${BORDER_COLOR}`,
        backgroundColor: PANEL_BACKGROUND,
        color: TEXT_COLOR,
        cursor: followUpEnabled ? "pointer" : "default",
        transition: "border-color 0.15s",
      });
      if (followUpHandler) {
        btn.addEventListener("click", () => followUpHandler(reply));
      }
      btn.addEventListener("mouseenter", () => {
        btn.style.borderColor = ACCENT_COLOR;
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.borderColor = BORDER_COLOR;
      });
      followups.appendChild(btn);
    }
    wrap.appendChild(followups);
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
      backgroundColor: "#b5bfc8",
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
