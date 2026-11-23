export type LanStatus = "idle" | "preparing" | "waiting" | "connecting" | "connected" | "failed";

const PACKET_MAX = 580; // two 2-byte IPX sockets plus the game's 576-byte datagram
const BRIDGE_POLL_MS = 8;
const MAX_PACKETS_PER_POLL = 32;

function parseDescription(text: string, expected: RTCSdpType): RTCSessionDescriptionInit {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid invitation text.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("type" in value) ||
    value.type !== expected ||
    !("sdp" in value) ||
    typeof value.sdp !== "string"
  ) {
    throw new Error(`Expected a WebRTC ${expected}.`);
  }
  return { type: expected, sdp: value.sdp };
}

function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs: number,
  registerCancel: (cancel: () => void) => void,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "LAN candidates did not finish gathering. Try again on the same local network.",
          ),
        ),
      timeoutMs,
    );
    registerCancel(() => finish(new Error("LAN pairing attempt was closed.")));
    pc.addEventListener("icegatheringstatechange", check);
    check();
  });
}

/** A one-peer, host-candidate-only WebRTC connection for browser LAN play. */
export class LanPeer {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private generation = 0;
  private cancelGathering: (() => void) | null = null;
  private cancellation: { promise: Promise<void>; cancel: () => void } | null = null;

  constructor(
    private readonly onStatus: (status: LanStatus) => void,
    private readonly onPacket: (packet: Uint8Array) => void,
    private readonly createConnection = () => new RTCPeerConnection({ iceServers: [] }),
    private readonly iceTimeoutMs = 30_000,
  ) {}

  get connected(): boolean {
    return this.channel?.readyState === "open";
  }

  get bufferedAmount(): number {
    return this.channel?.bufferedAmount ?? 0;
  }

  send(packet: Uint8Array): boolean {
    const channel = this.channel;
    if (!channel || channel.readyState !== "open" || channel.bufferedAmount > 256 * 1024)
      return false;
    const copy = new ArrayBuffer(packet.byteLength);
    new Uint8Array(copy).set(packet);
    channel.send(copy);
    return true;
  }

  async createOffer(): Promise<string> {
    const generation = this.beginAttempt();
    this.onStatus("preparing");
    try {
      const pc = this.openConnection();
      const channel = pc.createDataChannel("ipx", { ordered: false, maxRetransmits: 0 });
      this.attachChannel(channel, generation);
      const offer = await this.awaitCurrent(pc.createOffer(), generation);
      await this.awaitCurrent(pc.setLocalDescription(offer), generation);
      await this.gather(pc, generation);
      this.assertCurrent(generation);
      if (!pc.localDescription?.sdp)
        throw new Error("The browser did not create a LAN invitation.");
      this.onStatus("waiting");
      return JSON.stringify({ type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.disposeConnection();
        this.onStatus("failed");
      }
      throw error;
    }
  }

  async answerOffer(text: string): Promise<string> {
    const generation = this.beginAttempt();
    this.onStatus("preparing");
    try {
      const offer = parseDescription(text, "offer");
      const pc = this.openConnection();
      pc.ondatachannel = (event) => this.attachChannel(event.channel, generation);
      await this.awaitCurrent(pc.setRemoteDescription(offer), generation);
      const answer = await this.awaitCurrent(pc.createAnswer(), generation);
      await this.awaitCurrent(pc.setLocalDescription(answer), generation);
      await this.gather(pc, generation);
      this.assertCurrent(generation);
      if (!pc.localDescription?.sdp) throw new Error("The browser did not create a LAN answer.");
      this.onStatus("waiting");
      return JSON.stringify({ type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.disposeConnection();
        this.onStatus("failed");
      }
      throw error;
    }
  }

  async acceptAnswer(text: string): Promise<void> {
    const pc = this.pc;
    if (!pc || pc.signalingState !== "have-local-offer") {
      throw new Error("Create an invitation first, then paste the other player's answer.");
    }
    const answer = parseDescription(text, "answer");
    const generation = this.generation;
    try {
      await this.awaitCurrent(pc.setRemoteDescription(answer), generation);
      this.onStatus("connecting");
    } catch (error) {
      if (this.isCurrent(generation)) this.onStatus("failed");
      throw error;
    }
  }

  close(): void {
    this.generation++;
    this.disposeConnection();
    this.onStatus("idle");
  }

  private beginAttempt(): number {
    this.generation++;
    this.disposeConnection();
    let cancel!: () => void;
    const promise = new Promise<void>((resolve) => {
      cancel = resolve;
    });
    this.cancellation = { promise, cancel };
    return this.generation;
  }

  private async awaitCurrent<T>(promise: PromiseLike<T>, generation: number): Promise<T> {
    const cancellation = this.cancellation;
    const result = await Promise.race([
      Promise.resolve(promise).then((value) => ({ value }) as const),
      cancellation?.promise.then(() => ({ cancelled: true }) as const),
    ]);
    this.assertCurrent(generation);
    if ("cancelled" in (result ?? {})) throw new Error("LAN pairing attempt was closed.");
    return (result as { value: T }).value;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new Error("LAN pairing attempt was closed.");
  }

  private async gather(pc: RTCPeerConnection, generation: number): Promise<void> {
    let ownedCancel: (() => void) | null = null;
    const promise = waitForIceGathering(pc, this.iceTimeoutMs, (cancel) => {
      ownedCancel = cancel;
      this.cancelGathering = cancel;
    });
    try {
      await this.awaitCurrent(promise, generation);
      this.assertCurrent(generation);
    } finally {
      if (this.cancelGathering === ownedCancel) this.cancelGathering = null;
    }
  }

  private openConnection(): RTCPeerConnection {
    const pc = this.createConnection();
    this.pc = pc;
    const generation = this.generation;
    pc.onconnectionstatechange = () => {
      if (!this.isCurrent(generation)) return;
      if (pc.connectionState === "failed") this.onStatus("failed");
      else if (pc.connectionState === "disconnected") this.onStatus("waiting");
      else if (
        pc.connectionState === "connecting" ||
        (pc.connectionState === "connected" && !this.connected)
      )
        this.onStatus("connecting");
    };
    return pc;
  }

  private attachChannel(channel: RTCDataChannel, generation: number): void {
    if (!this.isCurrent(generation)) {
      channel.close();
      return;
    }
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      if (this.isCurrent(generation) && this.channel === channel) this.onStatus("connected");
    };
    channel.onclose = () => {
      if (this.isCurrent(generation) && this.channel === channel) this.onStatus("waiting");
    };
    channel.onerror = () => {
      if (this.isCurrent(generation) && this.channel === channel) this.onStatus("failed");
    };
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!this.isCurrent(generation) || this.channel !== channel) return;
      if (event.data instanceof ArrayBuffer) this.onPacket(new Uint8Array(event.data));
      else if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((bytes) => {
          if (this.isCurrent(generation) && this.channel === channel)
            this.onPacket(new Uint8Array(bytes));
        });
      }
    };
  }

  private disposeConnection(): void {
    this.cancellation?.cancel();
    this.cancellation = null;
    this.cancelGathering?.();
    this.cancelGathering = null;
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onclose = null;
      this.channel.onerror = null;
      this.channel.onmessage = null;
    }
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.ondatachannel = null;
    }
    this.channel?.close();
    this.channel = null;
    this.pc?.close();
    this.pc = null;
  }
}

