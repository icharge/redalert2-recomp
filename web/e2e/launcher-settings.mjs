// Launcher game settings survive into the game's own INI.
// Start Vite, then run with --profile <persistent profile containing an imported game>.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  answerExit,
  chooseEdition,
  openTab,
  options,
  playButton,
  startPage,
  waitForLauncher,
} from "./lib.mjs";

const opts = options(process.argv.slice(2));
if (!opts.profile) throw new Error("Pass --profile <imported profile>.");
opts.noDev = true;
opts.pageArgs.push("--mute");
const edition = opts.edition ?? "ra2md";
const title = edition === "ra2" ? "Red Alert 2" : "Yuri's Revenge";
const iniFile = edition === "ra2" ? "/game/RA2.INI" : "/game/RA2MD.INI";
const keyboardFile = edition === "ra2" ? "/game/KEYBOARD.INI" : "/game/KEYBOARDMD.INI";
const run = await startPage(opts);
const report = { edition };

try {
  await waitForLauncher(run.page);
  await chooseEdition(run.page, edition);
  const section = (name) =>
    run.page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name, exact: true });
  await run.page.getByRole("link", { name: "Settings", exact: true }).click();

  await section("GAMEPLAY").click();
  const autoScroll = run.page.getByRole("switch", { name: "Auto scroll" });
  await autoScroll.waitFor();
  const before = await autoScroll.isChecked();
  await autoScroll.click();
  const after = await autoScroll.isChecked();
  assert.notEqual(before, after, "the switch must change");
  report.autoScroll = { before, after };

  await section("AUDIO").click();
  const volume = run.page.getByRole("slider", { name: "Sound", exact: true });
  await volume.focus();
  await volume.press("Home");
  for (let i = 0; i < 4; i++) await volume.press("ArrowRight");
  await run.page.waitForTimeout(300);
  report.volume = await volume.getAttribute("aria-valuenow");
  assert.equal(report.volume, "40", "the volume pips must reach 40");

  await section("KEYBOARD").click();
  // Start from the standard bindings so this run does not fight the last run's key.
  await run.page.getByRole("button", { name: "RESET ALL KEYS" }).click();
  await run.page.waitForTimeout(300);
  await run.page.getByRole("button", { name: "Interface", exact: true }).click();
  await run.page.getByRole("button", { name: /^Game Menu/ }).click();
  await run.page.getByRole("button", { name: "CHANGE KEY" }).click();
  await run.page.keyboard.press("F5");
  await run.page.waitForTimeout(500);
  report.hotkey = "F5";

  await openTab(run.page, "PLAY");
  await playButton(run.page).click();
  await run.waitFor("the main menu", (state) => state?.phase === "running", 300);

  const readGame = (wanted) =>
    run.page.evaluate((name) => {
      const actual = window.Module.FS.readdir("/game").find(
        (entry) => entry.toLowerCase() === name.toLowerCase(),
      );
      if (!actual) throw new Error(`no ${name} in /game`);
      return new TextDecoder("latin1").decode(window.Module.FS.readFile(`/game/${actual}`));
    }, wanted);
  const ini = await readGame(iniFile.split("/").at(-1));
  const keyboard = await readGame(keyboardFile.split("/").at(-1));
  const wanted = `AutoScroll=${after ? "yes" : "no"}`;
  assert.match(ini, new RegExp(wanted), `the game must start with ${wanted}`);
  assert.match(ini, /SoundVolume=0\.400000/, "the game must start with the launcher volume");
  assert.match(keyboard, /=116/, "the game must start with the F5 hotkey");
  report.restored = { file: iniFile, line: wanted, volume: 40, hotkey: "F5" };

  const { size } = await run.state();
  await run.clickGame(719 + ((size?.w ?? 800) - 800) / 2, 554 + ((size?.h ?? 600) - 600) / 2);
  await answerExit(run.page);
  await run.page.waitForURL((url) => !url.searchParams.has("test") && !url.searchParams.has("dev"));
  await waitForLauncher(run.page);
  await chooseEdition(run.page, edition);
  await run.page.getByRole("link", { name: "Settings", exact: true }).click();
  await section("GAMEPLAY").click();
  assert.equal(
    await run.page.getByRole("switch", { name: "Auto scroll" }).isChecked(),
    after,
    "the launcher must read the setting back after Exit",
  );
  await section("AUDIO").click();
  assert.equal(
    await run.page
      .getByRole("slider", { name: "Sound", exact: true })
      .getAttribute("aria-valuenow"),
    "40",
    "the launcher must read the volume back after Exit",
  );
  await section("KEYBOARD").click();
  await run.page.getByRole("button", { name: "Interface", exact: true }).click();
  await run.page.getByRole("button", { name: /^Game Menu/ }).click();
  assert.ok(
    (await run.page.getByText("F5", { exact: true }).count()) > 0,
    "the launcher must read the hotkey back after Exit",
  );
  report.survivedExit = { autoScroll: after, volume: 40, hotkey: "F5" };
  console.log(`PASS: ${title} keeps the launcher setting into the game and back after Exit.`);
} catch (error) {
  report.error = String(error);
  report.state = await run.state();
  console.error("FAIL:", error);
  console.error((await run.log()).join("\n"));
  throw error;
} finally {
  writeFileSync(path.join(opts.shots, "launcher-settings.json"), JSON.stringify(report, null, 2));
  await run.browser.close();
}
