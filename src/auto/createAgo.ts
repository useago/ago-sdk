import { AgoClient } from "../client/AgoClient";
import type { AgoConfig } from "../client/types";

/**
 * Auto-detect AGO configuration from the DOM environment.
 *
 * Checks (in order of priority):
 * 1. `window.AGO` global object (widget config)
 * 2. `<meta>` tags: `<meta name="ago-api-key" content="...">`
 * 3. `data-ago-*` attributes on `<body>` or `<script data-ago-api-key="...">`
 * 4. Explicit overrides passed as argument
 *
 * Returns null if no API key can be found.
 */
export function autoDetectConfig(
  overrides?: Partial<AgoConfig>
): AgoConfig | null {
  let baseUrl: string | undefined;
  let widgetId: string | undefined;
  let agent: string | undefined;
  let permission: string | undefined;
  let userEmail: string | undefined;
  let userJwt: string | undefined;

  // 1. window.AGO (widget config format)
  if (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).AGO) {
    const ago = (window as unknown as Record<string, unknown>).AGO as Record<string, unknown>;
    baseUrl = ago.basepath as string | undefined;
    widgetId = ago.widgetId as string | undefined;
    agent = (ago.agent as string | undefined) || (ago.defaultAgent as string | undefined);
    permission = ago.permission as string | undefined;
    userEmail = ago.email as string | undefined;
    userJwt = ago.jwt as string | undefined;
  }

  // 2. Meta tags
  if (typeof document !== "undefined") {
    const getMeta = (name: string) =>
      document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") || undefined;

    baseUrl = baseUrl || getMeta("ago-base-url");
    widgetId = widgetId || getMeta("ago-widget-id");
    agent = agent || getMeta("ago-agent") || getMeta("ago-agent-id");
    permission = permission || getMeta("ago-permission");
    userEmail = userEmail || getMeta("ago-user-email");
  }

  // 3. data-ago-* attributes on body or script tags
  if (typeof document !== "undefined") {
    const sources = [
      document.body,
      ...Array.from(document.querySelectorAll("script[data-ago-base-url]")),
    ].filter(Boolean);

    for (const el of sources) {
      if (!el) continue;
      baseUrl = baseUrl || el.getAttribute("data-ago-base-url") || undefined;
      widgetId = widgetId || el.getAttribute("data-ago-widget-id") || undefined;
      agent = agent || el.getAttribute("data-ago-agent") || el.getAttribute("data-ago-agent-id") || undefined;
      permission = permission || el.getAttribute("data-ago-permission") || undefined;
      userEmail = userEmail || el.getAttribute("data-ago-user-email") || undefined;
    }
  }

  // 4. Apply overrides
  baseUrl = overrides?.baseUrl || baseUrl;
  widgetId = overrides?.widgetId || widgetId;
  agent = overrides?.agent || overrides?.defaultAgentId || agent;
  permission = overrides?.permission || permission;
  userEmail = overrides?.userEmail || userEmail;
  userJwt = overrides?.userJwt || userJwt;
  const debug = overrides?.debug;

  if (!baseUrl) {
    return null;
  }

  return {
    baseUrl,
    widgetId,
    agent,
    permission,
    userEmail,
    userJwt,
    debug,
  };
}

/**
 * Create an AgoClient with zero configuration.
 * Auto-detects config from window.AGO, meta tags, and data-ago-* attributes.
 *
 * ```html
 * <!-- In your HTML -->
 * <meta name="ago-base-url" content="https://YOUR-DOMAIN.useago.com">
 *
 * <!-- Or on a script tag -->
 * <script src="app.js" data-ago-base-url="https://YOUR-DOMAIN.useago.com"></script>
 * ```
 *
 * ```ts
 * import { createAgo } from "@useago/sdk";
 *
 * // Zero config — picks up from DOM
 * const client = createAgo();
 *
 * // Or with partial overrides
 * const client = createAgo({ debug: true });
 * ```
 *
 * Throws if no base URL can be detected.
 */
export function createAgo(overrides?: Partial<AgoConfig>): AgoClient {
  const config = autoDetectConfig(overrides);

  if (!config) {
    throw new Error(
      "createAgo(): could not detect AGO configuration. " +
        "Set window.AGO, add <meta name=\"ago-base-url\">, or pass { baseUrl } explicitly."
    );
  }

  return new AgoClient(config);
}
