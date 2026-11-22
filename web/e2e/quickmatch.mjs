// End to end (R1, rows 1-7 and 9 of docs/wol/tasks.md): Quick Match with two web clients against a local
// WOL server. Decision 10 made online play web only, so the web client is the real client.
//
// Start the server first, only through `pnpm wol-server` (started directly, bun reads the live .env and the
// game cannot connect), and Vite, then from web/:
//   STORAGE=memory NATIVE_RANKED_ENABLED=true ADMIN_LEGACY_AUTH=true ADMIN_USERNAMES=qmadmin GSERV_REPORT_WINDOW_SECONDS=30 pnpm wol-server > server.log
//   node e2e/quickmatch.mjs --row 1 --url 'http://127.0.0.1:5175/'             --game ../game --server-log server.log   (YR)
//   node e2e/quickmatch.mjs --row 2 --url 'http://127.0.0.1:5175/?target=game' --game ../game --server-log server.log   (RA2)
// The admin steps (the map pool, the proof, settings, the ladder) use the game account `qmadmin`
// (--admin-user / --admin-pass), which ADMIN_USERNAMES + ADMIN_LEGACY_AUTH make an owner. It is registered
// through POST /register on first use. Players are members (register, a linked game account, a launch
// ticket: the page opens with #ticket=) so a ranked match can score; --guests makes them guests instead.
//
//   --row 1|2   Quick Match on each enabled map the admin proof shows as unproven (or --map STEM): the pool is
//               narrowed to one map at a time through /admin/quick-match/maps/{edition}/{stem}, both clients
//               must be paired, load that map (the options record names it, no "do not match") and run past
//               frame 300, then --hold seconds (default 65: the proof counts a datagram 60 s after the first
//               join as "played"). The proof row for the map is printed before and after. The pool is restored.
//   --row 3     play --minutes (default 3; the game's DURA must reach 120 s), then B surrenders (Esc, Abort Mission): both
//               clients must POST /native-results (seen in the server log), the match scores, and the
//               ladder (GET /ladder) shows it.
//   --row 4     the quitter rule: A's page is closed at --leave-at seconds (default 150) without a report.
//               B is the stayer. Prints what B's game does and whether the match is scored for B.
//               --freeze freezes A's page instead of closing it (no socket close, so gserv sees no drop).
//   --row 5     a match ended by a disconnect: as row 4 (the stayer's report is printed: FINI, CMPn, DURA).
//   --row 6     --countries A,B writes Country= into each client's persona section (wolinfo.ini, section
//               named by the lowercased nick) before Quick Match; the server's `quick match sides ... (asked:
//               ...)` line is compared with the side the game loaded (the sidebar and the loading screen).
//               The match is played --minutes (default 1), then B quits.
//   --row 7     the frame counter of each client against the server log's timestamps.
//   --row 9     one guest and one member in one Quick Match; the match is played, one side surrenders, and
//               nobody is scored (ladder unchanged; the reports get 404 "Unknown native match").
//   --row 10    two guests in a match; the admin's POST /admin/announce pages both, and each game takes the
//               page (shots announce-a, announce-b show its grey message row). With --nameless the setting
//               lobbyBot.namelessAnnouncements is on for the row: a NOTICE, and the row shows the text alone.
//   --row 11    the page's match chat panel (docs/web/match-chat.md), two guests in a match: A presses Enter,
//               types a line (with Thai) and Enter; it shows in B's panel under A's name and in A's own
//               panel; /p (as /page) and /r whisper from the panel; B answers with Backspace (allies: A does not get it) and with \ (all: A does);
//               the game's own keys open the page's line to those targets; an admin announcement shows as a game row
//               in both panels. Shots match-chat-a, match-chat-b.
//
// Options: --server http://127.0.0.1:9090, --server-log FILE (the server's stdout), --label NAME, --guests,
// plus the shared ones of lib.mjs (--game, --shots, --headed). Scratch: --shots.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { options, startPage } from "./lib.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const opts = options(argv);
opts.pageArgs.push("--mute", "--debuglog");
const server = option("--server", "http://127.0.0.1:9090");
const serverLog = option("--server-log", null);
const label = option("--label", "quickmatch");
const row = Number(option("--row", "1"));
const nameless = argv.includes("--nameless");
const wantMap = option("--map", null);
const hold = Number(option("--hold", "65"));
const minutes = Number(option("--minutes", "3"));
const leaveAt = Number(option("--leave-at", "150"));
const guests = argv.includes("--guests");
const freeze = argv.includes("--freeze");
const adminUser = option("--admin-user", "qmadmin");
const adminPass = option("--admin-pass", "qmadminpass1");
const origin = new URL(opts.url).origin;
const ra2 = new URL(opts.url).searchParams.get("target") === "game";
const edition = ra2 ? "ra2" : "yr";
// --countries A,B: the persona file's Country= for client A and B (row 6; -2 random)
const countries = option("--countries", "").split(",").filter(Boolean).map(Number);
const tag = randomBytes(4).toString("hex").slice(0, 5);

