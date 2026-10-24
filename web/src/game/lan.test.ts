import { afterEach, describe, expect, it, vi } from "vitest";
import { LanIpXBridge, LanPeer } from "./lan";

class FakeChannel {
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  binaryType: BinaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = "closed";
  });
}

class FakeConnection extends EventTarget {
  iceGatheringState: RTCIceGatheringState = "complete";
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescription | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
  channel = new FakeChannel();
  createDataChannel = vi.fn(() => this.channel as unknown as RTCDataChannel);
  createOffer = vi.fn(
    async () => ({ type: "offer", sdp: "offer-sdp" }) as RTCSessionDescriptionInit,
  );
  createAnswer = vi.fn(
    async () => ({ type: "answer", sdp: "answer-sdp" }) as RTCSessionDescriptionInit,
  );
  setLocalDescription = vi.fn(async (description?: RTCSessionDescriptionInit) => {
    if (description) {
      this.localDescription = description as RTCSessionDescription;
      this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
    }
  });
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  });
  close = vi.fn();
}

describe("LanPeer", () => {
  it("creates a host-only unordered, unreliable channel and accepts the answer", async () => {
    const pc = new FakeConnection();
    const makeConnection = vi.fn(() => pc as unknown as RTCPeerConnection);
    const status = vi.fn();
    const receive = vi.fn();
    const peer = new LanPeer(status, receive, makeConnection);

    const invitation = JSON.parse(await peer.createOffer()) as { type: string; sdp: string };
    expect(invitation).toEqual({ type: "offer", sdp: "offer-sdp" });
    expect(pc.createDataChannel).toHaveBeenCalledWith("ipx", { ordered: false, maxRetransmits: 0 });
    expect(makeConnection).toHaveBeenCalledOnce();

    await peer.acceptAnswer(JSON.stringify({ type: "answer", sdp: "answer-sdp" }));
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer-sdp" });
    expect(status).toHaveBeenLastCalledWith("connecting");

    pc.channel.readyState = "open";
    pc.channel.onopen?.(new Event("open"));
    expect(peer.connected).toBe(true);
    expect(status).toHaveBeenLastCalledWith("connected");

    const bytes = new Uint8Array([0, 42, 1, 2]).buffer;
    pc.channel.onmessage?.({ data: bytes } as MessageEvent<unknown>);
    expect(receive).toHaveBeenCalledWith(new Uint8Array(bytes));
    peer.close();
    expect(pc.close).toHaveBeenCalledOnce();
  });

  it("answers a valid invitation and rejects malformed signaling text", async () => {
    const pc = new FakeConnection();
    const peer = new LanPeer(vi.fn(), vi.fn(), () => pc as unknown as RTCPeerConnection);
    await expect(peer.answerOffer("not json")).rejects.toThrow("valid invitation text");
    expect(pc.setRemoteDescription).not.toHaveBeenCalled();

    const answer = JSON.parse(
      await peer.answerOffer(JSON.stringify({ type: "offer", sdp: "offer-sdp" })),
    ) as { type: string; sdp: string };
    expect(answer).toEqual({ type: "answer", sdp: "answer-sdp" });
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: "offer", sdp: "offer-sdp" });
  });
});

describe("LanIpXBridge", () => {
  afterEach(() => vi.useRealTimers());

  it("moves page datagrams into the game and drains game datagrams to an open peer", () => {
    vi.useFakeTimers();
    const heap = new Uint8Array(1024);
    const pointer = 32;
    const outgoing = [new Uint8Array([0, 4, 0, 7, 9, 8])];
    const exports = {
      ra2_net_buffer: () => pointer,
      ra2_net_pop: vi.fn(() => {
        const next = outgoing.shift();
        if (!next) return 0;
        heap.set(next, pointer);
        return next.length;
      }),
      ra2_net_push: vi.fn(() => 0),
    };
    const peer = { connected: true, bufferedAmount: 0, send: vi.fn(() => true) };
    const bridge = new LanIpXBridge(exports, () => heap, peer);

    bridge.receive(new Uint8Array([0, 7, 0, 4, 5, 6]));
    expect(heap.slice(pointer, pointer + 6)).toEqual(new Uint8Array([0, 7, 0, 4, 5, 6]));
    expect(exports.ra2_net_push).toHaveBeenCalledWith(6);

    bridge.start();
    vi.advanceTimersByTime(8);
    expect(peer.send).toHaveBeenCalledWith(new Uint8Array([0, 4, 0, 7, 9, 8]));
    bridge.stop();
    vi.advanceTimersByTime(32);
    expect(exports.ra2_net_pop).toHaveBeenCalledTimes(2);
  });

  it("rejects packets without a socket prefix or beyond IPX's advertised datagram size", () => {
    const error = vi.fn();
    const bridge = new LanIpXBridge(
      { ra2_net_buffer: () => 0, ra2_net_pop: () => 0, ra2_net_push: () => 0 },
      () => new Uint8Array(1024),
      { connected: false, bufferedAmount: 0, send: () => false },
      error,
    );
    bridge.receive(new Uint8Array([1]));
    bridge.receive(new Uint8Array(581));
    expect(error).toHaveBeenCalledTimes(2);
  });
});
