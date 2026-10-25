import { describe, expect, it, vi } from "vitest";
import { parseWolRoom, toWolSocketUrl, withBrowserWolPort, wolLineBytes, WolClient } from "./wol";

describe("browser WOL settings", () => {
  const bytes = (value: string) => Uint8Array.from(value, character => character.charCodeAt(0));
  const text = (value: Uint8Array) => Array.from(value, byte => String.fromCharCode(byte)).join("");
  it("sets the game's virtual fixed port so it skips the retired UDP firewall probe", () => {
    const input = bytes("[Video]\r\nScreenWidth=800\r\n[MultiPlayer]\r\nPortNumberOverride=0\r\nHandle=\xCA\xC7\r\n");
    expect(text(withBrowserWolPort(input))).toBe("[Video]\r\nScreenWidth=800\r\n[MultiPlayer]\r\nPortNumberOverride=1234\r\nHandle=\xCA\xC7\r\n");
    expect(text(input)).toContain("PortNumberOverride=0");
  });
  it("adds a missing setting or section, and preserves an existing fixed port", () => {
    expect(text(withBrowserWolPort(bytes("[multiplayer]\nColor=2\n")))).toContain("PortNumberOverride=1234");
    expect(text(withBrowserWolPort(bytes("[Video]\nWidth=800\n")))).toContain("[MultiPlayer]\nPortNumberOverride=1234");
    const fixed = bytes("[MultiPlayer]\nPortNumberOverride=2345\n");
    expect(withBrowserWolPort(fixed)).toEqual(fixed);
  });
});

describe("WOL wire helpers", () => {
  it("encodes chat text as UTF-8 without changing opaque GAMEOPT bytes", () => {
    const chat = ":other!local PRIVMSG #room :สวัสดี 😀";
    expect(wolLineBytes(chat)).toEqual(new TextEncoder().encode(`${chat}\0`));
    expect([...wolLineBytes(":other!local GAMEOPT #room :\xca\xff")].slice(-3)).toEqual([202, 255, 0]);
  });
  it("preserves every nonzero native option byte instead of UTF-8 encoding it", () => {
    const bytes = Array.from({ length: 255 }, (_, index) => index + 1);
    expect([...wolLineBytes(String.fromCharCode(...bytes))]).toEqual([...bytes, 0]);
  });
  it("parses RA2Web's reserved field and mode::topic LIST format", () => {
    expect(
      parseWolRoom(":wol-ra2web 322 player #Room_1 2 0 45 0 0 12 384::roomtopic :0"),
    ).toEqual({
      channel: "#Room_1",
      players: 2,
      maxPlayers: null,
      channelType: 45,
      topic: "roomtopic",
    });
  });

  it("converts the configured HTTP endpoint to its WebSocket endpoint", () => {
    expect(toWolSocketUrl("https://wol.example/emu/" )).toBe("wss://wol.example/emu/");
    expect(toWolSocketUrl("http://127.0.0.1:19090/")).toBe("ws://127.0.0.1:19090/");
  });

  it("rejects malformed LIST rows", () => {
    expect(parseWolRoom(":wol 322 player not-a-channel 2 8 45 :topic")).toBeNull();
    expect(parseWolRoom(":wol 322 player #Room nope 8 45 :topic")).toBeNull();
  });
});

