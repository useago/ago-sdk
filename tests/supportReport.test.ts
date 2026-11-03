import { afterEach, expect, it, vi } from "vitest";
import html2canvas from "html2canvas-pro";
import { AgoClient } from "../src/client/AgoClient";
import { capturePage, collectSupportEvidence } from "@useago/sdk/support";

vi.mock("html2canvas-pro", () => ({ default: vi.fn() }));
const clients: AgoClient[] = [];

afterEach(() => {
  clients.splice(0).forEach((client) => client.destroy());
  vi.restoreAllMocks();
  vi.resetAllMocks();
  document.body.innerHTML = "";
});

function read(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

it("exports retained, filtered errors without capturing an unrequested screenshot", async () => {
  const client = new AgoClient({ baseUrl: "https://example.test", errorWatcher: { filter: (error) => error.message.includes("secret") ? null : error } });
  clients.push(client);
  client.reportError(new Error("Checkout failed"));
  client.reportError(new Error("Checkout failed"));
  client.reportError(new Error("secret"));
  const evidence = await collectSupportEvidence(client);
  expect(evidence.files.map((file) => file.name)).toEqual(["errors.json"]);
  const log = JSON.parse(await read(evidence.files[0]));
  expect(log.errors).toHaveLength(1);
  expect(log.errors[0]).toMatchObject({ message: "Checkout failed", count: 2 });
  expect(html2canvas).not.toHaveBeenCalled();
});

it("collects a requested PNG alongside the logs, excluding private DOM content", async () => {
  document.body.innerHTML = '<input type="password"><div data-ago-private>Secret</div><div class="private">Private</div><iframe></iframe><p>Visible</p>';
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })));
  vi.mocked(html2canvas).mockResolvedValue(canvas);
  const evidence = await collectSupportEvidence({ getRecentErrors: () => [] }, { screenshot: { exclude: ".private" } });
  expect(evidence.files.map((file) => file.name)).toEqual(["errors.json", "screenshot.png"]);
  expect(evidence.files[1].type).toBe("image/png");
  const config = vi.mocked(html2canvas).mock.calls[0][1]!;
  expect(config).toMatchObject({ width: window.innerWidth, height: window.innerHeight, scale: 1 });
  for (const element of document.body.children) {
    expect(config.ignoreElements!(element)).toBe(element.tagName !== "P");
  }
  await expect(capturePage({ element: document.querySelector("[data-ago-private]")! })).rejects.toMatchObject({ code: "screenshot_private_element" });
  await expect(capturePage({ element: document.querySelector("iframe")! })).rejects.toMatchObject({ code: "screenshot_private_element" });
});

it("keeps the log when screenshot rendering fails and reports the missing screenshot", async () => {
  vi.mocked(html2canvas).mockRejectedValue(new Error("Unsupported CSS"));
  const evidence = await collectSupportEvidence({ getRecentErrors: () => [] }, { screenshot: true });
  expect(evidence.screenshotError).toBe("Unsupported CSS");
  expect(evidence.files.map((file) => file.name)).toEqual(["errors.json"]);
});
