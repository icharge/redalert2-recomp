// Verify that the WebGL capture matches the game's published raw pixels.
// Run with the same --url/--game options as the other e2e scripts.
import assert from "node:assert/strict";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
const run = await startPage(opts);

async function compare(label) {
  const result = await run.page.evaluate(async () => {
    const m = window.Module;
    const shared = m.cwrap("ra2_shared", "number", [])() >>> 2;
    const u32 = m.HEAPU32;
    const u8 = m.HEAPU8;
    const width = u32[shared + 3],
      height = u32[shared + 4];
    const ptr = u32[shared + 2],
      format = u32[shared + 1044],
      pitch = u32[shared + 1045];
    const pal = u32[shared + 1046];
    const { width: cw, height: ch, data } = await window.ra2Presenter.capture();
    const expected = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const to = (y * width + x) * 4;
        if (format === 1) {
          const v = u8[ptr + y * pitch + x * 2] | (u8[ptr + y * pitch + x * 2 + 1] << 8);
          const r = (v >>> 11) & 31,
            g = (v >>> 5) & 63,
            b = v & 31;
          expected[to] = (r << 3) | (r >>> 2);
          expected[to + 1] = (g << 2) | (g >>> 4);
          expected[to + 2] = (b << 3) | (b >>> 2);
          expected[to + 3] = 255;
        } else if (format === 2) {
          const i = u8[ptr + y * pitch + x],
            p = pal + i * 4;
          expected[to] = u8[p];
          expected[to + 1] = u8[p + 1];
          expected[to + 2] = u8[p + 2];
          expected[to + 3] = 255;
        } else if (format === 3) {
          const i = ptr + y * pitch + x * 4;
          expected[to] = u8[i + 2];
          expected[to + 1] = u8[i + 1];
          expected[to + 2] = u8[i];
          expected[to + 3] = 255;
        } else {
          const i = ptr + y * pitch + x * 4;
          expected.set(u8.subarray(i, i + 4), to);
        }
      }
    let different = 0;
    for (let i = 0; i < expected.length; i++) if (expected[i] !== data[i]) different++;
    return { width, height, cw, ch, format, different, pixels: width * height };
  });
  assert.equal(result.cw, result.width, `${label}: capture width`);
  assert.equal(result.ch, result.height, `${label}: capture height`);
  assert.equal(result.different, 0, `${label}: pixel differences`);
  console.log(
    `${label}: ${result.width}x${result.height}, format ${result.format}, 0 differing pixels`,
  );
}

try {
  await run.waitFor("the main menu", (s) => s?.phase === "running");
  await run.page.waitForTimeout(1000);
  await compare("main menu");
  await run.page.waitForTimeout(2000);
  const format = await run.page.evaluate(() => {
    const m = window.Module,
      p = m.cwrap("ra2_shared", "number", [])() >>> 2;
    return m.HEAPU32[p + 1044];
  });
  if (format === 2) await compare("movie frame");
  else console.log("movie frame: skipped (the current menu frame is not PAL8)");

  const waitDialog = async (id) => {
    const deadline = Date.now() + 120000;
    while (!run.all.some((line) => line.includes(`[dialog] open ${id}`))) {
      assert.ok(Date.now() < deadline, `waiting for dialog ${id}`);
      assert.notEqual((await run.state())?.phase, "crashed");
      await run.page.waitForTimeout(250);
    }
  };
  await run.clickGame(719, 221);
  await waitDialog("0x100");
  await run.clickGame(720, 305);
  await waitDialog("0x102");
  await run.clickGame(719, 263);
  await run.page.waitForTimeout(15000);
  await compare("skirmish frame");
} finally {
  await run.browser.close();
}