// Game pixels (800x600 menus; the match itself runs at the options' 1280x960).
const BACK = [719, 556]; // Back, in the chat lobby (the welcome screen is behind it)
const QUICK_MATCH = [719, 220]; // welcome screen
const sidebar = (size, dy) => [size.w - 87, dy]; // Esc menu on the right edge

const results = [];
const check = (what) => {
  results.push(what);
  console.log(`ok  ${what}`);
};
const info = (what) => console.log(`    ${what}`);

// ---- the server: admin API, members, tickets -----------------------------------------------------

const json = async (response) => response.json().catch(() => ({}));
let adminToken = null;
async function admin(method, path, body) {
  if (!adminToken) {
    // /register answers 200 with an errorCode when the name exists, so look for the token itself
    let data = {};
    for (const path of ["/register", "/login"]) {
      const response = await fetch(`${server}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: adminUser, pass: adminPass }),
      });
      data = await json(response);
      if (data.sessionToken) break;
    }
    assert.ok(data.sessionToken, `admin sign-in as ${adminUser}: ${JSON.stringify(data)}`);
    adminToken = data.sessionToken;
  }
  const response = await fetch(`${server}${path}`, {
    method,
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await json(response);
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function post(path, body, headers = {}) {
  const response = await fetch(`${server}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...headers },
    body: JSON.stringify(body),
  });
  const data = await json(response);
  assert.ok(response.ok, `${path}: ${response.status} ${data.errorCode ?? ""}`);
  return data;
}

/** A launch ticket for a new game account of a new member, or for a guest. */
async function ticketFor(nick, guest) {
  if (guest) return { ...(await post("/v1/auth/guest", { nick, edition })), guest: true };
  const session = await post("/v1/members/register", { login: nick, password: "memberpass1" });
  const bearer = { authorization: `Bearer ${session.accessToken}` };
  await post("/v1/members/game-accounts", { username: nick, password: "memberpass1" }, bearer);
  return post("/v1/auth/launch-ticket", { gameAccount: nick, edition }, bearer);
}

const readServerLog = () =>
  serverLog && existsSync(serverLog) ? readFileSync(serverLog, "utf8") : "";
const logLines = (from = 0) => readServerLog().slice(from).split("\n");

const proofOf = async (stem) =>
  (await admin("GET", "/admin/quick-match/maps")).proof?.find(
    (p) =>
      p.edition === edition && p.mode === "quick" && p.stem.toUpperCase() === stem.toUpperCase(),
  );

// ---- the clients ---------------------------------------------------------------------------------

