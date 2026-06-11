import type { ClientFunctionDefinition } from "../functions/types";

/**
 * Show a toast/notification to the user.
 * The handler is a no-op by default — wire it up to your toast library.
 *
 * ```ts
 * import { showToast } from "@useago/sdk/helpers";
 * showToast.handler = async (args) => { myToast(args.message); return { shown: true }; };
 * client.registerFunction(showToast);
 * ```
 */
export const showToast: ClientFunctionDefinition = {
  name: "showToast",
  description:
    "Show a toast notification to the user. Use this to confirm actions or display brief messages.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "The message to display" },
      type: {
        type: "string",
        description: "Toast type",
        enum: ["success", "error", "warning", "info"],
      },
      duration: {
        type: "number",
        description: "Duration in milliseconds (default 3000)",
      },
    },
    required: ["message"],
  },
  handler: async () => ({ shown: false, error: "No toast handler configured" }),
};

/**
 * Show a browser notification (requires permission).
 */
export const showNotification: ClientFunctionDefinition = {
  name: "showNotification",
  description:
    "Show a browser notification to the user. Useful for important alerts even when the tab is not focused.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Notification title" },
      body: { type: "string", description: "Notification body text" },
    },
    required: ["title"],
  },
  handler: async (args) => {
    if (typeof Notification === "undefined") {
      return { shown: false, error: "Notifications not supported" };
    }
    if (Notification.permission === "denied") {
      return { shown: false, error: "Notification permission denied" };
    }
    if (Notification.permission !== "granted") {
      await Notification.requestPermission();
    }
    if (Notification.permission === "granted") {
      new Notification(args.title as string, { body: args.body as string });
      return { shown: true };
    }
    return { shown: false, error: "Permission not granted" };
  },
};

/**
 * Open a URL in a new tab.
 */
export const openUrl: ClientFunctionDefinition = {
  name: "openUrl",
  description: "Open a URL in a new browser tab.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to open" },
    },
    required: ["url"],
  },
  handler: async (args) => {
    window.open(args.url as string, "_blank", "noopener,noreferrer");
    return { opened: true };
  },
};

/**
 * Copy text to clipboard.
 */
export const copyToClipboard: ClientFunctionDefinition = {
  name: "copyToClipboard",
  description: "Copy text to the user's clipboard.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The text to copy" },
    },
    required: ["text"],
  },
  handler: async (args) => {
    await navigator.clipboard.writeText(args.text as string);
    return { copied: true };
  },
};

/**
 * Set the application theme (light/dark/system).
 * Default handler toggles a `data-theme` attribute on `<html>`.
 */
export const setTheme: ClientFunctionDefinition = {
  name: "setTheme",
  description:
    "Change the application's color theme. Sets a data-theme attribute on the document element.",
  parameters: {
    type: "object",
    properties: {
      theme: {
        type: "string",
        description: "Theme to apply",
        enum: ["light", "dark", "system"],
      },
    },
    required: ["theme"],
  },
  handler: async (args) => {
    const theme = args.theme as string;
    document.documentElement.setAttribute("data-theme", theme);
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    return { theme, applied: true };
  },
};

/**
 * Show a confirm dialog and return the user's choice.
 */
export const showConfirmDialog: ClientFunctionDefinition = {
  name: "showConfirmDialog",
  description:
    "Show a confirmation dialog to the user and return their choice (true/false).",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The confirmation message to display",
      },
    },
    required: ["message"],
  },
  handler: async (args) => {
    const confirmed = window.confirm(args.message as string);
    return { confirmed };
  },
};

/**
 * Get the user's geolocation.
 */
export const getUserLocation: ClientFunctionDefinition = {
  name: "getUserLocation",
  description:
    "Get the user's current geographic location (requires permission).",
  parameters: {
    type: "object",
    properties: {},
  },
  handler: async () => {
    if (!navigator.geolocation) {
      return { error: "Geolocation not supported" };
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        (err) => resolve({ error: err.message })
      );
    });
  },
};

/**
 * Scroll to an element on the page.
 */
