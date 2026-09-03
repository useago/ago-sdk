/**
 * The bubble widget's header (`EmbedHeader` in the hosted widget): a 56px bar
 * with a back chevron on drill-in screens, the title, a new-chat button off the
 * home screen, and an always-present close "X".
 *
 * The background is applied through the `background` shorthand so a gradient
 * from `colors.header` works; the text color comes from `--ago-header-text-color`,
 * which the widget derives for contrast.
 */

import { addCommentIcon, chevronLeftIcon, closeIcon } from "./icons";
import {
  css,
  div,
  HEADER_BACKGROUND,
  HEADER_TEXT_COLOR,
  SHADOW_SM,
} from "./styles";
import type { WidgetLabels, WidgetScreen } from "./types";

export interface EmbedHeaderOptions {
  title: string;
  labels: WidgetLabels;
  onBack: () => void;
  onNewChat: () => void;
  onClose: () => void;
}

export interface EmbedHeaderHandle {
  el: HTMLElement;
  update: (state: { screen: WidgetScreen }) => void;
}

/** Ghost icon button: the glyph stays small, the hit area grows to 44px. */
function ghostButton(
  className: string,
  label: string,
  glyph: SVGElement,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("aria-label", label);
  btn.title = label;
  css(btn, {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "44px",
    height: "44px",
    margin: "-12px",
    padding: "0",
    border: "none",
    background: "transparent",
    color: "currentColor",
    opacity: "0.8",
    cursor: "pointer",
    transition: "opacity 0.15s",
    flexShrink: "0",
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.opacity = "1";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.opacity = "0.8";
  });
  btn.addEventListener("click", onClick);
  btn.appendChild(glyph);
  return btn;
}

export function buildEmbedHeader(opts: EmbedHeaderOptions): EmbedHeaderHandle {
  const header = document.createElement("header");
  header.className = "ago-chat-widget__header";
  css(header, {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "56px",
    padding: "0 16px",
    boxSizing: "border-box",
    background: HEADER_BACKGROUND,
    color: HEADER_TEXT_COLOR,
    borderBottom: "1px solid #e5e7eb",
    boxShadow: SHADOW_SM,
    flexShrink: "0",
  });

  const left = div({
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: "0",
  });
  const back = ghostButton(
    "ago-chat-widget__back",
    opts.labels.back,
    chevronLeftIcon({ size: 20 }),
    opts.onBack,
  );
  back.style.marginRight = "-8px";
  const titleEl = document.createElement("span");
  titleEl.className = "ago-chat-widget__title";
  css(titleEl, {
    fontSize: "14px",
    lineHeight: "20px",
    fontWeight: "500",
    color: "currentColor",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });
  left.append(back, titleEl);

  const right = div({
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexShrink: "0",
  });
  const newChat = ghostButton(
    "ago-chat-widget__new",
    opts.labels.newChat,
    addCommentIcon({ size: 20 }),
    opts.onNewChat,
  );
  // Always rendered: on mobile the launcher is hidden while open, so this is
  // the one guaranteed way out.
  const close = ghostButton(
    "ago-chat-widget__close",
    opts.labels.close,
    closeIcon({ size: 20 }),
    opts.onClose,
  );
  right.append(newChat, close);

  header.append(left, right);

  return {
    el: header,
    update: ({ screen }) => {
      back.style.display = screen === "chat" ? "flex" : "none";
      newChat.style.display = screen === "home" ? "none" : "flex";
      titleEl.textContent =
        screen === "history" ? opts.labels.history : opts.title;
    },
  };
}
