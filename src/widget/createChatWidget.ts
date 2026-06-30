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
import { createConversationSession } from "../state/createConversationSession";
import { attachmentsFromFiles } from "../utils/attachments";
import { buildInput } from "./buildInput";
import { renderMarkdown } from "./renderMarkdown";
import {
  buildChatIcon,
  renderFormNotice,
  renderMessage,
} from "./renderMessage";
import {
  applyTheme,
  BORDER_COLOR,
  BRAND_COLOR,
  BRAND_TEXT_COLOR,
  css,
  div,
  ensureKeyframes,
  FONT_VAR,
  HEADER_BACKGROUND,
  HEADER_TEXT_COLOR,
  MESSAGES_BACKGROUND,
  MUTED_TEXT_COLOR,
  PANEL_BACKGROUND,
  RADIUS,
  TEXT_COLOR,
} from "./styles";
import type { ChatWidgetHandle, MountChatWidgetOptions } from "./types";

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
    onOpen,
    onClose,
  } = options;

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
  const showLauncher = isSide && (options.launcher ?? true);
  let panelOpen = isSide ? defaultOpen : true;

  // Mobile full-screen is automatic: on small viewports the panel fills the
  // screen with no opt-in. All viewport/transition APIs below are feature-detected
  // so the behavior is inert (and test-safe) where they are missing: jsdom and
  // older browsers have no matchMedia / visualViewport / startViewTransition.
  const mobileBreakpoint = options.mobile?.breakpoint ?? 768;
  const mobileTrigger = options.mobile?.trigger ?? "focus";
  const hasMatchMedia = typeof window !== "undefined" && !!window.matchMedia;
  const mobileMQ = hasMatchMedia
    ? window.matchMedia(`(max-width: ${mobileBreakpoint}px)`)
    : undefined;
  const reduceMotionMQ = hasMatchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : undefined;
  // Inline placement morphs to a sheet on mobile; side panels just square off.
  const inlineFullscreen = !isSide && !!mobileMQ;

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
  // Announce streamed replies to screen readers as they arrive, without stealing
  // focus.
  messagesEl.setAttribute("role", "log");
  messagesEl.setAttribute("aria-live", "polite");
  messagesEl.setAttribute("aria-relevant", "additions text");
  messagesEl.setAttribute("aria-atomic", "false");

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
    if (mobileTrigger === "focus") {
      // Tapping the input expands first, then focuses (see expandInline), so the
      // keyboard rises into the settled fullscreen layout. preventDefault defers
      // the native focus until the morph finishes.
      container.addEventListener(
        "pointerdown",
        (e) => {
          if (inlineExpanded || !mobileMQ?.matches) return;
          if (!inputRow.contains(e.target as Node)) return;
          e.preventDefault();
          void expandInline();
        },
        true,
      );
      // Fallback for keyboard / assistive-tech users (focus without a pointer).
      // Scoped to the input row, like the pointerdown handler above: focus landing
      // on other controls in the thread (follow-up reply pills, source links) must
      // not morph to full screen. The morph flips the container to position:fixed
      // mid-tap, which eats the synthesized click so the tapped control never fires
      // (e.g. a suggested reply opens fullscreen instead of sending).
      container.addEventListener("focusin", (e) => {
        if (!mobileMQ?.matches) return;
        if (!inputRow.contains(e.target as Node)) return;
        void expandInline();
      });
    }
    document.addEventListener("keydown", onInlineKeydown);
  }
  // Re-apply geometry when crossing the breakpoint (side squares off / inline
  // collapses out of full screen). Relevant for both placements when an mq exists.
  if (mobileMQ) {
    mobileMQ.addEventListener("change", onMobileMqChange);
  }

  // ── Rendering ──────────────────────────────────────────────────────
  const followUpEnabled = onFollowUpClick !== false;
  const followUpHandler =
    onFollowUpClick === false
      ? undefined
      : (onFollowUpClick ?? ((reply: string) => void send(reply)));

  function render(): void {
    messagesEl.replaceChildren();
    if (messages.length === 0) {
      // In streaming mode the empty state stays blank: the greeting plays as a
      // real assistant bubble (see streamWelcome), so there are no messages to
      // show only for the brief moment before the first token arrives.
      if (welcomeMode === "static") {
        const welcome = div({
          textAlign: "center",
          color: MUTED_TEXT_COLOR,
          padding: "24px 16px",
          fontSize: "16px",
          lineHeight: "1.5",
        });
        welcome.appendChild(renderMarkdown(welcomeText));
        messagesEl.appendChild(welcome);
      }
    } else {
      messages.forEach((message, index) => {
        // Last bubble of a same-sender block (gets the iMessage tail).
        const isLastOfBlock =
          index === messages.length - 1 ||
          messages[index + 1].role !== message.role;
        messagesEl.appendChild(
          renderMessage(message, {
            isLast: index === messages.length - 1,
            isLastOfBlock,
            bubbleStyle,
            showAgentName,
            agentBubble,
            followUpEnabled,
            followUpHandler,
            // On a small viewport let bubbles run wider to reclaim horizontal space.
            isMobile: !!mobileMQ?.matches,
          }),
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
      // Announce failures immediately (the surrounding log is only `polite`).
      err.setAttribute("role", "alert");
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
  // On a mobile viewport the inline card is a compact launcher; don't auto-focus
  // it (that would pop the keyboard and morph to full screen on load). Focus
  // happens on genuine user engagement instead (pointerdown / focusin).
  if (!(inlineFullscreen && mobileMQ?.matches)) focus();
  // Resuming a thread loads its real history; otherwise (a fresh visit) play the
  // streamed greeting if one was configured. `conversationId` is the fresh-visit
  // gate: it's set only when an explicit id or a stored last-active thread exists.
  if (conversationId) void loadHistory(conversationId);
  else if (welcomeMode === "streaming") streamWelcome(welcomeText);
  if (loadThreads) void refreshThreads();

  return {
    client,
    element: mountInto,
    sendMessage: send,
    ...(isSide || inlineFullscreen
      ? { open: openCtl, close: closeCtl, toggle: toggleCtl }
      : {}),
    session,
    threads,
    refreshThreads,
    destroy() {
      if (introTimer) clearInterval(introTimer);
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
      mobileBar?.remove();
      vtStyle?.remove();
      inlineSpacer?.remove();
      mobileMQ?.removeEventListener("change", onMobileMqChange);
      if (inlineFullscreen) {
        document.removeEventListener("keydown", onInlineKeydown);
        removeViewportListeners();
        // Drop the scroll lock if we're torn down while expanded.
        document.documentElement.style.removeProperty("overflow");
      }
      // Only tear down the client if we created it.
      if (!options.client) client.destroy();
    },
  };

  // ── Side-panel open/close (no-ops in inline mode) ──────────────────
  function applyOpenState(): void {
    if (!wrapper) return;
    // Square the side panel off to a full-screen sheet on mobile (automatic; no
    // opt-in). On viewports wider than the breakpoint it keeps its resting width
    // and inner divider. Slide mechanics below are unchanged.
    {
      const sideBorder = edge === "left" ? "border-right" : "border-left";
      if (mobileMQ?.matches) {
        wrapper.style.width = "100%";
        container.style.borderRadius = "0";
        container.style.removeProperty(sideBorder);
      } else {
        wrapper.style.width = typeof width === "number" ? `${width}px` : width;
        container.style.setProperty(sideBorder, `1px solid ${BORDER_COLOR}`);
      }
    }
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
    if (isSide) openPanel();
    else void expandInline();
  }
  function closeCtl(): void {
    if (isSide) closePanel();
    else void collapseInline();
  }
  function toggleCtl(): void {
    if (isSide) togglePanel();
    else if (inlineExpanded) void collapseInline();
    else void expandInline();
  }
  // Visible, tabbable elements inside the expanded dialog (skips display:none
  // subtrees like the hidden in-card header; getClientRects covers fixed elements
  // such as the bar, which offsetParent would miss).
  function inlineFocusables(): HTMLElement[] {
    const sel =
      "a[href],button:not([disabled]),textarea:not([disabled])," +
      'input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll<HTMLElement>(sel)).filter(
      (el) => el.getClientRects().length > 0,
    );
  }
  function onInlineKeydown(e: KeyboardEvent): void {
    if (!inlineExpanded) return;
    if (e.key === "Escape") {
      void collapseInline();
      return;
    }
    // Trap Tab within the modal sheet (aria-modal alone does not stop keyboard
    // focus from leaving into the scroll-locked background).
    if (e.key !== "Tab") return;
    const focusables = inlineFocusables();
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
    if (isSide) applyOpenState();
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
  function applyVh(): void {
    const vv = window.visualViewport;
    const top = vv?.offsetTop ?? 0;
    const h = vv?.height ?? fullVh;
    // How far the keyboard covers the bottom of the full-height sheet. Clamped to
    // <= 0 so a keyboardless viewport leaves the sheet flush at the top.
    const shift = Math.min(0, top + h - fullVh);
    container.style.top = `${shift}px`;
    // The bar tracks the visible-viewport top so it stays on screen if the page
    // itself scrolls under the sheet (offsetTop > 0).
    if (mobileBar) mobileBar.style.top = `${top}px`;
  }
  // The keyboard opening fires a burst of resize + scroll events. Coalesce them
  // into one rAF so `applyVh` reads a single settled snapshot and writes once.
  function syncVh(): void {
    if (vhRaf) return;
    vhRaf = requestAnimationFrame(() => {
      vhRaf = 0;
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
  function scrollMessagesToEnd(): void {
    messagesEl.scrollTop = messagesEl.scrollHeight;
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
      border: "none",
      background: "transparent",
      fontSize: "26px",
      lineHeight: "1",
      color: TEXT_COLOR,
      cursor: "pointer",
      padding: "4px 8px",
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
      document.documentElement.style.overflow = "hidden";
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
      document.documentElement.style.removeProperty("overflow");
      // Restore the in-card header hidden on expand (it is always flex).
      if (header) header.style.display = "flex";
      if (mobileBar) mobileBar.style.display = "none";
    }
  }

  function expandInline(): Promise<void> {
    if (inlineExpanded || !mobileMQ?.matches) return Promise.resolve();
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
    const done = runInlineTransition(() => applyInlineState(true));
    void done.then(() => {
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
    // Blur so dismissing doesn't immediately re-trigger the focus expand.
    container.querySelector<HTMLTextAreaElement>("textarea")?.blur();
    const done = runInlineTransition(() => applyInlineState(false));
    void done.then(() => container.style.removeProperty("--ago-vh"));
    fullVh = 0;
    onClose?.();
    return done;
  }
}
