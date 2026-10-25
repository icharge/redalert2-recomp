import { describe, expect, it, vi } from "vitest";
import { UdpRelay, nativeRelayUrl, parseStartHandoff, type UdpRelaySocket } from "./udp-relay";

class FakeSocket extends EventTarget implements UdpRelaySocket {
  readyState = 0;
  binaryType = "blob";
  sent: Array<string | ArrayBufferLike | ArrayBufferView> = [];
  send(data: string | ArrayBufferLike | ArrayBufferView) { this.sent.push(data); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  text(data: string) { this.dispatchEvent(Object.assign(new Event("message"), { data })); }
  binary(bytes: number[]) {
    this.dispatchEvent(Object.assign(new Event("message"), { data: Uint8Array.from(bytes).buffer }));
  }
}

function setup() {
  const heap = new Uint8Array(4096);
  const queue: number[][] = [];
  const pushed: number[][] = [];
  const exports = {
    ra2_udp_buffer: () => 100,
    ra2_udp_pop: () => {
      const packet = queue.shift();
      if (!packet) return 0;
      heap.set(packet, 100);
      return packet.length;
    },
    ra2_udp_push: (length: number) => { pushed.push(Array.from(heap.slice(100, 100 + length))); return 0; },
  };
  const socket = new FakeSocket();
  const urls: string[] = [];
  const relay = new UdpRelay(exports, () => heap, (url) => { urls.push(url); return socket; });
  return { relay, socket, queue, pushed, urls };
}

const handoff = { channel: "#c", gservUrl: "ws://h:1/gserv", gameId: "g1-a", ticket: "tk" };

describe("parseStartHandoff", () => {
  it("reads the gserv url and ticket from a STARTG line", () => {
    expect(parseStartHandoff(":srv STARTG #woltst1's_game :ws://127.0.0.1:19090/gserv :g12-abc 1700000000 deadbeef\r\n"))
      .toEqual({ channel: "#woltst1's_game", gservUrl: "ws://127.0.0.1:19090/gserv", gameId: "g12-abc", ticket: "deadbeef" });
  });
  it("ignores other lines and non-websocket urls", () => {
    expect(parseStartHandoff(":srv JOIN #c")).toBeNull();
    expect(parseStartHandoff(":srv STARTG #c :http://x/gserv :g1-a 1 tk")).toBeNull();
  });
  it("derives the relay endpoint", () => {
    expect(nativeRelayUrl("ws://h:1/gserv")).toBe("ws://h:1/gserv/native");
    expect(nativeRelayUrl("wss://h/gserv/")).toBe("wss://h/gserv/native");
  });
});

describe("UdpRelay", () => {
  it.each(["close", "error"])("releases the packet timer and socket after %s", (event) => {
    vi.useFakeTimers();
    const { relay, socket } = setup();
    try {
      relay.start(handoff);
      socket.open();
      socket.text("ok 10.1.2.4");
      expect(relay.connected).toBe(true);
      expect(vi.getTimerCount()).toBe(1);
      socket.dispatchEvent(new Event(event));
      expect(relay.connected).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(socket.readyState).toBe(3);
    } finally {
      relay.stop();
      vi.useRealTimers();
    }
  });

  it("logs in with the ticket, then forwards datagrams both ways", () => {
    vi.useFakeTimers();
    const { relay, socket, queue, pushed, urls } = setup();
    queue.push([9, 9, 9, 9, 0, 0, 0, 0, 1]); // stale lobby probe, dropped on start
    relay.start(handoff);
    expect(urls).toEqual(["ws://h:1/gserv/native"]);
    socket.open();
    expect(socket.sent).toEqual(["ticket tk"]);
    queue.push([10, 1, 2, 3, 4, 210, 4, 210, 7]);
    vi.advanceTimersByTime(20);
    expect(socket.sent).toHaveLength(1); // held until the relay accepts the player
    socket.text("ok 10.1.2.4");
    vi.advanceTimersByTime(20);
    expect(Array.from(socket.sent[1] as Uint8Array)).toEqual([10, 1, 2, 3, 4, 210, 4, 210, 7]);
    socket.binary([10, 5, 6, 7, 4, 210, 4, 210, 42]);
    expect(pushed).toEqual([[10, 5, 6, 7, 4, 210, 4, 210, 42]]);
    relay.stop();
    vi.useRealTimers();
  });

  it("reports a refused login and a lost connection", () => {
    const errors: string[] = [];
    const heap = new Uint8Array(512);
    const socket = new FakeSocket();
    const relay = new UdpRelay(
      { ra2_udp_buffer: () => 0, ra2_udp_pop: () => 0, ra2_udp_push: () => 0 },
      () => heap, () => socket, (m) => errors.push(m),
    );
    relay.start(handoff);
    socket.open();
    socket.text("error invalid ticket");
    expect(relay.connected).toBe(false);
    socket.dispatchEvent(new Event("close"));
    expect(errors.join("|")).toContain("refused");
    expect(errors.join("|")).toContain("lost");
    relay.stop();
  });
});
