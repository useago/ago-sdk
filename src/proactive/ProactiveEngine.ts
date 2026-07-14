import type { AgoClient } from "../client/AgoClient";
import type { SignalCollector } from "../signals/SignalCollector";
import { generateUuid } from "../utils/uuid";
import { logger } from "../utils/logger";
import { matchesWhen } from "./matchers";
import type { NudgeGovernor } from "./NudgeGovernor";
import type { ProactiveEventTracker } from "./ProactiveEventTracker";
import type {
  NudgeAction,
  ProactiveEvaluateResponse,
  ProactiveNudgeInstance,
  ProactiveOptions,
  ProactiveTrigger,
} from "./types";

const DEFAULT_TICK_MS = 1_000;
const CONFIG_PATH = "/api/sdk/v1/config";
const EVALUATE_PATH = "/api/sdk/v1/proactive/evaluate";

export interface ProactiveEngineDeps {
  client: AgoClient;
  collector: SignalCollector;
  governor: NudgeGovernor;
  tracker: ProactiveEventTracker;
  options: ProactiveOptions;
}

/**
 * Deterministic heart of the proactive mode: a debounced ~1s tick evaluates
 * the declarative triggers against the collector's snapshot — zero network.
 * Only when a trigger matches AND every governor gate passes does anything
 * fire: a `static` trigger emits `nudge:ready` directly; an `agent` trigger
 * makes ONE call to the backend's fast-LLM second filter, which decides
 * whether (and how) to intervene. Never any polling, never streamed events.
 */
export class ProactiveEngine {
  private readonly client: AgoClient;
  private readonly collector: SignalCollector;
  private readonly governor: NudgeGovernor;
  private readonly tracker: ProactiveEventTracker;
  private readonly options: ProactiveOptions;
  private readonly tickMs: number;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private teardowns: Array<() => void> = [];
  private started = false;

  private activeNudge: ProactiveNudgeInstance | null = null;
  /** Latest conversation seen on the client — target of hidden kickoffs. */
  private lastConversationId: string | null = null;
  /** Nudge ids already counted as shown (idempotence for the hook + component). */
  private shownIds = new Set<string>();
  /** Nudge ids already resolved (accepted or dismissed). */
  private resolvedIds = new Set<string>();
  private lastEvaluationAt = 0;

  constructor(deps: ProactiveEngineDeps) {
    this.client = deps.client;
    this.collector = deps.collector;
    this.governor = deps.governor;
    this.tracker = deps.tracker;
    this.options = deps.options;
    this.tickMs = deps.options.tickMs ?? DEFAULT_TICK_MS;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    if (this.options.enabledOverride !== undefined) {
      // Demo/test escape hatch: no remote fetch, the override IS the switch.
      // The evaluate endpoint stays gated server-side regardless.
      this.governor.setKillSwitch(this.options.enabledOverride);
    } else {
      void this.loadKillSwitch();
    }

    // Suppress nudges while a message turn is in flight (the user is already
    // engaged with the agent). WAITING_CLIENT pauses keep the flag up: the
    // resumed stream's message:complete clears it.
    const onStart = (data: { conversationId: string }) => {
      if (data.conversationId) this.lastConversationId = data.conversationId;
      this.governor.setTurnInFlight(true);
    };
    const onComplete = () => this.governor.setTurnInFlight(false);
    const onError = () => this.governor.setTurnInFlight(false);
    const onLoaded = (conversation: { id: string }) => {
      if (conversation?.id) this.lastConversationId = conversation.id;
    };
    this.client.on("message:start", onStart);
    this.client.on("message:complete", onComplete);
    this.client.on("message:error", onError);
    this.client.on("conversation:loaded", onLoaded);
    this.teardowns.push(() => {
      this.client.off("message:start", onStart);
      this.client.off("message:complete", onComplete);
      this.client.off("message:error", onError);
      this.client.off("conversation:loaded", onLoaded);
    });

    // Debounced tick: the interval is the baseline (it also advances the
    // time-derived idle/dwell thresholds); fresh signals trigger an immediate
    // evaluation, capped to one per tick window.
    this.tickTimer = setInterval(() => this.evaluate(), this.tickMs);
    this.teardowns.push(
      this.collector.subscribe(() => {
        if (Date.now() - this.lastEvaluationAt >= this.tickMs) this.evaluate();
      })
    );
  }

