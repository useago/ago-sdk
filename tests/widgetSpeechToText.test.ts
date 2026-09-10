import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInput } from "../src/widget/buildInput";
import { mountChatWidget } from "../src/widget/createChatWidget";
import { createMockClient } from "../src/testing";

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (type: string) => type.startsWith("audio/webm");
  state = "inactive";
  mimeType: string;
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? "audio/mp4";
    FakeRecorder.instances.push(this);
  }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

let handles: Array<{ destroy(): void }>;
let stopTrack: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  handles = [];
  FakeRecorder.instances = [];
  stopTrack = vi.fn();
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
});

afterEach(() => {
  handles.forEach((handle) => handle.destroy());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function build(transcribeAudio = vi.fn().mockResolvedValue({ text: "Hello from Brevo" })) {
  const onSend = vi.fn();
  const handle = buildInput({ placeholder: "Message", allowFiles: false, look: "embed", onSend, transcribeAudio });
  handles.push(handle);
  document.body.append(handle.inputRow);
  handle.setSpeechToTextEnabled(true);
  const textarea = handle.inputRow.querySelector("textarea")!;
  const mic = handle.inputRow.querySelector<HTMLButtonElement>(".ago-chat-input__microphone")!;
  const cancel = handle.inputRow.querySelector<HTMLButtonElement>('[aria-label="Cancel dictation"]')!;
  return { handle, textarea, mic, cancel, onSend, transcribeAudio };
}

async function begin(mic: HTMLButtonElement) {
  mic.click();
  await vi.waitFor(() => expect(FakeRecorder.instances).toHaveLength(1));
}

describe("widget dictation", () => {
  it("replaces the editor with the waveform and cancels with Escape", async () => {
    const { mic, handle, textarea, transcribeAudio } = build();
    textarea.value = "Keep this";
    await begin(mic);
    expect(handle.inputRow.querySelector<HTMLElement>(".ago-chat-input__editor")!.style.display).toBe("none");
    expect(handle.inputRow.querySelector("canvas")!.closest(".ago-chat-input__speech")).not.toBeNull();
    expect(document.activeElement).toBe(mic);
    mic.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(handle.inputRow.querySelector<HTMLElement>(".ago-chat-input__editor")!.style.display).toBe("");
    expect(textarea.value).toBe("Keep this");
    expect(document.activeElement).toBe(textarea);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("records into an editable draft, preserving existing text without sending", async () => {
    const { mic, textarea, onSend, transcribeAudio } = build();
    textarea.value = "My question:";
    await begin(mic);
    expect(textarea.disabled).toBe(true);
    expect(mic.getAttribute("aria-label")).toBe("Finish recording");
    mic.click();
    await vi.waitFor(() => expect(textarea.value).toBe("My question: Hello from Brevo"));
    expect(textarea.disabled).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledOnce();
    const [file, options] = transcribeAudio.mock.calls[0];
    expect(file.name).toBe("recording.webm");
    expect(file.type).toBe("audio/webm;codecs=opus");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("cancels a recording and retains the draft without uploading", async () => {
    const { mic, cancel, textarea, transcribeAudio } = build();
    textarea.value = "Keep this";
    await begin(mic);
    cancel.click();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Keep this");
    expect(textarea.disabled).toBe(false);
  });

  it("releases a microphone granted after the user cancels permission acquisition", async () => {
    let grant!: (value: unknown) => void;
    getUserMedia.mockReturnValue(new Promise((resolve) => { grant = resolve; }));
    const { mic, cancel } = build();
    mic.click();
    cancel.click();
    grant({ getTracks: () => [{ stop: stopTrack }] });
    await vi.waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it("aborts a pending upload and ignores its late result", async () => {
    let finish!: (value: unknown) => void;
    const transcribe = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { mic, cancel, textarea } = build(transcribe);
    await begin(mic);
    mic.click();
    expect(transcribe).toHaveBeenCalledOnce();
    cancel.click();
    expect(transcribe.mock.calls[0][1].signal.aborted).toBe(true);
    finish({ text: "Stale text" });
    await Promise.resolve();
    expect(textarea.value).toBe("");
  });

  it("explains denied microphone permission and restores the editor", async () => {
    getUserMedia.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    const { mic, textarea, handle } = build();
    textarea.value = "Keep this";
    mic.click();
    await vi.waitFor(() => expect(handle.inputRow.textContent).toContain("Allow microphone access"));
    expect(textarea.disabled).toBe(false);
    expect(textarea.value).toBe("Keep this");
  });

  it("shows API errors and keeps the draft", async () => {
    const { mic, textarea, handle } = build(vi.fn().mockRejectedValue(new Error("No speech detected")));
    textarea.value = "Keep this";
    await begin(mic);
    mic.click();
    await vi.waitFor(() => expect(handle.inputRow.textContent).toContain("No speech detected"));
    expect(textarea.disabled).toBe(false);
    expect(textarea.value).toBe("Keep this");
  });

  it.each(["destroy", "cancelRecording", "getValueAndClear"] as const)("%s releases the microphone", async (method) => {
    const { mic, handle, transcribeAudio } = build();
    await begin(mic);
    handle[method]();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("blocks submitting the draft while recording", async () => {
    const { mic, handle, textarea, onSend } = build();
    textarea.value = "Keep this";
    await begin(mic);
    handle.inputRow.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Keep this");
  });

  it("stops and transcribes at the two-minute limit", async () => {
    vi.useFakeTimers();
    const { mic, transcribeAudio } = build();
    mic.click();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(transcribeAudio).toHaveBeenCalledOnce();
  });

  it("uses MP4 when that is the browser's recording format", async () => {
    vi.spyOn(FakeRecorder, "isTypeSupported").mockImplementation((type) => type === "audio/mp4");
    const { mic, transcribeAudio } = build();
    await begin(mic);
    mic.click();
    expect(transcribeAudio.mock.calls[0][0].name).toBe("recording.mp4");
    expect(transcribeAudio.mock.calls[0][0].type).toBe("audio/mp4");
    vi.restoreAllMocks();
  });

  it("discards oversized recordings before upload", async () => {
    const { mic, handle, transcribeAudio } = build();
    await begin(mic);
    FakeRecorder.instances[0].ondataavailable?.({ data: { size: 25_000_001 } as Blob });
    expect(handle.inputRow.textContent).toContain("Recording is too large");
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("closing the bubble cancels the recording", async () => {
    const client = createMockClient({ overrides: {
      getConfig: async () => ({ permissions: [{ speechToTextEnabled: true }], proactive: { enabled: false } }),
    } });
    const widget = mountChatWidget(document.body, { client, placement: "bubble", speechToText: true, autoResume: false });
    handles.push(widget);
    widget.open();
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>(".ago-chat-input__speech")!.style.display).toBe("flex"));
    await begin(document.querySelector<HTMLButtonElement>(".ago-chat-input__microphone")!);
    widget.close();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(client.__callsFor("transcribeAudio")).toHaveLength(0);
  });

  it("hides the microphone in unsupported browsers", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const { handle } = build();
    expect(handle.inputRow.querySelector<HTMLElement>(".ago-chat-input__speech")!.style.display).toBe("none");
  });

  it.each([true, false])("uses the tenant's enabled=%s flag", async (speechToTextEnabled) => {
    const client = createMockClient({ overrides: {
      getConfig: async () => ({ permissions: [{ speechToTextEnabled }], proactive: { enabled: false } }),
    } });
    const host = document.createElement("div");
    document.body.append(host);
    const widget = mountChatWidget(host, { client, speechToText: true });
    handles.push(widget);
    await vi.waitFor(() => expect(client.__callsFor("getConfig")).toHaveLength(1));
    const speech = host.querySelector<HTMLElement>(".ago-chat-input__speech")!;
    expect(speech.style.display).toBe(speechToTextEnabled ? "flex" : "none");
  });
});
