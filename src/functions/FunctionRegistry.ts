import { AgoError, AgoFunctionError } from "../client/errors";
import { logger } from "../utils/logger";
import type {
  ClientFunctionDefinition,
  ClientFunctionHandler,
  ClientFunctionSchema,
  RegisteredFunction,
} from "./types";

/**
 * Registry for client-side functions that AGO can call
 */
export class FunctionRegistry {
  private functions: Map<string, RegisteredFunction> = new Map();

  /**
   * Register a function that AGO can call.
   * Accepts either a single definition object or (name, handler, schema) args.
   */
  register(definition: ClientFunctionDefinition): void;
  register(
    name: string,
    handler: ClientFunctionHandler,
    schema: Omit<ClientFunctionSchema, "name">
  ): void;
  register(
    nameOrDef: string | ClientFunctionDefinition,
    handler?: ClientFunctionHandler,
    schema?: Omit<ClientFunctionSchema, "name">
  ): void {
    if (typeof nameOrDef === "object") {
      const { name, handler: h, description, parameters } = nameOrDef;
      return this.register(name, h, { description, parameters });
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

    this.functions.set(name, {
      schema: { ...schema, name },
      handler,
    });

    logger.log(`Registered function: ${name}`);
  }

  /**
   * Unregister a function
   */
  unregister(name: string): boolean {
    const deleted = this.functions.delete(name);
    if (deleted) {
      logger.log(`Unregistered function: ${name}`);
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
      return result;
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
   * Clear all registered functions
   */
  clear(): void {
    this.functions.clear();
    logger.log("Cleared all registered functions");
  }

  /**
   * Get the number of registered functions
   */
  get size(): number {
    return this.functions.size;
  }
}
