import { deepEqual } from "../utils/deepEqual";
import {
  byteLength,
  jsonStringBytes,
  sliceJsonStringToBytes,
} from "../utils/jsonBytes";
import type {
  AgoPageStateEnvelope,
  AgoStateControl,
  ClientFunctionDefinition,
} from "./types";

const MAX_ALTERNATIVES = 100;

interface PageStateFunctionOptions {
  name: string;
  requiresApproval?: boolean;
  getResultBudget: () => number;
  data?: {
    description: string;
    maxResultBytes?: number;
    read: (envelope: AgoPageStateEnvelope) => Promise<unknown>;
  };
}

const TRUNCATED_REASON_SUFFIX = " … [truncated]";
const MIN_DATA_FALLBACK = { truncated: true as const };
const MIN_DATA_RESERVE = byteLength(',"data":' + JSON.stringify(MIN_DATA_FALLBACK));

function serializedBytes(value: unknown): number {
  return byteLength(JSON.stringify(value));
}

/**
 * Preserve the verdict structure, then spend the remaining budget on leading
 * rejection reasons. This mirrors page-data truncation: keep useful content in
 * order instead of repeatedly resizing every item to a shared character cap.
 */
function fitEnvelopeToBudget(
  envelope: AgoPageStateEnvelope,
  budget: number
): AgoPageStateEnvelope {
  if (serializedBytes(envelope) <= budget || !envelope.rejected) {
    return envelope;
  }

  const entries = Object.entries(envelope.rejected);
  const rejected = Object.fromEntries(
    entries.map(([name]) => [name, TRUNCATED_REASON_SUFFIX])
  );
  const fitted = { ...envelope, rejected };
  let used = serializedBytes(fitted);

  // If the keys and verdict arrays alone exceed the ceiling, no truncation of
  // reason text can make them fit. Return the smallest semantic envelope and
  // let the registry's generic guard remain the final safety net.
  if (used > budget) return fitted;

  const markerBytes = jsonStringBytes(TRUNCATED_REASON_SUFFIX);
  for (const [name, reason] of entries) {
    const reasonBytes = jsonStringBytes(reason);
    const available = budget - used + markerBytes;

    if (reasonBytes <= available) {
      rejected[name] = reason;
      used += reasonBytes - markerBytes;
      continue;
    }

    rejected[name] =
      sliceJsonStringToBytes(reason, available - markerBytes) +
      TRUNCATED_REASON_SUFFIX;
    break;
  }

  return fitted;
}

function receivedType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateNumber(value: unknown): string | null {
  if (typeof value !== "number") {
    return `Expected type "number", got "${receivedType(value)}".`;
  }
  if (!Number.isFinite(value)) return "Expected a finite number.";
  return null;
}

function formatAlternatives(values: readonly (string | number)[]): string {
  const shown = values.slice(0, MAX_ALTERNATIVES).map((v) => JSON.stringify(v));
  const omitted = values.length - MAX_ALTERNATIVES;
  if (omitted > 0) return `${shown.join(", ")} (${omitted} more not shown)`;
  return shown.join(", ");
}

function validateEnum(
  value: unknown,
  allowed: readonly (string | number)[]
): string | null {
  if (allowed.includes(value as string | number)) return null;
  return `${JSON.stringify(value)} is not an allowed value. Allowed values: ${formatAlternatives(allowed)}.`;
}

function validateValue(
  value: unknown,
  control: AgoStateControl
): string | null {
  const { schema } = control;

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      return `Expected type "array", got "${receivedType(value)}".`;
    }
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (schema.items?.type) {
        const typeError =
          schema.items.type === "number"
            ? validateNumber(item)
            : receivedType(item) !== schema.items.type
              ? `Expected type "${schema.items.type}", got "${receivedType(item)}".`
              : null;
        if (typeError) {
          return `Array item at index ${i}: ${typeError[0].toLowerCase()}${typeError.slice(1)}`;
        }
      }
      if (schema.items?.enum) {
        const enumError = validateEnum(item, schema.items.enum);
        if (enumError) return `Array item ${enumError}`;
      }
    }
    return null;
  }

  if (schema.type === "number") {
    const error = validateNumber(value);
    if (error) return error;
  } else if (receivedType(value) !== schema.type) {
    return `Expected type "${schema.type}", got "${receivedType(value)}".`;
  }

  const allowed = effectiveEnum(control);
  if (allowed) return validateEnum(value, allowed);

  return null;
}

