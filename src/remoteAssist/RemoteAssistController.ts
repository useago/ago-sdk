import type { HttpClient } from "../api/HttpClient";
import type { ActivityInput } from "../activity/ActivityLedger";
import { AgoApiError } from "../client/errors";
import type {
  AgoClientEvents,
  ClientFunctionInvocation,
  HandoffState,
} from "../client/types";
import type { CapturedError } from "../errors/ErrorWatcher";
import type { NavRoute } from "../functions/navigation";
import type { ClientFunctionSchema, RegisteredFunction } from "../functions/types";
import { deepEqual } from "../utils/deepEqual";
import { logger } from "../utils/logger";
import { RemoteAssistCallLine, type RawCall } from "./callLine";
import { clickInvocation, findClickTarget } from "./clickTarget";
import { LiveStream, type LiveRecorder } from "./liveStream";
import { capState, pageUrl } from "./pageContext";
import type { AnswerCallOptions, VoiceConnection } from "./voice";
import type {
  RemoteAssistApprovalRequest,
  RemoteAssistCommand,
  RemoteAssistCommandStatus,
  RemoteAssistEndReason,
  RemoteAssistLiveViewOptions,
  RemoteAssistOptions,
  RemoteAssistScreenshotOptions,
  RemoteAssistSession,
  RemoteAssistSnapshot,
  RemoteAssistState,
} from "./types";

/** `sessionStorage` key holding this tab's grant (per tab by design). */
export const GRANT_STORAGE_KEY = "ago_remote_assist";
const CONTEXT_DEBOUNCE_MS = 500;
const ROUTE_POLL_MS = 1_000;
/** Claims per run: a burst of commands is drained, a misbehaving server is not looped on. */
const MAX_CLAIM_ROUNDS = 10;
const API = "/api/sdk/v1";
const MAX_ERRORS = 20;
const MAX_ERROR_STACK_CHARS = 4_000;
const ELEMENT_GONE = "The element is no longer on the page.";
const PAGE_CHANGED = "The page changed before the click arrived: nothing was run.";

type RemoteAssistEvent =
  | "remoteAssist:requested"
  | "remoteAssist:started"
  | "remoteAssist:ended"
  | "remoteAssist:command"
  | "remoteAssist:approval"
  | "remoteAssist:call";

interface RawSession {
  id: string;
  status: string;
  agent_name?: string | null;
  requested_at?: string | null;
  expires_at?: string | null;
  call?: RawCall | null;
}

type Decision = "approved" | "rejected" | "cancelled";

/** What the built-in UI needs; implemented by `./ui` (loaded lazily). */
export interface RemoteAssistUi {
  render(snapshot: RemoteAssistSnapshot): void;
  /** Whether a node belongs to the UI (left out of screenshots). */
  owns(node: Node): boolean;
  destroy(): void;
}

export interface RemoteAssistUiActions {
  accept(): void;
  decline(): void;
  stop(): void;
  approve(commandId: string): void;
  reject(commandId: string): void;
  acceptCall(): void;
  declineCall(): void;
  hangUpCall(): void;
  setCallMuted(muted: boolean): void;
}

export interface RemoteAssistDeps {
  http: Pick<HttpClient, "get" | "post" | "put" | "postFormData">;
  emit: <K extends RemoteAssistEvent>(event: K, data: AgoClientEvents[K]) => void;
  /** Tenant setting (`GET /config` → `remote_assist.enabled`). */
  serverEnabled: () => Promise<boolean>;
  getActiveConversation: () => string | null;
  /** Make a conversation the active one when nothing is (reload resume). */
  watchConversation: (conversationId: string) => void;
  getFunction: (name: string) => RegisteredFunction | undefined;
  getFunctions: () => Array<RegisteredFunction & { name: string }>;
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  requiresApproval: (invocation: ClientFunctionInvocation) => boolean;
  recordActivity: (entry: ActivityInput) => void;
  getPageState: () => unknown;
  /** Recent page errors the AI agent already receives; `null` when the error watcher is off. */
  getErrors?: () => CapturedError[] | null;
  onFunctionsChanged: (listener: () => void) => () => void;
  onContextChanged: (listener: () => void) => () => void;
  capture: (options: {
    mask?: readonly string[];
    capture?: () => Promise<Blob>;
    exclude?: (node: Node) => boolean;
  }) => Promise<Blob>;
  loadUi?: (actions: RemoteAssistUiActions) => Promise<RemoteAssistUi>;
  /** The page can be recorded for the live view (a browser with the kit installed). */
  canRecord?: () => boolean;
  /** Start recording the page (loads the recorder on first use). */
  record?: (emit: (event: unknown) => void, mask: readonly string[]) => Promise<LiveRecorder>;
  /** Routes given to `registerNavigationFunction`, to map a clicked link to a page. */
  getRoutes?: () => NavRoute[] | null;
  /** Where this tab's grant lives (`sessionStorage` in a browser). */
  storage?: () => Storage | null;
  /** The environment can host remote assistance (a browser entry installed its kit). */
  available?: () => boolean;
  /** The browser can answer a voice call (WebRTC and a microphone API). */
  canCall?: () => boolean;
  /** Open the microphone and answer the agent's WebRTC offer. */
  answerCall?: (options: AnswerCallOptions) => Promise<{ answer: string; connection: VoiceConnection }>;
}

