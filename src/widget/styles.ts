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

import { readableTextColor } from "./colorUtils";
import type { AgoWidgetColors, WidgetTheme } from "./types";

// ── Styling (kept in sync with the React ChatWidget look) ────────────
// The semantic tokens are the public theming contract — see docs/general/widget.md.
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
  agentBubbleText: "--ago-agent-bubble-text-color",
  userBubbleBg: "--ago-user-bubble-background",
  userBubbleText: "--ago-user-bubble-text-color",
  launcherBg: "--ago-launcher-background",
  launcherText: "--ago-launcher-text-color",
  sendBg: "--ago-send-button-background",
  panelWidth: "--ago-panel-width",
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

// ── Bubble placement (the ago-chat embed look) ───────────────────────
// Same token names, different fallbacks: the bubble widget reproduces the hosted
// embed widget, whose surface is a faint blue-white and whose accent is the
// design-system blue. The classic renderers above keep their own fallbacks so
// inline/side placements are unchanged.
/** Launcher circle, `colors.button` in the embed snippet. */
export const LAUNCHER_BACKGROUND = "var(--ago-launcher-background, #007bff)";
export const LAUNCHER_TEXT_COLOR = "var(--ago-launcher-text-color, #fff)";
/** Composer send/stop button; falls back to the brand color. */
export const SEND_BACKGROUND =
  "var(--ago-send-button-background, var(--ago-brand-color, #03182f))";
export const USER_BUBBLE_BACKGROUND_EMBED =
  "var(--ago-user-bubble-background, #fff)";
export const USER_BUBBLE_TEXT_EMBED =
  "var(--ago-user-bubble-text-color, #0a0a0a)";
export const AGENT_BUBBLE_TEXT =
  "var(--ago-agent-bubble-text-color, var(--ago-text-color, #30373e))";
/** The embed layout surface (Tailwind `--background`, a blue-tinted white). */
export const EMBED_BACKGROUND = "var(--ago-panel-background, #f8faff)";
/** Design-system accent (Tailwind `--primary-accent`). */
export const PRIMARY_ACCENT = "var(--ago-accent-color, #003edf)";
/** Tailwind `--primary-foreground`: the composer border and source badge fill. */
export const PRIMARY_FOREGROUND = "#e3edff";
/** Tailwind neutral-200: chips, source cards, the jump button. */
export const NEUTRAL_BORDER = "#e5e5e5";
/** Tailwind `--border` (zinc-200): history rows, starter cards. */
export const EMBED_BORDER = "var(--ago-border-color, #e4e4e7)";
export const EMBED_MUTED_TEXT = "var(--ago-muted-text-color, #71717a)";
export const PANEL_WIDTH = "var(--ago-panel-width, 550px)";
export const SHADOW_SM = "0 1px 2px 0 rgba(0,0,0,0.05)";
export const SHADOW =
  "0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)";
export const SHADOW_MD =
  "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)";
/** The reference panel / teaser shadow. */
export const PANEL_SHADOW = "rgba(15, 15, 15, 0.16) 0px 5px 40px 0px";

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

/**
 * Translate the embed snippet's `colors` object into {@link WidgetTheme} keys,
 * so `mountChatWidget({ colors })` skins the bubble widget exactly like
 * `window.AGO.colors` skins the hosted one. The header text color is derived
 * for contrast unless the theme sets it.
 */
export function colorsToTheme(colors: AgoWidgetColors | undefined): WidgetTheme {
  if (!colors) return {};
  const theme: WidgetTheme = {};
  if (colors.button) {
    theme.launcherBg = colors.button;
    theme.sendBg = colors.button;
  }
  if (colors.header) {
    theme.headerBg = colors.header;
    theme.headerText = readableTextColor(colors.header);
  }
  if (colors.agentMessage) theme.agentBubbleBg = colors.agentMessage;
  if (colors.agentMessageFont) theme.agentBubbleText = colors.agentMessageFont;
  if (colors.background) {
    theme.panelBg = colors.background;
    theme.messagesBg = colors.background;
  }
  if (colors.font) theme.text = colors.font;
  if (colors.userMessage) theme.userBubbleBg = colors.userMessage;
  if (colors.userMessageFont) theme.userBubbleText = colors.userMessageFont;
  return theme;
}

export function css(
  el: ElementCSSInlineStyle,
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

/**
 * Inject the widget's keyframes once per document, plus the one rule inline
 * styles cannot express (a `::placeholder` pseudo-element), scoped under an
 * `ago-` class so it can never touch the host page.
 */
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
    "@keyframes ago-spin { to { transform: rotate(360deg); } }" +
    // The teaser bubble's pop-in (frame.css `scale-in`).
    "@keyframes ago-scale-in { 50% { transform: translateX(-10px) translateY(-5px) scale(1.1); } }" +
    // The teaser close button's delayed fade-in (frame.css `appear`).
    "@keyframes ago-appear { 0%, 98% { opacity: 0; } 100% { opacity: 1; } }" +
    // Tailwind `animate-pulse`, for skeletons and pending starter cards.
    "@keyframes ago-skeleton-pulse { 50% { opacity: 0.5; } }" +
    ".ago-chat-input--embed textarea::placeholder { font-style: italic; color: #9ca3af; opacity: 1; }";
  document.head.appendChild(style);
}
