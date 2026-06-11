import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  showToast,
  showNotification,
  openUrl,
  copyToClipboard,
  setTheme,
  showConfirmDialog,
  scrollToElement,
  setLocalStorage,
  getLocalStorage,
  highlightElement,
  trackEvent,
} from "../src/helpers/functions";

describe("Pre-built function helpers", () => {
  describe("showToast", () => {
    it("has correct schema", () => {
      expect(showToast.name).toBe("showToast");
      expect(showToast.parameters.required).toContain("message");
    });

    it("default handler returns not configured", async () => {
      const result = await showToast.handler({ message: "hi" });
      expect(result).toEqual({ shown: false, error: "No toast handler configured" });
    });
  });

  describe("openUrl", () => {
    it("opens a URL in a new tab", async () => {
      const spy = vi.fn();
      vi.stubGlobal("open", spy);
      await openUrl.handler({ url: "https://example.com" });
      expect(spy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
      vi.unstubAllGlobals();
    });
  });

  describe("copyToClipboard", () => {
    it("copies text", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      const result = await copyToClipboard.handler({ text: "hello" });
      expect(writeText).toHaveBeenCalledWith("hello");
      expect(result).toEqual({ copied: true });
    });
  });

  describe("setTheme", () => {
    it("sets data-theme attribute", async () => {
      const result = await setTheme.handler({ theme: "dark" });
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(result).toEqual({ theme: "dark", applied: true });
    });

    it("removes dark class for light theme", async () => {
      document.documentElement.classList.add("dark");
      await setTheme.handler({ theme: "light" });
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  describe("showConfirmDialog", () => {
    it("returns user choice", async () => {
      vi.stubGlobal("confirm", () => true);
      const result = await showConfirmDialog.handler({ message: "Sure?" });
      expect(result).toEqual({ confirmed: true });
      vi.unstubAllGlobals();
    });
  });

  describe("scrollToElement", () => {
    it("returns error if element not found", async () => {
      const result = await scrollToElement.handler({ selector: "#nonexistent" });
      expect(result).toEqual({ scrolled: false, error: "Element not found: #nonexistent" });
    });

    it("scrolls to element if found", async () => {
      const el = document.createElement("div");
      el.id = "test-scroll";
      el.scrollIntoView = vi.fn();
      document.body.appendChild(el);
      const result = await scrollToElement.handler({ selector: "#test-scroll" });
      expect(result).toEqual({ scrolled: true });
      expect(el.scrollIntoView).toHaveBeenCalled();
      el.remove();
    });
  });

  describe("setLocalStorage / getLocalStorage", () => {
    beforeEach(() => localStorage.clear());

    it("stores and retrieves a value", async () => {
      await setLocalStorage.handler({ key: "foo", value: "bar" });
      const result = await getLocalStorage.handler({ key: "foo" });
      expect(result).toEqual({ key: "foo", value: "bar", found: true });
    });

    it("returns found: false for missing key", async () => {
      const result = await getLocalStorage.handler({ key: "missing" });
      expect(result).toEqual({ key: "missing", value: null, found: false });
    });
  });

  describe("highlightElement", () => {
    it("returns error for missing element", async () => {
      const result = await highlightElement.handler({ selector: "#nope" });
      expect(result).toEqual({ highlighted: false, error: "Element not found: #nope" });
    });
  });

  describe("trackEvent", () => {
    it("logs event to console", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const result = await trackEvent.handler({ event: "click", properties: '{"button":"buy"}' });
      expect(result).toEqual({ tracked: true, event: "click" });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("showNotification", () => {
    it("has correct schema", () => {
      expect(showNotification.name).toBe("showNotification");
      expect(showNotification.parameters.required).toContain("title");
    });
  });
});
