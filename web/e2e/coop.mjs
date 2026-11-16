// End to end (C-1, C-2, C-3): Yuri's Revenge Quick Co-op with two web clients against a local WOL server.
// Start the server first (`pnpm wol-server`, port 9090; STORAGE=memory keeps it clean; Quick Co-op is on by
// default) and Vite, then from web/:
//   node e2e/coop.mjs --url 'http://127.0.0.1:5175/' --game ../game --label line-off --server-log <server stdout file>
// Run it again against a server started with COOP_CAMPAIGN_LINE=true (--label line-on) to compare.
// Two pages, each its own Chrome, sign in as two guests (the page opens with #ticket=, as in
// lobby-bot.mjs), press Internet, go Back to the welcome screen, press Quick Co-op on both, let the match
// start (C1A01MD), and end it fast: Esc, Abort Mission, Observe on both. Observing everywhere defeats the
// humans, the game ends and both reach "Campaign Results" (Quit would go straight back to the welcome
// screen with no score screen; Observe on one side alone keeps the other playing). Then:
//   C-1  the GAMEOPT lines each client received (a "C0," campaign line or not), the match started, the
//        score screen reached.
//   C-3  A types a chat line on the score screen. Checked in steps: the game sent a datagram (relay frame
//        out of A, and the server's `new datagram length` line), the relay delivered it (frame into B), and
//        B's game drew it (B's chat list changes; A's own list changes as the control).
//   C-2  both press Continue (the button of "Next Mission: ..."); everything the game sends in the next
//        20 s is listed: WOL chat frames, HTTP requests to the server, relay datagram lengths, native
//        dialog lines, and whether the screen changed.
// The page runs with ?udptrace, so the game's Winsock calls ("[net]") and the relay's datagrams
// ("[udp-relay] recv from ...", with the first bytes) are in the log.
// Options: --server http://127.0.0.1:9090, --server-log FILE (the server's stdout, for the relay lines),
// --strict (the partner's screen must show the chat line), --label NAME, plus --game, --shots, --headed.
// C-4, one run per mission: start the scratch server with QUICK_MATCH_MAPS=<STEM> (the pool then holds only that
// mission) and pass --map <STEM> --short. --map checks that the options record the clients receive names
// <STEM>.MAP (and that the game logs no "do not match"), --short stops at the score screen (about two minutes)
// and prints one line: `MAP <STEM>: paired yes/no, loaded yes/no (frames), score screen yes/no`.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { startPage, options } from "./lib.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const opts = options(argv);
opts.pageArgs.push("--mute", "--debuglog");
const server = option("--server", "http://127.0.0.1:9090");
const serverLog = option("--server-log", null);
const label = option("--label", "run");
const strict = argv.includes("--strict");
const wantMap = option("--map", null);
const short = argv.includes("--short");
const reached = { paired: false, loaded: false, score: false };
const mapLine = () => {
  const yes = (v) => (v ? "yes" : "no");
  const frames = Object.values(clients).map((run) => frameOf(run));
  return `MAP ${wantMap ?? "(any)"}: paired ${yes(reached.paired)}, loaded ${yes(reached.loaded)} (frames ${frames.join(", ")}), score screen ${yes(reached.score)}`;
};
const origin = new URL(opts.url).origin;
const tag = randomBytes(4).toString("hex").slice(0, 5);

// The welcome screen and the score screen are 800x600 in the game's pixels; the match runs at the
// resolution in the options (1280x960 here), with the sidebar on the right edge.
const BACK = [719, 556]; // Back, in the chat lobby (the welcome screen is behind it)
const QUICK_COOP = [719, 262]; // welcome screen
const CHAT_EDIT = [300, 545]; // score screen
const CHAT_LIST = [9, 370, 613, 160]; // score screen chat list: x, y, w, h
const CONTINUE = [719, 262]; // score screen
const sidebar = (size, dy) => [size.w - 87, dy]; // Abort Mission 264, Quit and Observe 239 / 264

const results = [];
const check = (what) => {
  results.push(what);
  console.log(`ok  ${what}`);
};
const info = (what) => console.log(`    ${what}`);

