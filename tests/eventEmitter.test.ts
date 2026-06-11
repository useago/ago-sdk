import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "../src/utils/eventEmitter";

interface TestEvents {
  ping: { value: number };
  pong: { message: string };
}

describe("EventEmitter", () => {
  describe("once", () => {
    it("should fire handler only once", () => {
      const emitter = new EventEmitter<TestEvents>();
      const handler = vi.fn();

      emitter.once("ping", handler);
      emitter.emit("ping", { value: 1 });
      emitter.emit("ping", { value: 2 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ value: 1 });
    });
  });

  describe("waitFor", () => {
    it("should resolve on next event", async () => {
      const emitter = new EventEmitter<TestEvents>();

      const promise = emitter.waitFor("ping");
      emitter.emit("ping", { value: 42 });

      await expect(promise).resolves.toEqual({ value: 42 });
    });

    it("should reject on timeout", async () => {
      const emitter = new EventEmitter<TestEvents>();

      const promise = emitter.waitFor("ping", { timeout: 10 });

      await expect(promise).rejects.toThrow('waitFor("ping") timed out after 10ms');
    });

    it("should clear timeout when event fires", async () => {
      const emitter = new EventEmitter<TestEvents>();

      const promise = emitter.waitFor("ping", { timeout: 5000 });
      emitter.emit("ping", { value: 1 });

      await expect(promise).resolves.toEqual({ value: 1 });
    });
  });
});
