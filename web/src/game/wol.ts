/** RA2Web's browser-facing subset of the Westwood Online line protocol. */

/** WOLAPI strings carry opaque game-option bytes, including bytes above 0x7f.
 * Represent each byte as one JS code unit across WebSocket, then restore it at
 * the WASM boundary. TextEncoder/cwrap("string") would change those bytes.
 */
export function wolLineBytes(line: string): Uint8Array {
  // Chat is Unicode text; GAMEOPT and other native strings remain opaque bytes.
  if (/^:[^ ]+ PRIVMSG [^ ]+ :/i.test(line)) return new TextEncoder().encode(`${line}\0`);
  return Uint8Array.from(`${line}\0`, character => character.charCodeAt(0));
}

/** Keep the native firewall probe out of the browser's WebSocket connection.
 * PortNumberOverride makes RA2/YR use a fixed virtual port instead of contacting
 * the retired Westwood UDP mangler. Preserve the INI's original byte encoding.
 */
export function withBrowserWolPort(bytes: Uint8Array): Uint8Array {
  const text = Array.from(bytes, byte => String.fromCharCode(byte)).join("");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let inMultiplayer = false;
  let sectionAt = -1;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*\[([^\]]+)\]/.exec(lines[i]!);
    if (header) {
      inMultiplayer = header[1]!.trim().toLowerCase() === "multiplayer";
      if (inMultiplayer && sectionAt < 0) sectionAt = i;
    } else if (inMultiplayer) {
      const port = /^\s*PortNumberOverride\s*=\s*(\d+)/i.exec(lines[i]!);
      if (port) {
        found = true;
        if (Number(port[1]) === 0) lines[i] = "PortNumberOverride=1234";
      }
    }
  }
  if (!found) {
    if (sectionAt >= 0) lines.splice(sectionAt + 1, 0, "PortNumberOverride=1234");
    else lines.push("[MultiPlayer]", "PortNumberOverride=1234");
  }
  return Uint8Array.from(lines.join(eol), character => character.charCodeAt(0));
}

export interface WolRoom {
  channel: string;
  players: number;
  /** The LIST reply does not report capacity. */
  maxPlayers: number | null;
  channelType: number;
  topic: string;
}

export function toWolSocketUrl(server: string): string {
  const url = new URL(server);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:")
    throw new Error("The WOL server must use HTTP(S) or WS(S).");
  return url.toString();
}

