import type { HttpClient } from "../api/HttpClient";
import { AgoError } from "../client/errors";
import { logger } from "../utils/logger";
import type { RemoteAssistCall, RemoteAssistCallEndReason, RemoteAssistCallEvent } from "./types";
import type { AnswerCallOptions, VoiceConnection } from "./voice";

const API = "/api/sdk/v1";

/** The call of a session as `GET .../remote-assist` reports it. */
export interface RawCall {
  id: string;
  status: string;
}

interface JoinResponse {
  call: { id: string; offer: string };
  ice_servers: RTCIceServer[];
  ice_transport_policy: RTCIceTransportPolicy;
}

export interface CallLineDeps {
  http: Pick<HttpClient, "post">;
  emit: (event: RemoteAssistCallEvent) => void;
  onChange: () => void;
  /** Answers an offer with the microphone (a browser with the kit installed). */
  answer?: (options: AnswerCallOptions) => Promise<{ answer: string; connection: VoiceConnection }>;
}

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
}

/**
 * The agent's voice call during an accepted session: ringing → connecting →
 * connected → gone. The server is the source of truth for which call exists;
 * this tab only holds the connection of a call it answered itself.
 */
export class RemoteAssistCallLine {
  private call: RemoteAssistCall | null = null;
  private connection: VoiceConnection | null = null;
  /** Calls this tab is done with: a late server read must not ring again. */
  private done = new Set<string>();
  /** Bumped whenever the call is dropped: in-flight answers give up. */
  private token = 0;

  constructor(private deps: CallLineDeps) {}

  snapshot(): RemoteAssistCall | null {
    return this.call;
  }

  /** Apply the server's view of the session's call. */
  sync(sessionId: string, raw: RawCall | null | undefined): void {
    if (this.call && raw?.id !== this.call.id) this.drop("ended");
    if (!raw || this.done.has(raw.id) || this.call?.id === raw.id) return;
    if (raw.status === "ringing") {
      this.set({ id: raw.id, sessionId, status: "ringing", muted: false });
      return;
    }
    if (raw.status === "connected") {
      // Answered before a reload: the connection died with the page, so the agent is told.
      this.done.add(raw.id);
      this.postEnd(sessionId, raw.id, true);
    }
  }

  async accept(): Promise<boolean> {
    const call = this.call;
    if (call?.status !== "ringing") return false;
    const token = ++this.token;
    this.set({ ...call, status: "connecting" });
    const session = encodeURIComponent(call.sessionId);
    try {
      if (!this.deps.answer) throw new AgoError("Voice calls need a browser with WebRTC.", "remote_assist_voice_unavailable");
      const joined = await this.deps.http.post<JoinResponse>(
        `${API}/remote-assist/sessions/${session}/call/join`,
        { call_id: call.id },
      );
      if (token !== this.token) return false;
      const { answer, connection } = await this.deps.answer({
        offer: joined.call.offer,
        iceServers: joined.ice_servers,
        iceTransportPolicy: joined.ice_transport_policy,
        onConnectionState: (state) => this.onConnectionState(token, state),
      });
      if (token !== this.token) {
        connection.close();
        return false;
      }
      this.connection = connection;
      await this.deps.http.post(`${API}/remote-assist/sessions/${session}/call/answer`, {
        call_id: call.id,
        answer,
      });
      return true;
    } catch (error) {
      if (token !== this.token) return false;
      const denied = errorName(error) === "NotAllowedError";
      if (!denied) logger.warn("Answering the support agent's call failed:", error);
      this.end(denied ? "microphone_denied" : "failed", { failed: !denied });
      return false;
    }
  }

  decline(): void {
    if (this.call?.status === "ringing") this.end("declined", { failed: false });
  }

  hangUp(): void {
    if (this.call && this.call.status !== "ringing") this.end("hung_up", { failed: false });
  }

  setMuted(muted: boolean): void {
    if (!this.call || this.call.status === "ringing") return;
    this.connection?.setMuted(muted);
    this.set({ ...this.call, muted });
  }

  /** The session ended: the server ends its call with it. */
  reset(): void {
    if (this.call) this.drop("ended");
  }

  private onConnectionState(token: number, state: RTCPeerConnectionState): void {
    if (token !== this.token || !this.call) return;
    if (state === "connected" && this.call.status === "connecting") this.set({ ...this.call, status: "connected" });
    if (state === "failed") this.end("failed", { failed: true });
  }

  private end(reason: RemoteAssistCallEndReason, { failed }: { failed: boolean }): void {
    const call = this.call;
    if (!call) return;
    this.done.add(call.id);
    this.drop(reason);
    this.postEnd(call.sessionId, call.id, failed);
  }

  private drop(reason: RemoteAssistCallEndReason): void {
    const call = this.call;
    if (!call) return;
    this.token += 1;
    this.connection?.close();
    this.connection = null;
    this.call = null;
    this.deps.onChange();
    this.deps.emit({ sessionId: call.sessionId, callId: call.id, status: "ended", reason });
  }

  private set(call: RemoteAssistCall): void {
    const statusChanged = this.call?.status !== call.status;
    this.call = call;
    this.deps.onChange();
    if (statusChanged) this.deps.emit({ sessionId: call.sessionId, callId: call.id, status: call.status });
  }

  private postEnd(sessionId: string, callId: string, failed: boolean): void {
    this.deps.http
      .post(`${API}/remote-assist/sessions/${encodeURIComponent(sessionId)}/call/end`, { call_id: callId, failed })
      .catch((error) => logger.warn("Ending the support agent's call failed:", error));
  }
}
