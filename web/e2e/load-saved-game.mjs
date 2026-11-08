// Load a real save through the imported game and require advancing simulation,
// including the optional unresolved-reference recovery dialog.
// Uses a disposable test profile: its existing /game saves are replaced.
// cd web; node e2e/load-saved-game.mjs --save ../work/perf/user-saves/Sov06T.sav \
//   --game ../game --require-reference-prompt --shots ../work/sub-divide-fixed
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  chooseEdition,
  openInstall,
  options,
  playButton,
  startPage,
  waitForLauncher,
} from "./lib.mjs";
import { at } from "./perf-nav.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : argv[index + 1];
};
const savePath = option("--save", null);
if (!savePath) throw new Error("pass --save <a local .sav file>");
const save = readFileSync(path.resolve(savePath));
const limitSeconds = Number(option("--seconds", "45"));
if (!Number.isFinite(limitSeconds) || limitSeconds <= 0)
  throw new Error("--seconds must be positive");
const base = options(argv);
base.edition = option("--edition", "ra2");
const frameAddress = { ra2: 0x00a40d2c, ra2md: 0x00a8ed84 }[base.edition];
if (!frameAddress) throw new Error("--edition must be ra2 or ra2md");
base.profile ??= path.resolve("../work/load-saved-game/profile");
base.noDev = true;
// --game supplies the import, rather than startPage's in-memory fixture route.
const gameDir = path.resolve(base.testGame ?? "../game");
base.testGame = null;
const t = await startPage(base);
const report = { save: path.basename(savePath), edition: base.edition, samples: [], prompts: 0 };
let failed = false;
try {
  await waitForLauncher(t.page, 30_000);
  if (!(await t.page.getByRole("navigation", { name: "Games" }).getByRole("button").count())) {
    await openInstall(t.page);
    await t.page.getByLabel("Game folder", { exact: true }).setInputFiles(gameDir);
    await t.page.getByRole("heading", { name: "READY TO INSTALL" }).waitFor({ timeout: 180_000 });
    await t.page.getByRole("button", { name: /^INSTALL \d/ }).click();
    await t.page
      .getByRole("navigation", { name: "Games" })
      .getByRole("button")
      .first()
      .waitFor({ timeout: 300_000 });
  }
  await chooseEdition(t.page, base.edition);
  await playButton(t.page).click();
  await t.page.waitForURL(/\/game\?/);
  const url = new URL(t.page.url());
  url.searchParams.append("arg", "--debuglog");
  url.searchParams.set("mute", "1");
  await t.page.goto(url.toString());
  await t.waitFor("main menu", (state) => state?.phase === "running", 300);
  await t.page.evaluate(
    ([name, text]) => {
      const fs = window.Module.FS;
      for (const old of fs.readdir("/game").filter((entry) => /\.sav$/i.test(entry)))
        fs.unlink(`/game/${old}`);
      fs.writeFile(
        `/game/${name}`,
        Uint8Array.from(atob(text), (char) => char.charCodeAt(0)),
      );
    },
    [path.basename(savePath), save.toString("base64")],
  );
  await t.page.waitForTimeout(1500);
  await t.clickGame(...at.singlePlayer);
  await t.page.waitForTimeout(1000);
  await t.clickGame(...at.loadSavedGame);
  await t.page.waitForTimeout(1500);
  await t.shot("load-list");
  await t.clickGame(...at.firstSave);
  const logStart = t.all.length;
  const started = Date.now();
  await t.clickGame(...at.loadSave);
  let previous = null;
  let advances = 0;
  for (;;) {
    const state = await t.state();
    const frame = await t.page.evaluate(
      (address) => Atomics.load(new Uint32Array(window.Module.HEAPU8.buffer), address >>> 2),
      frameAddress,
    );
    const elapsed = (Date.now() - started) / 1000;
    report.samples.push({ elapsed, phase: state.phase, frame });
    if (previous !== null && frame > previous) advances++;
    previous = frame;
    if (state.phase === "crashed" || state.phase === "exited")
      throw new Error(`the game ${state.phase}: ${state.error ?? ""}`);
    if (state.saveReferencePrompt) {
      report.prompts++;
      if (report.prompts > 1)
        throw new Error("reference recovery prompted again during the same load");
      await t.shot("unresolved-reference");
      await t.page.getByRole("button", { name: "IGNORE & CONTINUE", exact: true }).click();
    }
    if (advances >= 3 && t.all.slice(logStart).some((line) => line.includes("- Complete"))) {
      if (argv.includes("--require-reference-prompt") && report.prompts !== 1)
        throw new Error("the save did not exercise unresolved-reference recovery");
      report.elapsedSeconds = elapsed;
      console.log(
        `PASS: ${report.save} loaded and simulated in ${elapsed.toFixed(2)}s (${report.prompts} prompt)`,
      );
      break;
    }
    if (elapsed > limitSeconds)
      throw new Error(
        `save loading stalled: no advancing simulation within ${limitSeconds}s (frame ${frame})`,
      );
    await t.page.waitForTimeout(500);
  }
  await t.shot("loaded-battle");
} catch (error) {
  failed = true;
  report.error = String(error);
  console.error(error);
  await t.shot("failure").catch(() => {});
} finally {
  writeFileSync(path.join(base.shots, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(base.shots, "game.log"), t.all.join("\n"));
  writeFileSync(path.join(base.shots, "console.log"), t.lines.join("\n"));
  await t.browser.close();
}
process.exitCode = failed ? 1 : 0;
