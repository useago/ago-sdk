/**
 * The teaser speech bubble (`#ago-prompt` in the hosted widget): a white card
 * above the launcher that invites the visitor in, with a small "X" that fades
 * in after a second. Clicking the card opens the panel; the X dismisses it.
 *
 * Inline styles only. The CSS `::after` tail of the reference becomes a real
 * rotated `<span>`, and the two keyframes live in `ensureKeyframes`.
 */

import { css, div, PANEL_SHADOW } from "./styles";

export interface TeaserOptions {
  text: string;
  /** Viewport edge the launcher pins to. */
  edge: "left" | "right";
  onOpen: () => void;
  onDismiss?: () => void;
}

export interface TeaserHandle {
  el: HTMLDivElement;
  remove: () => void;
}

export function buildTeaser(opts: TeaserOptions): TeaserHandle {
  const wrap = div({
    position: "fixed",
    bottom: "80px",
    [opts.edge]: "20px",
    textAlign: opts.edge === "left" ? "left" : "right",
    cursor: "pointer",
    zIndex: "2147483000",
    animation: "ago-scale-in 800ms",
    fontFamily: "Arial, Helvetica, sans-serif",
    transform: "translateZ(0)",
    backfaceVisibility: "hidden",
    willChange: "transform",
  });
  wrap.className = "ago-chat-widget-teaser";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "ago-chat-widget-teaser__close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "X";
  css(close, {
    animation: "ago-appear 1000ms ease-in",
    background: "#fff",
    border: "1px solid #efefef",
    borderRadius: "50%",
    boxShadow: PANEL_SHADOW,
    color: "#333",
    cursor: "pointer",
    display: "inline-block",
    fontSize: "12px",
    fontWeight: "600",
    fontFamily: "inherit",
    lineHeight: "normal",
    left: "5px",
    padding: "3px 5px",
    position: "relative",
    top: "15px",
    zIndex: "1",
  });

  const text = document.createElement("p");
  text.className = "ago-chat-widget-teaser__text";
  css(text, {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: "16px",
    boxShadow: PANEL_SHADOW,
    color: "#333",
    display: "flex",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: "0.9rem",
    fontWeight: "600",
    gap: "8px",
    margin: "0 0 16px 0",
    padding: "20px",
    position: "relative",
    textAlign: "left",
  });
  text.textContent = opts.text;
  // The speech-bubble tail (frame.css `#ago-prompt p::after`).
  const tail = document.createElement("span");
  tail.setAttribute("aria-hidden", "true");
  css(tail, {
    position: "absolute",
    bottom: "-7px",
    [opts.edge]: "20px",
    height: "16px",
    width: "16px",
    border: "1px solid #fff",
    transform: "rotate(45deg)",
    backgroundColor: "#fff",
  });
  text.appendChild(tail);

  const remove = (): void => {
    wrap.remove();
  };
  close.addEventListener(
    "click",
    (e) => {
      e.stopPropagation();
      remove();
      opts.onDismiss?.();
    },
    { once: true },
  );
  wrap.addEventListener("click", (e) => {
    if (e.target !== close) opts.onOpen();
  });

  wrap.append(close, text);
  return { el: wrap, remove };
}
