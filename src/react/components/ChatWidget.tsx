import React, { useEffect, useRef } from "react";
import type { AgoClient } from "../../client/AgoClient";
import {
  createFormCollector,
  loadFormCollector,
  type CreateFormCollectorOptions,
  type LoadFormCollectorOptions,
} from "../../forms/createFormCollector";
import { useOptionalAgoClient } from "../context/AgoContext";
import { useMessages } from "../hooks/useMessages";
import { ChatInput } from "./ChatInput";
import { Message } from "./Message";

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
}

/**
 * Pre-built chat widget component
 */
export const ChatWidget: React.FC<ChatWidgetProps> = ({
  client,
  conversationId: initialConversationId,
  title = "Chat",
  welcomeMessage = "Hello! How can I help you today?",
  placeholder = "Type a message...",
  allowFiles = false,
  height = 500,
  logoUrl,
  showAgentName = false,
  forms,
  onFollowUpClick,
  className = "",
  onMessageSent,
  onMessageReceived,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const contextClient = useOptionalAgoClient();
  const resolvedClient = client ?? contextClient;
  const { messages, isLoading, error, sendMessage } = useMessages({
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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  const handleSend = async (content: string, files?: File[]) => {
    onMessageSent?.(content);
    await sendMessage(content, files);
  };

  // The input is blocked only while the agent is generating the main answer.
  // Once the answer text is done (`status: "DONE"`) the input re-enables, even
  // though the stream stays open while follow-up replies are still being
  // generated.
  const lastMessage = messages[messages.length - 1];
  const isAnswering =
    isLoading &&
    lastMessage?.role === "assistant" &&
    lastMessage.status === "IN_PROGRESS";

  // Default: clicking a suggested reply sends it as a new user message.
  // `onFollowUpClick={false}` disables interactivity; a function overrides it.
  const handleFollowUpClick =
    onFollowUpClick === false
      ? undefined
      : (onFollowUpClick ?? ((reply: string) => handleSend(reply)));

  return (
    <div
      className={`ago-chat-widget ${className}`}
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
      }}
    >
      {/* Header */}
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

      {/* Messages */}
      <div
        className="ago-chat-widget__messages"
        style={{
          flex: 1,
          overflow: "auto",
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
              fontSize: "14px",
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
            />
          ))
        )}

        {error && (
          <div
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

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={isAnswering}
        placeholder={placeholder}
        allowFiles={allowFiles}
      />
    </div>
  );
};
