// LAN play turned off in the launcher (ra2-lan-play = "0"): the page passes --no-lan, so the game's
// main menu has no Network button (the host moves it out of sight and moves Movies & Credits and
// Options up one slot), and the game tray has no LAN button.
// Run with the web dev server and a built module (docs/web/testing.md).
import assert from "node:assert/strict";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.pageArgs.push("--mute", "--debuglog", "--windows", "--heartbeat", "3");
const run = await startPage({
  ...opts,
  setup: (context) => context.addInitScript(() => window.localStorage.setItem("ra2-lan-play", "0")),
});

/** The main menu's buttons from the last --windows dump: name -> { x, y }. */
const menuButtons = () =>
  run.page.evaluate(() => {
    const buttons = {};
    for (const line of window.ra2Store?.getLog() ?? []) {
      const match = /\[windows\] \d+ kind 3 .* at (-?\d+),(-?\d+) .*"GUI:(\w+)"/.exec(line);
      if (match) buttons[match[3]] = { x: Number(match[1]), y: Number(match[2]) };
    }
    return buttons;
  });

try {
  await run.waitFor("main menu", (state) => state?.phase === "running");
  await run.page.waitForFunction(
    () => (window.ra2Store?.getLog() ?? []).some((line) => line.includes("[dialog] open 0xE2")),
    undefined,
    { timeout: 60000 },
  );
  // two heartbeats, so a window dump comes after the menu was laid out
  await run.page.waitForTimeout(7000);
  const buttons = await menuButtons();
  console.log("main menu buttons:", JSON.stringify(buttons));
  assert.ok(buttons.Network, "the Network button is still a window of the main menu");
  assert.ok(buttons.Network.y < 0, "the Network button is out of sight");
  assert.equal(buttons.MoviesAndCredits?.y, buttons.WWOnline.y + 42, "Movies & Credits moved up");
  assert.equal(buttons.Options?.y, buttons.WWOnline.y + 84, "Options moved up");
  const lanButtons = await run.page.locator("button", { hasText: /^\s*LAN\s*$/ }).count();
  assert.equal(lanButtons, 0, "the game tray has no LAN button while LAN play is off");
  assert.equal((await run.state()).lanSession, null, "no LAN session was asked for");
  await run.shot("lan-off-main-menu");
  console.log("PASS: LAN play off: no Network button in the main menu and no tray LAN button.");
} catch (error) {
  await run.shot("lan-off-failure").catch(() => {});
  throw error;
} finally {
  await run.browser.close();
}