async function guestTicket(nick) {
  const response = await fetch(`${server}/v1/auth/guest`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ nick, edition: "yr" }),
  });
  const data = await response.json().catch(() => ({}));
  assert.ok(response.ok, `/v1/auth/guest: ${response.status} ${data.errorCode ?? ""}`);
  return data;
}

const clients = {};
async function open(name) {
  const minted = await guestTicket(`z${name}${tag}`);
  const url = new URL(opts.url);
  url.hash = `ticket=${minted.ticket}`;
  url.searchParams.set("udptrace", "1");
  const run = await startPage({
    ...opts,
    url: url.toString(),
    shots: `${opts.shots}/coop-${name}`,
  });
  run.name = name;
  run.nick = minted.user;
  run.wire = []; // WOL chat frames: { t, dir: "<" | ">", line }
  run.relay = []; // relay frames: { t, dir, len }
  run.http = []; // requests to the server other than the chat socket: { t, text }
  const wsBase = server.replace(/^http/, "ws");
  run.page.on("websocket", (ws) => {
    if (!ws.url().startsWith(wsBase)) return;
    const gserv = ws.url().includes("/gserv");
    const add = (dir) => (f) => {
      const t = Date.now();
      if (gserv) {
        if (typeof f.payload !== "string") run.relay.push({ t, dir, len: f.payload.length });
        return;
      }
      for (const line of String(f.payload).split(/\r?\n/))
        if (line) run.wire.push({ t, dir, line });
    };
    ws.on("framesent", add(">"));
    ws.on("framereceived", add("<"));
  });
  run.page.on("request", (r) => {
    if (r.url().startsWith(server))
      run.http.push({ t: Date.now(), text: `> ${r.method()} ${new URL(r.url()).pathname}` });
  });
  run.page.on("response", (r) => {
    if (r.url().startsWith(server))
      run.http.push({ t: Date.now(), text: `< ${r.status()} ${new URL(r.url()).pathname}` });
  });
  clients[name] = run;
  return run;
}

const until = async (run, what, test, ms = 60000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = test();
    if (found) return found;
    assert.ok(Date.now() < deadline, `${run.nick}: timed out waiting for ${what}`);
    await run.page.waitForTimeout(100);
  }
};
const nativeSeen = (run, text, from = 0) => run.all.slice(from).some((l) => l.includes(text));
const waitNative = (run, text, from = 0, ms = 60000) =>
  until(run, `native ${text}`, () => nativeSeen(run, text, from), ms);
const frameOf = (run) => {
  const last = run.all.findLast((l) => /^\[game\] Frame \d+,/.test(l));
  return Number(/^\[game\] Frame (\d+),/.exec(last ?? "")?.[1] ?? 0);
};
/** A rectangle in the game's pixels, as a screenshot clip of the page. */
async function clipOf(run, [x, y, w, h]) {
  return run.page.evaluate(
    ([gx, gy, gw, gh]) => {
      const c = document.querySelector("canvas");
      const size = window.ra2Store.getSnapshot().size;
      const r = c.getBoundingClientRect();
      const scale = Math.min(r.width / size.w, r.height / size.h);
      const left = r.left + (r.width - size.w * scale) / 2;
      const top = r.top + (r.height - size.h * scale) / 2;
      return { x: left + gx * scale, y: top + gy * scale, width: gw * scale, height: gh * scale };
    },
    [x, y, w, h],
  );
}
const chatListPixels = async (run) =>
  (await run.page.screenshot({ clip: await clipOf(run, CHAT_LIST) })).toString("base64");

// Guest memory (the wasm heap is flat: a guest address is the heap offset), as hex. The game runs in a
// worker on the same shared memory, so the page can read it while the game runs.
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const guestRead = (run, addr, len) =>
  run.page
    .evaluate(
      async ([a, n]) => {
        const handle = await window.ra2Session;
        return Array.from(handle.memory().HEAPU8.slice(a, a + n));
      },
      [addr, len],
    )
    .then((v) => Uint8Array.from(v));
