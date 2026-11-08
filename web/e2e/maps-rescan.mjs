// Prototype check for docs/web/online-maps-research.md: on Customize Battle, write a map file into
// /game while the game runs, ask the game to scan its map folder again, and read back the list.
//
//   node e2e/maps-rescan.mjs --url http://127.0.0.1:5175/ --game ../game --build ../build-proto/out
//
// Needs the build with ra2_maps_rescan / ra2_maps_dump (src/web/map_search.c).
import { options, startPage } from "./lib.mjs";

const argv = process.argv.slice(2);
const t = await startPage(options(argv));
await t.waitFor("the main menu", (s) => s?.phase === "running");
const sleep = (ms) => t.page.waitForTimeout(ms);
const mark = () => t.all.length;
const since = (n) => t.all.slice(n).filter((l) => l.includes("[maps]"));

// Single Player, Skirmish: the Customize Battle screen
await sleep(3000);
await t.clickGame(719, 221);
await sleep(4000);
await t.clickGame(720, 305);
await sleep(5000);
await t.shot("maps-customize-battle");

let m = mark();
await t.page.evaluate(() => window.Module._ra2_maps_dump());
await sleep(1500);
const first = since(m);
console.log("first dump:\n" + first.join("\n"));

// A new map, written while the game runs: testmap.yrm renamed in its [Basic] Name
const stamp = await t.page.evaluate(() => {
  const FS = window.Module.FS;
  const text = new TextDecoder("latin1").decode(FS.readFile("/game/testmap.yrm"));
  const edited = text.replace(/^Name=.*$/m, "Name=ZZ Proto Download");
  const bytes = new Uint8Array(edited.length);
  for (let i = 0; i < edited.length; i++) bytes[i] = edited.charCodeAt(i) & 0xff;
  FS.writeFile("/game/protodl.yrm", bytes);
  return FS.stat("/game/protodl.yrm").size;
});
console.log("wrote /game/protodl.yrm,", stamp, "bytes");

const mode = process.env.RESCAN ?? "truncate";
m = mark();
await t.page.evaluate(
  (truncate) => window.Module._ra2_maps_rescan(truncate),
  mode === "truncate" ? 1 : 0,
);
await sleep(3000);
const second = since(m);
console.log(`rescan (${mode}):\n` + second.join("\n"));
await t.shot("maps-after-rescan");

// open Customize Battle: the dialog fills its list from the vector
await t.clickGame(720, 305);
await sleep(4000);
await t.shot("maps-list-open");
if (process.env.SEARCH) {
  await t.clickGame(435, 136);
  await sleep(500);
  await t.page.keyboard.type(process.env.SEARCH, { delay: 150 });
  await sleep(1500);
  await t.shot("maps-list-search");
}

if (process.env.PLAY) {
  await t.clickGame(720, 221); // Use Map
  await sleep(3000);
  await t.shot("maps-used");
  await t.clickGame(719, 263); // Start Game
  await sleep(25000);
  await t.shot("maps-playing");
  console.log("match", JSON.stringify(await t.state()));
  console.log(
    (await t.log())
      .filter((l) => /map|error|crash/i.test(l))
      .slice(-12)
      .join("\n"),
  );
}

const s = await t.state();
console.log("state", JSON.stringify(s));
await t.browser.close();
process.exit(0);
