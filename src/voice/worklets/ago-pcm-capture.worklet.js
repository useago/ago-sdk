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
// Send 20 ms PCM packets instead of one packet per 128-frame render quantum.
// At a 48 kHz context this reduces main-thread/WebSocket work from ~375 to
// 50 messages per second while staying well below conversational latency.
const BATCH_SAMPLES = 480;

class AgoPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // sampleRate is a global available inside the AudioWorkletGlobalScope.
    this._ratio = sampleRate / TARGET_RATE;
    this._carry = 0; // fractional read position carried across render quanta
    this._previousSample = undefined;
    this._batch = new Int16Array(BATCH_SAMPLES);
    this._batchLength = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    let pos = this._carry;
    while (true) {
      let s0;
      let s1;
      let frac;

      if (pos < 0) {
        if (this._previousSample === undefined || pos < -1) break;
        s0 = this._previousSample;
        s1 = channel[0];
        frac = pos + 1;
      } else {
        if (pos >= channel.length) break;
        const idx = Math.floor(pos);
        frac = pos - idx;
        s0 = channel[idx];
        // Wait for the next render quantum when interpolation crosses the
        // boundary; substituting zero here corrupts 44.1kHz capture.
        if (idx + 1 >= channel.length && frac > 0) break;
        s1 = channel[idx + 1] ?? s0;
      }

      const sample = Math.max(-1, Math.min(1, s0 + (s1 - s0) * frac));
      this._batch[this._batchLength++] =
        sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      if (this._batchLength === BATCH_SAMPLES) {
        const out = this._batch;
        this._batch = new Int16Array(BATCH_SAMPLES);
        this._batchLength = 0;
        this.port.postMessage(out.buffer, [out.buffer]);
      }
      pos += this._ratio;
    }
    this._carry = pos - channel.length;
    this._previousSample = channel[channel.length - 1];

    return true;
  }
}

registerProcessor("ago-pcm-capture-processor", AgoPcmCaptureProcessor);