/** RA2Web LIST carries mode::topic before the trailing host-muted field. */
export function parseWolRoom(line: string): WolRoom | null {
  const trailing = line.indexOf(" :");
  const fields = (trailing < 0 ? line : line.slice(0, trailing)).split(/\s+/);
  if (fields[1] !== "322" || !/^#[^\s]+$/.test(fields[3] ?? "")) return null;
  const players = Number(fields[4]);
  const channelType = Number(fields[6]);
  const modeTopic = fields[10]?.indexOf("::") ?? -1;
  if (![players, channelType].every(Number.isInteger) || players < 0 || modeTopic < 0)
    return null;
  return {
    channel: fields[3]!,
    players,
    maxPlayers: null,
    channelType,
    topic: fields[10]!.slice(modeTopic + 2),
  };
}

export interface WolSocket extends EventTarget {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
}

type Pending = {
  match: (line: string) => boolean;
  label: string;
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const OPEN = 1;
const DEFAULT_TIMEOUT_MS = 10_000;

async function sessionToken(
  server: string,
  username: string,
  password: string,
  fetcher: typeof fetch,
): Promise<string> {
  const body = JSON.stringify({ user: username, pass: password, locale: "en-US" });
  let response = await fetcher(new URL("register", ensureSlash(server)), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  let result = (await response.json().catch(() => ({}))) as { sessionToken?: unknown; error?: unknown };
  if (typeof result.sessionToken !== "string") {
    response = await fetcher(new URL("login", ensureSlash(server)), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    result = (await response.json().catch(() => ({}))) as { sessionToken?: unknown; error?: unknown };
  }
  if (!response.ok || typeof result.sessionToken !== "string") {
    throw new Error(typeof result.error === "string" ? result.error : "WOL register/login failed.");
  }
  return result.sessionToken;
}

function ensureSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/** Operator-configured endpoints; HTTP auth need not share the WOL socket path. */
export interface WolServer {
  httpUrl: string;
  socketUrl: string;
}

/** Authenticates to RA2Web and exposes the lobby and custom-game commands used by RA2/YR. */
export class WolClient {
  private socket: WolSocket | null = null;
  private generation = 0;
  private connecting = false;
  private cancelOpen: ((error: Error) => void) | null = null;
  private readonly buffered: string[] = [];
  private readonly pending: Pending[] = [];
  private readonly listeners = new Set<(line: string) => void>();
  private readonly disconnectListeners = new Set<() => void>();
  private readonly timeoutMs: number;
  private authToken: string | null = null;

  constructor(
    private readonly server: string | WolServer,
    private readonly username: string,
    private readonly password: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly createSocket: (url: string) => WolSocket = (url) => new WebSocket(url),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.timeoutMs = timeoutMs;
  }

  get connected(): boolean {
    return this.socket?.readyState === OPEN;
  }

  onLine(listener: (line: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async connect(options: { joinLobby?: boolean } = {}): Promise<void> {
    if (this.socket || this.connecting) throw new Error("WOL client is already connected.");
    this.connecting = true;
    const generation = ++this.generation;
    try {
      const httpUrl = typeof this.server === "string" ? this.server : this.server.httpUrl;
      const socketUrl = toWolSocketUrl(typeof this.server === "string" ? this.server : this.server.socketUrl);
      const token = await sessionToken(httpUrl, this.username, this.password, this.fetcher);
      if (generation !== this.generation) throw new Error("WOL connection closed.");
      this.authToken = token;
      const socket = this.createSocket(socketUrl);
      this.socket = socket;
      socket.addEventListener("message", this.handleMessage as EventListener);
      socket.addEventListener("close", this.handleClose as EventListener);
      await this.waitForOpen(socket);

      this.send("cvers 0.83.4 16640");
      await this.waitFor((line) => /\s700\s/.test(line), "WOL version acceptance");
      this.send("setlocale 2");
      await this.waitFor((line) => /\s310\s/.test(line), "locale acceptance");
      this.send(`session ${token}`);
      await this.waitFor((line) => /\s376\s/.test(line), "authenticated MOTD");

      if (options.joinLobby !== false) await this.joinLobby();
    } catch (error) {
      if (generation === this.generation) this.close();
      throw error;
    } finally {
      if (generation === this.generation) this.connecting = false;
    }
  }

  async joinLobby(): Promise<void> {
    const lobby = "#Lob_45_0";
    this.send(`join ${lobby} zotclot9`);
    await this.waitFor((line) => line.includes(" JOIN ") && line.endsWith(` ${lobby}`), "lobby join");
    await this.waitFor((line) => /\s353\s/.test(line) && line.includes(lobby), "lobby roster");
    await this.waitFor((line) => /\s366\s/.test(line) && line.includes(lobby), "lobby roster end");
  }

  /** Send a WOL command issued by the game's COM interface. */
  sendRaw(line: string): void {
    this.send(line);
  }

  /** Save a native Custom Match report; it never enters ranked scoring. */
  async submitNativeResult(gameId: string, packet: Uint8Array): Promise<void> {
    const token = this.authToken;
    if (!token) throw new Error("WOL result submission is not authenticated.");
    if (!/^g[1-9]\d*-[a-z0-9]+$/i.test(gameId)) throw new Error("Invalid native match ID.");
    if (!packet.length || packet.length > 32768) throw new Error("Invalid native result size.");
    const server = typeof this.server === "string" ? this.server : this.server.httpUrl;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(new URL(`native-results/${gameId}`, ensureSlash(server)), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(packet),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Native result submission failed (${response.status}).`);
      const accepted = await response.json() as { stored?: boolean; gameId?: string; ranked?: boolean };
      if (accepted.stored !== true || accepted.gameId !== gameId || accepted.ranked !== false)
        throw new Error("Invalid native result storage acknowledgement.");
    } finally { clearTimeout(timeout); }
  }

  async listGames(channelType = 45): Promise<WolRoom[]> {
    const rooms: WolRoom[] = [];
    const unsubscribe = this.onLine((line) => {
      const room = parseWolRoom(line);
      if (room && room.channelType === channelType) rooms.push(room);
    });
    try {
      this.send(`list ${channelType} ${channelType}`);
      await this.waitFor((line) => /\s323\s/.test(line), "game list end");
      return rooms;
    } finally {
      unsubscribe();
    }
  }

  async createGame(name: string, slots: number, channelType = 45): Promise<string> {
    if (!Number.isInteger(slots) || slots < 2 || slots > 8) throw new Error("Player slots must be 2–8.");
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
    const channel = `#${this.username}-${slug || "custom-game"}`;
    this.send(`joingame ${channel} 1 ${slots} ${channelType} 0 0 0 0`);
    await this.waitFor((line) => line.includes("JOINGAME ") && line.endsWith(`:${channel}`), "game creation");
    await this.waitFor((line) => /\s353\s/.test(line) && line.includes(channel), "game roster");
    this.send(`gameopt ${channel} :A1`);
    return channel;
  }

  async joinGame(channel: string): Promise<void> {
    this.send(`joingame ${channel} 0`);
    await this.waitFor((line) => line.includes("JOINGAME ") && line.endsWith(`:${channel}`), "game join");
    await this.waitFor((line) => /\s353\s/.test(line) && line.includes(channel), "game roster");
  }

  async startGame(channel: string): Promise<string> {
    this.send(`startg ${channel} ${this.username}`);
    return this.waitFor((line) => line.includes(" STARTG ") && line.includes(channel), "game start");
  }

  leave(channel: string): void {
    this.send(`part ${channel}`);
  }

  close(): void {
    this.generation++;
    this.authToken = null;
    this.connecting = false;
    const error = new Error("WOL connection closed.");
    this.cancelOpen?.(error);
    const socket = this.socket;
    this.socket = null;
    socket?.removeEventListener("message", this.handleMessage as EventListener);
    socket?.removeEventListener("close", this.handleClose as EventListener);
    socket?.close();
    this.failPending(error);
    this.buffered.length = 0;
  }

  private send(line: string): void {
    if (!this.connected) throw new Error("WOL connection is not open.");
    this.socket!.send(`${line}\r\n`);
  }

  private waitForOpen(socket: WolSocket): Promise<void> {
    if (socket.readyState === OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", open);
        socket.removeEventListener("error", error);
        socket.removeEventListener("close", closed);
        this.cancelOpen = null;
      };
      const fail = (reason: Error) => { cleanup(); reject(reason); };
      const open = () => { cleanup(); resolve(); };
      const error = () => fail(new Error("WOL WebSocket connection failed."));
      const closed = () => fail(new Error("WOL connection closed."));
      const timer = setTimeout(() => fail(new Error("Timed out opening WOL WebSocket.")), this.timeoutMs);
      this.cancelOpen = fail;
      if (socket.readyState > OPEN) {
        closed();
        return;
      }
      socket.addEventListener("open", open, { once: true });
      socket.addEventListener("error", error, { once: true });
      socket.addEventListener("close", closed, { once: true });
    });
  }

  private waitFor(match: (line: string) => boolean, label: string): Promise<string> {
    const index = this.buffered.findIndex(match);
    if (index >= 0) return Promise.resolve(this.buffered.splice(index, 1)[0]!);
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        match,
        label,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.pending.indexOf(pending);
          if (index >= 0) this.pending.splice(index, 1);
          reject(new Error(`Timed out waiting for ${label}.`));
        }, this.timeoutMs),
      };
      this.pending.push(pending);
    });
  }

  private handleMessage = (event: MessageEvent<string>): void => {
    for (const line of String(event.data).split(/\r?\n/).filter(Boolean)) {
      const [command, ...args] = line.split(" ");
      if (command?.toLowerCase() === "ping") {
        this.socket?.send(`PONG ${args[0] ?? ""}\r\n`);
        continue;
      }
      this.listeners.forEach((listener) => listener(line));
      const index = this.pending.findIndex((entry) => entry.match(line));
      if (index >= 0) {
        const [pending] = this.pending.splice(index, 1);
        clearTimeout(pending!.timer);
        pending!.resolve(line);
      } else {
        this.buffered.push(line);
        if (this.buffered.length > 256) this.buffered.shift();
      }
    }
  };

  private handleClose = (event: Event): void => {
    const socket = this.socket;
    if (!socket || event.currentTarget !== socket) return;
    socket.removeEventListener("message", this.handleMessage as EventListener);
    socket.removeEventListener("close", this.handleClose as EventListener);
    this.socket = null;
    this.failPending(new Error("WOL server closed the connection."));
    this.buffered.length = 0;
    // A failed handshake is reported by connect(). Intentional close detaches us.
    if (!this.connecting) this.disconnectListeners.forEach(listener => listener());
  };

  private failPending(error: Error): void {
    for (const pending of this.pending.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}
