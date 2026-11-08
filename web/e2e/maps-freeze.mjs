// After a map is downloaded while Customize Battle is open, the list is refilled. This checks the
// screen still answers: clicking other maps must move the highlight and change the preview.
//
//   node e2e/maps-freeze.mjs --url "http://127.0.0.1:5180/?mute" --game E:/Games/Westwood/RA2 --build ../build-proto2/out
import { options, startPage } from "./lib.mjs";

const query = process.env.QUERY ?? "Dustbowl Battleground";
const t = await startPage(options(process.argv.slice(2)));
await t.waitFor("the main menu", (s) => s?.phase === "running");
const sleep = (ms) => t.page.waitForTimeout(ms);

await sleep(3000);
await t.clickGame(719, 221); // Single Player
await sleep(4000);
await t.clickGame(720, 305); // Skirmish
await sleep(4000);
await t.clickGame(720, 305); // Customize Battle
await sleep(4000);

if (!process.env.SKIP_DOWNLOAD) {
  await t.page.getByRole("button", { name: "GET MAPS" }).click();
  await t.page.getByLabel("Search maps").fill(query);
  await t.page.getByLabel("Search maps").press("Enter");
  const rows = t.page.getByRole("list", { name: "Maps found" }).getByRole("listitem");
  await rows.first().waitFor({ timeout: 30_000 });
  const n = Math.min(
    Number(process.env.DOWNLOADS ?? 1),
    (await rows.count()) - Number(process.env.FIRST ?? 0),
  );
  console.log("results:", await rows.count(), "downloading", n);
  const first = Number(process.env.FIRST ?? 0);
  for (let i = first; i < first + n; i++) {
    console.log("  ", (await rows.nth(i).innerText()).split("\n").join(" | "));
    await rows.nth(i).getByRole("button", { name: "DOWNLOAD" }).click();
    if (process.env.SEQ) {
      await t.page.waitForFunction(
        (k) =>
          document.querySelectorAll("ul[aria-label='Maps found'] li button:disabled").length >= k,
        i + 1,
        { timeout: 60_000 },
      );
      await sleep(Number(process.env.SEQ));
    }
  }
  await t.page.waitForFunction(
    (k) => document.querySelectorAll("ul[aria-label='Maps found'] li button:disabled").length >= k,
    n,
    { timeout: 60_000 },
  );
  await sleep(1500);
  await t.page.keyboard.press("Escape");
  await sleep(3000);
}
for (let i = 0; i < Number(process.env.RESCANS ?? 0); i++) {
  await t.page.evaluate(async () => (await window.ra2Session).exports.ra2_maps_rescan(1));
  await sleep(4000);
}
await t.shot("fz-1-after-refill");

if (process.env.FFA) {
  await t.clickGame(153, 154); // Free For All
  await sleep(2500);
  await t.shot("fz-ffa-list");
}

if (process.env.SCROLL) {
  await t.moveGame(375, 300);
  for (let i = 0; i < 40; i++) {
    await t.page.mouse.wheel(0, 300);
    await sleep(60);
  }
  await sleep(1500);
  await t.shot("fz-scrolled");
  await t.clickGame(375, 330); // a row near the bottom
  await sleep(2500);
  await t.shot("fz-scrolled-click");
  await t.clickGame(375, 300);
  await sleep(2500);
  await t.shot("fz-scrolled-click2");
  await t.clickGame(375, 443); // the downloaded map, last in the list
  await sleep(4000);
  await t.shot("fz-new-map-click");
  await t.clickGame(375, 300); // then another, to see whether the list still answers
  await sleep(3000);
  await t.shot("fz-after-new-map");
}

// rows of the list, in game pixels: 2nd, 3rd, 4th
for (const [i, y] of [178, 197, 216].entries()) {
  await t.clickGame(375, y);
  await sleep(2500);
  await t.shot(`fz-${i + 2}-click-row-${i + 2}`);
}
console.log(
  "maps lines:",
  (await t.log())
    .filter((l) => l.includes("[maps]"))
    .slice(-12)
    .join(" / "),
);
await t.browser.close();
process.exit(0);
