/** Screenshot settings of {@link RemoteAssistOptions}. */
export interface RemoteAssistScreenshotOptions {
  /**
   * Extra CSS selectors masked in screenshots (drawn as a solid block).
   * Password inputs, `[data-ago-mask]`, and inputs whose `autocomplete` is a
   * credit-card or one-time-code token are always masked.
   */
  mask?: string[];
  /**
   * Capture the page yourself (e.g. with your own renderer). Overrides the
   * built-in capture, including its masking: you own what the image shows.
   * Must resolve to a PNG, JPEG or WebP blob of at most 3 MB.
   */
  capture?: () => Promise<Blob>;
}

/** Live view settings of {@link RemoteAssistOptions}. */
export interface RemoteAssistLiveViewOptions {
  /**
   * Extra CSS selectors left out of the live view (the agent sees an empty
   * box). The fields screenshots always mask are always left out too.
   */
  mask?: string[];
}

/** Host opt-in for remote assistance (see `AgoConfig.remoteAssist`). */
export interface RemoteAssistOptions {
  /**
   * Allow the support agent to request screenshots of the visible page.
   * Off by default.
   */
  screenshot?: boolean | RemoteAssistScreenshotOptions;
  /**
   * Let the support agent watch the page live and click in it. A click only
   * runs the registered function the clicked element is declared for
   * (`data-ago-action`, `data-ago-state`, or a link to a declared route).
   * Off by default.
   */
  liveView?: boolean | RemoteAssistLiveViewOptions;
  /**
   * Render the SDK's consent prompt, session banner and approval prompt.
   * Default `true`. Set `false` when your app renders its own UI from the
   * `remoteAssist:*` events (or `useRemoteAssist()`).
   */
  ui?: boolean;
}

/** Local state of the remote-assistance controller. */
export type RemoteAssistState = "idle" | "requested" | "active";

/** A remote-assistance session as the visitor sees it. */
export interface RemoteAssistSession {
  id: string;
  conversationId: string;
  status: "requested" | "active";
  /** First name of the support agent, when known. */
  agentName: string | null;
  requestedAt: Date | null;
  expiresAt: Date | null;
  /** Whether this page allows the agent to take screenshots. */
  screenshot: boolean;
  /** Whether this page lets the agent watch it live and click in it. */
  liveView: boolean;
}

/** Why a session ended locally. */
export type RemoteAssistEndReason =
  | "declined"
  | "stopped"
  | "ended"
  | "expired"
  | "handoff_ended"
  | "conversation_changed";

/** A command handed out by `POST .../commands/claim`. */
export interface RemoteAssistCommand {
  id: string;
  seq: number;
  kind: "function" | "screenshot" | "click";
  function: string | null;
  arguments: Record<string, unknown>;
}

/** Status of a remote command, as reported by `remoteAssist:command`. */
export type RemoteAssistCommandStatus =
  | "running"
  | "awaiting_approval"
  | "done"
  | "failed"
  | "rejected";

export interface RemoteAssistCommandEvent {
  sessionId: string;
  command: RemoteAssistCommand;
  status: RemoteAssistCommandStatus;
  error?: string;
}

/** A remote command waiting for the visitor's approval. */
export interface RemoteAssistApprovalRequest {
  sessionId: string;
  commandId: string;
  functionName: string;
  arguments: Record<string, unknown>;
  agentName: string | null;
}

/** Snapshot of the controller, as exposed to hooks. */
export interface RemoteAssistSnapshot {
  state: RemoteAssistState;
  session: RemoteAssistSession | null;
  /** The command currently waiting for approval, if any. */
  pendingApproval: RemoteAssistApprovalRequest | null;
  /** An accept request is in flight (disable the Accept button). */
  accepting: boolean;
}
