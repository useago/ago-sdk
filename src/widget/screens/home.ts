/**
 * The bubble widget's home screen (`EmbedHomePage`): a centered title (one
 * line per `\n`), an optional markdown subtitle, the conversation starter
 * cards, and a slot the shared composer is moved into.
 */

import { arrowUpRightIcon } from "../icons";
import { renderMarkdown } from "../renderMarkdown";
import { css, div, EMBED_MUTED_TEXT, SHADOW_MD, SHADOW_SM, TEXT_COLOR } from "../styles";
import type { ConversationStarter } from "../types";

export interface HomeScreenOptions {
  title: string;
  subtitle?: string;
  starters: ConversationStarter[];
  onStarter: (starter: ConversationStarter) => void;
  /** Two starter columns at and above this viewport width (Tailwind `sm:`). */
  twoColumnsFrom?: number;
}

export interface HomeScreenHandle {
  el: HTMLDivElement;
  /** Where the composer lives while this screen is shown. */
  composerSlot: HTMLDivElement;
  /** Re-evaluate the starters grid columns after a resize. */
  syncColumns: () => void;
  /** Mark a starter as pending (dims the others) or clear it with `null`. */
  setPending: (starter: ConversationStarter | null) => void;
}

export function buildHomeScreen(opts: HomeScreenOptions): HomeScreenHandle {
  const root = div({
    position: "relative",
    display: "flex",
    flex: "1",
    flexDirection: "column",
    width: "100%",
    maxWidth: "768px",
    margin: "0 auto",
    padding: "16px",
    overflow: "auto",
    boxSizing: "border-box",
    minHeight: "0",
  });
  root.className = "ago-chat-widget__home";

  const inner = div({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    height: "100%",
    width: "100%",
    minHeight: "0",
  });

  const top = div({
    flex: "1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "32px",
    margin: "16px 0 32px",
  });
  const titleEl = div({
    fontSize: "28px",
    lineHeight: "1.2",
    letterSpacing: "-0.03em",
    fontWeight: "700",
    textAlign: "center",
    color: TEXT_COLOR,
  });
  titleEl.className = "ago-chat-widget__home-title";
  for (const line of opts.title.split("\n")) {
    const row = div({});
    row.textContent = line;
    titleEl.appendChild(row);
  }
  top.appendChild(titleEl);
  if (opts.subtitle) {
    const subtitle = div({
      fontSize: "14px",
      lineHeight: "20px",
      textAlign: "center",
      maxWidth: "512px",
    });
    subtitle.className = "ago-chat-widget__home-subtitle";
    subtitle.appendChild(renderMarkdown(opts.subtitle));
    top.appendChild(subtitle);
  }

  const middle = div({
    flex: "1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    position: "relative",
  });

  const grid = div({
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: "12px",
    width: "100%",
    maxWidth: "672px",
    marginBottom: "32px",
    padding: "0 16px",
    boxSizing: "border-box",
  });
  grid.className = "ago-chat-widget__starters";
  const cards: Array<{ starter: ConversationStarter; btn: HTMLButtonElement }> =
    [];
  let pending: ConversationStarter | null = null;

  for (const starter of opts.starters) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ago-chat-widget__starter";
    css(btn, {
      textAlign: "left",
      borderRadius: "12px",
      border: "1px solid rgba(228, 228, 231, 0.6)",
      backgroundColor: "#fff",
      padding: "14px 16px",
      boxShadow: SHADOW_SM,
      transition: "all 0.2s",
      cursor: "pointer",
      font: "inherit",
      color: TEXT_COLOR,
      position: "relative",
    });
    const row = div({
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "8px",
    });
    const label = div({
      minWidth: "0",
      flex: "1",
      fontSize: "14px",
      lineHeight: "1.375",
      display: "-webkit-box",
      overflow: "hidden",
    });
    label.style.setProperty("-webkit-line-clamp", "2");
    label.style.setProperty("-webkit-box-orient", "vertical");
    label.textContent = starter.label;
    const arrow = arrowUpRightIcon({ size: 16 });
    css(arrow, {
      marginTop: "2px",
      color: "rgba(113, 113, 122, 0.5)",
      transition: "all 0.15s",
    });
    row.append(label, arrow);
    btn.appendChild(row);
    btn.addEventListener("mouseenter", () => {
      if (btn.disabled) return;
      btn.style.borderColor = "#e4e4e7";
      btn.style.boxShadow = SHADOW_MD;
      btn.style.transform = "translateY(-2px)";
      arrow.style.color = TEXT_COLOR;
      arrow.style.transform = "translate(2px, -2px)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.borderColor = "rgba(228, 228, 231, 0.6)";
      btn.style.boxShadow = SHADOW_SM;
      btn.style.transform = "";
      arrow.style.color = "rgba(113, 113, 122, 0.5)";
      arrow.style.transform = "";
    });
    btn.addEventListener("click", () => {
      if (pending) return;
      opts.onStarter(starter);
    });
    cards.push({ starter, btn });
    grid.appendChild(btn);
  }
  if (opts.starters.length > 0) middle.appendChild(grid);

  const composerSlot = div({ width: "100%" });
  composerSlot.className = "ago-chat-widget__home-composer";
  middle.appendChild(composerSlot);

  const bottom = div({ flex: "1" });
  inner.append(top, middle, bottom);
  root.appendChild(inner);

  const twoColumnsFrom = opts.twoColumnsFrom ?? 640;
  const syncColumns = (): void => {
    const wide =
      typeof window !== "undefined" && window.innerWidth >= twoColumnsFrom;
    grid.style.gridTemplateColumns = wide ? "1fr 1fr" : "1fr";
  };
  syncColumns();

  const setPending = (starter: ConversationStarter | null): void => {
    pending = starter;
    for (const { starter: s, btn } of cards) {
      const isPending = s === starter;
      btn.disabled = !!starter;
      btn.style.opacity = starter ? "0.6" : "";
      btn.style.cursor = starter ? "not-allowed" : "pointer";
      const arrow = btn.querySelector("svg");
      if (arrow) {
        arrow.style.animation = isPending
          ? "ago-skeleton-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite"
          : "";
      }
    }
  };

  return { el: root, composerSlot, syncColumns, setPending };
}

/** Muted color shared by the home and history empty states. */
export const HOME_MUTED = EMBED_MUTED_TEXT;
