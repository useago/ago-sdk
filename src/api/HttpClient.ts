import {
  AgoApiError,
  AgoNetworkError,
  ApiErrorResponse,
} from "../client/errors";
import type { AgoConfig } from "../client/types";
import { logger } from "../utils/logger";

const WIDGET_ID_KEY = "ago_widget_id";

function generateAnonId(): string {
  // Try to reuse a previously generated ID from localStorage
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(WIDGET_ID_KEY);
    if (stored) return stored;
  }

  // Global WebCrypto is flag-gated on Node 18 (unflagged in 19+), and this
  // must stay bundleable for browsers (no `node:crypto` import). The fallback
  // only needs uniqueness for an anon id, not cryptographic strength.
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `ago-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(WIDGET_ID_KEY, id);
    } catch {
      // localStorage may be unavailable (e.g., private browsing)
    }
  }

  return id;
}

/**
 * HTTP client with authentication headers
 */
export class HttpClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private getUserJwt?: () => Promise<string>;

  constructor(config: AgoConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.getUserJwt = config.getUserJwt ?? undefined;
    this.headers = {
      // Header carrying the end-user's anonymous id.
      "X-User-Anon-Id": config.widgetId || generateAnonId(),
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
  }

  /**
   * Update configuration (e.g., JWT token)
   */
  updateConfig(config: Partial<AgoConfig>): void {
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl.replace(/\/$/, "");
    }
    if (config.widgetId) {
      this.headers["X-User-Anon-Id"] = config.widgetId;
    }
    if (config.userEmail) {
      this.headers["X-User-Email"] = config.userEmail;
    }
    if ("userJwt" in config) {
      if (config.userJwt) {
        this.headers["Authorization"] = `Bearer ${config.userJwt}`;
      } else {
        delete this.headers["Authorization"];
      }
    }
    if ("getUserJwt" in config) {
      this.getUserJwt = config.getUserJwt ?? undefined;
    }
    if (config.permission !== undefined) {
      if (config.permission) {
        this.headers["X-Widget-Permission"] = config.permission;
      } else {
        delete this.headers["X-Widget-Permission"];
      }
    }
  }

  /** Whether an `Authorization: Bearer` header is currently configured. */
  hasBearerToken(): boolean {
    return typeof this.headers["Authorization"] === "string";
  }

  /**
   * Whether this client can authenticate a JWT-only endpoint now or by calling
   * its configured token provider. This is intentionally broader than
   * {@link hasBearerToken}: availability checks run before the first request,
   * when a lazy `getUserJwt` provider may not have minted a bearer yet.
   */
  canAuthenticateWithJwt(): boolean {
    return this.hasBearerToken() || this.getUserJwt !== undefined;
  }

  /**
   * Refresh the bearer token through the configured `getUserJwt` provider.
   * Returns `false` (without throwing) when no provider is configured or the
   * provider fails, so callers can decide whether a retry makes sense.
   */
  async refreshUserJwt(): Promise<boolean> {
    if (!this.getUserJwt) return false;
    try {
      const jwt = await this.getUserJwt();
      if (!jwt) return false;
      this.headers["Authorization"] = `Bearer ${jwt}`;
      return true;
    } catch (error) {
      logger.warn("getUserJwt provider failed:", error);
      return false;
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
    options?: { keepalive?: boolean },
  ): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }

  /**
   * Make a POST request and return the raw Response (for streaming)
   */
  async postStream(path: string, body?: unknown): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    logger.debug("POST (stream)", url, body);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...this.headers,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return response;
    } catch (error) {
      if (error instanceof AgoApiError) {
        throw error;
      }
      throw new AgoNetworkError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}. ` +
          "Check that `baseUrl` is reachable and includes the protocol (https://).",
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Make a POST request with FormData (for file uploads)
   */
  async postFormData(path: string, formData: FormData): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    logger.debug("POST (formData)", url);

    // Don't set Content-Type for FormData - browser sets it with boundary
    const headers = { ...this.headers };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: formData,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      return response;
    } catch (error) {
      if (error instanceof AgoApiError) {
        throw error;
      }
      throw new AgoNetworkError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}. ` +
          "Check that `baseUrl` is reachable and includes the protocol (https://).",
        error instanceof Error ? error : undefined,
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { keepalive?: boolean },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    logger.debug(method, url, body);

    try {
      const response = await fetch(url, {
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
        error instanceof Error ? error : undefined,
      );
    }
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

    // Some endpoints answer with a bare `{ "reason": "..." }` body instead of
    // the error envelope (e.g. the voice mint's typed 403 jwt_required).
    // Surface it as the error code so callers can match on it.
    const reason = (errorData as { reason?: unknown } | undefined)?.reason;
    if (typeof reason === "string" && reason !== "") {
      throw new AgoApiError(
        `HTTP ${response.status}: ${reason}`,
        reason,
        response.status,
        "api_error",
      );
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
      "api_error",
    );
  }
}
