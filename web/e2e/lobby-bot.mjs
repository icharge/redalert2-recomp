// End to end (LB-8): the lobby bot YuriBOT with two web clients against a local WOL server.
// Start the server first (`pnpm wol-server`, port 9090; STORAGE=memory keeps it clean) and Vite, then
// from web/, once per edition:
//   node e2e/lobby-bot.mjs --url 'http://127.0.0.1:5175/?target=game' --game ../game      (RA2)
//   node e2e/lobby-bot.mjs --url 'http://127.0.0.1:5175/' --game ../game                  (YR)
// Two pages, each its own Chrome, sign in as two guests (POST /v1/auth/guest gives a ticket; the page
// opens with #ticket=, as in launch-login.mjs), press Internet and reach the chat lobby (#Lob_33_0 RA2,
// #Lob_41_0 YR). Everything is checked on the chat WebSocket's frames and the game's own log lines:
//   - YuriBOT is in both players' NAMES list (353)
//   - A types /help in the lobby's chat edit (native keys): a private PRIVMSG from YuriBOT comes back to A,
//     and the lobby sees no /help line: B's socket never carries that text
//   - B joining is announced by YuriBOT to the lobby (a channel line both receive)
//   - A selects YuriBOT in the Players list and types a line: a private reply comes back
//   - A types /who: the reply names both players
// Options: --server http://127.0.0.1:9090, plus the shared ones (--game, --shots, --headed).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { isWolChatSocket, startPage, options } from "./lib.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const opts = options(argv);
opts.pageArgs.push("--mute", "--debuglog");
const server = option("--server", "http://127.0.0.1:9090");
const ra2 = new URL(opts.url).searchParams.get("target") === "game";
const edition = ra2 ? "ra2" : "yr";
const lobby = `#Lob_${ra2 ? 33 : 41}_0`;
const origin = new URL(opts.url).origin;
const tag = randomBytes(4).toString("hex").slice(0, 5);
const BOT = "YuriBOT";

// The lobby screen's controls in the game's 800x600 pixels (read off the lobby in both editions): the
// chat edit is the same row; the Players list is the middle column, one row every 18.75, starting at
// y 46 in RA2 and 66 in YR (YR's has a header row of sort buttons). YuriBOT is the lobby's operator, and
// both editions keep operators at the top of the list, so it is the first row.
const CHAT_EDIT = [300, 545];
const BOT_ROWS = [0, 1, 2];
const PLAYER_ROW = (k) => [360, (ra2 ? 46 : 66) + 18.75 * k];

async function guestTicket(nick) {
  const response = await fetch(`${server}/v1/auth/guest`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ nick, edition }),
  });
  const data = await response.json().catch(() => ({}));
  assert.ok(response.ok, `/v1/auth/guest: ${response.status} ${data.errorCode ?? ""}`);
  return data;
}

const clients = {};
async function open(name) {
  // z-nicks sort after YuriBOT and keep the Players list short; two distinct guests
  const nick = `z${name}${tag}`;
  const minted = await guestTicket(nick);
  const url = new URL(opts.url);
  url.hash = `ticket=${minted.ticket}`;
  const run = await startPage({
    ...opts,
    url: url.toString(),
    shots: `${opts.shots}/lobby-bot-${name}`,
  });
  run.nick = minted.user;
  run.wire = []; // { dir: "<" | ">", line }
  run.page.on("websocket", (ws) => {
    if (!isWolChatSocket(ws.url(), server, opts.url)) return;
    const add = (dir) => (f) => {
      for (const line of String(f.payload).split(/\r?\n/)) if (line) run.wire.push({ dir, line });
    };
    ws.on("framesent", add(">"));
    ws.on("framereceived", add("<"));
  });
  clients[name] = run;
  return run;
}

const until = async (run, what, test, ms = 20000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = test();
    if (found) return found;
    assert.ok(Date.now() < deadline, `${run.nick}: timed out waiting for ${what}`);
    await run.page.waitForTimeout(100);
  }
};
const nativeSeen = (run, text, from = 0) => run.all.slice(from).some((l) => l.includes(text));
const waitNative = (run, text, from = 0, ms = 30000) =>
  until(run, `native ${text}`, () => nativeSeen(run, text, from), ms);

/** A private PRIVMSG from the bot to this player, after wire index `from`. */
const botReply = (run, from, pattern) =>
  run.wire.findIndex(
    (w, i) =>
      i >= from &&
      w.dir === "<" &&
      w.line.startsWith(`:${BOT}!`) &&
      w.line.includes(` PRIVMSG ${run.nick} :`) &&
      (!pattern || pattern.test(w.line)),
  ) >= 0;

