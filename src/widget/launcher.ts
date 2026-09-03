/**
 * The floating launcher button that opens a side or bubble panel.
 *
 * Two looks share one builder so the side placements keep their exact current
 * launcher while the bubble placement gets the hosted widget's: a 54px circle,
 * `#007bff` by default, the Material "chat" glyph that turns into a chevron
 * while the panel is open, and the hover lift from `frame.css`.
 */

import { buildChatIcon } from "./renderMessage";
import { launcherCloseIcon, launcherIcon } from "./icons";
import {
  BRAND_COLOR,
  BRAND_TEXT_COLOR,
  css,
  FONT_VAR,
  LAUNCHER_BACKGROUND,
  LAUNCHER_TEXT_COLOR,
} from "./styles";

export interface LauncherOptions {
  /** `classic` is the side-panel launcher; `bubble` the hosted-widget one. */
  look: "classic" | "bubble";
  /** Viewport edge the button pins to. */
  edge: "left" | "right";
  /** Widget title, for the accessible name. */
  title: string;
  /** Optional image shown instead of the glyph. */
  icon?: string;
  onClick: () => void;
}

export interface LauncherHandle {
  el: HTMLButtonElement;
  /** Reflect the panel state: swaps the glyph and the accessible name. */
  setOpen: (open: boolean) => void;
}

export function buildLauncher(opts: LauncherOptions): LauncherHandle {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ago-chat-widget-launcher";
  btn.setAttribute("aria-label", `Open ${opts.title}`);
  btn.setAttribute("aria-expanded", "false");

  if (opts.look === "classic") {
    css(btn, {
      position: "fixed",
      bottom: "20px",
      [opts.edge]: "20px",
      width: "56px",
      height: "56px",
      borderRadius: "50%",
      border: "none",
      backgroundColor: BRAND_COLOR,
      color: BRAND_TEXT_COLOR,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "2147483000",
      boxShadow: "rgba(15, 15, 15, 0.2) 0px 4px 14px 0px",
      fontFamily: FONT_VAR,
    });
    if (opts.icon) {
      const img = document.createElement("img");
      img.src = opts.icon;
      img.alt = "";
      css(img, { width: "26px", height: "26px", objectFit: "contain" });
      btn.appendChild(img);
    } else {
      btn.appendChild(buildChatIcon());
    }
    btn.addEventListener("click", opts.onClick);
    return {
      el: btn,
      setOpen: (open) => {
        btn.setAttribute("aria-expanded", open ? "true" : "false");
        btn.setAttribute(
          "aria-label",
          `${open ? "Close" : "Open"} ${opts.title}`,
        );
      },
    };
  }

  // Bubble look: frame.css `#ago-chat-button`, value for value.
  css(btn, {
    position: "fixed",
    bottom: "20px",
    [opts.edge]: "20px",
    width: "54px",
    height: "54px",
    padding: "12px",
    margin: "0",
    boxSizing: "border-box",
    border: "none",
    borderRadius: "50%",
    backgroundColor: LAUNCHER_BACKGROUND,
    color: LAUNCHER_TEXT_COLOR,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(123, 123, 123, 0.3)",
    transition: "scale 0.2s ease",
    zIndex: "2147483001",
    // Keep iOS Safari from nudging the button during scroll, and isolate it from
    // host layout changes (frame.css).
    transform: "translateZ(0)",
    backfaceVisibility: "hidden",
    willChange: "transform",
    contain: "layout style paint",
    fontFamily: FONT_VAR,
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.scale = "1.1";
    btn.style.boxShadow = "0 6px 16px rgba(123, 123, 123, 0.4)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.scale = "1";
    btn.style.boxShadow = "0 4px 12px rgba(123, 123, 123, 0.3)";
  });

  let openGlyph: HTMLElement | SVGElement;
  let closeGlyph: SVGElement;
  if (opts.icon) {
    const img = document.createElement("img");
    img.src = opts.icon;
    img.alt = "";
    css(img, { width: "32px", height: "32px", objectFit: "contain" });
    openGlyph = img;
    closeGlyph = launcherCloseIcon();
    btn.append(img, closeGlyph);
  } else {
    const glyph = launcherIcon();
    openGlyph = glyph.querySelector<SVGElement>('[data-ago-path="open"]')!;
    closeGlyph = glyph.querySelector<SVGElement>('[data-ago-path="close"]')!;
    btn.appendChild(glyph);
  }
  closeGlyph.style.display = "none";

  btn.addEventListener("click", opts.onClick);

  return {
    el: btn,
    setOpen: (open) => {
      openGlyph.style.display = open ? "none" : "";
      closeGlyph.style.display = open ? "" : "none";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute(
        "aria-label",
        `${open ? "Close" : "Open"} ${opts.title}`,
      );
    },
  };
}
