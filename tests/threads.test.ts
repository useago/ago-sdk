import { describe, expect, it } from "vitest";
import type { Conversation } from "../src/client/types";
import {
  pickResumableThread,
  RESUME_TTL_MS,
  sortThreadsByDate,
} from "../src/widget/threads";

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function thread(id: string, agoMs: number): Conversation {
  return { id, title: id, lastMessageDate: new Date(NOW - agoMs) };
}

describe("sortThreadsByDate", () => {
  it("orders newest first without mutating the input", () => {
    const input = [thread("old", 5 * HOUR), thread("new", HOUR), thread("mid", 2 * HOUR)];
    const sorted = sortThreadsByDate(input);
    expect(sorted.map((t) => t.id)).toEqual(["new", "mid", "old"]);
    expect(input.map((t) => t.id)).toEqual(["old", "new", "mid"]);
  });

  it("pushes an invalid date to the end", () => {
    const broken = { id: "broken", title: "", lastMessageDate: new Date("nope") };
    const sorted = sortThreadsByDate([broken, thread("ok", HOUR)]);
    expect(sorted[0].id).toBe("ok");
  });
});

describe("pickResumableThread", () => {
  it("returns the newest thread when it is fresh", () => {
    const picked = pickResumableThread(
      [thread("old", 5 * HOUR), thread("new", HOUR)],
      NOW,
    );
    expect(picked?.id).toBe("new");
  });

  it("returns null when the newest thread is older than the TTL", () => {
    expect(pickResumableThread([thread("old", 3 * HOUR)], NOW)).toBeNull();
    expect(
      pickResumableThread([thread("edge", RESUME_TTL_MS)], NOW),
    ).toBeNull();
  });

  it("returns null for an empty list or an invalid date", () => {
    expect(pickResumableThread([], NOW)).toBeNull();
    expect(
      pickResumableThread(
        [{ id: "x", title: "", lastMessageDate: new Date("nope") }],
        NOW,
      ),
    ).toBeNull();
  });

  it("honors a custom TTL", () => {
    expect(pickResumableThread([thread("t", 3 * HOUR)], NOW, 4 * HOUR)?.id).toBe(
      "t",
    );
  });
});
