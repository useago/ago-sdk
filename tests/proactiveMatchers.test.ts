import { describe, it, expect } from "vitest";
import {
  matchesRoutePattern,
  matchesWhen,
  partialDeepMatch,
} from "../src/proactive/matchers";
import type { SignalsSnapshot } from "../src/signals/types";

function snapshot(partial: Partial<SignalsSnapshot> = {}): SignalsSnapshot {
  return {
    route: "/",
    dwellMs: 0,
    idleMs: 0,
    rageClicks: 0,
    routeBounces: 0,
    fieldErrors: {},
    recentRoutes: ["/"],
    pageState: null,
    ...partial,
  };
}

describe("matchesRoutePattern", () => {
  it("matches exact routes (trailing slash tolerated)", () => {
    expect(matchesRoutePattern("/billing", "/billing")).toBe(true);
    expect(matchesRoutePattern("/billing", "/billing/")).toBe(true);
    expect(matchesRoutePattern("/billing", "/bills")).toBe(false);
  });

  it("matches :param segments", () => {
    expect(matchesRoutePattern("/users/:id", "/users/42")).toBe(true);
    expect(matchesRoutePattern("/users/:id", "/users")).toBe(false);
    expect(matchesRoutePattern("/users/:id/edit", "/users/42/edit")).toBe(true);
    expect(matchesRoutePattern("/users/:id", "/users/42/edit")).toBe(false);
  });

  it("matches a trailing /* against one or more remaining segments", () => {
    expect(matchesRoutePattern("/dossier/*", "/dossier/1")).toBe(true);
    expect(matchesRoutePattern("/dossier/*", "/dossier/1/docs")).toBe(true);
    expect(matchesRoutePattern("/dossier/*", "/dossier")).toBe(false);
    expect(matchesRoutePattern("/dossier/*", "/other/1")).toBe(false);
  });

  it("matches a mid-path * against exactly one segment", () => {
    expect(matchesRoutePattern("/a/*/b", "/a/x/b")).toBe(true);
    expect(matchesRoutePattern("/a/*/b", "/a/x/y/b")).toBe(false);
  });

  it("* alone matches everything", () => {
    expect(matchesRoutePattern("*", "/anything/at/all")).toBe(true);
  });
});

describe("partialDeepMatch", () => {
  it("matches when every expected key matches (extra actual keys allowed)", () => {
    expect(partialDeepMatch({ a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(partialDeepMatch({ a: 1 }, { a: 2 })).toBe(false);
    expect(partialDeepMatch({}, { anything: true })).toBe(true);
  });

  it("recurses into nested objects partially", () => {
    expect(partialDeepMatch({ a: { b: 1 } }, { a: { b: 1, c: 2 }, d: 3 })).toBe(true);
    expect(partialDeepMatch({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it("compares arrays by deep equality", () => {
    expect(partialDeepMatch({ tags: ["a", "b"] }, { tags: ["a", "b"] })).toBe(true);
    expect(partialDeepMatch({ tags: ["a"] }, { tags: ["a", "b"] })).toBe(false);
  });
});

describe("matchesWhen", () => {
  it("is a pure conjunction of every specified matcher", () => {
    const snap = snapshot({
      route: "/dossier/12",
      idleMs: 25_000,
      dwellMs: 40_000,
      rageClicks: 2,
      routeBounces: 1,
      fieldErrors: { iban: 3 },
      pageState: { step: "documents", uploaded: 0 },
    });

    expect(
      matchesWhen(
        {
          route: "/dossier/*",
          idleMs: 20_000,
          dwellMs: 30_000,
          rageClicks: 2,
          routeBounces: 1,
          fieldErrors: { iban: 2 },
          pageState: { step: "documents" },
        },
        snap
      )
    ).toBe(true);

    // One failing matcher fails the whole clause.
    expect(matchesWhen({ route: "/dossier/*", idleMs: 30_000 }, snap)).toBe(false);
    expect(matchesWhen({ route: "/billing" }, snap)).toBe(false);
    expect(matchesWhen({ fieldErrors: { iban: 4 } }, snap)).toBe(false);
    expect(matchesWhen({ pageState: { step: "review" } }, snap)).toBe(false);
    expect(matchesWhen({ fieldErrors: { email: 1 } }, snap)).toBe(false);
  });

  it("numeric fields are >= thresholds", () => {
    const snap = snapshot({ idleMs: 20_000 });
    expect(matchesWhen({ idleMs: 20_000 }, snap)).toBe(true);
    expect(matchesWhen({ idleMs: 20_001 }, snap)).toBe(false);
  });

  it("an empty when clause matches anything", () => {
    expect(matchesWhen({}, snapshot())).toBe(true);
  });

  it("pageState conditions fail cleanly when no page state is registered", () => {
    expect(matchesWhen({ pageState: { step: "documents" } }, snapshot())).toBe(false);
  });
});