const le32 = (b, at = 0) =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const cstring = (b) => {
  const end = b.indexOf(0);
  return Buffer.from(b.slice(0, end < 0 ? b.length : end)).toString("latin1");
};
/** Keeps a copy of the game's incoming packet buffer (0xA8D638) each time it changes. */
const watchPacket = (run) =>
  run.page.evaluate(async () => {
    const handle = await window.ra2Session;
    const heap = handle.memory().HEAPU8;
    window.coopPackets = [];
    let last = "";
    window.coopPoll = setInterval(() => {
      const now = heap.slice(0xa8d638, 0xa8d638 + 0x130);
      const text = now.join(",");
      if (text !== last) {
        last = text;
        window.coopPackets.push({ t: Date.now(), bytes: Array.from(now) });
        if (window.coopPackets.length > 200) window.coopPackets.shift();
      }
    }, 1);
  });
/** The game's name check: gate byte, name, its hash, and the hash the last packet carried. */
async function nameState(run) {
  const gate = await guestRead(run, 0xa8d60d, 4);
  const name = await guestRead(run, 0xa8d610, 0x40);
  const mode = await guestRead(run, 0xa8b238, 4);
  const flags = await guestRead(run, 0xa8dba0, 4);
  const lastHash = await guestRead(run, 0xa8d74c, 4);
  return {
    gate: gate[0],
    name: cstring(name),
    nameHex: hex(name.slice(0, 24)),
    mode: le32(mode),
    a8dba0: flags[0],
    lastPacketHash: le32(lastHash).toString(16),
  };
}

async function toWelcome(run) {
  await run.waitFor(`${run.nick} main menu`, (s) => s?.phase === "running", 300);
  await run.page.waitForTimeout(1500);
  await run.clickGame(720, 263); // Multiplayer
  await waitNative(run, "[dialog] open 0x10E");
  await run.page.waitForTimeout(800);
  const from = run.all.length;
  await run.clickGame(720, 305); // Internet
  await waitNative(run, "Joined Channel", from, 60000);
  await run.page.waitForTimeout(3000);
  assert.ok(
    !run.all.slice(from).some((l) => l.startsWith("[dialog] open") && l.includes("0x10F")),
    `${run.nick}: no login dialog`,
  );
  const lobby = run.all.length;
  await run.clickGame(...BACK); // the welcome screen: Quick Match, Quick Co-op, Custom Match ...
  await waitNative(run, "[dialog] open 0x10E", lobby);
  await run.page.waitForTimeout(2500);
}

const gameOpts = (run) =>
  run.wire
    .filter((w) => w.dir === "<" && / GAMEOPT /.test(w.line))
    .map((w) => w.line.slice(w.line.indexOf(" :", w.line.indexOf("GAMEOPT")) + 2));
const kindOf = (text) =>
  text.startsWith("L") ? "slots" : text.startsWith("C0,") ? "campaign" : "options";

const readServerLog = () =>
  serverLog && existsSync(serverLog) ? readFileSync(serverLog, "utf8") : "";

