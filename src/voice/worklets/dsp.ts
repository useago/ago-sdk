/**
 * Pure DSP functions mirrored by the audio worklet sources in this directory.
 *
 * The worklet files run inside an AudioWorkletGlobalScope and cannot import
 * modules, so they carry their own copy of this math. These exports are the
 * unit-tested reference: keep the formulas in the `.worklet.js` files
 * identical to the ones here.
 */

/** Wire sample rate of the voice protocol (PCM16 mono). */
export const VOICE_WIRE_SAMPLE_RATE = 24000;

/** Clamp a float sample to [-1, 1] and scale to a signed 16-bit integer. */
export function floatToInt16(sample: number): number {
  const s = Math.max(-1, Math.min(1, sample));
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}

export interface DownsampleResult {
  samples: Int16Array;
  /** Fractional read position to carry into the next input block. */
  carry: number;
}

/**
 * Linear-interpolation downsampler: one block of float samples at the source
 * rate to Int16 at the target rate. `ratio` is sourceRate / targetRate (2 for
 * 48kHz to 24kHz). `carry` is the fractional read position left over from the
 * previous block, so resampling stays continuous across render quanta.
 */
export function downsampleToInt16(
  input: Float32Array,
  ratio: number,
  carry: number
): DownsampleResult {
  const outCount = Math.floor((input.length - carry) / ratio);
  if (outCount <= 0) {
    return { samples: new Int16Array(0), carry: carry - input.length };
  }
  const out = new Int16Array(outCount);
  let pos = carry;
  for (let i = 0; i < outCount; i++) {
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[idx + 1] ?? s0;
    out[i] = floatToInt16(s0 + (s1 - s0) * frac);
    pos += ratio;
  }
  return { samples: out, carry: pos - input.length };
}

/**
 * Normalized RMS level of a PCM16 block, scaled (x3, clamped to 1) so normal
 * speech fills a usable range of the level meter.
 */
export function rmsLevel(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 0x8000;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 3);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Playback queue math of the playback worklet: buffers PCM16 chunks at the
 * wire rate, resamples nearest-neighbour to the output rate, decays toward
 * silence on underrun (no DC click), and drops everything on flush (barge-in).
 */
export class PlaybackQueue {
  private queue: Float32Array[] = [];
  private chunk: Float32Array | null = null;
  private chunkPos = 0;
  private readPos = 0;
  private lastSample = 0;
  /** Read step through wire-rate data per output frame: wireRate / outputRate. */
  private readonly ratio: number;

  constructor(outputSampleRate: number, wireSampleRate = VOICE_WIRE_SAMPLE_RATE) {
    this.ratio = wireSampleRate / outputSampleRate;
  }

  /** Queue one PCM16 chunk (converted to float once, on arrival). */
  pushInt16(chunk: Int16Array): void {
    const f = new Float32Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) f[i] = chunk[i] / 0x8000;
    this.queue.push(f);
  }

  /** Drop all queued audio instantly (barge-in). */
  flush(): void {
    this.queue = [];
    this.chunk = null;
    this.chunkPos = 0;
    this.readPos = 0;
  }

  /** Whether any queued audio remains to be played. */
  hasQueued(): boolean {
    return (
      this.queue.length > 0 ||
      (this.chunk !== null && this.chunkPos < this.chunk.length)
    );
  }

  private nextSample(): number | null {
    while (this.chunk === null || this.chunkPos >= this.chunk.length) {
      const next = this.queue.shift();
      if (next === undefined) return null;
      this.chunk = next;
      this.chunkPos = 0;
    }
    return this.chunk[this.chunkPos++];
  }

  /** Fill one output block at the output rate from the queued wire-rate audio. */
  fill(output: Float32Array): void {
    for (let i = 0; i < output.length; i++) {
      this.readPos += this.ratio;
      while (this.readPos >= 1) {
        const s = this.nextSample();
        this.lastSample = s !== null ? s : this.lastSample * 0.98;
        this.readPos -= 1;
      }
      output[i] = this.lastSample;
    }
  }
}
