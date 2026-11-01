// ?cursor=page in a real browser: the page captures the game's cursor palette
// and state through shared memory, and mounts the cursor layer
// (docs/web/cursor-layer.md). Run the dev server first:
//
//   node e2e/cursor-page.mjs --url "http://127.0.0.1:5173/?cursor=page&edition=ra2md"
import { options, picture, startPage } from "./lib.mjs";

const t = await startPage(options(process.argv.slice(2)));
const menu = await t.waitFor("the main menu", (s) => s?.phase === "running");
console.log(`main menu: ${menu.title}`);
await t.page.waitForTimeout(3000);

const state = await t.page.evaluate(async () => {
  const handle = await window.ra2Session;
  const { HEAP32 } = handle.memory();
  const at = handle.shared >> 2;
  const word = (index) => Atomics.load(HEAP32, at + index);
  const layer = document.querySelector("canvas[aria-hidden='true']");
  return {
    protocol: word(0),
    pageCursorSeq: word(1056),
    pageCursorKind: word(1057),
    pageCursorPaletteSeq: word(1067),
    pageCursorRequest: word(1062),
    layerMounted: !!layer,
    layerDisplay: layer?.style.display ?? null,
  };
});
console.log("shared:", JSON.stringify(state));
console.log("picture:", JSON.stringify(await picture(t.page)));
await t.shot("cursor-page-menu");
await t.browser.close();
process.exit(state.protocol >= 10 && state.pageCursorPaletteSeq > 0 ? 0 : 1);
