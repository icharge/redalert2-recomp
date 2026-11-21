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

async function post(route, body, token) {
  const response = await fetch(`${server}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  assert.ok(
    response.ok,
    `${route}: ${response.status} ${data.errorCode ?? ""} ${data.error ?? ""}`,
  );
  return data;
}

/** A member with one game account, and a launch ticket for it (what the launcher's PLAY does). */
async function memberTicket(nick) {
  const session = await post("/v1/members/register", {
    login: `e2e-${nick}`,
    password: `pw-${nick}-e2e`,
  });
  await post(
    "/v1/members/game-accounts",
    { username: nick, password: `pw-${nick}-game` },
    session.accessToken,
  );
  const minted = await post(
    "/v1/auth/launch-ticket",
    { gameAccount: nick, edition },
    session.accessToken,
  );
  return { session, minted };
}

const results = [];
const check = (what) => {
  results.push(what);
  console.log(`ok  ${what}`);
};
const clients = {};
async function open(name, nick = `i${name}${tag}`, minted = null) {
  minted ??= await guestTicket(nick);
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
  if (kind === "ranked") {
    // Two players the server seeded as placed (LADDER_DEV_SEED=rkone,rktwo,rkthree: rank 1, 2, 3).
    const a = await open("a", "rkone");
    const b = await open("b", "rktwo");
    await Promise.all([toLobby(a), toLobby(b)]);
    for (const run of [a, b]) {
      await waitNative(run, "RequestLadderList", 0, 30000);
      if (!ra2) await waitNative(run, "RequestHighscore", 0, 30000);
      await waitNative(run, "[wol] persona", 0, 30000);
    }
    await a.page.waitForTimeout(3000);
    for (const run of [a, b]) await run.shot("lobby-ranks");
    const personaLine = (run) => run.all.find((l) => l.includes("[wol] persona"));
    console.log(a.nick + ": " + personaLine(a) + "  " + b.nick + ": " + personaLine(b));
    console.log(b.all.filter((l) => l.includes(" answer: ")).join(" | "));
    assert.match(personaLine(a), /persona rkone: rank 1 /);
    assert.match(personaLine(b), /persona rktwo: rank 2 /);
    check(
      "both lobbies asked for ladder and high-score records and the own record reached the persona file",
    );
    // back to the welcome screen: the profile shows the real numbers
    for (const run of [a, b]) {
      const at = run.all.length;
      await run.clickGame(719, 556);
      await run.page.waitForTimeout(3500);
      await run.shot("welcome-stats");
      void at;
    }
    console.log("PASS ranked");
    process.exit(0);
  }
  if (kind === "clantag") {
    // CL-2: a clan member's tag in the other client's lobby list, and the Clan/Ladder button's new tab.
    //   --clan-button X,Y  where the lobby's Clan/Ladder button is (game pixels)
    const clanTag = "K" + tag;
    const owner = `k${tag}`;
    const { session, minted } = await memberTicket(owner);
    const made = await post(
      "/v1/clans",
      { tag: clanTag, name: "Red Knights " + tag, account: owner },
      session.accessToken,
    );
    const squad = made.clan.id;
    console.log(`clan ${clanTag} id ${squad} owned by ${owner}`);
    const a = await open("a", owner, minted);
    const b = await open("b"); // a guest: no clan of its own
    await Promise.all([toLobby(a), toLobby(b)]);
    await b.page.waitForTimeout(3000);
    for (const run of [a, b]) await run.shot("lobby-clantag");
    assert.ok(
      b.wire.some(
        (w) =>
          w.dir === "<" &&
          / 353 /.test(w.line) &&
          w.line.includes(`${owner},0,`) &&
          w.line.includes(`,${squad}`),
      ),
      "the guest's NAMES carries the owner's clan id",
    );
    check("the other client's NAMES carries the clan id after the owner's entry");
    await waitNative(b, `[wol] squad ${squad} -> ${clanTag} Red Knights`, 0, 15000);
    await waitNative(a, "[wol] squad 0 -> " + clanTag, 0, 15000);
    check(`both games asked for the squad and got [${clanTag}] Red Knights (own squad 0 too)`);
    const button = option("--clan-button", "");
    if (button) {
      const [x, y] = button.split(",").map(Number);
      const popup = a.page.context().waitForEvent("page", { timeout: 10000 });
      const before = a.page.url();
      await a.clickGame(x, y);
      const tab = await popup;
      await tab.waitForURL(/\/(ladder|clan)(\?|$)/, { timeout: 10000 }).catch(() => {});
      console.log("new tab: " + tab.url());
      assert.match(tab.url(), /\/(ladder|clan)(\?|$)/, "the button opened a launcher page");
      assert.equal(a.page.url(), before, "the game page did not navigate");
      assert.ok(await a.page.evaluate(() => !!window.Module), "the game is still running");
      await tab.screenshot({ path: `${opts.shots}/clan-button-tab.png` }).catch(() => {});
      await a.shot("after-clan-button");
      check("the Clan/Ladder button opened " + tab.url() + " in a new tab; the game kept running");
      await tab.close();
    }
    console.log(
      `PASS ${edition.toUpperCase()} clantag (${results.length} checks); see ${opts.shots}`,
    );
    process.exit(0);
  }
  if (kind === "welcome") {
    const solo = await open("s");
    await solo.waitFor("main menu", (st) => st?.phase === "running", 300);
    await solo.page.waitForTimeout(1500);
    await solo.clickGame(720, 263);
    await waitNative(solo, "[dialog] open 0x10E");
    await solo.page.waitForTimeout(2500);
    await solo.shot("welcome");
    process.exit(0);
  }
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
  for (const run of Object.values(clients))
    console.error(
      run.nick +
        String.fromCharCode(10) +
        run.all
          .filter((l) => /Request(Ladder|Highscore|Locale)|persona|answer:/.test(l))
          .join(String.fromCharCode(10)),
    );
  process.exitCode = 1;
} finally {
  for (const run of Object.values(clients)) await run.browser.close().catch(() => {});
}
