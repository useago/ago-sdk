import { logger } from "../utils/logger";
import type { ClientFunctionDefinition } from "./types";

/** A navigable page. `path` may carry `:param` placeholders. */
export interface NavRoute {
  name: string;
  path: string;
  description: string;
  /** Only read under `catalogue: "onDemand"`. */
  section?: string;
}

/**
 * Where the route catalogue lives: `"inline"` (default) in `navigateToPage`'s
 * description, or `"onDemand"` in a `listPages` companion's result.
 */
export type AgoNavigationOptions =
  | { catalogue?: "inline" }
  | { catalogue: "onDemand" };

export const NAVIGATE_FUNCTION = "navigateToPage";
export const LIST_PAGES_FUNCTION = "listPages";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Names of the `:param` placeholders in a route path, in order. */
export function routeParamNames(path: string): string[] {
  return path
    .split("/")
    .filter((seg) => seg.startsWith(":"))
    .map((seg) => seg.slice(1));
}

/**
 * Fill the `:param` placeholders of a route path with agent-supplied values.
 * Returns the resolved path plus the placeholders that had no value, so the
 * caller can send the agent a correctable error instead of a broken URL.
 */
export function fillRouteParams(
  path: string,
  params: Record<string, unknown>
): { path: string; missing: string[] } {
  const missing: string[] = [];
  const filled = path
    .split("/")
    .map((seg) => {
      if (!seg.startsWith(":")) return seg;
      const name = seg.slice(1);
      const value = params[name];
      if (value === undefined || value === null || value === "") {
        missing.push(name);
        return seg;
      }
      return encodeURIComponent(String(value));
    })
    .join("/");
  return { path: filled, missing };
}

/**
 * Resolve which registered route a pathname corresponds to, so the agent can be
 * told the current page by the same name it uses to navigate.
 *
 * Precedence: exact path, then parameterised path (`/users/:id`), then the
 * longest static path that prefixes the pathname (nested routes). Returns
 * `undefined` when nothing matches.
 */
