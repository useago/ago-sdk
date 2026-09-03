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
import type {
  AgoConfig,
  Conversation,
  FeedbackRating,
  FeedbackReason,
} from "../client/types";
import type { FeedbackLabels } from "./renderFeedback";
import type { ToolCallFormLabels } from "./toolCallLabels";
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
  /** Text color inside assistant messages. Defaults to `text`. (`--ago-agent-bubble-text-color`) */
  agentBubbleText?: string;
  /** User message card background. `placement: "bubble"` only; defaults to white there. (`--ago-user-bubble-background`) */
  userBubbleBg?: string;
  /** User message text color. `placement: "bubble"` only. (`--ago-user-bubble-text-color`) */
  userBubbleText?: string;
  /** Floating launcher circle. `placement: "bubble"` only; defaults to `#007bff`. (`--ago-launcher-background`) */
  launcherBg?: string;
  /** Glyph color on the launcher. (`--ago-launcher-text-color`) */
  launcherText?: string;
  /** Composer send/stop button. `placement: "bubble"` only; defaults to `brand`. (`--ago-send-button-background`) */
  sendBg?: string;
  /** Panel width for `placement: "bubble"`, e.g. `"700px"`. Defaults to `550px`. (`--ago-panel-width`) */
  panelWidth?: string;
}

/** The three screens of the bubble widget (`placement: "bubble"`). */
export type WidgetScreen = "home" | "chat" | "history";

/** A card on the bubble widget's home screen that starts a conversation. */
export interface ConversationStarter {
  /** Text shown on the card. */
  label: string;
  /** Message sent when clicked. Defaults to `label`. */
  message?: string;
}

/**
 * Every string the bubble widget's chrome shows (header, footer, home,
 * history, errors), so a non-English site can translate them. Message-level
 * strings live in {@link WidgetFeedbackOptions.labels}.
 */
