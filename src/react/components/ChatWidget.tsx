import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { AgoClient } from "../../client/AgoClient";
import {
  createFormCollector,
  loadFormCollector,
  type CreateFormCollectorOptions,
  type LoadFormCollectorOptions,
} from "../../forms/createFormCollector";
import { useOptionalAgoClient } from "../context/AgoContext";
import {
  lockBackgroundScroll,
  unlockBackgroundScroll,
} from "../../widget/scrollLock";
import type { SheetOptions, SheetState } from "../../widget/sheetController";
import { useAgoActivity } from "../hooks/useAgoActivity";
import type { AgoActivityItem } from "../hooks/useAgoActivity";
import { useMessages } from "../hooks/useMessages";
import { useSheet } from "../hooks/useSheet";
import { ActivityLine } from "./ActivityLine";
import { renderInlineMarkdown } from "./inlineMarkdown";
import { ChatInput } from "./ChatInput";
import { Message, StreamingDots } from "./Message";
import { MessageFeedback, type MessageFeedbackProps } from "./MessageFeedback";

export interface ChatWidgetProps {
  /** The AGO client instance. If omitted, reads from AgoProvider context. */
  client?: AgoClient;
  /** Initial conversation ID */
  conversationId?: string;
  /** Widget title */
  title?: string;
  /** Welcome message shown when no messages */
  welcomeMessage?: string;
  /** Input placeholder */
  placeholder?: string;
  /** Enable file attachments */
  allowFiles?: boolean;
  /**
   * While the agent is answering, turn the send button into a Stop button that
   * interrupts the turn. Defaults to `true`.
   */
  allowStop?: boolean;
  /** Widget height */
  height?: string | number;
  /** URL of a logo to display in the header */
  logoUrl?: string;
  /** Show the agent name above assistant messages. Defaults to `false`. */
  showAgentName?: boolean;
  /**
   * Conversational forms the agent can fill and submit during the chat. Each
   * entry is installed as a {@link createFormCollector} (its `update_<name>` /
   * `submit_<name>` functions + dynamic context) for the lifetime of the widget.
   *
   * Pass a full config (with `schema`) to define it inline, or just `{ name }` to
   * fetch the definition from the backend ({@link loadFormCollector}).
   */
  forms?: Array<CreateFormCollectorOptions | LoadFormCollectorOptions>;
  /**
   * Let the user report an answer that did not work: thumbs under each finished
   * answer, and after a thumbs-down a panel to say what went wrong. Off by
   * default. `true` uses the English labels; pass the `<MessageFeedback>` props
   * to translate the strings or observe what was sent.
   *
   * ```tsx
   * <ChatWidget feedback />
   * ```
   */
  feedback?: boolean | Omit<MessageFeedbackProps, "messageId" | "client">;
  /**
   * How clicking a suggested follow-up reply behaves. Defaults to sending the
   * reply as a new user message. Pass a handler to override, or `false` to
   * render the suggestions as non-interactive.
   */
  onFollowUpClick?: ((reply: string) => void) | false;
  /** Additional CSS class */
  className?: string;
  /** Callback when a message is sent */
  onMessageSent?: (content: string) => void;
  /** Callback when a message is received */
  onMessageReceived?: (message: { id: string; content: string }) => void;
  /**
   * Present the widget as a bottom sheet on compact viewports: a slim `peek`
   * bar pinned to the bottom edge that expands to `full`.
   *
   * Off by default, because it turns the widget into a fixed overlay on the
   * host page. Pass `false` explicitly to be sure it stays off, or an object to
   * tune the breakpoint, resting state, and the space to leave for a host
   * bottom nav (`bottomOffset`).
   */
  sheet?: SheetOptions | false;
  /**
   * Shown next to the animated dots in the collapsed sheet while the agent is
   * working and has not produced any text yet. Defaults to `"Thinking..."`.
   */
  thinkingLabel?: string;
  /**
   * What to show while a client function the agent called is still running.
   * Between the call and the turn resuming the page can be busy for seconds,
   * and a bare typing indicator says nothing about it.
   *
   * Map a function name to a label, or pass a function for full control.
   * Unmapped names fall back to a prettified version of the name itself
   * (`lookupFlavorPrices` -> "Lookup Flavor Prices"). Pass `false` to keep the
   * plain thinking indicator.
   *
   * ```tsx
   * <ChatWidget functionLabels={{ lookupFlavorPrices: "Je regarde les prix" }} />
   * ```
   */
  functionLabels?:
    | Record<string, string>
    | ((functionName: string, args: Record<string, unknown>) => string)
    | false;
  /**
   * Include the agent's `reasoning` steps in the activity row. On by default:
   * they are the backend's own progress messages, and without them the row goes
   * blank between two function calls. Set `false` to show only tool activity.
   */
  showReasoning?: boolean;
}