/** Type a line into the lobby chat edit with the native keys and send it. */
async function say(run, text) {
  await run.clickGame(...CHAT_EDIT);
  await run.page.waitForTimeout(150);
  await run.page.keyboard.type(text, { delay: 60 });
  await run.page.waitForTimeout(250);
  await run.page.keyboard.press("Enter");
}

async function toLobby(run) {
  await run.waitFor(`${run.nick} main menu`, (s) => s?.phase === "running", 300);
  assert.deepEqual((await run.state()).size, { w: 800, h: 600 }, "menu coordinates need 800x600");
  await run.page.waitForTimeout(1500);
  const before = run.all.length;
  await run.clickGame(720, 263); // Internet / LAN
  await waitNative(run, "[dialog] open 0x10E", before);
  await run.page.waitForTimeout(800);
  const internet = run.all.length;
  await run.clickGame(720, ra2 ? 263 : 305); // Internet
  await waitNative(run, "Joined Channel", internet, 40000);
  await until(run, `own JOIN of ${lobby}`, () =>
    run.wire.some(
      (w) =>
        w.dir === "<" &&
        w.line.includes(`:${run.nick}!`) &&
        w.line.includes(` JOIN `) &&
        w.line.includes(lobby),
    ),
  );
  assert.ok(
    !run.all.slice(internet).some((l) => l.startsWith("[dialog] open") && l.includes("0x10F")),
    `${run.nick}: no login dialog`,
  );
  await run.page.waitForTimeout(2500); // the lobby paints, the chat edit takes focus
}

const results = [];
const check = (what) => {
  results.push(what);
  console.log(`ok  ${what}`);
};

