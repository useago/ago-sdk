import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerVoiceCall } from "../src/remoteAssist/voice";

class FakePeerConnection extends EventTarget {
  static last: FakePeerConnection;
  iceGatheringState: RTCIceGatheringState = "new";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  closed = false;
  constructor(public config: RTCConfiguration) {
    super();
    FakePeerConnection.last = this;
  }
  addTrack() {}
  async setRemoteDescription() {
    if (FakePeerConnection.failRemote) throw new DOMException("bad offer", "InvalidAccessError");
  }
  async createAnswer() {
    return { type: "answer" as const, sdp: "v=0 answer\r\n" };
  }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = { ...description, sdp: `${description.sdp}a=candidate:relay\r\n` };
    setTimeout(() => {
      this.iceGatheringState = "complete";
      this.dispatchEvent(new Event("icegatheringstatechange"));
    });
  }
  close() {
    this.closed = true;
  }
  static failRemote = false;
}

const track = { enabled: true, stop: vi.fn() };
const options = {
  offer: "v=0 offer",
  iceServers: [{ urls: ["turn:turn.example.com:3478"] }],
  iceTransportPolicy: "relay" as RTCIceTransportPolicy,
  onConnectionState: vi.fn(),
};

describe("answerVoiceCall", () => {
  beforeEach(() => {
    FakePeerConnection.failRemote = false;
    track.enabled = true;
    track.stop.mockReset();
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })) },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("answers with every candidate gathered, through the relay servers given", async () => {
    const { answer, connection } = await answerVoiceCall(options);
    connection.setMuted(true);

    expect(answer).toBe("v=0 answer\r\na=candidate:relay\r\n");
    expect(FakePeerConnection.last.config).toEqual({
      iceServers: options.iceServers,
      iceTransportPolicy: "relay",
    });
    expect(track.enabled).toBe(false);
  });

  it("releases the microphone when the offer cannot be answered", async () => {
    FakePeerConnection.failRemote = true;

    await expect(answerVoiceCall(options)).rejects.toThrow("bad offer");

    expect(track.stop).toHaveBeenCalled();
    expect(FakePeerConnection.last.closed).toBe(true);
  });
});
