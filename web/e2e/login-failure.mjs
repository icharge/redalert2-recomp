// End to end (G2-S6): in the RA2 edition a login with a wrong password shows the game's own
// "bad password" text (OnConnection's 0x80040065 -> TXT_BADPASS), not "Could not connect".
// Start the server first (`pnpm wol-server`) and Vite, then from web/:
//   node e2e/login-failure.mjs --url 'http://127.0.0.1:5175/?target=game' --game ../game
// An account is registered through POST /register; the game's login dialog (0x10F) then gets that
// nick and a wrong password. The notice dialog (0xD0) opens and the text the game formatted for
// it is TXT_BADPASS ("That login or password was incorrect.").
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startPage, options } from "./lib.mjs";

const argv = process.argv.slice(2);
const opts = options(argv);
opts.pageArgs.push("--mute", "--debuglog");
const server = process.env.WOL_TEST_SERVER ?? "http://127.0.0.1:9090";
const ra2 = new URL(opts.url).searchParams.get("target") === "game";
assert.ok(ra2, "the check is for the RA2 edition: use ?target=game");
const nick = `bp${randomBytes(3).toString("hex")}`;

const registered = await fetch(`${server}/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ user: nick, pass: "rightpass1" }),
});
assert.ok(registered.ok, `register ${nick}: ${registered.status}`);

const run = await startPage(opts);
const waitNative = async (text, after = 0, ms = 20000) => {
  const deadline = Date.now() + ms;
  while (!run.all.slice(after).some((l) => l.includes(text))) {
    assert.ok(Date.now() < deadline, `timed out waiting for native ${text}`);
    await run.page.waitForTimeout(100);
  }
};
try {
  await run.waitFor("main menu", (s) => s?.phase === "running", 240);
  await run.page.waitForTimeout(1500);
  await run.clickGame(720, 263); // Internet / LAN
  await waitNative("[dialog] open 0x10E");
  await run.page.waitForTimeout(800);
  await run.clickGame(720, 263); // Internet
  await waitNative("[dialog] open 0x10F");
  await run.page.waitForTimeout(1200);
  for (const [y, text] of [
    [167, nick],
    [205, "wrongpass99"],
  ]) {
    await run.clickGame(388, y);
    await run.page.keyboard.press("End");
    for (let i = 0; i < 12; i++) await run.page.keyboard.press("Backspace");
    await run.page.keyboard.type(text, { delay: 100 });
    await run.page.waitForTimeout(250);
  }
  const submitted = run.all.length;
  await run.clickGame(720, 220); // Login
  await run.page.waitForTimeout(6000);
  const after = run.all.slice(submitted);
  console.log(after.filter((l) => !l.startsWith("@ra2")).join("\n"));
  // The game formats the notice into a buffer at 0xB2A8EC (wonline.cpp, OnConnection's
  // TXT_BADPASS branch) before opening its 0xD0 message dialog.
  const text = await run.page.evaluate(() => {
    const h = window.Module.HEAPU8;
    let s = "";
    for (let i = 0; i < 160; i++) {
      const c = h[0xb2a8ec + 2 * i] | (h[0xb2a8ec + 2 * i + 1] << 8);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  });
  console.log("notice text:", JSON.stringify(text));
  assert.ok(
    after.some((l) => l.includes("[dialog] open 0xD0")),
    "the game opens its notice dialog",
  );
  assert.ok(
    !after.some((l) => l.includes("Joined Channel")),
    "a wrong password must not reach the lobby",
  );
  // TXT_BADPASS in the English table; the generic failure is TXT_CANT_CONNECT, "Could not connect".
  assert.match(
    text,
    /login or password was incorrect/,
    "the notice is the game's bad password text",
  );
  console.log("PASS");
} finally {
  await run.browser.close();
}
