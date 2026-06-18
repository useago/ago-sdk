import { AgoClient } from "../client/AgoClient";
import { AgoError } from "../client/errors";
import type {
  AgoClientEvents,
  AgoConfig,
  AgoMessage,
  Conversation,
} from "../client/types";
import {
  createFormCollector,
  loadFormCollector,
  type CreateFormCollectorOptions,
  type FormCollector,
  type LoadFormCollectorOptions,
} from "../forms/createFormCollector";
import {
  createConversationSession,
  type ConversationSession,
  type ConversationSessionOptions,
} from "../state/createConversationSession";
import { renderMarkdown } from "./renderMarkdown";

/**
 * Theme overrides for {@link mountChatWidget}. *
 * @see The `--ago-*` token reference in `docs/general/widget.md`.
 */
export interface WidgetTheme {
  /** Font family for the whole panel. Pass `"inherit"` to adopt the page font. (`--ago-font`) */
  font?: string;
  /** Corner radius of the panel container. (`--ago-radius`) */
  radius?: string;
  /** Corner radius of message bubbles and suggested-reply pills. Defaults to 16px. (`--ago-message-radius`) */
  messageRadius?: string;
  /** Brand color: user message bubbles and the send button (and the header, unless `headerBg` is set). (`--ago-brand-color`) */
  brand?: string;
  /** Text/icon color shown on top of `brand`. (`--ago-brand-text-color`) */
  brandText?: string;
  /** Header background. Defaults to `brand`. (`--ago-header-background`) */
  headerBg?: string;
  /** Header title color. (`--ago-header-text-color`) */
  headerText?: string;
  /** Panel surface: container, input row, suggested-reply pills, source cards. (`--ago-panel-background`) */
  panelBg?: string;
  /** Background of the scrolling messages area. (`--ago-messages-background`) */
  messagesBg?: string;
  /** Primary body text color (assistant messages, agent name, source labels). (`--ago-text-color`) */
  text?: string;
  /** Muted text color (the empty-state welcome message). (`--ago-muted-text-color`) */
  mutedText?: string;
  /** Border color used for the panel, input, pills, and cards. (`--ago-border-color`) */
  border?: string;
  /** Secondary accent: source badges and suggested-reply hover outline. (`--ago-accent-color`) */
  accent?: string;
  /** Background of assistant message bubbles when `agentBubble` is on. Defaults to a light gray. (`--ago-agent-bubble-background`) */
  agentBubbleBg?: string;
}

/**
 * Options for {@link mountChatWidget} — the framework-agnostic (pure TS/JS)
 * equivalent of the React `<ChatWidget>` component. Same features: conversational
 * forms (form creator) and clickable suggested replies.
 */
