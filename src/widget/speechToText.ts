import type { AudioTranscription, TranscribeAudioOptions } from "../client/types";
import { checkIcon, closeIcon, microphoneIcon, spinnerIcon } from "./icons";
import { BRAND_COLOR, css, div, FONT_VAR, MUTED_TEXT_COLOR } from "./styles";
import { createSpeechWaveform } from "./speechWaveform";

/** Strings used by the microphone control in every widget. */
export interface SpeechToTextLabels {
  start: string;
  finish: string;
  cancel: string;
  requesting: string;
  recording: string;
  transcribing: string;
  limitApproaching: string;
  permissionDenied: string;
  recordingFailed: string;
  tooLarge: string;
  noSpeech: string;
  transcriptionFailed: string;
}

export interface SpeechToTextOptions {
  labels?: Partial<SpeechToTextLabels>;
}

export const DEFAULT_SPEECH_TO_TEXT_LABELS: SpeechToTextLabels = {
  start: "Dictate a message",
  finish: "Finish recording",
  cancel: "Cancel dictation",
  requesting: "Waiting for microphone…",
  recording: "Recording…",
  transcribing: "Transcribing…",
  limitApproaching: "Recording will finish in 10 seconds.",
  permissionDenied: "Allow microphone access in your browser to dictate a message.",
  recordingFailed: "Could not record audio. Check your microphone and try again.",
  tooLarge: "Recording is too large. Try a shorter message.",
  noSpeech: "No audio was recorded. Please try again.",
  transcriptionFailed: "Transcription failed. Please try again.",
};

interface SpeechToTextArgs {
  transcribe: (file: File, options: TranscribeAudioOptions) => Promise<AudioTranscription>;
  onText: (text: string) => void;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  labels?: Partial<SpeechToTextLabels>;
}