const clients = {};
let opened = 0;
async function open(name, guest) {
  // a nick is 2-9 characters: kind, side, the run's tag, a counter (a map loop opens several pairs)
  const minted = await ticketFor(`${guest ? "z" : "m"}${name}${tag}${opened++}`, guest);
  const url = new URL(opts.url);
  url.hash = `ticket=${minted.ticket}`;
  url.searchParams.set("udptrace", "1");
  const run = await startPage({ ...opts, url: url.toString(), shots: `${opts.shots}/qm-${name}` });
  run.name = name;
  run.nick = minted.user;
  run.guest = guest;
  run.wire = []; // WOL chat frames: { t, dir, line }
  run.http = []; // requests to the server other than the chat socket: { t, text }
  run.frames = []; // { t, frame } each time the game's frame counter moved
  const wsBase = server.replace(/^http/, "ws");
  run.page.on("websocket", (ws) => {
    if (!ws.url().startsWith(wsBase) || ws.url().includes("/gserv")) return;
    const add = (dir) => (f) => {
      for (const line of String(f.payload).split(/\r?\n/))
        if (line) run.wire.push({ t: Date.now(), dir, line });
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
/** Samples the frame counter into run.frames until the page closes (a sample is dropped when unchanged). */
function sampleFrames(run) {
  const timer = setInterval(() => {
    const frame = frameOf(run);
    if (frame && frame !== run.frames.at(-1)?.frame) run.frames.push({ t: Date.now(), frame });
  }, 250);
  run.stopSampling = () => clearInterval(timer);
}

async function toWelcome(run) {
  await run.waitFor(`${run.nick} main menu`, (s) => s?.phase === "running", 300);
  await run.page.waitForTimeout(1500);
  await run.clickGame(720, 263); // Multiplayer
  await waitNative(run, "[dialog] open 0x10E");
  await run.page.waitForTimeout(800);
  const from = run.all.length;
  await run.clickGame(720, ra2 ? 263 : 305); // Internet
  await waitNative(run, "Joined Channel", from, 60000);
  await run.page.waitForTimeout(3000);
  assert.ok(
    !run.all.slice(from).some((l) => l.startsWith("[dialog] open") && l.includes("0x10F")),
    `${run.nick}: no login dialog`,
  );
  const lobby = run.all.length;
  await run.clickGame(...BACK); // the welcome screen: Quick Match ...
  await waitNative(run, "[dialog] open 0x10E", lobby);
  await run.page.waitForTimeout(2500);
}

const gameOpts = (run) =>
  run.wire
    .filter((w) => w.dir === "<" && / GAMEOPT /.test(w.line))
    .map((w) => w.line.slice(w.line.indexOf(" :", w.line.indexOf("GAMEOPT")) + 2));

/** Both clients on the welcome screen: Quick Match, paired, loaded, past frame 300. */
/**
 * The game's own persona file holds the player's Country= and Color= (the Quick Match request's COU and
 * COL come from the section named by the lowercased nick). Rewritten in the game's file system, the
 * way the loader's stageLaunchLogin writes it: unlink first, because a write over a file appends.
 */
async function setPersona(run, country) {
  const file = ra2 ? "wolinfo.ini" : "wolinfoMD.ini";
  const result = await run.page.evaluate(
    ({ file, nick, country }) => {
      const FS = window.Module.FS;
      const name = FS.readdir("/game").find((e) => e.toLowerCase() === file.toLowerCase()) ?? file;
      const path = "/game/" + name;
      let text = "";
      try {
        text = new TextDecoder().decode(FS.readFile(path));
      } catch {
        /* no file yet */
      }
      const cr = String.fromCharCode(13);
      const lf = String.fromCharCode(10);
      const eol = text.includes(cr + lf) ? cr + lf : lf;
      const lines = text.length ? text.split(lf).map((l) => l.split(cr).join("")) : [];
      if (lines.length && lines.at(-1) === "") lines.pop();
      const header = "[" + nick.toLowerCase() + "]";
      let start = lines.findIndex((l) => l.trim().toLowerCase() === header);
      if (start < 0) {
        lines.push(header);
        start = lines.length - 1;
      }
      let end = start + 1;
      while (end < lines.length && !lines[end].trim().startsWith("[")) end++;
      const body = lines
        .slice(start + 1, end)
        .filter((l) => !l.trim().toLowerCase().startsWith("country"));
      lines.splice(start + 1, end - start - 1, "Country=" + country, ...body);
      try {
        FS.unlink(path);
      } catch {
        /* nothing to remove */
      }
      FS.writeFile(path, new TextEncoder().encode(lines.join(eol) + eol));
      return path + ": " + lines.slice(start, start + 4).join(" | ");
    },
    { file, nick: run.nick, country },
  );
  info(`persona file ${result}`);
}

async function startMatch(a, b, { map } = {}) {
  const logMark = readServerLog().length;
  await Promise.all([toWelcome(a), toWelcome(b)]);
  if (countries.length === 2) {
    await setPersona(a, countries[0]);
    await setPersona(b, countries[1]);
  }
  await a.clickGame(...QUICK_MATCH);
  await b.clickGame(...QUICK_MATCH);
  for (const run of [a, b])
    await until(
      run,
      "STARTG",
      () => run.wire.some((w) => w.dir === "<" && / STARTG /.test(w.line)),
      120000,
    );
  check("both clients were paired by the matchbot (STARTG)");
  const record = gameOpts(a).find((o) => /\.MAP,/.test(o)) ?? "";
  const stem = /,([A-Z0-9_]+)\.MAP,/i.exec(record)?.[1] ?? null;
  info(`the options record names the map ${stem}`);
  if (map)
    for (const run of [a, b])
      assert.ok(
        gameOpts(run).some((o) => o.includes(`,${map}.MAP,`)),
        `${run.nick}: the options record names ${map}.MAP`,
      );
  for (const run of [a, b]) await until(run, "game frame 300", () => frameOf(run) >= 300, 180000);
  const mismatch = [a, b].some((run) => run.all.some((l) => /do not match/i.test(l)));
  assert.ok(!mismatch, "a game reports mismatching scenarios");
  check(`both ran past the first frame: frames A ${frameOf(a)}, B ${frameOf(b)}`);
  for (const run of [a, b]) sampleFrames(run);
  const lines = logLines(logMark);
  const text = lines.join(String.fromCharCode(10));
  const sides = /quick match sides (\d+),(\d+)/.exec(text);
  // The record lists the players in the order the matchbot paired them, which is not always A then B.
  const roster = /created \(ranked 1v1\) for (\w+), (\w+)/.exec(text);
  if (sides) {
    const byNick = roster ? { [roster[1]]: Number(sides[1]), [roster[2]]: Number(sides[2]) } : {};
    a.country = byNick[a.nick] ?? Number(sides[1]);
    b.country = byNick[b.nick] ?? Number(sides[2]);
    info(`the server wrote the countries ${a.country} (${a.nick}) and ${b.country} (${b.nick})`);
  }
  return { stem, logMark, lines };
}

/**
 * Esc, Abort Mission, then Quit (the player is out; the other side's game ends). Where the Esc menu's buttons
 * sit depends on the edition's sidebar art, not on the side: Red Alert 2 has Game Controls at 264, Abort
 * Mission at 314 and then Quit at 264; Yuri's Revenge 239, 264 and then Quit at 239.
 */
async function surrender(run) {
  const size = (await run.state()).size;
  await run.page.keyboard.press("Escape");
  await run.page.waitForTimeout(1500);
  await run.shot(`esc-${run.name}`);
  await run.clickGame(...sidebar(size, ra2 ? 314 : 264)); // Abort Mission
  await run.page.waitForTimeout(1500);
  await run.shot(`abort-${run.name}`);
  await run.clickGame(...sidebar(size, ra2 ? 264 : 239)); // Quit
}

const section = (text) => console.log(`\n== ${text}`);

// ---- rows ----------------------------------------------------------------------------------------

async function rowMaps() {
  const maps = (await admin("GET", "/admin/quick-match/maps")).maps.filter(
    (m) => m.edition === edition && m.mode === "quick",
  );
  const proof = (await admin("GET", "/admin/quick-match/maps")).proof ?? [];
  const status = (m) =>
    proof.find((p) => p.edition === m.edition && p.mode === "quick" && p.stem === m.stem)?.status ??
    "unproven";
  const todo = (
    wantMap ? maps.filter((m) => m.stem.toUpperCase() === wantMap.toUpperCase()) : maps
  ).filter((m) => m.enabled && (wantMap || status(m) !== "proven"));
  info(`unproven enabled ${edition} maps: ${todo.map((m) => m.stem).join(", ") || "none"}`);
  assert.ok(todo.length, "no unproven enabled map to check");
  const wasEnabled = new Map(maps.map((m) => [m.stem, m.enabled]));
  const outcome = [];
  try {
    for (const map of todo) {
      section(`${edition} map ${map.stem}`);
      for (const other of maps)
        // the pool holds only this map
        await admin("POST", `/admin/quick-match/maps/${edition}/${other.stem}`, {
          enabled: other.stem === map.stem,
        });
      info(`proof before: ${JSON.stringify(await proofOf(map.stem))}`);
      const a = await open("a", guests);
      const b = await open("b", guests);
      try {
        const match = await startMatch(a, b, { map: map.stem });
        info(`holding ${hold} s`);
        await a.page.waitForTimeout(hold * 1000);
        info(`frames after the hold: A ${frameOf(a)}, B ${frameOf(b)}`);
        const sides = match.lines.filter((l) => /quick match (map|sides)/.test(l));
        for (const l of sides) info(`server: ${l.replace(/^\[[^\]]*\] \[[^\]]*\] /, "")}`);
        await a.shot("held");
        await a.page.waitForTimeout(1000);
        const proof = await proofOf(map.stem);
        info(`proof after: ${JSON.stringify(proof)}`);
        outcome.push({ stem: map.stem, frames: [frameOf(a), frameOf(b)], proof: proof?.status });
      } finally {
        for (const run of [a, b]) {
          run.stopSampling?.();
          await run.browser.close().catch(() => {});
        }
        delete clients.a;
        delete clients.b;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    for (const [stem, enabled] of wasEnabled)
      await admin("POST", `/admin/quick-match/maps/${edition}/${stem}`, { enabled });
  }
  for (const o of outcome)
    console.log(`MAP ${edition} ${o.stem}: ran to frame ${o.frames.join(", ")}, proof ${o.proof}`);
}

// ---- what the server saw ---------------------------------------------------------------------------

const stamp = (line) => Date.parse(/^\[([^\]]+)\]/.exec(line)?.[1] ?? "") || 0;
/** The game id the relay joined this player to, after log offset `from`. */
const gameIdOf = (nick, from) =>
  new RegExp(`native relay: ${nick} joined (g\\S+) as`).exec(readServerLog().slice(from))?.[1];
const linesOf = (gameId, from) => logLines(from).filter((l) => l.includes(gameId));
const settled = (gameId, from) =>
  logLines(from).find((l) => l.includes(`settlement: ${gameId} `) && /-> (\w+)/.test(l));
const waitLog = async (test, ms) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = test();
    if (found) return found;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 1000));
  }
};

/** The fields of a native result packet (the server's decodeNativeGameRes, reduced to what R1 reads). */
function decodeReport(bytes) {
  const out = {};
  for (let at = 4; at + 8 <= bytes.length;) {
    const name = bytes.subarray(at, at + 4).toString("latin1");
    const type = bytes.readUInt16BE(at + 4);
    const length = bytes.readUInt16BE(at + 6);
    const data = bytes.subarray(at + 8, at + 8 + length);
    let value;
    if (type === 7) value = data.subarray(0, -1).toString("latin1");
    else if (type >= 1 && type <= 6 && length === 4) value = data.readUInt32BE(0);
    else if (type >= 1 && type <= 6 && length === 1) value = data[0];
    if (value !== undefined) out[name] = value;
    at += 8 + Math.ceil(length / 4) * 4;
  }
  return out;
}

/** Keeps the result report each page POSTs, and the server's answer, on run.reports. */
function watchReports(run) {
  run.reports = [];
  run.page.on("request", (r) => {
    if (r.method() !== "POST" || !new URL(r.url()).pathname.startsWith("/native-results/")) return;
    const body = r.postDataBuffer();
    run.reports.push({
      t: Date.now(),
      gameId: new URL(r.url()).pathname.split("/").pop(),
      report: body ? decodeReport(body) : {},
    });
  });
  run.page.on("response", async (r) => {
    if (!new URL(r.url()).pathname.startsWith("/native-results/")) return;
    const entry = run.reports.at(-1);
    if (!entry) return;
    entry.status = r.status();
    entry.answer = await r.text().catch(() => "");
  });
}
const showReport = (run) => {
  for (const r of run.reports) {
    const f = r.report;
    info(
      `${run.nick} POST /native-results/${r.gameId} -> ${r.status} ${r.answer ?? ""} | FINI=${f.FINI} OOSY=${f.OOSY} DURA=${f.DURA} CMP0=${f.CMP0} CMP1=${f.CMP1} NAM0=${f.NAM0} NAM1=${f.NAM1} GSKU=${f.GSKU}`,
    );
  }
  if (!run.reports.length) info(`${run.nick} sent no result report`);
};

const skuOf = ra2 ? 16640 : 18688;
const profileOf = async (nick) => {
  const response = await fetch(`${server}/players/${nick}?sku=${skuOf}&ladderType=1v1`);
  return response.ok ? await json(response) : { status: response.status };
};

/** Frames against the server's timestamps: how fast does the game's frame counter run? */
function frameReport(run, gameId, from) {
  const samples = run.frames;
  if (samples.length < 2) return info(`${run.nick}: too few frame samples`);
  const first = samples.find((x) => x.frame >= 300) ?? samples[0];
  const last = samples.at(-1);
  const fps = (last.frame - first.frame) / ((last.t - first.t) / 1000);
  info(
    `${run.nick} frames ${first.frame} -> ${last.frame} in ${((last.t - first.t) / 1000).toFixed(1)} s of the harness clock: ${fps.toFixed(1)} frames/s`,
  );
  const mine = linesOf(gameId, from);
  const joined = stamp(mine.find((l) => new RegExp(`${run.nick} joined`).test(l)) ?? "");
  const at = (t) => samples.findLast((x) => x.t <= t)?.frame;
  const report = run.reports[0];
  const posted = stamp(mine.find((l) => /POST \/native-results/.test(l)) ?? "");
  if (joined && posted && report) {
    const reportFrame = at(posted);
    const seconds = (posted - joined) / 1000;
    info(
      `${run.nick} server log: relay join ${new Date(joined).toISOString()}, report ${new Date(posted).toISOString()} (${seconds.toFixed(1)} s); the frame counter was ${reportFrame}, so ${(reportFrame / seconds).toFixed(1)} frames/s over the whole game; the game's DURA says ${report.report.DURA}`,
    );
  }
}

/** Rows 3, 7 and 9: play `minutes`, B surrenders, read the reports, the settlement and the profiles. */
async function rowPlay() {
  const seconds = Math.round(minutes * 60);
  const a = await open("a", row === 9 ? true : guests);
  const b = await open("b", row === 9 ? false : guests);
  for (const run of [a, b]) watchReports(run);
  const { logMark, stem } = await startMatch(a, b);
  const gameId = gameIdOf(a.nick, logMark);
  assert.ok(gameId, "the relay joined the players to a game");
  info(`game ${gameId} on ${stem}, ${seconds} s of play, then ${b.nick} quits`);
  const before = await Promise.all([a, b].map((run) => profileOf(run.nick)));
  await a.page.waitForTimeout(seconds * 1000);
  info(`frames before the quit: A ${frameOf(a)}, B ${frameOf(b)}`);
  for (const l of logLines(logMark).filter((x) => /quick match (map|sides)/.test(x)))
    info(`server: ${l.replace(/^\[[^\]]*\] \[[^\]]*\] /, "")}`);
  await a.shot("before-quit");
  await surrender(b);
  await waitLog(() => a.reports.length > 0 && b.reports.length > 0, 90000);
  const outcome = await waitLog(() => settled(gameId, logMark), 30000);
  for (const run of [a, b]) {
    showReport(run);
    frameReport(run, gameId, logMark);
  }
  for (const l of linesOf(gameId, logMark).filter((x) =>
    /settlement|native results|ladder/.test(x),
  ))
    info(`server: ${l.replace(/^\[[^\]]*\] /, "")}`);
  await a.page.waitForTimeout(2000);
  const after = await Promise.all([a, b].map((run) => profileOf(run.nick)));
  info(`profiles before: ${JSON.stringify(before)}`);
  info(`profiles after:  ${JSON.stringify(after)}`);
  await a.shot("after-a");
  await b.shot("after-b");
  if (row === 3) {
    for (const run of [a, b])
      assert.ok(
        run.reports.some((r) => r.status === 200),
        `${run.nick}: the report was accepted`,
      );
    check("both clients POSTed /native-results and the server accepted both");
    assert.ok(
      outcome && /-> scored/.test(outcome),
      `the match is scored: ${outcome ?? "no settlement line"}`,
    );
    check(`settlement: ${outcome.replace(/^\[[^\]]*\] \[[^\]]*\] /, "")}`);
    // The game's own stats (the welcome screen's persona) follow the scored match: the shim reads the
    // own record again after the result (and on the server's 730) and writes it to the persona file.
    // Start the server with PLACEMENT_MATCHES=1 so that one match places both players.
    if (argv.includes("--placed")) {
      const persona = (run) =>
        run.all.findLast((l) => l.includes(`[wol] persona ${run.nick.toLowerCase()}:`));
      for (const run of [a, b]) {
        const deadline = Date.now() + 90000;
        while (!persona(run) && Date.now() < deadline) await run.page.waitForTimeout(1000);
        assert.ok(persona(run), `${run.nick}: the persona stats were updated after the match`);
        info(persona(run));
      }
      assert.match(persona(a), /wins 1 losses 0/, "the winner's persona shows the win");
      assert.match(persona(b), /wins 0 losses 1/, "the quitter's persona shows the loss");
      check("both personas show the scored match's real numbers");
    }
  }
  if (row === 9) {
    const admitted = logLines(logMark).some(
      (l) => /settlement: admitted/.test(l) && l.includes(gameId),
    );
    assert.ok(!admitted, "a match with a guest is not admitted to settlement");
    assert.ok(!outcome || !/-> scored/.test(outcome), "nobody is scored");
    check("the guest + member match was not admitted and nobody was scored");
    assert.deepEqual(after, before, "no standing changed");
    check("both profiles are as before the match");
  }
}

/** Rows 4 and 5: A leaves without a report; B stays. */
async function rowQuit() {
  const a = await open("a", guests);
  const b = await open("b", guests);
  for (const run of [a, b]) watchReports(run);
  const { logMark, stem } = await startMatch(a, b);
  const gameId = gameIdOf(a.nick, logMark);
  assert.ok(gameId, "the relay joined the players to a game");
  info(
    `game ${gameId} on ${stem}; ${a.nick} leaves at ${leaveAt} s${freeze ? " (page frozen, no close)" : " (page closed)"}`,
  );
  await a.page.waitForTimeout(leaveAt * 1000);
  info(`B's frame at the leave: ${frameOf(b)}`);
  const leftAt = Date.now();
  a.stopSampling?.();
  if (freeze) {
    const cdp = await a.page.context().newCDPSession(a.page);
    await cdp.send("Page.enable");
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  } else {
    await a.browser.close().catch(() => {});
  }
  const stay = Number(option("--stay", "240"));
  const seen = new Set();
  let lastFrame = frameOf(b);
  for (let s = 0; s < stay; s += 5) {
    await b.page.waitForTimeout(5000);
    const dialogs = b.all
      .filter((l) => l.startsWith("[dialog] open"))
      .slice(-3)
      .join(" ");
    const key = `${dialogs}|${b.reports.length}`;
    if (!seen.has(key)) {
      seen.add(key);
      info(
        `+${((Date.now() - leftAt) / 1000).toFixed(0)} s: B frame ${frameOf(b)}, dialogs ${dialogs}, reports ${b.reports.length}`,
      );
      await b.shot(`stay-${s}`);
    }
    if (b.reports.length) break;
    if (frameOf(b) === lastFrame && s % 30 === 25)
      info(`B's frame counter is stuck at ${lastFrame}`);
    lastFrame = frameOf(b);
  }
  showReport(b);
  const outcome = await waitLog(
    () => settled(gameId, logMark),
    Number(option("--settle-wait", "180")) * 1000,
  );
  for (const l of linesOf(gameId, logMark).filter((x) =>
    /settlement|native results|ladder|left/.test(x),
  ))
    info(`server: ${l.replace(/^\[[^\]]*\] /, "")}`);
  info(`outcome: ${outcome ?? "no settlement line yet"}`);
  const [pa, pb] = await Promise.all([profileOf(a.nick), profileOf(b.nick)]);
  info(`profiles: leaver ${JSON.stringify(pa)}; stayer ${JSON.stringify(pb)}`);
  const f = b.reports[0]?.report;
  if (f)
    check(
      `the stayer's report: FINI=${f.FINI}, DURA=${f.DURA}, server answered ${b.reports[0].status}`,
    );
}

/**
 * Row 10: an announcement during a match. Two guests play; POST /admin/announce (all lobbies) pages both,
 * since neither is in a chat lobby: the server's `PAGE <nick>` reaches each page, the shim hands it to the
 * game's UTF-16 page sink (`[wol] page from YuriBOT`), and the game draws it as a grey message row, which
 * the shots `announce-a` and `announce-b` show.
 */
async function rowAnnounce() {
  const a = await open("a", true);
  const b = await open("b", true);
  await startMatch(a, b);
  const text = `Announcement test ${tag}: the server restarts soon.`;
  const marks = [a, b].map((run) => ({ wire: run.wire.length, log: run.all.length }));
  const setting = "/admin/settings/lobbyBot.namelessAnnouncements";
  if (nameless) info(`nameless: ${JSON.stringify(await admin("PUT", setting, { value: true }))}`);
  let sent;
  try {
    sent = await admin("POST", "/admin/announce", { text });
  } finally {
    if (nameless) await admin("DELETE", setting);
  }
  info(`announce: ${JSON.stringify(sent)}`);
  const command = nameless ? "NOTICE" : "PAGE";
  for (const [i, run] of [a, b].entries()) {
    await until(run, `the ${command} from YuriBOT`, () =>
      run.wire
        .slice(marks[i].wire)
        .some((w) => w.dir === "<" && w.line.includes(` ${command} `) && w.line.includes(text)),
    );
    await waitNative(
      run,
      `[wol] ${nameless ? "notice" : "page"} from YuriBOT`,
      marks[i].log,
      15000,
    );
  }
  check(`both players in the match got the ${command} and their games took it`);
  // the game types the row out a character at a time
  await a.page.waitForTimeout(4000);
  await Promise.all([a.shot("announce-a"), b.shot("announce-b")]);
  info(`frames after the announcement: A ${frameOf(a)}, B ${frameOf(b)}`);
}

/** As until, for a test that returns a promise. */
const untilAsync = async (run, what, test, ms = 60000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await test()) return;
    assert.ok(Date.now() < deadline, `${run.nick}: timed out waiting for ${what}`);
    await run.page.waitForTimeout(200);
  }
};

