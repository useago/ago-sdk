import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatInput } from "../src/react/components/ChatInput";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function type(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("ChatInput attachments", () => {
  it.each(["", " \n\t "])("keeps files until text is added to a blank draft %j", async (content) => {
    const onSend = vi.fn();
    await act(async () => root.render(<ChatInput allowFiles onSend={onSend} />));
    const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
    const textarea = container.querySelector("textarea")!;
    const send = container.querySelector<HTMLButtonElement>("button[type=submit]")!;
    const form = container.querySelector("form")!;
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await type(textarea, content);

    expect(send.disabled).toBe(true);
    await act(async () => {
      send.click();
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(container.textContent).toContain("note.txt");

    await type(textarea, "Analyze this");
    expect(send.disabled).toBe(false);
    await act(async () => send.click());
    expect(onSend).toHaveBeenCalledExactlyOnceWith("Analyze this", [file]);
    expect(textarea.value).toBe("");
    expect(container.textContent).not.toContain("note.txt");
  });
});
