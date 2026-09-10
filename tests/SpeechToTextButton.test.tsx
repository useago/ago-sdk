import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatInput } from "../src/react/components/ChatInput";
import { ChatWidget } from "../src/react/components/ChatWidget";
import { SpeechToTextButton } from "../src/react/components/SpeechToTextButton";
import { AgoProvider } from "../src/react/context/AgoContext";
import { createMockClient } from "../src/testing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let stopTrack: ReturnType<typeof vi.fn>;
class Recorder {
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm";
  onstop?: () => void;
  ondataavailable?: (event: { data: Blob }) => void;
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  stopTrack = vi.fn();
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const mic = () => container.querySelector<HTMLButtonElement>(".ago-chat-input__microphone")!;
function client(enabled = true) {
  return createMockClient({ overrides: {
    getConfig: async () => ({ permissions: [{ speechToTextEnabled: enabled }], proactive: { enabled: false } }),
    transcribeAudio: async () => ({ text: "Bonjour" }),
  } });
}

describe("React dictation", () => {
  it("provides the full recording flow through the provider in StrictMode", async () => {
    const onTranscript = vi.fn();
    const onBusyChange = vi.fn();
    await act(async () => root.render(<StrictMode><AgoProvider client={client()}>
      <SpeechToTextButton onTranscript={onTranscript} onBusyChange={onBusyChange} />
    </AgoProvider></StrictMode>));
    await act(async () => mic().click());
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(mic().getAttribute("aria-label")).toBe("Finish recording");
    await act(async () => mic().click());
    expect(onTranscript).toHaveBeenCalledExactlyOnceWith("Bonjour");
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("fills a ChatInput draft without sending it", async () => {
    const onSend = vi.fn();
    await act(async () => root.render(<ChatInput client={client()} speechToText onSend={onSend} />));
    await act(async () => mic().click());
    expect(container.querySelector("textarea")!.style.display).toBe("none");
    await act(async () => mic().click());
    expect(container.querySelector("textarea")!.value).toBe("Bonjour");
    expect(container.querySelector("textarea")!.style.display).toBe("");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("enables the complete control with a single ChatWidget prop", async () => {
    const mock = client();
    await act(async () => root.render(<ChatWidget client={mock} speechToText />));
    expect(mic()).not.toBeNull();
    await act(async () => mic().click());
    await act(async () => mic().click());
    expect(container.querySelector("textarea")!.value).toBe("Bonjour");
    expect(mock.__callsFor("transcribeAudio")).toHaveLength(1);
    expect(mock.__callsFor("sendMessage")).toHaveLength(0);
  });

  it("cancels a recording on conversation changes and on unmount", async () => {
    const mock = client();
    const onTranscript = vi.fn();
    await act(async () => root.render(<SpeechToTextButton client={mock} scopeKey="one" onTranscript={onTranscript} />));
    await act(async () => mic().click());
    await act(async () => root.render(<SpeechToTextButton client={mock} scopeKey="two" onTranscript={onTranscript} />));
    expect(stopTrack).toHaveBeenCalledTimes(1);
    await act(async () => mic().click());
    await act(async () => root.render(null));
    expect(stopTrack).toHaveBeenCalledTimes(2);
    expect(mock.__callsFor("transcribeAudio")).toHaveLength(0);
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("ignores a late transcription after changing conversations", async () => {
    let resolve!: (value: { text: string }) => void;
    const mock = createMockClient({ overrides: {
      getConfig: async () => ({ permissions: [{ speechToTextEnabled: true }], proactive: { enabled: false } }),
      transcribeAudio: () => new Promise((done) => { resolve = done; }),
    } });
    const onTranscript = vi.fn();
    await act(async () => root.render(<SpeechToTextButton client={mock} scopeKey="one" onTranscript={onTranscript} />));
    await act(async () => mic().click());
    await act(async () => mic().click());
    await act(async () => root.render(<SpeechToTextButton client={mock} scopeKey="two" onTranscript={onTranscript} />));
    await act(async () => resolve({ text: "Old conversation" }));
    expect(onTranscript).not.toHaveBeenCalled();
    const options = mock.__callsFor("transcribeAudio")[0].args[1] as { signal: AbortSignal };
    expect(options.signal.aborted).toBe(true);
  });

  it("hides the control for disabled tenants", async () => {
    await act(async () => root.render(<SpeechToTextButton client={client(false)} onTranscript={vi.fn()} />));
    expect(container.querySelector<HTMLElement>(".ago-speech-to-text")!.style.display).toBe("none");
  });

  it("uses translated labels", async () => {
    await act(async () => root.render(<ChatInput client={client()} onSend={vi.fn()}
      speechToText={{ labels: { start: "Dicter un message", finish: "Valider", cancel: "Annuler" } }} />));
    expect(mic().getAttribute("aria-label")).toBe("Dicter un message");
    await act(async () => mic().click());
    expect(mic().getAttribute("aria-label")).toBe("Valider");
    const cancel = container.querySelector<HTMLButtonElement>('[aria-label="Annuler"]')!;
    await act(async () => cancel.click());
    expect(stopTrack).toHaveBeenCalledOnce();
  });
});
