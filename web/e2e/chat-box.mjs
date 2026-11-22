// End to end: the page's chat box over the game's lobby chat line (src/web/chat_box.c, ChatBox.tsx).
// Start the server (`pnpm wol-server`, port 9090) and Vite, then from web/, once per edition:
//   node e2e/chat-box.mjs --url 'http://127.0.0.1:5175/?target=game' --game ../game      (RA2)
//   node e2e/chat-box.mjs --url 'http://127.0.0.1:5175/' --game ../game                  (YR)
// A member reaches the lobby. Then:
//   - the page's TYPE button is gone, and the chat box shows over the game's chat line
//   - a line with Thai typed into the box and Enter goes out as the game's own lobby line
//     (`privmsg #Lob_NN_0 :...`; the game keeps Thai as Windows-874 bytes widened to U+00A1..)
//   - `/r` style commands still reach the game: `/on <nick>` asks `find <nick>`
// Shots: chat-box-lobby.
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
  assert.ok(response.ok, `${method} ${route}: ${response.status} ${data.error ?? ""}`);
  return data;
}

/** The game's encoding of a typed line: Thai as its Windows-874 byte, widened (presenter.c). */
const gameText = (text) =>
  Array.from(text)
    .map((c) => {
      const code = c.codePointAt(0);
      return code >= 0x0e01 && code <= 0x0e5b ? String.fromCharCode(code - 0x0d60) : c;
    })
    .join("");

let run;
const wire = [];
try {
  const session = await call("POST", "/v1/members/register", {
    login: `e2e-cb-${tag}`,
    password: `pw-${tag}-e2e`,
  });
  const nick = `mcb${tag}`;
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
  const url = new URL(opts.url);
  url.hash = `ticket=${minted.ticket}`;
  run = await startPage({ ...opts, url: url.toString(), shots: `${opts.shots}/chat-box` });
  run.page.on("websocket", (ws) => {
    if (!ws.url().startsWith(server.replace(/^http/, "ws")) || ws.url().includes("/gserv")) return;
    const add = (dir) => (f) => {
      for (const line of String(f.payload).split(/\r?\n/)) if (line) wire.push({ dir, line });
    };
    ws.on("framesent", add(">"));
    ws.on("framereceived", add("<"));
  });
  const until = async (what, test, ms = 30000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = await test();
      if (found) return found;
      assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
      await run.page.waitForTimeout(100);
    }
  };
  const sent = (from, test) => wire.some((w, i) => i >= from && w.dir === ">" && test(w.line));

  await run.waitFor("main menu", (s) => s?.phase === "running", 300);
  await run.page.waitForTimeout(1500);
  let before = run.all.length;
  await run.clickGame(720, 263); // Internet / LAN
  await until("the online page", () =>
    run.all.slice(before).some((l) => l.includes("[dialog] open 0x10E")),
  );
  await run.page.waitForTimeout(800);
  before = run.all.length;
  await run.clickGame(720, ra2 ? 263 : 305); // Internet
  await until(
    "the lobby",
    () => run.all.slice(before).some((l) => l.includes("Joined Channel")),
    40000,
  );
  await until("own JOIN", () => wire.some((w) => w.dir === "<" && w.line.includes(" JOIN ")));

  const tray = run.page.locator('button[aria-label="Page controls"][aria-expanded]');
  if ((await tray.getAttribute("aria-expanded")) !== "true") await tray.click();
  assert.equal(await run.page.getByRole("button", { name: /^TYPE$/ }).count(), 0, "TYPE is gone");
  await tray.click();
  console.log("ok  the tray has no TYPE button");

  const box = run.page.getByRole("textbox", { name: "Chat message" });
  await box.waitFor({ timeout: 15000 });
  const place = await box.boundingBox();
  assert.ok(
    place && place.width > 100 && place.height > 8,
    `the box has a size: ${JSON.stringify(place)}`,
  );
  console.log(`ok  the chat box shows over the game's line (${JSON.stringify(place)})`);

  const line = `hello ${tag} สวัสดี`;
  let mark = wire.length;
  await box.click();
  await box.fill(line);
  await box.press("Enter");
  await until("the lobby line", () =>
    sent(mark, (l) => l === `privmsg ${lobby} :${gameText(line)}`),
  );
  assert.equal(await box.inputValue(), "", "the box empties after Enter");
  console.log(`ok  the box's line went out as the game's lobby line`);

  mark = wire.length;
  await box.fill(`/on zz${tag}`);
  await box.press("Enter");
  await until("find", () => sent(mark, (l) => l.toLowerCase() === `find zz${tag}`));
  console.log("ok  a command typed in the box reaches the game (/on asks find)");
  await run.page.waitForTimeout(1500);
  await run.shot("chat-box-lobby");
  console.log(`PASS ${edition.toUpperCase()}`);
} catch (error) {
  console.error("FAIL:", error?.message ?? error);
  console.error(
    wire
      .slice(-16)
      .map((w) => `${w.dir} ${w.line.slice(0, 160)}`)
      .join("\n"),
  );
  await run?.shot("chat-box-fail").catch(() => {});
  process.exitCode = 1;
} finally {
  await run?.browser.close().catch(() => {});
}