describe("WolClient", () => {
  it("posts native packets to the trusted HTTP prefix with the authenticated session", async () => {
    class Socket extends EventTarget {
      readyState = 1;
      send(data: string): void {
        const reply = data.startsWith("cvers ") ? ":wol 700 * :ok" : data.startsWith("setlocale ") ? ":wol 310 * :ok" : ":wol 376 test :done";
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: reply })));
      }
      close(): void { this.readyState = 3; }
    }
    const calls: { url: string; init?: RequestInit }[] = [];
    let status = 200;
    let accepted = true;
    let stalled = false;
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      if (stalled) return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("request timed out")), { once: true });
      });
      return new Response(JSON.stringify({ sessionToken: "session-only", gameId: "g1-abc", stored: accepted, ranked: false }), { status });
    };
    const client = new WolClient({ httpUrl: "https://wol.test/emu-api/", socketUrl: "wss://wol.test/wol" }, "test", "password", fetcher, () => new Socket(), 50);
    try {
      await client.connect({ joinLobby: false });
      const bytes = new Uint8Array([0, 255, 128, 1]);
      await client.submitNativeResult("g1-abc", bytes);
      const request = calls[1]!;
      expect(request.url).toBe("https://wol.test/emu-api/native-results/g1-abc");
      expect(request.init?.headers).toEqual({ Authorization: "Bearer session-only", "Content-Type": "application/octet-stream" });
      expect(request.init?.body).toEqual(bytes);
      expect(request.init?.signal).toBeInstanceOf(AbortSignal);
      status = 503;
      await expect(client.submitNativeResult("g1-abc", bytes)).rejects.toThrow("503");
      status = 200; accepted = false;
      await expect(client.submitNativeResult("g1-abc", bytes)).rejects.toThrow("acknowledgement");
      stalled = true;
      await expect(client.submitNativeResult("g1-abc", bytes)).rejects.toThrow("timed out");
      await expect(client.submitNativeResult("g1-abc", new Uint8Array(32769))).rejects.toThrow("size");
      await expect(client.submitNativeResult("../login", bytes)).rejects.toThrow("match ID");
    } finally { client.close(); }
    await expect(client.submitNativeResult("g1-abc", new Uint8Array([1]))).rejects.toThrow("authenticated");
  });
  it("keeps HTTP authentication at its base when the WOL socket has a different path", async () => {
    class Socket extends EventTarget {
      readyState = 1;
      send(data: string): void {
        const reply = data.startsWith("cvers ") ? ":wol 700 * :ok"
          : data.startsWith("setlocale ") ? ":wol 310 * :ok" : ":wol 376 test :done";
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: reply })));
      }
      close(): void { this.readyState = 3; }
    }
    const requests: string[] = [];
    const fetcher: typeof fetch = async input => {
      requests.push(String(input));
      return new Response(JSON.stringify(requests.length === 1 ? { error: "already registered" } : { sessionToken: "token" }),
        { status: requests.length === 1 ? 409 : 200 });
    };
    const socketUrls: string[] = [];
    const client = new WolClient({ httpUrl: "https://wol.test/service/", socketUrl: "wss://wol.test/service/wol" },
      "test", "password123", fetcher, url => { socketUrls.push(url); return new Socket(); });
    try {
      await client.connect({ joinLobby: false });
      expect(requests).toEqual(["https://wol.test/service/register", "https://wol.test/service/login"]);
      expect(socketUrls).toEqual(["wss://wol.test/service/wol"]);
      expect(client.connected).toBe(true);
    } finally { client.close(); }
  });

  it("rejects a connection closed during the handshake without a second disconnect event", async () => {
    class Socket extends EventTarget {
      readyState = 1;
      send(): void { queueMicrotask(() => this.close()); }
      close(): void { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessionToken: "token" }))) as unknown as typeof fetch;
    const client = new WolClient("http://wol.test", "test", "password123", fetcher, () => new Socket(), 100);
    const closed = vi.fn();
    client.onDisconnect(closed);
    await expect(client.connect({ joinLobby: false })).rejects.toThrow("closed the connection");
    expect(closed).not.toHaveBeenCalled();
  });
  it("reports an unexpected close once, but stays quiet for explicit logout", async () => {
    class Socket extends EventTarget {
      readyState = 1;
      send(data: string): void {
        const reply = data.startsWith("cvers ") ? ":wol 700 * :ok"
          : data.startsWith("setlocale ") ? ":wol 310 * :ok" : ":wol 376 test :done";
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: reply })));
      }
      close(): void { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    const sockets: Socket[] = [];
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessionToken: "token" }))) as unknown as typeof fetch;
    const client = new WolClient("http://wol.test", "test", "password123", fetcher, () => {
      const socket = new Socket(); sockets.push(socket); return socket;
    });
    const closed = vi.fn();
    client.onDisconnect(closed);
    await client.connect({ joinLobby: false });
    sockets[0]!.close();
    expect(client.connected).toBe(false);
    expect(closed).toHaveBeenCalledOnce();
    await client.connect({ joinLobby: false });
    sockets[0]!.dispatchEvent(new Event("close")); // Detached socket must not close the new session.
    expect(client.connected).toBe(true);
    client.close();
    expect(closed).toHaveBeenCalledOnce();
  });
  it("does not open a socket when logout happens during HTTP login", async () => {
    let answerLogin!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { answerLogin = resolve; })) as unknown as typeof fetch;
    class Socket extends EventTarget {
      readyState = 1;
      send(): void {}
      close(): void { this.readyState = 3; }
    }
    const createSocket = vi.fn(() => new Socket());
    const client = new WolClient("http://wol.test", "test", "password123", fetcher, createSocket, 1_000);
    const outcome = client.connect().catch((error: Error) => error.message);
    client.close();
    answerLogin(new Response(JSON.stringify({ sessionToken: "token" }), { status: 200 }));
    expect(await outcome).toContain("closed");
    expect(createSocket).not.toHaveBeenCalled();
  });

  it("settles a pending WebSocket open when the client is closed", async () => {
    class Socket extends EventTarget {
      readyState = 0;
      send(): void {}
      close(): void { this.readyState = 3; }
    }
    const socket = new Socket();
    const createSocket = vi.fn(() => socket);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessionToken: "token" }), { status: 200 })) as unknown as typeof fetch;
    const client = new WolClient("http://wol.test", "test", "password123", fetcher, createSocket, 1_000);
    const outcome = client.connect().catch((error: Error) => error.message);
    await vi.waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
    client.close();
    expect(await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve("still pending"), 100))])).toContain("closed");
  });

  it("authenticates, joins the lobby, lists games, and creates a custom room", async () => {
    class FakeSocket extends EventTarget {
      readyState = 0;
      sent: string[] = [];

      send(data: string): void {
        this.sent.push(data.trim());
        const command = data.trim().split(" ")[0]?.toLowerCase();
        const channel = data.trim().split(" ")[1];
        const replies: Record<string, string> = {
          cvers: ":wol 700 * :ok",
          setlocale: ":wol 310 * :ok",
          session: ":wol 376 test :- End of /MOTD command.",
          join: `:test!local JOIN :0,0,0,1 ${channel}\r\n:wol 353 test = ${channel} :test\r\n:wol 366 test ${channel} :End of /NAMES list.`,
          list: ":wol 321 test Channel :Users Name\r\n:wol 322 test #Open 1 0 45 0 0 0 0::Open_room\x0d\n:wol 323 test :End of LIST",
          joingame: `:test!local JOINGAME 0 0 0 0 0 1 0 :${channel}\r\n:wol 353 test = ${channel} :@test`,
        };
        const reply = replies[command ?? ""];
        if (reply) queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: reply })));
        if (command === "startg")
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: ":wol STARTG #test-room :ws://wol/gserv :g1 123 abc" })));
      }

      close(): void { this.readyState = 3; }
      open(): void { this.readyState = 1; this.dispatchEvent(new Event("open")); }
    }

    const socket = new FakeSocket();
    const createSocket = vi.fn(() => {
      queueMicrotask(() => socket.open());
      return socket;
    });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      return new Response(JSON.stringify(path.endsWith("/register") ? {} : { sessionToken: "token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = new WolClient("http://wol.test", "test", "password123", fetcher, createSocket, 100);

    await client.connect();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(socket.sent.slice(0, 4)).toEqual([
      "cvers 0.83.4 16640",
      "setlocale 2",
      "session token",
      "join #Lob_45_0 zotclot9",
    ]);
    await expect(client.listGames()).resolves.toEqual([
      { channel: "#Open", players: 1, maxPlayers: null, channelType: 45, topic: "Open_room" },
    ]);
    await expect(client.createGame("Test Room", 4)).resolves.toBe("#test-test-room");
    expect(socket.sent).toContain("joingame #test-test-room 1 4 45 0 0 0 0");
    expect(socket.sent).toContain("gameopt #test-test-room :A1");
    await expect(client.startGame("#test-room")).resolves.toContain(" STARTG ");
    client.close();
  });

  it("can authenticate without joining a lobby so the game controls channel entry", async () => {
    class FakeSocket extends EventTarget {
      readyState = 0;
      sent: string[] = [];
      send(data: string): void {
        const line = data.trim();
        this.sent.push(line);
        const reply = line.startsWith("cvers ") ? ":wol 700 * :ok"
          : line.startsWith("setlocale ") ? ":wol 310 * :ok"
          : line.startsWith("session ") ? ":wol 376 test :- End of /MOTD command."
          : undefined;
        if (reply) queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: reply })));
      }
      close(): void { this.readyState = 3; }
      open(): void { this.readyState = 1; this.dispatchEvent(new Event("open")); }
    }

    const socket = new FakeSocket();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessionToken: "token" }), { status: 200 })) as unknown as typeof fetch;
    const client = new WolClient("http://wol.test", "test", "password123", fetcher, () => {
      queueMicrotask(() => socket.open());
      return socket;
    }, 100);

    await client.connect({ joinLobby: false });
    expect(socket.sent).toEqual(["cvers 0.83.4 16640", "setlocale 2", "session token"]);
    client.sendRaw("list 45 45");
    expect(socket.sent.at(-1)).toBe("list 45 45");
    client.close();
  });
});