/** The game's own chat key opens the page's line: Enter to Chat, Backspace to allies, \ to all. */
/** Enter opens to the target last used in the match (everyone at first). */
const CHAT_KEYS = { Enter: "all", Backspace: "allies", Backslash: "all" };

async function chatFrom(run, text, key = "Enter", to = CHAT_KEYS[key]) {
  await run.page.locator("canvas").first().focus();
  await run.page.keyboard.press(key);
  const box = run.page.getByRole("textbox", { name: `Message to ${to}` });
  await box.waitFor({ timeout: 10000 });
  await box.fill(text);
  await box.press("Enter");
  await box.waitFor({ state: "detached", timeout: 10000 });
}

const panelHas = (run, text) =>
  run.page
    .getByRole("region", { name: "Match chat" })
    .textContent({ timeout: 1000 })
    .then((t) => (t ?? "").includes(text))
    .catch(() => false);

async function rowChat() {
  const a = await open("a", true);
  const b = await open("b", true);
  await startMatch(a, b);
  for (const run of [a, b])
    await untilAsync(run, "the chat panel's prompt", () =>
      run.page
        .getByRole("button", { name: /press Enter to chat/ })
        .count()
        .then((n) => n > 0),
    );
  check("both pages show the match chat panel");
  const first = `hello from A ${tag}`;
  await chatFrom(a, `${first} สวัสดี`);
  await untilAsync(b, "A's line in B's panel", () => panelHas(b, first), 20000);
  await untilAsync(a, "A's own line in A's panel", () => panelHas(a, first), 20000);
  check("A's line went through the game to B, and A's panel shows it too");
  const second = `answer from B ${tag}`;
  await chatFrom(b, second, "Backspace");
  await untilAsync(b, "B's own allies line", () => panelHas(b, `[Allies] ${b.nick}`), 20000);
  info(
    `B's allies line reached A: ${await panelHas(a, second)} (A is not B's ally, so false is right)`,
  );
  const third = `to all again ${tag}`;
  // B used Allies last: Enter now opens to allies (remembered for this match)
  const remembered = `still allies ${tag}`;
  await chatFrom(b, remembered, "Enter", "allies");
  await chatFrom(b, third, "Backslash");
  await untilAsync(a, "B's line in A's panel", () => panelHas(a, third), 20000);
  assert.ok(!(await panelHas(a, remembered)), "B's remembered allies line stays with B's allies");
  check("B sent to allies (A did not get it) and to everyone (A got it)");
  const text = (run) =>
    run.page
      .getByRole("region", { name: "Match chat" })
      .textContent()
      .catch(() => "");
  info(`A's panel: ${await text(a)}`);
  info(`B's panel: ${await text(b)}`);
  for (const [name, run] of [
    ["A", a],
    ["B", b],
  ])
    info(
      `${name}'s matchChatReady events: ${run.all.filter((l) => l.includes('"matchChatReady"')).length}`,
    );
  assert.ok(
    (await panelHas(b, second)) && (await panelHas(b, third)),
    "B's panel keeps B's own lines",
  );
  // whispers from the panel: /p (the page's /page) and /r, the game's online commands in a match
  const whisper = `psst ${tag}`;
  await chatFrom(a, `/p ${b.nick} ${whisper}`);
  await untilAsync(b, "A's /p in B's panel", () => panelHas(b, whisper), 20000);
  const answer = `got it ${tag}`;
  await chatFrom(b, `/r ${answer}`, "Backslash");
  await untilAsync(a, "B's /r in A's panel", () => panelHas(a, answer), 20000);
  check("A paged B from the panel with /p, and B answered with /r");
  // the game's own rows reach the panel too: YuriBOT's page, read-only
  const notice = `Panel announcement ${tag}`;
  info(`announce: ${JSON.stringify(await admin("POST", "/admin/announce", { text: notice }))}`);
  for (const run of [a, b])
    await untilAsync(run, "the announcement row in the panel", () => panelHas(run, notice), 30000);
  check("the server's announcement shows as a game row in both panels");
  await a.page.mouse.move(60, a.page.viewportSize().height - 60);
  await a.page.waitForTimeout(800);
  await Promise.all([a.shot("match-chat-a"), b.shot("match-chat-b")]);
}

