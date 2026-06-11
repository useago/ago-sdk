import React, { useState, useRef, useCallback } from "react";

export interface ChatInputProps {
  onSend: (message: string, files?: File[]) => void;
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
  disabled = false,
  placeholder = "Type a message...",
  allowFiles = false,
  className = "",
}) => {
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (message.trim() || files.length > 0) {
        onSend(message.trim(), files.length > 0 ? files : undefined);
        setMessage("");
        setFiles([]);
      }
    },
    [message, files, onSend]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []);
      setFiles((prev) => [...prev, ...selectedFiles]);
    },
    []
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const canSend = message.trim() || files.length > 0;

  return (
    <form
      onSubmit={handleSubmit}
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
              <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                style={{
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
              style={{
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
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          style={{
            flex: 1,
            padding: "10px 14px",
            border: "1px solid #dee3e8",
            borderRadius: "20px",
            resize: "none",
            outline: "none",
            fontFamily: "inherit",
            fontSize: "14px",
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

        <button
          type="submit"
          disabled={disabled || !canSend}
          style={{
            padding: "10px 18px",
            border: "none",
            borderRadius: "20px",
            backgroundColor:
              disabled || !canSend ? "#b5bfc8" : "#03182f",
            color: "#fff",
            cursor:
              disabled || !canSend ? "not-allowed" : "pointer",
            fontWeight: 500,
            fontSize: "14px",
            transition: "background-color 0.15s",
          }}
        >
          Send
        </button>
      </div>
    </form>
  );
};
