// End to end: a Thai translation reaches the game as Unicode and its main menu draws it shaped.
// Start Vite, then from web/, once per edition:
//   node e2e/thai-csf.mjs --url 'http://127.0.0.1:5175/?target=game' --game ../game      (RA2)
//   node e2e/thai-csf.mjs --url 'http://127.0.0.1:5175/' --game ../game                  (YR)
// The page is served a strings.json whose edition uses "windows-874" and gives GUI:ExitGame a Thai
// value (the app's own file is left alone). Then:
//   - the generated CSF in /game holds the value as UTF-16 Thai (U+0E01..), not Windows-874 bytes
//     (src/storage/csf.ts), and the page warned about nothing
//   - shot thai-csf-menu: the main menu, its exit button drawn by the TrueType engine (docs/ttf-text.md)
import assert from "node:assert/strict";
import { startPage, options } from "./lib.mjs";

const argv = process.argv.slice(2);
const opts = options(argv);
opts.pageArgs.push("--mute");
const ra2 = new URL(opts.url).searchParams.get("target") === "game";
const edition = ra2 ? "ra2" : "ra2md";
const csfFile = ra2 ? "ra2.csf" : "ra2md.csf";
const THAI = "ออกจากเกม";

const strings = {
  version: 1,
  [edition]: {
    encoding: "windows-874",
    strings: { "GUI:ExitGame": THAI, "GUI:Version": "YN {version} /" },
  },
};

const run = await startPage({
  ...opts,
  shots: `${opts.shots}/thai-csf`,
  setup: (context) =>
    context.route(/\/strings\.json(?:\?.*)?$/, (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(strings) }),
    ),
});

/** The first value of a CSF label as UTF-16 code units, without the TypeScript codec. */
function labelUnits(data, wanted) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const labels = view.getUint32(8, true);
  let at = 24;
  for (let i = 0; i < labels; i++) {
    at += 4;
    const pairs = view.getUint32(at, true);
    const length = view.getUint32(at + 4, true);
    at += 8;
    const label = new TextDecoder("latin1").decode(data.subarray(at, at + length));
    at += length;
    let first = null;
    for (let pair = 0; pair < pairs; pair++) {
      const magic = view.getUint32(at, true);
      const count = view.getUint32(at + 4, true);
      at += 8;
      const units = [];
      for (let c = 0; c < count; c++) units.push(~view.getUint16(at + c * 2, true) & 0xffff);
      at += count * 2;
      if (magic === 0x53545257) at += 4 + view.getUint32(at, true);
      if (pair === 0) first = units;
    }
    if (label.toUpperCase() === wanted) return first;
  }
  return null;
}

try {
  await run.waitFor("the main menu", (state) => state?.phase === "running", 300);
  const csf = Uint8Array.from(
    await run.page.evaluate((name) => {
      const fs = window.Module.FS;
      const found = fs.readdir("/game").find((entry) => entry.toLowerCase() === name);
      if (!found) throw new Error(`no ${name} in /game`);
      return Array.from(fs.readFile(`/game/${found}`));
    }, csfFile),
  );
  const units = labelUnits(csf, "GUI:EXITGAME");
  assert.ok(units, "the generated table has GUI:ExitGame");
  assert.equal(String.fromCharCode(...units), THAI, "GUI:ExitGame is the Thai value as UTF-16");
  assert.ok(
    units.every((unit) => unit >= 0x0e01 && unit <= 0x0e5b),
    "no Windows-874 bytes left in the value",
  );
  console.log(`ok  ${csfFile}'s GUI:ExitGame is ${THAI} as UTF-16 Thai`);
  const warned = run.lines.filter((line) => line.includes("[csf]"));
  assert.deepEqual(warned, [], "the page warned about the strings");
  console.log("ok  no [csf] warning");
  // the menu's buttons slide in; give them time to settle
  await run.page.waitForTimeout(8000);
  await run.shot("thai-csf-menu");
  console.log("ok  shot thai-csf-menu: the main menu with the Thai exit button");
  console.log(`PASS: ${edition}`);
} catch (error) {
  await run.fail(error);
} finally {
  await run.browser.close().catch(() => {});
}
