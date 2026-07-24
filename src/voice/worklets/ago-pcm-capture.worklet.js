// AudioWorklet processor: captures mono mic audio at the context sample rate
// (usually 48kHz), downsamples to 24kHz with linear interpolation, converts to
// little-endian PCM16, and posts ArrayBuffers to the main thread for streaming
// to the voice backend.
//
// Plain, self-contained JS: this file is loaded as a string (Vite ?raw import)
// and fed to audioWorklet.addModule() through a Blob URL, so it cannot import
// anything. The math mirrors src/voice/worklets/dsp.ts (the unit-tested
// reference); keep the two in sync.
const TARGET_RATE = 24000;

class AgoPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // sampleRate is a global available inside the AudioWorkletGlobalScope.
    this._ratio = sampleRate / TARGET_RATE;
    this._carry = 0; // fractional read position carried across render quanta
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    const outCount = Math.floor((channel.length - this._carry) / this._ratio);
    if (outCount <= 0) {
      this._carry -= channel.length;
      return true;
    }
    const out = new Int16Array(outCount);
    let pos = this._carry;
    for (let i = 0; i < outCount; i++) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s0 = channel[idx] ?? 0;
      const s1 = channel[idx + 1] ?? s0;
      const sample = Math.max(-1, Math.min(1, s0 + (s1 - s0) * frac));
      out[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      pos += this._ratio;
    }
    this._carry = pos - channel.length;

    this.port.postMessage(out.buffer, [out.buffer]);
    return true;
  }
}

registerProcessor('ago-pcm-capture-processor', AgoPcmCaptureProcessor);
