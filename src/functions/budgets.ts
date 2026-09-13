import type { ClientFunctionSchema } from "./types";

/**
 * Chrome's per-tool budgets for WebMCP, in characters (bytes for a result).
 * Guidance, not enforced: the limits belong to whichever agent consumes the
 * tools (schema caps, context share, injection filtering), so they vary by
 * caller.
 *
 * @see https://developer.chrome.com/docs/ai/webmcp/secure-tools
 */
export const TOOL_BUDGETS = {
  name: 30,
  description: 500,
  parameterName: 30,
  parameterDescription: 150,
  resultBytes: 1_500,
} as const;

/** Fields over their budget, each as `"description (3584/500)"`. */
export function overBudget(schema: ClientFunctionSchema): string[] {
  const over: string[] = [];
  // register() is a runtime boundary: plain-JS consumers reach it untyped, so
  // a diagnostic must never be the thing that throws.
  const check = (field: string, text: string | undefined, budget: number) => {
    const size = text?.length ?? 0;
    if (size > budget) over.push(`${field} (${size}/${budget})`);
  };

  check("name", schema.name, TOOL_BUDGETS.name);
  check("description", schema.description, TOOL_BUDGETS.description);

  for (const [param, property] of Object.entries(
    schema.parameters?.properties ?? {},
  )) {
    check(`"${param}" name`, param, TOOL_BUDGETS.parameterName);
    check(
      `"${param}" description`,
      property.description ?? "",
      TOOL_BUDGETS.parameterDescription,
    );
  }

  return over;
}
