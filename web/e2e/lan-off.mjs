// LAN play turned off in the launcher (ra2-lan-play = "0"): the game tray has no LAN button, and the
// game's Network button goes back to the main menu with a note instead of opening the WebRTC dialog.
// Run with the web dev server (VITE_E2E_HOOKS=1) and a built module (docs/web/testing.md).
import assert from "node:assert/strict";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.pageArgs.push("--mute", "--debuglog");
const run = await startPage({
  ...opts,
  setup: (context) => context.addInitScript(() => window.localStorage.setItem("ra2-lan-play", "0")),
});

const mainMenus = () =>
  run.page.evaluate(
    () =>
      (window.ra2Store?.getLog() ?? []).filter((line) => line.includes("[dialog] open 0xE2"))
        .length,
  );

try {
  await run.waitFor("main menu", (state) => state?.phase === "running");
  await run.page.waitForFunction(
    () => (window.ra2Store?.getLog() ?? []).some((line) => line.includes("[dialog] open 0xE2")),
    undefined,
    { timeout: 60000 },
  );
  await run.page.waitForTimeout(1500);
  const lanButtons = await run.page.locator("button", { hasText: /^\s*LAN\s*$/ }).count();
  assert.equal(lanButtons, 0, "the game tray has no LAN button while LAN play is off");

  const before = await mainMenus();
  await run.clickGame(720, 305); // the game's own Network button (dialog 0xE2)
  const note = run.page.getByText("LAN play is off.", { exact: false });
  await note.waitFor({ timeout: 45000 });
  await run.page.waitForFunction(
    (count) =>
      (window.ra2Store?.getLog() ?? []).filter((line) => line.includes("[dialog] open 0xE2"))
        .length > count,
    before,
    { timeout: 45000 },
  );
  assert.equal(
    await run.page.getByRole("dialog", { name: "LAN multiplayer" }).count(),
    0,
    "no WebRTC dialog opens while LAN play is off",
  );
  const state = await run.state();
  assert.equal(state.lanSession, null, "the page answered the game's LAN request");
  await run.page.waitForTimeout(1000);
  await run.shot("lan-off-main-menu");
  console.log(
    "PASS: LAN play off: no tray LAN button; Network went back to the main menu with a note.",
  );
} catch (error) {
  await run.shot("lan-off-failure").catch(() => {});
  throw error;
} finally {
  await run.browser.close();
}