  stop(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const teardown of this.teardowns) teardown();
    this.teardowns = [];
    this.started = false;
  }

  getActiveNudge(): ProactiveNudgeInstance | null {
    return this.activeNudge;
  }

  /**
   * Server kill-switch — backend contract (built in parallel, keep in sync):
   * `GET {baseUrl}/api/sdk/v1/config` responds with (among the existing
   * fields) `"proactive": { "enabled": boolean }`. The engine fetches it
   * lazily once at start; proactive stays DISABLED when the field is absent
   * or the fetch fails.
   */
  private async loadKillSwitch(): Promise<void> {
    try {
      const config = await this.client
        .getHttp()
        .get<{ proactive?: { enabled?: boolean } }>(CONFIG_PATH);
      this.governor.setKillSwitch(config?.proactive?.enabled === true);
    } catch (err) {
      logger.debug("Proactive config fetch failed; staying disabled:", err);
      this.governor.setKillSwitch(false);
    }
  }

  /** One evaluation pass. Zero network unless an `agent` trigger fires. */
  private evaluate(): void {
    this.lastEvaluationAt = Date.now();
    // Nudging a hidden tab is pointless; idle keeps accruing for later.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    if (this.governor.isSlotOccupied()) return;

    const snapshot = this.collector.getSnapshot();
    for (const trigger of this.options.triggers) {
      if (!matchesWhen(trigger.when, snapshot)) continue;
      if (!this.governor.canFire(trigger)) continue;
      this.fire(trigger);
      return; // single-nudge slot: at most one firing per pass
    }
  }

  private fire(trigger: ProactiveTrigger): void {
    // Cooldown starts at the firing attempt (evaluate included), so a
    // condition that stays true can't re-fire — or re-call the backend —
    // every tick.
    this.governor.recordFired(trigger.id);
    this.governor.occupySlot();

    if (trigger.intervene === "agent") {
      void this.evaluateWithAgent(trigger);
      return;
    }

    this.setReady({
      id: generateUuid(),
      triggerId: trigger.id,
      source: "static",
      message: trigger.intervene.message,
      action: trigger.intervene.action,
      goal: trigger.goal,
      kickoff: trigger.kickoff,
      createdAt: new Date(),
    });
  }

  /**
   * LLM second filter — backend contract (built in parallel, keep in sync):
   *
   *   POST {baseUrl}/api/sdk/v1/proactive/evaluate   (same auth headers as
   *   every SDK call — HttpClient adds them; the backend also rate-caps per
   *   anon id and answers 429 when exceeded)
   *
   *   Request:
   *   { "client_nudge_id": "<uuid generated by SDK per nudge instance>",
   *     "trigger_id": "...", "goal": "...",
   *     "agent": "<optional agent name from config>",
   *     "signals": { ...aggregated snapshot... },
   *     "client_context": { "entries": { ... } },
   *     "client_functions": [ { "name", "description", "parameters" } ] }
   *
   *   Response 200:
   *   { "intervene": boolean, "message": string | null,
   *     "action": { "label", "function_name", "arguments" } | null,
   *     "nudge_id": "<server uuid>" }
   *
   * On 429 or ANY error: treated as `intervene: false`, silently (debug log
   * only).
   */
  private async evaluateWithAgent(trigger: ProactiveTrigger): Promise<void> {
    const clientNudgeId = generateUuid();
    const body = {
      client_nudge_id: clientNudgeId,
      trigger_id: trigger.id,
      goal: trigger.goal ?? "",
      agent: this.client.getConfiguredAgent(),
      signals: this.collector.getSnapshot(),
      client_context: this.client.getContextSnapshot() ?? { entries: {} },
      client_functions: this.client.getRegisteredFunctions(),
    };

    let response: ProactiveEvaluateResponse;
    try {
      response = await this.client
        .getHttp()
        .post<ProactiveEvaluateResponse>(EVALUATE_PATH, body);
    } catch (err) {
      logger.debug("Proactive evaluate failed (treated as no-intervene):", err);
      this.governor.releaseSlot();
      return;
    }

    if (!response?.intervene || !response.message) {
      this.governor.releaseSlot();
      return;
    }

    this.setReady({
      id: clientNudgeId,
      triggerId: trigger.id,
      source: "agent",
      message: response.message,
      action: mapServerAction(response.action),
      goal: trigger.goal,
      kickoff: trigger.kickoff,
      createdAt: new Date(),
      serverNudgeId: response.nudge_id,
    });
  }

  private setReady(nudge: ProactiveNudgeInstance): void {
    this.activeNudge = nudge;
    this.client.emitProactiveEvent("nudge:ready", nudge);
  }

  // ───────────────────────────────────────────────────────────────
  // Nudge lifecycle (driven by the controller / hook / component)
  // ───────────────────────────────────────────────────────────────

  /** Idempotent per nudge: caps + impression tracking + `nudge:shown`. */
  shown(nudge: ProactiveNudgeInstance): void {
    if (this.shownIds.has(nudge.id)) return;
    this.shownIds.add(nudge.id);
    this.governor.recordNudgeShown();
    this.tracker.track({
      clientNudgeId: nudge.id,
      triggerId: nudge.triggerId,
      source: nudge.source,
      type: "shown",
      message: nudge.message,
      occurredAt: Date.now(),
    });
    this.client.emitProactiveEvent("nudge:shown", { nudge });
  }

  dismiss(nudge: ProactiveNudgeInstance): void {
    if (this.resolvedIds.has(nudge.id)) return;
    this.resolvedIds.add(nudge.id);
    this.governor.recordDismissed(nudge.triggerId);
    this.tracker.track({
      clientNudgeId: nudge.id,
      triggerId: nudge.triggerId,
      source: nudge.source,
      type: "dismissed",
      occurredAt: Date.now(),
    });
    this.clearActive(nudge);
    this.client.emitProactiveEvent("nudge:dismissed", { nudge });
  }

  async accept(nudge: ProactiveNudgeInstance): Promise<void> {
    if (this.resolvedIds.has(nudge.id)) return;
    this.resolvedIds.add(nudge.id);
    this.tracker.track({
      clientNudgeId: nudge.id,
      triggerId: nudge.triggerId,
      source: nudge.source,
      type: "accepted",
      occurredAt: Date.now(),
    });
    this.clearActive(nudge);
    this.client.emitProactiveEvent("nudge:accepted", { nudge });

    // Agent-backed nudges (and static nudges with a goal) expand into the
    // chat; the friction snapshot rides along automatically as client_context.
    // Two cases — the backend rejects a hidden message that would OPEN a
    // conversation, so:
    // - conversation already open → hidden meta kickoff (the `hidden: true`
    //   pattern used by auto-continuation) targeted at it;
    // - no conversation yet → the trigger's user-voice `kickoff` line, sent
    //   visible (it opens the conversation); without one, skip the pre-seed.
    // Fire-and-forget: accept() must not block on a streaming turn.
    if (nudge.source === "agent" || nudge.goal) {
      if (this.lastConversationId) {
        void this.client
          .sendMessage(buildKickoffPrompt(nudge), {
            hidden: true,
            conversationId: this.lastConversationId,
          })
          .catch((err) => logger.debug("Nudge kickoff message failed:", err));
      } else if (nudge.kickoff) {
        void this.client
          .sendMessage(nudge.kickoff)
          .catch((err) => logger.debug("Nudge kickoff message failed:", err));
      } else {
        logger.debug(
          "Nudge accepted with no open conversation and no trigger.kickoff; " +
            "skipping the chat pre-seed (a hidden message cannot open a conversation)."
        );
      }
    }

    if (nudge.action) {
      await this.runAction(nudge.action);
    }
  }

  markConverted(nudge: ProactiveNudgeInstance): void {
    this.tracker.track({
      clientNudgeId: nudge.id,
      triggerId: nudge.triggerId,
      source: nudge.source,
      type: "converted",
      occurredAt: Date.now(),
    });
  }

  private clearActive(nudge: ProactiveNudgeInstance): void {
    if (this.activeNudge?.id === nudge.id) {
      this.activeNudge = null;
    }
    this.governor.releaseSlot();
  }

  /**
   * Execute a nudge action through the client's FunctionRegistry — the same
   * execution path (size guards, error wrapping) as agent-invoked functions.
   * The user's explicit click on the action button IS the approval, so no
   * additional approval gate applies here.
   */
  private async runAction(action: NudgeAction): Promise<void> {
    try {
      if ("functionName" in action) {
        await this.client.executeClientFunction(
          action.functionName,
          action.arguments ?? {}
        );
      } else {
        // Goes through the registered page-state controls (the synthesized
        // `setPageState` function). Pages using a custom page-state function
        // name should use the `functionName` action form instead.
        await this.client.executeClientFunction("setPageState", action.setPageState);
      }
    } catch (err) {
      logger.warn("Nudge action failed:", err);
    }
  }
}

function mapServerAction(
  action: ProactiveEvaluateResponse["action"]
): NudgeAction | undefined {
  if (!action) return undefined;
  return {
    label: action.label,
    functionName: action.function_name,
    arguments: action.arguments,
  };
}

function buildKickoffPrompt(nudge: ProactiveNudgeInstance): string {
  const goalPart = nudge.goal ? ` Goal: ${nudge.goal}.` : "";
  return (
    `The user accepted a proactive nudge that said: "${nudge.message}".${goalPart} ` +
    "Recent friction signals are in the client context (friction_signals). " +
    "Start helping with this now: briefly explain what you can do and take the first concrete step."
  );
}
