/**
 * The chat widget's input row: a growing textarea, send button (with answering
 * spinner), and optional file attachment picker with removable chips.
 *
 * Self-contained — it owns its own file/answering state and reports out through
 * the returned handle (`inputRow`, `setDisabled`, `focus`, `getValueAndClear`).
 * The caller wires `onSend` to the widget's send path.
 */

import {
  BORDER_COLOR,
  BRAND_COLOR,
  BRAND_TEXT_COLOR,
  css,
  div,
  FONT_VAR,
  PANEL_BACKGROUND,
} from "./styles";

interface BuildInputArgs {
  placeholder: string;
  allowFiles: boolean;
  onSend: (content: string, files?: File[]) => void;
  /**
   * Stop the turn being generated. When provided, the send button becomes an
   * enabled Stop button while the agent is answering instead of a dead spinner.
   */
  onStop?: () => void;
}

export function buildInput(args: BuildInputArgs): {
  inputRow: HTMLElement;
  getValueAndClear: () => { content: string; files: File[] };
  setDisabled: (disabled: boolean) => void;
  focus: () => void;
  restoreDraft: (content: string, files?: File[]) => void;
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
  // A placeholder is not an accessible name; label the field explicitly.
  textarea.setAttribute("aria-label", args.placeholder);
  textarea.rows = 1;
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
    maxHeight: "110px",
    overflowY: "hidden",
  });

  // Auto-grow the textarea to fit its content, capped at maxHeight (4 lines).
  // Leaves the resting (single-line) size untouched: it only sets an explicit
  // height once the content has actually been measured in the DOM. The +2 keeps
  // the border-box height matching the natural height (1px border top + bottom).
  const autoResize = (): void => {
    const max = 110;
    textarea.style.height = "auto";
    const target = Math.min(textarea.scrollHeight + 2, max);
    textarea.style.height = `${target}px`;
    textarea.style.overflowY =
      textarea.scrollHeight + 2 > max ? "auto" : "hidden";
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
  sendBtn.setAttribute("aria-label", "Send");
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

  let fileInput: HTMLInputElement | null = null;
  let attachBtn: HTMLButtonElement | null = null;
  if (args.allowFiles) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    css(fileInput, { display: "none" });
    attachBtn = document.createElement("button");
    attachBtn.type = "button";
    attachBtn.setAttribute("aria-label", "Attach file");
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
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.textContent = "×";
      css(remove, {
        // The chip stays visually small; only the hit area grows to 44px, with
        // negative margins so the layout is unchanged.
        flexShrink: "0",
        width: "44px",
        height: "44px",
        margin: "-14px -12px -14px -4px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
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
    refreshSendBtn();
  }

  const getValueAndClear = (): { content: string; files: File[] } => {
    const content = textarea.value;
    const collected = files;
    textarea.value = "";
    autoResize();
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
  };
}
