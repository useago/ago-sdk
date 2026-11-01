import { AgoApiError, AgoNetworkError, ApiErrorResponse } from "../client/errors";
import { normalizeLanguage } from "../client/language";
import type { AgoConfig, AgoFetch } from "../client/types";
import type { StorageLike } from "../state/createStore";
import { logger } from "../utils/logger";

const WIDGET_ID_KEY = "ago_widget_id";

/**
 * A fetch rejected because its `AbortSignal` fired (the caller stopped the
 * turn), not because the network failed. Deliberate stops must surface as
 * themselves so callers can tell them apart from a dropped connection.
 */
export function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function generateAnonId(storage?: StorageLike): string {
  // Reuse a previously generated ID: the host's storage, else localStorage.
  // Without either (React Native without a `storage`, SSR) the id lives in
  // memory only.
  const store =
    storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
  if (store) {
    try {
      const stored = store.getItem(WIDGET_ID_KEY);
      if (stored) return stored;
    } catch {
      // Storage may be unavailable (e.g., private browsing)
    }
  }

  // Global WebCrypto is flag-gated on Node 18 (unflagged in 19+), and this
  // must stay bundleable for browsers (no `node:crypto` import). The fallback
  // only needs uniqueness for an anon id, not cryptographic strength.
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `ago-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

  if (store) {
    try {
      store.setItem(WIDGET_ID_KEY, id);
    } catch {
      // Storage may be unavailable (e.g., private browsing)
    }
  }

  return id;
}

/**
 * POST a multipart body with `XMLHttpRequest`, the one transport that uploads
 * React Native `{ uri }` file parts. Resolves with a minimal bodyless
 * `Response` (status + `text()`/`json()`), which the SSE handler reads in one
 * piece. An abort rejects with an `AbortError`, like `fetch`.
 */
function xhrPost(
  url: string,
  headers: Record<string, string>,
  body: FormData,
  signal?: AbortSignal
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const abortError = () => {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      return error;
    };
    if (signal?.aborted) return reject(abortError());

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort);
    const done = () => signal?.removeEventListener("abort", onAbort);

    xhr.onload = () => {
      done();
      const text = xhr.responseText ?? "";
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
        body: null,
        text: async () => text,
        json: async () => JSON.parse(text),
      } as unknown as Response);
    };
    xhr.onerror = () => {
      done();
      reject(new TypeError("Network request failed"));
    };
    xhr.onabort = () => {
      done();
      reject(abortError());
    };
    xhr.send(body);
  });
}

/**
 * HTTP client with authentication headers
 */
export class HttpClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  /** `config.fetch`, or `undefined` to use the global `fetch` at call time. */
  private customFetch: AgoFetch | undefined;

  constructor(config: AgoConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.customFetch = config.fetch;
    this.headers = {
      // Header carrying the end-user's anonymous id.
      "X-User-Anon-Id": config.widgetId || generateAnonId(config.storage),
    };

    if (config.userEmail) {
      this.headers["X-User-Email"] = config.userEmail;
    }

    if (config.userJwt) {
      this.headers["Authorization"] = `Bearer ${config.userJwt}`;
    }

    if (config.permission) {
      this.headers["X-Widget-Permission"] = config.permission;
    }

    const language = normalizeLanguage(config.language);
    if (language) this.headers["Accept-Language"] = language;
  }

  /**
   * Update configuration (e.g., JWT token)
   */
  updateConfig(config: Partial<AgoConfig>): void {
    const language = normalizeLanguage(config.language);
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl.replace(/\/$/, "");
    }
    if (config.widgetId) {
      this.headers["X-User-Anon-Id"] = config.widgetId;
    }
    if (config.fetch) {
      this.customFetch = config.fetch;
    }
    if (config.userEmail) {
      this.headers["X-User-Email"] = config.userEmail;
    }
    if (config.userJwt) {
      this.headers["Authorization"] = `Bearer ${config.userJwt}`;
    }
    if (config.permission !== undefined) {
      if (config.permission) {
        this.headers["X-Widget-Permission"] = config.permission;
      } else {
        delete this.headers["X-Widget-Permission"];
      }
    }
    if (config.language !== undefined) {
      if (language) {
        this.headers["Accept-Language"] = language;
      } else {
        delete this.headers["Accept-Language"];
      }
    }
  }

  /**
   * Make a GET request
   */
  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  /**
   * Make a POST request with JSON body.
   *
   * `keepalive: true` lets the request survive a page unload (used by the
   * proactive event tracker's flush-on-hide — sendBeacon can't carry the auth
   * headers, so it's a keepalive fetch instead).
   */
  async post<T>(
    path: string,
    body?: unknown,
    options?: { keepalive?: boolean }
  ): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }

  /**
   * Make a POST request and return the raw Response (for streaming).
   *
   * `signal` lets the caller close the stream mid-flight (see
   * `AgoClient.stop`); an abort is rethrown as-is rather than wrapped in an
   * `AgoNetworkError`, so a deliberate stop is not mistaken for a network drop.
   */
  async postStream(
    path: string,
    body?: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    logger.debug("POST (stream)", url, body);

    try {
      const response = await this.doFetch(url, {
        method: "POST",
        headers: {
          ...this.headers,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: options?.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return response;
    } catch (error) {
      if (error instanceof AgoApiError || isAbortError(error)) {
        throw error;
      }
      throw new AgoNetworkError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}. ` +
          "Check that `baseUrl` is reachable and includes the protocol (https://).",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Make a POST request with FormData (for file uploads).
   *
   * `uriFiles` marks a body carrying React Native `{ uri, name, type }` files.
   * No `fetch` available there can upload those (`expo/fetch`, which Expo also
   * installs as the global `fetch`, rejects them), but React Native's
   * `XMLHttpRequest` streams them from disk. The reply is then read in one
   * piece instead of token by token.
   */
  async postFormData(
    path: string,
    formData: FormData,
    options?: { signal?: AbortSignal; uriFiles?: boolean }
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    logger.debug("POST (formData)", url);

    // Don't set Content-Type for FormData - browser sets it with boundary
    const headers = { ...this.headers };

    try {
      const response =
        options?.uriFiles && typeof XMLHttpRequest !== "undefined"
          ? await xhrPost(url, headers, formData, options.signal)
          : await this.doFetch(url, {
              method: "POST",
              headers,
              body: formData,
              signal: options?.signal,
            });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return response;
    } catch (error) {
      if (error instanceof AgoApiError || isAbortError(error)) {
        throw error;
      }
      throw new AgoNetworkError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}. ` +
          "Check that `baseUrl` is reachable and includes the protocol (https://).",
        error instanceof Error ? error : undefined
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { keepalive?: boolean }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    logger.debug(method, url, body);

    try {
      const response = await this.doFetch(url, {
        method,
        headers: {
          ...this.headers,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        ...(options?.keepalive ? { keepalive: true } : {}),
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      return response.json();
    } catch (error) {
      if (error instanceof AgoApiError) {
        throw error;
      }
      throw new AgoNetworkError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}. ` +
          "Check that `baseUrl` is reachable and includes the protocol (https://).",
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * The global `fetch` is resolved per call (not captured at construction) so
   * a polyfill or test stub installed later still applies, and it is called
   * unbound: invoking it as a method of another object throws "Illegal
   * invocation" in browsers.
   */
  private doFetch(url: string, init: RequestInit): Promise<Response> {
    const fetchImpl: AgoFetch = this.customFetch ?? fetch;
    return fetchImpl(url, init);
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: ApiErrorResponse | undefined;

    try {
      errorData = await response.json();
    } catch {
      // Response is not JSON
    }

    if (errorData?.error) {
      throw AgoApiError.fromResponse(errorData, response.status);
    }

    // Status-keyed hints for the likeliest first-session failures. Short on
    // purpose: these strings can surface in end-user UIs (the widget renders
    // error messages verbatim).
    let hint = "";
    if (response.status === 401 || response.status === 403) {
      hint = " Check `userJwt` (and that it has not expired).";
    } else if (response.status === 404) {
      hint = " Check that `baseUrl` points at your AGO API root.";
    }

    throw new AgoApiError(
      `HTTP ${response.status}: ${response.statusText}.${hint}`,
      "http_error",
      response.status,
      "api_error"
    );
  }
}
