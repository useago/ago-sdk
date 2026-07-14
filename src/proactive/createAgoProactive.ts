import type { AgoClient } from "../client/AgoClient";
import { SignalCollector } from "../signals/SignalCollector";
import { logger } from "../utils/logger";
import { NudgeGovernor } from "./NudgeGovernor";
import { ProactiveEngine } from "./ProactiveEngine";
import { ProactiveEventTracker } from "./ProactiveEventTracker";
import type { ProactiveController, ProactiveOptions } from "./types";

/** Context key under which the friction snapshot rides along with messages. */
const FRICTION_CONTEXT_KEY = "friction_signals";

/**
 * Attach the proactive mode to a client: starts the signal collector, the
 * trigger engine, and the nudge governor, and registers the aggregated
 * friction snapshot as a dynamic context provider so the reactive mode
 * benefits too (the agent "knows" the user hesitated on every message).
 *
 * ```ts
 * const proactive = createAgoProactive(client, {
 *   triggers: [{
 *     id: "kyc-doc-stuck",
 *     when: { route: "/dossier/*", idleMs: 20000, pageState: { step: "documents" } },
 *     cooldownMs: 300_000,
 *     intervene: "agent",
 *     goal: "Help the user upload their KYC documents",
 *   }],
 *   frequencyCap: { perSession: 3, perDay: 5 },
 * });
 * // later: proactive.destroy();
 * ```
 *
 * Also wired through the config: `new AgoClient({ ..., proactive })` attaches
 * it automatically and exposes it as `client.proactive`.
 *
 * Nothing fires until the backend confirms the feature: the engine reads the
 * `proactive.enabled` kill-switch from `GET /api/sdk/v1/config` and stays
 * disabled by default.
 */
export function createAgoProactive(
  client: AgoClient,
  options: ProactiveOptions
): ProactiveController {
  if (client.proactive) {
    logger.warn(
      "createAgoProactive: a proactive controller is already attached; replacing it."
    );
    client.proactive.destroy();
  }

  const collector = new SignalCollector({
    ...options.signals,
    // Funnel state for the matchers: merge the `page-state:*` dynamic context
    // entries that useAgoPageState / registerPageStateFunction already
    // register — no new wiring needed on the page.
    getPageState: () => {
      const snapshot = client.getContextSnapshot();
      if (!snapshot) return null;
      const merged: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(snapshot.entries)) {
        if (key.startsWith("page-state:") && entry.data) {
          Object.assign(merged, entry.data);
        }
      }
      return Object.keys(merged).length > 0 ? merged : null;
    },
  });
  collector.start();

  // Ride-along context: the snapshot goes out as client_context with every
  // message. pageState is excluded — it already travels under its own
  // `page-state:*` entries (and reading it here would recurse through
  // getContextSnapshot).
  client.addDynamicContext(FRICTION_CONTEXT_KEY, () => {
    const snap = collector.getSnapshot({ pageState: false });
    const { pageState: _pageState, ...data } = snap;
    return {
      name: "Friction signals",
      description:
        "Behavioral friction observed on the current page: dwell/idle times, " +
        "rage clicks, route bounces, repeated field errors (names and counters only).",
      data,
    };
  });

  const governor = new NudgeGovernor({
    frequencyCap: options.frequencyCap,
    storage: options.storage,
    storageKey: options.storageKey,
  });

  const tracker = new ProactiveEventTracker({
    post: (path, body, opts) => client.getHttp().post(path, body, opts),
    agent: client.getConfiguredAgent(),
  });

  const engine = new ProactiveEngine({
    client,
    collector,
    governor,
    tracker,
    options,
  });
  engine.start();

  const controller: ProactiveController = {
    optOut: () => governor.optOut(),
    optIn: () => governor.optIn(),
    isOptedOut: () => governor.isOptedOut(),
    setEngaged: (engaged) => governor.setEngaged(engaged),
    signalFieldError: (fieldName) => collector.signalFieldError(fieldName),
    getSignalsSnapshot: () => collector.getSnapshot(),
    getActiveNudge: () => engine.getActiveNudge(),
    shown: (nudge) => engine.shown(nudge),
    accept: (nudge) => engine.accept(nudge),
    dismiss: (nudge) => engine.dismiss(nudge),
    markConverted: (nudge) => engine.markConverted(nudge),
    destroy: () => {
      engine.stop();
      tracker.destroy();
      collector.destroy();
      client.removeDynamicContext(FRICTION_CONTEXT_KEY);
      if (client.proactive === controller) {
        client.proactive = null;
      }
    },
  };

  client.proactive = controller;
  return controller;
}
