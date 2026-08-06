import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compactMediaQuery,
  createSheetController,
} from "../src/widget/sheetController";

/** Controllable matchMedia keyed by query, so a test can assert which media
 *  query the controller actually registered rather than assuming one. */
function stubMatchMedia(state: { compact: boolean }) {
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const set = listeners.get(query) ?? new Set();
      listeners.set(query, set);
      return {
        get matches() {
          return state.compact;
        },
        media: query,
        addEventListener: (_: string, cb: () => void) => set.add(cb),
        removeEventListener: (_: string, cb: () => void) => set.delete(cb),
        dispatchEvent: () => true,
      };
    }),
  );
  return {
    set(compact: boolean) {
      state.compact = compact;
      for (const set of listeners.values()) for (const cb of set) cb();
    },
    queries: () => [...listeners.keys()],
    listenerCount: () =>
      [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createSheetController", () => {
  it("treats a short landscape viewport as compact, not just a narrow one", () => {
    const mq = stubMatchMedia({ compact: true });
    const c = createSheetController({ breakpoint: 768 });

    // A phone in landscape is 844x390: width alone would drop the sheet on the
    // viewport that needs it most.
    expect(mq.queries()[0]).toBe(compactMediaQuery(768));
    expect(mq.queries()[0]).toContain("max-width: 768px");
    expect(mq.queries()[0]).toContain("orientation: landscape");

    c.destroy();
  });

  it("rests in peek and expands to full", () => {
    stubMatchMedia({ compact: true });
    const c = createSheetController();

    expect(c.getSnapshot().state).toBe("peek");
    expect(c.getSnapshot().isModal).toBe(false);

    c.expand();
    expect(c.getSnapshot().state).toBe("full");
    expect(c.getSnapshot().isModal).toBe(true);

    c.collapse();
    expect(c.getSnapshot().state).toBe("peek");

    c.destroy();
  });

  it("is never modal on a desktop viewport, even when expanded", () => {
    stubMatchMedia({ compact: false });
    const c = createSheetController();

    c.expand();
    // The host page is still visible and usable beside the widget, so trapping
    // focus or locking scroll there would strand keyboard users.
    expect(c.getSnapshot().isModal).toBe(false);
    expect(c.getSnapshot().surface.attrs["aria-modal"]).toBeNull();
    expect(c.getSnapshot().surface.style).toEqual({});

    c.destroy();
  });

  it("returns a stable snapshot identity until something changes", () => {
    stubMatchMedia({ compact: true });
    const c = createSheetController();

    // useSyncExternalStore compares snapshots by identity: a fresh object per
    // call would re-render forever.
    expect(c.getSnapshot()).toBe(c.getSnapshot());
    const before = c.getSnapshot();
    c.expand();
    expect(c.getSnapshot()).not.toBe(before);

    c.destroy();
  });

  it("renders a non-compact server snapshot so hydration matches", () => {
    stubMatchMedia({ compact: true });
    const c = createSheetController();

    // matchMedia does not exist in Node, so the server never claims compact;
    // promotion happens after hydration instead of causing a mismatch.
    expect(c.getServerSnapshot().compact).toBe(false);
    expect(c.getServerSnapshot().isModal).toBe(false);

    c.destroy();
  });

  it("notifies subscribers and reports what caused the change", () => {
    stubMatchMedia({ compact: true });
    const causes: string[] = [];
    const c = createSheetController({
      onStateChange: (_s, cause) => causes.push(cause),
    });
    const seen = vi.fn();
    const unsubscribe = c.subscribe(seen);

    c.expand("user");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(causes).toEqual(["user"]);

    // Same state twice is not a change.
    c.expand("user");
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
    c.collapse();
    expect(seen).toHaveBeenCalledTimes(1);

    c.destroy();
  });

  it("falls back to the resting state when the compact layout goes away", () => {
    const mq = stubMatchMedia({ compact: true });
    const c = createSheetController();
    // The media listener only exists while something is watching, so subscribe
    // the way a renderer would.
    const off = c.subscribe(() => {});
    c.expand();
    expect(c.getSnapshot().state).toBe("full");

    mq.set(false);
    // Otherwise rotating back to a phone would silently reopen a sheet the user
    // had already collapsed.
    expect(c.getSnapshot().state).toBe("peek");
    expect(c.getSnapshot().isModal).toBe(false);

    off();
    c.destroy();
  });

  it("honours bottomOffset so it can share the bottom edge with a host nav", () => {
    stubMatchMedia({ compact: true });
    const px = createSheetController({ bottomOffset: 64 });
    expect(px.getSnapshot().surface.style.bottom).toBe("64px");
    px.destroy();

    const expr = createSheetController({
      bottomOffset: "calc(56px + env(safe-area-inset-bottom))",
    });
    expect(expr.getSnapshot().surface.style.bottom).toBe(
      "calc(56px + env(safe-area-inset-bottom))",
    );
    expr.destroy();
  });

  it("attaches its media listener only while subscribed", () => {
    const mq = stubMatchMedia({ compact: true });
    const c = createSheetController();
    // Nothing is watching yet, so nothing is attached.
    expect(mq.listenerCount()).toBe(0);

    const off = c.subscribe(() => {});
    expect(mq.listenerCount()).toBe(1);
    off();
    expect(mq.listenerCount()).toBe(0);

    // Re-subscribing works: React StrictMode unsubscribes and resubscribes
    // between its two mounts, and the controller has to survive that.
    const off2 = c.subscribe(() => {});
    expect(mq.listenerCount()).toBe(1);
    c.expand();
    expect(c.getSnapshot().state).toBe("full");
    off2();

    c.collapse();
    c.destroy();
    expect(mq.listenerCount()).toBe(0);
    // Commands after destroy are inert rather than throwing.
    c.expand();
    expect(c.getSnapshot().state).toBe("peek");
    c.destroy();
  });

  it("is inert without matchMedia (SSR / old browsers) instead of throwing", () => {
    vi.stubGlobal("matchMedia", undefined);
    const c = createSheetController();
    expect(c.getSnapshot().compact).toBe(false);
    expect(c.getSnapshot().isModal).toBe(false);
    c.destroy();
  });
});
