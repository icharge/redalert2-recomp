// The server-dependent link buttons: log in to the local RA2Web (127.0.0.1:9090)
// and press the tournament/news controls in the real lobby.
//
// Start the WOL server, then Vite with
//   VITE_WOL_HTTP_URL=http://127.0.0.1:9090
//   VITE_WOL_SOCKET_URL=ws://127.0.0.1:9090/wol
// and run with the imported-game profile:
//   node e2e/links-lobby.mjs --url 'http://127.0.0.1:5173/' --edition ra2md --profile <dir>
//   node e2e/links-lobby.mjs --url 'http://127.0.0.1:5173/' --edition ra2 --profile <dir>
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";
import { openGame } from "./perf-nav.mjs";

const opts = options(process.argv.slice(2));
if (!opts.profile && !opts.testGame)
  throw new Error("Pass --profile <an imported-game Chrome profile> or --game <local game folder>.");
const ra2 = opts.edition === "ra2";
opts.pageArgs.push("--mute", "--debuglog");
// Each press waits for its dialog, so the order matters, not the seconds.
// RA2's clan/tournament web controls live two dialogs deep: the custom-match
// lobby (0x113) opens the WOL chat (0xBE) with ClanAndLadder, and 0xBE's
// ViewTourLadder opens the ladder screen (0xC1) with its two web buttons.
let presses = ra2
  ? ["0x113:1368@5", "0xBE:1368@8", "0xC1:1004@11", "0xC1:1005@14", "0xBE:1398@17"]
  : ["0x113:1955@5", "0x113:1958@8"];
const extra = [];
for (let i = 0; i < process.argv.length; i++)
  if (process.argv[i] === "--press") extra.push(process.argv[++i]);
if (extra.length) presses = extra;
for (const press of presses) opts.pageArgs.push("--press", press);

// A local folder (Yuri's Revenge fits the dev heap) or the imported-game profile
// (Red Alert 2's large MIX files are read in place from OPFS).
const run = opts.profile
  ? await openGame(opts, { shots: opts.shots, video: "800x600" })
  : await startPage(opts);
const report = { edition: opts.edition, url: run.page.url() };
const waitNative = async (text, timeout = 60_000) => {
  const until = Date.now() + timeout;
  while (!run.all.some((line) => line.includes(text))) {
    assert.ok(Date.now() < until, `timed out waiting for ${text}`);
    await run.page.waitForTimeout(200);
  }
};
const waitDialog = (id) => waitNative(`[dialog] open ${id}`, 120_000);

try {
  await run.waitFor("the main menu", (state) => state?.phase === "running", 300);
  await run.page.waitForTimeout(1000);
  await run.clickGame(720, 263); // Internet
  await waitDialog("0x10E");
  await run.page.waitForTimeout(800);
  await run.clickGame(720, ra2 ? 263 : 305); // Custom Match
  await waitDialog("0x10F");
  await run.page.waitForTimeout(1200);
  await run.shot("login");
  // The two text fields, then Login. Same layout in both editions.
  for (const [y, text] of [
    [ra2 ? 167 : 250, "woltst1"],
    [ra2 ? 205 : 300, "wolpass1"],
  ]) {
    await run.clickGame(388, y);
    await run.page.keyboard.press("End");
    for (let i = 0; i < 12; i++) await run.page.keyboard.press("Backspace");
    await run.page.keyboard.type(text, { delay: 80 });
    await run.page.waitForTimeout(200);
  }
  await run.shot("login-filled");
  await run.clickGame(720, 220); // Login
  await run.page.waitForTimeout(1500);
  await run.shot("after-login");
  await waitNative("Joined Channel", 120_000);
  report.joined = true;

  // The presses run after login; each waits for its own dialog and slides in.
  await run.page.waitForTimeout(15_000);
  report.dialogs = [...new Set(run.all.filter((l) => l.startsWith("[dialog] open")))];
  report.presses = run.all.filter((l) => l.startsWith("[input]"));
  const opens = run.all
    .filter((line) => line.includes('"e":"open"'))
    .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
  report.open = opens;
  if (opens.length === 0) {
    // Some lobby buttons show the game's own notice (0x131) and never ask for a
    // URL; that is a valid outcome, not a failure of the hook.
    report.note = "the pressed controls did not ask for a URL";
  } else {
    for (const line of opens) {
      if (line.page) assert.equal(line.url, "", "a page key is not a URL");
      else assert.match(line.url, /^https?:\/\//);
    }
  }
  assert.ok(
    !run.all.some((line) => line.includes("TXT_NOBROWSER")),
    "the game must never reach its no-browser message",
  );
  await run.shot("link-lobby");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error);
  await run.shot("failure").catch(() => {});
  throw error;
} finally {
  writeFileSync(path.join(opts.shots, "links-lobby.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(opts.shots, "links-lobby.log"), run.all.join("\n"));
  writeFileSync(
    path.join(opts.shots, "links-lobby.console.log"),
    run.lines.map((line) => `[page] ${line}`).join("\n"),
  );
  await run.browser.close();
}
