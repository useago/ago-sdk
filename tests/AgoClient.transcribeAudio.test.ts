// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgoClient } from "../src/client/AgoClient";
import { AgoApiError, AgoNetworkError } from "../src/client/errors";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("transcribeAudio", () => {
  let client: AgoClient;
  const file = new File(["recorded audio"], "voice.webm", { type: "audio/webm;codecs=opus" });

  beforeEach(() => {
    client = new AgoClient({
      baseUrl: "https://api.example.test/",
      widgetId: "visitor-1",
      userEmail: "visitor@example.test",
      userJwt: "test-jwt",
      permission: "support",
    });
  });

  afterEach(() => {
    client.destroy();
    vi.unstubAllGlobals();
  });

  it("uploads one file with the current auth headers and returns an editable draft", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ text: "Bonjour !" }));
    vi.stubGlobal("fetch", fetchMock);
    client.updateConfig({ userJwt: "refreshed-jwt" });
    const onMessage = vi.fn();
    client.on("message:complete", onMessage);

    await expect(client.transcribeAudio(file)).resolves.toEqual({ text: "Bonjour !" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.test/api/sdk/v1/audio/transcriptions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "X-User-Anon-Id": "visitor-1",
      "X-User-Email": "visitor@example.test",
      Authorization: "Bearer refreshed-jwt",
      "X-Widget-Permission": "support",
    });
    const body = init?.body as FormData;
    expect([...body.keys()]).toEqual(["file"]);
    const upload = body.get("file") as File;
    expect(upload.name).toBe("voice.webm");
    expect(upload.type).toBe(file.type);
    expect(await upload.text()).toBe("recorded audio");
    expect(client.isGenerating()).toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it("forwards cancellation without turning it into a network error", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = client.transcribeAudio(file, { signal: controller.signal });
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
    controller.abort();

    await expect(pending).rejects.toBe(controller.signal.reason);
    expect(client.isGenerating()).toBe(false);
  });

  it("preserves an abort while reading the response body", async () => {
    const response = jsonResponse({ text: "Hello" });
    const abort = new DOMException("Canceled", "AbortError");
    vi.spyOn(response, "json").mockRejectedValue(abort);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));

    await expect(client.transcribeAudio(file)).rejects.toBe(abort);
  });

  it.each([
    [400, "bad_request", "Unsupported audio format."],
    [401, "authentication_required", "Authentication required."],
    [403, "permission_denied", "Speech-to-text is disabled for this tenant."],
    [413, "payload_too_large", "Audio files must be 25 MB or smaller."],
    [422, "validation_error", "No speech was detected. Please try again."],
    [503, "service_unavailable", "Transcription is temporarily unavailable. Please try again."],
  ])("preserves the backend's %s error", async (status, code, message) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      error: { type: "api_error", code, message, param: "file" },
    }, status)));

    const error = await client.transcribeAudio(file).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AgoApiError);
    expect(error).toMatchObject({ statusCode: status, code, message, param: "file" });
  });

  it("uses the SDK network error for failed uploads", async () => {
    const cause = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(cause));

    const error = await client.transcribeAudio(file).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AgoNetworkError);
    expect(error).toMatchObject({ code: "network_error", originalError: cause });
  });
});