export function matchRoute(
  pathname: string,
  routes: NavRoute[]
): NavRoute | undefined {
  const exact = routes.find((r) => r.path === pathname);
  if (exact) return exact;

  const parameterised = routes.find((r) => {
    if (!r.path.includes(":")) return false;
    const pattern =
      "^" +
      r.path
        .split("/")
        .map((seg) => (seg.startsWith(":") ? "[^/]+" : escapeRegExp(seg)))
        .join("/") +
      "/?$";
    return new RegExp(pattern).test(pathname);
  });
  if (parameterised) return parameterised;

  return routes
    .filter((r) => r.path !== "/" && pathname.startsWith(r.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/** Declared sections, in first-seen order. Empty when no route declares one. */
export function routeSections(routes: NavRoute[]): string[] {
  return [
    ...new Set(routes.map((r) => r.section).filter((s): s is string => !!s)),
  ];
}

/** One `"inline"` catalogue line. */
function catalogueLine(route: NavRoute): string {
  const params = routeParamNames(route.path);
  const note =
    params.length > 0
      ? ` (requires ${params.map((p) => `"${p}"`).join(", ")})`
      : "";
  return `- "${route.name}"${note}: ${route.description}`;
}

/**
 * The `navigateToPage` function. Under `"onDemand"` the catalogue moves to
 * {@link createListPagesFunction} and only the `page` enum stays in the schema.
 */
export function createNavigationFunction(
  navigate: (path: string) => void,
  routes: NavRoute[],
  opts?: AgoNavigationOptions
): ClientFunctionDefinition {
  const onDemand = opts?.catalogue === "onDemand";
  const sections = routeSections(routes);

  if (!onDemand && sections.length > 0) {
    logger.log(
      'registerNavigationFunction: routes declare "section" but catalogue is "inline", so it is unused. Set catalogue: "onDemand" to use it.'
    );
  }

  // The section names are not repeated here: they are already the `section`
  // enum of `listPages`, which the agent reads in the same prompt.
  const description = onDemand
    ? `Navigate the user to a page. Call ${LIST_PAGES_FUNCTION} for what a page name means.`
    : `Navigate the user to a page in the application. Available pages:\n${routes
        .map(catalogueLine)
        .join("\n")}`;

  // One top-level argument per distinct placeholder, listing the pages that
  // need it. Flat scalar properties are what schemas support end to end.
  const paramUsage = new Map<string, string[]>();
  for (const r of routes) {
    for (const param of routeParamNames(r.path)) {
      paramUsage.set(param, [...(paramUsage.get(param) ?? []), r.name]);
    }
  }

  const routeNames = routes.map((r) => r.name);
  const properties: ClientFunctionDefinition["parameters"]["properties"] = {
    page: {
      type: "string",
      description: "The page to navigate to",
      enum: routeNames,
    },
  };
  for (const [param, usedBy] of paramUsage) {
    if (param === "page") {
      logger.error(
        'registerNavigationFunction: a ":page" placeholder collides with the "page" argument and is ignored. Rename the placeholder.'
      );
      continue;
    }
    properties[param] = {
      type: "string",
      description: `Value for ":${param}" in the page path. Required when page is ${usedBy
        .map((n) => `"${n}"`)
        .join(" or ")}.`,
    };
  }

  return {
    name: NAVIGATE_FUNCTION,
    description,
    parameters: { type: "object", properties, required: ["page"] },
    webmcp: { navigates: true },
    handler: async (args) => {
      const pageName = args.page as string;
      const route = routes.find((r) => r.name === pageName);
      if (!route) {
        // Under "onDemand" the names are not in the description, so hand them
        // back: a wrong guess self-heals instead of costing a listPages call.
        return onDemand
          ? {
              success: false,
              error: `Unknown page: ${pageName}`,
              pages: routeNames,
            }
          : { success: false, error: `Unknown page: ${pageName}` };
      }

      // Params arrive as top-level arguments. Some models still nest them
      // under a "params" object (or a JSON string of one); accept those too.
      let nested: Record<string, unknown> = {};
      if (typeof args.params === "string") {
        try {
          nested = JSON.parse(args.params) as Record<string, unknown>;
        } catch {
          // fall through to the missing-params error below
        }
      } else if (args.params && typeof args.params === "object") {
        nested = args.params as Record<string, unknown>;
      }

      const values: Record<string, unknown> = {};
      for (const name of routeParamNames(route.path)) {
        values[name] = args[name] ?? nested[name];
      }

      const { path, missing } = fillRouteParams(route.path, values);
      if (missing.length > 0) {
        const example = missing.map((m) => `"${m}": "..."`).join(", ");
        return {
          success: false,
          error: `Page "${pageName}" needs ${missing
            .map((m) => `"${m}"`)
            .join(", ")}. Retry with { "page": "${pageName}", ${example} }.`,
        };
      }

      navigate(path);
      return { success: true, navigatedTo: path };
    },
  };
}

/**
 * Carries the catalogue as a call result rather than in every message.
 * Registered only under `catalogue: "onDemand"`.
 */
export function createListPagesFunction(
  routes: NavRoute[]
): ClientFunctionDefinition {
  const sections = routeSections(routes);
  // No `:param` requirement: that parameter's own description already states it.
  const entry = (route: NavRoute) => ({
    name: route.name,
    description: route.description,
  });

  return {
    name: LIST_PAGES_FUNCTION,
    description: `List what each page name of ${NAVIGATE_FUNCTION} means.`,
    parameters: {
      type: "object",
      properties:
        sections.length > 0
          ? {
              section: {
                type: "string",
                description: "Which group of pages to list.",
                enum: sections,
              },
            }
          : {},
      // Declaring sections says the catalogue is too big to answer in one go,
      // so the filter is the whole point of having them. Explicitly empty
      // otherwise, not omitted: an absent `required` can be read as "all".
      required: sections.length > 0 ? ["section"] : [],
    },
    webmcp: { annotations: { readOnlyHint: true } },
    handler: (args) => {
      if (sections.length === 0) return { pages: routes.map(entry) };

      // Required in the schema, but models drop arguments: answer with the
      // valid sections either way so the agent can correct itself.
      const asked = typeof args.section === "string" ? args.section : undefined;
      const match = sections.find(
        (s) => s.toLowerCase() === asked?.toLowerCase()
      );
      if (!match) {
        return {
          pages: [],
          sections,
          error: asked
            ? `Unknown section: ${asked}`
            : `"section" is required. Pick one and call again.`,
        };
      }
      return { pages: routes.filter((r) => r.section === match).map(entry) };
    },
  };
}
