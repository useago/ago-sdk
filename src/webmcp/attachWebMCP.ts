import { logger } from "../utils/logger";
import type {
  ModelContextLike,
  ModelContextToolLike,
  WebMCPBridgeClient,
} from "./types";

/** The WebMCP entry point, or `undefined` where the API is not implemented. */
function getModelContext(): ModelContextLike | undefined {
  if (typeof document === "undefined") return undefined;
  return (document as Document & { modelContext?: ModelContextLike })
    .modelContext;
}

/** One mirrored tool, and the controller that unregisters it. */
interface MirroredTool {
  signature: string;
  controller: AbortController;
}

/** What a mirrored tool should look like, before it is registered. */
interface ToolPlan {
  signature: string;
  tool: ModelContextToolLike;
}

/**
 * Mirror the client's registered functions into the browser's WebMCP registry,
 * so an external agent can call the same functions the in-app agent calls.
 * Tracks the client: functions registered later show up, unregistered ones
 * disappear. Returns a detach that removes every mirrored tool.
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
  let detached = false;

  /**
   * What the tool looks like to an agent. Compared between syncs so an
   * unchanged function is left alone: `useAgoFunction` re-registers whenever
   * the `parameters` object identity changes, and re-adding on every such
   * render would churn the agent's tool list for nothing. The handler is never
   * a reason to re-add, since `execute` dispatches by name.
   */
  function signatureOf(tool: ModelContextToolLike): string {
    return JSON.stringify([
      tool.description,
      tool.inputSchema,
      tool.annotations,
    ]);
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
        execute: (input) => client.runExternalFunction(functionName, input ?? {}),
      };

      plans.set(functionName, { tool, signature: signatureOf(tool) });
    }

    return plans;
  }

  function sync(): void {
    if (detached) return;
    const plans = plan();

    // Drop tools that are gone, and ones whose shape actually changed (they are
    // re-added below, since WebMCP has no update).
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
        modelContext.registerTool(next.tool, { signal: controller.signal })
      ).catch((error) => {
        // Forget it rather than fail the sync, so a later one can retry.
        logger.error(`WebMCP rejected the tool "${toolName}":`, error);
        if (mirrored.get(toolName)?.controller === controller) {
          mirrored.delete(toolName);
        }
      });
    }
  }

  const unsubscribe = client.onFunctionsChanged(sync);
  sync();

  logger.log("WebMCP bridge attached");

  return () => {
    if (detached) return;
    detached = true;
    unsubscribe();
    for (const entry of mirrored.values()) {
      entry.controller.abort();
    }
    mirrored.clear();
    logger.log("WebMCP bridge detached");
  };
}
