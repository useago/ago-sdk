/**
 * The bubble widget's chat history screen (`EmbedChatHistory`): a spinner
 * while the list loads, an empty state, or the thread rows (title, relative
 * time, chevron) sorted newest first, with the floating "New conversation"
 * pill pinned over a gradient strip at the bottom.
 */

import type { Conversation } from "../../client/types";
import { addCommentIcon, chevronRightIcon, conversationsIcon } from "../icons";
import {
  BRAND_COLOR,
  css,
  div,
  EMBED_BACKGROUND,
  EMBED_BORDER,
  EMBED_MUTED_TEXT,
} from "../styles";
import { formatTimeAgo } from "../timeAgo";
import { sortThreadsByDate } from "../threads";
import type { WidgetLabels } from "../types";

export interface HistoryScreenOptions {
  labels: WidgetLabels;
  onSelect: (thread: Conversation) => void;
  onNew: () => void;
  /**
   * Row hover background when the host set a hex `colors.background`
   * (`lightenColor(background, 10)`); none otherwise, like the reference.
   */
  hoverBackground?: string;
  /** `colors.font` is set: muted text becomes the inherited color at 70%. */
  customFont?: boolean;
}

export interface HistoryScreenHandle {
  el: HTMLDivElement;
  render: (state: { threads: Conversation[]; loading: boolean }) => void;
}

export function buildHistoryScreen(
  opts: HistoryScreenOptions,
): HistoryScreenHandle {
  const root = div({
    position: "relative",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    flex: "1",
    minHeight: "0",
  });
  root.className = "ago-chat-widget__history";

  const body = div({ display: "flex", flex: "1", minHeight: "0" });
  body.className = "ago-chat-widget__history-body";

  // The pill floats above the list; a 104px gradient strip hides the rows
  // behind it (32 pad + 56 pill + 16 pad), opaque up to the pill then fading.
  const strip = div({
    pointerEvents: "none",
    position: "absolute",
    left: "0",
    right: "0",
    bottom: "0",
    zIndex: "10",
    padding: "32px 16px 16px",
    backgroundImage: `linear-gradient(to top, ${EMBED_BACKGROUND} 72px, transparent 104px)`,
  });
  strip.className = "ago-chat-widget__new-strip";
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "ago-chat-widget__new-conversation";
  css(pill, {
    pointerEvents: "auto",
    display: "flex",
    height: "56px",
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    borderRadius: "32px",
    backgroundColor: BRAND_COLOR,
    color: "#fff",
    padding: "0 24px",
    border: "none",
    cursor: "pointer",
    font: "inherit",
  });
  const pillLabel = document.createElement("span");
  pillLabel.textContent = opts.labels.newConversation;
  css(pillLabel, { fontSize: "14px", lineHeight: "20px", fontWeight: "500" });
  pill.append(addCommentIcon({ size: 16 }), pillLabel);
  pill.addEventListener("click", opts.onNew);
  strip.appendChild(pill);

  root.append(body, strip);

  const mutedStyle = (el: HTMLElement): void => {
    if (opts.customFont) el.style.opacity = "0.7";
    else el.style.color = EMBED_MUTED_TEXT;
  };

  function renderLoading(): void {
    const wrap = div({
      display: "flex",
      flex: "1",
      alignItems: "center",
      justifyContent: "center",
      paddingBottom: "112px",
    });
    wrap.className = "ago-chat-widget__history-loading";
    const spinner = div({
      width: "32px",
      height: "32px",
      borderRadius: "50%",
      borderBottom: `2px solid ${BRAND_COLOR}`,
      animation: "ago-spin 1s linear infinite",
    });
    spinner.setAttribute("role", "status");
    wrap.appendChild(spinner);
    body.replaceChildren(wrap);
  }

  function renderEmpty(): void {
    const wrap = div({
      display: "flex",
      flex: "1",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    });
    wrap.className = "ago-chat-widget__history-empty";
    mutedStyle(wrap);
    const icon = conversationsIcon({ size: 36 });
    icon.style.marginBottom = "8px";
    const p = document.createElement("p");
    p.textContent = opts.labels.noHistory;
    css(p, { fontSize: "14px", lineHeight: "20px", margin: "0" });
    wrap.append(icon, p);
    body.replaceChildren(wrap);
  }

  function renderList(threads: Conversation[]): void {
    const list = div({
      flex: "1",
      overflowY: "auto",
      padding: "0 16px 112px",
      minHeight: "0",
    });
    list.className = "ago-chat-widget__history-list";
    const sorted = sortThreadsByDate(threads);
    sorted.forEach((thread, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "ago-chat-widget__thread";
      row.dataset.agoConversationId = thread.id;
      css(row, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "17px 0",
        width: "100%",
        textAlign: "left",
        backgroundColor: "transparent",
        border: "none",
        borderBottom:
          i === sorted.length - 1 ? "none" : `1px solid ${EMBED_BORDER}`,
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
      });
      if (opts.hoverBackground) {
        const hover = opts.hoverBackground;
        row.addEventListener("mouseenter", () => {
          row.style.backgroundColor = hover;
        });
        row.addEventListener("mouseleave", () => {
          row.style.backgroundColor = "transparent";
        });
      }
      const text = div({
        flex: "1",
        minWidth: "0",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
      });
      const h3 = document.createElement("h3");
      h3.textContent = thread.title || opts.labels.newConversation;
      css(h3, {
        margin: "0",
        fontSize: "14px",
        lineHeight: "20px",
        fontWeight: "400",
        color: opts.customFont ? "inherit" : BRAND_COLOR,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      const when = document.createElement("span");
      when.textContent = formatTimeAgo(
        thread.lastMessageDate,
        Date.now(),
        opts.labels.timeAgo,
      );
      css(when, { fontSize: "12px", lineHeight: "16px" });
      mutedStyle(when);
      text.append(h3, when);
      const chevron = chevronRightIcon({ size: 16 });
      if (opts.customFont) chevron.style.opacity = "0.6";
      else chevron.style.color = BRAND_COLOR;
      row.append(text, chevron);
      row.addEventListener("click", () => opts.onSelect(thread));
      list.appendChild(row);
    });
    body.replaceChildren(list);
  }

  return {
    el: root,
    render: ({ threads, loading }) => {
      if (loading) renderLoading();
      else if (threads.length === 0) renderEmpty();
      else renderList(threads);
    },
  };
}