export interface MountChatWidgetOptions {
  /** An existing AGO client. Provide this OR `config`. */
  client?: AgoClient;
  /** Config to build a client when `client` is not supplied. `baseUrl` is required. */
  config?: AgoConfig;
  /** Initial conversation ID to continue. */
  conversationId?: string;
  /**
   * Resume the visitor's last active thread across reloads. `true` enables defaults
   * (localStorage, widget id under `ago_widget_id`); pass an object to set `storage`
   * (e.g. `sessionStorage`), `key`, or an explicit `widgetId`. Built on
   * {@link createConversationSession}: the visitor is identified by a single stable
   * widget id and the backend hands back their most recently updated conversation.
   * An explicit `conversationId` still wins as the initial thread. Off by default.
   */
  persistConversation?: boolean | Partial<ConversationSessionOptions>;
  /** Widget title shown in the header. */
  title?: string;
  /** Message shown before any conversation has started. */
  welcomeMessage?: string;
  /** Input placeholder. */
  placeholder?: string;
  /** Enable file attachments. */
  allowFiles?: boolean;
  /** Widget height (number → px). Ignored when `placement` is `"left"`/`"right"`
   * (a side panel is always full-height). */
  height?: string | number;
  /**
   * Where the panel renders. `"inline"` (default) mounts it directly into the
   * target element, filling it. `"left"` / `"right"` instead pin a **fixed,
   * full-height side panel** to that edge of the viewport that slides open and
   * closed; the target is only used as the DOM parent (pass `document.body` for
   * a true page overlay). In side mode `height` is ignored and the width comes
   * from {@link MountChatWidgetOptions.width}.
   */
  placement?: "inline" | "left" | "right";
  /**
   * Width of the side panel for `placement: "left" | "right"` (number → px).
   * Capped at the viewport width so it never overflows on mobile. Ignored when
   * `placement` is `"inline"`. Defaults to `400`.
   */
  width?: string | number;
  /**
   * For side placements, render the built-in floating launcher button that opens
   * the panel (plus a close "×" in the header). Set `false` to drive open/close
   * yourself via the handle's `open()`/`close()`/`toggle()`. Ignored when
   * `placement` is `"inline"`. Defaults to `true`.
   */
  launcher?: boolean;
  /**
   * For side placements, whether the panel starts open. Ignored when `placement`
   * is `"inline"` (an inline panel is always visible). Defaults to `false`.
   */
  defaultOpen?: boolean;
  /** URL of a logo shown in the header (and on the launcher button, if shown). */
  logoUrl?: string;
  /** Show the agent name above assistant messages. Defaults to `false`. */
  showAgentName?: boolean;
  /** Render assistant messages inside a filled bubble (themed via `agentBubbleBg`). Defaults to `false`. */
  agentBubble?: boolean;
  /**
   * Bubble shape preset. `"imessage"` bubbles both sides (assistant messages get
   * the filled `agentBubbleBg` bubble too) and draws the iMessage "tail" curl on
   * the last bubble of each same-sender run. Defaults to `"default"` (current
   * look). Colors stay themed: user bubble `brand`, assistant bubble
   * `agentBubbleBg`, and the tail mask follows `messagesBg`.
   */
  bubbleStyle?: "default" | "imessage";
  /**
   * Show the header bar (title, logo, and the side-panel close "×"). Set `false`
   * to drop it, e.g. when the host page already frames the widget. Defaults to
   * `true`. Note: with the built-in launcher in side placement, the close "×"
   * lives in the header, so hiding it leaves the launcher (and `widget.close()`)
   * as the way to dismiss the panel.
   */
  showHeader?: boolean;
  /**
   * Theme overrides so the panel blends into the host page.
   */
  theme?: WidgetTheme;
  /**
   * Load the visitor's conversation list into `widget.threads` on mount and refresh
   * it after each turn (one `GET /conversations` per load). Off by default to avoid
   * the request when the integrator doesn't need it; `widget.refreshThreads()` stays
   * callable on demand regardless.
   */
  loadThreads?: boolean;
  /**
   * Conversational forms the agent can fill and submit during the chat. Each
   * entry is installed as a {@link createFormCollector} for the lifetime of the
   * widget (removed on `destroy()`).
   *
   * Pass a full config (with `schema`) to define it inline, or just `{ name }` to
   * fetch the definition from the backend ({@link loadFormCollector}).
   */
  forms?: Array<CreateFormCollectorOptions | LoadFormCollectorOptions>;
  /**
   * The confirmation notice shown in the chat once a form is submitted (auto-submit
   * or a manual `submit_<name>`), a small success block appended below the
   * conversation. By default the notice shows a `message` string returned by the
   * submit response (POST body / handler result / backend relay) when present, and
   * otherwise falls back to this string ("Form submitted." by default). Pass a
   * function to build the text from the raw submit response yourself; return a
   * nullish value to fall back to the default text.
   */
  formSubmittedMessage?: string | ((result: unknown) => string | null | undefined);
  /**
   * How clicking a suggested follow-up reply behaves. Defaults to sending the
   * reply as a new user message. Pass a handler to override, or `false` to
   * render the suggestions as non-interactive.
   */
  onFollowUpClick?: ((reply: string) => void) | false;
  /** Called when the user sends a message. */
  onMessageSent?: (content: string) => void;
  /** Called when an assistant message completes. */
  onMessageReceived?: (message: { id: string; content: string }) => void;
  /**
   * Called when a form collector submits successfully. `result` is the raw submit
   * response (the third-party API's answer); `values` are the submitted fields.
   * Forwards the client's `form:submitted` event.
   */
  onFormSubmitted?: (data: {
    name: string;
    values: Record<string, unknown>;
    result: unknown;
  }) => void;
  /**
   * Called when a form collector submit fails at the network/server level.
   * Forwards the client's `form:error` event. No notice is shown in the chat.
   */
  onFormError?: (data: {
    name: string;
    values: Record<string, unknown>;
    error: string;
  }) => void;
}

/** Handle returned by {@link mountChatWidget}. */
export interface ChatWidgetHandle {
  /** The AGO client backing the widget. */
  client: AgoClient;
  /** The root element the widget rendered into. */
  element: HTMLElement;
  /** Programmatically send a message (same path as the input). */
  sendMessage: (content: string, files?: File[]) => Promise<void>;
  /**
   * Open / close / toggle the side panel. Present only for
   * `placement: "left" | "right"` (an inline panel is always visible).
   */
  open?: () => void;
  close?: () => void;
  toggle?: () => void;
  /**
   * The conversation-persistence session, present only when `persistConversation`
   * is set — exposes the stable `widgetId` and `session.clear()` to start a new thread.
   */
  session?: ConversationSession;
  /**
   * The visitor's conversations (threads) — the vanilla equivalent of the React/Vue
   * `useConversation().conversations`. Auto-loaded on mount and refreshed after each
   * turn only when `loadThreads` is set; otherwise it stays empty until you call
   * {@link ChatWidgetHandle.refreshThreads}.
   */
  readonly threads: Conversation[];
  /** Re-fetch the conversations list and update {@link ChatWidgetHandle.threads}. */
  refreshThreads: () => Promise<Conversation[]>;
  /** Remove listeners, uninstall forms, and clear the DOM. */
  destroy: () => void;
}

