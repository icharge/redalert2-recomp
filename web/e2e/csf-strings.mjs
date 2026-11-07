// The launcher's static strings.json reaches the game: strings.json -> generated CSF -> main menu.
// Start Vite, then run with --profile <persistent profile containing an imported game>.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  answerExit,
  chooseEdition,
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
const csfFile = edition === "ra2" ? "ra2.csf" : "ra2md.csf";
const launcherVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const run = await startPage(opts);
const report = { edition };

/** Read a label's first value from a CSF, without the TypeScript codec. */
function readCsfLabel(data, wanted) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const labels = view.getUint32(8, true);
  const decoder = new TextDecoder("latin1");
  let at = 24;
  for (let i = 0; i < labels; i++) {
    if (view.getUint32(at, true) !== 0x4c424c20) throw new Error("bad LBL");
    at += 4;
    const pairs = view.getUint32(at, true);
    at += 4;
    const length = view.getUint32(at, true);
    at += 4;
    const label = decoder.decode(data.subarray(at, at + length));
    at += length;
    let first = null;
    for (let pair = 0; pair < pairs; pair++) {
      const magic = view.getUint32(at, true);
      at += 4;
      const count = view.getUint32(at, true);
      at += 4;
      let text = "";
      for (let c = 0; c < count; c++) {
        text += String.fromCharCode(~view.getUint16(at, true) & 0xffff);
        at += 2;
      }
      if (magic === 0x53545257) {
        const extra = view.getUint32(at, true);
        at += 4 + extra;
      }
      if (pair === 0) first = text;
    }
    if (label.toUpperCase() === wanted.toUpperCase()) return first;
  }
  return null;
}

/** The generated CSF can be at the root or in the active mod's folder. */
async function readGameCsf(name) {
  return run.page.evaluate((wanted) => {
    const fs = window.Module.FS;
    const root = fs.readdir("/game").find((entry) => entry.toLowerCase() === wanted.toLowerCase());
    if (root) return Array.from(fs.readFile(`/game/${root}`));
    let mods = [];
    try {
      mods = fs.readdir("/game/mods");
    } catch {
      mods = [];
    }
    for (const mod of mods) {
      let entries = [];
      try {
        entries = fs.readdir(`/game/mods/${mod}`);
      } catch {
        continue;
      }
      const found = entries.find((entry) => entry.toLowerCase() === wanted.toLowerCase());
      if (found) return Array.from(fs.readFile(`/game/mods/${mod}/${found}`));
    }
    throw new Error(`no ${wanted} in /game or /game/mods`);
  }, name);
}

try {
  await waitForLauncher(run.page);
  const staticConfig = await run.page.evaluate(async () => {
    const response = await fetch("strings.json");
    if (!response.ok) throw new Error(`strings.json: ${response.status}`);
    return response.json();
  });
  assert.equal(
    staticConfig[edition]?.strings?.["GUI:ExitGame"],
    "Exit to Launcher",
    "strings.json must hold the exit override",
  );
  report.static = "strings.json";

  await chooseEdition(run.page, edition);
  await playButton(run.page).click();
  await run.waitFor("the main menu", (state) => state?.phase === "running", 300);

  const csf = Uint8Array.from(await readGameCsf(csfFile));
  const value = readCsfLabel(csf, "GUI:ExitGame");
  assert.equal(value, "Exit to Launcher", "the game must read the generated CSF");
  report.csf = { file: csfFile, label: "GUI:ExitGame", value };
  // The game appends " <its own version>" to GUI:Version on the main menu.
  const version = readCsfLabel(csf, "GUI:Version");
  assert.equal(version, `YN ${launcherVersion} /`, "GUI:Version must carry the launcher's version");
  report.version = { label: "GUI:Version", value: version };
  await run.shot("main-menu");

  const { size } = await run.state();
  await run.clickGame(719 + ((size?.w ?? 800) - 800) / 2, 554 + ((size?.h ?? 600) - 600) / 2);
  await answerExit(run.page);
  await run.page.waitForURL((url) => !url.searchParams.has("test") && !url.searchParams.has("dev"));
  await waitForLauncher(run.page);
  report.returned = true;
  console.log(
    `PASS: ${title} reads strings.json and shows GUI:ExitGame as Exit to Launcher and GUI:Version as "YN ${launcherVersion} /".`,
  );
} catch (error) {
  report.error = String(error);
  report.state = await run.state();
  console.error("FAIL:", error);
  console.error("lines:", run.lines.join("\n"));
  console.error("game log:", (await run.log()).join("\n"));
  throw error;
} finally {
  writeFileSync(path.join(opts.shots, "csf-strings.json"), JSON.stringify(report, null, 2));
  await run.browser.close();
}
