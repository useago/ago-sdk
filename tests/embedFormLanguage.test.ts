import { describe, expect, it } from "vitest";
import { createEmbedFormView } from "../src/widget/renderEmbedForm";
import { DEFAULT_TOOL_CALL_FORM_LABELS as labels } from "../src/widget/toolCallLabels";

describe("embedded ticket form language changes", () => {
  it("updates surrounding text while preserving the provider form and its draft", () => {
    const view = createEmbedFormView({ state: { status: "ready" }, embedHtml: '<form><input name="answer"></form>', labels, onSubmitted: () => {} });
    document.body.appendChild(view.el);
    try {
      const input = view.el.querySelector("input")!;
      input.value = "Provider draft";
      view.updateText({ labels, description: "Description française" });
      expect(view.el.textContent).toContain("Description française");
      expect(view.el.querySelector("input")).toBe(input);
      expect(input.value).toBe("Provider draft");
      view.updateText({ labels, description: "" });
      expect(view.el.textContent).not.toContain("Description française");
      expect(view.el.querySelector("input")).toBe(input);
    } finally {
      view.destroy();
      view.el.remove();
    }
  });
});
