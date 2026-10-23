// Lobby paint acceptance: compare raw game pixels, before page scaling or video encoding.
// Run with --game /path/to/install and a stable --url (docs/web/testing.md).
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.pageArgs.push("--mute");
const run = await startPage(opts);
const report = {};
const rectangles = { start: [644, 241, 156, 42], customize: [644, 284, 156, 42], back: [644, 535, 156, 42] };
const waitDialog = async (id) => {
  const deadline = Date.now() + 120000;
  while (!run.all.some((line) => line.includes(`[dialog] open ${id}`))) {
    assert.ok(Date.now() < deadline, `waiting for dialog ${id}`);
    assert.notEqual((await run.state())?.phase, "crashed");
    await run.page.waitForTimeout(250);
  }
};
const capture = async (name) => {
  const result = await run.page.evaluate((rectangles) => {
    const m = window.Module;
    const shared = m.cwrap("ra2_shared", "number", [])() >>> 2;
    const words = m.HEAPU32;
    const width = words[shared + 3], height = words[shared + 4];
    if (width !== 800 || height !== 600) throw new Error(`expected 800x600 menu, got ${width}x${height}`);
    const data = new Uint8ClampedArray(width * height * 4);
    data.set(m.HEAPU8.subarray(words[shared + 2], words[shared + 2] + data.length));
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    canvas.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
    const crops = {};
    for (const [key, [x, y, w, h]] of Object.entries(rectangles)) {
      const crop = [];
      for (let yy = y; yy < y + h; yy++) crop.push(...data.subarray((yy * width + x) * 4, (yy * width + x + w) * 4));
      crops[key] = crop;
    }
    return { png: canvas.toDataURL("image/png").split(",")[1], crops };
  }, rectangles);
  writeFileSync(path.join(opts.shots, `${name}.png`), Buffer.from(result.png, "base64"));
  return result.crops;
};
function difference(a, b) {
  let changed = 0, over8 = 0, max = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (delta) changed++;
    if (delta > 8) over8++;
    max = Math.max(max, delta);
  }
  return { changed, over8, max };
}
try {
  await run.waitFor("the main menu", (s) => s?.phase === "running");
  await run.page.waitForTimeout(1500);
  await run.clickGame(719, 221); await waitDialog("0x100");
  await run.page.waitForTimeout(1500);
  await run.clickGame(720, 305); await waitDialog("0x102");
  await run.page.waitForTimeout(5000);
  await run.moveGame(400, 400); await run.page.waitForTimeout(500);
  const idle = await capture("idle");
  await run.moveGame(720, 260); await run.page.waitForTimeout(700);
  const hover = await capture("hover");
  await run.page.mouse.down(); await run.page.waitForTimeout(700);
  const held = await capture("held");
  await run.moveGame(400, 400); await run.page.waitForTimeout(700);
  const dragOut = await capture("drag-out");
  await run.moveGame(720, 260); await run.page.waitForTimeout(700);
  const dragIn = await capture("drag-in");
  await run.moveGame(400, 400); await run.page.mouse.up(); await run.page.waitForTimeout(700);
  const released = await capture("released");
  report.button = {};
  for (const key of Object.keys(rectangles)) {
    const diff = { hover: difference(idle[key], hover[key]), held: difference(idle[key], held[key]),
      dragOut: difference(idle[key], dragOut[key]), dragIn: difference(held[key], dragIn[key]), released: difference(idle[key], released[key]) };
    report.button[key] = diff;
    // Fresh lossless native capture proves idle and hover are identical. Held
    // changes only the selected button, and leaving/releasing restores it.
    assert.equal(diff.hover.changed, 0, `${key}: hover matches native idle`);
    assert.equal(diff.dragOut.changed, 0, `${key}: dragging out clears selection`);
    assert.equal(diff.dragIn.changed, 0, `${key}: dragging back restores held state`);
    assert.equal(diff.released.changed, 0, `${key}: release restores idle`);
    if (key === "start") assert.ok(diff.held.over8 > 3000, "held button draws its selected artwork");
    else assert.equal(diff.held.changed, 0, `${key}: holding another button does not alter it`);
  }
  console.log("PASS native button idle/hover/held, captured drag out/in, and release");
} finally {
  writeFileSync(path.join(opts.shots, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(opts.shots, "run.log"), run.all.join("\n"));
  await run.browser.close();
}
