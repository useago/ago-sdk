import { AgoError, AgoFunctionError } from "../client/errors";
import { logger } from "../utils/logger";
import type {
  ClientFunctionDefinition,
  ClientFunctionHandler,
  ClientFunctionRegisterOptions,
  ClientFunctionSchema,
  RegisteredFunction,
} from "./types";

/** Default ceiling for a serialized function result (~12k LLM tokens). */
const DEFAULT_MAX_RESULT_BYTES = 50_000;
/** Results above this size log a warning even when under the ceiling. */
const WARN_RESULT_BYTES = 20_000;
/** How much of the original JSON a truncated result keeps as a preview. */
const TRUNCATED_PREVIEW_CHARS = 2_000;

export interface FunctionRegistryOptions {
  /** Client-level default for the result-size ceiling, in bytes. */
  maxResultBytes?: number;
}

/**
 * Registry for client-side functions that AGO can call
 */
export class FunctionRegistry {
  private functions: Map<string, RegisteredFunction> = new Map();
  private defaultMaxResultBytes: number;
  private changeListeners = new Set<() => void>();

  constructor(options?: FunctionRegistryOptions) {
    this.defaultMaxResultBytes =
      options?.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
  }

  /**
   * Subscribe to registrations, unregistrations and clears. Returns an
   * unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (error) {
        // A misbehaving observer must never break a registration.
        logger.error("Function registry change listener failed:", error);
      }
    }
  }

  /** Update the client-level result-size ceiling at runtime. */
  setDefaultMaxResultBytes(bytes: number): void {
    this.defaultMaxResultBytes = bytes;
  }

  /**
   * The client-level result-size ceiling in force right now. Callers that size
   * a payload before returning it must budget against this exact number, or
   * their careful truncation gets replaced by {@link guardResultSize}'s preview.
   */
  getDefaultMaxResultBytes(): number {
    return this.defaultMaxResultBytes;
  }

  /**
   * Register a function that AGO can call.
   * Accepts either a single definition object or (name, handler, schema) args.
   */
  register(definition: ClientFunctionDefinition): void;
  register(
    name: string,
    handler: ClientFunctionHandler,
    schema: ClientFunctionRegisterOptions
  ): void;
  register(
    nameOrDef: string | ClientFunctionDefinition,
    handler?: ClientFunctionHandler,
    schema?: ClientFunctionRegisterOptions
  ): void {
    if (typeof nameOrDef === "object") {
      const {
        name,
        handler: h,
        description,
        parameters,
        maxResultBytes,
        requiresApproval,
        webmcp,
      } = nameOrDef;
      return this.register(name, h, {
        description,
        parameters,
        maxResultBytes,
        requiresApproval,
        webmcp,
      });
    }

    const name = nameOrDef;
    if (!handler || !schema) {
      throw new AgoError(
        `registerFunction("${name}"): both a handler and a schema are required. ` +
          "Pass them as arguments or use the single-object form: " +
          "registerFunction({ name, parameters, handler }).",
        "function_invalid_registration"
      );
    }
    if (this.functions.has(name)) {
      logger.warn(`Function "${name}" is being overwritten`);
    }

    // maxResultBytes, requiresApproval and webmcp are SDK-side settings: keep
    // them out of the schema sent to the backend.
    const { maxResultBytes, requiresApproval, webmcp, ...schemaRest } = schema;
    this.functions.set(name, {
      schema: { ...schemaRest, name },
      handler,
      maxResultBytes,
      requiresApproval,
      webmcp,
    });

    logger.log(`Registered function: ${name}`);
    this.emitChange();
  }

  /**
   * Unregister a function
   */
  unregister(name: string): boolean {
    const deleted = this.functions.delete(name);
    if (deleted) {
      logger.log(`Unregistered function: ${name}`);
      this.emitChange();
    }
    return deleted;
  }

  /**
   * Get a registered function
   */
  get(name: string): RegisteredFunction | undefined {
    return this.functions.get(name);
  }

  /**
   * Check if a function is registered
   */
  has(name: string): boolean {
    return this.functions.has(name);
  }

  /**
   * Get all registered function schemas (for sending to backend)
   */
  getSchemas(): ClientFunctionSchema[] {
    return Array.from(this.functions.values()).map((f) => f.schema);
  }

  /**
   * Every registration, name included, with the SDK-side settings
   * {@link getSchemas} drops.
   */
  getAll(): Array<RegisteredFunction & { name: string }> {
    return Array.from(this.functions.entries()).map(([name, fn]) => ({
      ...fn,
      name,
    }));
  }

  /**
   * Execute a registered function
   */
  async execute(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const registration = this.functions.get(name);

    if (!registration) {
      throw new AgoFunctionError(
        `Function "${name}" is not registered`,
        name
      );
    }

    logger.log(`Executing function: ${name}`, args);

    try {
      const result = await registration.handler(args);
      logger.log(`Function ${name} completed:`, result);
      return this.guardResultSize(name, result, registration.maxResultBytes);
    } catch (error) {
      logger.error(`Function ${name} failed:`, error);
      throw new AgoFunctionError(
        `Function "${name}" execution failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        name,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Cap the size of a function result before it goes back to the backend.
   * Everything a handler returns lands in the LLM context, so an unbounded
   * payload (a raw API response, a full table) inflates cost and can overflow
   * the model. Oversized results are replaced with a flagged preview so the
   * agent knows to request less instead of receiving hundreds of KB verbatim.
   */
  private guardResultSize(
    name: string,
    result: unknown,
    maxBytes?: number
  ): unknown {
    let json: string | undefined;
    try {
      json = JSON.stringify(result);
    } catch {
      // Non-serializable results (circular refs…) already fail at submit
      // time; keep that failure mode instead of masking it here.
      return result;
    }
    if (json === undefined) {
      return result;
    }

    const bytes = new TextEncoder().encode(json).length;
    const limit = maxBytes ?? this.defaultMaxResultBytes;

    if (bytes > limit) {
      logger.warn(
        `Function "${name}" result is ${bytes} bytes, over the ${limit}-byte ` +
          "limit; a truncated preview was sent to the agent instead. Return " +
          "fewer fields, paginate, or raise maxResultBytes for this function."
      );
      return {
        truncated: true,
        originalBytes: bytes,
        maxBytes: limit,
        preview: json.slice(0, TRUNCATED_PREVIEW_CHARS),
        hint:
          `The result of "${name}" exceeded the ${limit}-byte limit and was ` +
          "truncated. Request less data (use limit or filter parameters if " +
          "available), or tell the user the result is too large to process.",
      };
    }

    if (bytes > WARN_RESULT_BYTES) {
      logger.warn(
        `Function "${name}" returned a large result (${Math.round(
          bytes / 1024
        )} KB). Large results consume LLM context: return fewer fields, ` +
          "paginate, or push the data to the UI and return a summary."
      );
    }

    return result;
  }

  /**
   * Clear all registered functions
   */
  clear(): void {
    const had = this.functions.size > 0;
    this.functions.clear();
    logger.log("Cleared all registered functions");
    if (had) {
      this.emitChange();
    }
  }

  /**
   * Get the number of registered functions
   */
  get size(): number {
    return this.functions.size;
  }
}
