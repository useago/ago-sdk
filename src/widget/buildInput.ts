/**
 * The chat widget's input row: a growing textarea, send button (with answering
 * spinner), and optional file attachment picker with removable chips.
 *
 * Self-contained — it owns its own file/answering state and reports out through
 * the returned handle (`inputRow`, `setDisabled`, `focus`, `getValueAndClear`).
 * The caller wires `onSend` to the widget's send path.
 *
 * Two looks: `classic` (inline and side placements, unchanged) and `embed`,
 * which reproduces the hosted widget's `PromptForm` card: a 24px-radius card
 * with a pale blue border, an italic placeholder, a 40px round send button
 * that becomes Stop while answering, image thumbnails on file chips, and the
 * reference's file limits (10 MB, 5 files, an allow-list of types).
 */

import {
  arrowUpwardIcon,
  attachFileIcon,
  closeIcon,
  descriptionIcon,
  stopIcon,
} from "./icons";
import {
  BORDER_COLOR,
  BRAND_COLOR,
  BRAND_TEXT_COLOR,
  css,
  div,
  FONT_VAR,
  PANEL_BACKGROUND,
  PRIMARY_FOREGROUND,
  SEND_BACKGROUND,
  SHADOW,
} from "./styles";

export type InputLook = "classic" | "embed";

/** Strings the embed composer shows; `{max}` / `{name}` are substituted. */
export interface InputLabels {
  attachFiles: string;
  dismiss: string;
  tooManyFiles: string;
  invalidFileType: string;
  fileTooLarge: string;
}

interface BuildInputArgs {
  placeholder: string;
  allowFiles: boolean;
  onSend: (content: string, files?: File[]) => void;
  /**
   * Stop the turn being generated. When provided, the send button becomes an
   * enabled Stop button while the agent is answering instead of a dead spinner.
   */
  onStop?: () => void;
  /** Visual preset. Defaults to `classic`. */
  look?: InputLook;
  /** Required for the `embed` look's file errors and button names. */
  labels?: InputLabels;
  /**
   * Embed look only: below this viewport width the textarea blurs on submit so
   * the on-screen keyboard closes. Defaults to 600 (the reference's cutoff).
   */
  blurOnSubmitBelow?: number;
}

export interface InputHandle {
  inputRow: HTMLElement;
  getValueAndClear: () => { content: string; files: File[] };
  setDisabled: (disabled: boolean) => void;
  focus: () => void;
  blur: () => void;
  restoreDraft: (content: string, files?: File[]) => void;
  /** Swap the placeholder (the bubble widget uses one per screen). */
  setPlaceholder: (text: string) => void;
}

