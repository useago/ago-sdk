import type { HttpClient } from "../api/HttpClient";
import { AgoApiError } from "../client/errors";
import { logger } from "../utils/logger";
import { AgoVoiceError } from "./errors";
import type { VoiceSessionGrant } from "./types";

const MINT_PATH = "/api/sdk/v1/voice/mint-session-token";
const CONFIG_PATH = "/api/sdk/v1/config";

export interface MintSessionOptions {
  /** Agent (id or slug) the session talks to. */
  agentId?: string;
  /** Widget permission to apply (mirrors `X-Widget-Permission`). */
  permissionId?: string;
  /** Existing thread to bind the session to (reconnects pin the adopted thread). */
  conversationId?: string | null;
}

interface MintResponse {
  token?: string;
  wsUrl?: string;
  ws_url?: string;
  threadId?: string;
  thread_id?: string;
}

/** Tenant/agent voice gates read from the SDK config endpoint. */
export interface VoiceConfigFlags {
  tenantEnabled?: boolean;
  agentIsVoiceAgent?: boolean;
}

interface SdkConfigAgent {
  id?: string;
  slug?: string;
  name?: string;
  is_voice_agent?: boolean;
  isVoiceAgent?: boolean;
}

interface SdkConfigResponse {
  permissions?: SdkPermissionConfig[];
  // Kept for compatibility with early/pre-release config fixtures that placed
  // the selected permission fields at the top level.
  voice_enabled?: boolean;
  voiceEnabled?: boolean;
  agents?: SdkConfigAgent[];
}

interface SdkPermissionConfig {
  id?: string | null;
  name?: string | null;
  voice_enabled?: boolean;
  voiceEnabled?: boolean;
  agents?: SdkConfigAgent[];
}

function isJwtRequired(error: unknown): error is AgoApiError {
  return (
    error instanceof AgoApiError &&
    error.statusCode === 403 &&
    error.code === "jwt_required"
  );
}

/**
 * Voice endpoints on the SDK router, riding the shared {@link HttpClient} so
 * the SDK auth headers (anon id, JWT, permission) go along.
 */
export class VoiceApi {
  constructor(private http: HttpClient) {}

  /**
   * Mint a single-use voice session grant.
   *
   * A typed 403 `{reason: "jwt_required"}` is retried exactly once, and only
   * when a `getUserJwt` provider is configured (retrying the same stored token
   * is useless): the SDK fetches a fresh token, updates the bearer, and
   * repeats the mint. Without a provider it surfaces the `jwt-required`
   * voice error immediately.
   */
  async mintSession(options: MintSessionOptions): Promise<VoiceSessionGrant> {
    const body = {
      agent_id: options.agentId,
      permission_id: options.permissionId,
      conversation_id: options.conversationId ?? undefined,
    };

    try {
      return this.normalizeGrant(await this.http.post<MintResponse>(MINT_PATH, body));
    } catch (error) {
      if (isJwtRequired(error)) {
        const refreshed = await this.http.refreshUserJwt();
        if (refreshed) {
          try {
            return this.normalizeGrant(
              await this.http.post<MintResponse>(MINT_PATH, body)
            );
          } catch (retryError) {
            throw this.mapMintError(retryError);
          }
        }
      }
      throw this.mapMintError(error);
    }
  }

  /** Read the active permission's tenant/agent voice gates from SDK config. */
  async getVoiceConfig(
    agent?: string,
    permission?: string
  ): Promise<VoiceConfigFlags> {
    const config = await this.http.get<SdkConfigResponse>(CONFIG_PATH);
    const selectedPermission = Array.isArray(config.permissions)
      ? permission
        ? config.permissions.find(
            (item) => item.id === permission || item.name === permission
          )
        : agent
          ? (config.permissions.find((item) =>
              item.agents?.some(
                (candidate) =>
                  candidate.id === agent ||
                  candidate.slug === agent ||
                  candidate.name === agent
              )
            ) ?? config.permissions[0])
          : config.permissions[0]
      : undefined;
    // If the backend returned permissions but the configured one is absent,
    // keep the gates unknown so the session fails closed instead of borrowing
    // another permission's capabilities.
    const gateSource = Array.isArray(config.permissions)
      ? (selectedPermission ?? {})
      : config;
    const tenantEnabled =
      gateSource.voice_enabled ?? gateSource.voiceEnabled;
    let agentIsVoiceAgent: boolean | undefined;
    const agents = gateSource.agents;
    if (Array.isArray(agents)) {
      const match = agent
        ? agents.find(
            (a) => a.id === agent || a.slug === agent || a.name === agent
          )
        : agents[0];
      if (match) {
        agentIsVoiceAgent = match.is_voice_agent ?? match.isVoiceAgent;
      }
    }
    return { tenantEnabled, agentIsVoiceAgent };
  }

  /** Whether the client currently carries a bearer token (JWT auth kind). */
  hasUserJwt(): boolean {
    return this.http.hasBearerToken();
  }

  private normalizeGrant(response: MintResponse): VoiceSessionGrant {
    const token = response.token;
    const wsUrl = response.wsUrl ?? response.ws_url;
    if (!token || !wsUrl) {
      logger.error("Voice mint response missing token/wsUrl:", response);
      throw new AgoVoiceError("mint-failed", {
        detail: "mint response missing token or wsUrl",
      });
    }
    return {
      token,
      wsUrl,
      threadId: response.threadId ?? response.thread_id,
    };
  }

  private mapMintError(error: unknown): AgoVoiceError {
    if (error instanceof AgoVoiceError) return error;
    if (error instanceof AgoApiError) {
      if (error.statusCode === 403 && error.code === "jwt_required") {
        return new AgoVoiceError("jwt-required", {
          serverReason: "jwt_required",
          statusCode: 403,
        });
      }
      if (error.statusCode === 401) {
        return new AgoVoiceError("jwt-required", { statusCode: 401 });
      }
      if (error.statusCode === 403) {
        return new AgoVoiceError("voice-unavailable", {
          serverReason: error.code !== "http_error" ? error.code : undefined,
          statusCode: 403,
        });
      }
      if (error.statusCode === 429) {
        return new AgoVoiceError("rate-limited", { statusCode: 429 });
      }
      return new AgoVoiceError("mint-failed", {
        detail: error.message,
        statusCode: error.statusCode,
      });
    }
    return new AgoVoiceError("mint-failed", {
      detail: error instanceof Error ? error.message : undefined,
    });
  }
}
