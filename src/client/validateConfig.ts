import { AgoError } from "./errors";
import type { AgoConfig } from "./types";

const BASE_URL_HINT =
  '`baseUrl` is required, e.g. new AgoClient({ baseUrl: "https://YOUR-DOMAIN.api.useago.com" }). ' +
  "Try the live demo endpoint https://ago.api.useago.com. " +
  "See docs/general/configuration.md#error-codes (config_missing_base_url).";

// Matches any explicit scheme (https://, capacitor://, chrome-extension://, ...).
// Values with a scheme are trusted: custom schemes are legitimate in embedded
// contexts (mobile webviews, browser extensions).
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

// The suspect-baseUrl warning fires at most once per process: it is advisory
// console text (not programmatically detectable, by design) and repeating it
// for every construction would spam host apps and their test suites.
let warnedSuspectBaseUrl = false;

/** Test-only: reset the once-per-process warning latch. */
export function __resetSuspectBaseUrlWarning(): void {
  warnedSuspectBaseUrl = false;
}

/**
 * Validate an AgoConfig at the public API boundary.
 *
 * Rules:
 * - nullish / non-object config, or a missing/empty/non-string `baseUrl`,
 *   throws `AgoError` with the stable code `config_missing_base_url`.
 * - Values starting with `/` are allowed (same-origin proxy paths like
 *   `/ago-proxy` are a supported embed pattern).
 * - Values with any `scheme://` are allowed.
 * - Anything else (no scheme, no leading slash, e.g. "ago.api.useago.com")
 *   warns once per process — it usually means a forgotten protocol. It does
 *   not throw: the request fails at send time with a runtime-specific error
 *   (Node: URL parse error; browser: relative fetch), and a hard throw here
 *   could break embeds we cannot foresee.
 *
 * The warning never echoes the configured value: misconfigured baseUrls
 * sometimes carry credentials (e.g. `https://user:token@host`).
 *
 * @param context Prefix for the error message, naming the API the developer
 *   actually called (e.g. "AgoClient", "createAgo()").
 */
export function validateConfig(
  config: unknown,
  context = "AgoClient"
): asserts config is AgoConfig {
  if (typeof config !== "object" || config === null) {
    throw new AgoError(`${context}: ${BASE_URL_HINT}`, "config_missing_base_url");
  }

  const baseUrl = (config as { baseUrl?: unknown }).baseUrl;

  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new AgoError(`${context}: ${BASE_URL_HINT}`, "config_missing_base_url");
  }

  if (!baseUrl.startsWith("/") && !HAS_SCHEME.test(baseUrl)) {
    if (!warnedSuspectBaseUrl) {
      warnedSuspectBaseUrl = true;
      // Deliberate console.warn (not the debug-gated logger): a misconfigured
      // baseUrl is the failure this exists to surface. Code: config_suspect_base_url.
      console.warn(
        `[AGO] ${context}: \`baseUrl\` has no protocol and is not a relative path ` +
          "(config_suspect_base_url). Requests will fail: Node throws a URL parse " +
          'error, browsers fetch it as a relative path. Use "https://..." (or a ' +
          '"/path" for a same-origin proxy).'
      );
    }
  }
}
