// W9.5: verify real TacticalClass camera movement at the pointer-locked edge.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
const url = new URL(opts.url);
url.searchParams.set("video", "800x600");
opts.url = url.toString();
opts.pageArgs.push(
  "--mute",
  "--debuglog",
  "--press",
  "0xE2:1667@1",
  "--press",
  "0x100:1401@2",
  "--press",
  "0x102:1559@3",
);
const run = await startPage(opts),
  { page, all, shot } = run;
const guest = () =>
  page.evaluate(() => {
    const m = window.Module.HEAP32,
      t = m[0x887324 >> 2];
    return { camera: [m[(t + 0xb0) >> 2], m[(t + 0xb4) >> 2]], tactical: t };
  });
try {
  await run.waitFor("battle", (s) => (s?.fps ?? 0) > 0, 240);
  await page.waitForTimeout(3000);
  const rows = [];
  for (const fullscreen of [false, true]) {
    if (fullscreen) {
      await page.keyboard.press("F11");
      await page.waitForFunction(() => !!document.fullscreenElement);
    }
    await page.keyboard.press("F10");
    await page.getByRole("button", { name: "Lock pointer for edge scrolling" }).click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    const before = await guest();
    const pos = await page.evaluate(() => {
      const r = document.querySelector('canvas[aria-label="The game"]').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(pos.x, pos.y);
    // Use opposite edges so the second pass can move back from the map boundary
    // reached by the first pass instead of falsely reporting a stuck camera.
    await page.mouse.move(pos.x + (fullscreen ? -2000 : 2000), pos.y);
    await page.waitForTimeout(2500);
    const after = await guest();
    rows.push({
      fullscreen,
      before,
      after,
      moved: JSON.stringify(before.camera) !== JSON.stringify(after.camera),
    });
    await shot(fullscreen ? "edge-fullscreen" : "edge-window");
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => !document.pointerLockElement);
    if (!fullscreen) await page.waitForTimeout(1500);
    assert.notDeepEqual(
      after.camera,
      before.camera,
      `camera did not move while locked at edge (${fullscreen ? "fullscreen" : "windowed"})`,
    );
  }
  console.log("PASS Pointer Lock edge scroll", JSON.stringify(rows));
  writeFileSync(path.join(opts.shots, "edge-report.json"), JSON.stringify(rows, null, 2));
} finally {
  await shot("last").catch(() => {});
  writeFileSync(path.join(opts.shots, "run.log"), all.join("\n"));
  await run.browser.close();
}
