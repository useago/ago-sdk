/**
 * Styling kit for the framework-agnostic chat widget.
 *
 * Holds the visible theming contract (the `--ago-*` tokens and their defaults),
 * the {@link applyTheme} helper that writes a {@link WidgetTheme} onto the root,
 * and the tiny `css`/`div` DOM helpers every widget module builds on. Shared by
 * `createChatWidget.ts`, `renderMessage.ts`, and `buildInput.ts`.
 *
 * The semantic tokens here are the public theming contract: keep them in sync with
 * the `theme` keys, {@link WidgetTheme}, and the token table in
 * `docs/general/widget.md`.
 */

import type { WidgetTheme } from "./types";

// ── Styling (kept in sync with the React ChatWidget look) ────────────
// The semantic tokens (12) are the public theming contract — see docs/general/widget.md.
const FONT =
  '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
/** Font family, themed via `--ago-font` (default: the IBM Plex stack above). */
export const FONT_VAR = `var(--ago-font, ${FONT})`;

/**
 * Map of {@link WidgetTheme} keys → the CSS custom property each one sets. Keep in
 * sync with {@link WidgetTheme} in `./types` and the token table in
 * `docs/general/widget.md`.
 */
export const THEME_VARS: Record<keyof WidgetTheme, string> = {
  font: "--ago-font",
  radius: "--ago-radius",
  messageRadius: "--ago-message-radius",
  brand: "--ago-brand-color",
  brandText: "--ago-brand-text-color",
  headerBg: "--ago-header-background",
  headerText: "--ago-header-text-color",
  panelBg: "--ago-panel-background",
  messagesBg: "--ago-messages-background",
  text: "--ago-text-color",
  mutedText: "--ago-muted-text-color",
  border: "--ago-border-color",
  accent: "--ago-accent-color",
  agentBubbleBg: "--ago-agent-bubble-background",
};

export const BRAND_COLOR = "var(--ago-brand-color, #03182f)";
export const BRAND_TEXT_COLOR = "var(--ago-brand-text-color, #fff)";
export const HEADER_BACKGROUND =
  "var(--ago-header-background, var(--ago-brand-color, #03182f))";
export const HEADER_TEXT_COLOR = "var(--ago-header-text-color, #e8f0fe)";
export const PANEL_BACKGROUND = "var(--ago-panel-background, #fff)";
export const MESSAGES_BACKGROUND = "var(--ago-messages-background, #fbfbfb)";
export const TEXT_COLOR = "var(--ago-text-color, #30373e)";
export const MUTED_TEXT_COLOR = "var(--ago-muted-text-color, #6b6d6f)";
export const BORDER_COLOR = "var(--ago-border-color, #dee3e8)";
export const ACCENT_COLOR = "var(--ago-accent-color, #1b5fc4)";
export const AGENT_BUBBLE_BACKGROUND =
  "var(--ago-agent-bubble-background, #f1f3f5)";
export const RADIUS = "var(--ago-radius, 16px)";
export const MESSAGE_RADIUS = "var(--ago-message-radius, 16px)";
export const MESSAGE_RADIUS_IMESSAGE = "var(--ago-message-radius, 20px)";

/** Apply a {@link WidgetTheme} as inline `--ago-*` custom properties on the root. */
export function applyTheme(
  el: HTMLElement,
  theme: WidgetTheme | undefined,
): void {
  if (!theme) return;
  for (const key of Object.keys(THEME_VARS) as (keyof WidgetTheme)[]) {
    const value = theme[key];
    if (value != null) el.style.setProperty(THEME_VARS[key], value);
  }
}

export function css(
  el: HTMLElement,
  styles: Partial<CSSStyleDeclaration>,
): void {
  Object.assign(el.style, styles);
}

export function div(styles: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
  const el = document.createElement("div");
  css(el, styles);
  return el;
}

const KEYFRAMES_ID = "ago-chat-widget-keyframes";

/** Inject the streaming-dot keyframes once per document. */
export function ensureKeyframes(): void {
  if (
    typeof document === "undefined" ||
    document.getElementById(KEYFRAMES_ID)
  ) {
    return;
  }
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent =
    "@keyframes ago-pulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }" +
    "@keyframes ago-spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(style);
}
