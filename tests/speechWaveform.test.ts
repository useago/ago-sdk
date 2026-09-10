import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpeechWaveform } from "../src/widget/speechWaveform";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const drawing = { clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(), fillStyle: "", globalAlpha: 1 };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(drawing as unknown as CanvasRenderingContext2D);
  let amplitude = 128;
  const analyser = {
    fftSize: 256, disconnect: vi.fn(),
    getByteTimeDomainData: vi.fn((buffer: Uint8Array) => buffer.fill(amplitude)),
  };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const close = vi.fn().mockResolvedValue(undefined);
  class TestAudioContext {
    state = "running";
    createMediaStreamSource = vi.fn(() => source);
    createAnalyser = vi.fn(() => analyser);
    close = close;
  }
  vi.stubGlobal("AudioContext", TestAudioContext);
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => { frames.set(++id, cb); return id; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((key: number) => frames.delete(key)));
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
  const wave = createSpeechWaveform();
  Object.defineProperty(wave.canvas, "clientWidth", { value: 120 });
  return {
    wave, drawing, source, analyser, close, frames, disconnect,
    setAmplitude(value: number) { amplitude = value; },
    tick(time: number) {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(cb => cb(time));
    },
  };
}

describe("microphone waveform", () => {
  it("draws larger bars when actual microphone samples get louder", () => {
    const { wave, drawing, setAmplitude, tick, source, analyser } = setup();
    wave.start({} as MediaStream);
    tick(50);
    expect(drawing.fillRect.mock.lastCall?.[3]).toBe(2);
    setAmplitude(160);
    tick(100);
    expect(drawing.fillRect.mock.lastCall?.[3]).toBe(32);
    // The source only feeds the analyser, so recording cannot echo through speakers.
    expect(source.connect).toHaveBeenCalledExactlyOnceWith(analyser);
    wave.reset();
  });

  it("closes audio and animation resources when recording stops", () => {
    const { wave, source, analyser, close, frames, disconnect } = setup();
    wave.start({} as MediaStream);
    expect(frames.size).toBe(1);
    wave.stop();
    expect(frames.size).toBe(0);
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(analyser.disconnect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    wave.reset();
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps a static waveform when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { wave, frames, source } = setup();
    wave.start({} as MediaStream);
    expect(frames.size).toBe(0);
    expect(source.connect).not.toHaveBeenCalled();
    wave.reset();
  });

  it("tolerates browsers without Web Audio", () => {
    vi.stubGlobal("AudioContext", undefined);
    const wave = createSpeechWaveform();
    expect(() => wave.start({} as MediaStream)).not.toThrow();
    wave.reset();
  });
});
