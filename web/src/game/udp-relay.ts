/**
 * Internet play for the recompiled game: its WOL netcode sends plain UDP, which a
 * browser cannot, so the HLE Winsock queues each datagram (ra2_udp_*) and this
 * moves them over one WebSocket to RA2Web's native relay, which delivers them to
 * the addressed player. Frames are the HLE's own: a peer IPv4 address, the source
 * and destination ports (network order), then the payload. See
 * server/src/gserv/NativeRelay.ts for the other end.
 */

export interface UdpRelayExports {
  ra2_udp_buffer(): number;
  ra2_udp_pop(capacity: number): number;
  ra2_udp_push(length: number): number;
}

export interface UdpRelaySocket extends EventTarget {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(): void;
}

/** What a STARTG line hands the client: where the relay is and the player's ticket. */
export interface WolStartHandoff {
  channel: string;
  gservUrl: string;
  gameId: string;
  ticket: string;
}

const OPEN = 1;
const PACKET_MAX = 8 + 1500;
const POLL_MS = 8;
const MAX_PACKETS_PER_POLL = 64;

/** `:server STARTG #chan :ws://host/gserv :g1-abc 1700000000 ticket` */
export function parseStartHandoff(line: string): WolStartHandoff | null {
  const match = /^:\S+ STARTG (\S+) :(\S+) :(\S+) \d+ (\S+)\s*$/.exec(line.trim());
  if (!match) return null;
  const [, channel, gservUrl, gameId, ticket] = match;
  if (!/^wss?:\/\//.test(gservUrl!)) return null;
  return { channel: channel!, gservUrl: gservUrl!, gameId: gameId!, ticket: ticket! };
}

export function nativeRelayUrl(gservUrl: string): string {
  const url = new URL(gservUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/native`;
  return url.toString();
}

export class UdpRelay {
  private socket: UdpRelaySocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ready = false;
  private readonly packetBuffer: number;

  constructor(
    private readonly exports: UdpRelayExports,
    private readonly heap: () => Uint8Array,
    private readonly createSocket: (url: string) => UdpRelaySocket = (url) => new WebSocket(url),
    private readonly onError: (message: string) => void = () => {},
    /** Log the relay's traffic to the console (the page asks with ?udptrace). */
    private readonly traceTraffic = false,
  ) {
    this.packetBuffer = exports.ra2_udp_buffer();
  }

  get connected(): boolean {
    return this.ready && this.socket?.readyState === OPEN;
  }

  /** Drop what the game queued before the match (lobby probes), then connect. */
  start(handoff: WolStartHandoff): void {
    this.stop();
    while (this.exports.ra2_udp_pop(PACKET_MAX) > 0);
    const url = nativeRelayUrl(handoff.gservUrl);
    this.trace(`connecting to ${url} for ${handoff.gameId}`);
    const socket = this.createSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket === socket) socket.send(`ticket ${handoff.ticket}`);
    });
    socket.addEventListener("message", ((event: MessageEvent) => {
      if (this.socket !== socket) return;
      if (typeof event.data === "string") {
        this.trace(`relay says: ${event.data}`);
        if (event.data.startsWith("ok ")) this.ready = true;
        else this.onError(`Internet play relay refused the connection: ${event.data}`);
        return;
      }
      this.receive(new Uint8Array(event.data as ArrayBuffer));
    }) as EventListener);
    const lost = () => {
      if (this.socket !== socket) return;
      this.stop();
      this.onError("The Internet play relay connection was lost.");
    };
    socket.addEventListener("close", lost);
    socket.addEventListener("error", lost);
    this.timer = setInterval(() => this.pump(), POLL_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    socket?.close();
  }

  private trace(message: string): void {
    if (this.traceTraffic) console.info(`[udp-relay] ${message}`);
  }

  private describe(direction: string, packet: Uint8Array): string {
    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const ip = Array.from(packet.subarray(0, 4)).join(".");
    const hex = Array.from(packet.subarray(8, 8 + 96), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${direction} ${ip} ports ${view.getUint16(4)}->${view.getUint16(6)} ${packet.byteLength - 8} bytes ${hex}`;
  }

  private receive(packet: Uint8Array): void {
    if (packet.byteLength < 8 || packet.byteLength > PACKET_MAX) return;
    this.trace(this.describe("recv from", packet));
    try {
      this.heap().set(packet, this.packetBuffer);
      // A full receive queue drops the datagram, as UDP would.
      this.exports.ra2_udp_push(packet.byteLength);
    } catch (error) {
      this.onError(error instanceof Error ? error.message : String(error));
    }
  }

  private pump(): void {
    // Hold the game's datagrams until the relay accepts the player.
    if (!this.connected) return;
    try {
      const heap = this.heap();
      for (let count = 0; count < MAX_PACKETS_PER_POLL; count++) {
        const length = this.exports.ra2_udp_pop(PACKET_MAX);
        if (length <= 0) return;
        const packet = heap.slice(this.packetBuffer, this.packetBuffer + length);
        this.trace(this.describe("send to", packet));
        this.socket!.send(packet);
      }
    } catch (error) {
      this.onError(error instanceof Error ? error.message : String(error));
      this.stop();
    }
  }
}
