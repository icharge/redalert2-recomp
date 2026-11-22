// End to end: invite a friend into a game room, and join it from the invitation (MESSAGES, FRIENDS).
// Start the server (`pnpm wol-server`, port 9090) and Vite, then from web/, once per edition:
//   node e2e/invite-join.mjs --url 'http://127.0.0.1:5175/?target=game' --game ../game      (RA2)
//   node e2e/invite-join.mjs --url 'http://127.0.0.1:5175/' --game ../game                  (YR)
// Two members (each browser has its launcher session) reach the lobby and are friends. A creates a game
// room; A's FRIENDS tab offers INVITE for B, and A invites B. B's page shows the invitation as a chat-log
// line and in MESSAGES with JOIN, and B's FRIENDS tab offers JOIN for A; B presses the invitation's
// JOIN and B's game joins A's room (joingame). Shots: invite-a, invitation-b, joined-b.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startPage, options, isWolChatSocket } from "./lib.mjs";

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

async function call(method, route, body, token) {
  const response = await fetch(`${server}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  assert.ok(
    response.ok,
    `${method} ${route}: ${response.status} ${data.errorCode ?? ""} ${data.error ?? ""}`,
  );
  return data;
}

async function member(name) {
  // registering signs in: its ra2refresh cookie gives the browser the launcher session, so the
  // in-game MESSAGES panel's FRIENDS tab knows the member (as after signing in at the launcher)
  const registered = await fetch(`${server}/v1/members/register`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ login: `e2e-${name}-${tag}`, password: `pw-${tag}-e2e` }),
  });
  assert.ok(registered.ok, `register ${name}: ${registered.status}`);
  const session = await registered.json();
  const refresh = /ra2refresh=([^;]+)/.exec(registered.headers.get("set-cookie") ?? "")?.[1];
  const nick = `m${name}${tag}`;
  await call(
    "POST",
    "/v1/members/game-accounts",
    { username: nick, password: `pw${tag}x` },
    session.accessToken,
  );
  const minted = await call(
    "POST",
    "/v1/auth/launch-ticket",
    { gameAccount: nick, edition },
    session.accessToken,
  );
  return { nick: minted.user, ticket: minted.ticket, token: session.accessToken, refresh };
}

const clients = {};
async function open(name) {
  const who = await member(name);
  const url = new URL(opts.url);
  url.hash = `ticket=${who.ticket}`;
  const run = await startPage({
    ...opts,
    url: url.toString(),
    shots: `${opts.shots}/invite-join-${name}`,
    cookies: who.refresh
      ? [{ name: "ra2refresh", value: who.refresh, url: `${server}/v1/auth` }]
      : [],
  });
  Object.assign(run, who);
  run.wire = [];
  run.page.on("websocket", (ws) => {
    // the server itself, or the dev server's /ra2web/ proxy of it (src/wol-endpoint.ts)
    if (!isWolChatSocket(ws.url(), server, run.page.url())) return;
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
    const found = await test();
    if (found) return found;
    assert.ok(Date.now() < deadline, `${run.nick}: timed out waiting for ${what}`);
    await run.page.waitForTimeout(100);
  }
};
const waitNative = (run, text, from = 0, ms = 30000) =>
  until(run, `native ${text}`, () => run.all.slice(from).some((l) => l.includes(text)), ms);
const sent = (run, from, test) =>
  run.wire.some((w, i) => i >= from && w.dir === ">" && test(w.line));

async function toLobby(run) {
  await run.waitFor(`${run.nick} main menu`, (s) => s?.phase === "running", 300);
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
      (w) => w.dir === "<" && w.line.includes(`:${run.nick}!`) && w.line.includes(" JOIN "),
    ),
  );
  await run.page.waitForTimeout(2500);
}

/** Open the page's tray (the star) when it is closed, then the MESSAGES panel. */
async function openPanel(run) {
  const tray = run.page.locator('button[aria-label="Page controls"][aria-expanded]');
  if ((await tray.getAttribute("aria-expanded")) !== "true") await tray.click();
  const button = run.page.locator('button[aria-label^="Messages"]');
  await button.waitFor({ timeout: 10000 });
  const label = await button.getAttribute("aria-label");
  await button.click();
  await run.page.locator('[aria-label="Private messages"]').waitFor({ timeout: 10000 });
  return label;
}

const results = [];
const check = (what) => {
  results.push(what);
  console.log(`ok  ${what}`);
};

try {
  const a = await open("a");
  const b = await open("b");
  console.log(`${edition.toUpperCase()}: ${a.nick} and ${b.nick}`);
  await toLobby(a);
  await toLobby(b);
  await call("PUT", `/v1/friends/${b.nick}?account=${a.nick}`, undefined, a.token);
  await call("PUT", `/v1/friends/${a.nick}?account=${b.nick}`, undefined, b.token);

  // A creates a game room (the lobby's Create Game, then the dialog's OK)
  let markA = a.wire.length;
  await a.clickGame(720, 220);
  await waitNative(a, "[dialog] open 0xC3");
  await a.page.waitForTimeout(700);
  await a.clickGame(283, ra2 ? 377 : 357);
  await until(a, "A's joingame", () => sent(a, markA, (l) => l.startsWith("joingame ")));
  const room = /joingame #(\S+)/.exec(
    a.wire.slice(markA).find((w) => w.dir === ">" && w.line.startsWith("joingame "))?.line ?? "",
  )?.[1];
  assert.ok(room, "A's room name");
  await a.page.waitForTimeout(2500);
  check(`${a.nick} created the room ${room}`);

  // A invites B from FRIENDS: in Yuri's Revenge from the room's Page button, which opens it
  if (ra2) await openPanel(a);
  else {
    await a.page.getByRole("button", { name: "Page (opens friends)" }).click();
    await a.page.locator('[aria-label="Private messages"]').waitFor({ timeout: 10000 });
  }
  await a.page.getByRole("tab", { name: "FRIENDS" }).click();
  const aList = a.page.getByRole("list", { name: /^Friends of / });
  await aList.waitFor({ timeout: 15000 });
  const invite = aList.getByRole("button", { name: "INVITE" });
  await invite.waitFor({ timeout: 15000 });
  markA = a.wire.length;
  const notices = b.all.length;
  await invite.click();
  await until(a, "the invitation sent", () =>
    sent(a, markA, (l) =>
      l.toLowerCase().startsWith(`privmsg ${b.nick.toLowerCase()} :\u0001invite `),
    ),
  );
  await a.shot("invite-a");
  await a.page.keyboard.press("Escape");
  check(`${a.nick} invited ${b.nick} from the FRIENDS tab`);

  // B: the chat-log line, the invitation in MESSAGES, and JOIN for A in FRIENDS
  await until(b, "the invitation's chat-log line", () =>
    b.all.slice(notices).some((l) => l.includes("[wol] notice from YuriNET")),
  );
  assert.ok(
    !b.all.slice(notices).some((l) => l.includes("INVITE")),
    "the game's chat did not get the invitation itself",
  );
  await openPanel(b);
  await b.page.getByRole("tab", { name: "FRIENDS" }).click();
  const bList = b.page.getByRole("list", { name: /^Friends of / });
  await bList.waitFor({ timeout: 15000 });
  await bList.getByRole("button", { name: "JOIN" }).waitFor({ timeout: 40000 });
  check(`${b.nick}'s FRIENDS tab offers JOIN for ${a.nick}`);
  await b.page.getByRole("tab", { name: "MESSAGES" }).click();
  const log = b.page.getByRole("log", { name: `Conversation with ${a.nick}` });
  await log.waitFor({ timeout: 10000 });
  assert.match((await log.textContent()) ?? "", /invites you to their game/);
  await b.shot("invitation-b");
  // the games list needs the room: it is there once the lobby's list was read again
  let markB = b.wire.length;
  for (let tries = 0; ; tries++) {
    await log.getByRole("button", { name: "JOIN" }).click();
    await b.page.waitForTimeout(2500);
    if (sent(b, markB, (l) => l.toLowerCase().startsWith("joingame "))) break;
    assert.ok(tries < 6, `${b.nick} joined ${room} from the invitation`);
    // not listed yet: the lobby's refresh button, then again
    await b.clickGame(20, 16); // the refresh button, at 12,10 37x23 in both games
    await b.page.waitForTimeout(2000);
    await openPanel(b);
    markB = b.wire.length;
  }
  const joined =
    b.wire.slice(markB).find((w) => w.dir === ">" && w.line.toLowerCase().startsWith("joingame "))
      ?.line ?? "";
  assert.ok(joined.toLowerCase().includes(room.toLowerCase()), `B joined A's room: ${joined}`);
  await b.page.waitForTimeout(2500);
  await b.shot("joined-b");
  check(`${b.nick} pressed the invitation's JOIN and joined ${room}`);
  console.log(`PASS ${edition.toUpperCase()} (${results.length} checks)`);
} catch (error) {
  console.error("FAIL:", error?.message ?? error);
  for (const [name, run] of Object.entries(clients)) {
    console.error(`--- ${name} ${run.nick}`);
    console.error(
      run.all
        .filter((l) => l.startsWith("[chat box]"))
        .slice(-8)
        .join("\n"),
    );
    console.error(
      run.wire
        .slice(-10)
        .map((w) => `${w.dir} ${w.line.slice(0, 160)}`)
        .join("\n"),
    );
    await run.shot(`invite-join-fail-${name}`).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  for (const run of Object.values(clients)) await run.browser.close().catch(() => {});
}