/** Imperative handle exposed via `ref`. */
export interface ChatWidgetHandle {
  /**
   * Expand the sheet to full screen.
   *
   * Only the presentation is gated on a compact viewport: off-compact (or with
   * the sheet disabled) nothing moves on screen, but the state still changes and
   * `onStateChange` still fires. Guard on `state` if that matters to you.
   */
  expand: () => void;
  /** Collapse back to `peek`. The draft and the conversation are kept. */
  collapse: () => void;
  toggle: () => void;
  /** Current sheet state. `"peek"` when the sheet is off. */
  state: SheetState;
}

/**
 * Pre-built chat widget component
 */
export const ChatWidget = forwardRef<ChatWidgetHandle, ChatWidgetProps>(
  function ChatWidget({
  client,
  conversationId: initialConversationId,
  title = "Chat",
  welcomeMessage = "Hello! How can I help you today?",
  placeholder = "Type a message...",
  allowFiles = false,
  allowStop = true,
  height = 500,
  logoUrl,
  showAgentName = false,
  forms,
  feedback = false,
  onFollowUpClick,
  className = "",
  onMessageSent,
  onMessageReceived,
  sheet: sheetOptions = false,
  thinkingLabel = "Thinking...",
  functionLabels,
  showReasoning = true,
}, ref) {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  // Mirrors shouldAutoScrollRef for rendering: a ref alone can't drive the
  // "jump to latest" affordance, since changing it doesn't re-render.
  const [atBottom, setAtBottom] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const { sheet, expand, collapse, toggle } = useSheet(sheetOptions);
  // A reply that lands while collapsed would otherwise be invisible: peek only
  // shows a two-line preview, so mark it and clear the mark on expand.
  const [hasUnread, setHasUnread] = useState(false);
  const isPeek = sheet.compact && sheet.state === "peek";
  const contextClient = useOptionalAgoClient();
  const resolvedClient = client ?? contextClient;
  const { messages, isLoading, error, sendMessage, stop } = useMessages({
    client,
    conversationId: initialConversationId,
  });

  // Install the conversational form collectors for the widget's lifetime.
  // Inline configs (with `schema`) are built synchronously; name-only entries are
  // fetched from the backend. Re-run only when the form configs actually change
  // (by name + schema + submit target), not on every render of an inline array.
  const formsKey = forms
    ? JSON.stringify(
        forms.map((f) => [
          f.name,
          f.schema ?? null,
          f.submit ?? false,
          f.description ?? null,
        ]),
      )
    : "";
  useEffect(() => {
    if (!resolvedClient || !forms || forms.length === 0) return;
    let cancelled = false;
    const uninstalls: Array<() => void> = [];
    Promise.all(
      forms.map((f) =>
        f.schema != null
          ? Promise.resolve(
              createFormCollector(f as CreateFormCollectorOptions),
            )
          : loadFormCollector(resolvedClient, f as LoadFormCollectorOptions),
      ),
    )
      .then((collectors) => {
        if (cancelled) return;
        for (const collector of collectors) {
          uninstalls.push(collector.install(resolvedClient));
        }
      })
      // A missing/failed form definition shouldn't break the whole widget.
      .catch(() => {});
    return () => {
      cancelled = true;
      uninstalls.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedClient, formsKey]);

  // Auto-scroll inside the message pane when messages arrive, unless the
  // reader intentionally moved up to revisit earlier messages. Using
  // scrollIntoView on a bottom sentinel also scrolls ancestor containers (and
  // often the whole page when the widget is sticky), which makes sending a
  // message unexpectedly move the surrounding application.
  useEffect(() => {
    const messagesContainer = messagesContainerRef.current;
    if (!messagesContainer || !shouldAutoScrollRef.current) return;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }, [messages]);

  const scrollToLatest = () => {
    const pane = messagesContainerRef.current;
    if (!pane) return;
    shouldAutoScrollRef.current = true;
    setAtBottom(true);
    pane.scrollTop = pane.scrollHeight;
  };

  // Callback when message is received
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage &&
      lastMessage.role === "assistant" &&
      lastMessage.status === "DONE" &&
      onMessageReceived
    ) {
      onMessageReceived({ id: lastMessage.id, content: lastMessage.content });
    }
  }, [messages, onMessageReceived]);

  useEffect(() => {
    if (isPeek) setHasUnread(true);
    else setHasUnread(false);
    // Only a genuinely new message marks unread, not a state flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Publish the collapsed sheet's footprint as an `--ago-*` custom property on
  // the host document, so the page can reserve room for it.
  //
  // A fixed bar covers whatever is at the bottom of the page: without this the
  // end of the host's content (its footer, typically) is unreachable, because
  // scrolling to the bottom still leaves it underneath. Reserving the space with
  // a hardcoded number in the host's CSS is wrong too, since the bar's height
  // depends on the host's own composer styling. Measuring and publishing it lets
  // the page do `padding-bottom: var(--ago-sheet-height)` and always be right.
  useEffect(() => {
    const el = rootRef.current;
    if (!sheet.compact || !el) return;
    const root = document.documentElement;
    // Only measured at rest: in `full` the sheet covers the viewport and the
    // page behind it is locked, so the value to reserve is the peek footprint.
    if (sheet.state !== "peek") return;
    const publish = () => {
      root.style.setProperty(
        "--ago-sheet-height",
        `${Math.round(el.getBoundingClientRect().height)}px`,
      );
    };
    publish();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(publish) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [sheet.compact, sheet.state]);

  // Drop the reservation when the sheet goes away entirely, so a host that
  // resizes to desktop (or unmounts the widget) doesn't keep a dead gap.
  useEffect(() => {
    if (sheet.compact) return;
    document.documentElement.style.removeProperty("--ago-sheet-height");
  }, [sheet.compact]);

  useEffect(
    () => () => {
      document.documentElement.style.removeProperty("--ago-sheet-height");
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({ expand, collapse, toggle, state: sheet.state }),
    [expand, collapse, toggle, sheet.state],
  );

  // Everything that must only happen while the sheet actually covers the
  // viewport hangs off `sheet.isModal`, so scroll locking, Escape and focus can
  // never drift apart. It is false on a desktop viewport even when expanded:
  // the page beside the widget is still usable and must stay reachable.
  useEffect(() => {
    if (!sheet.isModal) return;
    const owner = Symbol("ago-react-sheet");
    lockBackgroundScroll(owner);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        collapse("user");
        return;
      }
      // Trap Tab inside the sheet. `aria-modal` alone does not stop keyboard
      // focus from walking out into the background we just scroll-locked, which
      // would strand the user somewhere they cannot see or scroll to. Mirrors
      // the vanilla widget's `onModalKeydown`.
      if (e.key !== "Tab") return;
      const root = rootRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          "a[href],button:not([disabled]),textarea:not([disabled])," +
            'input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
        // getClientRects skips display:none subtrees, and unlike offsetParent it
        // still sees position:fixed elements.
      ).filter((el) => el.getClientRects().length > 0);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    // Move focus into the sheet, but NOT into the text field: focusing the
    // composer here would pop the on-screen keyboard over the answer.
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      unlockBackgroundScroll(owner);
    };
  }, [sheet.isModal, collapse]);

    const handleSend = async (content: string, files?: File[]) => {
    // Sending is an explicit "show me the latest" gesture: re-attach the pane
    // even if the reader had scrolled up to re-read something.
    shouldAutoScrollRef.current = true;
    setAtBottom(true);
    onMessageSent?.(content);
    // `sendMessage` resolves to null when the send failed. Reporting that back
    // lets the composer put the draft back instead of losing what was typed.
    const result = await sendMessage(content, files);
    return result !== null;
  };

  // The input is blocked only while the agent is generating the main answer.
  // Once the answer text is done (`status: "DONE"`) the input re-enables, even
  // though the stream stays open while follow-up replies are still being
  // generated.
  const lastMessage = messages[messages.length - 1];
  const isAnswering =
    isLoading &&
    lastMessage?.role === "assistant" &&
    (lastMessage.status === "IN_PROGRESS" || lastMessage.status === "WAITING_CLIENT");

  // What the agent is doing right now. The dots alone say "something is
  // happening" and then vanish as soon as the first token lands, which is
  // exactly when a tool pause is most likely and least visible.
  const labelFor = useCallback(
    (item: AgoActivityItem): string | undefined => {
      const fn = item.functionName;
      if (!functionLabels || !fn) return undefined;
      if (typeof functionLabels === "function") {
        return functionLabels(fn, item.arguments ?? {});
      }
      return functionLabels[fn];
    },
    [functionLabels]
  );
  const { items } = useAgoActivity({
    client: resolvedClient ?? undefined,
    labelFor,
    includeReasoning: showReasoning,
  });
  // Show the latest step of THIS turn and keep it until something replaces it
  // or the turn ends. Clearing on `function:result` instead meant a fast call
  // flashed for 40 ms and the user read nothing.
  //
  // Items accumulate across turns (the hook never drops them), so scope on the
  // assistant message being written; otherwise a new turn opens by showing the
  // previous one's last step.
  const turnItems = items.filter(
    (it) => lastMessage?.id !== undefined && it.messageId === lastMessage.id
  );
  const activityLabel =
    functionLabels === false
      ? undefined
      : turnItems[turnItems.length - 1]?.label;
  // When the row is up it IS the progress indicator, so the answer bubble must
  // not also show its dots right above it.
  const showingActivity = Boolean(isAnswering && activityLabel);

  // Default: clicking a suggested reply sends it as a new user message.
  // `onFollowUpClick={false}` disables interactivity; a function overrides it.
  const handleFollowUpClick =
    onFollowUpClick === false
      ? undefined
      : (onFollowUpClick ?? ((reply: string) => handleSend(reply)));

  return (
    <div
      ref={rootRef}
      className={`ago-chat-widget ${className}`}
      {...sheet.surface.attrs}
      data-ago-sheet-state={sheet.compact ? sheet.state : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        height: typeof height === "number" ? `${height}px` : height,
        border: "1px solid #dee3e8",
        borderRadius: "16px",
        overflow: "hidden",
        backgroundColor: "#fff",
        fontFamily:
          '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        textAlign: "left",
        boxShadow: "rgba(15, 15, 15, 0.08) 0px 2px 16px 0px",
        // Applied last so the sheet's geometry wins over the resting layout.
        // This is the props bag from the shared controller: the vanilla widget
        // hands the very same object to its `css()` helper.
        ...sheet.surface.style,
      }}
    >
      {/* Header. Hidden while the sheet is up: `peek` and `full` each render
          their own title row, and leaving this one in place stacks two of them.
          The vanilla widget hides its in-card header for the same reason. */}
      {!sheet.compact && (
      <div
        className="ago-chat-widget__header"
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #dee3e8",
          backgroundColor: "#03182f",
          color: "#e8f0fe",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        {logoUrl && (
          <img
            src={logoUrl}
            alt="Logo"
            style={{ height: "24px", width: "auto" }}
          />
        )}
        <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600 }}>
          {title}
        </h3>
      </div>
      )}

      {/* Collapsed sheet: a named header plus a two-line preview of the last
          reply. A bare composer bar would show nothing at all while the agent is
          answering, which defeats the point of a resting state. */}
      {isPeek && (
        <button
          type="button"
          className="ago-chat-widget__peek"
          aria-expanded={false}
          aria-label="Open the conversation"
          onClick={() => {
            setHasUnread(false);
            expand("user");
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: "8px",
            padding: "14px 18px 10px",
            border: "none",
            borderBottom: "1px solid currentColor",
            borderBottomColor: "rgba(128,128,128,0.25)",
            background: "transparent",
            textAlign: "left",
            cursor: "pointer",
            font: "inherit",
            color: "inherit",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              // Inherit rather than hardcode: peek floats over host content, so
              // a fixed grey is unreadable on half the pages that use it.
              color: "inherit",
              opacity: 0.7,
            }}
          >
            {title}
            {hasUnread && (
              <span
                aria-label="New message"
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: "#1b5fc4",
                }}
              />
            )}
            <span style={{ marginLeft: "auto", fontSize: "14px" }} aria-hidden>
              ↑
            </span>
          </span>
          {isAnswering && !lastMessage?.content ? (
            // Before the first token there is nothing to preview. Falling back
            // to the greeting here showed stale text exactly when the user most
            // wants to know something is happening.
            <span
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
            >
              {/* Dots only when the label is the generic one. A concrete step
                  ("Updating the page") already reads as progress. */}
              {!activityLabel && <StreamingDots />}
              <span
                style={{
                  fontSize: "13px",
                  opacity: 0.7,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {activityLabel
                  ? renderInlineMarkdown(activityLabel)
                  : thinkingLabel}
              </span>
            </span>
          ) : (
            <span
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                fontSize: "13px",
                lineHeight: 1.5,
                color: "inherit",
                // Reserve both lines so the bar does not jolt as the reply grows.
                minHeight: "calc(2 * 1.5 * 13px)",
              }}
            >
              {lastMessage?.content || welcomeMessage}
            </span>
          )}
        </button>
      )}

      {/* Expanded sheet: an explicit way back. Escape alone is not an exit on a
          touch device, and a chevron reads as "put this away" where a x reads as
          "destroy", which would contradict collapse keeping the draft and the
          conversation. */}
      {sheet.compact && sheet.state === "full" && (
        <div
          className="ago-chat-widget__sheet-header"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 10px 6px 18px",
            borderBottom: "1px solid rgba(128,128,128,0.25)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "inherit",
              opacity: 0.7,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </span>
          <button
            type="button"
            aria-label="Collapse the conversation"
            onClick={() => collapse("user")}
            style={{
              marginLeft: "auto",
              flexShrink: 0,
              width: "44px",
              height: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      )}

      {/* Messages. Wrapped so the "jump to latest" button can be positioned
          against the pane without scrolling away with its content. */}
      <div
        style={{
          position: "relative",
          flex: 1,
          display: isPeek ? "none" : "flex",
          minHeight: 0,
        }}
      >
      <div
        ref={messagesContainerRef}
        className="ago-chat-widget__messages"
        onScroll={(event) => {
          const pane = event.currentTarget;
          const bottom =
            pane.scrollHeight - pane.scrollTop - pane.clientHeight <= 48;
          shouldAutoScrollRef.current = bottom;
          setAtBottom(bottom);
        }}
        // Announce streamed replies to screen readers as they arrive, without
        // stealing focus. `aria-busy` while the answer is being written defers
        // announcements so the reader hears the finished answer once, instead of
        // being interrupted on every streamed chunk.
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-atomic={false}
        aria-busy={isAnswering}
        style={{
          flex: 1,
          overflow: "auto",
          // Keep overscroll at the ends of the list from chaining into the host
          // page behind it (rubber-banding) on touch devices.
          overscrollBehavior: "contain",
          padding: "16px",
          backgroundColor: "#fbfbfb",
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              color: "#6b6d6f",
              padding: "24px 16px",
              fontSize: "16px",
              lineHeight: "1.5",
            }}
          >
            {welcomeMessage}
          </div>
        ) : (
          messages.map((message, index) => (
            <Message
              key={message.id}
              message={message}
              showAgentName={showAgentName}
              isLast={index === messages.length - 1}
              onFollowUpClick={handleFollowUpClick}
              showStreamingDots={!showingActivity}
              feedback={
                // Only a finished answer can be judged.
                feedback &&
                message.role === "assistant" &&
                message.status === "DONE" &&
                message.content ? (
                  <MessageFeedback
                    messageId={message.id}
                    client={client}
                    {...(feedback === true ? {} : feedback)}
                  />
                ) : undefined
              }
            />
          ))
        )}

        {showingActivity && <ActivityLine label={activityLabel ?? ""} />}

        {error && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              backgroundColor: "#fef2f2",
              color: "#dc2626",
              borderRadius: "12px",
              marginTop: "8px",
              fontSize: "13px",
              border: "1px solid #fecaca",
            }}
          >
            {error.message}
          </div>
        )}

        <div />
      </div>

        {/* Shown once the reader scrolls away from the bottom, so a streaming
            answer never yanks them back but they always have a way to return. */}
        {!atBottom && (
          <button
            type="button"
            className="ago-chat-widget__jump"
            aria-label="Jump to latest message"
            onClick={scrollToLatest}
            style={{
              position: "absolute",
              left: "50%",
              bottom: "12px",
              transform: "translateX(-50%)",
              width: "44px",
              height: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #dee3e8",
              borderRadius: "50%",
              backgroundColor: "#fff",
              color: "#0b1b2b",
              boxShadow: "rgba(15, 15, 15, 0.16) 0px 2px 10px 0px",
              cursor: "pointer",
              zIndex: 2,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={allowStop ? () => void stop() : undefined}
        disabled={isAnswering}
        placeholder={placeholder}
        allowFiles={allowFiles}
      />
    </div>
  );
});
