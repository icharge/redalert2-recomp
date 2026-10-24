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

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", finish);
      resolve();
    };
    const timer = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", finish);
      reject(
        new Error("LAN candidates did not finish gathering. Try again on the same local network."),
      );
    }, timeoutMs);
    pc.addEventListener("icegatheringstatechange", finish);
    finish();
  });
}

/** A one-peer, host-candidate-only WebRTC connection for browser LAN play. */
export class LanPeer {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;

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
    this.reset();
    this.onStatus("preparing");
    try {
      const pc = this.openConnection();
      const channel = pc.createDataChannel("ipx", { ordered: false, maxRetransmits: 0 });
      this.attachChannel(channel);
      await pc.setLocalDescription(await pc.createOffer());
      await waitForIceGathering(pc, this.iceTimeoutMs);
      if (!pc.localDescription?.sdp)
        throw new Error("The browser did not create a LAN invitation.");
      this.onStatus("waiting");
      return JSON.stringify({ type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    } catch (error) {
      this.reset();
      this.onStatus("failed");
      throw error;
    }
  }

  async answerOffer(text: string): Promise<string> {
    const offer = parseDescription(text, "offer");
    this.reset();
    this.onStatus("preparing");
    try {
      const pc = this.openConnection();
      pc.ondatachannel = (event) => this.attachChannel(event.channel);
      await pc.setRemoteDescription(offer);
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForIceGathering(pc, this.iceTimeoutMs);
      if (!pc.localDescription?.sdp) throw new Error("The browser did not create a LAN answer.");
      this.onStatus("waiting");
      return JSON.stringify({ type: pc.localDescription.type, sdp: pc.localDescription.sdp });
    } catch (error) {
      this.reset();
      this.onStatus("failed");
      throw error;
    }
  }

  async acceptAnswer(text: string): Promise<void> {
    const pc = this.pc;
    if (!pc || pc.signalingState !== "have-local-offer") {
      throw new Error("Create an invitation first, then paste the other player's answer.");
    }
    const answer = parseDescription(text, "answer");
    try {
      await pc.setRemoteDescription(answer);
      this.onStatus("connecting");
    } catch (error) {
      this.onStatus("failed");
      throw error;
    }
  }

  close(): void {
    this.reset();
    this.onStatus("idle");
  }

  private openConnection(): RTCPeerConnection {
    const pc = this.createConnection();
    this.pc = pc;
    pc.onconnectionstatechange = () => {
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

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => this.onStatus("connected");
    channel.onclose = () => this.onStatus("waiting");
    channel.onerror = () => this.onStatus("failed");
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) this.onPacket(new Uint8Array(event.data));
      else if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((bytes) => this.onPacket(new Uint8Array(bytes)));
      }
    };
  }

  private reset(): void {
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
    this.timer = setInterval(() => this.pump(), BRIDGE_POLL_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  receive(packet: Uint8Array): void {
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
