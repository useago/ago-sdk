import { matchRoutePath, NAVIGATE_FUNCTION, type NavRoute } from "../functions/navigation";
import type { RegisteredFunction } from "../functions/types";

/**
 * What a click on an element stands for. The agent console computes the same
 * object on its replay and sends it as `expect`; the click runs only when the
 * real page still agrees.
 */
export type ClickPreview =
  | CallPreview
  | { function: string; href: string }
  | { error: ClickPreviewError };

export type ClickPreviewError = "disabled" | "invalid_args" | "external_link" | "not_declared";

type CallPreview = { function: string; arguments: Record<string, unknown> };

/** A preview plus the rule that produced it (state values need coercion, links a route). */
export type ClickTarget =
  | { kind: "action"; preview: CallPreview }
  | { kind: "state"; preview: CallPreview }
  | { kind: "link"; preview: { function: string; href: string } }
  | { kind: "blocked"; preview: { error: ClickPreviewError } };

export type ClickInvocation =
  | { function: string; arguments: Record<string, unknown> }
  | { error: string };

const INTERACTIVE_TAGS = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "tab", "checkbox", "switch", "menuitem"]);
const NOT_A_DECLARED_PAGE = "This link does not lead to a page declared to AGO.";

function parseArgs(raw: string | null): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function linkTarget(el: Element, href: string, pageUrl: string): ClickTarget {
  let url: URL;
  try {
    url = new URL(href, el.ownerDocument?.baseURI || pageUrl);
  } catch {
    return { kind: "blocked", preview: { error: "external_link" } };
  }
  if (url.origin !== new URL(pageUrl).origin) {
    return { kind: "blocked", preview: { error: "external_link" } };
  }
  return {
    kind: "link",
    preview: { function: NAVIGATE_FUNCTION, href: url.pathname + url.search + url.hash },
  };
}

/**
 * Walk up from the clicked node and return the first rule that applies
 * (contract: ignore, disabled, action, state, link, undeclared control).
 * `null` when nothing on the way is actionable.
 */
export function findClickTarget(node: Node, pageUrl: string): ClickTarget | null {
  let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement;
  for (; el; el = el.parentElement) {
    if (el.hasAttribute("data-ago-ignore")) return null;
    if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
      return { kind: "blocked", preview: { error: "disabled" } };
    }
    const action = el.getAttribute("data-ago-action");
    if (action !== null) {
      const args = parseArgs(el.getAttribute("data-ago-args"));
      return args
        ? { kind: "action", preview: { function: action, arguments: args } }
        : { kind: "blocked", preview: { error: "invalid_args" } };
    }
    const state = el.getAttribute("data-ago-state");
    if (state !== null) {
      return {
        kind: "state",
        preview: {
          function: el.getAttribute("data-ago-state-function") || "setPageState",
          arguments: { [state]: el.getAttribute("data-ago-value") ?? "" },
        },
      };
    }
    const href = el.tagName === "A" ? el.getAttribute("href") : null;
    if (href !== null) return linkTarget(el, href, pageUrl);
    const role = el.getAttribute("role");
    if (INTERACTIVE_TAGS.has(el.tagName) || (role !== null && INTERACTIVE_ROLES.has(role))) {
      return { kind: "blocked", preview: { error: "not_declared" } };
    }
  }
  return null;
}

function schemaType(fn: RegisteredFunction, property: string): string | null | undefined {
  const properties = fn.schema.parameters?.properties ?? {};
  if (!Object.prototype.hasOwnProperty.call(properties, property)) return undefined;
  const type: unknown = properties[property]?.type;
  if (Array.isArray(type)) return type.find((t) => t !== "null") ?? null;
  return typeof type === "string" ? type : null;
}

function coerce(raw: unknown, type: string | null): { value: unknown } | { error: string } {
  const text = String(raw);
  if (type === "number" || type === "integer") {
    const value = text.trim() === "" ? NaN : Number(text);
    if (!Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) {
      return { error: `"${text}" is not a valid ${type}.` };
    }
    return { value };
  }
  if (type === "boolean") {
    if (text === "true") return { value: true };
    if (text === "false") return { value: false };
    return { error: `"${text}" is not a valid boolean (use "true" or "false").` };
  }
  return { value: text };
}

/** The path a hash router reads: `#/orders/42?tab=1` -> `/orders/42`. */
function hashPath(hash: string): string | null {
  if (!hash.startsWith("#/")) return null;
  return hash.slice(1).split(/[?#]/)[0];
}

/**
 * Turn a preview into the call it stands for: state values typed by the
 * function's schema, links mapped to a declared route (`navigateToPage`).
 * Whether the function may run at all is checked by the caller, like for any
 * function command.
 */
export function clickInvocation(
  target: ClickTarget,
  context: {
    getFunction: (name: string) => RegisteredFunction | undefined;
    routes: NavRoute[] | null;
  },
): ClickInvocation {
  if (target.kind === "blocked") {
    return { error: `This element cannot be clicked remotely (${target.preview.error}).` };
  }
  if (target.kind === "state") {
    const name = target.preview.function;
    const fn = context.getFunction(name);
    if (!fn) return { error: `Function "${name}" is not available on this page.` };
    const args: Record<string, unknown> = {};
    for (const [property, raw] of Object.entries(target.preview.arguments)) {
      const type = schemaType(fn, property);
      if (type === undefined) return { error: `"${property}" is not a parameter of "${name}".` };
      const coerced = coerce(raw, type);
      if ("error" in coerced) return { error: `${property}: ${coerced.error}` };
      args[property] = coerced.value;
    }
    return { function: name, arguments: args };
  }
  if (target.kind === "action") return { ...target.preview };
  const routes = context.routes;
  if (!routes || routes.length === 0) return { error: NOT_A_DECLARED_PAGE };
  const url = new URL(target.preview.href, "http://ago.invalid");
  // Hash route first: a hash-routed app's pathname is "/", which would match its home page.
  const hash = hashPath(url.hash);
  const match =
    (hash ? matchRoutePath(hash, routes) : undefined) ?? matchRoutePath(url.pathname, routes);
  if (!match) return { error: NOT_A_DECLARED_PAGE };
  const { page: _collides, ...params } = match.params;
  return { function: NAVIGATE_FUNCTION, arguments: { page: match.route.name, ...params } };
}
