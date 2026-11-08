// Prototype check for docs/web/online-maps-research.md: with Customize Battle open, search MapDB
// from the page's GET MAPS panel, download a real map, find it in the game's list and play it.
//
//   node e2e/maps-download.mjs --url "http://127.0.0.1:5175/?mute" --game ../game --build ../build-proto/out
//
// Needs the dev server (its /maps-api/ route reaches mapdb2.cncnet.org) and the build with ra2_maps_rescan.
import { options, startPage } from "./lib.mjs";

const query = process.env.QUERY ?? "Dustbowl Battleground";
const listText = process.env.LISTTEXT ?? "MattyK";
const argv = process.argv.slice(2);
const t = await startPage(options(argv));
await t.waitFor("the main menu", (s) => s?.phase === "running");
const sleep = (ms) => t.page.waitForTimeout(ms);

await sleep(3000);
await t.clickGame(719, 221); // Single Player
await sleep(4000);
await t.clickGame(720, 305); // Skirmish
await sleep(4000);
await t.clickGame(720, 305); // Customize Battle
await sleep(4000);
await t.shot("dl-1-customize-battle");

// SKIP_DOWNLOAD=1: a map kept from an earlier run (same --profile) must already be listed
if (!process.env.SKIP_DOWNLOAD) {
  // the page learns the screen is open from the game's mapSearch event
  const button = t.page.getByRole("button", { name: "GET MAPS" });
  await button.waitFor({ timeout: 10_000 });
  await button.click();
  await t.page.getByLabel("Search maps").fill(query);
  await t.page.getByLabel("Search maps").press("Enter");
  const rows = t.page.getByRole("list", { name: "Maps found" }).getByRole("listitem");
  await rows.first().waitFor({ timeout: 30_000 });
  console.log("results:", await rows.count());
  console.log("first:", (await rows.first().innerText()).replace(/\n/g, " | "));
  await t.shot("dl-2-results");

  await rows.first().getByRole("button", { name: "DOWNLOAD" }).click();
  await t.page.getByText("added to the list").first().waitFor({ timeout: 30_000 });
  console.log("downloaded");
  await t.shot("dl-3-added");
  await t.page.keyboard.press("Escape");
  await sleep(3000);
  await t.shot("dl-4-list-refilled");
}

// the game's own search box finds it
await t.clickGame(435, 136);
await sleep(500);
await t.page.keyboard.type(listText, { delay: 150 });
await sleep(1500);
await t.shot("dl-5-search");

if (process.env.PLAY) {
  await t.clickGame(720, 221); // Use Map
  await sleep(3000);
  await t.clickGame(719, 263); // Start Game
  await sleep(25000);
  await t.shot("dl-6-playing");
  console.log("match", JSON.stringify(await t.state()));
}
console.log(
  "maps lines:",
  (await t.log())
    .filter((l) => l.includes("[maps]"))
    .slice(-3)
    .join(" / "),
);
await t.browser.close();
process.exit(0);
