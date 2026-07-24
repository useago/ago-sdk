import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  downsampleToInt16,
  floatToInt16,
  PlaybackQueue,
  rmsLevel,
  VOICE_WIRE_SAMPLE_RATE,
} from "../src/voice/worklets/dsp";

describe("floatToInt16", () => {
  it("maps the full float range onto signed 16-bit", () => {
    expect(floatToInt16(0)).toBe(0);
    expect(floatToInt16(1)).toBe(0x7fff);
    expect(floatToInt16(-1)).toBe(-0x8000);
    expect(floatToInt16(0.5)).toBe(Math.round(0.5 * 0x7fff));
    expect(floatToInt16(-0.5)).toBe(Math.round(-0.5 * 0x8000));
  });

  it("clamps out-of-range samples", () => {
    expect(floatToInt16(2)).toBe(0x7fff);
    expect(floatToInt16(-3)).toBe(-0x8000);
  });
});

describe("downsampleToInt16 (48k to 24k linear interpolation)", () => {
  it("takes every other sample at ratio 2 with zero fraction", () => {
    const input = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.75]);
    const { samples, carry } = downsampleToInt16(input, 2, 0);
    expect(Array.from(samples)).toEqual([
      floatToInt16(0),
      floatToInt16(0.5),
      floatToInt16(1),
    ]);
    expect(carry).toBe(0);
  });

  it("interpolates linearly at fractional positions", () => {
    const input = new Float32Array([0, 1, 0, 1]);
    const { samples, carry } = downsampleToInt16(input, 1.5, 0);
    // Read positions 0 and 1.5: values 0 and (1+0)/2.
    expect(Array.from(samples)).toEqual([floatToInt16(0), floatToInt16(0.5)]);
    expect(carry).toBe(-1);
  });

  it("stays continuous across 128-sample render quanta at ratio 2", () => {
    // The real capture path: 128-sample quanta at 48kHz, ratio exactly 2.
    // The carry stays 0, so resampling block by block equals resampling the
    // concatenated stream.
    const whole = new Float32Array(256).map((_, i) => Math.sin(i / 10));
    const block1 = whole.slice(0, 128);
    const block2 = whole.slice(128);

    const first = downsampleToInt16(block1, 2, 0);
    expect(first.samples.length).toBe(64);
    expect(first.carry).toBe(0);
    const second = downsampleToInt16(block2, 2, first.carry);

    const reference = downsampleToInt16(whole, 2, 0);
    expect([...first.samples, ...second.samples]).toEqual([
      ...reference.samples,
    ]);
  });

  it("reports the leftover fractional position as carry", () => {
    const { samples, carry } = downsampleToInt16(
      new Float32Array([0, 0.2, 0.4]),
      2,
      0
    );
    expect(samples.length).toBe(1);
    expect(carry).toBe(-1);
  });

  it("returns no samples and rolls the carry when the block is too short", () => {
    const { samples, carry } = downsampleToInt16(new Float32Array([0.5]), 4, 1);
    expect(samples.length).toBe(0);
    expect(carry).toBe(0);
  });
});

describe("rmsLevel", () => {
  it("is 0 for silence and for an empty block", () => {
    expect(rmsLevel(new Int16Array(0))).toBe(0);
    expect(rmsLevel(new Int16Array(128))).toBe(0);
  });

  it("clamps a full-scale square wave to 1", () => {
    const loud = new Int16Array(128).fill(-0x8000);
    expect(rmsLevel(loud)).toBe(1);
  });

  it("scales moderate speech into a usable meter range", () => {
    const value = Math.round(0.1 * 0x8000);
    const samples = new Int16Array(128).fill(value);
    expect(rmsLevel(samples)).toBeCloseTo(0.3, 2);
  });
});

