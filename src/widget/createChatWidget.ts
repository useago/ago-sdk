import { AgoClient } from "../client/AgoClient";
import { AgoError } from "../client/errors";
import type {
  AgoClientEvents,
  AgoConfig,
  AgoMessage,
  Conversation,
  FeedbackRating,
  FeedbackReason,
  SdkHomePageConfig,
  SdkWidgetStarter,
  TicketForm,
  ToolCallData,
} from "../client/types";
import {
  createFormCollector,
  loadFormCollector,
  type CreateFormCollectorOptions,
  type FormCollector,
  type LoadFormCollectorOptions,
} from "../forms/createFormCollector";
import { createConversationSession } from "../state/createConversationSession";
import { attachmentsFromFiles } from "../utils/attachments";
import { buildInput } from "./buildInput";
import { isValidHexColor, lightenColor, readableTextColor } from "./colorUtils";
import { buildFooter, type FooterHandle } from "./footer";
import { buildEmbedHeader, type EmbedHeaderHandle } from "./header";
import { addCommentIcon, arrowDownwardIcon } from "./icons";
import { resolveLabels } from "./labels";
import { buildLauncher, type LauncherHandle } from "./launcher";
import { buildEmbedAlert, renderEmbedMessage } from "./renderEmbedMessage";
import {
  createEmbedFormView,
  type EmbedFormState,
  type EmbedFormView,
} from "./renderEmbedForm";
import { renderMarkdown } from "./renderMarkdown";
import {
  createTicketFormState,
  createTicketFormView,
  hydrateTicketFormState,
  renderTicketDenied,
  type TicketFormState,
  type TicketFormView,
} from "./renderTicketForm";
import {
  isTicketingCall,
  latestFormToolCallId,
  renderGenericFormPlaceholder,
  renderStatusMessage,
  submittedTicketOf,
  ticketCreatedInThread,
} from "./renderToolCall";
import {
  DEFAULT_TOOL_CALL_FORM_LABELS,
  type ToolCallFormLabels,
} from "./toolCallLabels";
import {
  createFeedbackState,
  DEFAULT_FEEDBACK_LABELS,
  renderFeedbackRow,
  type FeedbackLabels,
  type MessageFeedbackState,
} from "./renderFeedback";
import { renderFormNotice, renderMessage } from "./renderMessage";
import { buildChatScreen, type ChatScreenHandle } from "./screens/chat";
import { buildHistoryScreen, type HistoryScreenHandle } from "./screens/history";
import { buildHomeScreen, type HomeScreenHandle } from "./screens/home";
import {
  applyTheme,
  BORDER_COLOR,
  colorsToTheme,
  css,
  div,
  EMBED_BACKGROUND,
  ensureKeyframes,
  FONT_VAR,
  HEADER_BACKGROUND,
  HEADER_TEXT_COLOR,
  MESSAGES_BACKGROUND,
  MUTED_TEXT_COLOR,
  NEUTRAL_BORDER,
  PANEL_BACKGROUND,
  PANEL_SHADOW,
  PANEL_WIDTH,
  RADIUS,
  SHADOW_MD,
  TEXT_COLOR,
} from "./styles";
import {
  lockBackgroundScroll,
  unlockBackgroundScroll,
} from "./scrollLock";
import { buildTeaser, type TeaserHandle } from "./teaser";
import { pickResumableThread } from "./threads";
import type {
  ChatWidgetHandle,
  ConversationStarter,
  MountChatWidgetOptions,
  WidgetScreen,
  WidgetTheme,
} from "./types";

// These public types used to be declared in this file; re-exported from their new
// home in `./types` so existing `from "./createChatWidget"` imports keep working.
export type {
  ChatWidgetHandle,
  MountChatWidgetOptions,
  WelcomeMessage,
  WidgetTheme,
} from "./types";

/** Fallback text for the form-submitted notice when the response carries none. */
const DEFAULT_FORM_SUBMITTED_MESSAGE = "Form submitted.";

/**
 * Minimum comfortable touch target, in px. 44 is Apple's HIG floor (Material
 * asks 48). Controls smaller than this are the classic cause of "the close
 * button doesn't work on my phone" reports.
 */
export const TOUCH_TARGET = 44;

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

/** Per-document counter so each mobile-fullscreen widget gets a unique
 * `view-transition-name` (names must be unique across the document). */
let widgetSeq = 0;

/** The hosted widget's teaser text when `prompt` is not set. */
const DEFAULT_PROMPT = "Hello, how can I help you today?";
/** Gap between the launcher and the panel / teaser (frame.js `BUTTON_GAP`). */
const BUBBLE_GAP = 6;
/** The panel never grows taller than this (frame.js `MAX_PANEL_HEIGHT`). */
const BUBBLE_MAX_HEIGHT = 800;
/** Accepted `width` values for the bubble panel (frame.js `PANEL_WIDTH_PATTERN`). */
const PANEL_WIDTH_PATTERN =
  /^(?:\d+(?:\.\d+)?(?:px|rem|em|vw|vmin|vmax|%)|(?:min|max|clamp|calc)\([^;{}]+\))$/i;

/**
 * Normalize the bubble panel width, or null when it is not a usable CSS length
 * (the panel then keeps its 550px default, like the hosted widget).
 */
function resolvePanelWidth(value: string | number): string | null {
  const normalized =
    typeof value === "number" ? `${value}px` : String(value).trim();
  if (!PANEL_WIDTH_PATTERN.test(normalized)) return null;
  if (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    !CSS.supports("width", `min(max(400px, ${normalized}), 100% - 40px)`)
  ) {
    return null;
  }
  return normalized;
}

