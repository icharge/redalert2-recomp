// End to end (LB-14, LB-15): the private-message panel and buddies with two members against a local
// WOL server. Start the server (`pnpm wol-server`, port 9090) and Vite, then from web/, once per edition:
//   node e2e/buddies-pm.mjs --url 'http://127.0.0.1:5175/?target=game' --game ../game      (RA2)
//   node e2e/buddies-pm.mjs --url 'http://127.0.0.1:5175/' --game ../game                  (YR)
// Two members (POST /v1/members/register, a game account, a launch ticket, as launch-login.mjs) reach
// the chat lobby, one after the other. Then:
//   - a adds b as a friend through PUT /v1/friends/<b> (the launcher's FRIENDS page), and GET /v1/friends
//     shows b in the lobby
//   - b opens the page's MESSAGES panel, starts a conversation with a and sends a line: a's socket gets
//     it, a's MESSAGES button counts it unread, a opens the panel and answers from it, b gets the answer
//   - a types `/on <b>` in the lobby chat: the game asks `find <b>` and the server answers 615 found
//   - a presses the lobby's Buddy List: the page's FRIENDS opens, with b listed
// Shots: pm-panel-a, pm-panel-b, on-a, buddy-list-a.
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
const lobby = `#Lob_${ra2 ? 33 : 41}_0`;
const origin = new URL(opts.url).origin;
const tag = randomBytes(4).toString("hex").slice(0, 5);
const CHAT_EDIT = [300, 545];

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
    shots: `${opts.shots}/buddies-pm-${name}`,
    cookies: who.refresh
      ? [{ name: "ra2refresh", value: who.refresh, url: `${server}/v1/auth` }]
      : [],
  });
  Object.assign(run, who);
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
const got = (run, from, test) =>
  run.wire.some((w, i) => i >= from && w.dir === "<" && test(w.line));

async function say(run, text) {
  await run.clickGame(...CHAT_EDIT);
  await run.page.waitForTimeout(150);
  await run.page.keyboard.type(text, { delay: 60 });
  await run.page.waitForTimeout(250);
  await run.page.keyboard.press("Enter");
}

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

