// A local end-to-end check of the page and the game together, in a real Chrome
// (docs/web/testing.md). Needs a built game (build-web.cmd), a game folder (../game, or
// RA2_GAME_DIR for the dev server), and a Chrome (CHROME_PATH).
//
//   pnpm dev            (in another terminal)
//   node e2e/smoke.mjs [--url http://127.0.0.1:5173/] [--shots DIR] [--headed]
//
// It waits for the main menu and checks that the canvas shows a picture.
import { options, picture, startPage } from "./lib.mjs";

const t = await startPage(options(process.argv.slice(2)));
const menu = await t.waitFor("the main menu", (s) => s?.phase === "running");
console.log(`main menu after ${((Date.now() - t.started) / 1000).toFixed(0)}s: ${menu.title}`);
await t.page.waitForTimeout(2000);
await t.shot("1-main-menu");

const shown = await picture(t.page);
console.log("picture", JSON.stringify(shown));
await t.browser.close();
process.exit(shown.lit > shown.sampled / 20 ? 0 : 1);
