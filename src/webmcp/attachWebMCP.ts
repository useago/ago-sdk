import { logger } from "../utils/logger";
import type {
  ModelContextLike,
  ModelContextToolLike,
  WebMCPBridgeClient,
} from "./types";

/** How long a navigating call waits for the destination to register. */
const READINESS_TIMEOUT_MS = 4000;
/** Quiet period after the last registry change. Same defaults as autoContinue. */
const SETTLE_MS = 150;
/** Nothing registered by now means the destination has nothing to register. */
const FIRST_CHANGE_GRACE_MS = 600;

function getModelContext(): ModelContextLike | undefined {
  if (typeof document === "undefined") return undefined;
  return (document as Document & { modelContext?: ModelContextLike })
    .modelContext;
}

interface MirroredTool {
  signature: string;
  controller: AbortController;
}

interface ToolPlan {
  signature: string;
  tool: ModelContextToolLike;
}

/**
 * Resolves once the function registry has been quiet for `SETTLE_MS`, at
 * `FIRST_CHANGE_GRACE_MS` if nothing changed at all, at `READINESS_TIMEOUT_MS`,
 * or as soon as one of `signals` aborts. Never rejects: a destination page that
 * registers nothing must not fail the call.
 */
function waitForQuietRegistry(
  subscribe: (listener: () => void) => () => void,
  signals: Array<AbortSignal | undefined>,
): Promise<void> {
  return new Promise((resolveWait) => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(settle);
      clearTimeout(grace);
      clearTimeout(deadline);
      for (const signal of signals)
        signal?.removeEventListener("abort", finish);
      unsubscribe();
      resolveWait();
    };

    // Every change restarts the quiet period, so a page that unmounts late
    // (react-router's startTransition holds the old one) is waited out too.
    // The first one retires the grace: the full ceiling applies from here.
    const onChange = () => {
      clearTimeout(grace);
      clearTimeout(settle);
      settle = setTimeout(finish, SETTLE_MS);
    };

    const deadline = setTimeout(finish, READINESS_TIMEOUT_MS);
    const grace = setTimeout(finish, FIRST_CHANGE_GRACE_MS);
    const unsubscribe = subscribe(onChange);

    for (const signal of signals) {
      if (signal?.aborted) return finish();
      signal?.addEventListener("abort", finish);
    }
  });
}

/**
 * Mirror the client's registered functions into the browser's WebMCP registry,
 * so an external agent can call the same functions the in-app agent calls.
 * Tracks the client, and returns a detach that removes every mirrored tool.
 *
 * Reached through `AgoConfig.webmcp`.
 */
export function attachWebMCP(client: WebMCPBridgeClient): () => void {
  const found = getModelContext();
  if (!found) {
    // Absence is the normal case today, so this is not a warning.
    logger.log("WebMCP is not available in this browser; bridge not attached");
    return () => {};
  }
  const modelContext: ModelContextLike = found;

  const mirrored = new Map<string, MirroredTool>();
  /** Registrations `registerTool` rejected, each retried once. */
  const failed = new Set<string>();
  /** Aborted on detach, so no readiness wait outlives the bridge. */
  const lifetime = new AbortController();
  let detached = false;
  let syncScheduled = false;

  /**
   * What the tool looks like to an agent. An unchanged shape is left alone.
   * The handler is not part of it: `execute` dispatches by name.
   */
  function signatureOf(tool: ModelContextToolLike): string {
    return JSON.stringify([
      tool.description,
      tool.inputSchema,
      tool.annotations,
    ]);
  }

  /**
   * Whether this call navigated, so its result must wait for the destination.
   * Read by name rather than captured in `execute`: `navigates` is not part of
   * the signature, so a tool whose flag flips is not re-registered.
   */
  function navigated(functionName: string, result: unknown): boolean {
    const meta = client
      .getFunctionRegistrations()
      .find((fn) => fn.name === functionName)?.webmcp;
    if (!meta || !meta.navigates) return false;

    // `navigateToPage` reports an unknown page or missing route params this
    // way, without having navigated.
    const success = (result as { success?: unknown } | null)?.success;
    return success !== false;
  }

  function plan(): Map<string, ToolPlan> {
    const plans = new Map<string, ToolPlan>();

    for (const fn of client.getFunctionRegistrations()) {
      if (fn.webmcp === false) continue;

      const meta = fn.webmcp || undefined;
      const functionName = fn.name;
      const tool: ModelContextToolLike = {
        name: functionName,
        description: fn.schema.description,
        inputSchema: fn.schema.parameters,
        annotations: meta?.annotations,
        // Back through the client, so a WebMCP call gets the same result-size
        // guard, error wrapping and `function:*` events as an agent call.
        execute: async (input, options) => {
          const result = await client.runExternalFunction(
            functionName,
            input ?? {},
          );
          // A navigating call resolves only once the destination page has
          // registered, so the caller reads its tools and not the old page's.
          if (!detached && navigated(functionName, result)) {
            await waitForQuietRegistry(
              (listener) => client.onFunctionsChanged(listener),
              [options?.signal, lifetime.signal],
            );
          }
          return result;
        },
      };

      plans.set(functionName, { tool, signature: signatureOf(tool) });
    }

    return plans;
  }

  /** Coalesced so an effect re-run's unregister and register cancel out. */
  function scheduleSync(): void {
    if (detached || syncScheduled) return;
    syncScheduled = true;
    queueMicrotask(() => {
      syncScheduled = false;
      sync();
    });
  }

  function sync(): void {
    if (detached) return;
    const plans = plan();

    // Changed tools are re-added below, since WebMCP has no update.
    for (const [toolName, entry] of mirrored) {
      if (plans.get(toolName)?.signature === entry.signature) continue;
      entry.controller.abort();
      mirrored.delete(toolName);
    }

    for (const [toolName, next] of plans) {
      if (mirrored.has(toolName)) continue;

      const controller = new AbortController();
      mirrored.set(toolName, { signature: next.signature, controller });

      Promise.resolve(
        modelContext.registerTool(next.tool, { signal: controller.signal }),
      ).catch((error) => {
        logger.error(`WebMCP rejected the tool "${toolName}":`, error);
        if (mirrored.get(toolName)?.controller !== controller) return;
        mirrored.delete(toolName);

        const attempt = JSON.stringify([toolName, next.signature]);
        if (failed.has(attempt)) return;
        failed.add(attempt);
        scheduleSync();
      });
    }
  }

  const unsubscribe = client.onFunctionsChanged(scheduleSync);
  sync();

  logger.log("WebMCP bridge attached");

  return () => {
    if (detached) return;
    detached = true;
    lifetime.abort();
    unsubscribe();
    for (const entry of mirrored.values()) {
      entry.controller.abort();
    }
    mirrored.clear();
    logger.log("WebMCP bridge detached");
  };
}
