import { HttpClient, isAbortError } from "../api/HttpClient";
import { SSEHandler } from "../streaming/SSEHandler";
import {
  AgoApiError,
  AgoError,
  AgoNetworkError,
  AgoStreamError,
} from "./errors";
import { normalizeInteraction, normalizeMessage } from "./messageNormalizer";
import { mapConversation, type RawConversation } from "./conversationMapping";
import type {
  AgoMessage,
  Conversation,
  ConversationInteraction,
} from "./types";

type RawInteraction = {
  can_send_message: boolean;
  blocking_message_id: string | null;
};
type RawStatus = Parameters<typeof normalizeMessage>[0] & {
  viewer_id?: string;
  interaction?: RawInteraction;
};
type Snapshot = {
  viewerId: string;
  interaction: ConversationInteraction;
  message: AgoMessage;
};

const unfinished = (message: AgoMessage) =>
  ["TODO", "IN_PROGRESS", "WAITING_APPROVAL", "PAUSED"].includes(
    message.status,
  );
const terminal = (message: AgoMessage) =>
  ["DONE", "ERROR", "CANCELED"].includes(message.status);

/** Owns one open conversation's observation and completion delivery. */
export class ConversationObserver {
  private conversationId: string | null = null;
  private viewerId: string | undefined;
  private verifiedConversationId: string | undefined;
  private generation = 0;
  private ownerEpoch = 0;
  private principalEpoch = 0;
  private identityCheck: Promise<void> = Promise.resolve();
  private verification: { resolve(): void; reject(error: Error): void } | null =
    null;
  private verificationFailed = false;
  private controller: AbortController | null = null;
  private decisions = new Set<AbortController>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private observed = new Set<string>();
  private completed = new Set<string>();
  private current: AgoMessage | null = null;
  private loaded: Conversation | null = null;
  private activating: Promise<Conversation | null> | null = null;
  private activationFailed = false;
  private onIdentityReset?: (preserveCurrent?: boolean) => void;

  constructor(
    private http: HttpClient,
    private events: {
      update(message: AgoMessage): void;
      interaction(
        data:
          | { conversationId: string; interaction: ConversationInteraction }
          | { conversationId: null; interaction: null },
      ): void;
      complete(message: AgoMessage): void;
      connection(connected: boolean, error?: Error): void;
    },
    onIdentityReset?: (preserveCurrent?: boolean) => void,
  ) {
    this.onIdentityReset = onIdentityReset;
  }

  latestMessage(id: string): AgoMessage | undefined {
    if (this.loaded?.id === this.conversationId)
      return this.loaded.messages?.find((message) => message.id === id);
    return this.current?.id === id ? this.current : undefined;
  }

  get active(): string | null {
    return this.conversationId;
  }
  get token(): number {
    return this.generation;
  }
  get needsVerification(): boolean {
    return this.verification !== null;
  }
  get verificationUnavailable(): boolean {
    return this.verificationFailed;
  }
  get owner(): number {
    return this.ownerEpoch;
  }
  get principal(): number {
    return this.principalEpoch;
  }
  assertPrincipalNow(principal: number): void {
    if (principal !== this.principalEpoch)
      throw new AgoError(
        "The request was detached from the current identity.",
        "request_detached",
      );
  }
  async assertPrincipal(principal: number): Promise<void> {
    if (principal !== this.principalEpoch)
      throw new AgoError(
        "The request was detached from the current identity.",
        "request_detached",
      );
    await this.identityCheck;
    if (principal !== this.principalEpoch)
      throw new AgoError(
        "The request was detached from the current identity.",
        "request_detached",
      );
  }
  async assertOwner(owner: number): Promise<void> {
    if (owner !== this.ownerEpoch)
      throw new AgoError(
        "The request was detached from the conversation.",
        "request_detached",
      );
    await this.identityCheck;
    if (owner !== this.ownerEpoch)
      throw new AgoError(
        "The request was detached from the conversation.",
        "request_detached",
      );
  }
  async withOwner<T>(owner: number, effect: () => T): Promise<Awaited<T>> {
    while (true) {
      await this.assertOwner(owner);
      this.assertOwnerNow(owner);
      if (!this.needsVerification) return effect() as Awaited<T>;
    }
  }
  async withPrincipal<T>(
    principal: number,
    effect: () => T,
  ): Promise<Awaited<T>> {
    while (true) {
      await this.assertPrincipal(principal);
      this.assertPrincipalNow(principal);
      if (!this.needsVerification) return effect() as Awaited<T>;
    }
  }
  owns(token: number): boolean {
    return token === this.generation;
  }
  assertOwnerNow(owner: number): void {
    if (owner !== this.ownerEpoch)
      throw new AgoError(
        "The request was detached from the conversation.",
        "request_detached",
      );
  }
  assert(token: number): void {
    if (!this.owns(token))
      throw new AgoError(
        "The request was detached from the conversation.",
        "request_detached",
      );
  }

