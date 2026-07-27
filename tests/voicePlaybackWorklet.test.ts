import { describe, expect, it, vi } from "vitest";
import playbackWorkletSource from "../src/voice/worklets/ago-pcm-playback.worklet.js?raw";

interface TestWorkletProcessor {
  port: {
    onmessage: ((event: { data: unknown }) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  };
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
}

function createPlaybackProcessor(): TestWorkletProcessor {
  class AudioWorkletProcessorStub {
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: vi.fn(),
    };
  }

  let Processor: (new () => TestWorkletProcessor) | undefined;
  const registerProcessor = (
    name: string,
    constructor: new () => TestWorkletProcessor,
  ) => {
    expect(name).toBe("ago-pcm-playback-processor");
    Processor = constructor;
  };

  const loadWorklet = new Function(
    "AudioWorkletProcessor",
    "registerProcessor",
    "sampleRate",
    playbackWorkletSource,
  );
  loadWorklet(AudioWorkletProcessorStub, registerProcessor, 48_000);
  if (!Processor) throw new Error("Playback worklet did not register");
  return new Processor();
}

describe("AGO PCM playback worklet", () => {
  it("signals once after final-marked PCM has been fully rendered", () => {
    const processor = createPlaybackProcessor();
    processor.port.onmessage?.({
      data: new Int16Array([1000, 2000]).buffer,
    });

    expect(processor.process([], [[new Float32Array(128)]])).toBe(true);
    expect(processor.port.postMessage).not.toHaveBeenCalled();

    processor.port.onmessage?.({ data: { type: "end" } });
    processor.process([], [[new Float32Array(128)]]);
    expect(processor.port.postMessage).toHaveBeenCalledTimes(1);
    expect(processor.port.postMessage).toHaveBeenCalledWith({
      type: "drained",
    });

    processor.process([], [[new Float32Array(128)]]);
    expect(processor.port.postMessage).toHaveBeenCalledTimes(1);
  });

  it("treats an empty queue before the end marker as a streaming underrun", () => {
    const processor = createPlaybackProcessor();
    processor.port.onmessage?.({
      data: new Int16Array([1000, 2000]).buffer,
    });
    processor.process([], [[new Float32Array(128)]]);
    expect(processor.port.postMessage).not.toHaveBeenCalled();

    processor.port.onmessage?.({
      data: new Int16Array([3000, 4000]).buffer,
    });
    processor.process([], [[new Float32Array(128)]]);
    expect(processor.port.postMessage).not.toHaveBeenCalled();

    processor.port.onmessage?.({ data: { type: "end" } });
    processor.process([], [[new Float32Array(128)]]);
    expect(processor.port.postMessage).toHaveBeenCalledWith({
      type: "drained",
    });
  });

  it("does not report a flushed queue as naturally drained", () => {
    const processor = createPlaybackProcessor();
    processor.port.onmessage?.({
      data: new Int16Array([1000, 2000]).buffer,
    });
    processor.port.onmessage?.({ data: { type: "flush" } });

    processor.process([], [[new Float32Array(128)]]);

    expect(processor.port.postMessage).not.toHaveBeenCalled();
  });
});
