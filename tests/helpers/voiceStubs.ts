import { vi } from "vitest";
import type { HttpClient } from "../../src/api/HttpClient";

export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = 0;
  binaryType = "";
  sent: string[] = [];
  closeCalled = false;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalled = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emitFrame(frame: Record<string, unknown> | string): void {
    this.onmessage?.({
      data: typeof frame === "string" ? frame : JSON.stringify(frame),
    });
  }

  emitClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  emitError(): void {
    this.onerror?.();
  }

  /** Parsed frames this socket received from the client. */
  sentFrames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

export class FakeMediaStreamTrack {
  kind = "audio";
  enabled = true;
  stopped = false;
  onended: (() => void) | null = null;

  stop(): void {
    this.stopped = true;
  }
}

export class FakeMediaStream {
  tracks: FakeMediaStreamTrack[];

  constructor(trackCount = 1) {
    this.tracks = Array.from({ length: trackCount }, () => new FakeMediaStreamTrack());
  }

  getTracks(): FakeMediaStreamTrack[] {
    return this.tracks;
  }

  getAudioTracks(): FakeMediaStreamTrack[] {
    return this.tracks;
  }
}

export class FakeAudioWorkletNode {
  static instances: FakeAudioWorkletNode[] = [];
  name: string;
  port: {
    onmessage: ((ev: { data: ArrayBuffer }) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  } = { onmessage: null, postMessage: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();

  constructor(_ctx: unknown, name: string) {
    this.name = name;
    FakeAudioWorkletNode.instances.push(this);
  }
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  /** When set, the next created context uses this addModule implementation. */
  static nextAddModuleImpl: ((url: string) => Promise<void>) | null = null;
  state = "running";
  sampleRate = 48000;
  destination = {};
  audioWorklet = { addModule: vi.fn(async (_url: string) => undefined) };
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  resume = vi.fn(async () => {
    this.state = "running";
  });

  constructor() {
    FakeAudioContext.instances.push(this);
    if (FakeAudioContext.nextAddModuleImpl) {
      this.audioWorklet.addModule = vi.fn(FakeAudioContext.nextAddModuleImpl);
    }
  }

  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
}

export interface VoiceStubs {
  getUserMedia: ReturnType<typeof vi.fn>;
  lastStream: () => FakeMediaStream;
  lastSocket: () => FakeWebSocket;
  lastContext: () => FakeAudioContext;
  captureNode: () => FakeAudioWorkletNode;
  playbackNode: () => FakeAudioWorkletNode;
  /** Push one mic PCM16 buffer through the capture worklet port. */
  sendMicFrame: (samples: Int16Array) => void;
  setSecureContext: (secure: boolean) => void;
  restore: () => void;
}

export function installVoiceStubs(): VoiceStubs {
  FakeWebSocket.instances = [];
  FakeAudioContext.instances = [];
  FakeAudioContext.nextAddModuleImpl = null;
  FakeAudioWorkletNode.instances = [];

  const streams: FakeMediaStream[] = [];
  const getUserMedia = vi.fn(async () => {
    const stream = new FakeMediaStream();
    streams.push(stream);
    return stream;
  });

  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode);

  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => `blob:ago-test-${Math.random()}`);
  URL.revokeObjectURL = vi.fn();

  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });

  const originalSecure = Object.getOwnPropertyDescriptor(
    window,
    "isSecureContext"
  );
  const setSecureContext = (secure: boolean) => {
    Object.defineProperty(window, "isSecureContext", {
      value: secure,
      configurable: true,
    });
  };
  setSecureContext(true);

  return {
    getUserMedia,
    lastStream: () => streams[streams.length - 1],
    lastSocket: () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1],
    lastContext: () =>
      FakeAudioContext.instances[FakeAudioContext.instances.length - 1],
    captureNode: () =>
      FakeAudioWorkletNode.instances.find((n) =>
        n.name.includes("capture")
      ) as FakeAudioWorkletNode,
    playbackNode: () =>
      FakeAudioWorkletNode.instances.find((n) =>
        n.name.includes("playback")
      ) as FakeAudioWorkletNode,
    sendMicFrame: (samples: Int16Array) => {
      const capture = FakeAudioWorkletNode.instances.find((n) =>
        n.name.includes("capture")
      );
      capture?.port.onmessage?.({ data: samples.buffer as ArrayBuffer });
    },
    setSecureContext,
    restore: () => {
      vi.unstubAllGlobals();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
      if (originalSecure) {
        Object.defineProperty(window, "isSecureContext", originalSecure);
      } else {
        delete (window as { isSecureContext?: unknown }).isSecureContext;
      }
    },
  };
}

/** Minimal HttpClient double for the voice API surface. */
export class FakeHttp {
  post = vi.fn(
    async (
      _path: string,
      _body?: unknown
    ): Promise<Record<string, unknown>> => ({
      token: "tok-1",
      wsUrl: "wss://voice.test/v1/voice",
    })
  );
  get = vi.fn(async (): Promise<Record<string, unknown>> => ({}));
  refreshUserJwt = vi.fn(async () => false);
  hasBearerToken = vi.fn(() => true);

  asHttpClient(): HttpClient {
    return this as unknown as HttpClient;
  }
}

/** A loud PCM16 buffer (level well above the speaking threshold). */
export function loudFrame(length = 480): Int16Array {
  return new Int16Array(length).fill(16000);
}

/** A silent PCM16 buffer. */
export function quietFrame(length = 480): Int16Array {
  return new Int16Array(length);
}