/** `document` augmented with the View Transitions API (not in all TS DOM libs). */
type DocumentWithVT = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

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
  const placement = options.placement ?? "inline";
  // The bubble placement reproduces the hosted embed widget; several defaults
  // follow that widget rather than the inline card, so they resolve here.
  const isBubble = placement === "bubble";
  const {
    welcomeMessage = "Hello! How can I help you today?",
    allowFiles = false,
    allowStop = true,
    height = 500,
    defaultOpen = false,
    logoUrl,
    showAgentName = false,
    agentBubble = false,
    bubbleStyle = "default",
    showHeader = true,
    forms,
    formSubmittedMessage = DEFAULT_FORM_SUBMITTED_MESSAGE,
    onFollowUpClick,
    onMessageSent,
    onMessageReceived,
    onFormSubmitted,
    onFormError,
    onOpen,
    onClose,
    icon,
    subtitle,
    conversationStarters = [],
    autoResume = true,
    hideFooter = false,
    loadHomeConfig = false,
  } = options;
  const title = options.title ?? (isBubble ? "AGO Chatbot" : "Chat");
  const width = options.width ?? (isBubble ? 550 : 400);
  const loadThreads = options.loadThreads ?? isBubble;
  // The hosted widget always shows thumbs under an answer.
  const feedback = options.feedback ?? isBubble;
  const labels = resolveLabels(options.labels);
  const placeholder =
    options.placeholder ?? (isBubble ? labels.askQuestion : "Type a message...");
  const prompt = options.prompt === undefined ? DEFAULT_PROMPT : options.prompt;
  // `colors` is the embed snippet's palette; `theme` wins over it key by key.
  const theme: WidgetTheme | undefined = isBubble
    ? { ...colorsToTheme(options.colors), ...options.theme }
    : options.theme;

  // Normalize the greeting into a string + presentation. A bare string (or the
  // default) is the classic centered empty-state; the object form opts into the
  // streamed assistant-bubble intro.
  const wm =
    typeof welcomeMessage === "string"
      ? { message: welcomeMessage, mode: "static" as const }
      : welcomeMessage;
  const welcomeText = wm.message;
  const welcomeMode = wm.mode ?? "static";
  const welcomeSpeed = ("speed" in wm && wm.speed) || 45;
  const welcomeFollowUps =
    ("followUpReplies" in wm && wm.followUpReplies) || undefined;

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
  // Side and bubble panels share the fixed-wrapper mechanics (open/close,
  // launcher, modal on mobile); inline is the odd one out.
  const isFixedPanel = isSide || isBubble;
  const showLauncher = isFixedPanel && (options.launcher ?? true);
  let panelOpen = isFixedPanel ? defaultOpen : true;
  // Whether the side panel currently holds the background scroll lock (mobile,
  // full-screen only). Tracked so applyOpenState can reconcile lock/unlock.
  let panelScrollLocked = false;

  // Mobile full-screen is automatic: on small viewports the panel fills the
  // screen with no opt-in. All viewport/transition APIs below are feature-detected
  // so the behavior is inert (and test-safe) where they are missing: jsdom and
  // older browsers have no matchMedia / visualViewport / startViewTransition.
  const mobileBreakpoint =
    options.mobile?.breakpoint ?? (isBubble ? 450 : 768);
  const mobileTrigger = options.mobile?.trigger ?? "tap";
  const hasMatchMedia = typeof window !== "undefined" && !!window.matchMedia;
  // Width alone misses a phone in landscape: an iPhone is 844x390 there, so a
  // `max-width: 768px` query stops matching and the compact layout (keyboard
  // compensation, safe areas, full-screen sheet) switched itself off on the
  // viewport that needs it most. The height clause keeps short landscape
  // viewports compact.
  const mobileMQ = hasMatchMedia
    ? window.matchMedia(
        `(max-width: ${mobileBreakpoint}px), ` +
          `(max-height: 500px) and (orientation: landscape)`,
      )
    : undefined;
  const reduceMotionMQ = hasMatchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : undefined;
  // Whether this instance has any compact-layout behavior at all. Drives
  // listener lifecycle for BOTH placements. `inlineFullscreen` below is
  // narrower: it gates only the inline card -> sheet morph.
  const mobileEnabled = !!mobileMQ;
  // Inline placement morphs to a sheet on mobile; side panels just square off.
  const inlineFullscreen = !isFixedPanel && !!mobileMQ;
  // Identity for this widget's claim on the document scroll lock, so releasing
  // is idempotent and never drops another widget's lock.
  const lockOwner = Symbol("ago-scroll-lock");
  // Set by destroy(). Async continuations (view transitions, rAF) check it so a
  // torn-down widget can't scroll a detached node, re-focus, or re-take a lock.
  let destroyed = false;

  // Optional cross-reload resumption of the visitor's last active thread, keyed off
  // a single stable widget id rather than a per-agent stored conversation id.
  // The bubble widget persists by default: the history screen and the
  // auto-resume both key off the stable widget id the session provides.
  const persist = options.persistConversation ?? (isBubble ? true : undefined);
  const session = persist
    ? createConversationSession(persist === true ? {} : persist)
    : undefined;

  // An explicit conversationId wins; otherwise resume the last active thread from
  // the front-side cache (no backend round-trip), subject to its TTL.
  let conversationId =
    options.conversationId ?? session?.getLastActiveThread() ?? undefined;
  let messages: AgoMessage[] = [];
  // The DOM node currently rendered for each message, so a streamed chunk can
  // swap a single bubble instead of rebuilding the thread.
  let messageNodes: HTMLElement[] = [];
  let isLoading = false;
  let errorMessage: string | null = null;
  // Handle for the streamed-welcome typewriter, so it can be canceled when the
  // user sends a message mid-stream or the widget is destroyed.
  let introTimer: ReturnType<typeof setInterval> | undefined;
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
  if (isBubble) {
    // The bubble wrapper draws the frame; the container is the embed layout
    // root (`flex flex-col h-screen` on the faint blue-white surface).
    css(container, {
      height: "100%",
      width: "100%",
      border: "none",
      borderRadius: "0",
      boxShadow: "none",
      backgroundColor: EMBED_BACKGROUND,
      color: TEXT_COLOR,
      fontSize: "14px",
      lineHeight: "24px",
    });
    // Header text follows the header color for contrast (white unless the
    // host picked a light header), the way the hosted widget derives it.
    if (!theme?.headerText) {
      container.style.setProperty(
        "--ago-header-text-color",
        readableTextColor(theme?.headerBg ?? theme?.brand ?? "#03182f"),
      );
    }
  }

  let header: HTMLDivElement | undefined;
  if (showHeader && !isBubble) {
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
        // 44px is the minimum comfortable touch target (Apple HIG). Negative
        // margins keep the glyph optically where it was so the header does not
        // grow: only the hit area does.
        flexShrink: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: `${TOUCH_TARGET}px`,
        height: `${TOUCH_TARGET}px`,
        margin: `-10px -10px -10px auto`,
        background: "transparent",
        border: "none",
        color: HEADER_TEXT_COLOR,
        fontSize: "22px",
        lineHeight: "1",
        cursor: "pointer",
        padding: "0",
      });
      closeBtn.addEventListener("click", () => closePanel());
      header.appendChild(closeBtn);
    }
  }

  const messagesEl = div({
    flex: "1",
    overflow: "auto",
    // Keep overscroll at the top/bottom of the list from chaining into the page
    // behind the sheet (rubber-banding) on iOS/touch. Layers atop the scroll lock.
    overscrollBehavior: "contain",
    padding: "16px",
    backgroundColor: MESSAGES_BACKGROUND,
  });
  messagesEl.className = "ago-chat-widget__messages";
  // Announce streamed replies to screen readers as they arrive, without stealing
  // focus.
  messagesEl.setAttribute("role", "log");
  messagesEl.setAttribute("aria-live", "polite");
  messagesEl.setAttribute("aria-relevant", "additions text");
  messagesEl.setAttribute("aria-atomic", "false");
  // The bubble look scrolls a transparent column (`py-4`) and centers the
  // messages in a 768px container; the nodes go into `listEl`, the scroll
  // container stays `messagesEl`.
  const listEl = isBubble
    ? div({
        maxWidth: "768px",
        margin: "0 auto",
        padding: "0 8px",
        boxSizing: "border-box",
      })
    : messagesEl;
  if (isBubble) {
    css(messagesEl, { padding: "16px 0", backgroundColor: "transparent" });
    listEl.className = "ago-chat-widget__list";
    messagesEl.appendChild(listEl);
  }

  // ── Follow-the-bottom policy ───────────────────────────────────────
  // The pane follows new content only while the reader is already at the bottom.
  // Scroll away to re-read something and the stream stops yanking you back; a
  // button appears to return. Sending a message always re-attaches.
  const SCROLL_STICK_PX = 48;
  let stickToBottom = true;
  // Re-rendering mutates scrollTop, which fires `scroll`. Those are OUR events,
  // not the reader's, and treating them as intent is how a pane latches itself
  // permanently detached. Suppress tracking around every DOM write.
  let suppressScrollTracking = 0;

  function withoutScrollTracking(mutate: () => void): void {
    suppressScrollTracking++;
    try {
      mutate();
    } finally {
      // Released after the event loop turn so the scroll events the mutation
      // queued are ignored too, not just the synchronous part.
      const release = (): void => {
        suppressScrollTracking--;
      };
      if (typeof queueMicrotask === "function") queueMicrotask(release);
      else release();
    }
  }

  function atBottom(): boolean {
    return (
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <=
      SCROLL_STICK_PX
    );
  }

  const jumpBtn = document.createElement("button");
  jumpBtn.type = "button";
  jumpBtn.className = "ago-chat-widget__jump";
  jumpBtn.setAttribute("aria-label", "Jump to latest message");
  jumpBtn.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
  css(jumpBtn, {
    position: "absolute",
    left: "50%",
    bottom: "12px",
    transform: "translateX(-50%)",
    width: `${TOUCH_TARGET}px`,
    height: `${TOUCH_TARGET}px`,
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: "50%",
    backgroundColor: PANEL_BACKGROUND,
    color: TEXT_COLOR,
    boxShadow: "rgba(15, 15, 15, 0.16) 0px 2px 10px 0px",
    cursor: "pointer",
    zIndex: "2",
  });
  if (isBubble) {
    // `ButtonScrollToBottom`: a white disc that fades rather than unmounts.
    jumpBtn.setAttribute("aria-label", labels.scrollToBottom);
    jumpBtn.replaceChildren(arrowDownwardIcon({ size: 20 }));
    css(jumpBtn, {
      display: "flex",
      width: "36px",
      height: "36px",
      padding: "8px",
      boxSizing: "border-box",
      border: `1px solid ${NEUTRAL_BORDER}`,
      backgroundColor: "#fff",
      boxShadow: SHADOW_MD,
      transition: "opacity 0.3s",
      opacity: "0",
      pointerEvents: "none",
    });
  }
  jumpBtn.addEventListener("click", () => {
    stickToBottom = true;
    withoutScrollTracking(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
    syncJumpBtn();
  });

  function syncJumpBtn(): void {
    if (isBubble) {
      jumpBtn.style.opacity = stickToBottom ? "0" : "1";
      jumpBtn.style.pointerEvents = stickToBottom ? "none" : "auto";
      return;
    }
    jumpBtn.style.display = stickToBottom ? "none" : "flex";
  }

  /** Follow the bottom if the reader hasn't deliberately scrolled away. */
  function autoScroll(): void {
    if (stickToBottom) {
      withoutScrollTracking(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }
    syncJumpBtn();
  }

  messagesEl.addEventListener("scroll", () => {
    if (suppressScrollTracking > 0) return;
    stickToBottom = atBottom();
    syncJumpBtn();
  });

  // The pane is the positioning context for the jump button.
  const messagesWrap = div({
    position: "relative",
    flex: "1",
    display: "flex",
    minHeight: "0",
  });
  messagesWrap.append(messagesEl, jumpBtn);

  const {
    inputRow,
    setDisabled,
    focus,
    restoreDraft,
    setPlaceholder,
    getValueAndClear,
  } = buildInput({
    placeholder,
    allowFiles,
    onSend: (content, files) => void send(content, files),
    onStop: allowStop ? () => void stop() : undefined,
    look: isBubble ? "embed" : "classic",
    labels: isBubble
      ? {
          attachFiles: labels.attachFiles,
          dismiss: labels.dismiss,
          tooManyFiles: labels.tooManyFiles,
          invalidFileType: labels.invalidFileType,
          fileTooLarge: labels.fileTooLarge,
        }
      : undefined,
  });

  ensureKeyframes();

  if (!isBubble) {
    container.append(...(header ? [header] : []), messagesWrap, inputRow);
  }

  // In side mode the panel lives inside a fixed, full-height wrapper pinned to the
  // chosen edge; otherwise it's mounted inline as before. `mountInto` is whatever
  // gets appended to the host element (and removed on destroy).
  let mountInto: HTMLElement = container;
  let wrapper: HTMLDivElement | undefined;
  let launcherBtn: HTMLButtonElement | undefined;
  let launcher: LauncherHandle | undefined;

  // Which viewport edge the side panel/launcher pin to (narrowed for use as a
  // CSS property key); only meaningful when `isFixedPanel`.
  const edge: "left" | "right" = placement === "left" ? "left" : "right";

  // ── Bubble scaffold (screens, chrome) ──────────────────────────────
  let embedHeader: EmbedHeaderHandle | undefined;
  let footer: FooterHandle | undefined;
  let homeScreen: HomeScreenHandle | undefined;
  let historyScreen: HistoryScreenHandle | undefined;
  let chatScreen: ChatScreenHandle | undefined;
  let mainEl: HTMLDivElement | undefined;
  let teaser: TeaserHandle | undefined;
  let teaserTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let screen: WidgetScreen = "home";
  // The screen the current conversation was opened from, for the back chevron.
  let cameFrom: WidgetScreen = "home";
  // Once the visitor navigates on their own, the load-time auto-resume must
  // not yank them elsewhere.
  let navigatedByUser = false;
  // True until the first thread list resolves (history spinner, resume gate).
  let threadsLoading = loadThreads;
  // True while a selected thread's history is being fetched.
  let threadLoading = false;
  // The load-time resume runs at most once.
  let resumeChecked = false;
  // The dashboard's opening message, held until the resume decision is in.
  let widgetStarter: SdkWidgetStarter | undefined;

  if (isBubble) {
    wrapper = div({
      position: "fixed",
      right: "20px",
      bottom: "80px",
      top: `max(40px, calc(100% - ${80 + BUBBLE_MAX_HEIGHT}px))`,
      width: `min(max(400px, ${PANEL_WIDTH}), var(--ago-panel-max, calc(100% - 40px)))`,
      height: "auto",
      borderRadius: "16px",
      boxShadow: PANEL_SHADOW,
      overflow: "hidden",
      transformOrigin: "right bottom",
      zIndex: "2147483000",
      backgroundColor: EMBED_BACKGROUND,
      display: "none",
      fontFamily: FONT_VAR,
    });
    wrapper.className = "ago-chat-widget-bubble";
    wrapper.dataset.agoLayout = "panel";
    // Tokens on the wrapper too: its own width reads `--ago-panel-width`, and
    // the container inherits everything else.
    applyTheme(wrapper, theme);
    if (!theme?.panelWidth) {
      const panelWidth = resolvePanelWidth(width);
      if (panelWidth) {
        wrapper.style.setProperty("--ago-panel-width", panelWidth);
      } else {
        console.warn(
          `[AGO] mountChatWidget width "${String(width)}" is not a valid CSS length, ignoring. ` +
            'Expected e.g. 700 or "45rem". Falling back to 550px.',
        );
      }
    }

    if (showHeader) {
      embedHeader = buildEmbedHeader({
        title,
        labels,
        onBack: () => showScreen(cameFrom, { byUser: true }),
        onNewChat: () => startNewConversation(),
        onClose: () => closePanel(),
      });
      container.appendChild(embedHeader.el);
    }
    mainEl = div({
      flex: "1",
      display: "flex",
      flexDirection: "column",
      minHeight: "0",
      overflow: "hidden",
    });
    mainEl.className = "ago-chat-widget__main";
    container.appendChild(mainEl);
    if (!hideFooter) {
      footer = buildFooter({
        labels,
        onNavigate: (next) => showScreen(next, { byUser: true }),
      });
      container.appendChild(footer.el);
    }

    homeScreen = buildHomeScreen({
      title,
      subtitle,
      starters: conversationStarters,
      onStarter: (starter: ConversationStarter) => {
        homeScreen?.setPending(starter);
        void send(starter.message ?? starter.label, undefined, {
          agentId: starter.agentId,
        }).finally(() => homeScreen?.setPending(null));
      },
    });
    const hostBackground = options.colors?.background;
    historyScreen = buildHistoryScreen({
      labels,
      onSelect: (thread) => {
        navigatedByUser = true;
        cameFrom = "history";
        void openThread(thread.id);
      },
      onNew: () => startNewConversation(),
      hoverBackground:
        hostBackground && isValidHexColor(hostBackground)
          ? lightenColor(hostBackground, 10)
          : undefined,
      customFont: !!options.colors?.font,
    });
    chatScreen = buildChatScreen({ messagesWrap, jumpBtn });

    wrapper.appendChild(container);
    mountInto = wrapper;
  }

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
    launcher = buildLauncher({
      look: isBubble ? "bubble" : "classic",
      edge,
      title,
      icon: isBubble ? icon : logoUrl,
      // The bubble launcher stays on screen while open (desktop) and toggles;
      // the side launcher hides while open, so it only ever opens.
      onClick: () => (isBubble ? togglePanel() : openPanel()),
    });
    launcherBtn = launcher.el;
  }

  // ── Mobile-fullscreen state (inert unless inline in a browser) ──
  const vtName = inlineFullscreen ? `ago-vt-${++widgetSeq}` : "";
  const INLINE_BAR_H = 52;
  let inlineExpanded = false;
  // Full sheet height (px) captured when it expands, before any keyboard opens.
  // The sheet keeps this height the whole time it's up; the keyboard pushes it up
  // rather than resizing it. 0 = not expanded.
  let fullVh = 0;
  // Pending rAF handle for the coalesced viewport sync (see syncVh); 0 = none.
  let vhRaf = 0;
  let mobileBar: HTMLDivElement | undefined;
  let vtStyle: HTMLStyleElement | undefined;
  let inlineSpacer: HTMLDivElement | undefined;
  // Resting container styles we override on expand and restore on collapse.
  const inlineOrig = {
    height: container.style.height,
    border: container.style.border,
    borderRadius: container.style.borderRadius,
    boxShadow: container.style.boxShadow,
  };

  root.appendChild(mountInto);
  if (launcherBtn) root.appendChild(launcherBtn);
  applyOpenState();

  if (isBubble) {
    // The teaser pops in a second after mount, like the hosted widget, unless
    // the panel is already open or the host opted out.
    if (prompt !== false && !panelOpen) {
      teaserTimer = setTimeout(showTeaser, 1000);
    }
    // Escape closes the desktop panel too (the modal handler covers mobile).
    document.addEventListener("keydown", onBubbleKeydown);
    window.addEventListener("resize", onBubbleResize);
  }

  // ── Mobile-fullscreen setup (inline morph; nothing below runs otherwise) ──
  if (inlineFullscreen) {
    mobileBar = buildMobileBar();
    // Keep the bar inside the dialog (container) so its close button stays within
    // the aria-modal subtree and reachable by assistive tech. It is position:fixed,
    // and container never becomes a containing block for fixed descendants, so its
    // on-screen placement and overflow:hidden do not affect the bar. First child so
    // it leads the reading/tab order, matching its visual position at the top.
    container.insertBefore(mobileBar, container.firstChild);
    // Scoped per-instance morph timing. The transition-name is only attached
    // during a transition (see runInlineTransition), so this rule never touches
    // the host page's own view transitions.
    vtStyle = document.createElement("style");
    vtStyle.id = vtName;
    vtStyle.textContent =
      `::view-transition-group(${vtName}),::view-transition-group(${vtName}-bar)` +
      `{animation-duration:0.3s;animation-timing-function:cubic-bezier(0.4,0,0.2,1)}`;
    document.head.appendChild(vtStyle);
    if (mobileTrigger === "focus" || mobileTrigger === "tap") {
      container.addEventListener(
        "pointerdown",
        (e) => {
          if (inlineExpanded || !mobileMQ?.matches) return;
          const onInput = inputRow.contains(e.target as Node);
          if (mobileTrigger === "tap") {
            const el = e.target instanceof Element ? e.target : null;
            if (el?.closest("button,a[href],[role='button']")) return;
          } else if (!onInput) {
            return;
          }
          // Defer the input's native focus until the morph finishes; other
          // regions need no preventDefault (and keep native scroll/selection).
          if (onInput) e.preventDefault();
          void expandInline();
        },
        true,
      );
      // Fallback for keyboard / assistive-tech users (focus without a pointer).
      // Scoped to the input row for both triggers: focus landing on other
      // controls in the thread (follow-up reply pills, source links) must not
      // morph to full screen and eat the click.
      container.addEventListener("focusin", (e) => {
        if (!mobileMQ?.matches) return;
        if (!inputRow.contains(e.target as Node)) return;
        void expandInline();
      });
    }
  }
  // Escape + the Tab trap belong to whatever is currently MODAL, which is a
  // full-screen compact sheet in either placement — not to the inline morph
  // specifically. Registered whenever a compact layout is possible; the handler
  // itself no-ops unless `isModal()` (so a desktop side panel keeps normal Tab
  // behavior and the host page stays keyboard-reachable).
  if (mobileEnabled) {
    document.addEventListener("keydown", onModalKeydown);
  }
  // Re-apply geometry when crossing the breakpoint (side squares off / inline
  // collapses out of full screen). Relevant for both placements when an mq exists.
  if (mobileMQ) {
    mobileMQ.addEventListener("change", onMobileMqChange);
  }

  // ── Rendering ──────────────────────────────────────────────────────
  const followUpEnabled = onFollowUpClick !== false;
  // Default: on a collapsed mobile inline card, promote to the fullscreen sheet
  // first, then send once the morph settles, so the reply and its streaming answer
  // land in the full view (not the tiny card). expandInline() resolves immediately
  // on desktop / when already full screen / on the instant-swap fallback, so those
  // paths just send. Gated on inlineFullscreen so it never touches a side panel
  // (expandInline has no isSide guard). Triggered from the click (not focusin) so
  // it can't eat the tap.
  const sendFollowUp = (reply: string): void => {
    if (inlineFullscreen && mobileMQ?.matches && !inlineExpanded) {
      void expandInline().then(() => send(reply));
    } else {
      void send(reply);
    }
  };
  const followUpHandler =
    onFollowUpClick === false ? undefined : (onFollowUpClick ?? sendFollowUp);

  // ── Feedback ───────────────────────────────────────────────────────
  const feedbackOptions = feedback === true ? {} : feedback || null;
  const feedbackLabels: FeedbackLabels = {
    ...DEFAULT_FEEDBACK_LABELS,
    ...feedbackOptions?.labels,
    reasons: {
      ...DEFAULT_FEEDBACK_LABELS.reasons,
      ...feedbackOptions?.labels?.reasons,
    },
  };
  // Every update re-renders the thread, so the row's state (picked thumb, open
  // panel, half-typed comment) lives here, keyed by message id.
  const feedbackStates = new Map<string, MessageFeedbackState>();

  function buildFeedback(message: AgoMessage): HTMLElement | null {
    if (!feedbackOptions) return null;
    // Only a finished answer can be judged. An empty `conversationId` means the
    // bubble is local (the streamed greeting), so there is nothing to report on.
    if (
      !message.id ||
      !message.conversationId ||
      message.status !== "DONE" ||
      !message.content
    ) {
      return null;
    }

    let state = feedbackStates.get(message.id);
    if (!state) {
      state = createFeedbackState();
      feedbackStates.set(message.id, state);
    }

    /** Resolves true once the API accepted the report. */
    const report = async (
      rating: FeedbackRating,
      details?: { reasons: FeedbackReason[]; comment: string },
    ): Promise<boolean> => {
      try {
        await client.submitFeedback(message.id, rating, details);
        feedbackOptions.onSubmit?.({
          messageId: message.id,
          rating,
          reasons: details?.reasons ?? [],
          comment: details?.comment || undefined,
        });
        return true;
      } catch (error) {
        feedbackOptions.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
        return false;
      }
    };

    return renderFeedbackRow({
      state,
      labels: feedbackLabels,
      // Embed mode is thumbs only, as in the hosted widget.
      askWhy: feedbackOptions.askWhy ?? !isBubble,
      // The thumb goes out on its own so the signal survives a visitor who
      // never fills the panel; the panel then files the detailed report.
      onRate: (rating) => void report(rating),
      onReport: (rating, details) => report(rating, details),
      look: isBubble ? "embed" : "classic",
    });
  }

  // ── Tool calls: the ticket form ────────────────────────────────────
  // The agent's `ago_ticketing` tool opens a contact form in the conversation
  // as a `form` tool call. Its fields come from the tenant's ticket form
  // (`GET /config`), fetched once, the first time such a call shows up. Like
  // the feedback row, every form's state and DOM node live here, keyed by
  // tool call id, so a re-render moves the node instead of rebuilding it and
  // a half-typed description survives every streamed chunk.
  const toolCallFormOptions = options.toolCallForm ?? {};
  const toolCallLabels: ToolCallFormLabels = {
    ...DEFAULT_TOOL_CALL_FORM_LABELS,
    ...toolCallFormOptions.labels,
  };
  const identity = client.getUserIdentity();
  const identityEmail = toolCallFormOptions.userEmail ?? identity.email;
  // No email and no JWT: the SDK cannot name the reporter, so the form asks.
  const requireEmail = !identityEmail && !identity.hasJwt;
  let ticketForm: TicketForm | null = null;
  let ticketFormLoaded = false;
  let ticketFormPromise: Promise<void> | undefined;
  let fileAttachmentsEnabled = false;
  type ToolCallEntry =
    | {
        kind: "ticket";
        state: TicketFormState;
        view: TicketFormView;
        call: ToolCallData;
      }
    | { kind: "embed"; state: EmbedFormState; view: EmbedFormView }
    | { kind: "static"; el: HTMLElement };
  const toolCallViews = new Map<string, ToolCallEntry>();
  // Tool calls whose ticket was created in this session (before a reload
  // would surface it on the persisted call's `data`).
  const submittedToolCalls = new Set<string>();

  function ensureTicketFormConfig(): void {
    if (ticketFormPromise) return;
    ticketFormPromise = client
      .getConfig()
      .then((config) => {
        const permission = config.permissions[0];
        ticketForm = permission?.ticketForm ?? null;
        fileAttachmentsEnabled = !!permission?.fileAttachmentsEnabled;
      })
      .catch(() => {
        ticketForm = null;
      })
      .then(() => {
        ticketFormLoaded = true;
        if (destroyed) return;
        for (const entry of toolCallViews.values()) {
          if (entry.kind !== "ticket") continue;
          if (ticketForm) {
            hydrateTicketFormState(entry.state, entry.call.ticket, ticketForm);
          }
          entry.view.rebuild({ ticketForm, configLoading: false });
        }
      });
  }

  function clearToolCallViews(): void {
    for (const entry of toolCallViews.values()) {
      if (entry.kind === "embed") entry.view.destroy();
    }
    toolCallViews.clear();
    submittedToolCalls.clear();
  }

  function findToolCall(id: string): ToolCallData | undefined {
    for (const message of messages) {
      const call = message.toolCalls?.find((tc) => tc.id === id);
      if (call) return call;
    }
    return undefined;
  }

  /** Build (once) the node for a ticketing `form` tool call. */
  function ticketFormEntry(call: ToolCallData): ToolCallEntry {
    const existing = toolCallViews.get(call.id);
    if (existing) return existing;
    let entry: ToolCallEntry;
    if (call.allowedToCreateTicket === false) {
      const wrap = div({ display: "flex", flexDirection: "column", gap: "16px" });
      wrap.className = "ago-ticket-form ago-ticket-form--denied";
      wrap.appendChild(renderTicketDenied(toolCallLabels.notAllowed));
      entry = { kind: "static", el: wrap };
    } else if (call.mode === "embed") {
      const state: EmbedFormState = {
        status: submittedTicketOf(call) ? "submitted" : "loading",
      };
      const view = createEmbedFormView({
        state,
        embedHtml: call.embedHtml,
        description: call.embedDescription,
        ticket: call.ticket,
        email: identityEmail,
        labels: toolCallLabels,
        message: call.message,
        successMessage: toolCallFormOptions.successMessage,
        onSubmitted: (captured) => {
          submittedToolCalls.add(call.id);
          void client
            .submitToolCallForm(call.id, {
              success: true,
              source: "embed",
              thread_id: conversationId,
              captured_form_data: captured,
            })
            .then((response) => {
              const raw =
                response.ticket ??
                (response.result as { ticket?: { ticket_id?: string; ticket_url?: string } } | undefined)
                  ?.ticket;
              toolCallFormOptions.onSubmitted?.({
                toolCallId: call.id,
                toolName: call.toolName,
                mode: "embed",
                ticket: raw?.ticket_id
                  ? { id: String(raw.ticket_id), url: raw.ticket_url }
                  : undefined,
                values: captured ?? {},
              });
            })
            .catch((error: unknown) => {
              toolCallFormOptions.onError?.(
                error instanceof Error ? error : new Error(String(error)),
              );
            })
            .finally(() => {
              if (!destroyed) render();
            });
        },
      });
      entry = { kind: "embed", state, view };
    } else {
      ensureTicketFormConfig();
      const state = createTicketFormState(call.ticket, ticketForm, identityEmail ?? "");
      const done = submittedTicketOf(call);
      if (done) state.submitted = done;
      const view = createTicketFormView({
        state,
        ticketForm,
        configLoading: !ticketFormLoaded,
        labels: toolCallLabels,
        message: call.message,
        requireEmail,
        allowFiles: allowFiles || fileAttachmentsEnabled,
        successMessage: toolCallFormOptions.successMessage,
        successUrlLabel: toolCallFormOptions.successUrlLabel,
        createTicket: (payload) =>
          client.createTicket({
            subject: payload.subject,
            body: payload.body,
            priority: payload.priority,
            typology: payload.typology,
            conversationId,
            email: payload.email,
            customFields: payload.customFields,
            files: payload.files,
            ticketFormId: payload.ticketFormId,
          }),
        onCreated: (result, formState) => {
          submittedToolCalls.add(call.id);
          const customFields = Object.entries(formState.customFields).map(
            ([id, value]) => ({ id, value }),
          );
          void client
            .submitToolCallForm(call.id, {
              success: true,
              ticket_id: result.id,
              ticket_url: result.url,
              subject: formState.ticket.subject,
              typology: formState.ticket.typology,
              priority: formState.ticket.priority,
              body: formState.ticket.body,
              tag: formState.ticket.tag,
              custom_fields: customFields,
              created_at: new Date().toISOString(),
            })
            .catch((error: unknown) => {
              toolCallFormOptions.onError?.(
                error instanceof Error ? error : new Error(String(error)),
              );
            })
            .finally(() => {
              toolCallFormOptions.onSubmitted?.({
                toolCallId: call.id,
                toolName: call.toolName,
                mode: "form",
                ticket: { id: result.id, url: result.url },
                values: {
                  ...formState.ticket,
                  custom_fields: formState.customFields,
                  email: requireEmail ? formState.email : undefined,
                },
              });
              if (!destroyed) render();
            });
        },
        onError: toolCallFormOptions.onError,
      });
      entry = { kind: "ticket", state, view, call };
    }
    toolCallViews.set(call.id, entry);
    return entry;
  }

  /**
   * The node for one tool call, or null. Only the newest `form` call in the
   * thread renders as a form; older ones become the status line the hosted
   * widget shows in their place. Other types belong to the collapsible
   * "reasoning" section, which embed mode hides.
   */
  function renderToolCall(call: ToolCallData): HTMLElement | null {
    if (call.type !== "form") return null;
    // A form explicitly confined to the collapsible section stays hidden, as
    // in the hosted widget; the ticketing tool always asks for `display`.
    if (call.displayMode === "collapsible") return null;
    const latest = latestFormToolCallId(messages);
    if (latest && latest !== call.id) {
      const newest = findToolCall(latest);
      const rejected =
        !!newest?.askToTalkToHuman && newest.allowedToCreateTicket === false;
      return renderStatusMessage(
        rejected
          ? toolCallLabels.contactFormRejected
          : toolCallLabels.contactFormCreated,
        rejected ? "warning" : "info",
      );
    }
    if (!isTicketingCall(call)) {
      return renderGenericFormPlaceholder(call, toolCallLabels);
    }
    const entry = ticketFormEntry(call);
    return entry.kind === "static" ? entry.el : entry.view.el;
  }

  // The composer is replaced by a card while a form is pending, and by the
  // "ticket created" card (with a way to start over) once the ticket exists.
  let blockedCard: HTMLDivElement | undefined;
  function syncBlockedCard(): void {
    const hasPendingForm = messages.some((m) =>
      m.toolCalls?.some((tc) => tc.type === "form"),
    );
    const ticketCreated =
      submittedToolCalls.size > 0 || ticketCreatedInThread(messages);
    if (!hasPendingForm && !ticketCreated) {
      inputRow.style.display = "";
      blockedCard?.remove();
      return;
    }
    if (!blockedCard) {
      blockedCard = div({
        margin: "12px",
        borderRadius: "24px",
        border: `1px solid ${BORDER_COLOR}`,
        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
        backgroundColor: PANEL_BACKGROUND,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "16px",
        padding: "28px 24px",
        textAlign: "center",
        fontFamily: FONT_VAR,
      });
      blockedCard.className = "ago-chat-blocked";
    }
    blockedCard.replaceChildren();
    const text = document.createElement("p");
    text.textContent = ticketCreated
      ? toolCallLabels.ticketCreatedBlocked
      : toolCallLabels.formPending;
    css(text, {
      color: MUTED_TEXT_COLOR,
      lineHeight: "1.625",
      fontSize: "16px",
      margin: "0",
      whiteSpace: "pre-line",
    });
    blockedCard.appendChild(text);
    if (ticketCreated) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ago-chat-blocked__new";
      css(btn, {
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        borderRadius: "9999px",
        padding: "0 20px",
        minHeight: "44px",
        backgroundColor: "var(--ago-brand-color, #03182f)",
        color: "var(--ago-brand-text-color, #fff)",
        border: "none",
        cursor: "pointer",
        font: "inherit",
        fontSize: "14px",
        fontWeight: "500",
      });
      btn.append(addCommentIcon({ size: 18 }));
      const label = document.createElement("span");
      label.textContent = toolCallLabels.newConversation;
      btn.appendChild(label);
      btn.addEventListener("click", () => {
        startNewConversation();
        toolCallFormOptions.onNewConversation?.();
      });
      blockedCard.appendChild(btn);
    }
    inputRow.style.display = "none";
    inputRow.parentElement?.insertBefore(blockedCard, inputRow);
  }

  /** Build the DOM node for the message at `index`, in the placement's look. */
  function renderOne(index: number): HTMLElement {
    const message = messages[index];
    if (!isBubble) {
      return renderMessage(message, { ...messageOpts(index), renderToolCall });
    }
    return renderEmbedMessage(message, {
      isLast: index === messages.length - 1,
      followUpEnabled,
      followUpHandler,
      agentRowTinted: !!theme?.agentBubbleBg,
      agentRowTextTinted: !!theme?.agentBubbleText,
      labels,
      actionsRow: buildFeedback(message),
      renderToolCall,
    });
  }

  /** Presentation options for the bubble at `index`. Shared by both render paths. */
  function messageOpts(index: number): Parameters<typeof renderMessage>[1] {
    const last = messages.length - 1;
    return {
      isLast: index === last,
      // Last bubble of a same-sender block (gets the iMessage tail).
      isLastOfBlock:
        index === last || messages[index + 1].role !== messages[index].role,
      bubbleStyle,
      showAgentName,
      agentBubble,
      followUpEnabled,
      followUpHandler,
      // On a small viewport let bubbles run wider to reclaim horizontal space.
      isMobile: !!mobileMQ?.matches,
      // Built here, not inside renderMessage: the row is bound to state this
      // closure owns, and the view builders must stay free of it.
      feedbackRow: buildFeedback(messages[index]),
    };
  }

  /**
   * Fast path for a streamed chunk: swap ONLY the bubble being written into.
   *
   * The full `render()` calls `replaceChildren()`, which is wrong to run per
   * token. Under `aria-live` every node becomes an "addition", so a screen
   * reader re-reads the whole conversation on every chunk. It also re-parses
   * the markdown of every message in the thread, on every token.
   *
   * Emptying the pane additionally collapses `scrollHeight` and clamps
   * `scrollTop` to 0, which would latch the follow-the-bottom check off on the
   * first token. That one is already neutralised for both paths by
   * `withoutScrollTracking`, so it is a reason to keep that guard rather than a
   * reason this fast path exists.
   *
   * Returns false when the thread shape means the fast path can't apply, so the
   * caller falls back to a full render.
   */
  function renderStreamingTail(): boolean {
    if (errorMessage || formNotices.length > 0) return false;
    const index = messages.length - 1;
    const message = messages[index];
    if (!message || message.role !== "assistant") return false;
    const current = messageNodes[index];
    if (!current || current.parentNode !== listEl) return false;
    const next = renderOne(index);
    // A ticket form being typed into is moved, not rebuilt; keep the caret
    // where it was through the swap.
    const active = document.activeElement;
    const keepFocus =
      active instanceof HTMLElement && current.contains(active) ? active : null;
    withoutScrollTracking(() => listEl.replaceChild(next, current));
    if (keepFocus && next.contains(keepFocus)) keepFocus.focus({ preventScroll: true });
    messageNodes[index] = next;
    autoScroll();
    return true;
  }

  function render(): void {
    withoutScrollTracking(renderAll);
    autoScroll();
    // Block the input only while the agent is generating the main answer. Once the
    // answer is done (status DONE) it re-enables, even though the stream stays open
    // while follow-up replies are still being generated.
    const last = messages[messages.length - 1];
    const isAnswering =
      isLoading &&
      last?.role === "assistant" &&
      (last.status === "IN_PROGRESS" || last.status === "WAITING_CLIENT");
    // Defer live-region announcements while the answer is being written; the
    // completed answer is announced once, when aria-busy clears.
    messagesEl.setAttribute("aria-busy", isAnswering ? "true" : "false");
    setDisabled(isAnswering);
    syncBlockedCard();
  }

  function renderAll(): void {
    listEl.replaceChildren();
    messageNodes = [];
    if (messages.length === 0) {
      if (isBubble) {
        // The home screen is the empty state; the list only shows a spinner
        // while a selected thread loads.
        if (threadLoading) {
          const wrap = div({
            display: "flex",
            justifyContent: "center",
            padding: "32px 0",
          });
          wrap.className = "ago-chat-widget__thread-loading";
          const spinner = div({
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            borderBottom: "2px solid var(--ago-brand-color, #03182f)",
            animation: "ago-spin 1s linear infinite",
          });
          spinner.setAttribute("role", "status");
          wrap.appendChild(spinner);
          listEl.appendChild(wrap);
        }
      } else if (welcomeMode === "static") {
        // In streaming mode the empty state stays blank: the greeting plays as a
        // real assistant bubble (see streamWelcome), so there are no messages to
        // show only for the brief moment before the first token arrives.
        const welcome = div({
          textAlign: "center",
          color: MUTED_TEXT_COLOR,
          padding: "24px 16px",
          fontSize: "16px",
          lineHeight: "1.5",
        });
        welcome.appendChild(renderMarkdown(welcomeText));
        listEl.appendChild(welcome);
      }
    } else {
      messages.forEach((_, index) => {
        const node = renderOne(index);
        messageNodes[index] = node;
        listEl.appendChild(node);
      });
    }
    // One confirmation per submitted form, below the conversation.
    for (const text of formNotices) {
      listEl.appendChild(renderFormNotice(text));
    }
    if (errorMessage) {
      if (isBubble) {
        listEl.appendChild(buildEmbedAlert(labels.errorTitle, errorMessage));
        return;
      }
      const err = div({
        padding: "10px 14px",
        backgroundColor: "#fef2f2",
        color: "#dc2626",
        borderRadius: "12px",
        marginTop: "8px",
        fontSize: "13px",
        border: "1px solid #fecaca",
      });
      // Announce failures immediately (the surrounding log is only `polite`).
      err.setAttribute("role", "alert");
      err.textContent = errorMessage;
      listEl.appendChild(err);
    }
  }

  // ── Streaming event wiring ─────────────────────────────────────────
  function lastInProgressAssistant(): AgoMessage | undefined {
    // WAITING_CLIENT counts as in-progress: the resumed stream of a paused turn
    // keeps appending its chunks to the same assistant bubble.
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (
        m.role === "assistant" &&
        (m.status === "IN_PROGRESS" || m.status === "WAITING_CLIENT")
      )
        return m;
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
    // Swap just the bubble being written into; fall back to a full render only
    // when the thread shape rules the fast path out (see renderStreamingTail).
    if (!renderStreamingTail()) render();
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
    // it so the user can reply without clicking back in. Skipped on a compact
    // viewport: there, focusing the textarea re-opens the on-screen keyboard
    // after EVERY reply, covering the answer the user is trying to read.
    if (!isCompact()) focus();
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
  // The user stopped the turn. `onComplete` has usually already finalized the
  // bubble as CANCELED; this covers what it can't — a stop that landed before
  // the backend named the message, and a turn stopped while it was paused on a
  // client function (no stream is open then, so no completion event follows).
  const onStopped = (): void => {
    const target = lastInProgressAssistant();
    if (target) {
      if (target.content) target.status = "CANCELED";
      else messages = messages.filter((m) => m !== target);
    }
    isLoading = false;
    render();
  };
  const onError = (data: { error: string }): void => {
    errorMessage = data.error;
    isLoading = false;
    messages = messages.filter((m) => !m.id.startsWith("temp-"));
    render();
  };

  // Type a synthetic greeting out as a real assistant bubble (welcomeMessage in
  // streaming mode). Driven straight off the widget's own `messages`/`render()`
  // rather than client events, so it never fires `onMessageReceived` and the
  // timer can be canceled on send/destroy.
  function streamWelcome(text: string): void {
    const intro: AgoMessage = {
      id: `ago-intro-${Date.now()}`,
      conversationId: "",
      content: "",
      role: "assistant",
      status: "IN_PROGRESS",
      createdAt: new Date(),
    };
    messages.push(intro);
    render();

    const tokens = text.match(/\S+\s*/g) ?? [text];
    let i = 0;
    introTimer = setInterval(() => {
      if (i >= tokens.length) {
        clearInterval(introTimer);
        introTimer = undefined;
        intro.status = "DONE";
        // Reveal suggested replies only once the greeting has finished typing,
        // so the pills don't pop in mid-stream.
        if (welcomeFollowUps) intro.followUpReplies = welcomeFollowUps;
        render();
        return;
      }
      intro.content += tokens[i];
      i++;
      render();
    }, welcomeSpeed);
  }

  // A generated title lands on the thread list live, so the history screen
  // does not show "New conversation" for a thread that just got named.
  const onTitle = (data: AgoClientEvents["conversation:title"]): void => {
    const thread = threads.find((t) => t.id === data.conversationId);
    if (thread) thread.title = data.title;
    if (isBubble && screen === "history") {
      historyScreen?.render({ threads, loading: threadsLoading });
    }
  };

  // A tool call lands mid-stream: attach it to the bubble being written so a
  // ticket form shows up the moment the agent opens it, not at the end of the
  // turn. The final message carries the same call (same id), so the cached
  // form node is reused rather than rebuilt.
  const onToolCall = (call: ToolCallData): void => {
    if (call.type !== "form") return;
    const target =
      lastInProgressAssistant() ??
      [...messages].reverse().find((m) => m.role === "assistant");
    if (!target) return;
    const calls = target.toolCalls ?? [];
    const idx = calls.findIndex((tc) => tc.id === call.id);
    if (idx >= 0) calls[idx] = call;
    else calls.push(call);
    target.toolCalls = calls;
    render();
  };

  client.on("message:start", onStart);
  client.on("message:chunk", onChunk);
  client.on("message:answer-complete", onAnswerComplete);
  client.on("message:complete", onComplete);
  client.on("message:stopped", onStopped);
  client.on("message:error", onError);
  client.on("conversation:title", onTitle);
  client.on("toolCall:received", onToolCall);

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
  async function send(
    content: string,
    files?: File[],
    sendOptions?: { agentId?: string },
  ): Promise<void> {
    const trimmed = content.trim();
    if ((!trimmed && !files?.length) || isLoading) return;
    // Sending from the home screen (composer or a starter card) lands the
    // exchange on the conversation screen.
    if (isBubble && screen !== "chat") {
      cameFrom = "home";
      showScreen("chat", { byUser: true });
    }
    onMessageSent?.(trimmed);
    isLoading = true;
    errorMessage = null;
    // Sending is an explicit "show me the latest" gesture: re-attach the pane to
    // the bottom even if the reader had scrolled up to re-read something.
    stickToBottom = true;

    // If the streamed greeting is still typing, stop it and finalize what's there
    // so it doesn't interleave with the user's turn. An empty intro is dropped.
    if (introTimer) {
      clearInterval(introTimer);
      introTimer = undefined;
      const intro = messages.find((m) => m.id.startsWith("ago-intro-"));
      if (intro && !intro.content) {
        messages = messages.filter((m) => m !== intro);
      } else if (intro) {
        intro.status = "DONE";
      }
    }

    const stamp = Date.now();
    messages.push({
      id: `temp-user-${stamp}`,
      conversationId: conversationId || "",
      content: trimmed,
      role: "user",
      status: "DONE",
      attachments:
        files && files.length > 0 ? attachmentsFromFiles(files) : undefined,
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
        // A dashboard starter can name the agent that answers it; without one
        // the client falls back to the configured default.
        ...(sendOptions?.agentId ? { agentId: sendOptions.agentId } : {}),
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
      // A turn stopped before the backend named the message has no id and no
      // text: the placeholder below is simply dropped, leaving the user's
      // message and no empty assistant bubble.
      if (response.id && !messages.some((m) => m.id === response.id)) {
        const idx = messages.findIndex(
          (m) => m.id === `temp-assistant-${stamp}`,
        );
        if (idx >= 0) messages[idx] = response;
        else messages.push(response);
      }
      messages = messages.filter((m) => !m.id.startsWith("temp-"));
      // A paused turn (WAITING_CLIENT) is not over: the SDK is about to resume it
      // and onComplete will clear the loading state when the turn really ends.
      if (response.status !== "WAITING_CLIENT") {
        isLoading = false;
      }
      render();
      // Keep the exposed thread list current (new thread, bumped last-message date).
      if (loadThreads) void refreshThreads();
    } catch (err) {
      errorMessage =
        err instanceof Error ? err.message : "Failed to send message";
      isLoading = false;
      messages = messages.filter((m) => !m.id.startsWith("temp-"));
      // The composer was cleared the moment the message was submitted, and the
      // optimistic bubble has just been dropped too. Without putting the text
      // back, the user's message is gone for good and they have to retype it.
      restoreDraft(trimmed, files);
      render();
    }
  }

  // Stop the turn being generated (the Stop button, and `widget.stop()`). The
  // client closes the stream and tells the backend to stop; the partial answer
  // stays on screen. `onComplete` fires with status CANCELED and clears the
  // loading state, so there is nothing to unwind here.
  async function stop(): Promise<void> {
    if (!isLoading) return;
    await client.stop();
  }

  // Load the visitor's conversation list and publish it on `widget.threads`. The
  // array reference is kept stable (mutated in place) so a held reference stays live.
  async function refreshThreads(): Promise<Conversation[]> {
    try {
      const { data: next } = await client.getConversations();
      threads.splice(0, threads.length, ...next);
    } catch {
      // Keep the previous list on failure (offline, transient error).
    }
    threadsLoading = false;
    if (isBubble && !destroyed) {
      if (screen === "history") {
        historyScreen?.render({ threads, loading: false });
      }
      tryAutoResume();
    }
    return threads;
  }

  // Resuming a thread (restored from storage or passed via `conversationId`):
  // fetch its history so a reload shows the previous messages, not an empty panel.
  async function loadHistory(id: string): Promise<void> {
    try {
      const conv = await client.getConversation(id);
      // The visitor moved on (new conversation, another thread) meanwhile.
      if (conversationId !== id) return;
      const history = conv?.messages ?? [];
      threadLoading = false;
      // Skip if the user already started a message while we were loading.
      if (history.length > 0 && messages.length === 0) {
        messages = history;
        render();
      } else if (isBubble) {
        render();
      }
      if (isBubble) session?.setActiveThread(id, conv.lastMessageDate);
    } catch {
      if (conversationId !== id) return;
      threadLoading = false;
      // Expired, deleted, or offline — forget it and start fresh on the next send.
      if (messages.length === 0) {
        session?.clear();
        conversationId = undefined;
        if (isBubble) {
          if (screen === "chat") showScreen("home");
          render();
        }
      }
    }
  }

  // ── Bubble screens and navigation ──────────────────────────────────
  /** Show one of the three bubble screens and update the header/footer. */
  function showScreen(
    next: WidgetScreen,
    opts?: { byUser?: boolean },
  ): void {
    if (!isBubble || !mainEl || !homeScreen || !chatScreen || !historyScreen) {
      return;
    }
    if (opts?.byUser) navigatedByUser = true;
    screen = next;
    // One composer, moved to whichever screen shows it.
    if (next === "home") {
      homeScreen.composerSlot.appendChild(inputRow);
      setPlaceholder(placeholder);
    } else if (next === "chat") {
      chatScreen.composerSlot.appendChild(inputRow);
      // No placeholder inside a thread (reference `data-placeholder=""`).
      setPlaceholder("");
    }
    const el =
      next === "home"
        ? homeScreen.el
        : next === "chat"
          ? chatScreen.el
          : historyScreen.el;
    mainEl.replaceChildren(el);
    if (next === "history") {
      historyScreen.render({ threads, loading: threadsLoading });
    }
    if (next === "chat") {
      stickToBottom = true;
      autoScroll();
    }
    embedHeader?.update({ screen: next });
    footer?.setActive(next);
    footer?.setVisible(next !== "chat");
  }

  /** Open a thread on the chat screen and load its history. */
  async function openThread(id: string): Promise<void> {
    if (!isBubble) return;
    if (isLoading) await stop();
    conversationId = id;
    messages = [];
    errorMessage = null;
    formNotices.length = 0;
    feedbackStates.clear();
    clearToolCallViews();
    threadLoading = true;
    showScreen("chat");
    render();
    await loadHistory(id);
  }

  /**
   * Forget the current thread and start over: the bubble widget returns to
   * its home screen, the others clear the thread in place.
   */
  function startNewConversation(): void {
    if (isLoading) void stop();
    conversationId = undefined;
    messages = [];
    errorMessage = null;
    formNotices.length = 0;
    feedbackStates.clear();
    clearToolCallViews();
    threadLoading = false;
    session?.clear();
    getValueAndClear();
    homeScreen?.setPending(null);
    cameFrom = "home";
    if (isBubble) showScreen("home", { byUser: true });
    render();
  }

  /**
   * The load-time resume, driven by the server's thread list: reopen the most
   * recent thread if its last message is under two hours old. Runs once, and
   * only on the untouched home screen, so a visitor who already navigated is
   * never redirected.
   */
  function tryAutoResume(): void {
    if (!isBubble || resumeChecked) return;
    resumeChecked = true;
    if (
      !autoResume ||
      navigatedByUser ||
      screen !== "home" ||
      messages.length > 0 ||
      conversationId
    ) {
      maybeSendWidgetStarter();
      return;
    }
    const thread = pickResumableThread(threads);
    if (thread) void openThread(thread.id);
    // Nothing to resume: this is the fresh visit the widget starter is for.
    maybeSendWidgetStarter();
  }

  /**
   * The dashboard's home screen content (`loadHomeConfig`), fetched once on
   * mount. The home screen is already up with whatever the options set, so
   * this is a silent upgrade: each part is replaced only when the dashboard
   * has a value for it, and a failed request leaves the options in place.
   */
  async function applyHomeConfig(): Promise<void> {
    let home: SdkHomePageConfig | undefined;
    try {
      const config = await client.getConfig();
      // The hosted widget reads the first permission's home page too.
      home = config.permissions[0]?.homePage;
    } catch {
      return;
    }
    if (destroyed || !home) return;
    homeScreen?.setContent({
      title: home.title || undefined,
      subtitle: home.subtitle || undefined,
      starters: home.starters.length
        ? home.starters.map((s) => ({
            label: s.label,
            message: s.message,
            agentId: s.agentId,
          }))
        : undefined,
    });
    if (home.widgetStarter) {
      widgetStarter = home.widgetStarter;
      maybeSendWidgetStarter();
    }
  }

  /**
   * Send the dashboard's widget starter, the opening message the agent makes
   * by itself. Fresh visits only: it waits for the load-time resume to decide
   * (a resumed thread cancels it), and never fires once the visitor has
   * navigated or written anything.
   */
  function maybeSendWidgetStarter(): void {
    const starter = widgetStarter;
    if (!starter || destroyed) return;
    // Nobody has opened the panel: hold it rather than spend a turn on a
    // visitor who never clicks the launcher. openPanel() calls back here.
    if (!panelOpen) return;
    // The thread list is still in flight: the resume may yet reopen a thread,
    // and tryAutoResume calls back here once it has decided.
    if (threadsLoading && !resumeChecked) return;
    widgetStarter = undefined;
    if (
      navigatedByUser ||
      conversationId ||
      messages.length > 0 ||
      isLoading ||
      screen !== "home"
    ) {
      return;
    }
    void send(starter.message, undefined, { agentId: starter.agentId });
  }

  function showTeaser(): void {
    teaserTimer = undefined;
    if (destroyed || panelOpen || prompt === false || teaser) return;
    teaser = buildTeaser({
      text: prompt,
      edge,
      onOpen: () => openPanel(),
      onDismiss: () => {
        teaser = undefined;
      },
    });
    root.appendChild(teaser.el);
    syncPositionsToLauncher();
  }

  /**
   * Derive the panel and teaser position from the launcher's used position
   * (frame.js `syncPositionsToButton`), so a host that moves the launcher with
   * CSS moves the panel with it. Computed style, not the bounding rect: the
   * rect includes the hover scale and would jitter.
   */
  function syncPositionsToLauncher(): void {
    if (!isBubble || !wrapper || !launcherBtn || isCompact()) return;
    if (!launcherBtn.offsetHeight) return;
    const style = getComputedStyle(launcherBtn);
    const launcherBottom = parseFloat(style.bottom);
    const launcherRight = parseFloat(style.right);
    if (Number.isNaN(launcherBottom) || Number.isNaN(launcherRight)) return;
    const bottom =
      Math.round(launcherBottom + launcherBtn.offsetHeight) + BUBBLE_GAP;
    const right = Math.round(launcherRight);
    const targets: HTMLElement[] = [wrapper];
    if (teaser) targets.push(teaser.el);
    for (const el of targets) {
      el.style.setProperty("bottom", `${bottom}px`, "important");
      el.style.setProperty("right", `${right}px`, "important");
    }
    wrapper.style.setProperty(
      "top",
      `max(40px, calc(100% - ${bottom + BUBBLE_MAX_HEIGHT}px))`,
      "important",
    );
    wrapper.style.setProperty("--ago-panel-max", `calc(100% - ${right + 20}px)`);
  }

  function onBubbleKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape" || !panelOpen || e.defaultPrevented) return;
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    // On a compact viewport the modal handler already closes it.
    if (isModal()) return;
    closePanel();
  }

  function onBubbleResize(): void {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      if (destroyed) return;
      syncPositionsToLauncher();
      homeScreen?.syncColumns();
    }, 150);
  }

  if (isBubble) {
    showScreen("home");
    render();
    if (loadHomeConfig) void applyHomeConfig();
    if (options.conversationId) {
      // An explicit thread opens straight into the conversation, and counts
      // as the visitor's own navigation (no load-time redirect on top).
      navigatedByUser = true;
      resumeChecked = true;
      void openThread(options.conversationId);
    } else if (conversationId && autoResume) {
      // The front-side cache (same two-hour rule) resumes without a round-trip.
      resumeChecked = true;
      void openThread(conversationId);
    } else {
      conversationId = undefined;
    }
  } else {
    render();
    // On a mobile viewport the inline card is a compact launcher; don't auto-focus
    // it (that would pop the keyboard and morph to full screen on load). Focus
    // happens on genuine user engagement instead (pointerdown / focusin).
    if (!(inlineFullscreen && mobileMQ?.matches)) focus();
    // Resuming a thread loads its real history; otherwise (a fresh visit) play the
    // streamed greeting if one was configured. `conversationId` is the fresh-visit
    // gate: it's set only when an explicit id or a stored last-active thread exists.
    if (conversationId) void loadHistory(conversationId);
    else if (welcomeMode === "streaming") streamWelcome(welcomeText);
  }
  if (loadThreads) void refreshThreads();

  const handle: ChatWidgetHandle = {
    client,
    element: mountInto,
    sendMessage: send,
    stop,
    ...(isFixedPanel || inlineFullscreen
      ? { open: openCtl, close: closeCtl, toggle: toggleCtl }
      : {}),
    newConversation: startNewConversation,
    ...(isBubble
      ? {
          showScreen: (next: WidgetScreen) => showScreen(next, { byUser: true }),
          openConversation: (id: string) => {
            navigatedByUser = true;
            return openThread(id);
          },
        }
      : {}),
    session,
    threads,
    refreshThreads,
    destroy() {
      // Idempotent: a second destroy() must not re-run teardown (and must not
      // hand the scroll lock a second release).
      if (destroyed) return;
      destroyed = true;
      if (introTimer) clearInterval(introTimer);
      if (teaserTimer) clearTimeout(teaserTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
      teaser?.remove();
      client.off("message:start", onStart);
      client.off("message:chunk", onChunk);
      client.off("message:answer-complete", onAnswerComplete);
      client.off("message:complete", onComplete);
      client.off("message:stopped", onStopped);
      client.off("message:error", onError);
      client.off("conversation:title", onTitle);
      client.off("toolCall:received", onToolCall);
      clearToolCallViews();
      if (onFormSubmitted) client.off("form:submitted", onFormSubmittedEvent);
      if (onFormError) client.off("form:error", onFormErrorEvent);
      formsDestroyed = true;
      uninstallForms.forEach((fn) => fn());
      mountInto.remove();
      launcherBtn?.remove();
      mobileBar?.remove();
      document.removeEventListener("keydown", onBubbleKeydown);
      window.removeEventListener("resize", onBubbleResize);
      vtStyle?.remove();
      inlineSpacer?.remove();
      mobileMQ?.removeEventListener("change", onMobileMqChange);
      // Unconditional teardown. These used to be gated on `inlineFullscreen`,
      // so a side-placement widget leaked a document keydown listener (which
      // retains the whole widget closure) plus its two visualViewport listeners
      // on every destroy. removeEventListener on a listener that was never added
      // is a no-op, so gating buys nothing and costs a leak.
      document.removeEventListener("keydown", onModalKeydown);
      removeViewportListeners();
      panelScrollLocked = false;
      // Idempotent by construction: releases only if this widget still holds it.
      unlockBackgroundScroll(lockOwner);
      // Only tear down the client if we created it.
      if (!options.client) client.destroy();
    },
  };
  // A live getter: an object-literal getter would be flattened to a snapshot
  // by the spreads above.
  if (isBubble) {
    Object.defineProperty(handle, "screen", {
      get: () => screen,
      enumerable: true,
    });
  }
  return handle;

  // ── Side-panel open/close (no-ops in inline mode) ──────────────────
  function applyOpenState(): void {
    if (!wrapper) return;
    if (isBubble) {
      applyBubbleGeometry();
    } else {
      // Square the side panel off to a full-screen sheet on mobile (automatic; no
      // opt-in). On viewports wider than the breakpoint it keeps its resting width
      // and inner divider. Slide mechanics below are unchanged.
      const sideBorder = edge === "left" ? "border-right" : "border-left";
      if (mobileMQ?.matches) {
        wrapper.style.width = "100%";
        container.style.borderRadius = "0";
        container.style.removeProperty(sideBorder);
      } else {
        wrapper.style.width = typeof width === "number" ? `${width}px` : width;
        container.style.setProperty(sideBorder, `1px solid ${BORDER_COLOR}`);
      }
      const hidden =
        placement === "left" ? "translateX(-100%)" : "translateX(100%)";
      wrapper.style.transform = panelOpen ? "translateX(0)" : hidden;
      if (launcherBtn) launcherBtn.style.display = panelOpen ? "none" : "flex";
    }
    wrapper.setAttribute("aria-hidden", panelOpen ? "false" : "true");
    // Everything below is reconciled from `isModal()` rather than set at each
    // call site, so open/close, breakpoint crossings and rotation all converge
    // on the same state instead of each having to remember the full checklist.
    const modal = isModal();
    if (modal !== panelScrollLocked) {
      panelScrollLocked = modal;
      if (modal) {
        // A full-screen panel is a dialog: announce it, and keep the on-screen
        // keyboard from covering the composer (the layout viewport does not
        // shrink on iOS, so `bottom: 0` would otherwise sit under the keyboard).
        container.setAttribute("role", "dialog");
        container.setAttribute("aria-modal", "true");
        container.setAttribute("aria-label", title);
        // Programmatically focusable (never a tab stop) so openPanel can put
        // focus inside the dialog without opening the keyboard.
        container.tabIndex = -1;
        container.style.paddingBottom = "env(safe-area-inset-bottom)";
        lockBackgroundScroll(lockOwner);
        fullVh = viewportHeight();
        applyVh();
        addViewportListeners();
      } else {
        removeViewportListeners();
        resetVh();
        fullVh = 0;
        container.removeAttribute("role");
        container.removeAttribute("aria-modal");
        container.removeAttribute("aria-label");
        container.style.removeProperty("padding-bottom");
        unlockBackgroundScroll(lockOwner);
      }
    }
  }
  /**
   * The bubble panel's geometry: the hosted widget's fixed bottom-right card on
   * desktop, a full-screen sheet on a compact viewport (launcher hidden, safe
   * areas padded). The panel collapses to nothing while closed.
   */
  function applyBubbleGeometry(): void {
    if (!wrapper) return;
    wrapper.style.display = panelOpen ? "block" : "none";
    launcher?.setOpen(panelOpen);
    const compact = isCompact();
    if (launcherBtn) {
      launcherBtn.style.display = compact && panelOpen ? "none" : "flex";
    }
    if (compact) {
      for (const prop of ["bottom", "right", "top", "--ago-panel-max"]) {
        wrapper.style.removeProperty(prop);
      }
      css(wrapper, {
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        width: "100dvw",
        maxWidth: "100vw",
        height: "var(--ago-vh, 100dvh)",
        borderRadius: "0",
        paddingTop: "env(safe-area-inset-top, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
        boxSizing: "border-box",
      });
      wrapper.dataset.agoLayout = "fullscreen";
      if (panelOpen) {
        teaser?.remove();
        teaser = undefined;
      }
    } else {
      for (const prop of [
        "left",
        "max-width",
        "padding-top",
        "padding-bottom",
        "padding-left",
        "padding-right",
      ]) {
        wrapper.style.removeProperty(prop);
      }
      css(wrapper, {
        right: "20px",
        bottom: "80px",
        top: `max(40px, calc(100% - ${80 + BUBBLE_MAX_HEIGHT}px))`,
        width: `min(max(400px, ${PANEL_WIDTH}), var(--ago-panel-max, calc(100% - 40px)))`,
        height: "auto",
        borderRadius: "16px",
      });
      wrapper.dataset.agoLayout = "panel";
      syncPositionsToLauncher();
    }
  }
  function openPanel(): void {
    panelOpen = true;
    // The teaser has done its job once the panel opens.
    if (teaserTimer) {
      clearTimeout(teaserTimer);
      teaserTimer = undefined;
    }
    teaser?.remove();
    teaser = undefined;
    applyOpenState();
    // On a compact viewport, focusing the textarea would pop the on-screen
    // keyboard immediately and eat half the panel before anything is read. Move
    // focus into the dialog itself instead, so screen-reader and keyboard users
    // still land inside it (the launcher they clicked is now display:none, so
    // doing nothing would drop focus to <body> and restart Tab at the top of the
    // host page). On desktop, keep focusing the input as before.
    if (isCompact()) container.focus({ preventScroll: true });
    else focus();
    // The hosted widget only creates its iframe on the first open, so its
    // opening message costs nothing on a page nobody clicks. Same here.
    maybeSendWidgetStarter();
    onOpen?.();
  }
  function closePanel(): void {
    panelOpen = false;
    applyOpenState();
    onClose?.();
  }
  function togglePanel(): void {
    if (panelOpen) closePanel();
    else openPanel();
  }

  // ── Mobile fullscreen (inline card ↔ full-screen sheet) ────────────
  function openCtl(): void {
    if (isFixedPanel) openPanel();
    else void expandInline();
  }
  function closeCtl(): void {
    if (isFixedPanel) closePanel();
    else void collapseInline();
  }
  function toggleCtl(): void {
    if (isFixedPanel) togglePanel();
    else if (inlineExpanded) void collapseInline();
    else void expandInline();
  }
  // Whether the viewport is currently in the compact (phone-shaped) layout.
  function isCompact(): boolean {
    return !!mobileMQ?.matches;
  }
  // THE modality predicate. Everything that must only happen while the widget
  // genuinely covers the viewport hangs off this one function: background scroll
  // lock, `role="dialog"` + `aria-modal`, the Tab trap, and Escape.
  //
  // Deliberately NOT `isSide && panelOpen`: a DESKTOP side panel is not modal.
  // The host page is still visible and usable beside it, so trapping Tab there
  // would strand keyboard users and `aria-modal` would lie to assistive tech.
  function isModal(): boolean {
    return isCompact() && (isFixedPanel ? panelOpen : inlineExpanded);
  }
  // Visible, tabbable elements inside the modal surface (skips display:none
  // subtrees like the hidden in-card header; getClientRects covers fixed elements
  // such as the bar, which offsetParent would miss).
  function modalFocusables(): HTMLElement[] {
    const sel =
      "a[href],button:not([disabled]),textarea:not([disabled])," +
      'input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll<HTMLElement>(sel)).filter(
      (el) => el.getClientRects().length > 0,
    );
  }
  function onModalKeydown(e: KeyboardEvent): void {
    if (!isModal()) return;
    if (e.key === "Escape") {
      if (isFixedPanel) closePanel();
      else void collapseInline();
      return;
    }
    // Trap Tab within the modal sheet (aria-modal alone does not stop keyboard
    // focus from leaving into the scroll-locked background).
    if (e.key !== "Tab") return;
    const focusables = modalFocusables();
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !container.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (
      !e.shiftKey &&
      (active === last || !container.contains(active))
    ) {
      e.preventDefault();
      first.focus();
    }
  }
  function onMobileMqChange(e: MediaQueryListEvent): void {
    if (isFixedPanel) applyOpenState();
    else if (!e.matches && inlineExpanded) void collapseInline();
    // Bubble max-width depends on the breakpoint (see renderMessage isMobile), so
    // reflow the thread when it changes (rotation / resize across the breakpoint).
    render();
  }

  function viewportHeight(): number {
    return window.visualViewport?.height ?? window.innerHeight;
  }
  // Keep the expanded sheet's bottom (the input) above the on-screen keyboard
  // *without resizing the sheet*. Resizing the height as the keyboard slides means
  // two properties (height + top) change across separate viewport events that
  // don't share a frame, so for one frame the sheet is mis-sized and its content
  // flashes off-screen. Instead the sheet keeps its full captured height and we
  // only shift it up by the keyboard overlap via a negative `top`. `top` (unlike
  // `transform`) doesn't make the sheet a containing block, so the fixed top bar
  // stays put. One property, read from one snapshot, so there's no flashing frame.
  //
  // The side panel needs the same protection but a DIFFERENT write. Its
  // positioned element is `wrapper` (`position: fixed; top: 0; bottom: 0`);
  // `container` is a plain static flex child of it, so writing `top` on
  // `container` (the inline path's move) has no effect at all there. The side
  // panel instead raises the wrapper's `bottom` by the keyboard overlap, which
  // shrinks it clear of the keyboard, and sets `top` to the visible-viewport
  // offset so it stays put when the page scrolls under it. Two writes rather
  // than the inline path's one, but both come from the same snapshot in the
  // same synchronous block, so they still land in a single repaint and the
  // flashing-frame problem the coalescing exists to prevent does not return.
  function applyVh(): void {
    const vv = window.visualViewport;
    const top = vv?.offsetTop ?? 0;
    const h = vv?.height ?? fullVh;
    if (isFixedPanel) {
      if (!wrapper) return;
      // Layout viewport height: unchanged by the iOS keyboard, which is exactly
      // why `bottom: 0` ends up underneath it and has to be corrected here.
      const layoutH = window.innerHeight || fullVh;
      const overlap = Math.max(0, layoutH - (top + h));
      wrapper.style.bottom = `${overlap}px`;
      wrapper.style.top = `${top}px`;
      return;
    }
    // How far the keyboard covers the bottom of the full-height sheet. Clamped to
    // <= 0 so a keyboardless viewport leaves the sheet flush at the top.
    const shift = Math.min(0, top + h - fullVh);
    container.style.top = `${shift}px`;
    // The bar tracks the visible-viewport top so it stays on screen if the page
    // itself scrolls under the sheet (offsetTop > 0).
    if (mobileBar) mobileBar.style.top = `${top}px`;
  }
  /** Undo `applyVh`'s side-panel writes so a desktop panel keeps its CSS geometry. */
  function resetVh(): void {
    if (isFixedPanel && wrapper) {
      wrapper.style.removeProperty("bottom");
      wrapper.style.removeProperty("top");
      // The bubble panel re-derives its desktop anchors from the launcher.
      if (isBubble && !destroyed) applyBubbleGeometry();
    }
  }
  // The keyboard opening fires a burst of resize + scroll events. Coalesce them
  // into one rAF so `applyVh` reads a single settled snapshot and writes once.
  function syncVh(): void {
    if (vhRaf) return;
    vhRaf = requestAnimationFrame(() => {
      vhRaf = 0;
      // A widget torn down between the event and the frame must not write
      // geometry (or, for the side panel, resurrect styles on a detached node).
      if (destroyed) return;
      applyVh();
    });
  }
  function addViewportListeners(): void {
    window.visualViewport?.addEventListener("resize", syncVh);
    window.visualViewport?.addEventListener("scroll", syncVh);
  }
  function removeViewportListeners(): void {
    window.visualViewport?.removeEventListener("resize", syncVh);
    window.visualViewport?.removeEventListener("scroll", syncVh);
    // Drop any queued frame so it can't re-write stale geometry after collapse.
    if (vhRaf) {
      cancelAnimationFrame(vhRaf);
      vhRaf = 0;
    }
  }
  /** Force the pane to the bottom and re-attach it (used when the sheet opens). */
  function scrollMessagesToEnd(): void {
    stickToBottom = true;
    autoScroll();
  }

  // The slim top bar (optional logo + close) shown only while expanded.
  function buildMobileBar(): HTMLDivElement {
    const bar = div({
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      height: `calc(${INLINE_BAR_H}px + env(safe-area-inset-top))`,
      display: "none",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "env(safe-area-inset-top) 14px 0",
      backgroundColor: PANEL_BACKGROUND,
      borderBottom: `1px solid ${BORDER_COLOR}`,
      zIndex: "2147483001",
      fontFamily: FONT_VAR,
    });
    bar.className = "ago-chat-widget-mobile-bar";
    // Leading slot resolves from the props the header already uses, so the bar
    // acts as the full-screen header: a logo if `logoUrl` is set, else the
    // `title` text, else nothing (pass `title: ""` to suppress branding). The
    // empty spacer keeps the close button right-aligned in the "nothing" case.
    if (logoUrl) {
      const img = document.createElement("img");
      img.src = logoUrl;
      img.alt = "";
      css(img, { height: "28px", width: "auto" });
      bar.appendChild(img);
    } else if (title) {
      const label = document.createElement("span");
      label.textContent = title;
      css(label, {
        fontSize: "15px",
        fontWeight: "600",
        color: TEXT_COLOR,
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
      });
      bar.appendChild(label);
    } else {
      bar.appendChild(div({}));
    }
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    css(closeBtn, {
      // Full 44px hit area; margin keeps the glyph optically at the bar edge so
      // the bar height is unchanged.
      flexShrink: "0",
      width: `${TOUCH_TARGET}px`,
      height: `${TOUCH_TARGET}px`,
      marginRight: "-10px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      border: "none",
      background: "transparent",
      fontSize: "26px",
      lineHeight: "1",
      color: TEXT_COLOR,
      cursor: "pointer",
      padding: "0",
    });
    closeBtn.addEventListener("click", () => void collapseInline());
    bar.appendChild(closeBtn);
    return bar;
  }

  // The morph runs through the View Transitions API when available, on a mobile
  // viewport, and motion is allowed; otherwise the DOM just swaps instantly.
  function canAnimateInline(): boolean {
    return (
      typeof (document as DocumentWithVT).startViewTransition === "function" &&
      !reduceMotionMQ?.matches &&
      !!mobileMQ?.matches
    );
  }
  function runInlineTransition(mutate: () => void): Promise<void> {
    const doc = document as DocumentWithVT;
    if (canAnimateInline() && doc.startViewTransition) {
      // Attach the names only for the duration of the transition so the widget
      // is anonymous at rest (no interference with host view transitions).
      container.style.setProperty("view-transition-name", vtName);
      mobileBar?.style.setProperty("view-transition-name", `${vtName}-bar`);
      const clear = (): void => {
        container.style.removeProperty("view-transition-name");
        mobileBar?.style.removeProperty("view-transition-name");
      };
      return doc.startViewTransition(mutate).finished.then(clear, clear);
    }
    mutate();
    return Promise.resolve();
  }

  // Promote the inline card to a fixed full-screen sheet, or restore it. Runs
  // inside the view transition so the browser composites the geometry change.
  function applyInlineState(expanded: boolean): void {
    if (expanded) {
      if (inlineSpacer) {
        container.parentElement?.insertBefore(inlineSpacer, container);
      }
      css(container, {
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        height: "var(--ago-vh, 100dvh)",
        zIndex: "2147483000",
        border: "none",
        borderRadius: "0",
        boxShadow: "none",
        paddingTop: `calc(${INLINE_BAR_H}px + env(safe-area-inset-top))`,
        paddingBottom: "env(safe-area-inset-bottom)",
      });
      container.setAttribute("role", "dialog");
      container.setAttribute("aria-modal", "true");
      container.setAttribute("aria-label", title);
      // NB: the scroll lock is deliberately NOT taken here. This function is
      // handed to `startViewTransition`, which the browser calls back
      // asynchronously — so a `destroy()` landing in that window would release
      // the lock first and this callback would then re-take it on a dead
      // widget, pinning the host's <body> forever with no owner left to free
      // it. It is taken and released synchronously in expandInline/collapseInline.
      // The bar is the full-screen header, so hide the in-card header to avoid a
      // duplicate logo/title row right beneath it.
      if (header) header.style.display = "none";
      if (mobileBar) mobileBar.style.display = "flex";
    } else {
      inlineSpacer?.remove();
      inlineSpacer = undefined;
      for (const prop of [
        "position",
        "top",
        "left",
        "right",
        "bottom",
        "z-index",
        "padding-top",
        "padding-bottom",
      ]) {
        container.style.removeProperty(prop);
      }
      container.style.height = inlineOrig.height;
      container.style.border = inlineOrig.border;
      container.style.borderRadius = inlineOrig.borderRadius;
      container.style.boxShadow = inlineOrig.boxShadow;
      container.removeAttribute("role");
      container.removeAttribute("aria-modal");
      container.removeAttribute("aria-label");
      // See the note on the expand branch: the lock is released synchronously
      // by collapseInline, never from inside the transition callback.
      // Restore the in-card header hidden on expand (it is always flex).
      if (header) header.style.display = "flex";
      if (mobileBar) mobileBar.style.display = "none";
    }
  }

  function expandInline(): Promise<void> {
    if (destroyed || inlineExpanded || !mobileMQ?.matches) {
      return Promise.resolve();
    }
    // Skip the morph when the card already fills the viewport (a dedicated
    // full-page chat): there is nothing to promote, and a sheet would just
    // duplicate what is already on screen.
    const rect = container.getBoundingClientRect();
    if (rect.height >= viewportHeight() * 0.8) return Promise.resolve();
    inlineExpanded = true;
    // Reserve the card's slot so the page doesn't jump when it leaves flow.
    inlineSpacer = div({
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    inlineSpacer.className = "ago-chat-widget-spacer";
    inlineSpacer.setAttribute("aria-hidden", "true");
    // Lock in the full sheet height now, before the keyboard can shrink the
    // viewport, so the keyboard only shifts the sheet up (never resizes it).
    fullVh = viewportHeight();
    container.style.setProperty("--ago-vh", `${fullVh}px`);
    applyVh(); // geometry set synchronously before the transition snapshots
    addViewportListeners();
    // Taken here, synchronously, rather than inside applyInlineState: that
    // function runs as a view-transition callback, and an interleaved destroy()
    // would otherwise leave the host <body> pinned with no owner to release it.
    lockBackgroundScroll(lockOwner);
    const done = runInlineTransition(() => applyInlineState(true));
    void done.then(() => {
      // The widget may have been destroyed while the transition was running.
      if (destroyed) return;
      scrollMessagesToEnd();
      focus();
    });
    scrollMessagesToEnd();
    onOpen?.();
    return done;
  }
  function collapseInline(): Promise<void> {
    if (!inlineExpanded) return Promise.resolve();
    inlineExpanded = false;
    removeViewportListeners();
    // Released synchronously, mirroring expandInline.
    unlockBackgroundScroll(lockOwner);
    // Blur so dismissing doesn't immediately re-trigger the focus expand.
    container.querySelector<HTMLTextAreaElement>("textarea")?.blur();
    const done = runInlineTransition(() => applyInlineState(false));
    void done.then(() => {
      if (destroyed) return;
      container.style.removeProperty("--ago-vh");
    });
    fullVh = 0;
    onClose?.();
    return done;
  }
}
