import { logger } from "../utils/logger";
import type {
  ModelContextLike,
  ModelContextToolLike,
  WebMCPBridgeClient,
} from "./types";

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
        modelContext.registerTool(next.tool, { signal: controller.signal })
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
    unsubscribe();
    for (const entry of mirrored.values()) {
      entry.controller.abort();
    }
    mirrored.clear();
    logger.log("WebMCP bridge detached");
  };
}