describe("base64 PCM helpers", () => {
  it("round-trips Int16 PCM buffers", () => {
    const samples = new Int16Array([0, 1, -1, 32767, -32768, 12345]);
    const b64 = arrayBufferToBase64(samples.buffer);
    const roundTripped = new Int16Array(base64ToArrayBuffer(b64));
    expect(Array.from(roundTripped)).toEqual(Array.from(samples));
  });
});

describe("PlaybackQueue", () => {
  it("plays queued PCM16 back as floats at wire rate", () => {
    const queue = new PlaybackQueue(VOICE_WIRE_SAMPLE_RATE);
    queue.pushInt16(new Int16Array([0x4000, -0x4000, 0x2000]));
    const out = new Float32Array(3);
    queue.fill(out);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[1]).toBeCloseTo(-0.5, 5);
    expect(out[2]).toBeCloseTo(0.25, 5);
  });

  it("repeats samples (nearest neighbour) when the output rate is higher", () => {
    const queue = new PlaybackQueue(48000, 24000);
    queue.pushInt16(new Int16Array([0x4000, -0x4000]));
    const out = new Float32Array(5);
    queue.fill(out);
    // Read step 0.5: a pull happens every second output frame (the first
    // frame emits the initial silence sample), each pulled sample held twice.
    expect(Array.from(out).map((v) => Math.round(v * 100) / 100)).toEqual([
      0, 0.5, 0.5, -0.5, -0.5,
    ]);
  });

  it("spans chunk boundaries", () => {
    const queue = new PlaybackQueue(VOICE_WIRE_SAMPLE_RATE);
    queue.pushInt16(new Int16Array([0x4000]));
    queue.pushInt16(new Int16Array([-0x4000]));
    const out = new Float32Array(2);
    queue.fill(out);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[1]).toBeCloseTo(-0.5, 5);
  });

  it("decays toward silence on underrun instead of clicking to zero", () => {
    const queue = new PlaybackQueue(VOICE_WIRE_SAMPLE_RATE);
    queue.pushInt16(new Int16Array([0x4000]));
    const out = new Float32Array(3);
    queue.fill(out);
    expect(out[0]).toBeCloseTo(0.5, 5);
    expect(out[1]).toBeCloseTo(0.5 * 0.98, 5);
    expect(out[2]).toBeCloseTo(0.5 * 0.98 * 0.98, 5);
  });

  it("drops everything on flush (barge-in)", () => {
    const queue = new PlaybackQueue(VOICE_WIRE_SAMPLE_RATE);
    queue.pushInt16(new Int16Array([0x4000, 0x4000, 0x4000]));
    expect(queue.hasQueued()).toBe(true);
    queue.flush();
    expect(queue.hasQueued()).toBe(false);
    const out = new Float32Array(2);
    queue.fill(out);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
  });
});

describe("worklet sources stay in sync with the tested DSP", () => {
  const dir = join(__dirname, "..", "src", "voice", "worklets");
  const capture = readFileSync(join(dir, "ago-pcm-capture.worklet.js"), "utf8");
  const playback = readFileSync(join(dir, "ago-pcm-playback.worklet.js"), "utf8");

  it("register the ago-prefixed processor names", () => {
    expect(capture).toContain("registerProcessor('ago-pcm-capture-processor'");
    expect(playback).toContain("registerProcessor('ago-pcm-playback-processor'");
  });

  it("use the 24kHz wire rate and the same core formulas", () => {
    expect(capture).toContain("24000");
    expect(playback).toContain("24000");
    // Linear interpolation and PCM16 scaling in the capture path.
    expect(capture).toContain("s0 + (s1 - s0) * frac");
    expect(capture).toContain("0x7fff");
    // Underrun decay and flush handling in the playback path.
    expect(playback).toContain("0.98");
    expect(playback).toContain("flush");
  });

  it("are self-contained (no module imports)", () => {
    expect(capture).not.toMatch(/^\s*import /m);
    expect(playback).not.toMatch(/^\s*import /m);
  });
});