/** Whether `""` is a real instruction to clear this control, or filler. */
function clearsOnEmptyString(control: AgoStateControl): boolean {
  return control.clearable === true && control.schema.type === "string";
}

function effectiveEnum(
  control: AgoStateControl
): (string | number)[] | undefined {
  const declared = control.schema.enum;
  if (!declared) return undefined;
  if (clearsOnEmptyString(control) && !declared.includes("")) {
    return [...declared, ""];
  }
  return declared;
}

function advertisedSchema(control: AgoStateControl) {
  const schema = { ...control.schema, description: control.description };
  if (clearsOnEmptyString(control)) {
    schema.description = `${control.description} Pass "" to clear it.`;
  }
  const effectiveValues = effectiveEnum(control);
  if (effectiveValues) schema.enum = effectiveValues;
  return schema;
}

/**
 * Build the client-function definition for a page's editable controls.
 *
 * This module owns the page-state contract: advertised schemas, verdict
 * precedence, validation, and setter outcomes. AgoClient owns installation,
 * page-data infrastructure, dynamic context, and cleanup.
 */
export function createPageStateFunction(
  controls: AgoStateControl[],
  options: PageStateFunctionOptions
): ClientFunctionDefinition {
  const byName = new Map(controls.map((control) => [control.name, control]));
  const controlNames = controls.map((control) => control.name);
  const controlDescriptions = controls
    .map((control) => `- "${control.name}": ${control.description}`)
    .join("\n");

  return {
    name: options.name,
    handler: async (args) => {
      const applied: string[] = [];
      const unchanged: string[] = [];
      const rejected: Record<string, string> = {};

      for (const [key, value] of Object.entries(args)) {
        const control = byName.get(key);
        if (!control) {
          rejected[key] = `"${key}" is not a registered control. Available controls: ${formatAlternatives(controlNames)}.`;
          continue;
        }
        if (value === undefined || value === null) continue;
        if (value === "" && !clearsOnEmptyString(control)) continue;

        const error = validateValue(value, control);
        if (error) {
          rejected[key] = error;
          continue;
        }

        if (control.get && deepEqual(value, control.get())) {
          unchanged.push(key);
          continue;
        }

        const setResult = await control.set(value);
        if (!setResult) {
          applied.push(key);
        } else if (setResult.result === "rejected") {
          rejected[key] =
            setResult.reason || "The page rejected this field's update.";
        } else if (setResult.result === "unchanged") {
          unchanged.push(key);
        } else {
          applied.push(key);
        }
      }

      const hasRejections = Object.keys(rejected).length > 0;
      const rawEnvelope: AgoPageStateEnvelope = {
        success: !hasRejections,
        applied,
        unchanged,
        ...(hasRejections ? { rejected } : {}),
      };
      const totalBudget = options.getResultBudget();

      if (!options.data) {
        return fitEnvelopeToBudget(rawEnvelope, totalBudget);
      }

      const envelope = fitEnvelopeToBudget(
        rawEnvelope,
        totalBudget - MIN_DATA_RESERVE
      );
      const data = await options.data.read(envelope);
      const result = { ...envelope, data };

      if (serializedBytes(result) <= totalBudget) return result;
      return { ...envelope, data: MIN_DATA_FALLBACK };
    },
    description:
      (controls.length > 0
        ? `Change the state of the current page. Set ONLY the controls the user explicitly asked for; leave the others unset. Available controls:\n${controlDescriptions}`
        : "The current page has no editable state — nothing to change here.") +
      (options.data
        ? `\nReturns the resulting page data once it has loaded: ${options.data.description}`
        : ""),
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        controls.map((control) => [control.name, advertisedSchema(control)])
      ),
      // Explicitly empty, not omitted: an absent `required` can be read as
      // "every property is required", forcing the agent to set all controls.
      required: [],
    },
    requiresApproval: options.requiresApproval,
    // Only pin a ceiling when the page asked for one; otherwise the registry's
    // live default applies, so updateConfig still moves it.
    maxResultBytes: options.data?.maxResultBytes,
  };
}