try {
  const a = await open("a");
  const b = await open("b");
  console.log(`${label}: ${a.nick} and ${b.nick}`);
  await Promise.all([toWelcome(a), toWelcome(b)]);

  // ---- C-1: queue both, read the options each game receives, let the match start
  await a.clickGame(...QUICK_COOP);
  await b.clickGame(...QUICK_COOP);
  for (const run of [a, b])
    await until(run, "the match to be found", () =>
      run.wire.some((w) => w.dir === "<" && w.line.includes("Match found!")),
    );
  check("both found a partner through #Lob_39_0 (Quick Co-op)");
  reached.paired = true;
  // STARTG follows the options records, so they are all in by then
  for (const run of [a, b])
    await until(
      run,
      "STARTG",
      () => run.wire.some((w) => w.dir === "<" && / STARTG /.test(w.line)),
      90000,
    );
  await a.page.waitForTimeout(500);
  for (const run of [a, b]) {
    const lines = gameOpts(run);
    info(`${run.nick} GAMEOPT x${lines.length}: ${lines.map(kindOf).join(", ")}`);
    for (const o of lines) info(`  ${kindOf(o)}: ${o.slice(0, 110)}${o.length > 110 ? "..." : ""}`);
  }
  const campaignLines = [a, b].map(
    (run) => gameOpts(run).filter((o) => kindOf(o) === "campaign").length,
  );
  info(`campaign line (C0,...) received: A ${campaignLines[0]}, B ${campaignLines[1]}`);
  for (const run of [a, b]) {
    const seen = [
      ...new Set(run.all.filter((l) => /campaign|co-?op/i.test(l) && !/NO_STRING/.test(l))),
    ];
    info(
      `${run.nick} native lines about the campaign/co-op: ${seen.slice(0, 6).join(" | ").slice(0, 300) || "none"}`,
    );
  }

  if (wantMap)
    for (const run of [a, b]) {
      assert.ok(
        gameOpts(run).some((o) => o.includes(`,${wantMap}.MAP,`)),
        `${run.nick}: the options record names ${wantMap}.MAP`,
      );
      assert.ok(
        !run.all.some((l) => /do not match/i.test(l)),
        `${run.nick}: the game reports mismatching scenarios`,
      );
    }
  for (const run of [a, b]) await until(run, "game frame 300", () => frameOf(run) >= 300, 180000);
  reached.loaded = true;
  check(`the match started and ran: frames A ${frameOf(a)}, B ${frameOf(b)}`);
  await a.page.waitForTimeout(3000);
  assert.deepEqual((await a.state()).size, { w: 1280, h: 960 }, "match coordinates need 1280x960");

  // ---- end it fast: Esc, Abort Mission, Observe, on both
  const size = (await a.state()).size;
  for (const run of [a, b]) {
    await run.page.keyboard.press("Escape");
    await run.page.waitForTimeout(1500);
    await run.clickGame(...sidebar(size, 264)); // Abort Mission
    await waitNative(run, "[dialog] open 0xB6", 0, 20000).catch(() => {});
    await run.page.waitForTimeout(1500);
  }
  for (const run of [a, b]) {
    const from = run.all.length;
    await run.clickGame(...sidebar(size, 264)); // Observe
    if (run === a) await waitNative(run, "OBIWAN MODE", from, 30000);
  }
  for (const run of [a, b]) await waitNative(run, "[dialog] open 0xBC6", 0, 90000);
  check("both reached the score screen (Campaign Results, dialog 0xBC6)");
  reached.score = true;
  if (short) {
    console.log(`PASS ${label}: ${mapLine()}`);
    for (const run of Object.values(clients)) await run.browser.close().catch(() => {});
    process.exit(0);
  }
  await a.page.waitForTimeout(4000);
  await Promise.all([a.shot("score"), b.shot("score")]);

  // ---- C-3: what the game compares (the lead: the game name hash of message 0x0C)
  for (const run of [a, b]) {
    const st = await nameState(run);
    info(`${run.nick} memory: ${JSON.stringify(st)}`);
    await watchPacket(run);
  }

  // ---- C-3: chat on the score screen
  const mark = { t: Date.now(), log: readServerLog().length, a: a.relay.length, b: b.relay.length };
  const bLogMark = b.all.length;
  const bBefore = await chatListPixels(b);
  const aBefore = await chatListPixels(a);
  await a.clickGame(...CHAT_EDIT);
  await a.page.waitForTimeout(300);
  const line = `coop${tag}`;
  await a.page.keyboard.type(line, { delay: 60 });
  await a.page.waitForTimeout(250);
  await a.page.keyboard.press("Enter");
  await a.page.waitForTimeout(5000);
  const sentBy = a.relay.slice(mark.a).filter((f) => f.dir === ">" && f.len > 200);
  const gotBy = b.relay.slice(mark.b).filter((f) => f.dir === "<" && f.len > 200);
  const ownChanged = (await chatListPixels(a)) !== aBefore;
  const partnerChanged = (await chatListPixels(b)) !== bBefore;
  const newRelayLines = readServerLog()
    .slice(mark.log)
    .split("\n")
    .filter((l) => /native relay: .* (new datagram length|has no target|not delivered)/.test(l));
  await Promise.all([a.shot("chat-a"), b.shot("chat-b")]);
  info(`A typed "${line}"; A's own chat list changed: ${ownChanged}`);
  info(`relay frames out of A (>200 bytes): ${sentBy.map((f) => f.len).join(", ") || "none"}`);
  info(`relay frames into B (>200 bytes): ${gotBy.map((f) => f.len).join(", ") || "none"}`);
  for (const l of newRelayLines) info(`server: ${l.replace(/^\[[^\]]*\] /, "")}`);
  // the game's own recvfrom on B (Winsock trace): the chat datagram is the one over 100 bytes
  const netIn = b.all
    .slice(bLogMark)
    .filter(
      (l) => /^\[net\] recvfrom .* \d+ bytes/.test(l) && Number(/ (\d+) bytes/.exec(l)[1]) > 100,
    );
  info(`B's recvfrom with more than 100 bytes after the line: ${netIn.join(" | ") || "none"}`);
  const quiet =
    /fps|Frame \d|sendto|global ack|Sound |NO_STRING|\[net\]|^@ra2|NET_PORT|Response time|IPX Manager|MaxAhead|Timing Event|Send_Packets|NumSendAck|ACK for|Sending ACK/;
  info(
    `B's other native lines after the line: ${
      b.all
        .slice(bLogMark)
        .filter((l) => !quiet.test(l))
        .join(" | ")
        .slice(0, 300) || "none"
    }`,
  );
  for (const run of [a, b]) {
    const packets = await run.page.evaluate(() => window.coopPackets ?? []);
    const chat = packets.filter((p) => p.bytes[0] === 0xc);
    info(
      `${run.nick} packet buffer changes: ${packets.length}; with type 0x0C at +0: ${chat.length}`,
    );
    for (const p of (chat.length ? chat : packets).slice(-2)) {
      const bytes = Uint8Array.from(p.bytes);
      info(
        `  name hash at +0x114: ${le32(bytes, 0x114).toString(16)}; first 0x120 bytes ${hex(bytes.slice(0, 0x120))}`,
      );
    }
    info(`  ${run.nick} after the line: ${JSON.stringify(await nameState(run))}`);
  }
  const udpTrace = b.lines.filter((l) => l.includes("[udp-relay] recv from")).slice(-1)[0] ?? "";
  info(`B's last relay receive: ${udpTrace.slice(0, 120)}`);
  assert.ok(ownChanged, "A's own chat list shows the typed line (the control)");
  assert.ok(sentBy.length > 0, "the game on A sent a datagram for the chat line");
  check("C-3 step 1: A's game sent a datagram for the chat line");
  assert.ok(gotBy.length > 0, "the relay delivered a datagram to B's page");
  check("C-3 step 2: the relay delivered it to B's page");
  console.log(
    `${partnerChanged ? "ok  " : "FOUND"} C-3 step 3: B's game ${partnerChanged ? "drew" : "did NOT draw"} the chat line`,
  );
  if (strict) assert.ok(partnerChanged, "the partner's score screen shows the chat line");

  // ---- C-2: Continue on both, then watch 20 s
  const next = {
    t: Date.now(),
    a: a.all.length,
    b: b.all.length,
    ar: a.relay.length,
    br: b.relay.length,
    ah: a.http.length,
    bh: b.http.length,
    aw: a.wire.length,
    bw: b.wire.length,
  };
  const beforeScreen = await a.page.screenshot();
  // B first by default: with A first the game showed no ready mark for A and waited (--a-first to try that)
  const [first, second] = argv.includes("--a-first") ? [a, b] : [b, a];
  await first.clickGame(...CONTINUE);
  await first.page.waitForTimeout(2000);
  await second.clickGame(...CONTINUE);
  await a.page.waitForTimeout(25000);
  await Promise.all([a.shot("continue-a"), b.shot("continue-b")]);
  const noisy =
    /fps|Frame \d|sendto|global ack|Sound |fps|NO_STRING|\[net\]|^@ra2|NET_PORT|Response time|IPX Manager|MaxAhead|Timing Event|Send_Packets|NumSendAck|ACK for|Sending ACK/;
  for (const run of [a, b]) {
    const m = run === a ? next.a : next.b;
    const lines = run.all.slice(m).filter((l) => !noisy.test(l));
    info(`${run.nick} native lines after Continue: ${lines.length ? "" : "none"}`);
    for (const l of lines.slice(0, 60)) info(`  ${l.slice(0, 140)}`);
    const wire = run.wire
      .slice(run === a ? next.aw : next.bw)
      .filter((w) => !/^(PING|PONG)/.test(w.line));
    info(`${run.nick} WOL frames after Continue: ${wire.length ? "" : "none"}`);
    for (const w of wire.slice(0, 10)) info(`  ${w.dir} ${w.line.slice(0, 120)}`);
    const http = run.http.slice(run === a ? next.ah : next.bh);
    info(`${run.nick} HTTP after Continue: ${http.length ? "" : "none"}`);
    for (const h of http.slice(0, 10)) info(`  ${h.text}`);
    const lengths = new Map();
    for (const f of run.relay.slice(run === a ? next.ar : next.br))
      lengths.set(`${f.dir}${f.len}`, (lengths.get(`${f.dir}${f.len}`) ?? 0) + 1);
    info(
      `${run.nick} relay datagrams after Continue (dir+length: count): ${[...lengths].map(([k, v]) => `${k}:${v}`).join(" ")}`,
    );
  }
  // Does the next mission start? Frame lines after the click, up to 120 s more.
  const framesSince = (run, from) => {
    const frames = run.all
      .slice(from)
      .map((l) => /^\[game\] Frame (\d+),/.exec(l)?.[1])
      .filter(Boolean)
      .map(Number);
    return frames.length ? Math.max(...frames) : 0;
  };
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && !(framesSince(a, next.a) >= 100 && framesSince(b, next.b) >= 100))
    await a.page.waitForTimeout(1000);
  const loaded = [a, b].map((run) =>
    run.all
      .slice(run === a ? next.a : next.b)
      .filter((l) => /Loading|Map|Scenario|\.MAP|mission/i.test(l) && !noisy.test(l)),
  );
  info(
    `after Continue, frames reached: A ${framesSince(a, next.a)}, B ${framesSince(b, next.b)} (next mission ${framesSince(a, next.a) >= 100 && framesSince(b, next.b) >= 100 ? "RUNS" : "did not start"})`,
  );
  for (const [i, run] of [a, b].entries())
    info(
      `${run.nick} map/mission lines after Continue: ${loaded[i].slice(-6).join(" | ").slice(0, 400) || "none"}`,
    );
  info(
    `dialogs after Continue: A ${a.all
      .slice(next.a)
      .filter((l) => l.startsWith("[dialog]"))
      .join(", ")}; B ${b.all
      .slice(next.b)
      .filter((l) => l.startsWith("[dialog]"))
      .join(", ")}`,
  );
  await Promise.all([a.shot("next-a"), b.shot("next-b")]);
  const changed = !beforeScreen.equals(await a.page.screenshot());
  const dialogs = a.all.slice(next.a).filter((l) => l.startsWith("[dialog]"));
  info(`A's screen changed after Continue: ${changed}; dialogs: ${dialogs.join(", ") || "none"}`);
  info(
    `server log after Continue: ${
      readServerLog()
        .slice(mark.log)
        .split("\n")
        .filter((l) => /co-op|coop|native-results|campaign/i.test(l))
        .slice(-6)
        .join(" | ") || "nothing"
    }`,
  );
  console.log(
    `PASS ${label} (${results.length} checks, C-3 step 3 ${partnerChanged ? "ok" : "FOUND: the partner never draws it"})`,
  );
} catch (error) {
  console.error("FAIL:", error?.message ?? error);
  if (wantMap) console.error(`FAIL ${label}: ${mapLine()}`);
  for (const [name, run] of Object.entries(clients)) {
    console.error(`--- ${name} ${run.nick}: last WOL frames`);
    console.error(
      run.wire
        .slice(-12)
        .map((w) => `${w.dir} ${w.line.slice(0, 140)}`)
        .join("\n"),
    );
    console.error(
      run.all
        .filter((l) => l.startsWith("[dialog]"))
        .slice(-8)
        .join(" "),
    );
    await run.shot(`coop-fail-${name}`).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  for (const run of Object.values(clients)) await run.browser.close().catch(() => {});
}