/** The reference's upload constraints (`prompt-form.tsx`). */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_FILES = 5;
export const ALLOWED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-word.document.macroenabled.12",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
  "text/html",
  "application/epub+zip",
];

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildInput(args: BuildInputArgs): InputHandle {
  const embed = args.look === "embed";
  let files: File[] = [];
  /** Object URLs for image thumbnails, revoked when the chip goes away. */
  const thumbUrls = new Map<File, string>();

  const form = document.createElement("form");
  form.className = embed ? "ago-chat-input ago-chat-input--embed" : "ago-chat-input";
  if (embed) {
    css(form, {
      width: "100%",
      borderRadius: "24px",
      border: `2px solid ${PRIMARY_FOREGROUND}`,
      backgroundColor: "#fff",
      boxShadow: SHADOW,
      position: "relative",
      boxSizing: "border-box",
      display: "block",
      fontFamily: FONT_VAR,
    });
  } else {
    css(form, {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      padding: "12px",
      borderTop: `1px solid ${BORDER_COLOR}`,
      backgroundColor: PANEL_BACKGROUND,
    });
  }

  // Embed: hidden while empty so it adds no height to the resting card
  // (the reference card is exactly 16px padding + 40px editor + 16px).
  const fileList = div(
    embed
      ? { display: "none", flexWrap: "wrap", gap: "8px", padding: "0 0 8px" }
      : { display: "flex", flexWrap: "wrap", gap: "6px" },
  );
  fileList.className = "ago-chat-input__files";

  const row = div(
    embed
      ? { display: "flex", flexDirection: "row", gap: "8px", padding: "16px" }
      : { display: "flex", gap: "8px", alignItems: "flex-end" },
  );

  const textarea = document.createElement("textarea");
  textarea.placeholder = args.placeholder;
  // A placeholder is not an accessible name; label the field explicitly.
  textarea.setAttribute("aria-label", args.placeholder);
  textarea.rows = 1;
  textarea.autocapitalize = "off";
  textarea.setAttribute("autocorrect", "off");
  const MAX_H = embed ? 208 : 110;
  if (embed) {
    css(textarea, {
      display: "block",
      width: "100%",
      minHeight: "40px",
      maxHeight: `${MAX_H}px`,
      overflowY: "auto",
      resize: "none",
      border: "none",
      outline: "none",
      boxShadow: "none",
      background: "transparent",
      padding: "8px",
      boxSizing: "border-box",
      // Keep at >=16px: iOS Safari auto-zooms the page when a focused field is
      // smaller
      fontSize: "16px",
      lineHeight: "24px",
      fontFamily: "inherit",
      color: "inherit",
    });
  } else {
    css(textarea, {
      flex: "1",
      resize: "none",
      boxSizing: "border-box",
      padding: "10px 12px",
      border: `1px solid ${BORDER_COLOR}`,
      borderRadius: "12px",
      // Keep at >=16px: iOS Safari auto-zooms the page when a focused field is
      // smaller
      fontSize: "16px",
      fontFamily: FONT_VAR,
      lineHeight: "1.4",
      // Grow with content up to 4 lines (16px * 1.4 * 4 + 20px padding), then scroll
      maxHeight: `${MAX_H}px`,
      overflowY: "hidden",
    });
  }

  // Auto-grow the textarea to fit its content, capped at maxHeight. Leaves the
  // resting (single-line) size untouched: it only sets an explicit height once
  // the content has actually been measured in the DOM. The +2 keeps the
  // border-box height matching the natural height (1px border top + bottom).
  const autoResize = (): void => {
    const extra = embed ? 0 : 2;
    textarea.style.height = "auto";
    const target = Math.min(textarea.scrollHeight + extra, MAX_H);
    textarea.style.height = `${target}px`;
    textarea.style.overflowY =
      textarea.scrollHeight + extra > MAX_H ? "auto" : "hidden";
  };
  textarea.addEventListener("input", () => {
    autoResize();
    refreshSendBtn();
  });

  // Inline icons (no font/icon-lib dependency). Both use `currentColor` so they
  // inherit the button's BRAND_TEXT_COLOR, keeping the `theme.brandText` contract.
  const ARROW_ICON =
    '<svg width="18" height="18" viewBox="0 -960 960 960" fill="currentColor" ' +
    'aria-hidden="true"><path d="M440-160v-487L216-423l-56-57 320-320 320 320-56 ' +
    '57-224-224v487h-80Z"/></svg>';
  const SPINNER_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'aria-hidden="true" style="animation: ago-spin 0.8s linear infinite">' +
    '<path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
  const STOP_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" ' +
    'aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';

  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.className = "ago-chat-input__send";
  sendBtn.setAttribute("aria-label", "Send");
  if (embed) {
    css(sendBtn, {
      flexShrink: "0",
      width: "40px",
      height: "40px",
      padding: "0",
      border: "none",
      borderRadius: "50%",
      backgroundColor: SEND_BACKGROUND,
      color: "#fafafa",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      transition: "background-color 0.15s, color 0.15s",
    });
  } else {
    sendBtn.innerHTML = ARROW_ICON;
    css(sendBtn, {
      flexShrink: "0",
      // 44px is Apple's HIG minimum touch target. At 40 this was the single most
      // tapped control in the widget sitting under the threshold.
      width: "44px",
      height: "44px",
      padding: "0",
      border: "none",
      borderRadius: "50%",
      backgroundColor: BRAND_COLOR,
      color: BRAND_TEXT_COLOR,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
    });
  }

  // While the agent is answering the same slot becomes Stop (when the caller
  // wired `onStop`) — enabled, since stopping is the only thing left to do.
  // Without `onStop` it stays a disabled spinner, as before. Otherwise the send
  // button is disabled when there's nothing to send, matching `submit()`.
  let answering = false;
  const canStop = (): boolean => answering && !!args.onStop;
  const refreshSendBtn = (): void => {
    const hasContent = textarea.value.trim() !== "" || files.length > 0;
    const stopping = canStop();
    const disabled = !stopping && (answering || !hasContent);
    sendBtn.disabled = disabled;
    // `type` drives the click: a submit button would send instead of stopping.
    sendBtn.type = stopping ? "button" : "submit";
    sendBtn.setAttribute("aria-label", stopping ? "Stop generating" : "Send");
    if (embed) {
      sendBtn.replaceChildren(
        stopping ? stopIcon({ size: 16 }) : arrowUpwardIcon({ size: 16 }),
      );
      // Tailwind `disabled:` on the primary button: a slate-100 disc with a
      // slate-300 glyph, no pointer events.
      const inactive = disabled && !answering;
      sendBtn.style.backgroundColor = inactive ? "#f1f5f9" : SEND_BACKGROUND;
      sendBtn.style.color = inactive ? "#cbd5e1" : "#fafafa";
      sendBtn.style.pointerEvents = disabled ? "none" : "auto";
      sendBtn.style.cursor = disabled ? "default" : "pointer";
      // Dim the editor column while an answer streams (reference `opacity-50`).
      leftCol.style.opacity = answering ? "0.5" : "1";
      return;
    }
    sendBtn.innerHTML = stopping
      ? STOP_ICON
      : answering
        ? SPINNER_ICON
        : ARROW_ICON;
    sendBtn.style.opacity = disabled && !answering ? "0.5" : "1";
    sendBtn.style.cursor = disabled ? "default" : "pointer";
  };

  sendBtn.addEventListener("click", () => {
    if (canStop()) args.onStop?.();
  });

  // Embed look: a file error banner above the editor, dismissible.
  const errorBox = div({
    display: "none",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "8px",
    margin: "0 0 12px",
    padding: "12px 16px",
    borderRadius: "12px",
    border: "1px solid rgba(239, 68, 68, 0.5)",
    color: "#ef4444",
    backgroundColor: "#fff",
    fontSize: "14px",
    lineHeight: "20px",
  });
  errorBox.className = "ago-chat-input__error";
  errorBox.setAttribute("role", "alert");
  const errorText = document.createElement("span");
  const errorDismiss = document.createElement("button");
  errorDismiss.type = "button";
  errorDismiss.textContent = args.labels?.dismiss ?? "Dismiss";
  css(errorDismiss, {
    border: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    fontWeight: "500",
    cursor: "pointer",
    padding: "0",
    minHeight: "20px",
  });
  errorDismiss.addEventListener("click", () => {
    errorBox.style.display = "none";
  });
  errorBox.append(errorText, errorDismiss);
  const showFileError = (text: string): void => {
    errorText.textContent = text;
    errorBox.style.display = "flex";
  };

  const fill = (template: string, vars: Record<string, string>): string =>
    template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");

  /** The reference's checks, in its order: count, type, size. */
  const acceptFiles = (incoming: File[]): File[] => {
    if (!embed) return incoming;
    const labels = args.labels;
    const accepted: File[] = [];
    for (const file of incoming) {
      if (files.length + accepted.length >= MAX_FILES) {
        showFileError(
          fill(labels?.tooManyFiles ?? "Too many files. Maximum allowed: {max}", {
            max: String(MAX_FILES),
          }),
        );
        break;
      }
      if (file.type && !ALLOWED_FILE_TYPES.includes(file.type)) {
        showFileError(
          fill(labels?.invalidFileType ?? "Invalid file type: {name}", {
            name: file.name,
          }),
        );
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        showFileError(
          fill(labels?.fileTooLarge ?? "File too large: {name} (maximum {max})", {
            name: file.name,
            max: humanSize(MAX_FILE_SIZE),
          }),
        );
        continue;
      }
      accepted.push(file);
    }
    return accepted;
  };

  let fileInput: HTMLInputElement | null = null;
  let attachBtn: HTMLButtonElement | null = null;
  if (args.allowFiles) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    if (embed) fileInput.accept = ALLOWED_FILE_TYPES.join(",");
    css(fileInput, { display: "none" });
    attachBtn = document.createElement("button");
    attachBtn.type = "button";
    attachBtn.className = "ago-chat-input__attach";
    attachBtn.setAttribute(
      "aria-label",
      args.labels?.attachFiles ?? "Attach file",
    );
    if (embed) {
      attachBtn.appendChild(attachFileIcon({ size: 16 }));
      css(attachBtn, {
        height: "40px",
        padding: "8px",
        display: "flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "14px",
        color: BRAND_COLOR,
        background: "none",
        border: "none",
        cursor: "pointer",
        borderRadius: "6px",
      });
    } else {
      attachBtn.textContent = "📎";
      css(attachBtn, {
        flexShrink: "0",
        minWidth: "44px",
        minHeight: "44px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 12px",
        border: `1px solid ${BORDER_COLOR}`,
        borderRadius: "12px",
        backgroundColor: PANEL_BACKGROUND,
        cursor: "pointer",
        fontSize: "14px",
      });
    }
    attachBtn.addEventListener("click", () => fileInput?.click());
    fileInput.addEventListener("change", () => {
      const picked = Array.from(fileInput?.files ?? []);
      files = [...files, ...acceptFiles(picked)];
      if (fileInput) fileInput.value = "";
      renderFiles();
    });
  }

  function thumbFor(file: File): string | null {
    if (!embed || !file.type.startsWith("image/")) return null;
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      return null;
    }
    let url = thumbUrls.get(file);
    if (!url) {
      url = URL.createObjectURL(file);
      thumbUrls.set(file, url);
    }
    return url;
  }
  function dropThumb(file: File): void {
    const url = thumbUrls.get(file);
    if (url) {
      URL.revokeObjectURL(url);
      thumbUrls.delete(file);
    }
  }

  function renderFiles(): void {
    fileList.replaceChildren();
    if (embed) fileList.style.display = files.length > 0 ? "flex" : "none";
    files.forEach((file, i) => {
      const chip = div(
        embed
          ? {
              display: "flex",
              alignItems: "center",
              gap: "8px",
              backgroundColor: "#f3f4f6",
              borderRadius: "8px",
              padding: "8px 12px",
              fontSize: "14px",
              lineHeight: "20px",
            }
          : {
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              backgroundColor: "#f0f4ff",
              border: `1px solid ${BORDER_COLOR}`,
              borderRadius: "8px",
              fontSize: "12px",
            },
      );
      chip.className = "ago-chat-input__file";
      if (embed) {
        const thumb = thumbFor(file);
        if (thumb) {
          const img = document.createElement("img");
          img.src = thumb;
          img.alt = "";
          css(img, {
            width: "32px",
            height: "32px",
            objectFit: "cover",
            borderRadius: "4px",
            flexShrink: "0",
          });
          chip.appendChild(img);
        } else {
          chip.appendChild(descriptionIcon({ size: 20 }));
        }
      }
      const name = document.createElement("span");
      name.textContent = file.name;
      name.title = file.name;
      if (embed) {
        css(name, {
          maxWidth: "150px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        });
      }
      chip.appendChild(name);
      if (embed) {
        const size = document.createElement("span");
        size.textContent = humanSize(file.size);
        css(size, { fontSize: "12px", lineHeight: "16px", color: "#6b7280" });
        chip.appendChild(size);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      if (embed) remove.appendChild(closeIcon({ size: 16 }));
      else remove.textContent = "×";
      css(remove, {
        // The chip stays visually small; only the hit area grows to 44px, with
        // negative margins so the layout is unchanged.
        flexShrink: "0",
        width: "44px",
        height: "44px",
        margin: embed ? "-10px -16px -10px -8px" : "-14px -12px -14px -4px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontSize: "14px",
        lineHeight: "1",
        color: "inherit",
      });
      remove.addEventListener("click", () => {
        dropThumb(file);
        files = files.filter((_, idx) => idx !== i);
        renderFiles();
      });
      chip.appendChild(remove);
      fileList.appendChild(chip);
    });
    refreshSendBtn();
  }

  const getValueAndClear = (): { content: string; files: File[] } => {
    const content = textarea.value;
    const collected = files;
    textarea.value = "";
    autoResize();
    files = [];
    for (const f of collected) dropThumb(f);
    renderFiles();
    return { content, files: collected };
  };

  const submit = (): void => {
    const { content, files: collected } = getValueAndClear();
    if (content.trim() || collected.length > 0) {
      args.onSend(content.trim(), collected.length > 0 ? collected : undefined);
      // Close the on-screen keyboard on a phone (reference: `innerWidth < 600`).
      if (
        embed &&
        typeof window !== "undefined" &&
        window.innerWidth < (args.blurOnSubmitBelow ?? 600)
      ) {
        textarea.blur();
      }
    }
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // An IME is still composing (Japanese, Chinese, ...): Enter confirms the
      // candidate, it does not send.
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      submit();
    }
  });

  // Embed layout: [ left column: files / textarea / toolbar ] [ send ].
  const leftCol = div({ flex: "1", minWidth: "0" });
  leftCol.className = "ago-chat-input__editor";
  if (embed) {
    // The error banner lives in the editor column and is display:none until a
    // file is rejected, so the resting card stays 16px + 40px + 16px tall.
    leftCol.append(errorBox, fileList, textarea);
    const toolbar = div({ display: "flex", alignItems: "center" });
    toolbar.className = "ago-chat-input__toolbar";
    if (attachBtn) toolbar.appendChild(attachBtn);
    if (attachBtn) leftCol.appendChild(toolbar);
    const rightCol = div({
      display: "flex",
      alignItems: "flex-end",
      flexShrink: "0",
    });
    rightCol.appendChild(sendBtn);
    row.append(leftCol, rightCol);
    if (fileInput) form.appendChild(fileInput);
    form.appendChild(row);
    // Clicking anywhere on the card focuses the editor (reference `onClick`).
    form.addEventListener("click", (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("button,a,input,textarea")) return;
      textarea.focus();
    });
  } else {
    if (attachBtn) row.appendChild(attachBtn);
    row.append(textarea, sendBtn);
    if (fileInput) form.appendChild(fileInput);
    form.append(fileList, row);
  }

  // Start disabled: the input is empty on mount.
  refreshSendBtn();

  return {
    inputRow: form,
    getValueAndClear,
    setDisabled: (disabled: boolean) => {
      textarea.disabled = disabled;
      // The send button also stays disabled when the input is empty; let
      // refreshSendBtn reconcile the answering state with content presence.
      answering = disabled;
      refreshSendBtn();
    },
    focus: () => textarea.focus(),
    blur: () => textarea.blur(),
    /**
     * Put a failed send back into the composer.
     *
     * `submit` clears the field before the request goes out so the UI feels
     * instant. The cost is that a rejected send would otherwise destroy the
     * user's text with no way to get it back — on a phone, on a flaky
     * connection, that means retyping the whole message from scratch.
     *
     * Skipped when the user has already started typing something new, so
     * restoring can never clobber live input.
     */
    restoreDraft: (content: string, restored?: File[]) => {
      if (content && !textarea.value.trim()) {
        textarea.value = content;
        autoResize();
      }
      if (restored?.length) {
        files = [...restored, ...files];
        renderFiles();
      }
      refreshSendBtn();
    },
    setPlaceholder: (text: string) => {
      textarea.placeholder = text;
      if (text) textarea.setAttribute("aria-label", text);
    },
  };
}