try {
  const a = await open("a");
  const b = await open("b");
  console.log(`${edition.toUpperCase()}: ${a.nick} and ${b.nick}, lobby ${lobby}`);
  // One after the other: the checks below need a in the lobby before b joins (b's JOIN and the bot's
  // announcement of it reach a); together, b sometimes arrived first and the run timed out.
  await toLobby(a);
  await toLobby(b);

  // 1. YuriBOT is in both players' NAMES lists (a 353 for the chat lobby that names the bot)
  for (const run of [a, b]) {
    await until(run, `NAMES with ${BOT}`, () =>
      run.wire.some(
        (w) =>
          w.dir === "<" && / 353 /.test(w.line) && w.line.includes(lobby) && w.line.includes(BOT),
      ),
    );
    check(`${run.nick}: ${BOT} is in the NAMES list of ${lobby}`);
  }
  // b's join reached a, so both are in the lobby together before the commands run
  await until(a, `${b.nick} in the lobby`, () =>
    a.wire.some(
      (w) => w.dir === "<" && w.line.includes(`:${b.nick}!`) && w.line.includes(" JOIN "),
    ),
  );
  // b's join announced by the bot: a channel line (not private) that both players receive; a NOTICE
  // (shown without "[YuriBOT] :") while lobbyBot.namelessJoins is on, the default
  for (const run of [a, b]) {
    await until(run, `${BOT} announcing ${b.nick}`, () =>
      run.wire.some(
        (w) =>
          w.dir === "<" &&
          w.line.startsWith(`:${BOT}!`) &&
          // an IRC colour code may come first (lobbyBot.joinColour)
          new RegExp(
            ` (PRIVMSG|NOTICE) ${lobby} :(\\x03\\d{1,2})?${b.nick} joined the channel`,
          ).test(w.line),
      ),
    );
  }
  check(`${BOT} announced ${b.nick} joining ${lobby} to both players`);

  // the Players list with both players: YuriBOT first, with the operator icon
  await a.page.waitForTimeout(1500);
  await a.shot("lobby-bot-players");
  // The transcript's top: the date row before the session's first line (docs/wol/handoff-wolapi.md,
  // "Chat times"). The list's scroll arrows, in the game's 800x600.
  for (let i = 0; i < 12; i++) await a.clickGame(609, 381);
  await a.page.waitForTimeout(500);
  await a.shot("lobby-bot-top");
  for (let i = 0; i < 12; i++) await a.clickGame(609, 517);

  // 2. /help typed by a: a private answer from the bot, nothing in b's socket
  let mark = a.wire.length;
  const bMark = b.wire.length;
  await say(a, "/help");
  await until(a, "the /help line sent", () =>
    a.wire.some(
      (w, i) =>
        i >= mark &&
        w.dir === ">" &&
        w.line.toLowerCase().includes(`privmsg ${lobby.toLowerCase()} :/help`),
    ),
  );
  await until(a, "a private /help reply from the bot", () =>
    botReply(a, mark, /commands|help|\//i),
  );
  await b.page.waitForTimeout(1500);
  assert.ok(
    !b.wire.slice(bMark).some((w) => /\/help/i.test(w.line)),
    `${b.nick} saw the /help line`,
  );
  check(`${a.nick} /help: private reply from ${BOT}; ${b.nick} saw no /help line`);

  // 3. a private line to the bot: select it in the Players list, type, get a private reply
  mark = a.wire.length;
  const bMark3 = b.wire.length;
  let sent = false;
  // A click toggles a row and a line goes to every row selected. The bot is expected on its row; a miss
  // is deselected and the next row tried (and then the other player sees the line, which fails below).
  for (const k of BOT_ROWS) {
    if (sent) break;
    await a.clickGame(...PLAYER_ROW(k));
    await a.page.waitForTimeout(300);
    const at = a.wire.length;
    await say(a, "hello");
    await a.page.waitForTimeout(1200);
    sent = a.wire.some(
      (w, i) => i >= at && w.dir === ">" && /^privmsg [^ ]*YuriBOT[^ ]* :hello/i.test(w.line),
    );
    if (!sent) await a.clickGame(...PLAYER_ROW(k));
  }
  assert.ok(sent, `${a.nick}: the private line to ${BOT} was sent (selected in the Players list)`);
  await until(a, "a private reply to the private line", () => botReply(a, mark));
  assert.ok(
    !b.wire.slice(bMark3).some((w) => /:hello$/.test(w.line)),
    `${b.nick} saw the private line`,
  );
  check(`${a.nick} private line to ${BOT}: private reply`);

  // 4. /who names both players (b is not shown any of it)
  mark = a.wire.length;
  const bMark2 = b.wire.length;
  await say(a, "/who");
  await until(a, "the /who reply naming both players", () =>
    a.wire.some(
      (w, i) =>
        i >= mark &&
        w.dir === "<" &&
        w.line.startsWith(`:${BOT}!`) &&
        w.line.includes(a.nick) &&
        w.line.includes(b.nick),
    ),
  );
  assert.ok(
    !b.wire.slice(bMark2).some((w) => /\/who/i.test(w.line)),
    `${b.nick} saw the /who line`,
  );
  check(`${a.nick} /who: the reply lists ${a.nick} and ${b.nick}`);

  // 5. /r answers the last player who wrote privately (docs/wol/handoff-wolapi.md, "/r and /reply"):
  // b selects a in the Players list (YuriBOT, a, b) and whispers; a types "/r back", which the game turns
  // into a page to b, sent as a private line
  let whispered = false;
  for (const k of [1, 2]) {
    if (whispered) break;
    await b.clickGame(...PLAYER_ROW(k));
    await b.page.waitForTimeout(300);
    const at = b.wire.length;
    await say(b, "hi from b");
    await b.page.waitForTimeout(1200);
    whispered = b.wire.some(
      (w, i) => i >= at && w.dir === ">" && w.line.toLowerCase() === `privmsg ${a.nick} :hi from b`,
    );
    if (!whispered) await b.clickGame(...PLAYER_ROW(k));
  }
  assert.ok(whispered, `${b.nick}: the private line to ${a.nick} was sent`);
  await until(a, `${b.nick}'s private line`, () =>
    a.wire.some(
      (w) => w.dir === "<" && w.line.startsWith(`:${b.nick}!`) && w.line.endsWith(" :hi from b"),
    ),
  );
  mark = a.wire.length;
  await say(a, "/r back");
  await until(a, "the /r page sent", () =>
    a.wire.some(
      (w, i) => i >= mark && w.dir === ">" && w.line.toLowerCase() === `privmsg ${b.nick} :back`,
    ),
  );
  await until(b, `${a.nick}'s /r reply`, () =>
    b.wire.some(
      (w) => w.dir === "<" && w.line.startsWith(`:${a.nick}!`) && w.line.endsWith(" :back"),
    ),
  );
  check(`${a.nick} /r: the reply reached ${b.nick} as a private line`);
  // The transcript after it all: each line starts with the local time (docs/wol/handoff-wolapi.md, "Chat times").
  await a.page.waitForTimeout(800);
  await a.shot("lobby-bot-chat");
  console.log(`PASS ${edition.toUpperCase()} (${results.length} checks)`);
} catch (error) {
  console.error("FAIL:", error?.message ?? error);
  for (const [name, run] of Object.entries(clients)) {
    console.error(`--- ${name} ${run.nick}: last wire`);
    console.error(
      run.wire
        .slice(-16)
        .map((w) => `${w.dir} ${w.line.slice(0, 160)}`)
        .join("\n"),
    );
    await run.shot(`lobby-bot-fail-${name}`).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  for (const run of Object.values(clients)) await run.browser.close().catch(() => {});
}