export interface WidgetLabels {
  /** Footer tab. */
  home: string;
  /** Footer tab. */
  chats: string;
  /** Header title on the history screen. */
  history: string;
  /** The floating pill on the history screen, and a thread without a title. */
  newConversation: string;
  /** Empty history screen. */
  noHistory: string;
  /** Composer placeholder on the home screen. */
  askQuestion: string;
  /** Accessible name of the header back button. */
  back: string;
  /** Accessible name of the header close button. */
  close: string;
  /** Accessible name of the header new-chat button. */
  newChat: string;
  /** Title of the alert shown on a failed answer. */
  errorTitle: string;
  /** Body of the alert shown on a failed answer. */
  errorDescription: string;
  /** Accessible name of the scroll-to-bottom button. */
  scrollToBottom: string;
  /** Label of the button that hides a file error. */
  dismiss: string;
  /** Accessible name of the attach button. */
  attachFiles: string;
  /** Composer file errors; `{max}` / `{name}` are substituted. */
  tooManyFiles: string;
  invalidFileType: string;
  fileTooLarge: string;
  /** Relative time templates on the history screen; `{n}` is the count. */
  timeAgo: {
    minutes: string;
    hours: string;
    days: string;
    weeks: string;
    months: string;
  };
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

/** Fine-tuning for {@link MountChatWidgetOptions.feedback}. */
export interface WidgetFeedbackOptions {
  /**
   * After a thumbs-down, open the panel asking what went wrong. Default `true`;
   * set `false` to collect thumbs only.
   */
  askWhy?: boolean;
  /**
   * Override any of the row's strings (all English by default). Reason labels
   * can be overridden one by one.
   */
  labels?: Partial<Omit<FeedbackLabels, "reasons">> & {
    reasons?: Partial<Record<FeedbackReason, string>>;
  };
  /**
   * Called after a report was accepted by the API. Fires once per accepted
   * report, so a thumbs-down followed by the panel calls it twice: first for
   * the bare thumb, then for the detailed report.
   */
  onSubmit?: (report: {
    messageId: string;
    rating: FeedbackRating;
    reasons: FeedbackReason[];
    comment?: string;
  }) => void;
  /** Called when a report could not be sent. The row keeps its state. */
  onError?: (error: Error) => void;
}

/**
 * Fine-tuning for the ticket form the agent's `ago_ticketing` tool opens in
 * the conversation (the `form` tool call). The form is always on: a tool call
 * the widget ignored would leave the visitor stuck.
 */
export interface WidgetToolCallFormOptions {
  /** Translate any of the form's strings. */
  labels?: Partial<ToolCallFormLabels>;
  /** Replace the success text once the ticket exists. */
  successMessage?: string;
  /** Replace the "You can find it here:" label before the ticket link. */
  successUrlLabel?: string;
  /**
   * Email of the visitor when the SDK has no identity for them (no `userEmail`
   * or `userJwt` in the client config). When absent, the form asks for it.
   */
  userEmail?: string;
  /** Called once the ticket exists and the tool call is completed. */
  onSubmitted?: (data: {
    toolCallId: string;
    toolName: string;
    mode: "form" | "embed";
    ticket?: { id: string; url?: string };
    values: Record<string, unknown>;
  }) => void;
  /** Called when creating the ticket or completing the tool call failed. */
  onError?: (error: Error) => void;
  /** Called when the visitor starts a new conversation from the blocked composer. */
  onNewConversation?: () => void;
}

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
  /**
   * While the agent is answering, turn the send button into a Stop button that
   * interrupts the turn. Default `true`; set `false` to keep showing a disabled
   * spinner instead.
   */
  allowStop?: boolean;
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
   *
   * `"bubble"` reproduces the hosted embed widget without an iframe: a floating
   * launcher bottom-right, a teaser bubble, and a 550px panel with a home
   * screen, a conversation screen, and a chat history screen. See the
   * "Floating bubble" section of `docs/general/widget.md`.
   */
  placement?: "inline" | "left" | "right" | "bubble";
  /**
   * Width of the side panel for `placement: "left" | "right"` (number → px).
   * Capped at the viewport width so it never overflows on mobile. Ignored when
   * `placement` is `"inline"`. Defaults to `400`; to `550` for `"bubble"`, where
   * it is clamped between 400px and the viewport width minus 40px.
   */
  width?: string | number;
  /**
   * `placement: "bubble"` only. The teaser speech bubble shown above the
   * launcher one second after mount, inviting the visitor in. Pass `false` to
   * skip it. Defaults to `"Hello, how can I help you today?"`.
   */
  prompt?: string | false;
  /**
   * `placement: "bubble"` only. URL of an image (32×32) shown on the launcher
   * instead of the default chat glyph.
   */
  icon?: string;
  /**
   * `placement: "bubble"` only. The same `colors` object as the embed snippet's
   * `window.AGO.colors`, mapped onto {@link WidgetTheme} keys. `theme` wins over
   * it key by key. The header text color is derived for contrast automatically.
   */
  colors?: AgoWidgetColors;
  /** `placement: "bubble"` only. Hide the Home / Chats bottom bar. Defaults to `false`. */
  hideFooter?: boolean;
  /**
   * `placement: "bubble"` only. Markdown shown under the title on the home
   * screen.
   */
  subtitle?: string;
  /**
   * `placement: "bubble"` only. Cards on the home screen that each start a
   * conversation with a preset message.
   */
  conversationStarters?: ConversationStarter[];
  /**
   * `placement: "bubble"` only. On open, reopen the visitor's most recent
   * conversation if its last message is under two hours old. Defaults to `true`.
   */
  autoResume?: boolean;
  /** `placement: "bubble"` only. Translate the chrome's strings. */
  labels?: Partial<Omit<WidgetLabels, "timeAgo">> & {
    timeAgo?: Partial<WidgetLabels["timeAgo"]>;
  };
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
     * Inline placement only: how the card enters full screen.
     * - `"tap"` (default): expands when anywhere on the compact card is tapped
     * - `"focus"`: expands only when the input is tapped/focused.
     * - `"manual"`: expands only via `widget.open()`.
     * Ignored for side placements (driven by the launcher).
     */
    trigger?: "tap" | "focus" | "manual";
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
   * Let the visitor report an answer that did not work: a thumbs up/down row
   * under each finished answer, and after a thumbs-down a small panel to say
   * what went wrong (reason chips plus a free-text comment).
   *
   * `true` turns it on with English labels. Pass an object to translate the
   * strings, skip the "why" panel, or observe what was sent. Off by default.
   *
   * ```ts
   * mountChatWidget("#chat", {
   *   config: { baseUrl: "https://playground.api.useago.com", agent: "generic-guide" },
   *   feedback: true,
   * });
   * ```
   *
   * The thumb is sent as soon as it is clicked, so the signal is never lost if
   * the visitor ignores the panel; the panel then files the detailed report.
   */
  feedback?: boolean | WidgetFeedbackOptions;
  /**
   * The ticket form the agent can open in the conversation (labels, success
   * text, callbacks). See {@link WidgetToolCallFormOptions}.
   */
  toolCallForm?: WidgetToolCallFormOptions;
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
  /** Stop the turn being generated (same path as the Stop button). No-op when idle. */
  stop: () => Promise<void>;
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
  /** `placement: "bubble"` only. The screen currently shown. */
  readonly screen?: WidgetScreen;
  /** `placement: "bubble"` only. Switch to the home, chat, or history screen. */
  showScreen?: (screen: WidgetScreen) => void;
  /** `placement: "bubble"` only. Open a conversation by id on the chat screen. */
  openConversation?: (conversationId: string) => Promise<void>;
  /**
   * Forget the current thread and start over, like the header's new-chat
   * button and the "New conversation" button shown once a ticket exists. The
   * bubble widget also returns to its home screen.
   */
  newConversation: () => void;
  /** Remove listeners, uninstall forms, and clear the DOM. */
  destroy: () => void;
}
