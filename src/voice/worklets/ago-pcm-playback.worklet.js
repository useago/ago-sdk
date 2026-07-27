// AudioWorklet processor: plays agent audio. Receives little-endian PCM16
// chunks at 24kHz over the port, resamples nearest-neighbour to the context
// sample rate, and streams them out. A 'flush' message drops all queued audio
// instantly; that is how barge-in stops the agent from talking over the user.
//
// Plain, self-contained JS: this file is loaded as a string (Vite ?raw import)
// and fed to audioWorklet.addModule() through a Blob URL, so it cannot import
// anything. The queue math mirrors PlaybackQueue in
// src/voice/worklets/dsp.ts (the unit-tested reference); keep the two in sync.
const SOURCE_RATE = 24000;

class AgoPcmPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = []; // Float32Array chunks at SOURCE_RATE
    this._chunk = null;
    this._chunkPos = 0;
    this._ratio = SOURCE_RATE / sampleRate; // read step through 24kHz data per output frame
    this._readPos = 0;
    this._lastSample = 0;
    this._playing = false;
    this._endRequested = false;
    this.port.onmessage = (e) => {
      if (e.data === "flush" || (e.data && e.data.type === "flush")) {
        this._queue = [];
        this._chunk = null;
        this._chunkPos = 0;
        this._readPos = 0;
        this._playing = false;
        this._endRequested = false;
        return;
      }
      if (e.data && e.data.type === "end") {
        this._endRequested = true;
        return;
      }
      // Int16 PCM buffer to Float32 [-1, 1]
      const int16 = new Int16Array(e.data);
      const f = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) f[i] = int16[i] / 0x8000;
      this._queue.push(f);
      this._playing = true;
      this._endRequested = false;
    };
  }

  _nextSample() {
    // Pull the next 24kHz sample, advancing through queued chunks.
    while (this._chunk === null || this._chunkPos >= this._chunk.length) {
      if (this._queue.length === 0) {
        if (this._playing && this._endRequested) {
          this._playing = false;
          this._endRequested = false;
          this._lastSample = 0;
          this.port.postMessage({ type: "drained" });
        }
        return null;
      }
      this._chunk = this._queue.shift();
      this._chunkPos = 0;
    }
    return this._chunk[this._chunkPos++];
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const channel = output[0];

    for (let i = 0; i < channel.length; i++) {
      // Nearest-neighbour resample from 24kHz to the context rate. Adequate
      // for speech and keeps the worklet cheap. On underrun (null), decay
      // toward silence to avoid a DC click.
      this._readPos += this._ratio;
      while (this._readPos >= 1) {
        const s = this._nextSample();
        this._lastSample = s !== null ? s : this._lastSample * 0.98;
        this._readPos -= 1;
      }
      channel[i] = this._lastSample;
    }
    // Mono: copy to any other output channels.
    for (let c = 1; c < output.length; c++) output[c].set(channel);
    return true;
  }
}

registerProcessor("ago-pcm-playback-processor", AgoPcmPlaybackProcessor);
