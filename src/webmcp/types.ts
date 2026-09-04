import type { RegisteredFunction } from "../functions/types";

/**
 * The slice of the WebMCP browser API this bridge uses. Declared structurally
 * rather than pulled from `webmcp-types`, which augments the global `Document`
 * and would leak `document.modelContext` into every consumer's typings.
 *
 * @see https://github.com/webmachinelearning/webmcp
 */
export interface ModelContextToolLike {
  name: string;
  description: string;
  inputSchema?: object;
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
  };
}

export interface ModelContextLike {
  /**
   * There is no `unregisterTool` in the API: a tool lives until `signal`
   * aborts, hence one `AbortController` per mirrored tool.
   */
  registerTool(
    tool: ModelContextToolLike,
    options?: { signal?: AbortSignal }
  ): Promise<void>;
}

/** What the bridge needs from the client. */
export interface WebMCPBridgeClient {
  getFunctionRegistrations(): Array<RegisteredFunction & { name: string }>;
  onFunctionsChanged(listener: () => void): () => void;
  runExternalFunction(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown>;
}