async function panelSend(run, to, text) {
  const field = run.page.locator(`[aria-label="Message to ${to}"]`);
  if (!(await field.count())) {
    const box = run.page.locator('[aria-label="New message to"]');
    await box.fill(to);
    await box.press("Enter");
  }
  await field.waitFor({ timeout: 10000 });
  await field.fill(text);
  await field.press("Enter");
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
  await toLobby(a);
  await toLobby(b);

  // 1. friends through the launcher's routes, and presence
  await call("PUT", `/v1/friends/${b.nick}?account=${a.nick}`, undefined, a.token);
  const listed = await call("GET", `/v1/friends?account=${a.nick}`, undefined, a.token);
  const friend = listed.friends.find((f) => f.name.toLowerCase() === b.nick.toLowerCase());
  assert.ok(friend, `GET /v1/friends lists ${b.nick}: ${JSON.stringify(listed)}`);
  assert.equal(friend.status, "lobby", `${b.nick} is in the lobby: ${JSON.stringify(friend)}`);
  check(
    `${a.nick} added ${b.nick} as a friend; GET /v1/friends shows ${b.nick} in ${friend.room ?? "the lobby"}`,
  );

  // 2. the MESSAGES panel, both ways
  let markB = b.wire.length;
  let markA = a.wire.length;
  await openPanel(b);
  await panelSend(b, a.nick, `hello from the panel ${tag}`);
  await until(b, "the panel's line sent", () =>
    sent(b, markB, (l) => l.toLowerCase() === `privmsg ${a.nick} :hello from the panel ${tag}`),
  );
  await until(a, "b's panel line", () =>
    got(a, markA, (l) => l.startsWith(`:${b.nick}!`) && l.endsWith(`:hello from the panel ${tag}`)),
  );
  await a.page.waitForTimeout(500);
  const label = await openPanel(a);
  assert.ok(/1 unread/.test(label ?? ""), `${a.nick}: MESSAGES counted the line unread (${label})`);
  check(`${b.nick} wrote from the panel; ${a.nick}'s MESSAGES said "${label}"`);
  markA = a.wire.length;
  markB = b.wire.length;
  await panelSend(a, b.nick, `answer ${tag}`);
  await until(a, "the panel answer sent", () =>
    sent(a, markA, (l) => l.toLowerCase() === `privmsg ${b.nick} :answer ${tag}`),
  );
  await until(b, "a's panel answer", () =>
    got(b, markB, (l) => l.startsWith(`:${a.nick}!`) && l.endsWith(`:answer ${tag}`)),
  );
  await a.page.waitForTimeout(800);
  await a.shot("pm-panel-a");
  await b.page.waitForTimeout(800);
  await b.shot("pm-panel-b");
  check(`${a.nick} answered from the panel; ${b.nick} got it`);
  for (const run of [a, b]) {
    await run.page.keyboard.press("Escape");
    await run.page.waitForTimeout(300);
  }

  // 2b. the panel's FRIENDS tab: b listed with where they are, and b's profile from it
  await openPanel(a);
  await a.page.getByRole("tab", { name: "FRIENDS" }).click();
  const friendsList = a.page.getByRole("list", { name: /^Friends of / });
  await friendsList.waitFor({ timeout: 15000 });
  await until(a, `${b.nick} in the FRIENDS tab`, async () =>
    ((await friendsList.textContent()) ?? "").toLowerCase().includes(b.nick.toLowerCase()),
  );
  const friendRow = await friendsList.textContent();
  await a.shot("friends-a");
  await friendsList.getByRole("button", { name: "PROFILE" }).first().click();
  await a.page
    .getByRole("region", { name: new RegExp(`^Profile of `, "i") })
    .waitFor({ timeout: 10000 });
  await a.page.waitForTimeout(1500);
  await a.shot("profile-a");
  await a.page.getByRole("button", { name: "← BACK" }).click();
  await a.page.getByRole("tab", { name: "MESSAGES" }).click();
  await a.page.keyboard.press("Escape");
  check(`${a.nick}'s FRIENDS tab lists ${b.nick} (${friendRow}) and shows a profile`);

  // 2c. a right-click on a player in the lobby's list: the player menu; Add friend and Profile
  const menuFor = async (run, nick) => {
    for (let y = 40; y <= 150; y += 9) {
      await run.clickGame(ra2 ? 420 : 430, y, "right");
      const menu = run.page.getByRole("menu");
      if (!(await menu.count())) {
        await run.page.waitForTimeout(150);
        if (!(await menu.count())) continue;
      }
      const label = (await menu.getAttribute("aria-label")) ?? "";
      if (label.toLowerCase() === `player ${nick.toLowerCase()}`) return menu;
      await run.page.keyboard.press("Escape");
    }
    throw new Error(`${run.nick}: no player menu for ${nick} in the lobby's list`);
  };
  let menu = await menuFor(b, a.nick);
  const notices = b.all.length;
  await menu.getByRole("menuitem", { name: "Add friend" }).click();
  await until(b, "the Add friend line in the chat log", () =>
    b.all.slice(notices).some((l) => l.includes("[wol] notice from YuriNET")),
  );
  const bList = await call("GET", `/v1/friends?account=${b.nick}`, undefined, b.token);
  assert.ok(
    bList.friends.some((f) => f.name.toLowerCase() === a.nick.toLowerCase()),
    `${b.nick} has ${a.nick} as a friend: ${JSON.stringify(bList)}`,
  );
  menu = await menuFor(b, a.nick);
  await b.shot("player-menu-b");
  await menu.getByRole("menuitem", { name: "Profile" }).click();
  await b.page.getByRole("region", { name: /^Profile of /i }).waitFor({ timeout: 10000 });
  await b.page.waitForTimeout(800);
  await b.shot("player-profile-b");
  await b.page.keyboard.press("Escape");
  check(
    `${b.nick} right-clicked ${a.nick} in the lobby: Add friend made them friends, Profile opened`,
  );

  // 3. /on <b>: RequestFind, answered 615 found
  markA = a.wire.length;
  await say(a, `/on ${b.nick}`);
  await until(a, "find sent", () => sent(a, markA, (l) => l.toLowerCase() === `find ${b.nick}`));
  await until(a, "615 found", () =>
    got(a, markA, (l) => / 615 /.test(l) && l.toLowerCase().includes(` ${b.nick} found `)),
  );
  await a.page.waitForTimeout(1500);
  await a.shot("on-a");
  check(`${a.nick} /on ${b.nick}: the game asked find and the server answered found`);

  // 4. the lobby's Buddy List button opens the page's FRIENDS (the game's own Buddy List screen no
  // longer opens): b is listed there
  {
    markA = a.wire.length;
    const dialogs = a.all.length;
    await a.page.getByRole("button", { name: "Buddy List (opens friends)" }).click();
    await a.page.locator('[aria-label="Private messages"]').waitFor({ timeout: 10000 });
    const list = a.page.getByRole("list", { name: /^Friends of / });
    await list.waitFor({ timeout: 15000 });
    await until(a, `${b.nick} in FRIENDS`, async () =>
      ((await list.textContent()) ?? "").toLowerCase().includes(b.nick.toLowerCase()),
    );
    assert.ok(!sent(a, markA, (l) => l === "buddylist"), "the game's Buddy List did not open");
    assert.ok(
      !a.all.slice(dialogs).some((l) => l.includes("[dialog] open 0x116")),
      "no Buddy List dialog",
    );
    await a.shot("buddy-list-a");
    check(`${a.nick} Buddy List opened FRIENDS with ${b.nick}`);
  }
  console.log(`PASS ${edition.toUpperCase()} (${results.length} checks)`);
} catch (error) {
  console.error("FAIL:", error?.message ?? error);
  for (const [name, run] of Object.entries(clients)) {
    console.error(
      run.all
        .filter((l) => l.startsWith("[chat box]"))
        .slice(-12)
        .join("\n"),
    );
    console.error(`--- ${name} ${run.nick}: last wire`);
    console.error(
      run.wire
        .slice(-16)
        .map((w) => `${w.dir} ${w.line.slice(0, 160)}`)
        .join("\n"),
    );
    await run.shot(`buddies-pm-fail-${name}`).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  for (const run of Object.values(clients)) await run.browser.close().catch(() => {});
}