// ── Styling (kept in sync with the React ChatWidget look) ────────────
// The semantic tokens (12) are the public theming contract — see docs/general/widget.md.
const FONT =
  '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
/** Font family, themed via `--ago-font` (default: the IBM Plex stack above). */
const FONT_VAR = `var(--ago-font, ${FONT})`;

/** Map of {@link WidgetTheme} keys → the CSS custom property each one sets. */
const THEME_VARS: Record<keyof WidgetTheme, string> = {
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

const BRAND_COLOR = "var(--ago-brand-color, #03182f)";
const BRAND_TEXT_COLOR = "var(--ago-brand-text-color, #fff)";
const HEADER_BACKGROUND =
  "var(--ago-header-background, var(--ago-brand-color, #03182f))";
const HEADER_TEXT_COLOR = "var(--ago-header-text-color, #e8f0fe)";
const PANEL_BACKGROUND = "var(--ago-panel-background, #fff)";
const MESSAGES_BACKGROUND = "var(--ago-messages-background, #fbfbfb)";
const TEXT_COLOR = "var(--ago-text-color, #30373e)";
const MUTED_TEXT_COLOR = "var(--ago-muted-text-color, #6b6d6f)";
const BORDER_COLOR = "var(--ago-border-color, #dee3e8)";
const ACCENT_COLOR = "var(--ago-accent-color, #1b5fc4)";
const AGENT_BUBBLE_BACKGROUND = "var(--ago-agent-bubble-background, #f1f3f5)";
const RADIUS = "var(--ago-radius, 16px)";
const MESSAGE_RADIUS = "var(--ago-message-radius, 16px)";

/** Apply a {@link WidgetTheme} as inline `--ago-*` custom properties on the root. */
function applyTheme(el: HTMLElement, theme: WidgetTheme | undefined): void {
  if (!theme) return;
  for (const key of Object.keys(THEME_VARS) as (keyof WidgetTheme)[]) {
    const value = theme[key];
    if (value != null) el.style.setProperty(THEME_VARS[key], value);
  }
}

function css(el: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, styles);
}

function div(styles: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
  const el = document.createElement("div");
  css(el, styles);
  return el;
}

/** Fallback text for the form-submitted notice when the response carries none. */
const DEFAULT_FORM_SUBMITTED_MESSAGE = "Form submitted.";

/**
 * Pull a human message out of a submit response so the notice can echo what the
 * server said. Handles a bare string, a top-level `{ message }`, and the backend
 * relay's `{ status, result }` wrapper (message nested under `result`). Returns
 * null when there's nothing usable, so the caller can fall back to a default.
 */
function messageFromResult(result: unknown): string | null {
  if (typeof result === "string") return result || null;
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  if (typeof record.message === "string" && record.message) {
    return record.message;
  }
  const inner = record.result;
  if (typeof inner === "string" && inner) return inner;
  if (inner && typeof inner === "object") {
    const nested = (inner as Record<string, unknown>).message;
    if (typeof nested === "string" && nested) return nested;
  }
  return null;
}

const KEYFRAMES_ID = "ago-chat-widget-keyframes";

/** Inject the streaming-dot keyframes once per document. */
function ensureKeyframes(): void {
  if (
    typeof document === "undefined" ||
    document.getElementById(KEYFRAMES_ID)
  ) {
    return;
  }
  const style = document.createElement("style");
  style.id = KEYFRAMES_ID;
  style.textContent =
    "@keyframes ago-pulse { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }";
  document.head.appendChild(style);
}

function resolveTarget(target: string | HTMLElement): HTMLElement {
  const el =
    typeof target === "string"
      ? document.querySelector<HTMLElement>(target)
      : target;
  if (!el) {
    throw new Error(`mountChatWidget: target "${String(target)}" not found.`);
  }
  return el;
}

/**
 * Mount a complete, dependency-free chat widget into any DOM element — no React,
 * Vue, or Angular required. Mirrors the React `<ChatWidget>`: it streams replies,
 * renders clickable suggested replies, and installs conversational form collectors.
 *
 * Message content is rendered as GitHub-flavored markdown by a tiny built-in
 * parser (no dependencies); all message text is HTML-escaped first (see
 * {@link renderMarkdown}).
 *
 * ```ts
 * import { mountChatWidget } from "@useago/sdk/widget";
 *
 * const widget = mountChatWidget("#chat", {
 *   config: { baseUrl: "https://YOUR-DOMAIN.useago.com" },
 *   title: "Book a demo",
 *   forms: [{
 *     name: "demo_request",
 *     description: "A request to book a product demo.",
 *     schema: {
 *       type: "object",
 *       properties: { name: { type: "string" }, email: { type: "string" } },
 *       required: ["name", "email"],
 *     },
 *     submit: { via: "backend" },
 *   }],
 * });
 * // later: widget.destroy();
 * ```
 */
