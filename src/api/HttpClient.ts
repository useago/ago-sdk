import { AgoApiError, AgoNetworkError, ApiErrorResponse } from "../client/errors";
import type { AgoConfig } from "../client/types";
import { logger } from "../utils/logger";

const WIDGET_ID_KEY = "ago_widget_id";

function generateWidgetId(): string {
  // Try to reuse a previously generated ID from localStorage
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(WIDGET_ID_KEY);
    if (stored) return stored;
  }

  const id = crypto.randomUUID();

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

  constructor(config: AgoConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.headers = {
      "X-Widget-Id": config.widgetId || generateWidgetId(),
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
      this.headers["X-Widget-Id"] = config.widgetId;
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
  }

  /**
   * Make a GET request
   */
  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  /**
   * Make a POST request with JSON body
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
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
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error : undefined
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
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
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
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error : undefined
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

    throw new AgoApiError(
      `HTTP ${response.status}: ${response.statusText}`,
      "http_error",
      response.status,
      "api_error"
    );
  }
}