/** A microphone control that owns and releases its recording/upload resources. */
export function createSpeechToText(args: SpeechToTextArgs) {
  let labels = { ...DEFAULT_SPEECH_TO_TEXT_LABELS, ...args.labels };
  const el = div({ display: "none", alignItems: "center", minWidth: "0", gap: "4px", flex: "1" });
  el.className = "ago-chat-input__speech";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ago-chat-input__microphone";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.append(closeIcon({ size: 18 }));
  for (const control of [button, cancelButton]) {
    css(control, {
      width: "44px", height: "44px", border: "none", borderRadius: "50%",
      background: "transparent", color: BRAND_COLOR, cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: "0",
    });
  }
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  css(status, { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clipPath: "inset(50%)", fontFamily: FONT_VAR });
  const waveform = createSpeechWaveform();
  const waveSlot = div({ flex: "1", minWidth: "0", padding: "0 8px" });
  waveSlot.append(waveform.canvas);
  const elapsed = document.createElement("span");
  elapsed.setAttribute("aria-hidden", "true");
  css(elapsed, { fontFamily: FONT_VAR, fontSize: "12px", color: MUTED_TEXT_COLOR, fontVariantNumeric: "tabular-nums" });
  el.append(waveSlot, elapsed, status, cancelButton, button);

  let enabled = false;
  let disabled = false;
  let destroyed = false;
  let state: "idle" | "requesting" | "recording" | "transcribing" = "idle";
  let generation = 0;
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let elapsedTimer: ReturnType<typeof setInterval> | undefined;
  let seconds = 0;
  let spinnerAnimation: Animation | undefined;

  function supported(): boolean {
    return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  function render(): void {
    spinnerAnimation?.cancel();
    spinnerAnimation = undefined;
    el.style.display = enabled && supported() ? "flex" : "none";
    button.disabled = disabled || state === "requesting" || state === "transcribing";
    button.style.opacity = button.disabled ? "0.5" : "1";
    const recording = state === "recording";
    const busy = state !== "idle";
    el.style.flex = busy ? "1" : "0 0 auto";
    const label = recording ? labels.finish : state === "requesting" ? labels.requesting
      : state === "transcribing" ? labels.transcribing : labels.start;
    button.setAttribute("aria-label", label);
    button.title = label;
    const icon = recording ? checkIcon({ size: 20 }) : busy ? spinnerIcon({ size: 20 }) : microphoneIcon({ size: 20 });
    if (busy && !recording && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      spinnerAnimation = icon.animate?.([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 800, iterations: Infinity });
    }
    button.replaceChildren(icon);
    cancelButton.setAttribute("aria-label", labels.cancel);
    cancelButton.title = labels.cancel;
    cancelButton.style.display = state === "idle" ? "none" : "flex";
    waveSlot.style.display = busy ? "block" : "none";
    elapsed.style.display = recording ? "inline" : "none";
    elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    status.textContent = recording ? labels.recording
      : state === "transcribing" ? labels.transcribing
      : state === "requesting" ? labels.requesting : "";
  }

  function stopTracks(): void {
    waveform.stop();
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (elapsedTimer) clearInterval(elapsedTimer);
    elapsedTimer = undefined;
  }

  function cancel(): void {
    generation++;
    controller?.abort();
    controller = undefined;
    const active = recorder;
    recorder = undefined;
    if (active && active.state !== "inactive") active.stop();
    stopTracks();
    waveform.reset();
    seconds = 0;
    state = "idle";
    args.onBusy(false);
    render();
  }

  function fail(message: string): void {
    cancel();
    args.onError(message);
  }

  async function start(): Promise<void> {
    if (!enabled || disabled || destroyed || state !== "idle" || !supported()) return;
    const run = ++generation;
    state = "requesting";
    args.onBusy(true);
    render();
    cancelButton.focus();
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (run !== generation || destroyed) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(acquired, mimeType ? { mimeType } : undefined);
      recorder = active;
      const chunks: Blob[] = [];
      let bytes = 0;
      active.ondataavailable = (event) => {
        if (run !== generation || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > 25_000_000) {
          fail(labels.tooLarge);
          return;
        }
        chunks.push(event.data);
      };
      active.onerror = () => {
        if (run === generation) fail(labels.recordingFailed);
      };
      active.onstop = () => {
        if (run !== generation) return;
        stopTracks();
        recorder = undefined;
        void upload(chunks, active.mimeType || mimeType || "", run);
      };
      active.start(1000);
      state = "recording";
      render();
      waveform.start(acquired);
      button.focus();
      const startedAt = Date.now();
      elapsedTimer = setInterval(() => {
        seconds = Math.floor((Date.now() - startedAt) / 1000);
        elapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
        if (seconds === 110) status.textContent = labels.limitApproaching;
      }, 1000);
      // Bound the recording even if the visitor forgets to finish it.
      timer = setTimeout(() => {
        if (active.state === "recording") active.stop();
      }, 120_000);
    } catch (error) {
      if (run !== generation) return;
      fail(typeof error === "object" && error !== null && "name" in error && error.name === "NotAllowedError"
        ? labels.permissionDenied : labels.recordingFailed);
    }
  }

  async function upload(chunks: Blob[], mimeType: string, run: number): Promise<void> {
    const extension = mimeType.includes("mp4") ? "mp4" : mimeType.includes("webm") ? "webm"
      : mimeType.includes("ogg") ? "ogg" : undefined;
    if (!extension || chunks.length === 0) {
      fail(labels.noSpeech);
      return;
    }
    state = "transcribing";
    render();
    cancelButton.focus();
    controller = new AbortController();
    try {
      const { text } = await args.transcribe(
        new File(chunks, `recording.${extension}`, { type: mimeType }),
        { signal: controller.signal },
      );
      if (run !== generation || destroyed) return;
      cancel();
      if (text.trim()) args.onText(text.trim());
      else args.onError(labels.noSpeech);
    } catch (error) {
      if (run !== generation || destroyed) return;
      fail(error instanceof Error ? error.message : labels.transcriptionFailed);
    }
  }

  button.addEventListener("click", () => {
    if (state === "recording") {
      if (recorder?.state === "recording") recorder.stop();
    }
    else void start();
  });
  cancelButton.addEventListener("click", cancel);
  el.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state !== "idle") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  });
  const onVisibilityChange = () => { if (document.hidden) cancel(); };
  document.addEventListener("visibilitychange", onVisibilityChange);
  render();

  return {
    el,
    cancel,
    setLabels(value?: Partial<SpeechToTextLabels>) { labels = { ...DEFAULT_SPEECH_TO_TEXT_LABELS, ...value }; render(); },
    setEnabled(value: boolean) { enabled = value; if (!value) cancel(); render(); },
    setDisabled(value: boolean) { disabled = value; if (value) cancel(); render(); },
    destroy() {
      destroyed = true;
      cancel();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