export function mountChatWidget(
  target: string | HTMLElement,
  options: MountChatWidgetOptions,
): ChatWidgetHandle {
  const {
    title = "Chat",
    welcomeMessage = "Hello! How can I help you today?",
    placeholder = "Type a message...",
    allowFiles = false,
    height = 500,
    placement = "inline",
    width = 400,
    defaultOpen = false,
    logoUrl,
    showAgentName = false,
    agentBubble = false,
    bubbleStyle = "default",
    showHeader = true,
    theme,
    loadThreads = false,
    forms,
    formSubmittedMessage = DEFAULT_FORM_SUBMITTED_MESSAGE,
    onFollowUpClick,
    onMessageSent,
    onMessageReceived,
    onFormSubmitted,
    onFormError,
  } = options;

  if (!options.client && !options.config?.baseUrl) {
    throw new AgoError(
      "mountChatWidget requires either `client` or `config` (with a baseUrl).",
      "config_missing_base_url",
    );
  }
  const client = options.client ?? new AgoClient(options.config as AgoConfig);
  const root = resolveTarget(target);

  // Side-panel mode: a fixed, full-height panel pinned to the left/right edge that
  // slides open and closed. `inline` (default) keeps the original behavior of
  // filling the target element.
  const isSide = placement === "left" || placement === "right";
  const showLauncher = isSide && (options.launcher ?? true);
  let panelOpen = isSide ? defaultOpen : true;

  // Optional cross-reload resumption of the visitor's last active thread, keyed off
  // a single stable widget id rather than a per-agent stored conversation id.
  const persist = options.persistConversation;
  const session = persist
    ? createConversationSession(persist === true ? {} : persist)
    : undefined;

  // An explicit conversationId wins; otherwise resume the last active thread from
  // the front-side cache (no backend round-trip), subject to its TTL.
  let conversationId =
    options.conversationId ?? session?.getLastActiveThread() ?? undefined;
  let messages: AgoMessage[] = [];
  let isLoading = false;
  let errorMessage: string | null = null;
  // Resolved confirmation text for each submitted form, in submit order — each
  // renders a "form submitted" notice appended below the conversation.
  const formNotices: string[] = [];

  // Build the notice text for a submit response: a custom function wins, else a
  // server-returned `message`, else the configured/default fallback string.
  function resolveNoticeText(result: unknown): string {
    if (typeof formSubmittedMessage === "function") {
      const custom = formSubmittedMessage(result);
      if (typeof custom === "string" && custom) return custom;
    }
    const fromResponse = messageFromResult(result);
    if (fromResponse) return fromResponse;
    return typeof formSubmittedMessage === "string"
      ? formSubmittedMessage
      : DEFAULT_FORM_SUBMITTED_MESSAGE;
  }
  // The visitor's conversation list, exposed on the handle. Loaded on mount and
  // kept in place (same array reference) so consumers can hold onto `widget.threads`.
  const threads: Conversation[] = [];

  // ── DOM scaffold ───────────────────────────────────────────────────
  const container = div({
    display: "flex",
    flexDirection: "column",
    height: isSide
      ? "100%"
      : typeof height === "number"
        ? `${height}px`
        : height,
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: RADIUS,
    overflow: "hidden",
    backgroundColor: PANEL_BACKGROUND,
    fontFamily: FONT_VAR,
    textAlign: "left",
    boxShadow: "rgba(15, 15, 15, 0.08) 0px 2px 16px 0px",
  });
  container.className = "ago-chat-widget";
  // Theme = inline `--ago-*` custom properties on the root; the `var()` references
  // throughout the panel resolve against them (and host-page CSS can set them too).
  applyTheme(container, theme);

  let header: HTMLDivElement | undefined;
  if (showHeader) {
    header = div({
      padding: "14px 16px",
      borderBottom: `1px solid ${BORDER_COLOR}`,
      backgroundColor: HEADER_BACKGROUND,
      color: HEADER_TEXT_COLOR,
      display: "flex",
      alignItems: "center",
      gap: "10px",
    });
    header.className = "ago-chat-widget__header";
    if (logoUrl) {
      const logo = document.createElement("img");
      logo.src = logoUrl;
      logo.alt = "Logo";
      css(logo, { height: "24px", width: "auto" });
      header.appendChild(logo);
    }
    const titleEl = document.createElement("h3");
    titleEl.textContent = title;
    css(titleEl, { margin: "0", fontSize: "15px", fontWeight: "600" });
    header.appendChild(titleEl);

    // Side panels get a close affordance in the header (the launcher reopens them).
    if (isSide) {
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "ago-chat-widget__close";
      closeBtn.setAttribute("aria-label", "Close");
      closeBtn.textContent = "×";
      css(closeBtn, {
        marginLeft: "auto",
        background: "transparent",
        border: "none",
        color: HEADER_TEXT_COLOR,
        fontSize: "22px",
        lineHeight: "1",
        cursor: "pointer",
        padding: "0 2px",
      });
      closeBtn.addEventListener("click", () => closePanel());
      header.appendChild(closeBtn);
    }
  }

  const messagesEl = div({
    flex: "1",
    overflow: "auto",
    padding: "16px",
    backgroundColor: MESSAGES_BACKGROUND,
  });
  messagesEl.className = "ago-chat-widget__messages";

  const { inputRow, setDisabled, focus } = buildInput({
    placeholder,
    allowFiles,
    onSend: (content, files) => void send(content, files),
  });

  ensureKeyframes();

  container.append(...(header ? [header] : []), messagesEl, inputRow);

  // In side mode the panel lives inside a fixed, full-height wrapper pinned to the
  // chosen edge; otherwise it's mounted inline as before. `mountInto` is whatever
  // gets appended to the host element (and removed on destroy).
  let mountInto: HTMLElement = container;
  let wrapper: HTMLDivElement | undefined;
  let launcherBtn: HTMLButtonElement | undefined;

  // Which viewport edge the side panel/launcher pin to (narrowed for use as a
  // CSS property key); only meaningful when `isSide`.
  const edge: "left" | "right" = placement === "left" ? "left" : "right";

  if (isSide) {
    wrapper = div({
      position: "fixed",
      top: "0",
      bottom: "0",
      [edge]: "0",
      width: typeof width === "number" ? `${width}px` : width,
      maxWidth: "100vw",
      display: "flex",
      zIndex: "2147483000",
      transition: "transform 0.3s ease",
      boxShadow: "rgba(15, 15, 15, 0.18) 0px 0px 24px 0px",
    });
    wrapper.className = "ago-chat-widget-panel";
    // The panel fills the wrapper edge-to-edge: drop the rounded corners and keep a
    // single divider on the inner edge facing the page.
    css(container, {
      height: "100%",
      width: "100%",
      borderRadius: "0",
      border: "none",
      boxShadow: "none",
      [edge === "left" ? "borderRight" : "borderLeft"]:
        `1px solid ${BORDER_COLOR}`,
    });
    wrapper.appendChild(container);
    mountInto = wrapper;
  }

  if (showLauncher) {
    launcherBtn = document.createElement("button");
    launcherBtn.type = "button";
    launcherBtn.className = "ago-chat-widget-launcher";
    launcherBtn.setAttribute("aria-label", `Open ${title}`);
    css(launcherBtn, {
      position: "fixed",
      bottom: "20px",
      [edge]: "20px",
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
    if (logoUrl) {
      const img = document.createElement("img");
      img.src = logoUrl;
      img.alt = "";
      css(img, { width: "26px", height: "26px", objectFit: "contain" });
      launcherBtn.appendChild(img);
    } else {
      launcherBtn.appendChild(buildChatIcon());
    }
    launcherBtn.addEventListener("click", () => openPanel());
  }

  root.appendChild(mountInto);
  if (launcherBtn) root.appendChild(launcherBtn);
  applyOpenState();

  // ── Rendering ──────────────────────────────────────────────────────
  const followUpEnabled = onFollowUpClick !== false;
  const followUpHandler =
    onFollowUpClick === false
      ? undefined
      : (onFollowUpClick ?? ((reply: string) => void send(reply)));

  function renderMessage(
    message: AgoMessage,
    isLast: boolean,
    isLastOfBlock = true,
  ): HTMLElement {
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

    const bubbled = isUser || agentBubble || imessage;

    const bubble = div({
      maxWidth: imessage ? "75%" : isUser ? "75%" : bubbled ? "85%" : "100%",
      padding: bubbled ? "10px 14px" : "2px 8px",
      borderRadius: bubbled ? MESSAGE_RADIUS : "0",
      backgroundColor: isUser
        ? BRAND_COLOR
        : bubbled
          ? AGENT_BUBBLE_BACKGROUND
          : "transparent",
      color: isUser ? BRAND_TEXT_COLOR : TEXT_COLOR,
      wordBreak: "break-word",
      fontSize: "16px",
      lineHeight: "1.6",
    });
    bubble.className = "ago-message__content";
    // iMessage tail on the last bubble of a same-sender block: a colored bulge
    // (fill) at the bottom corner, masked by a shape in the messages-area color
    // to carve out the curl (technique from CodePen swards/gxQmbj).
    if (imessage && isLastOfBlock) {
      bubble.style.position = "relative";
      // Flatten the corner the tail attaches to so the curl reads as part of the
      // bubble (bottom-right for the user, bottom-left for the assistant).
      if (isUser) {
        bubble.style.borderBottomRightRadius = "4px";
      } else {
        bubble.style.borderBottomLeftRadius = "4px";
      }
      const fill = div({
        position: "absolute",
        zIndex: "0",
        bottom: "0",
        width: "20px",
        height: "20px",
        background: isUser ? BRAND_COLOR : AGENT_BUBBLE_BACKGROUND,
      });
      fill.className = "ago-message__tail";
      const mask = div({
        position: "absolute",
        zIndex: "1",
        bottom: "0",
        width: "10px",
        height: "20px",
        background: MESSAGES_BACKGROUND,
      });
      mask.className = "ago-message__tail-mask";
      if (isUser) {
        fill.style.right = "-8px";
        fill.style.borderBottomLeftRadius = "15px";
        mask.style.right = "-10px";
        mask.style.borderBottomLeftRadius = "10px";
      } else {
        fill.style.left = "-7px";
        fill.style.borderBottomRightRadius = "15px";
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
    wrap.appendChild(bubble);

    // Only on the last message, so stale suggestions disappear once the user
    // sends their next message.
    if (
      isLast &&
      message.followUpReplies &&
      message.followUpReplies.length > 0
    ) {
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
  function renderFormNotice(text: string): HTMLElement {
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

  function render(): void {
    messagesEl.replaceChildren();
    if (messages.length === 0) {
      const welcome = div({
        textAlign: "center",
        color: MUTED_TEXT_COLOR,
        padding: "24px 16px",
        fontSize: "16px",
        lineHeight: "1.5",
      });
      welcome.appendChild(renderMarkdown(welcomeMessage));
      messagesEl.appendChild(welcome);
    } else {
      messages.forEach((message, index) => {
        // Last bubble of a same-sender block (gets the iMessage tail).
        const isLastOfBlock =
          index === messages.length - 1 ||
          messages[index + 1].role !== message.role;
        messagesEl.appendChild(
          renderMessage(message, index === messages.length - 1, isLastOfBlock),
        );
      });
    }
    // One confirmation per submitted form, below the conversation.
    for (const text of formNotices) {
      messagesEl.appendChild(renderFormNotice(text));
    }
    if (errorMessage) {
      const err = div({
        padding: "10px 14px",
        backgroundColor: "#fef2f2",
        color: "#dc2626",
        borderRadius: "12px",
        marginTop: "8px",
        fontSize: "13px",
        border: "1px solid #fecaca",
      });
      err.textContent = errorMessage;
      messagesEl.appendChild(err);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    // Block the input only while the agent is generating the main answer. Once the
    // answer is done (status DONE) it re-enables, even though the stream stays open
    // while follow-up replies are still being generated.
    const last = messages[messages.length - 1];
    const isAnswering =
      isLoading && last?.role === "assistant" && last.status === "IN_PROGRESS";
    setDisabled(isAnswering);
  }

  // ── Streaming event wiring ─────────────────────────────────────────
  function lastInProgressAssistant(): AgoMessage | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.status === "IN_PROGRESS") return m;
    }
    return undefined;
  }

  const onStart = (data: { conversationId: string }): void => {
    if (!conversationId) conversationId = data.conversationId;
  };
  const onChunk = (data: { content: string }): void => {
    const target = lastInProgressAssistant();
    if (!target) return;
    target.content += data.content;
    render();
  };
  const onAnswerComplete = (message: AgoMessage): void => {
    // Main answer text is done; follow-up replies may still be streaming. Reveal
    // the answer and flip the streaming assistant message to DONE (adopting the
    // real id so message:complete updates the same entry). Keep isLoading true so
    // the follow-up indicator stays until the stream closes.
    const idx = messages.findIndex(
      (m) =>
        m.id === message.id ||
        (m.role === "assistant" && m.status === "IN_PROGRESS"),
    );
    if (idx >= 0) {
      messages[idx] = message;
    } else {
      messages.push(message);
    }
    render();
    // The answer is done and the input has just re-enabled — return the cursor to
    // it so the user can reply without clicking back in.
    focus();
  };
  const onComplete = (message: AgoMessage): void => {
    const idx = messages.findIndex(
      (m) =>
        m.id === message.id ||
        (m.role === "assistant" && m.status === "IN_PROGRESS"),
    );
    if (idx >= 0) {
      messages[idx] = message;
    } else {
      messages.push(message);
    }
    isLoading = false;
    render();
    if (message.status === "DONE") {
      onMessageReceived?.({ id: message.id, content: message.content });
    }
  };
  const onError = (data: { error: string }): void => {
    errorMessage = data.error;
    isLoading = false;
    messages = messages.filter((m) => !m.id.startsWith("temp-"));
    render();
  };

  client.on("message:start", onStart);
  client.on("message:chunk", onChunk);
  client.on("message:answer-complete", onAnswerComplete);
  client.on("message:complete", onComplete);
  client.on("message:error", onError);

  // Forward form submit outcomes to the optional callbacks. The success notice is
  // still driven by the collector store below; these are additive (and the only
  // way to observe a failure, which never touches the store).
  const onFormSubmittedEvent = (
    data: AgoClientEvents["form:submitted"],
  ): void => onFormSubmitted?.(data);
  const onFormErrorEvent = (data: AgoClientEvents["form:error"]): void =>
    onFormError?.(data);
  if (onFormSubmitted) client.on("form:submitted", onFormSubmittedEvent);
  if (onFormError) client.on("form:error", onFormErrorEvent);

  // ── Form collectors ────────────────────────────────────────────────
  // Inline configs (with `schema`) install synchronously; name-only entries are
  // fetched from the backend and installed once they resolve.
  const uninstallForms: Array<() => void> = [];
  let formsDestroyed = false;
  // Install a collector and watch its store: when `submitted` flips to true (auto-
  // submit or a manual submit_<name>), append a confirmation notice to the chat.
  const installForm = (collector: FormCollector): void => {
    if (formsDestroyed) return;
    uninstallForms.push(collector.install(client));
    let wasSubmitted = collector.store.get().submitted;
    const unsubscribe = collector.store.subscribe((state) => {
      if (state.submitted && !wasSubmitted) {
        // Echo the server's message when the submit response carries one.
        formNotices.push(resolveNoticeText(state.submitResult));
        render();
      }
      wasSubmitted = state.submitted;
    });
    uninstallForms.push(unsubscribe);
  };
  for (const f of forms ?? []) {
    if (f.schema != null) {
      installForm(createFormCollector(f as CreateFormCollectorOptions));
    } else {
      loadFormCollector(client, f as LoadFormCollectorOptions)
        .then((collector) => installForm(collector))
        // A missing/failed form definition shouldn't break the widget.
        .catch(() => {});
    }
  }

  // ── Send path ──────────────────────────────────────────────────────
  async function send(content: string, files?: File[]): Promise<void> {
    const trimmed = content.trim();
    if ((!trimmed && !files?.length) || isLoading) return;
    onMessageSent?.(trimmed);
    isLoading = true;
    errorMessage = null;

    const stamp = Date.now();
    messages.push({
      id: `temp-user-${stamp}`,
      conversationId: conversationId || "",
      content: trimmed,
      role: "user",
      status: "DONE",
      createdAt: new Date(),
    });
    messages.push({
      id: `temp-assistant-${stamp}`,
      conversationId: conversationId || "",
      content: "",
      role: "assistant",
      status: "IN_PROGRESS",
      createdAt: new Date(),
    });
    render();

    try {
      const response = await client.sendMessage(trimmed, {
        conversationId,
        files,
      });
      if (response.conversationId) {
        if (!conversationId) conversationId = response.conversationId;
        // Cache the thread + its last message time so the front can resume it next
        // reload and slide the TTL window — no backend call needed to check freshness.
        session?.setActiveThread(response.conversationId, response.createdAt);
      }
      // The complete event usually already replaced the placeholder; ensure the
      // user message keeps a stable (non-temp) id and the response is present.
      const userMsg = messages.find((m) => m.id === `temp-user-${stamp}`);
      if (userMsg) {
        userMsg.id = `user-${stamp}`;
        userMsg.conversationId = response.conversationId;
      }
      if (!messages.some((m) => m.id === response.id)) {
        const idx = messages.findIndex(
          (m) => m.id === `temp-assistant-${stamp}`,
        );
        if (idx >= 0) messages[idx] = response;
        else messages.push(response);
      }
      messages = messages.filter((m) => !m.id.startsWith("temp-"));
      isLoading = false;
      render();
      // Keep the exposed thread list current (new thread, bumped last-message date).
      if (loadThreads) void refreshThreads();
    } catch (err) {
      errorMessage =
        err instanceof Error ? err.message : "Failed to send message";
      isLoading = false;
      messages = messages.filter((m) => !m.id.startsWith("temp-"));
      render();
    }
  }

  // Load the visitor's conversation list and publish it on `widget.threads`. The
  // array reference is kept stable (mutated in place) so a held reference stays live.
  async function refreshThreads(): Promise<Conversation[]> {
    try {
      const next = await client.getConversations();
      threads.splice(0, threads.length, ...next);
    } catch {
      // Keep the previous list on failure (offline, transient error).
    }
    return threads;
  }

  // Resuming a thread (restored from storage or passed via `conversationId`):
  // fetch its history so a reload shows the previous messages, not an empty panel.
  async function loadHistory(id: string): Promise<void> {
    try {
      const conv = await client.getConversation(id);
      const history = conv?.messages ?? [];
      // Skip if the user already started a message while we were loading.
      if (history.length > 0 && messages.length === 0) {
        messages = history;
        render();
      }
    } catch {
      // Expired, deleted, or offline — forget it and start fresh on the next send.
      if (messages.length === 0) {
        session?.clear();
        conversationId = undefined;
      }
    }
  }

  render();
  focus();
  if (conversationId) void loadHistory(conversationId);
  if (loadThreads) void refreshThreads();

  return {
    client,
    element: mountInto,
    sendMessage: send,
    ...(isSide
      ? { open: openPanel, close: closePanel, toggle: togglePanel }
      : {}),
    session,
    threads,
    refreshThreads,
    destroy() {
      client.off("message:start", onStart);
      client.off("message:chunk", onChunk);
      client.off("message:answer-complete", onAnswerComplete);
      client.off("message:complete", onComplete);
      client.off("message:error", onError);
      if (onFormSubmitted) client.off("form:submitted", onFormSubmittedEvent);
      if (onFormError) client.off("form:error", onFormErrorEvent);
      formsDestroyed = true;
      uninstallForms.forEach((fn) => fn());
      mountInto.remove();
      launcherBtn?.remove();
      // Only tear down the client if we created it.
      if (!options.client) client.destroy();
    },
  };

  // ── Side-panel open/close (no-ops in inline mode) ──────────────────
  function applyOpenState(): void {
    if (!wrapper) return;
    const hidden =
      placement === "left" ? "translateX(-100%)" : "translateX(100%)";
    wrapper.style.transform = panelOpen ? "translateX(0)" : hidden;
    wrapper.setAttribute("aria-hidden", panelOpen ? "false" : "true");
    if (launcherBtn) launcherBtn.style.display = panelOpen ? "none" : "flex";
  }
  function openPanel(): void {
    panelOpen = true;
    applyOpenState();
    focus();
  }
  function closePanel(): void {
    panelOpen = false;
    applyOpenState();
  }
  function togglePanel(): void {
    if (panelOpen) closePanel();
    else openPanel();
  }

  /** A dependency-free chat-bubble glyph for the launcher button. */
  function buildChatIcon(): SVGSVGElement {
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

  // ── Input builder (closure over send) ──────────────────────────────
  function buildStreamingDots(): HTMLElement {
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
}

// ── Input component ──────────────────────────────────────────────────
interface BuildInputArgs {
  placeholder: string;
  allowFiles: boolean;
  onSend: (content: string, files?: File[]) => void;
}

function buildInput(args: BuildInputArgs): {
  inputRow: HTMLElement;
  getValueAndClear: () => { content: string; files: File[] };
  setDisabled: (disabled: boolean) => void;
  focus: () => void;
} {
  let files: File[] = [];

  const form = document.createElement("form");
  css(form, {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "12px",
    borderTop: `1px solid ${BORDER_COLOR}`,
    backgroundColor: PANEL_BACKGROUND,
  });
  form.className = "ago-chat-input";

  const fileList = div({ display: "flex", flexWrap: "wrap", gap: "6px" });

  const row = div({ display: "flex", gap: "8px", alignItems: "flex-end" });

  const textarea = document.createElement("textarea");
  textarea.placeholder = args.placeholder;
  textarea.rows = 1;
  css(textarea, {
    flex: "1",
    resize: "none",
    padding: "10px 12px",
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: "12px",
    // Keep at >=16px: iOS Safari auto-zooms the page when a focused field is
    // smaller
    fontSize: "16px",
    fontFamily: FONT_VAR,
    lineHeight: "1.4",
    maxHeight: "120px",
    outline: "none",
  });

  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.textContent = "Send";
  css(sendBtn, {
    padding: "10px 16px",
    border: "none",
    borderRadius: "12px",
    backgroundColor: BRAND_COLOR,
    color: BRAND_TEXT_COLOR,
    fontSize: "16px",
    fontWeight: "500",
    cursor: "pointer",
  });

  let fileInput: HTMLInputElement | null = null;
  let attachBtn: HTMLButtonElement | null = null;
  if (args.allowFiles) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    css(fileInput, { display: "none" });
    attachBtn = document.createElement("button");
    attachBtn.type = "button";
    attachBtn.textContent = "📎";
    css(attachBtn, {
      padding: "10px 12px",
      border: `1px solid ${BORDER_COLOR}`,
      borderRadius: "12px",
      backgroundColor: PANEL_BACKGROUND,
      cursor: "pointer",
      fontSize: "14px",
    });
    attachBtn.addEventListener("click", () => fileInput?.click());
    fileInput.addEventListener("change", () => {
      files = [...files, ...Array.from(fileInput?.files ?? [])];
      renderFiles();
    });
  }

  function renderFiles(): void {
    fileList.replaceChildren();
    files.forEach((file, i) => {
      const chip = div({
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 8px",
        backgroundColor: "#f0f4ff",
        border: `1px solid ${BORDER_COLOR}`,
        borderRadius: "8px",
        fontSize: "12px",
      });
      const name = document.createElement("span");
      name.textContent = file.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      css(remove, {
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontSize: "14px",
        lineHeight: "1",
      });
      remove.addEventListener("click", () => {
        files = files.filter((_, idx) => idx !== i);
        renderFiles();
      });
      chip.append(name, remove);
      fileList.appendChild(chip);
    });
  }

  const getValueAndClear = (): { content: string; files: File[] } => {
    const content = textarea.value;
    const collected = files;
    textarea.value = "";
    files = [];
    renderFiles();
    return { content, files: collected };
  };

  const submit = (): void => {
    const { content, files: collected } = getValueAndClear();
    if (content.trim() || collected.length > 0) {
      args.onSend(content.trim(), collected.length > 0 ? collected : undefined);
    }
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  if (attachBtn) row.appendChild(attachBtn);
  row.append(textarea, sendBtn);
  if (fileInput) form.appendChild(fileInput);
  form.append(fileList, row);

  return {
    inputRow: form,
    getValueAndClear,
    setDisabled: (disabled: boolean) => {
      textarea.disabled = disabled;
      sendBtn.disabled = disabled;
      sendBtn.style.opacity = disabled ? "0.6" : "1";
      sendBtn.style.cursor = disabled ? "not-allowed" : "pointer";
    },
    focus: () => textarea.focus(),
  };
}
