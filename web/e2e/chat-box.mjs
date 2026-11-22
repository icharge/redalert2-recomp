// End to end: the page's chat box over the game's lobby chat line (src/web/chat_box.c, ChatBox.tsx).
// Start the server (`pnpm wol-server`, port 9090) and Vite, then from web/, once per edition:
//   node e2e/chat-box.mjs --url 'http://127.0.0.1:5175/?target=game' --game ../game      (RA2)
//   node e2e/chat-box.mjs --url 'http://127.0.0.1:5175/' --game ../game                  (YR)
// A member reaches the lobby. Then:
//   - the page's TYPE button is gone, and the chat box shows over the game's chat line
//   - a line with Thai typed into the box and Enter goes out as the game's own lobby line, Thai as
//     real Unicode (`privmsg #Lob_NN_0 :... สวัสดี`), and the game's transcript draws it with the
//     TrueType engine (docs/ttf-text.md); shot chat-box-thai
//   - `/r` style commands still reach the game: `/on <nick>` asks `find <nick>`, and `/msg <nick> <text>`
//     (the page's short /page) goes out as a private line
//   - in a game room it creates, a line goes to the room, and /p and /on work as in the lobby
// Shots: chat-box-lobby, chat-box-room.
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
  assert.ok(response.ok, `${method} ${route}: ${response.status} ${data.error ?? ""}`);
  return data;
}

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
    // the server itself, or the dev server's /ra2web/ proxy of it (src/wol-endpoint.ts)
    if (!isWolChatSocket(ws.url(), server, run.page.url())) return;
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

  {
    // typing with the game focused goes to the box, not the game's own line under it
    await run.page.locator("canvas").first().focus();
    await run.page.keyboard.type("typed");
    assert.equal(await box.inputValue(), "typed", "the keys typed into the page's box");
    assert.ok(await box.evaluate((el) => el === document.activeElement), "the box took the focus");
    await run.shot("chat-box-typed");
    await box.fill("");
    await run.page.locator("canvas").first().focus();
    console.log("ok  typing with the game focused goes to the chat box");
  }

  {
    // YR's Page button and RA2's Buddy List open MESSAGES, not the game's old Page dialog
    // the lobby's Buddy List opens FRIENDS; Yuri's Revenge's lobby Page button is hidden (its game
    // rooms keep theirs)
    const pageButton = run.page.getByRole("button", { name: "Buddy List (opens friends)" });
    await pageButton.waitFor({ timeout: 10000 });
    await run.shot("chat-box-lobby-buttons");
    const dialogs = run.all.length;
    await pageButton.click();
    await run.page.locator('[aria-label="Private messages"]').waitFor({ timeout: 10000 });
    assert.equal(
      await run.page.getByRole("tab", { name: "FRIENDS" }).getAttribute("aria-selected"),
      "true",
      "the panel opened on FRIENDS",
    );
    await run.page.waitForTimeout(800);
    assert.ok(
      !run.all.slice(dialogs).some((l) => l.includes("[dialog] open 0x11B")),
      "the game's Page dialog stayed shut",
    );
    assert.equal(
      await run.page.getByRole("button", { name: "Page (opens friends)" }).count(),
      0,
      "the lobby has no Page button",
    );
    await run.shot("chat-box-page-button");
    await run.page.getByRole("button", { name: "Close messages" }).click();
    await run.page.waitForTimeout(500);
    console.log(
      `ok  the lobby's Buddy List opened FRIENDS (no game screen); no Page button in the lobby`,
    );
  }

  const line = `hello ${tag} สวัสดี`;
  let mark = wire.length;
  await box.click();
  await box.fill(line);
  await box.press("Enter");
  await until("the lobby line", () => sent(mark, (l) => l === `privmsg ${lobby} :${line}`));
  assert.equal(await box.inputValue(), "", "the box empties after Enter");
  console.log(`ok  the box's line went out as the game's lobby line, Thai as Unicode`);
  {
    // the game's transcript drew the line through the TrueType engine (Thai only goes there)
    await run.page.waitForTimeout(1200);
    await run.shot("chat-box-thai");
    console.log("ok  shot chat-box-thai: the lobby transcript with the Thai line");
  }

  mark = wire.length;
  await box.fill(`/on zz${tag}`);
  await box.press("Enter");
  await until("find", () => sent(mark, (l) => l.toLowerCase() === `find zz${tag}`));
  console.log("ok  a command typed in the box reaches the game (/on asks find)");

  // /r with nobody to answer: nothing goes out; the game's chat log says to use /pm (a NOTICE the
  // page hands the game for this player only), and the box keeps the line
  mark = wire.length;
  const logMark = run.all.length;
  await box.fill(`/r anyone ${tag}`);
  await box.press("Enter");
  await until("the hint in the chat log", () =>
    run.all.slice(logMark).some((l) => l.includes("[wol] notice from YuriNET")),
  );
  assert.equal(await box.inputValue(), `/r anyone ${tag}`, "the line stays in the box");
  await run.page.waitForTimeout(1500);
  assert.ok(!sent(mark, (l) => l.includes(`anyone ${tag}`)), "nothing went out");
  await run.shot("chat-box-no-reply");
  console.log("ok  /r with nobody to answer sent nothing; the chat log says to use /pm");
  await box.fill("");

  // /msg (also /m, /pm, /p) is the page's short form of the game's /page
  mark = wire.length;
  await box.fill(`/msg zz${tag} psst ${tag}`);
  await box.press("Enter");
  await until("the page", () =>
    sent(mark, (l) => l.toLowerCase() === `privmsg zz${tag} :psst ${tag}`),
  );
  console.log("ok  /msg in the box went out as the game's /page (a private line)");
  await run.page.waitForTimeout(1500);
  await run.shot("chat-box-lobby");

  {
    // a game room (the lobby's Create Game, then the dialog's OK): the same box over the room's
    // chat line, where the lines and the commands work as in the lobby
    mark = wire.length;
    const dialogs = run.all.length;
    await run.clickGame(720, 220);
    await until("the Create Game dialog", () =>
      run.all.slice(dialogs).some((l) => l.includes("[dialog] open 0xC3")),
    );
    await run.page.waitForTimeout(700);
    await run.clickGame(283, ra2 ? 377 : 357);
    await until("joingame", () => sent(mark, (l) => l.startsWith("joingame ")));
    const room = /^joingame (#\S+)/
      .exec(wire.slice(mark).find((w) => w.dir === ">" && w.line.startsWith("joingame "))?.line)
      ?.at(1)
      ?.toLowerCase();
    assert.ok(room, "the room's name");
    await run.page.waitForTimeout(2500);
    await box.waitFor({ timeout: 15000 });
    console.log(`ok  the chat box shows in the game room ${room}`);

    mark = wire.length;
    const said = `in the room ${tag}`;
    await box.click();
    await box.fill(said);
    await box.press("Enter");
    await until("the room line", () =>
      sent(mark, (l) => l.toLowerCase().startsWith(`privmsg ${room} :`) && l.includes(said)),
    );
    console.log("ok  a line in the room's box went out to the room");

    mark = wire.length;
    await box.fill(`/p zz${tag} room psst ${tag}`);
    await box.press("Enter");
    await until("the page from the room", () =>
      sent(mark, (l) => l.toLowerCase() === `privmsg zz${tag} :room psst ${tag}`),
    );
    assert.ok(
      !sent(mark, (l) => l.toLowerCase().startsWith(`privmsg ${room} :`)),
      "the page did not go to the room as text",
    );
    console.log("ok  /p in the room's box went out as the game's /page (a private line)");

    mark = wire.length;
    await box.fill(`/on zz${tag}`);
    await box.press("Enter");
    await until("find from the room", () => sent(mark, (l) => l.toLowerCase() === `find zz${tag}`));
    console.log("ok  /on in the room's box reaches the game (find)");

    // YuriBOT's commands work in a game room too: /help is answered privately (the server keeps
    // the line from the room)
    mark = wire.length;
    await box.fill("/help");
    await box.press("Enter");
    await until("YuriBOT's answer in the room", () =>
      wire.some(
        (w, i) =>
          i >= mark &&
          w.dir === "<" &&
          /^:YuriBOT!\S* PRIVMSG /i.test(w.line) &&
          w.line.includes(nick),
      ),
    );
    console.log("ok  /help in the room's box is answered by YuriBOT");
    await run.page.waitForTimeout(1500);
    await run.shot("chat-box-room");
  }
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
