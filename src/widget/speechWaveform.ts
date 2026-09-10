import { css, MUTED_TEXT_COLOR } from "./styles";

/** The recent microphone volume, sampled at 20 Hz without updating chat state. */
export function createSpeechWaveform() {
  const canvas = document.createElement("canvas");
  canvas.className = "ago-chat-input__waveform";
  canvas.setAttribute("aria-hidden", "true");
  css(canvas, { width: "100%", height: "40px", display: "block", color: MUTED_TEXT_COLOR });
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let frame: number | undefined;
  let observer: ResizeObserver | undefined;
  let drawing: CanvasRenderingContext2D | null = null;
  let samples: number[] = [];
  let width = 0;

  function draw(): void {
    if (!drawing) return;
    drawing.clearRect(0, 0, width, 40);
    drawing.fillStyle = getComputedStyle(canvas).color;
    const count = Math.min(300, Math.floor(width / 4));
    for (let index = 0; index < count; index++) {
      const level = samples[samples.length - count + index] ?? 0;
      const height = 2 + level * 30;
      drawing.globalAlpha = level > 0.02 ? 0.85 : 0.3;
      drawing.fillRect(index * 4, (40 - height) / 2, 2, height);
    }
  }

  function resize(): void {
    width = canvas.clientWidth;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = 40 * scale;
    drawing?.setTransform(scale, 0, 0, scale, 0, 0);
    draw();
  }

  function stop(): void {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    observer?.disconnect();
    observer = undefined;
    source?.disconnect();
    source = undefined;
    analyser?.disconnect();
    analyser = undefined;
    if (context && context.state !== "closed") void context.close().catch(() => {});
    context = undefined;
  }

  function start(stream: MediaStream): void {
    stop();
    samples = [];
    // Metering is optional. Unsupported browsers can still record and upload.
    if (typeof AudioContext === "undefined") return;
    try {
      drawing = canvas.getContext("2d");
      if (!drawing) return;
      resize();
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(resize);
        observer.observe(canvas);
      }
      // Keep a static baseline for users who ask to reduce animation.
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      // Only the analyser receives the signal; never connect to speakers.
      source.connect(analyser);
      if (context.state === "suspended") void context.resume().catch(() => {});
      const data = new Uint8Array(analyser.fftSize);
      let lastSampleAt = 0;
      const sample = (timestamp: number) => {
        if (!analyser) return;
        if (timestamp - lastSampleAt >= 50) {
          lastSampleAt = timestamp;
          analyser.getByteTimeDomainData(data);
          let power = 0;
          for (const value of data) power += ((value - 128) / 128) ** 2;
          samples.push(Math.min(1, Math.sqrt(power / data.length) * 4));
          if (samples.length > 300) samples.shift();
          draw();
        }
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    } catch {
      stop();
    }
  }

  return {
    canvas,
    start,
    stop,
    reset() { stop(); samples = []; draw(); },
  };
}
