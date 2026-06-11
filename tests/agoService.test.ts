import { describe, it, expect, vi } from "vitest";
import { AgoService } from "../src/angular/ago.service";
import { provideAgo } from "../src/angular/provide";

describe("AgoService", () => {
  it("creates a service with config", () => {
    const service = new AgoService({ baseUrl: "https://test.useago.com" });
    expect(service).toBeDefined();
    expect(service.getClient()).toBeDefined();
    service.destroy();
  });

  it("exposes observable-like messages$", () => {
    const service = new AgoService({ baseUrl: "https://test.useago.com" });
    const cb = vi.fn();
    const sub = service.messages$.subscribe({ next: cb });
    expect(sub.unsubscribe).toBeInstanceOf(Function);
    sub.unsubscribe();
    service.destroy();
  });

  it("exposes observable-like chunks$", () => {
    const service = new AgoService({ baseUrl: "https://test.useago.com" });
    const cb = vi.fn();
    const sub = service.chunks$.subscribe({ next: cb });
    sub.unsubscribe();
    service.destroy();
  });

  it("registerFunction delegates to client", () => {
    const service = new AgoService({ baseUrl: "https://test.useago.com" });
    service.registerFunction({
      name: "test",
      description: "test fn",
      parameters: { type: "object", properties: {} },
      handler: async () => "ok",
    });
    service.unregisterFunction("test");
    service.destroy();
  });
});

describe("provideAgo", () => {
  it("returns a provider object", () => {
    const provider = provideAgo({ baseUrl: "https://test.useago.com" });
    expect(provider.provide).toBe(AgoService);
    expect(provider.useValue).toBeInstanceOf(AgoService);
    provider.useValue.destroy();
  });
});
