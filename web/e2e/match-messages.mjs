// End to end: the match panel in single player (docs/web/match-chat.md). A skirmish starts through the
// game's own dialogs (Red Alert 2's starts with no opponent: an Easy Enemy is put in the second slot);
// then:
//   - the game's own rows (matchMessage events) reach the page's store, read-only;
//   - Enter goes to the game: the page opens no chat line, and its panel offers no typing.
// From web/, with Vite on 5175:
//   node e2e/match-messages.mjs --url 'http://127.0.0.1:5175/' --game ../game
// Shot: match-messages.
import assert from "node:assert/strict";
import { options, startPage } from "./lib.mjs";

const argv = process.argv.slice(2);
const opts = options(argv);
const ra2 = new URL(opts.url).searchParams.get("target") === "game";
// --probe: stop at the skirmish screen and take its picture (to find its controls)
const probe = argv.includes("--probe");
opts.pageArgs.push(
  "--mute",
  "--debuglog",
  "--press",
  "0xE2:1667@1", // main menu: Single Player
  "--press",
  "0x100:1401@2", // Single Player: Skirmish
);
// Yuri's Revenge's skirmish has a computer opponent already; Red Alert 2's starts with none
if (!ra2 && !probe) opts.pageArgs.push("--press", "0x102:1559@3"); // Skirmish: Start
const run = await startPage({ ...opts, shots: `${opts.shots}/match-messages` });
const { page, all } = run;
/** Red Alert 2: a computer opponent in the second slot, then Start (the game's 800x600). */
async function addOpponent() {
  await run.clickGame(272, 114); // the second slot's list: None, Easy, Medium, Brutal Enemy
  await page.waitForTimeout(800);
  await run.clickGame(169, 159); // Easy Enemy
  await page.waitForTimeout(800);
  await run.clickGame(719, 262); // Start Game
  console.log("ok  an Easy Enemy in the second slot, then Start Game");
}

const waitLog = async (text, timeout = 180000) => {
  const deadline = Date.now() + timeout;
  while (!all.some((line) => line.includes(text))) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${text}`);
    assert.notEqual((await run.state())?.phase, "crashed");
    await page.waitForTimeout(250);
  }
};
try {
  if (ra2 || probe) {
    await waitLog("[dialog] open 0x102");
    await page.waitForTimeout(2000);
    if (probe) {
      if (argv.includes("--open")) {
        await run.clickGame(272, 114); // the second slot's list
        await page.waitForTimeout(800);
      }
      await run.shot("skirmish-setup");
      console.log("PROBE");
      process.exit(0);
    }
    await addOpponent();
  }
  await waitLog("Capture_Mouse");
  await page.waitForTimeout(4000);
  await page.locator("canvas").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  assert.equal(
    await page.getByRole("textbox", { name: /^Message to / }).count(),
    0,
    "no chat line",
  );
  assert.equal(
    await page.getByRole("button", { name: /press Enter to chat/ }).count(),
    0,
    "no typing prompt in single player",
  );
  console.log("ok  Enter in a skirmish opens no page chat line, and the panel offers no typing");
  const ready = all.filter((l) => l.includes('"matchChatReady"')).length;
  assert.equal(ready, 0, "a skirmish is not a match the panel can send in");
  const rows = all.filter((l) => l.includes('"matchMessage"'));
  console.log(`ok  no matchChatReady; game rows seen so far: ${rows.length}`);
  for (const row of rows.slice(0, 5)) console.log(`    ${row.slice(5, 160)}`);
  if (rows.length) {
    // the game's cursor over the panel opens it (input.ts sends this under Pointer Lock)
    await page.evaluate(() =>
      document
        .querySelector("[data-page-overlay]")
        ?.dispatchEvent(new CustomEvent("pageoverlay", { detail: true })),
    );
    await page.waitForTimeout(500);
  }
  await run.shot("match-messages");
  console.log("PASS");
} catch (error) {
  console.error("FAIL:", error?.message ?? error);
  await run.shot("match-messages-fail").catch(() => {});
  process.exitCode = 1;
} finally {
  await run.browser.close().catch(() => {});
}
