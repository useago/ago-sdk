/**
 * Widget types.
 *
 * Two public surfaces live here:
 * - The `window.AGO` configuration object used by the embeddable chat widget
 *   snippet ({@link AgoWidgetConfig} / {@link AgoWidgetColors}).
 * - The programmatic `mountChatWidget` API ({@link MountChatWidgetOptions} /
 *   {@link ChatWidgetHandle}) for the framework-agnostic widget.
 *
 * @example
 * ```ts
 * import type { AgoWidgetConfig, MountChatWidgetOptions } from "@useago/sdk/widget";
 * ```
 */

import type { AgoClient } from "../client/AgoClient";
import type { AgoConfig, Conversation } from "../client/types";
import type {
  CreateFormCollectorOptions,
  LoadFormCollectorOptions,
} from "../forms/createFormCollector";
import type {
  ConversationSession,
  ConversationSessionOptions,
} from "../state/createConversationSession";

// ── Embed snippet config (window.AGO) ────────────────────────────────

export interface AgoWidgetColors {
  button?: string;
  header?: string;
  agentMessage?: string;
  agentMessageFont?: string;
  background?: string;
  font?: string;
  userMessage?: string;
  userMessageFont?: string;
}

export interface AgoWidgetConfig {
  basepath: string;
  widgetApiKey: string;
  defaultAgent?: string;
  email?: string;
  title?: string;
  icon?: string;
  prompt?: string;
  notifications?: boolean;
  notificationMessage?: string;
  colors?: AgoWidgetColors;
  hideFooter?: boolean;
  jwt?: string;
  authToken?: string;
  permission?: string;
  metadata?: Record<string, unknown>;
}

declare global {
  interface Window {
    AGO: AgoWidgetConfig;
  }
}

// ── mountChatWidget API ──────────────────────────────────────────────

/**
 * Theme overrides for `mountChatWidget`. The keys map to `--ago-*` custom
 * properties (see `THEME_VARS` in `./styles`).
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
 * The greeting shown before any conversation has started. Pass a plain string
 * for the classic centered empty-state placeholder, or an object to control how
 * it is presented:
 *
 * - `mode: "static"` (default): the centered, muted empty-state text. It is not
 *   a real message and disappears once the conversation starts.
 * - `mode: "streaming"`: the greeting is delivered as a real assistant message
 *   bubble, typed out token-by-token, that stays in the thread. It only plays on
 *   a fresh visit (skipped when a thread is being resumed), and `speed` sets the
 *   per-token interval in milliseconds (default `45`).
 */
export type WelcomeMessage =
  | string
  | {
      message: string;
      mode?: "static" | "streaming";
      speed?: number;
      /**
       * Suggested follow-up replies rendered as clickable pills under the
       * greeting once it finishes typing. Only applies to `mode: "streaming"`
       * (the static empty-state has no message bubble to attach them to).
       * Clicking one behaves exactly like a backend follow-up reply: it sends
       * the text as the first message, unless {@link MountChatWidgetOptions.onFollowUpClick}
       * intercepts or disables it.
       */
      followUpReplies?: string[];
    };

/**
 * Options for `mountChatWidget` — the framework-agnostic (pure TS/JS)
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
  /**
   * Greeting shown before any conversation has started. A plain string renders
   * the classic centered empty-state; pass a {@link WelcomeMessage} object with
   * `mode: "streaming"` to type it out as a real assistant bubble on a fresh
   * visit instead.
   */
  welcomeMessage?: WelcomeMessage;
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
   * Tune the automatic mobile full-screen behavior. The widget already fills the
   * screen on small viewports without any config; this object only exists to
   * adjust the breakpoint or hand control back to you.
   *
   * - With `placement: "inline"`: a compact card morphs to a fixed full-screen
   *   sheet (with a logo + close bar) when the input is engaged, and back. The
   *   morph is skipped automatically when the card is already full-bleed (≈full
   *   viewport height), so a dedicated full-page chat is left untouched. The
   *   morph uses the View Transitions API where available and falls back to an
   *   instant swap. `open()`/`close()`/`toggle()` are available on the handle
   *   (no-ops on a desktop viewport).
   * - With `placement: "left" | "right"`: the side panel squares off to a true
   *   full-screen sheet on mobile (the slide-in/out mechanics are unchanged).
   */
  mobile?: {
    /** Max viewport width (px) treated as "mobile". Defaults to `768`. */
    breakpoint?: number;
    /**
     * Inline placement only: how the card enters full screen. `"focus"` (default)
     * expands when the input is tapped/focused; `"manual"` expands only via
     * `widget.open()`. Ignored for side placements (driven by the launcher).
     */
    trigger?: "focus" | "manual";
  };
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
  formSubmittedMessage?:
    | string
    | ((result: unknown) => string | null | undefined);
  /**
   * How clicking a suggested follow-up reply behaves. Defaults to sending the
   * reply as a new user message. Pass a handler to override, or `false` to
   * render the suggestions as non-interactive.
   */
  onFollowUpClick?: ((reply: string) => void) | false;
  /**
   * Called when the panel opens: a side panel opening, or an inline card
   * expanding to full screen on mobile.
   */
  onOpen?: () => void;
  /**
   * Called when the panel closes: a side panel closing, or an inline card
   * collapsing from full screen on mobile.
   */
  onClose?: () => void;
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

/** Handle returned by `mountChatWidget`. */
export interface ChatWidgetHandle {
  /** The AGO client backing the widget. */
  client: AgoClient;
  /** The root element the widget rendered into. */
  element: HTMLElement;
  /** Programmatically send a message (same path as the input). */
  sendMessage: (content: string, files?: File[]) => Promise<void>;
  /**
   * Open / close / toggle the panel. Present for `placement: "left" | "right"`,
   * and for `placement: "inline"` in a browser (where they expand / collapse the
   * mobile full-screen sheet; no-ops on a desktop viewport).
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
