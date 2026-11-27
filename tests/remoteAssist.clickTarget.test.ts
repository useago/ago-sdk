import { afterEach, describe, expect, it } from "vitest";
import { FunctionRegistry } from "../src/functions/FunctionRegistry";
import type { NavRoute } from "../src/functions/navigation";
import { clickInvocation, findClickTarget, type ClickTarget } from "../src/remoteAssist/clickTarget";

const PAGE = window.location.href;
const ORIGIN = window.location.origin;

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.getElementById("t")!;
}

const preview = (html: string) => findClickTarget(mount(html), PAGE)?.preview ?? null;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findClickTarget (preview)", () => {
  it("reads a declared action with its JSON arguments", () => {
    expect(preview(`<button id="t" data-ago-action="addToCart" data-ago-args='{"sku":"A1","qty":2}'>Add</button>`))
      .toEqual({ function: "addToCart", arguments: { sku: "A1", qty: 2 } });
    expect(preview(`<button id="t" data-ago-action="refresh">Refresh</button>`))
      .toEqual({ function: "refresh", arguments: {} });
  });

  it("refuses action arguments that are not a JSON object", () => {
    for (const args of ["[1,2]", "42", "null", "{oops"]) {
      expect(preview(`<button id="t" data-ago-action="go" data-ago-args='${args}'>x</button>`))
        .toEqual({ error: "invalid_args" });
    }
  });

  it("reads a page-state control with its raw value and default function", () => {
    expect(preview(`<button id="t" data-ago-state="status" data-ago-value="pending">Pending</button>`))
      .toEqual({ function: "setPageState", arguments: { status: "pending" } });
    expect(preview(`<div id="t" role="tab" data-ago-state="page" data-ago-value="2" data-ago-state-function="setListState">2</div>`))
      .toEqual({ function: "setListState", arguments: { page: "2" } });
  });

  it("walks up from the clicked descendant to the declared ancestor", () => {
    document.body.innerHTML = `<a href="/x"><div data-ago-action="open" data-ago-args='{"id":7}'><span><b id="t">Open</b></span></div></a>`;
    expect(findClickTarget(document.getElementById("t")!.firstChild!, PAGE)?.preview)
      .toEqual({ function: "open", arguments: { id: 7 } });
  });

  it("applies the rules element by element, nearest first", () => {
    // An ignored region inside a link: the walk stops before reaching the link.
    expect(preview(`<a href="/orders"><div data-ago-ignore><span id="t">Badge</span></div></a>`)).toBeNull();
    // A declared control inside an ignored region is found before the region.
    expect(preview(`<div data-ago-ignore><button id="t" data-ago-action="pay">Pay</button></div>`))
      .toEqual({ function: "pay", arguments: {} });
  });

  it("reports a disabled element or ancestor before any action above it", () => {
    expect(preview(`<button id="t" disabled data-ago-action="save">Save</button>`)).toEqual({ error: "disabled" });
    expect(preview(`<div data-ago-action="open"><button aria-disabled="true"><span id="t">x</span></button></div>`))
      .toEqual({ error: "disabled" });
    expect(preview(`<button id="t" aria-disabled="false" data-ago-action="save">Save</button>`))
      .toEqual({ function: "save", arguments: {} });
  });

  it("turns a same-origin link into navigateToPage with path, query and hash", () => {
    expect(preview(`<a id="t" href="/orders/42?tab=items#top">Order</a>`))
      .toEqual({ function: "navigateToPage", href: "/orders/42?tab=items#top" });
    expect(preview(`<a id="t" href="${ORIGIN}/settings">Settings</a>`))
      .toEqual({ function: "navigateToPage", href: "/settings" });
  });

  it("refuses links to another origin", () => {
    expect(preview(`<a id="t" href="https://elsewhere.example/orders">Out</a>`)).toEqual({ error: "external_link" });
    expect(preview(`<a id="t" href="javascript:void(0)">Nothing</a>`)).toEqual({ error: "external_link" });
  });

  it("marks undeclared controls, by tag or role, and ignores plain content", () => {
    for (const html of [
      `<button id="t">Save</button>`,
      `<input id="t" />`,
      `<details><summary id="t">More</summary></details>`,
      `<div id="t" role="switch">On</div>`,
      `<span id="t" role="link">Next</span>`,
    ]) {
      expect(preview(html)).toEqual({ error: "not_declared" });
    }
    expect(preview(`<p id="t">Hello</p>`)).toBeNull();
    expect(preview(`<div id="t" role="dialog">Hi</div>`)).toBeNull();
  });
});

