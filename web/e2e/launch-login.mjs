// End to end (LW-8): a launch ticket from the launcher's routes logs the game in to WOL with no
// login dialog, for a member's game account or for a guest, in either edition.
// Start the server first (`pnpm wol-server`, which allows the dev origins in LAUNCHER_ORIGINS), then
// from web/:
//   node e2e/launch-login.mjs --url 'http://127.0.0.1:5175/?target=game' --game ../game          (RA2, member)
//   node e2e/launch-login.mjs --url 'http://127.0.0.1:5175/' --game ../game --guest              (YR, guest)
//   node e2e/launch-login.mjs --url 'http://localhost:5173/' --game ../game                       (localhost)
// On the dev server the page reaches the server through its own /ra2web/ proxy (src/wol-endpoint.ts),
// so any host works; --server is where this script mints the ticket, the server itself.
// It does what PLAY does (web/src/account): a member is registered, given a new game account and a
// ticket for it (POST /v1/members/register, /v1/members/game-accounts, /v1/auth/launch-ticket); a
// guest asks POST /v1/auth/guest. The page opens with #ticket=; then Internet must reach the lobby
// as that nick, with no login dialog (0x10F) and no /register or /login from the page.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { isWolChatSocket, startPage, options } from "./lib.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const opts = options(argv);
opts.pageArgs.push("--mute", "--debuglog");
const server = option("--server", "http://127.0.0.1:9090");
const guest = argv.includes("--guest");
const ra2 = new URL(opts.url).searchParams.get("target") === "game";
const edition = ra2 ? "ra2" : "yr";
const lobby = `#Lob_${ra2 ? 33 : 41}_0`;
const origin = new URL(opts.url).origin;
const tag = randomBytes(4).toString("hex").slice(0, 6);

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

/** A ticket the way the launcher's PLAY gets one. */
async function mint() {
  if (guest) {
    const nick = `g${tag}`;
    const minted = await post("/v1/auth/guest", { nick, edition });
    assert.equal(minted.guest, true);
    return { nick: minted.user, ticket: minted.ticket };
  }
  const session = await post("/v1/members/register", {
    login: `e2e-${tag}`,
    password: `pw-${tag}-e2e`,
  });
  const nick = `m${tag}`;
  await post(
    "/v1/members/game-accounts",
    { username: nick, password: `pw${tag}` },
    session.accessToken,
  );
  const minted = await post(
    "/v1/auth/launch-ticket",
    { gameAccount: nick, edition },
    session.accessToken,
  );
  return { nick: minted.user, ticket: minted.ticket };
}

const { nick, ticket } = await mint();
console.log(`${guest ? "guest" : "member"} ${nick}, ${ra2 ? "RA2" : "YR"}, ticket minted`);
const url = new URL(opts.url);
url.hash = `ticket=${ticket}`;
opts.url = url.toString();

const run = await startPage(opts);
const wire = [];
const requests = [];
run.page.on("request", (r) => requests.push(r.url()));
run.page.on("websocket", (ws) => {
  if (!isWolChatSocket(ws.url(), server, opts.url)) return;
  ws.on("framereceived", (f) => wire.push(String(f.payload)));
});
const waitNative = async (text, after = 0, ms = 30000) => {
  const deadline = Date.now() + ms;
  while (!run.all.slice(after).some((l) => l.includes(text))) {
    assert.ok(Date.now() < deadline, `timed out waiting for native ${text}`);
    await run.page.waitForTimeout(100);
  }
};
try {
  await run.waitFor("main menu", (s) => s?.phase === "running", 240);
  assert.equal(
    await run.page.evaluate(() => location.hash),
    "",
    "the page cleared the ticket from its address",
  );
  assert.ok(
    requests.some((u) => u.endsWith("/v1/auth/redeem")),
    "the page redeemed the ticket",
  );
  await run.page.waitForTimeout(1500);
  const before = run.all.length;
  await run.clickGame(720, 263); // Internet / LAN
  await waitNative("[dialog] open 0x10E", before);
  await run.page.waitForTimeout(800);
  const internet = run.all.length;
  await run.clickGame(720, ra2 ? 263 : 305); // Internet
  await waitNative("Joined Channel", internet, 30000);
  await run.page.waitForTimeout(4000);
  await run.shot(`launch-login-${guest ? "guest" : "member"}-${edition}`);
  const dialogs = run.all.slice(internet).filter((l) => l.startsWith("[dialog] open"));
  console.log("dialogs after Internet:", dialogs.join(", ") || "none");
  assert.ok(!dialogs.some((l) => l.includes("0x10F")), "no login dialog");
  assert.ok(
    wire.some((l) => l.includes(`:${nick}!`) && l.includes(" JOIN ") && l.includes(lobby)),
    `joined ${lobby} as ${nick}`,
  );
  assert.ok(
    !requests.some((u) => /\/(register|login)$/.test(u)),
    "no /register or /login from the page",
  );
  console.log("PASS");
} finally {
  await run.browser.close();
}