const ROWS = {
  11: rowChat,
  10: rowAnnounce,
  1: rowMaps,
  2: rowMaps,
  3: rowPlay,
  4: rowQuit,
  5: rowQuit,
  6: rowPlay,
  7: rowPlay,
  9: rowPlay,
};

try {
  const run = ROWS[row];
  assert.ok(run, `row ${row} is not implemented`);
  console.log(
    `${label}: row ${row}, ${edition.toUpperCase()}, ${guests ? "guests" : "members"}, tag ${tag}`,
  );
  await run();
  console.log(`PASS ${label} row ${row} (${results.length} checks)`);
} catch (error) {
  console.error("FAIL:", error?.message ?? error);
  for (const [name, c] of Object.entries(clients)) {
    console.error(`--- ${name} ${c.nick}: last WOL frames`);
    console.error(
      c.wire
        .slice(-12)
        .map((w) => `${w.dir} ${w.line.slice(0, 140)}`)
        .join("\n"),
    );
    console.error(
      c.all
        .filter((l) => l.startsWith("[dialog]") || l.startsWith("[match chat]"))
        .slice(-8)
        .join(" "),
    );
    await c.shot(`qm-fail-${name}`).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  for (const c of Object.values(clients)) {
    c.stopSampling?.();
    await c.browser.close().catch(() => {});
  }
}
