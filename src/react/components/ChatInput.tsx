import React, { useCallback, useRef, useState } from "react";

export interface ChatInputProps {
  /**
   * Send the message. The composer clears immediately so the UI feels instant,
   * so resolving to `false` means "that send failed" and puts the text (and any
   * attachments) back rather than losing what the user typed.
   */
  onSend: (
    message: string,
    files?: File[],
  ) => void | boolean | Promise<void | boolean>;
  /**
   * Stop the turn being generated. When provided, the send button becomes an
   * enabled Stop button for as long as `disabled` is true (i.e. while the agent
   * is answering).
   */
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
  allowFiles?: boolean;
  className?: string;
}

/**
 * Chat input component with send button
 */
export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onStop,
  disabled = false,
  placeholder = "Type a message...",
  allowFiles = false,
  className = "",
}) => {
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea to fit its content, capped at 4 lines, then scroll.
  // The +2 keeps the border-box height matching the natural single-line height
  // (1px border top + bottom).
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const max = 110;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? "auto" : "hidden";
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!message.trim() && files.length === 0) return;
      const sentText = message.trim();
      const sentFiles = files.length > 0 ? files : undefined;
      setMessage("");
      setFiles([]);
      requestAnimationFrame(autoResize);

      const ok = await onSend(sentText, sentFiles);
      // A failed send would otherwise destroy the message: the composer was
      // cleared on submit and the optimistic bubble is dropped on error, so the
      // text is unrecoverable. Put it back — unless the user has already started
      // typing something new, which must never be clobbered.
      if (ok === false) {
        setMessage((current) => (current.trim() ? current : sentText));
        if (sentFiles) setFiles((current) => [...sentFiles, ...current]);
        requestAnimationFrame(autoResize);
      }
    },
    [message, files, onSend, autoResize],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []);
      setFiles((prev) => [...prev, ...selectedFiles]);
    },
    [],
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const canSend = message.trim() || files.length > 0;

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className={`ago-chat-input ${className}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "12px 16px",
        borderTop: "1px solid #dee3e8",
        backgroundColor: "#fff",
      }}
    >
      {/* File preview */}
      {files.length > 0 && (
        <div
          className="ago-chat-input__files"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
          }}
        >
          {files.map((file, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 10px",
                backgroundColor: "#f0f2f5",
                borderRadius: "6px",
                fontSize: "12px",
                color: "#30373e",
              }}
            >
              <span
                style={{
                  maxWidth: "120px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                aria-label={`Remove ${file.name}`}
                style={{
                  // 44px hit area (Apple HIG minimum). Negative margins keep the
                  // chip visually the same size: only the tap target grows.
                  flexShrink: 0,
                  width: "44px",
                  height: "44px",
                  margin: "-14px -12px -14px -4px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  padding: "0",
                  color: "#6b6d6f",
                  fontSize: "14px",
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "flex-end",
        }}
      >
        {allowFiles && (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              aria-label="Attach file"
              style={{
                // 44px minimum touch target (Apple HIG).
                flexShrink: 0,
                minWidth: "44px",
                minHeight: "44px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "8px",
                border: "1px solid #dee3e8",
                borderRadius: "8px",
                backgroundColor: "#fff",
                cursor: disabled ? "not-allowed" : "pointer",
                color: "#6b6d6f",
                fontSize: "16px",
                lineHeight: 1,
              }}
            >
              +
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
          </>
        )}

        <textarea
          ref={textareaRef}
          className="ago-chat-input__field"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          // A placeholder is not an accessible name; label the field explicitly.
          aria-label={placeholder}
          disabled={disabled}
          rows={1}
          style={{
            flex: 1,
            padding: "10px 14px",
            border: "1px solid #dee3e8",
            borderRadius: "20px",
            resize: "none",
            outline: "none",
            boxSizing: "border-box",
            // Grow with content up to 4 lines, then scroll.
            maxHeight: "110px",
            overflowY: "hidden",
            fontFamily: "inherit",
            fontSize: "16px",
            lineHeight: 1.4,
            color: "#30373e",
            backgroundColor: "#f8f8f8",
            transition: "border-color 0.15s",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#1b5fc4";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#dee3e8";
          }}
        />

        {/* While the agent answers, the same slot becomes Stop — it has to stay
            enabled, which is why it's a separate button rather than more
            ternaries on the send one. */}
        {disabled && onStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            style={{
              // 44px minimum height (Apple HIG touch target).
              minHeight: "44px",
              padding: "10px 18px",
              border: "none",
              borderRadius: "20px",
              backgroundColor: "#03182f",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: "16px",
              transition: "background-color 0.15s",
            }}
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || !canSend}
            style={{
              // 44px minimum height (Apple HIG touch target).
              minHeight: "44px",
              padding: "10px 18px",
              border: "none",
              borderRadius: "20px",
              backgroundColor: disabled || !canSend ? "#b5bfc8" : "#03182f",
              color: "#fff",
              cursor: disabled || !canSend ? "not-allowed" : "pointer",
              fontWeight: 500,
              fontSize: "16px",
              transition: "background-color 0.15s",
            }}
          >
            Send
          </button>
        )}
      </div>
    </form>
  );
};
