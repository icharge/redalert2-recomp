// End to end: the WOL lobby's list icons with two web clients against a local WOL server (node e2e/wol-server.mjs).
// Run once per edition, from web/:
//   node e2e/wol-icons.mjs --url 'http://127.0.0.1:5175/?target=game' --game ../game --shots work/...   (RA2)
//   node e2e/wol-icons.mjs --url 'http://127.0.0.1:5175/' --game ../game                              (YR)
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startPage, options } from "./lib.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const opts = options(argv);
opts.pageArgs.push("--mute", "--debuglog");
const server = option("--server", "http://127.0.0.1:9090");
const ra2 = new URL(opts.url).searchParams.get("target") === "game";
const edition = ra2 ? "ra2" : "yr";
const origin = new URL(opts.url).origin;
const tag = randomBytes(4).toString("hex").slice(0, 4);

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

const results = [];
const check = (what) => {
  results.push(what);
  console.log(`ok  ${what}`);
};
const clients = {};
async function open(name) {
  const minted = await guestTicket(`i${name}${tag}`);
  const url = new URL(opts.url);
  url.hash = `ticket=${minted.ticket}`;
  const run = await startPage({
    ...opts,
    url: url.toString(),
    shots: `${opts.shots}/icons-${name}`,
  });
  run.nick = minted.user;
  run.wire = [];
  run.page.on("websocket", (ws) => {
    if (!ws.url().startsWith(server.replace(/^http/, "ws")) || ws.url().includes("/gserv")) return;
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
const waitNative = (run, text, from = 0, ms = 30000) =>
  until(run, `native ${text}`, () => run.all.slice(from).some((l) => l.includes(text)), ms);

async function toLobby(run) {
  await run.waitFor(`${run.nick} main menu`, (s) => s?.phase === "running", 300);
  await run.page.waitForTimeout(1500);
  const before = run.all.length;
  await run.clickGame(720, 263);
  await waitNative(run, "[dialog] open 0x10E", before);
  await run.page.waitForTimeout(800);
  const internet = run.all.length;
  await run.clickGame(720, ra2 ? 263 : 305);
  await waitNative(run, "Joined Channel", internet, 40000);
  await run.page.waitForTimeout(2500);
}

try {
  const SEP = String.fromCharCode(10);
  const kind = option("--kind", "observer"); // observer | tournament | clan | normal
  const host = await open("h");
  await toLobby(host);
  if (kind === "clan")
    // The BattleClan box is greyed out of a clan; set the clan bit (0x100, the room's reserved word
    // in the WOLAPI2 envelope) on the wire as a clan host's game would send it.
    await host.page.evaluate(() => {
      const send = window.Module.ra2WolSend;
      window.Module.ra2WolSend = (line) =>
        send(
          line.replace(
            /WOLAPI2:([0-9]+),/,
            (all, a) => "WOLAPI2:" + ((Number(a) | 0x100) >>> 0) + ",",
          ),
        );
    });
  await host.clickGame(720, 220); // Create Game
  await waitNative(host, "[dialog] open 0xC3");
  await host.page.waitForTimeout(700);
  if (kind === "tournament") {
    await host.clickGame(225, 261); // the Tournament box
    await host.page.waitForTimeout(400);
    await host.shot("create-dialog-tournament");
  }
  await host.clickGame(283, ra2 ? 377 : 357);
  await until(host, "joingame", () => host.wire.some((w) => /^joingame /.test(w.line)));
  await host.page.waitForTimeout(2500);
  await host.shot("room");
  let guest = null;
  if (kind === "tournament")
    assert.ok(
      host.wire.some((w) => /^joingame #[^ ]+ 1 [0-9]+ 33 0 0 1 0/.test(w.line)),
      "joingame carries the tournament value",
    );
  if (kind === "observer") {
    await host.clickGame(...(ra2 ? [272, 271] : [214, 229])); // the observer row dropdown: Open Observer
    await host.page.waitForTimeout(800);
    await host.clickGame(...(ra2 ? [175, 294] : [112, 252]));
    await until(host, "ex-info with an open observer row", () =>
      host.wire.some((w) =>
        /^topic .*WOLAPI2:[^;]*;[0-9]+,-?[0-9]+,[0-9]+,[0-9]+,[1-9],/.test(w.line),
      ),
    );
    await host.page.waitForTimeout(1500);
    await host.shot("room-open-observer");
    // a two-player map with an open observer row takes the second player and the observer: MODE +l3
    await until(host, "MODE +l3", () => host.wire.some((w) => /^mode #[^ ]+ [+]l3$/.test(w.line)));
    check("the host's limit counts the observer row (MODE +l3 on a two-player map)");
    guest = await open("g");
    await toLobby(guest);
    await guest.page.waitForTimeout(2500);
    await guest.clickGame(150, ra2 ? 47 : 65);
    await guest.page.waitForTimeout(500);
    await guest.clickGame(720, 263);
    await until(guest, "the player's join", () =>
      guest.wire.some(
        (w) => / JOINGAME /.test(w.line) && w.line.startsWith(":" + guest.nick + "!"),
      ),
    );
    await guest.page.waitForTimeout(2500);
    await guest.shot("guest-joined-as-player");
    check("a second player joins the room that has an open observer row");
  }
  const watcher = await open("w");
  await toLobby(watcher);
  await watcher.page.waitForTimeout(3500);
  await watcher.shot("lobby-" + kind);
  const listed = watcher.wire
    .filter((w) => / 322 [^ ]+ #i[^ ]*_game /.test(w.line))
    .map((w) => w.line);
  console.log(listed.join(SEP));
  const last = listed.at(-1) ?? "";
  if (kind === "tournament")
    assert.match(last, / 33 1 0 /, "the list carries the tournament value");
  if (kind === "clan")
    assert.match(
      last,
      /WOLAPI2:2[0-9][0-9]?,|WOLAPI2:(256|[3-9][0-9][0-9]),/,
      "the list carries the clan bit",
    );
  if (kind === "observer")
    assert.match(last, /,0,0,1,[^,]*[.]MAP::/i, "the list carries the open observer row");
  check(kind + ": the other client's list got the room");
  console.log(
    `PASS ${edition.toUpperCase()} ${kind} (${results.length} checks); see ${opts.shots}`,
  );
} catch (error) {
  console.error("FAIL:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  for (const run of Object.values(clients)) await run.browser.close().catch(() => {});
}
