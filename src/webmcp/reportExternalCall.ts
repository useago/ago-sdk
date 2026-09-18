import type { ClientFunctionSchema } from "../functions/types";
import { logger } from "../utils/logger";
import { generateUuid } from "../utils/uuid";

/**
 * Backend contract (keep in sync):
 *
 *   POST {baseUrl}/api/sdk/v1/client-function-calls
 *
 *   { "function_name": "addToCart", "arguments": {}, "result": {…} | null,
 *     "error": "…" | null, "duration_ms": 12, "tab_id": "<uuid>",
 *     "client_functions": [ … ] }
 *
 * One request per call, best-effort: nothing awaits the promise and a failure is a
 * debug log, never a retry, which would double-count.
 *
 * `client_functions` rides along only until the backend has accepted this name in
 * this tab. A page whose functions are only ever called externally never sends the
 * declaration in a message body, and without it there is no Tool row to attach to.
 */
const CALLS_PATH = "/api/sdk/v1/client-function-calls";
const TAB_KEY = "ago_webmcp_tab";

export interface ExternalCallReport {
  schema: ClientFunctionSchema;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs: number;
  /** Registered with `navigates`: the page may unload before the report lands. */
  navigates?: boolean;
}

/** What the reporter needs from the client. */
export interface ExternalCallReporterClient {
  post: (
    path: string,
    body: unknown,
    options?: { keepalive?: boolean }
  ) => Promise<unknown>;
  /** Names the backend has already accepted in this tab. */
  declared: Set<string>;
}

/**
 * One id per tab, grouping a run of calls by the same external agent. Storage can
 * throw (private mode, blocked site data); a missing id does not fail the report.
 */
function tabId(): string | undefined {
  try {
    const existing = sessionStorage.getItem(TAB_KEY);
    if (existing) return existing;
    const created = generateUuid();
    sessionStorage.setItem(TAB_KEY, created);
    return created;
  } catch {
    return undefined;
  }
}

/** Record one call made through the WebMCP bridge. Fire and forget. */
export function reportExternalCall(
  client: ExternalCallReporterClient,
  call: ExternalCallReport
): void {
  const { name } = call.schema;
  const tab = tabId();
  const body = {
    function_name: name,
    arguments: call.args,
    result: call.error === undefined ? (call.result ?? null) : null,
    error: call.error ?? null,
    duration_ms: call.durationMs,
    ...(tab ? { tab_id: tab } : {}),
    ...(client.declared.has(name) ? {} : { client_functions: [call.schema] }),
  };

  client
    .post(CALLS_PATH, body, call.navigates ? { keepalive: true } : undefined)
    .then(() => {
      // Only on success: a dropped report re-declares on the next call.
      client.declared.add(name);
    })
    .catch((error) => {
      logger.debug("External call report failed:", error);
    });
}
