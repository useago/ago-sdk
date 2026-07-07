import type { AgoClient } from "./AgoClient";
import type { AgoMessage, ClientFunctionInvocation } from "./types";

/**
 * Default prompt sent as the (hidden) continuation message. Kept short: the
 * agent already has the original request in the conversation history; this only
 * nudges it to use the destination page's freshly-available controls.
 */
const DEFAULT_CONTINUATION_PROMPT =
  "You have navigated the user to a new page. That page now exposes its editable " +
  "state through the available setPageState function, and its current values in " +
  "the page context. If the user's latest request also asked to change something " +
  "on this page, call setPageState now to apply exactly those changes and nothing " +
  "else. Otherwise, reply with a short confirmation only.";

export interface AgoAutoContinueOptions {
  /** Function names whose invocation counts as "navigated". Default `["navigateToPage"]`. */
  navigationFunctions?: string[];
  /** Registered function that signals the destination has editable state. Default `"setPageState"`. */
  pageStateFunctionName?: string;
  /** The hidden continuation prompt. Override for i18n / tone. */
  continuationPrompt?: string;
  /** Max continuations per user gesture (guards navigate→continue→navigate loops). Default `1`. */
  maxDepth?: number;
  /** How long to wait for the destination page to register page-state before giving up. Default `4000`ms. */
  readinessTimeoutMs?: number;
  /** Extra settle delay after page-state appears, to let sibling state mount. Default `150`ms. */
  settleMs?: number;
  /** Opt-out escape hatch. Default `true`. */
  enabled?: boolean;
}

interface ResolvedOptions {
  navigationFunctions: string[];
  pageStateFunctionName: string;
  continuationPrompt: string;
  maxDepth: number;
  readinessTimeoutMs: number;
  settleMs: number;
  enabled: boolean;
}

function resolve(options?: AgoAutoContinueOptions): ResolvedOptions {
  return {
    navigationFunctions: options?.navigationFunctions ?? ["navigateToPage"],
    pageStateFunctionName: options?.pageStateFunctionName ?? "setPageState",
    continuationPrompt: options?.continuationPrompt ?? DEFAULT_CONTINUATION_PROMPT,
    maxDepth: options?.maxDepth ?? 1,
    readinessTimeoutMs: options?.readinessTimeoutMs ?? 4000,
    settleMs: options?.settleMs ?? 150,
    enabled: options?.enabled ?? true,
  };
}

/**
 * Auto-continue the agent after it navigates, so a "go to page B and change X"
 * request completes in one user gesture. Attach once per client; returns a
 * detach function that removes every listener.
 *
 * Two mechanisms, picked by the turn's client-functions mode:
 *
 * - **Pause mode** (`clientFunctionsMode: "pause"`, the default): the backend pauses the turn
 *   on the navigation call (`message:waiting-client`) and the SDK resumes it once
 *   the result is submitted. This helper only registers a *resume gate* that delays
 *   the resume until the destination page's page-state registered (plus a settle
 *   delay), so the continued turn ships the new page's `setPageState` and current
 *   state. Same turn, no extra prompt, backend budget as the guardrail —
 *   `continuationPrompt` and `maxDepth` are unused here.
 *
 * - **Placeholder mode** (legacy, `clientFunctionsMode: "placeholder"`): when the agent calls the navigation
 *   function and that turn ends, this waits for the destination page's state to
 *   register, then sends a hidden continuation message; the agent applies the
 *   state in a second turn (requires backend support for the `hidden` flag).
 *
 * ```ts
 * const detach = attachAutoContinueAfterNavigation(client);
 * // later, on teardown:
 * detach();
 * ```
 *
 * Options can be a plain object, or a getter for live options: the getter is
 * re-read on every event, so changing what it returns never re-subscribes the
 * listeners (this is how the React hook keeps options reactive).
 */