  private invalidate(): number {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    for (const controller of this.decisions) controller.abort();
    this.decisions.clear();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    return this.generation;
  }
  detach(): void {
    this.ownerEpoch++;
    this.invalidate();
    this.conversationId = null;
    this.current = null;
    this.loaded = null;
    this.activating = null;
    this.observed.clear();
    if (
      this.verification &&
      !this.verificationFailed &&
      this.verifiedConversationId
    )
      void this.verifyDetached(this.verifiedConversationId, this.generation);
  }
  destroy(): void {
    this.invalidatePrincipal();
    this.detach();
    this.viewerId = undefined;
    this.verifiedConversationId = undefined;
    this.completed.clear();
  }
  private invalidatePrincipal(): void {
    this.principalEpoch++;
    this.verification?.reject(
      new AgoError(
        "The request was detached from the current identity.",
        "request_detached",
      ),
    );
    this.verification = null;
    this.verificationFailed = false;
    this.identityCheck = Promise.resolve();
  }
  reset(): void {
    this.invalidatePrincipal();
    this.detach();
    this.viewerId = undefined;
    this.verifiedConversationId = undefined;
    this.observed.clear();
    this.completed.clear();
    this.onIdentityReset?.();
    this.events.interaction({ conversationId: null, interaction: null });
  }
  beginSend(conversationId?: string): number {
    if ((conversationId ?? null) !== this.conversationId) {
      this.ownerEpoch++;
      this.conversationId = conversationId ?? null;
      this.current = null;
      this.loaded = null;
      this.activating = null;
      this.observed.clear();
    }
    this.invalidate();
    return this.generation;
  }
  retargetFromSend(id: string, token: number): boolean {
    if (!this.owns(token) || !id || id === this.conversationId) return false;
    this.conversationId = id;
    this.current = null;
    this.loaded = null;
    this.observed.clear();
    return true;
  }
  requireVerified(): void {
    if (this.verification) {
      this.reset();
      throw new AgoError(
        "Unable to verify the current viewer.",
        "request_detached",
      );
    }
  }
  private viewer(
    viewerId: string | undefined,
    conversationId?: string,
  ): boolean {
    if (!viewerId) return true;
    if (this.viewerId && this.viewerId !== viewerId) {
      this.reset();
      return false;
    }
    this.viewerId = viewerId;
    if (conversationId) this.verifiedConversationId = conversationId;
    this.verification?.resolve();
    this.verification = null;
    this.verificationFailed = false;
    this.identityCheck = Promise.resolve();
    return true;
  }
  private apply(snapshot: Snapshot, token: number, historical = false): void {
    if (
      !this.owns(token) ||
      !this.viewer(snapshot.viewerId, snapshot.message.conversationId)
    )
      return;
    const { message, interaction } = snapshot;
    if (
      terminal(message) &&
      message.attachments?.some((attachment) => !attachment.url)
    ) {
      if (!historical) this.observed.add(message.id);
      this.schedule(() => void this.status(message.id, token), token);
      return;
    }
    if (this.conversationId && this.conversationId !== message.conversationId)
      return;
    this.conversationId = message.conversationId;
    if (
      this.current?.id === message.id &&
      terminal(this.current) &&
      !terminal(message)
    )
      return;
    this.current = message;
    if (this.loaded?.id === message.conversationId) {
      const messages = [...(this.loaded.messages ?? [])];
      const index = messages.findIndex((entry) => entry.id === message.id);
      if (index < 0) messages.push(message);
      else messages[index] = message;
      this.loaded = { ...this.loaded, messages, interaction };
    }
    if (unfinished(message)) this.observed.add(message.id);
    this.events.update(message);
    if (!this.owns(token)) return;
    this.events.interaction({
      conversationId: message.conversationId,
      interaction,
    });
    if (!this.owns(token)) return;
    if (!historical && terminal(message) && this.observed.has(message.id))
      this.complete(message);
  }
  acceptInitial(snapshot: Snapshot, token: number): void {
    if (!this.owns(token)) return;
    if (
      this.viewerId &&
      snapshot.viewerId &&
      this.viewerId !== snapshot.viewerId
    ) {
      this.principalEpoch++;
      this.ownerEpoch++;
      this.verification?.reject(
        new AgoError(
          "The request was detached from the current identity.",
          "request_detached",
        ),
      );
      this.verification = null;
      this.identityCheck = Promise.resolve();
      this.observed.clear();
      this.completed.clear();
      this.current = null;
      this.conversationId = null;
      this.viewerId = snapshot.viewerId;
      this.onIdentityReset?.(true);
      this.events.interaction({ conversationId: null, interaction: null });
    }
    this.apply(snapshot, token);
  }
  complete(message: AgoMessage): void {
    if (message.attachments?.some((attachment) => !attachment.url)) return;
    if (message.id && this.completed.has(message.id)) return;
    if (message.id) this.completed.add(message.id);
    this.events.complete(message);
  }
  handoff(message: AgoMessage, token: number): void {
    if (!this.owns(token)) return;
    if (!this.conversationId && message.conversationId)
      this.conversationId = message.conversationId;
    if (
      terminal(message) &&
      message.attachments?.some((attachment) => !attachment.url) &&
      message.id
    ) {
      this.observed.add(message.id);
      this.schedule(() => void this.status(message.id, token), token);
      return;
    }
    if (
      message.status === "WAITING_CLIENT" ||
      !unfinished(message) ||
      !message.id ||
      !message.conversationId
    )
      return;
    this.observed.add(message.id);
    this.current = message;
    void this.observe(message, token);
  }
  async activate(id: string | null): Promise<Conversation | null> {
    if (id === null) {
      this.detach();
      return null;
    }
    if (id === this.conversationId) {
      if (this.activating) return this.activating;
      if (this.loaded) return this.loaded;
      if (!this.activationFailed) {
        const token = this.generation;
        const response = await this.http.getStream(
          `/api/sdk/v1/conversations/${id}`,
        );
        this.assert(token);
        const raw = (await response.json()) as RawConversation;
        this.assert(token);
        return mapConversation(raw);
      }
    }
    if (id !== this.conversationId) this.ownerEpoch++;
    const token = this.invalidate();
    this.conversationId = id;
    this.current = null;
    this.loaded = null;
    this.observed.clear();
    this.activationFailed = false;
    const activation = this.history(id, token, true).catch((error) => {
      if (!this.owns(token))
        throw new AgoError(
          "The request was detached from the conversation.",
          "request_detached",
        );
      this.activationFailed = true;
      this.handleError(error);
      throw error;
    });
    this.activating = activation;
    try {
      return await activation;
    } finally {
      if (this.activating === activation) this.activating = null;
    }
  }
  refreshCredentials(logout: boolean): void {
    if (logout) {
      this.reset();
      return;
    }
    if (!this.viewerId) {
      this.reset();
      return;
    }
    if (!this.verification || this.verificationFailed) {
      this.verificationFailed = false;
      this.identityCheck = new Promise<void>((resolve, reject) => {
        this.verification = { resolve, reject };
      });
      void this.identityCheck.catch(() => {});
    }
    const id = this.conversationId;
    const token = this.invalidate();
    if (id) {
      void this.history(id, token, false, true).catch((error) => {
        if (this.owns(token)) this.handleVerificationFailure(error);
      });
    } else if (this.verifiedConversationId) {
      void this.verifyDetached(this.verifiedConversationId, token);
    } else {
      this.reset();
    }
  }
  retryVerification(): void {
    if (this.verificationFailed) this.refreshCredentials(false);
  }
  private async verifyDetached(id: string, token: number): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    try {
      const response = await this.http.getStream(
        `/api/sdk/v1/conversations/${id}`,
        controller.signal,
      );
      this.assert(token);
      const raw = (await response.json()) as RawConversation;
      this.assert(token);
      if (!raw.viewer_id) {
        this.reset();
        return;
      }
      this.viewer(raw.viewer_id, id);
    } catch (error) {
      if (this.owns(token)) this.handleVerificationFailure(error);
    }
  }
  private handleVerificationFailure(error: unknown): void {
    if (this.authorityLost(error, true)) {
      this.reset();
      return;
    }
    if (this.verification) {
      const failure =
        error instanceof Error
          ? error
          : new AgoError(
              "Unable to verify the current viewer.",
              "connection_error",
            );
      this.verification.reject(failure);
      this.verificationFailed = true;
    }
    this.handleError(error);
  }
  private authorityLost(error: unknown, readScope: boolean): boolean {
    return (
      error instanceof AgoApiError &&
      (error.statusCode === 401 ||
        error.type === "authentication_error" ||
        (error.type === "permission_error" &&
          error.code === "insufficient_scope") ||
        (readScope && error.statusCode === 403))
    );
  }
  authorizationError(error: unknown): void {
    if (this.authorityLost(error, false)) this.reset();
  }
  private handleError(error: unknown): void {
    if (this.authorityLost(error, true)) {
      this.reset();
      return;
    }
    if (!isAbortError(error))
      this.events.connection(
        false,
        error instanceof Error ? error : new Error(String(error)),
      );
  }
  private async history(
    id: string,
    token: number,
    historical: boolean,
    requireViewer = false,
  ): Promise<Conversation | null> {
    const controller = new AbortController();
    this.controller = controller;
    const response = await this.http.getStream(
      `/api/sdk/v1/conversations/${id}`,
      controller.signal,
    );
    this.assert(token);
    const raw = (await response.json()) as RawConversation;
    this.assert(token);
    if ((requireViewer || this.verification) && !raw.viewer_id) {
      this.reset();
      throw new AgoError(
        "Unable to verify the current viewer.",
        "request_detached",
      );
    }
    if (!this.viewer(raw.viewer_id, id)) return null;
    const conversation = mapConversation(raw);
    this.events.connection(true);
    this.assert(token);
    this.loaded = conversation;
    if (raw.interaction) {
      const interaction = normalizeInteraction(raw.interaction);
      this.events.interaction({ conversationId: id, interaction });
      this.assert(token);
      const messages = conversation.messages ?? [];
      const target =
        messages.find((m) => m.id === interaction.blockingMessageId) ??
        [...messages]
          .reverse()
          .find(
            (m) =>
              m.role === "assistant" &&
              (unfinished(m) || this.observed.has(m.id)),
          );
      for (const message of messages) {
        if (message !== target) this.events.update(message);
        this.assert(token);
      }
      if (target) {
        this.apply(
          { viewerId: raw.viewer_id ?? "", interaction, message: target },
          token,
          historical,
        );
        this.assert(token);
        if (unfinished(target) && !historical) void this.observe(target, token);
      } else if (!interaction.canSendMessage && !interaction.blockingMessageId)
        this.schedule(() => void this.pollHistory(id, token), token);
    }
    return conversation;
  }
  private async pollHistory(id: string, token: number): Promise<void> {
    try {
      await this.history(id, token, false);
    } catch (error) {
      if (!this.owns(token)) return;
      this.handleError(error);
      if (this.owns(token))
        this.schedule(() => void this.pollHistory(id, token), token);
    }
  }
  startObservation(): void {
    if (this.current && unfinished(this.current))
      void this.observe(this.current, this.generation);
  }
  private schedule(fn: () => void, token: number): void {
    if (!this.owns(token) || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.owns(token)) fn();
    }, 2000);
  }
  private async observe(message: AgoMessage, token: number): Promise<void> {
    if (!this.owns(token)) return;
    try {
      if (["WAITING_APPROVAL", "PAUSED"].includes(message.status)) {
        this.schedule(() => void this.status(message.id, token), token);
        return;
      }
      const controller = new AbortController();
      this.controller = controller;
      const response = await this.http.getStream(
        `/api/sdk/v1/messages/${message.id}/events`,
        controller.signal,
      );
      this.assert(token);
      this.events.connection(true);
      this.assert(token);
      if (!response.body) {
        this.schedule(() => void this.status(message.id, token), token);
        return;
      }
      let latest = message;
      const handler = new SSEHandler(
        {
          onState: (snapshot) => {
            if (!this.owns(token)) return;
            latest = snapshot.message;
            this.apply(snapshot, token);
          },
        },
        { signal: controller.signal },
      );
      await handler.processStream(response);
      this.assert(token);
      if (unfinished(latest))
        this.schedule(() => void this.status(latest.id, token), token);
    } catch (error) {
      if (!this.owns(token)) return;
      this.handleError(error);
      if (this.owns(token))
        this.schedule(() => void this.status(message.id, token), token);
    }
  }
  private async status(id: string, token: number): Promise<void> {
    try {
      const controller = new AbortController();
      this.controller = controller;
      const response = await this.http.getStream(
        `/api/sdk/v1/messages/${id}/status`,
        controller.signal,
      );
      this.assert(token);
      const raw = (await response.json()) as RawStatus;
      this.assert(token);
      this.events.connection(true);
      this.assert(token);
      if (!raw.viewer_id || !raw.interaction)
        throw new AgoStreamError("Incomplete message status snapshot.");
      const message = normalizeMessage(raw, this.conversationId ?? "", true);
      this.apply(
        {
          viewerId: raw.viewer_id,
          interaction: normalizeInteraction(raw.interaction),
          message,
        },
        token,
      );
      if (this.owns(token) && unfinished(message))
        void this.observe(message, token);
    } catch (error) {
      if (!this.owns(token)) return;
      this.handleError(error);
      if (this.owns(token))
        this.schedule(() => void this.status(id, token), token);
    }
  }
  async decide(id: string, decision: "approve" | "reject"): Promise<void> {
    const owner = this.ownerEpoch;
    while (true) {
      await this.assertOwner(owner);
      const controller = new AbortController();
      this.decisions.add(controller);
      try {
        await this.withOwner(owner, () =>
          this.http.postNoContent(
            `/api/sdk/v1/approvals/${encodeURIComponent(id)}/decision`,
            { decision },
            controller.signal,
          ),
        );
        await this.withOwner(owner, () => {
          if (this.current && this.conversationId) {
            const messageId = this.current.id;
            this.invalidate();
            const next = this.generation;
            void this.status(messageId, next);
          }
        });
        return;
      } catch (error) {
        await this.withOwner(owner, () => {
          if (
            error instanceof AgoApiError &&
            (error.statusCode === 401 || error.statusCode === 403)
          ) {
            this.reset();
            throw error;
          }
          if (
            error instanceof AgoApiError &&
            error.statusCode === 409 &&
            this.current
          ) {
            const messageId = this.current.id;
            this.invalidate();
            void this.status(messageId, this.generation);
            throw error;
          }
          if (!(error instanceof AgoNetworkError) && !isAbortError(error))
            throw error;
          if (error instanceof AgoNetworkError)
            this.events.connection(false, error);
        });
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);
          controller.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          if (controller.signal.aborted) {
            clearTimeout(timer);
            resolve();
          }
        });
        await this.assertOwner(owner);
      } finally {
        this.decisions.delete(controller);
      }
    }
  }
}
