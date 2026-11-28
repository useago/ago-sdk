/** Browser half of a remote-assistance voice call: microphone, WebRTC answer, remote audio. */
import { AgoError } from "../client/errors";

/** The server relays one offer and one answer, so the answer waits for its ICE candidates, up to this long. */
export const ICE_GATHERING_TIMEOUT_MS = 4_000;

export interface VoiceConnection {
  setMuted(muted: boolean): void;
  close(): void;
}

export interface AnswerCallOptions {
  offer: string;
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
  onConnectionState: (state: RTCPeerConnectionState) => void;
}

export function canAnswerVoiceCalls(): boolean {
  return (
    typeof RTCPeerConnection !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

function gatheredDescription(pc: RTCPeerConnection, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const done = (): void => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      const sdp = pc.localDescription?.sdp;
      if (sdp) resolve(sdp);
      else reject(new AgoError("The browser produced no call description.", "remote_assist_voice_failed"));
    };
    const onChange = (): void => {
      if (pc.iceGatheringState === "complete") done();
    };
    // Past the timeout, the candidates gathered so far usually include the relay: answer with them.
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
    onChange();
  });
}

/** Open the microphone and answer the agent's offer. Rejects with the browser's error (e.g. `NotAllowedError`). */
export async function answerVoiceCall(
  options: AnswerCallOptions,
  timeoutMs = ICE_GATHERING_TIMEOUT_MS,
): Promise<{ answer: string; connection: VoiceConnection }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const pc = new RTCPeerConnection({
    iceServers: options.iceServers,
    iceTransportPolicy: options.iceTransportPolicy,
  });
  const audio = new Audio();
  audio.autoplay = true;
  const connection: VoiceConnection = {
    setMuted: (muted) => stream.getAudioTracks().forEach((track) => (track.enabled = !muted)),
    close: () => {
      pc.close();
      stream.getTracks().forEach((track) => track.stop());
      audio.srcObject = null;
    },
  };
  try {
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.addEventListener("track", (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => undefined);
    });
    pc.addEventListener("connectionstatechange", () => options.onConnectionState(pc.connectionState));
    await pc.setRemoteDescription({ type: "offer", sdp: options.offer });
    await pc.setLocalDescription(await pc.createAnswer());
    return { answer: await gatheredDescription(pc, timeoutMs), connection };
  } catch (error) {
    connection.close();
    throw error;
  }
}