export const scrollToElement: ClientFunctionDefinition = {
  name: "scrollToElement",
  description: "Scroll the page to a specific element identified by CSS selector.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the element to scroll to (e.g. '#section-pricing')",
      },
      behavior: {
        type: "string",
        description: "Scroll behavior",
        enum: ["smooth", "instant"],
      },
    },
    required: ["selector"],
  },
  handler: async (args) => {
    const el = document.querySelector(args.selector as string);
    if (!el) {
      return { scrolled: false, error: `Element not found: ${args.selector}` };
    }
    el.scrollIntoView({ behavior: (args.behavior as ScrollBehavior) || "smooth" });
    return { scrolled: true };
  },
};

/**
 * Set a value in localStorage.
 */
export const setLocalStorage: ClientFunctionDefinition = {
  name: "setLocalStorage",
  description: "Store a value in the browser's localStorage.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Storage key" },
      value: { type: "string", description: "Value to store" },
    },
    required: ["key", "value"],
  },
  handler: async (args) => {
    localStorage.setItem(args.key as string, args.value as string);
    return { stored: true };
  },
};

/**
 * Get a value from localStorage.
 */
export const getLocalStorage: ClientFunctionDefinition = {
  name: "getLocalStorage",
  description: "Retrieve a value from the browser's localStorage.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Storage key" },
    },
    required: ["key"],
  },
  handler: async (args) => {
    const value = localStorage.getItem(args.key as string);
    return { key: args.key, value, found: value !== null };
  },
};

/**
 * Highlight an element on the page (useful for guided tours).
 */
export const highlightElement: ClientFunctionDefinition = {
  name: "highlightElement",
  description:
    "Highlight a DOM element to draw the user's attention (e.g. for onboarding).",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the element to highlight",
      },
      color: {
        type: "string",
        description: "Highlight border color (default: #3b82f6)",
      },
    },
    required: ["selector"],
  },
  handler: async (args) => {
    const el = document.querySelector(args.selector as string) as HTMLElement | null;
    if (!el) {
      return { highlighted: false, error: `Element not found: ${args.selector}` };
    }
    const prev = el.style.outline;
    const color = (args.color as string) || "#3b82f6";
    el.style.outline = `3px solid ${color}`;
    el.style.outlineOffset = "2px";
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      el.style.outline = prev;
      el.style.outlineOffset = "";
    }, 3000);
    return { highlighted: true };
  },
};

/**
 * Submit a form on the page programmatically.
 */
export const submitForm: ClientFunctionDefinition = {
  name: "submitForm",
  description:
    "Fill and submit an HTML form on the page. Pass field values as key-value pairs.",
  parameters: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector of the form element",
      },
      values: {
        type: "string",
        description: "JSON string of field name → value pairs",
      },
    },
    required: ["selector"],
  },
  handler: async (args) => {
    const form = document.querySelector(args.selector as string) as HTMLFormElement | null;
    if (!form) {
      return { submitted: false, error: `Form not found: ${args.selector}` };
    }
    if (args.values) {
      const values = JSON.parse(args.values as string) as Record<string, string>;
      for (const [name, value] of Object.entries(values)) {
        const input = form.elements.namedItem(name) as HTMLInputElement | null;
        if (input) input.value = value;
      }
    }
    form.requestSubmit();
    return { submitted: true };
  },
};

/**
 * Track a custom analytics event.
 * Default handler logs to console — replace with your analytics provider.
 */
export const trackEvent: ClientFunctionDefinition = {
  name: "trackEvent",
  description:
    "Track a custom analytics event. Override the handler to wire up your analytics provider.",
  parameters: {
    type: "object",
    properties: {
      event: { type: "string", description: "Event name" },
      properties: {
        type: "string",
        description: "JSON string of event properties",
      },
    },
    required: ["event"],
  },
  handler: async (args) => {
    const props = args.properties ? JSON.parse(args.properties as string) : {};
    console.log(`[AGO Analytics] ${args.event}`, props);
    return { tracked: true, event: args.event };
  },
};