export interface LanBridgeExports {
  ra2_net_buffer(): number;
  ra2_net_pop(capacity: number): number;
  ra2_net_push(length: number): number;
}

/** Moves IPX datagrams between the HLE queues and the browser-owned data channel. */
export class LanIpXBridge {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly packetBuffer: number;
  private stopped = false;

  constructor(
    private readonly exports: LanBridgeExports,
    private readonly heap: () => Uint8Array,
    private readonly peer: Pick<LanPeer, "connected" | "bufferedAmount" | "send">,
    private readonly onError: (message: string) => void = () => {},
  ) {
    this.packetBuffer = exports.ra2_net_buffer();
  }

  start(): void {
    if (this.timer !== null) return;
    this.stopped = false;
    this.timer = setInterval(() => this.pump(), BRIDGE_POLL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  receive(packet: Uint8Array): void {
    if (this.stopped) return;
    if (packet.byteLength < 4 || packet.byteLength > PACKET_MAX) {
      this.onError("Ignored an invalid LAN IPX datagram.");
      return;
    }
    try {
      this.heap().set(packet, this.packetBuffer);
      if (this.exports.ra2_net_push(packet.byteLength) !== 0)
        this.onError("The game's LAN receive queue is full; a datagram was dropped.");
    } catch (error) {
      this.onError(error instanceof Error ? error.message : String(error));
    }
  }

  private pump(): void {
    if (this.stopped) return;
    try {
      const heap = this.heap();
      // Keep the HLE queue from filling while waiting for a peer; discovery
      // datagrams sent before the connection opens are intentionally dropped.
      for (let count = 0; count < MAX_PACKETS_PER_POLL; count++) {
        if (this.peer.connected && this.peer.bufferedAmount > 256 * 1024) return;
        const length = this.exports.ra2_net_pop(PACKET_MAX);
        if (length <= 0) return;
        if (!this.peer.connected) continue;
        const packet = heap.slice(this.packetBuffer, this.packetBuffer + length);
        if (!this.peer.send(packet)) return;
      }
    } catch (error) {
      this.onError(error instanceof Error ? error.message : String(error));
      this.stop();
    }
  }
}
