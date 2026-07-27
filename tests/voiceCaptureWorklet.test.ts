import { afterEach, describe, expect, it, vi } from "vitest";
import captureWorkletSource from "../src/voice/worklets/ago-pcm-capture.worklet.js?raw";

describe("PCM capture worklet batching", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits one 20ms packet instead of one packet per render quantum", () => {
    let Processor:
      | (new () => {
          port: { postMessage: ReturnType<typeof vi.fn> };
          process: (inputs: Float32Array[][]) => boolean;
        })
      | null = null;
    class FakeAudioWorkletProcessor {
      port = { postMessage: vi.fn() };
    }
    vi.stubGlobal("AudioWorkletProcessor", FakeAudioWorkletProcessor);
    vi.stubGlobal("sampleRate", 48_000);
    vi.stubGlobal(
      "registerProcessor",
      (_name: string, ctor: typeof Processor) => {
        Processor = ctor;
      },
    );

    new Function(captureWorkletSource)();
    if (!Processor) throw new Error("capture processor was not registered");
    const processor = new Processor();
    const quantum = new Float32Array(128).fill(0.25);

    for (let i = 0; i < 8; i += 1) {
      expect(processor.process([[quantum]])).toBe(true);
    }

    expect(processor.port.postMessage).toHaveBeenCalledTimes(1);
    const [buffer, transfer] = processor.port.postMessage.mock.calls[0] as [
      ArrayBuffer,
      ArrayBuffer[],
    ];
    expect(buffer.byteLength).toBe(480 * Int16Array.BYTES_PER_ELEMENT);
    expect(transfer).toEqual([buffer]);
  });
});