export function attachAutoContinueAfterNavigation(
  client: AgoClient,
  options?: AgoAutoContinueOptions | (() => AgoAutoContinueOptions | undefined)
): () => void {
  const opts: () => ResolvedOptions =
    typeof options === "function" ? () => resolve(options()) : () => resolve(options);

  const state = {
    navigated: false, // a navigation function ran in the current turn
    pausedTurnNavigated: false, // the turn that just paused had navigated (pause mode)
    depth: 0, // continuations sent for the current user gesture
    runId: 0, // cancels stale readiness waits when the user moves on
    ourSendPending: false, // true while our own continuation turn is streaming
  };

  const hasPageState = () =>
    client
      .getRegisteredFunctions()
      .some((f) => f.name === opts().pageStateFunctionName);

  // Resolves true once the destination page registered its page-state (plus a
  // settle delay), or false on timeout / cancellation.
  const waitForPageState = (myRun: number): Promise<boolean> =>
    new Promise((resolveWait) => {
      let done = false;
      const finish = (val: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        client.off("context:changed", onChange);
        resolveWait(val);
      };
      const settleThenFinish = () =>
        setTimeout(
          () => finish(myRun === state.runId && hasPageState()),
          opts().settleMs
        );
      const onChange = () => {
        if (myRun !== state.runId) return finish(false);
        if (hasPageState()) {
          client.off("context:changed", onChange);
          settleThenFinish();
        }
      };
      const timer = setTimeout(
        () => finish(false),
        opts().readinessTimeoutMs
      );
      // Already-registered case (e.g. re-navigating to the current page):
      // no context change will fire, so check synchronously.
      if (hasPageState()) {
        settleThenFinish();
      } else {
        client.on("context:changed", onChange);
      }
    });

  const continueAfterNavigation = async (conversationId: string) => {
    const myRun = ++state.runId;
    const ready = await waitForPageState(myRun);
    // Destination has no editable state, or the user already moved on.
    if (!ready || myRun !== state.runId) return;

    state.depth += 1;
    state.ourSendPending = true;
    try {
      await client.sendMessage(opts().continuationPrompt, {
        conversationId,
        hidden: true,
      });
    } catch {
      state.ourSendPending = false;
    }
  };

  const onInvoke = (data: ClientFunctionInvocation) => {
    if (opts().navigationFunctions.includes(data.functionName)) {
      state.navigated = true;
    }
  };

  // Pause mode: the SDK owns the resume (submit → continue); this gate only
  // delays it until the destination page registered its page state — and only
  // when the paused turn actually navigated (other client functions must not
  // pay the readiness wait). Resolves on timeout too: a destination without
  // editable state should not strand the paused turn.
  const unregisterGate = client.registerResumeGate(async () => {
    if (!opts().enabled) return;
    if (!state.pausedTurnNavigated) return;
    state.pausedTurnNavigated = false;
    await waitForPageState(++state.runId);
  });

  // The paused stream never fires message:complete, so capture the navigation
  // flag here for the gate and reset it — otherwise the RESUMED turn's
  // message:complete would see it and fire a legacy hidden-prompt continuation.
  const onWaitingClient = () => {
    state.pausedTurnNavigated = state.navigated;
    state.navigated = false;
  };

  // A stream starting while we are NOT mid-continuation means the user took a
  // new turn: reset the depth budget and cancel any pending continuation.
  const onStart = () => {
    if (!state.ourSendPending) {
      state.depth = 0;
      state.runId += 1;
    }
  };

  const onComplete = (message: AgoMessage) => {
    // Clear the pending flag if this was our continuation turn completing.
    state.ourSendPending = false;
    const navigated = state.navigated;
    state.navigated = false;

    if (!opts().enabled) return;
    if (!navigated) return;
    // Depth cap: if our own continuation turn navigated again, depth is
    // already at the cap here, so no further continuation fires.
    if (state.depth >= opts().maxDepth) return;
    void continueAfterNavigation(message.conversationId);
  };

  const onError = () => {
    state.ourSendPending = false;
  };

  client.on("function:invoke", onInvoke);
  client.on("message:start", onStart);
  client.on("message:waiting-client", onWaitingClient);
  client.on("message:complete", onComplete);
  client.on("message:error", onError);

  return () => {
    state.runId += 1; // invalidate any in-flight readiness wait
    unregisterGate();
    client.off("function:invoke", onInvoke);
    client.off("message:start", onStart);
    client.off("message:waiting-client", onWaitingClient);
    client.off("message:complete", onComplete);
    client.off("message:error", onError);
  };
}

/** @internal exported for tests. */
export const __AUTO_CONTINUE_DEFAULT_PROMPT = DEFAULT_CONTINUATION_PROMPT;
