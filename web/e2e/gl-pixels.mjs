// Verify that the WebGL capture matches the game's published raw pixels.
// Run with the same --url/--game options as the other e2e scripts.
import assert from "node:assert/strict";
import { options } from "./lib.mjs";
import { openGame } from "./perf-nav.mjs";

const opts = options(process.argv.slice(2));
assert.ok(opts.profile, "pass --profile <persistent Chrome profile with an imported game>");
const run = await openGame(opts, { shots: opts.shots, headed: opts.headed });

async function compare(label) {
  const result = await run.page.evaluate(async () => {
    const m = window.Module;
    const shared = m.cwrap("ra2_shared", "number", [])() >>> 2;
    const words = new Int32Array(m.HEAPU8.buffer);
    const u8 = m.HEAPU8;
    const capture = await window.ra2Presenter.capture();
    let snapshot;
    for (let attempt = 0; attempt < 100; attempt++) {
      const seq = Atomics.load(words, shared + 1);
      if (seq !== capture.frameSeq || seq < 0 || seq & 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        continue;
      }
      const width = Atomics.load(words, shared + 3);
      const height = Atomics.load(words, shared + 4);
      const ptr = Atomics.load(words, shared + 2) >>> 0;
      const format = Atomics.load(words, shared + 1044);
      const pitch = Atomics.load(words, shared + 1045);
      const pal = Atomics.load(words, shared + 1046) >>> 0;
      const frameIndex = Atomics.load(words, shared + 1048);
      Atomics.store(words, shared + 1047, frameIndex);
      try {
        if (
          Atomics.load(words, shared + 1) !== seq ||
          Atomics.load(words, shared + 1048) !== frameIndex ||
          Atomics.load(words, shared + 2) >>> 0 !== ptr
        )
          continue;
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
        if (Atomics.load(words, shared + 1) === seq) snapshot = { width, height, format, expected };
      } finally {
        Atomics.store(words, shared + 1047, -1);
      }
      if (snapshot) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!snapshot) throw new Error("Could not snapshot raw pixels for the captured frame");
    const { width, height, format, expected } = snapshot;
    const { width: cw, height: ch, data } = capture;
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
  await compare("main menu");
  const movie = await run.page.evaluate(async () => {
    const m = window.Module;
    const shared = m.cwrap("ra2_shared", "number", [])() >>> 2;
    const formats = new Set();
    const checksums = new Set();
    for (let i = 0; i < 24; i++) {
      const { data } = await window.ra2Presenter.capture();
      formats.add(m.HEAPU32[shared + 1044]);
      let checksum = 0;
      for (let p = 0; p < data.length; p += 4 * 97)
        checksum = (checksum * 31 + data[p] + data[p + 1] * 3 + data[p + 2] * 7) >>> 0;
      checksums.add(checksum);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { formats: [...formats].sort(), distinctFrames: checksums.size };
  });
  assert.ok(movie.distinctFrames > 1, "the main-menu movie did not animate during capture");
  console.log(
    `main-menu movie: ${movie.distinctFrames} captured frames; formats ${movie.formats.join(", ")}`,
  );
  if (movie.formats.includes(2)) await compare("main-menu PAL8 movie frame");
  else
    console.log(
      "main-menu PAL8 movie frame: game did not publish PAL8 during the animation window",
    );

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
