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
  iceListeners = 0;
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
  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (type === "icegatheringstatechange") this.iceListeners++;
    super.addEventListener(type, callback, options);
  }
  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    if (type === "icegatheringstatechange") this.iceListeners--;
    super.removeEventListener(type, callback, options);
  }
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

  it("settles an invitation promptly when closed during ICE gathering", async () => {
    const pc = new FakeConnection();
    pc.iceGatheringState = "gathering";
    const status = vi.fn();
    const peer = new LanPeer(status, vi.fn(), () => pc as unknown as RTCPeerConnection, 60_000);
    const invitation = peer.createOffer();
    peer.close();

    await expect(invitation).rejects.toThrow("closed");
    expect(status).toHaveBeenLastCalledWith("idle");
    expect(pc.close).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalledWith("failed");
  });

  it("settles an answer promptly when closed during setRemoteDescription", async () => {
    const pc = new FakeConnection();
    let finishRemote!: () => void;
    pc.setRemoteDescription = vi.fn(() => new Promise<void>((resolve) => (finishRemote = resolve)));
    const peer = new LanPeer(vi.fn(), vi.fn(), () => pc as unknown as RTCPeerConnection);
    const answer = peer.answerOffer(JSON.stringify({ type: "offer", sdp: "offer" }));
    await Promise.resolve();
    peer.close();

    await expect(answer).rejects.toThrow("closed");
    finishRemote();
  });

  it("ignores delayed Blob decoding after the peer is closed", async () => {
    const pc = new FakeConnection();
    const receive = vi.fn();
    const peer = new LanPeer(vi.fn(), receive, () => pc as unknown as RTCPeerConnection);
    await peer.createOffer();
    let resolveBlob!: (buffer: ArrayBuffer) => void;
    const blob = new Blob();
    vi.spyOn(blob, "arrayBuffer").mockImplementation(
      () => new Promise<ArrayBuffer>((resolve) => (resolveBlob = resolve)),
    );
    pc.channel.onmessage?.({ data: blob } as MessageEvent<unknown>);
    peer.close();
    resolveBlob(new Uint8Array([1, 2, 3, 4]).buffer);
    await Promise.resolve();

    expect(receive).not.toHaveBeenCalled();
  });

  it("does not forward stale callbacks from a replaced channel", async () => {
    const pcs = [new FakeConnection(), new FakeConnection()];
    let index = 0;
    const receive = vi.fn();
    const status = vi.fn();
    const peer = new LanPeer(status, receive, () => pcs[index++] as unknown as RTCPeerConnection);
    await peer.createOffer();
    const oldChannel = pcs[0]!.channel;
    await peer.createOffer();
    status.mockClear();
    oldChannel.onopen?.(new Event("open"));
    oldChannel.onmessage?.({ data: new Uint8Array([1, 2, 3, 4]).buffer } as MessageEvent<unknown>);

    expect(status).not.toHaveBeenCalled();
    expect(receive).not.toHaveBeenCalled();
  });

  it("closes a data channel delivered by a stale ondatachannel callback", async () => {
    const pcs = [new FakeConnection(), new FakeConnection()];
    let index = 0;
    const peer = new LanPeer(vi.fn(), vi.fn(), () => pcs[index++] as unknown as RTCPeerConnection);
    await peer.answerOffer(JSON.stringify({ type: "offer", sdp: "first" }));
    const staleCallback = pcs[0]!.ondatachannel;
    await peer.createOffer();
    const staleChannel = new FakeChannel();
    staleCallback?.({ channel: staleChannel } as unknown as RTCDataChannelEvent);

    expect(staleChannel.close).toHaveBeenCalledOnce();
    pcs[1]!.channel.readyState = "open";
    pcs[1]!.channel.onopen?.(new Event("open"));
    expect(peer.connected).toBe(true);
  });

  it("keeps the replacement ICE cancellation callback after an older gather settles", async () => {
    const pcs = [new FakeConnection(), new FakeConnection()];
    pcs[0]!.iceGatheringState = "gathering";
    pcs[1]!.iceGatheringState = "gathering";
    let index = 0;
    const peer = new LanPeer(vi.fn(), vi.fn(), () => pcs[index++] as unknown as RTCPeerConnection);
    const first = peer.createOffer();
    for (let count = 0; count < 10 && pcs[0]!.iceListeners === 0; count++) await Promise.resolve();
    expect(pcs[0]!.iceListeners).toBe(1);
    peer.close();
    const second = peer.createOffer();
    for (let count = 0; count < 10 && pcs[1]!.iceListeners === 0; count++) await Promise.resolve();
    expect(pcs[1]!.iceListeners).toBe(1);
    await first.catch(() => {});
    await Promise.resolve();
    peer.close();
    await expect(second).rejects.toThrow("closed");

    expect(pcs[0]!.iceListeners).toBe(0);
    expect(pcs[1]!.iceListeners).toBe(0);
  });

  it("does not call game exports from a stopped bridge", () => {
    const heap = new Uint8Array(32);
    const push = vi.fn(() => 0);
    const bridge = new LanIpXBridge(
      { ra2_net_buffer: () => 0, ra2_net_pop: () => 0, ra2_net_push: push },
      () => heap,
      { connected: false, bufferedAmount: 0, send: () => false },
    );
    bridge.stop();
    bridge.receive(new Uint8Array([0, 1, 0, 2]));
    expect(push).not.toHaveBeenCalled();
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