describe("clickInvocation", () => {
  const registry = new FunctionRegistry();
  registry.register({
    name: "setPageState",
    description: "d",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string" },
        page: { type: "integer" },
        ratio: { type: "number" },
        archived: { type: "boolean" },
      },
    },
    handler: () => null,
  });
  const ROUTES: NavRoute[] = [
    { name: "home", path: "/", description: "Home" },
    { name: "orders", path: "/orders", description: "Orders" },
    { name: "order", path: "/orders/:id", description: "One order" },
    { name: "item", path: "/orders/:id/items/:itemId", description: "One item" },
  ];
  const context = { getFunction: (name: string) => registry.get(name), routes: ROUTES };
  const state = (args: Record<string, string>, fn = "setPageState"): ClickTarget => ({
    kind: "state",
    preview: { function: fn, arguments: args },
  });
  const link = (href: string): ClickTarget => ({ kind: "link", preview: { function: "navigateToPage", href } });

  it("passes action arguments through as declared", () => {
    expect(clickInvocation({ kind: "action", preview: { function: "go", arguments: { n: "1" } } }, context))
      .toEqual({ function: "go", arguments: { n: "1" } });
  });

  it("types state values with the function's schema", () => {
    expect(clickInvocation(state({ status: "pending" }), context))
      .toEqual({ function: "setPageState", arguments: { status: "pending" } });
    expect(clickInvocation(state({ page: "3" }), context)).toEqual({ function: "setPageState", arguments: { page: 3 } });
    expect(clickInvocation(state({ ratio: "0.5" }), context)).toEqual({ function: "setPageState", arguments: { ratio: 0.5 } });
    expect(clickInvocation(state({ archived: "false" }), context))
      .toEqual({ function: "setPageState", arguments: { archived: false } });
  });

  it("refuses a state value its schema type cannot hold", () => {
    for (const args of [{ page: "abc" }, { page: "" }, { page: "1.5" }, { ratio: "Infinity" }, { archived: "yes" }]) {
      expect(clickInvocation(state(args), context)).toEqual({ error: expect.any(String) });
    }
  });

  it("refuses an unknown state property or an unregistered state function", () => {
    expect(clickInvocation(state({ color: "red" }), context)).toEqual({ error: expect.stringContaining("color") });
    expect(clickInvocation(state({ status: "x" }, "setOther"), context))
      .toEqual({ error: expect.stringContaining("setOther") });
  });

  it("maps a link to its declared route: exact path, then :param pattern", () => {
    expect(clickInvocation(link("/orders?sort=date"), context))
      .toEqual({ function: "navigateToPage", arguments: { page: "orders" } });
    expect(clickInvocation(link("/orders/A%2042/items/7"), context))
      .toEqual({ function: "navigateToPage", arguments: { page: "item", id: "A 42", itemId: "7" } });
  });

  it("reads the hash path of a hash-routed app before its pathname", () => {
    // App served at "/": the pathname alone would match the home route.
    const hashApp = { ...context, routes: [ROUTES[0], ROUTES[2]] };
    document.body.innerHTML = `<a id="t" href="#/orders/42">Order</a>`;
    const target = findClickTarget(document.getElementById("t")!, PAGE)!;
    expect(clickInvocation(target, hashApp))
      .toEqual({ function: "navigateToPage", arguments: { page: "order", id: "42" } });
    expect(clickInvocation(link("/#/orders/42?tab=1"), hashApp))
      .toEqual({ function: "navigateToPage", arguments: { page: "order", id: "42" } });
    // An in-page anchor is not a route: the pathname decides.
    expect(clickInvocation(link("/orders#summary"), context))
      .toEqual({ function: "navigateToPage", arguments: { page: "orders" } });
  });

  it("never falls back to a prefix match, and needs registered routes", () => {
    const notDeclared = { error: "This link does not lead to a page declared to AGO." };
    expect(clickInvocation(link("/orders/42/edit"), context)).toEqual(notDeclared);
    expect(clickInvocation(link("/orders"), { ...context, routes: null })).toEqual(notDeclared);
  });
});
