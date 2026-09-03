import { describe, expect, it, vi } from "vitest";
import { buildInput, MAX_FILES, MAX_FILE_SIZE } from "../src/widget/buildInput";

const labels = {
  attachFiles: "Attach files",
  dismiss: "Dismiss",
  tooManyFiles: "Too many files. Maximum allowed: {max}",
  invalidFileType: "Invalid file type: {name}",
  fileTooLarge: "File too large: {name} (maximum {max})",
};

function build(extra: Partial<Parameters<typeof buildInput>[0]> = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const handle = buildInput({
    placeholder: "Ask a question",
    allowFiles: true,
    onSend,
    onStop,
    look: "embed",
    labels,
    ...extra,
  });
  document.body.appendChild(handle.inputRow);
  const textarea = handle.inputRow.querySelector("textarea")!;
  const send = handle.inputRow.querySelector<HTMLButtonElement>(".ago-chat-input__send")!;
  const fileInput = handle.inputRow.querySelector<HTMLInputElement>("input[type=file]")!;
  return { handle, onSend, onStop, textarea, send, fileInput };
}

function pick(fileInput: HTMLInputElement, files: File[]): void {
  Object.defineProperty(fileInput, "files", { value: files, configurable: true });
  fileInput.dispatchEvent(new Event("change"));
}

function type(textarea: HTMLTextAreaElement, value: string): void {
  textarea.value = value;
  textarea.dispatchEvent(new Event("input"));
}

describe("buildInput (embed look)", () => {
  it("renders the PromptForm card and a 40px round send button, disabled when empty", () => {
    const { handle, send, textarea } = build();
    const form = handle.inputRow;
    expect(form.className).toContain("ago-chat-input--embed");
    expect(form.style.borderRadius).toBe("24px");
    expect(form.style.borderWidth).toBe("2px");
    // jsdom normalizes hex colors to rgb().
    expect(form.style.borderColor).toBe("rgb(227, 237, 255)");
    expect(send.style.width).toBe("40px");
    expect(send.style.height).toBe("40px");
    expect(send.disabled).toBe(true);
    // jsdom normalizes hex colors to rgb().
    expect(send.style.backgroundColor).toBe("rgb(241, 245, 249)");
    expect(parseFloat(textarea.style.fontSize)).toBeGreaterThanOrEqual(16);
    type(textarea, "hi");
    expect(send.disabled).toBe(false);
    expect(send.style.backgroundColor).toContain("--ago-send-button-background");
    handle.inputRow.remove();
  });

  it("adds nothing above the editor at rest: file list and error banner hidden", () => {
    const { handle, textarea, fileInput } = build();
    const files = handle.inputRow.querySelector<HTMLElement>(".ago-chat-input__files")!;
    const error = handle.inputRow.querySelector<HTMLElement>(".ago-chat-input__error")!;
    expect(files.style.display).toBe("none");
    expect(error.style.display).toBe("none");
    // The editor column holds only hidden blocks before the textarea.
    const column = textarea.parentElement!;
    const before = Array.from(column.children).slice(0, column.children.length);
    const visibleBeforeTextarea = before
      .slice(0, before.indexOf(textarea))
      .filter((el) => (el as HTMLElement).style.display !== "none");
    expect(visibleBeforeTextarea).toHaveLength(0);
    // Picking a file reveals the list, removing it hides it again.
    pick(fileInput, [new File(["x"], "a.txt", { type: "text/plain" })]);
    expect(files.style.display).toBe("flex");
    handle.inputRow.querySelector<HTMLButtonElement>(".ago-chat-input__file button")!.click();
    expect(files.style.display).toBe("none");
    handle.inputRow.remove();
  });

  it("becomes a Stop button while answering and calls onStop", () => {
    const { handle, send, onStop } = build();
    handle.setDisabled(true);
    expect(send.getAttribute("aria-label")).toBe("Stop generating");
    expect(send.disabled).toBe(false);
    send.click();
    expect(onStop).toHaveBeenCalledTimes(1);
    handle.setDisabled(false);
    expect(send.getAttribute("aria-label")).toBe("Send");
    handle.inputRow.remove();
  });

  it("sends on Enter, inserts a newline on Shift+Enter, ignores a composing Enter", () => {
    const { handle, textarea, onSend } = build();
    type(textarea, "hello");
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
    );
    expect(onSend).not.toHaveBeenCalled();
    const composing = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    Object.defineProperty(composing, "isComposing", { value: true });
    textarea.dispatchEvent(composing);
    expect(onSend).not.toHaveBeenCalled();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSend).toHaveBeenCalledWith("hello", undefined);
    expect(textarea.value).toBe("");
    handle.inputRow.remove();
  });

  it("swaps the placeholder", () => {
    const { handle, textarea } = build();
    expect(textarea.placeholder).toBe("Ask a question");
    handle.setPlaceholder("");
    expect(textarea.placeholder).toBe("");
    expect(textarea.getAttribute("aria-label")).toBe("Ask a question");
    handle.inputRow.remove();
  });

  it("rejects a sixth file and an oversized file with a dismissible alert", () => {
    const { handle, fileInput } = build();
    const ok = (name: string) => new File(["x"], name, { type: "text/plain" });
    pick(fileInput, Array.from({ length: MAX_FILES + 1 }, (_, i) => ok(`f${i}.txt`)));
    const chips = handle.inputRow.querySelectorAll(".ago-chat-input__file");
    expect(chips).toHaveLength(MAX_FILES);
    const alert = handle.inputRow.querySelector<HTMLElement>(".ago-chat-input__error")!;
    expect(alert.style.display).toBe("flex");
    expect(alert.textContent).toContain(`Maximum allowed: ${MAX_FILES}`);
    alert.querySelector("button")!.click();
    expect(alert.style.display).toBe("none");

    // Fresh composer for the size check.
    const second = build();
    const big = new File(["x"], "big.txt", { type: "text/plain" });
    Object.defineProperty(big, "size", { value: MAX_FILE_SIZE + 1 });
    pick(second.fileInput, [big]);
    expect(second.handle.inputRow.querySelectorAll(".ago-chat-input__file")).toHaveLength(0);
    expect(
      second.handle.inputRow.querySelector(".ago-chat-input__error")!.textContent,
    ).toContain("File too large: big.txt");
    second.handle.inputRow.remove();
    handle.inputRow.remove();
  });

  it("rejects a disallowed type", () => {
    const { handle, fileInput } = build();
    pick(fileInput, [new File(["x"], "app.exe", { type: "application/x-msdownload" })]);
    expect(handle.inputRow.querySelectorAll(".ago-chat-input__file")).toHaveLength(0);
    expect(handle.inputRow.querySelector(".ago-chat-input__error")!.textContent).toContain(
      "Invalid file type: app.exe",
    );
    handle.inputRow.remove();
  });
});
