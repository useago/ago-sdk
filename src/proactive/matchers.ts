import { deepEqual } from "../utils/deepEqual";
import type { SignalsSnapshot } from "../signals/types";
import type { ProactiveTriggerWhen } from "./types";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a pathname against a trigger route pattern. Mirrors the styles the
 * navigation function already understands (`:param` segments), plus globs:
 *
 * - exact: `/billing`
 * - `:param`: `/users/:id` matches `/users/42`
 * - `*` mid-path: matches exactly one segment (`/a/*` / `/b`)
 * - trailing `/*`: matches one or MORE remaining segments (`/dossier/*`
 *   matches `/dossier/1` and `/dossier/1/docs`, not `/dossier`)
 * - `*` alone matches everything
 *
 * Trailing slashes on the pathname are tolerated.
 */
export function matchesRoutePattern(pattern: string, pathname: string): boolean {
  if (pattern === "*") return true;
  if (pattern === pathname) return true;

  const segments = pattern.split("/");
  const parts = segments.map((seg, i) => {
    const isLast = i === segments.length - 1;
    if (seg === "*") return isLast ? "[^/]+(?:/[^/]+)*" : "[^/]+";
    if (seg.startsWith(":")) return "[^/]+";
    return escapeRegExp(seg);
  });
  const regex = new RegExp("^" + parts.join("/") + "/?$");
  return regex.test(pathname);
}

/**
 * Partial deep match: every key/value present in `expected` must match the
 * corresponding value in `actual`. Nested objects recurse (partially); arrays
 * and primitives compare by deep equality.
 */
export function partialDeepMatch(expected: unknown, actual: unknown): boolean {
  if (expected === actual) return true;
  if (expected === null || actual === null) return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, i) => deepEqual(item, actual[i]));
  }
  if (typeof expected === "object") {
    if (typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>).every(
      ([key, value]) =>
        partialDeepMatch(value, (actual as Record<string, unknown>)[key])
    );
  }
  return false;
}


/**
 * Evaluate a trigger's `when` clause against a signals snapshot. Pure
 * conjunction: every specified matcher must pass. Numeric fields are `>=`
 * thresholds; `pageState` is a partial deep match; `fieldErrors` are per-name
 * minimum counts.
 */
export function matchesWhen(
  when: ProactiveTriggerWhen,
  snapshot: SignalsSnapshot
): boolean {
  if (when.route !== undefined && !matchesRoutePattern(when.route, snapshot.route)) {
    return false;
  }
  if (when.idleMs !== undefined && snapshot.idleMs < when.idleMs) return false;
  if (when.dwellMs !== undefined && snapshot.dwellMs < when.dwellMs) return false;
  if (when.rageClicks !== undefined && snapshot.rageClicks < when.rageClicks) {
    return false;
  }
  if (
    when.routeBounces !== undefined &&
    snapshot.routeBounces < when.routeBounces
  ) {
    return false;
  }
  if (when.fieldErrors !== undefined) {
    for (const [field, min] of Object.entries(when.fieldErrors)) {
      if ((snapshot.fieldErrors[field] ?? 0) < min) return false;
    }
  }
  if (when.pageState !== undefined) {
    if (!partialDeepMatch(when.pageState, snapshot.pageState ?? {})) {
      return false;
    }
  }
  return true;
}
