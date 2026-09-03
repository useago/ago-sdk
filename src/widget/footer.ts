/**
 * The bubble widget's bottom bar (`EmbedFooter` in the hosted widget): two
 * pill tabs, Home and Chats, on a transparent, borderless strip. Hidden inside
 * a conversation, where the header's back chevron is the way out.
 */

import { conversationsIcon, houseIcon } from "./icons";
import { BRAND_COLOR, css, PRIMARY_ACCENT } from "./styles";
import type { WidgetLabels, WidgetScreen } from "./types";

export interface FooterOptions {
  labels: WidgetLabels;
  onNavigate: (screen: WidgetScreen) => void;
}

export interface FooterHandle {
  el: HTMLElement;
  setActive: (screen: WidgetScreen) => void;
  setVisible: (visible: boolean) => void;
}

/** Tailwind `bg-primary/[0.07]` against the `#03182f` primary. */
const TAB_TINT = "rgba(3, 24, 47, 0.07)";

export function buildFooter(opts: FooterOptions): FooterHandle {
  const footer = document.createElement("footer");
  footer.className = "ago-chat-widget__footer";
  css(footer, {
    padding: "12px",
    flexShrink: "0",
    background: "transparent",
  });
  const nav = document.createElement("nav");
  css(nav, {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    width: "100%",
  });

  const tabs = new Map<WidgetScreen, HTMLButtonElement>();
  let active: WidgetScreen = "home";

  function tab(
    screen: WidgetScreen,
    label: string,
    glyph: SVGElement,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ago-chat-widget__tab";
    btn.dataset.agoScreen = screen;
    css(btn, {
      flex: "1",
      minWidth: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "4px",
      padding: "12px 8px",
      borderRadius: "32px",
      border: "none",
      background: "transparent",
      color: BRAND_COLOR,
      cursor: "pointer",
      transition: "background-color 0.15s",
      font: "inherit",
    });
    const text = document.createElement("span");
    text.textContent = label;
    css(text, {
      fontSize: "12px",
      lineHeight: "16px",
      maxWidth: "100%",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    btn.append(glyph, text);
    btn.addEventListener("mouseenter", () => {
      btn.style.backgroundColor = TAB_TINT;
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.backgroundColor = active === screen ? TAB_TINT : "transparent";
    });
    btn.addEventListener("click", () => opts.onNavigate(screen));
    tabs.set(screen, btn);
    return btn;
  }

  nav.append(
    tab("home", opts.labels.home, houseIcon({ size: 24 })),
    tab("history", opts.labels.chats, conversationsIcon({ size: 24 })),
  );
  footer.appendChild(nav);

  const setActive = (screen: WidgetScreen): void => {
    // A conversation belongs to the Home section, like the reference: the
    // footer is hidden there anyway, but the state stays consistent.
    active = screen === "history" ? "history" : "home";
    for (const [key, btn] of tabs) {
      const on = key === active;
      btn.style.color = on ? PRIMARY_ACCENT : BRAND_COLOR;
      btn.style.backgroundColor = on ? TAB_TINT : "transparent";
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    }
  };
  setActive("home");

  return {
    el: footer,
    setActive,
    setVisible: (visible) => {
      footer.style.display = visible ? "block" : "none";
    },
  };
}
