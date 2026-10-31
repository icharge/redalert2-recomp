// Launcher game settings survive into the game's own INI.
// Start Vite, then run with --profile <persistent profile containing an imported game>.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

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
  await run.page.getByRole("heading", { name: "Your games" }).waitFor({ timeout: 60_000 });
  const editionChoice = run.page.getByRole("radio", { name: new RegExp(title) });
  if ((await editionChoice.count()) > 0) await editionChoice.click();
  const settings = run.page.getByRole("button", { name: `Settings for ${title}` });
  await settings.waitFor({ timeout: 60_000 });
  await settings.click();
  await run.page.getByRole("dialog", { name: `${title} settings` }).waitFor();

  await run.page.getByRole("tab", { name: /Gameplay/ }).click();
  const autoScroll = run.page.getByRole("switch", { name: "Auto scroll" });
  await autoScroll.waitFor();
  const before = await autoScroll.isChecked();
  await autoScroll.click();
  const after = await autoScroll.isChecked();
  assert.notEqual(before, after, "the switch must change");
  report.autoScroll = { before, after };

  await run.page.getByRole("tab", { name: /Audio/ }).click();
  const volume = run.page.getByRole("slider", { name: "Sound volume" });
  await volume.focus();
  await volume.press("Home");
  for (let i = 0; i < 40; i++) await volume.press("ArrowRight");
  await run.page.waitForTimeout(300);
  report.volume = await volume.getAttribute("aria-valuenow");
  assert.equal(report.volume, "40", "the volume slider must reach 40");

  await run.page.getByRole("tab", { name: /Keyboard/ }).click();
  // Start from the standard bindings so this run does not fight the last run's key.
  await run.page.getByRole("button", { name: "Reset All" }).click();
  await run.page.waitForTimeout(300);
  await run.page.getByRole("combobox", { name: "Category" }).click();
  await run.page.getByRole("option", { name: "Interface" }).click();
  await run.page.getByRole("button", { name: "Game Menu" }).click();
  await run.page.getByRole("button", { name: "Assign new hotkey" }).click();
  await run.page.keyboard.press("F5");
  await run.page.getByRole("button", { name: "Assign", exact: true }).click();
  await run.page.waitForTimeout(500);
  report.hotkey = "F5";
  await run.page.waitForTimeout(300);

  await run.page.getByRole("button", { name: "Done" }).click();
  await run.page.getByRole("button", { name: "Play" }).click();
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
  await run.page.getByRole("heading", { name: "Exit game?" }).waitFor({ timeout: 30_000 });
  await run.page.getByRole("button", { name: "Exit game" }).click();
  await run.page.waitForURL((url) => !url.searchParams.has("test") && !url.searchParams.has("dev"));
  await run.page.getByRole("heading", { name: "Your games" }).waitFor({ timeout: 60_000 });
  const returnedEdition = run.page.getByRole("radio", { name: new RegExp(title) });
  if ((await returnedEdition.count()) > 0) await returnedEdition.click();
  const returned = run.page.getByRole("button", { name: `Settings for ${title}` });
  await returned.waitFor({ timeout: 30_000 });
  await returned.click();
  await run.page.getByRole("tab", { name: /Gameplay/ }).click();
  assert.equal(
    await run.page.getByRole("switch", { name: "Auto scroll" }).isChecked(),
    after,
    "the launcher must read the setting back after Exit",
  );
  await run.page.getByRole("tab", { name: /Audio/ }).click();
  assert.equal(
    await run.page.getByRole("slider", { name: "Sound volume" }).getAttribute("aria-valuenow"),
    "40",
    "the launcher must read the volume back after Exit",
  );
  await run.page.getByRole("tab", { name: /Keyboard/ }).click();
  await run.page.getByRole("combobox", { name: "Category" }).click();
  await run.page.getByRole("option", { name: "Interface" }).click();
  await run.page.getByRole("button", { name: "Game Menu" }).click();
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