interface ResolvedOptions {
  enabled: boolean;
  screenshot: RemoteAssistScreenshotOptions | null;
  liveView: RemoteAssistLiveViewOptions | null;
  voice: boolean;
  ui: boolean;
}

function optIn<T extends object>(value: boolean | T | undefined): T | Record<string, never> | null {
  if (!value) return null;
  return value === true ? {} : value;
}

export function resolveRemoteAssistOptions(
  value: boolean | RemoteAssistOptions | undefined,
): ResolvedOptions {
  if (!value) return { enabled: false, screenshot: null, liveView: null, voice: false, ui: true };
  const options = value === true ? {} : value;
  return {
    enabled: true,
    screenshot: optIn(options.screenshot),
    liveView: optIn(options.liveView),
    voice: options.voice === true,
    ui: options.ui !== false,
  };
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * What a context update would change for the agent. A known error firing
 * again only moves its `count` and `last_at`, which is not worth a request.
 */
function contextSignature(body: Record<string, unknown>): string | null {
  const errors = body.errors as Array<Record<string, unknown>> | null;
  try {
    return JSON.stringify({
      ...body,
      errors: errors?.map(({ count: _count, last_at: _lastAt, ...identity }) => identity) ?? null,
    });
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Remote assistance, visitor side. Explicit state machine:
 * `idle → requested` (an agent asked) `→ active` (the visitor accepted in THIS
 * tab) `→ idle` (declined, stopped, expired, ended). Commands run only while
 * `active` AND locally granted for that exact session id.
 */
export class RemoteAssistController {
  private options: ResolvedOptions;
  private state: RemoteAssistState = "idle";
  private session: RemoteAssistSession | null = null;
  /** Session this tab consented to (restored from sessionStorage on reload). */
  private grantedId: string | null = null;
  /** Bumped on every end: in-flight work started before it is dropped. */
  private epoch = 0;
  private executed = new Set<string>();
  private declined = new Set<string>();
  private approval: { request: RemoteAssistApprovalRequest; resolve: (d: Decision) => void } | null = null;
  private accepting = false;
  private claiming = false;
  private claimAgain = false;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private contextTimer: ReturnType<typeof setTimeout> | null = null;
  /** Signature of the last context the server accepted for the current session. */
  private sentContext: string | null = null;
  private stopReporting: (() => void) | null = null;
  private live: LiveStream | null = null;
  /** Session whose live view was stopped (server refused it, or recording failed). */
  private liveOff: string | null = null;
  private lastHref = "";
  private ui: RemoteAssistUi | null = null;
  private uiLoading: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: RemoteAssistSnapshot | null = null;
  private destroyed = false;
  private callLine: RemoteAssistCallLine;

  constructor(
    private deps: RemoteAssistDeps,
    options: boolean | RemoteAssistOptions | undefined,
  ) {
    this.options = resolveRemoteAssistOptions(options);
    this.callLine = new RemoteAssistCallLine({
      http: deps.http,
      emit: (event) => deps.emit("remoteAssist:call", event),
      onChange: () => this.changed(),
      answer: deps.answerCall,
    });
  }

  // ── Public surface (client.remoteAssist) ──────────────────────────

  /** The host opted in (`remoteAssist` in the config). The tenant setting is checked separately. */
  isEnabled(): boolean {
    return this.options.enabled && (this.deps.available?.() ?? true);
  }

  getState(): RemoteAssistState {
    return this.state;
  }

  /** Stable between changes (safe for `useSyncExternalStore`). */
  getSnapshot(): RemoteAssistSnapshot {
    if (!this.snapshot) {
      this.snapshot = {
        state: this.state,
        session: this.session,
        pendingApproval: this.approval?.request ?? null,
        accepting: this.accepting,
        call: this.callLine.snapshot(),
      };
    }
    return this.snapshot;
  }

  /** Called on every state change. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Accept the pending request. Resolves `true` once the session is active in this tab. */
  async accept(): Promise<boolean> {
    const session = this.session;
    if (this.state !== "requested" || !session || this.accepting) return false;
    this.accepting = true;
    this.changed();
    try {
      const response = await this.deps.http.post<{ session: RawSession | null }>(
        `${API}/remote-assist/sessions/${encodeURIComponent(session.id)}/accept`,
        this.contextBody(),
      );
      // Declined, ended or replaced while the request was in flight.
      if (this.session !== session || this.state !== "requested") return false;
      if (response?.session?.status !== "active") {
        this.endLocally("expired");
        return false;
      }
      this.grantedId = session.id;
      this.writeGrant({ sessionId: session.id, conversationId: session.conversationId });
      this.activate(this.mapSession(response.session, session.conversationId));
      return true;
    } catch (error) {
      if (error instanceof AgoApiError && error.statusCode === 409) {
        if (this.session === session) this.endLocally("expired");
        return false;
      }
      logger.warn("Accepting remote assistance failed:", error);
      return false;
    } finally {
      this.accepting = false;
      this.changed();
    }
  }

  /** Refuse the pending request. */
  decline(): void {
    const session = this.session;
    if (this.state !== "requested" || !session) return;
    this.declined.add(session.id);
    this.endLocally("declined");
    this.postEnd(session.id);
  }

  /**
   * Stop the session (or decline a pending request). Local first: nothing runs
   * after this returns, even if telling the server fails.
   */
  stop(): void {
    const session = this.session;
    if (!session) return;
    if (this.state === "requested") {
      this.decline();
      return;
    }
    this.endLocally("stopped");
    this.postEnd(session.id);
  }

  /** Approve the command waiting in `remoteAssist:approval`. */
  approve(commandId: string): void {
    this.decide(commandId, "approved");
  }

  /** Refuse the command waiting in `remoteAssist:approval`. */
  reject(commandId: string): void {
    this.decide(commandId, "rejected");
  }

  /** Answer the agent's ringing call (only from the visitor's click: the browser asks for the microphone). */
  acceptCall(): Promise<boolean> {
    return this.callLine.accept();
  }

  /** Refuse the agent's ringing call. */
  declineCall(): void {
    this.callLine.decline();
  }

  /** Hang up the call; the session goes on. */
  hangUpCall(): void {
    this.callLine.hangUp();
  }

  setCallMuted(muted: boolean): void {
    this.callLine.setMuted(muted);
  }

  /** Whether an accept request is in flight (buttons should be disabled). */
  isAccepting(): boolean {
    return this.accepting;
  }

  // ── Wiring (called by AgoClient) ───────────────────────────────────

  configure(options: boolean | RemoteAssistOptions | undefined): void {
    const previousLiveView = JSON.stringify(this.options.liveView);
    const previousVoice = this.options.voice;
    this.options = resolveRemoteAssistOptions(options);
    if (!this.options.enabled) {
      this.stop();
      return;
    }
    if (this.state === "active" && previousVoice !== this.options.voice) {
      if (!this.options.voice) {
        this.callLine.decline();
        this.callLine.hangUp();
      }
      void this.pushContext({ onlyIfChanged: true });
    }
    if (this.state !== "active" || JSON.stringify(this.options.liveView) === previousLiveView) return;
    // A new mask must apply to what is already recorded: restart from a full snapshot.
    this.stopLive();
    this.startLive();
    void this.pushContext({ onlyIfChanged: true });
  }

  /** Query string for the live stream: announce the capability only with both opt-ins. */
  async liveQuery(): Promise<string> {
    return this.isEnabled() && (await this.serverAllows()) ? "?remote_assist=1" : "";
  }

  private async serverAllows(): Promise<boolean> {
    try {
      return await this.deps.serverEnabled();
    } catch {
      return false;
    }
  }

  /** Resume a session this tab consented to before a reload. */
  start(): void {
    this.destroyed = false;
    if (!this.isEnabled()) return;
    const grant = this.readGrant();
    if (!grant) return;
    this.grantedId = grant.sessionId;
    this.deps.watchConversation(grant.conversationId);
    void this.refresh(grant.conversationId);
  }

  /** The live stream (re)connected or reported a remote-assist change. */
  onLiveSignal(conversationId: string): void {
    if (!this.isEnabled()) return;
    void this.refresh(conversationId);
  }

  onHandoffChange(conversationId: string, handoff: HandoffState | null): void {
    const session = this.session;
    if (!session || session.conversationId !== conversationId) return;
    if (handoff?.state === "human") return;
    this.endLocally("handoff_ended");
    this.postEnd(session.id);
  }

  onActiveConversationChange(conversationId: string | null): void {
    const session = this.session;
    if (!session || session.conversationId === conversationId) return;
    this.endLocally("conversation_changed");
    this.postEnd(session.id);
  }

  /** Tear down the UI and timers. The tab's grant is kept so a remount resumes. */
  destroy(): void {
    this.destroyed = true;
    this.epoch += 1;
    this.approval?.resolve("cancelled");
    this.approval = null;
    this.callLine.reset();
    this.state = "idle";
    this.session = null;
    this.clearTimers();
    this.ui?.destroy();
    this.ui = null;
    this.snapshot = null;
    this.listeners.clear();
  }

  // ── Server state ───────────────────────────────────────────────────

  /** Fetch the session of a conversation and apply it (serialized). */
  refresh(conversationId?: string): Promise<void> {
    const id = conversationId ?? this.session?.conversationId ?? this.deps.getActiveConversation();
    if (!id || !this.isEnabled()) return Promise.resolve();
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    const run = (async () => {
      try {
        if (!(await this.serverAllows())) return;
        const response = await this.deps.http.get<{ session: RawSession | null }>(
          `${API}/conversations/${encodeURIComponent(id)}/remote-assist`,
        );
        if (!this.destroyed) this.apply(id, response?.session ?? null);
      } catch (error) {
        logger.warn("Reading the remote-assistance session failed:", error);
      } finally {
        this.refreshing = null;
        if (this.refreshAgain) {
          this.refreshAgain = false;
          void this.refresh(id);
        }
      }
    })();
    this.refreshing = run;
    return run;
  }

  private apply(conversationId: string, raw: RawSession | null): void {
    if (!raw) {
      if (this.grantedId && this.readGrant()?.conversationId === conversationId) {
        this.grantedId = null;
        this.clearGrant();
      }
      if (this.session?.conversationId === conversationId) this.endLocally("ended");
      return;
    }
    const session = this.mapSession(raw, conversationId);
    if (raw.status === "requested") {
      if (this.declined.has(raw.id)) return;
      if (this.state === "active") return;
      const isNew = this.session?.id !== raw.id;
      this.state = "requested";
      this.session = session;
      this.armExpiry(session);
      this.changed();
      if (isNew) this.deps.emit("remoteAssist:requested", session);
      return;
    }
    if (raw.status !== "active") return;
    if (this.grantedId === raw.id) {
      if (this.state === "active") {
        this.session = session;
        this.armExpiry(session);
        this.changed();
        void this.claimAndRun();
      } else {
        this.activate(session);
      }
      if (this.voiceAllowed()) this.callLine.sync(raw.id, raw.call);
      return;
    }
    // Accepted in another tab: this one stays out of it.
    if (this.session?.id === raw.id) this.endLocally("ended");
  }

  private activate(session: RemoteAssistSession): void {
    this.state = "active";
    this.session = session;
    this.armExpiry(session);
    this.startReporting();
    this.startLive();
    this.changed();
    this.deps.emit("remoteAssist:started", session);
    void this.pushContext();
    void this.claimAndRun();
  }

  private endLocally(reason: RemoteAssistEndReason): void {
    const session = this.session;
    if (this.state === "idle" || !session) return;
    this.epoch += 1;
    this.state = "idle";
    this.session = null;
    if (this.grantedId === session.id) {
      this.grantedId = null;
      this.clearGrant();
    }
    this.approval?.resolve("cancelled");
    this.approval = null;
    this.callLine.reset();
    this.clearTimers();
    this.changed();
    this.deps.emit("remoteAssist:ended", { sessionId: session.id, reason });
  }

  private postEnd(sessionId: string): void {
    this.deps.http
      .post(`${API}/remote-assist/sessions/${encodeURIComponent(sessionId)}/end`)
      .catch((error) => logger.warn("Ending the remote-assistance session failed:", error));
  }

  private mapSession(raw: RawSession, conversationId: string): RemoteAssistSession {
    return {
      id: raw.id,
      conversationId,
      status: raw.status === "active" ? "active" : "requested",
      agentName: raw.agent_name || null,
      requestedAt: toDate(raw.requested_at),
      expiresAt: toDate(raw.expires_at),
      screenshot: !!this.options.screenshot,
      liveView: this.liveViewAllowed(),
      voice: this.voiceAllowed(),
    };
  }

  /** Re-read the server state when the session is due to expire. */
  private armExpiry(session: RemoteAssistSession): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (!session.expiresAt) return;
    const delay = Math.max(0, session.expiresAt.getTime() - Date.now()) + 1_000;
    // setTimeout overflows above ~24.8 days; a session never lasts that long.
    if (delay > 2 ** 31 - 1) return;
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      void this.refresh(session.conversationId);
    }, delay);
  }

  private isGranted(sessionId: string, epoch: number): boolean {
    return (
      this.state === "active" &&
      this.epoch === epoch &&
      this.grantedId === sessionId &&
      this.session?.id === sessionId
    );
  }

  // ── Commands ───────────────────────────────────────────────────────

  private async claimAndRun(): Promise<void> {
    const sessionId = this.grantedId;
    const epoch = this.epoch;
    if (!sessionId || !this.isGranted(sessionId, epoch)) return;
    if (this.claiming) {
      this.claimAgain = true;
      return;
    }
    this.claiming = true;
    try {
      for (let round = 0; round < MAX_CLAIM_ROUNDS; round++) {
        if (!this.isGranted(sessionId, epoch)) return;
        const response = await this.deps.http.post<{ commands?: RemoteAssistCommand[] }>(
          `${API}/remote-assist/sessions/${encodeURIComponent(sessionId)}/commands/claim`,
        );
        const commands = [...(response?.commands ?? [])].sort((a, b) => a.seq - b.seq);
        if (commands.length === 0) return;
        for (const command of commands) {
          if (!this.isGranted(sessionId, epoch)) return;
          if (this.executed.has(command.id)) continue;
          this.executed.add(command.id);
          await this.runCommand(sessionId, epoch, command);
        }
        if (this.isGranted(sessionId, epoch)) await this.pushContext();
      }
    } catch (error) {
      if (error instanceof AgoApiError && error.statusCode === 409) {
        void this.refresh();
      } else {
        logger.warn("Claiming remote-assistance commands failed:", error);
      }
    } finally {
      this.claiming = false;
      if (this.claimAgain) {
        this.claimAgain = false;
        void this.claimAndRun();
      }
    }
  }

  private async runCommand(
    sessionId: string,
    epoch: number,
    command: RemoteAssistCommand,
  ): Promise<void> {
    const report = async (
      status: Exclude<RemoteAssistCommandStatus, "running">,
      result: unknown = null,
      error: string | null = null,
    ): Promise<void> => {
      this.deps.emit("remoteAssist:command", {
        sessionId,
        command,
        status,
        ...(error ? { error } : {}),
      });
      try {
        await this.deps.http.post(
          `${API}/remote-assist/commands/${encodeURIComponent(command.id)}/result`,
          { status, result: result ?? null, error },
        );
      } catch (postError) {
        logger.warn("Reporting a remote-assistance result failed:", postError);
      }
    };

    this.deps.emit("remoteAssist:command", { sessionId, command, status: "running" });

    if (command.kind === "screenshot") {
      await this.runScreenshot(sessionId, epoch, command, report);
      return;
    }

    const call =
      command.kind === "click"
        ? this.resolveClick(command)
        : {
            function: command.function ?? "",
            arguments: command.arguments && typeof command.arguments === "object" ? command.arguments : {},
          };
    if ("error" in call) {
      await report("rejected", null, call.error);
      return;
    }
    const { function: name, arguments: args } = call;
    const registration = name ? this.deps.getFunction(name) : undefined;
    if (!registration || registration.remote === false) {
      await report("rejected", null, `Function "${name}" is not available on this page.`);
      return;
    }
    const invocation: ClientFunctionInvocation = {
      invocationId: `remote-${command.id}`,
      functionName: name,
      arguments: args,
      conversationId: this.session?.conversationId ?? "",
    };

    if (this.deps.requiresApproval(invocation)) {
      await report("awaiting_approval");
      if (!this.isGranted(sessionId, epoch)) return;
      const decision = await this.askApproval({
        sessionId,
        commandId: command.id,
        functionName: name,
        arguments: args,
        agentName: this.session?.agentName ?? null,
      });
      if (decision === "cancelled" || !this.isGranted(sessionId, epoch)) return;
      if (decision === "rejected") {
        await report("rejected", null, "The customer declined this action.");
        return;
      }
    }

    let result: unknown;
    try {
      result = await this.deps.execute(name, args);
    } catch (error) {
      this.recordSupport(`support.${name}`, `Support agent ran "${name}" (failed)`, args);
      if (this.isGranted(sessionId, epoch)) await report("failed", null, errorMessage(error));
      return;
    }
    this.recordSupport(`support.${name}`, `Support agent ran "${name}"`, args);
    if (!this.isGranted(sessionId, epoch)) return;
    await report(
      "done",
      command.kind === "click" ? { function: name, arguments: args, result: result ?? null } : result,
    );
  }

  /** The call a click stands for, read from the real page (never from the agent's copy). */
  private resolveClick(
    command: RemoteAssistCommand,
  ): { function: string; arguments: Record<string, unknown> } | { error: string } {
    const live = this.live;
    if (!live) return { error: "The live view is not on in this page." };
    const args = command.arguments ?? {};
    const node = typeof args.node === "number" ? live.getNode(args.node) : null;
    if (!node || !node.isConnected) return { error: ELEMENT_GONE };
    const target = findClickTarget(node, window.location.href);
    if (!target || !deepEqual(target.preview, args.expect)) return { error: PAGE_CHANGED };
    return clickInvocation(target, {
      getFunction: (name) => this.deps.getFunction(name),
      routes: this.deps.getRoutes?.() ?? null,
    });
  }

  private async runScreenshot(
    sessionId: string,
    epoch: number,
    command: RemoteAssistCommand,
    report: (status: "failed" | "rejected", result: null, error: string) => Promise<void>,
  ): Promise<void> {
    const screenshot = this.options.screenshot;
    if (!screenshot) {
      await report("rejected", null, "Screenshots are not enabled on this page.");
      return;
    }
    let blob: Blob;
    try {
      blob = await this.deps.capture({
        mask: screenshot.mask,
        capture: screenshot.capture,
        exclude: (node) => !!this.ui?.owns(node),
      });
    } catch (error) {
      if (this.isGranted(sessionId, epoch)) await report("failed", null, errorMessage(error));
      return;
    }
    // Stopped while capturing: the image never leaves the browser.
    if (!this.isGranted(sessionId, epoch)) return;
    try {
      const form = new FormData();
      const extension = blob.type.split("/")[1] || "png";
      form.append("file", blob, `screenshot.${extension}`);
      await this.deps.http.postFormData(
        `${API}/remote-assist/commands/${encodeURIComponent(command.id)}/screenshot`,
        form,
      );
      this.deps.emit("remoteAssist:command", { sessionId, command, status: "done" });
      this.recordSupport("support.screenshot", "Support agent took a screenshot of the page");
    } catch (error) {
      await report("failed", null, `Uploading the screenshot failed: ${errorMessage(error)}`);
    }
  }

  private recordSupport(name: string, summary: string, args?: Record<string, unknown>): void {
    const agent = this.session?.agentName;
    this.deps.recordActivity({
      actor: "support",
      name,
      summary: agent ? summary.replace("Support agent", `Support agent ${agent}`) : summary,
      ...(args && Object.keys(args).length > 0 ? { data: { arguments: args } } : {}),
    });
  }

  private askApproval(request: RemoteAssistApprovalRequest): Promise<Decision> {
    return new Promise<Decision>((resolve) => {
      this.approval = { request, resolve };
      this.changed();
      this.deps.emit("remoteAssist:approval", request);
    });
  }

  private decide(commandId: string, decision: Decision): void {
    const pending = this.approval;
    if (!pending || pending.request.commandId !== commandId) return;
    this.approval = null;
    pending.resolve(decision);
    this.changed();
  }

  // ── Page context ───────────────────────────────────────────────────

  /** Functions a support agent may call: the registry minus `remote: false`. */
  manifest(): ClientFunctionSchema[] {
    return this.deps
      .getFunctions()
      .filter((fn) => fn.remote !== false)
      .map((fn) => fn.schema);
  }

  private contextBody(): Record<string, unknown> {
    const hasWindow = typeof window !== "undefined" && !!window.location;
    let state: unknown = null;
    try {
      state = capState(this.deps.getPageState());
    } catch (error) {
      logger.warn("Reading the page state for remote assistance failed:", error);
    }
    return {
      functions: this.manifest(),
      screenshot: !!this.options.screenshot,
      live_view: this.liveViewAllowed() && (!this.session || this.liveOff !== this.session.id),
      voice: this.voiceAllowed(),
      page: {
        url: hasWindow ? pageUrl(window.location) : "",
        title: typeof document !== "undefined" ? document.title : "",
      },
      state,
      errors: this.recentErrors(),
    };
  }

  private recentErrors(): Array<Record<string, unknown>> | null {
    let errors: CapturedError[] | null = null;
    try {
      errors = this.deps.getErrors?.() ?? null;
    } catch (error) {
      logger.warn("Reading the page errors for remote assistance failed:", error);
    }
    if (!errors) return null;
    return errors.slice(-MAX_ERRORS).map((entry) => ({
      type: entry.type,
      message: entry.message,
      source: entry.source ?? null,
      line: entry.line ?? null,
      col: entry.col ?? null,
      stack: entry.stack ? entry.stack.slice(0, MAX_ERROR_STACK_CHARS) : null,
      route: entry.route,
      first_at: new Date(entry.firstAt).toISOString(),
      last_at: new Date(entry.lastAt).toISOString(),
      count: entry.count,
    }));
  }

  private async pushContext({ onlyIfChanged = false } = {}): Promise<void> {
    const sessionId = this.grantedId;
    if (!sessionId || !this.isGranted(sessionId, this.epoch)) return;
    if (this.contextTimer) {
      clearTimeout(this.contextTimer);
      this.contextTimer = null;
    }
    const body = this.contextBody();
    const signature = contextSignature(body);
    if (onlyIfChanged && signature !== null && signature === this.sentContext) return;
    try {
      await this.deps.http.put(
        `${API}/remote-assist/sessions/${encodeURIComponent(sessionId)}/context`,
        body,
      );
      this.sentContext = signature;
    } catch (error) {
      if (error instanceof AgoApiError && error.statusCode === 409) void this.refresh();
      else logger.warn("Sending the page context failed:", error);
    }
  }

  private scheduleContext(): void {
    if (this.state !== "active") return;
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.contextTimer = setTimeout(() => {
      this.contextTimer = null;
      void this.pushContext({ onlyIfChanged: true });
    }, CONTEXT_DEBOUNCE_MS);
  }

  /**
   * Watch for route and state changes without patching `history`: popstate,
   * hashchange, a one-second href poll (SPA pushState), and the registry and
   * context change notifications.
   */
  private startReporting(): void {
    if (this.stopReporting) return;
    const schedule = (): void => this.scheduleContext();
    const offFunctions = this.deps.onFunctionsChanged(schedule);
    const offContext = this.deps.onContextChanged(schedule);
    const teardown: Array<() => void> = [offFunctions, offContext];
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", schedule);
      window.addEventListener("hashchange", schedule);
      this.lastHref = window.location?.href ?? "";
      const poll = setInterval(() => {
        const href = window.location?.href ?? "";
        if (href !== this.lastHref) {
          this.lastHref = href;
          schedule();
        }
      }, ROUTE_POLL_MS);
      teardown.push(
        () => window.removeEventListener("popstate", schedule),
        () => window.removeEventListener("hashchange", schedule),
        () => clearInterval(poll),
      );
    }
    this.stopReporting = () => teardown.forEach((fn) => fn());
  }

  private clearTimers(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.expiryTimer = null;
    this.contextTimer = null;
    this.sentContext = null;
    this.stopReporting?.();
    this.stopReporting = null;
    this.stopLive();
  }

  private voiceAllowed(): boolean {
    return this.options.voice && !!this.deps.answerCall && (this.deps.canCall?.() ?? false);
  }

  // ── Live view ──────────────────────────────────────────────────────

  private liveViewAllowed(): boolean {
    return !!this.options.liveView && !!this.deps.record && (this.deps.canRecord?.() ?? false);
  }

  /** Record the page while the session is active in this tab. */
  private startLive(): void {
    const sessionId = this.grantedId;
    const epoch = this.epoch;
    const record = this.deps.record;
    if (this.live || !record || !sessionId || !this.isGranted(sessionId, epoch)) return;
    if (!this.liveViewAllowed() || this.liveOff === sessionId) return;
    const live = new LiveStream((body, signal) => this.sendLive(sessionId, epoch, body, signal));
    this.live = live;
    record((event) => live.push(event), this.options.liveView?.mask ?? [])
      .then((recorder) => live.attach(recorder))
      .catch((error) => {
        if (this.live !== live) return;
        logger.error(`The live view could not start: ${errorMessage(error)}`);
        this.disableLive(sessionId);
        void this.pushContext();
      });
  }

  private stopLive(): void {
    this.live?.stop();
    this.live = null;
  }

  private disableLive(sessionId: string): void {
    this.liveOff = sessionId;
    this.stopLive();
  }

  private async sendLive(sessionId: string, epoch: number, body: Blob, signal: AbortSignal): Promise<void> {
    if (!this.isGranted(sessionId, epoch)) return;
    const form = new FormData();
    form.append("file", body, "events.json");
    try {
      await this.deps.http.postFormData(
        `${API}/remote-assist/sessions/${encodeURIComponent(sessionId)}/live`,
        form,
        { signal },
      );
    } catch (error) {
      if (signal.aborted || !this.isGranted(sessionId, epoch)) return;
      if (!(error instanceof AgoApiError) || error.statusCode === 429 || (error.statusCode ?? 500) >= 500) {
        throw error;
      }
      if (error.statusCode === 409) {
        this.disableLive(sessionId);
        void this.refresh();
      } else if (error.statusCode === 413) {
        logger.warn("The live view stopped: the page sends more than the server accepts.");
        this.disableLive(sessionId);
        void this.pushContext();
      } else {
        logger.warn("A live view batch was refused and dropped:", error);
      }
    }
  }

  // ── Local grant (per tab) ──────────────────────────────────────────

  private storage(): Storage | null {
    try {
      return this.deps.storage?.() ?? null;
    } catch {
      return null;
    }
  }

  private readGrant(): { sessionId: string; conversationId: string } | null {
    try {
      const raw = this.storage()?.getItem(GRANT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { sessionId?: unknown; conversationId?: unknown };
      if (typeof parsed.sessionId !== "string" || typeof parsed.conversationId !== "string") return null;
      return { sessionId: parsed.sessionId, conversationId: parsed.conversationId };
    } catch {
      return null;
    }
  }

  private writeGrant(grant: { sessionId: string; conversationId: string }): void {
    try {
      this.storage()?.setItem(GRANT_STORAGE_KEY, JSON.stringify(grant));
    } catch {
      // Without storage the session still works; it just ends on reload.
    }
  }

  private clearGrant(): void {
    try {
      this.storage()?.removeItem(GRANT_STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  }

  // ── UI ─────────────────────────────────────────────────────────────

  private changed(): void {
    this.snapshot = null;
    this.renderUi();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        logger.error("Remote-assistance listener failed:", error);
      }
    }
  }

  private renderUi(): void {
    if (!this.options.ui || this.destroyed) return;
    if (this.ui) {
      this.ui.render(this.getSnapshot());
      return;
    }
    if (this.state === "idle" || !this.deps.loadUi || this.uiLoading) return;
    this.uiLoading = this.deps
      .loadUi({
        accept: () => void this.accept(),
        decline: () => this.decline(),
        stop: () => this.stop(),
        approve: (id) => this.approve(id),
        reject: (id) => this.reject(id),
        acceptCall: () => void this.acceptCall(),
        declineCall: () => this.declineCall(),
        hangUpCall: () => this.hangUpCall(),
        setCallMuted: (muted) => this.setCallMuted(muted),
      })
      .then((ui) => {
        if (this.destroyed) {
          ui.destroy();
          return;
        }
        this.ui = ui;
        ui.render(this.getSnapshot());
      })
      .catch((error) => logger.error("Loading the remote-assistance UI failed:", error))
      .finally(() => {
        this.uiLoading = null;
      });
  }
}
