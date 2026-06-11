import { describe, it, expect, vi, afterEach } from "vitest";
import { createConversationSession } from "../src/state/createConversationSession";
import type { StorageLike } from "../src/state/createStore";

/** A Map-backed StorageLike so tests never touch real Web Storage. */
function fakeStorage(): StorageLike & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => (raw.has(key) ? raw.get(key)! : null),
    setItem: (key, value) => {
      raw.set(key, value);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createConversationSession", () => {
  describe("widget id", () => {
    it("generates a widget id and persists it under the default key", () => {
      const storage = fakeStorage();
      const session = createConversationSession({ storage });

      expect(session.widgetId).toBeTruthy();
      expect(session.key).toBe("ago_widget_id");
      expect(storage.raw.get("ago_widget_id")).toBe(session.widgetId);
    });

    it("reuses a previously persisted widget id over the same storage", () => {
      const storage = fakeStorage();
      const first = createConversationSession({ storage });

      const next = createConversationSession({ storage });
      expect(next.widgetId).toBe(first.widgetId);
    });

    it("adopts and persists an explicit widget id", () => {
      const storage = fakeStorage();
      const session = createConversationSession({ storage, widgetId: "visitor-42" });

      expect(session.widgetId).toBe("visitor-42");
      expect(storage.raw.get("ago_widget_id")).toBe("visitor-42");
    });

    it("honours a custom key", () => {
      const storage = fakeStorage();
      const session = createConversationSession({ storage, key: "my_widget" });

      expect(session.key).toBe("my_widget");
      expect(storage.raw.get("my_widget")).toBe(session.widgetId);
    });

    it("degrades to an in-memory id when no storage is available", () => {
      vi.stubGlobal("localStorage", undefined);
      const session = createConversationSession();

      expect(session.widgetId).toBeTruthy();
    });
  });

  describe("last active thread", () => {
    it("getLastActiveThread() returns null when nothing is cached", () => {
      const session = createConversationSession({ storage: fakeStorage() });
      expect(session.getLastActiveThread()).toBeNull();
    });

    it("setActiveThread() then getLastActiveThread() returns the id", () => {
      const storage = fakeStorage();
      const session = createConversationSession({ storage });

      session.setActiveThread("conv-1", new Date());

      expect(session.getLastActiveThread()).toBe("conv-1");
      const stored = JSON.parse(storage.raw.get("ago_last_thread")!);
      expect(stored.value).toBe("conv-1");
      expect(typeof stored.lastMessageAt).toBe("number");
    });

    it("restores a cached thread in a fresh session over the same storage", () => {
      const storage = fakeStorage();
      createConversationSession({ storage }).setActiveThread("conv-1", Date.now());

      const next = createConversationSession({ storage });
      expect(next.getLastActiveThread()).toBe("conv-1");
    });

    it("clear() forgets the cached thread", () => {
      const storage = fakeStorage();
      const session = createConversationSession({ storage });
      session.setActiveThread("conv-1", Date.now());

      session.clear();

      expect(session.getLastActiveThread()).toBeNull();
      expect(JSON.parse(storage.raw.get("ago_last_thread")!).value).toBeNull();
    });

    it("accepts a Date or an epoch-ms number for lastMessageAt", () => {
      const storage = fakeStorage();
      const session = createConversationSession({ storage });

      session.setActiveThread("conv-date", new Date(1234));
      expect(JSON.parse(storage.raw.get("ago_last_thread")!).lastMessageAt).toBe(1234);

      session.setActiveThread("conv-num", 5678);
      expect(JSON.parse(storage.raw.get("ago_last_thread")!).lastMessageAt).toBe(5678);
    });
  });

  describe("ttl (checked on the front)", () => {
    it("does not display a thread recorded without a last message time", () => {
      const session = createConversationSession({ storage: fakeStorage() });

      session.setActiveThread("conv-1"); // no lastMessageAt

      expect(session.getLastActiveThread()).toBeNull();
    });

    it("resumes a thread within the default 2h", () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(0);
      const session = createConversationSession({ storage: fakeStorage() });
      session.setActiveThread("conv-1", 0);

      now.mockReturnValue(60 * 60 * 1000); // 1h later
      expect(session.getLastActiveThread()).toBe("conv-1");
    });

    it("drops a thread idle longer than the default 2h and wipes it on load", () => {
      const storage = fakeStorage();
      const now = vi.spyOn(Date, "now").mockReturnValue(0);
      createConversationSession({ storage }).setActiveThread("conv-1", 0);

      now.mockReturnValue(3 * 60 * 60 * 1000); // 3h later, past the 2h ttl
      const next = createConversationSession({ storage });

      expect(next.getLastActiveThread()).toBeNull();
      expect(JSON.parse(storage.raw.get("ago_last_thread")!).value).toBeNull();
    });

    it("honours a custom ttlMs", () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(0);
      const session = createConversationSession({ storage: fakeStorage(), ttlMs: 1000 });
      session.setActiveThread("conv-1", 0);

      now.mockReturnValue(1500); // 1.5s later, past the 1s ttl
      expect(session.getLastActiveThread()).toBeNull();
    });

    it("setActiveThread refreshes the window (sliding)", () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(0);
      const session = createConversationSession({ storage: fakeStorage(), ttlMs: 1000 });
      session.setActiveThread("conv-1", 0);

      now.mockReturnValue(800);
      session.setActiveThread("conv-1", 800); // refreshed

      now.mockReturnValue(1500); // 1.5s from t0, only 0.7s since last activity
      expect(session.getLastActiveThread()).toBe("conv-1");
    });

    it("ttlMs: Infinity never expires", () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(0);
      const session = createConversationSession({ storage: fakeStorage(), ttlMs: Infinity });
      session.setActiveThread("conv-1", 0);

      now.mockReturnValue(Number.MAX_SAFE_INTEGER);
      expect(session.getLastActiveThread()).toBe("conv-1");
    });
  });
});
