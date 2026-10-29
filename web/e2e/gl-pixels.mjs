// Verify that the WebGL capture matches the game's published raw pixels.
// Run with the same --url/--game options as the other e2e scripts.
import assert from "node:assert/strict";
import { options } from "./lib.mjs";
import { openGame } from "./perf-nav.mjs";

const opts = options(process.argv.slice(2));
assert.ok(opts.profile, "pass --profile <persistent Chrome profile with an imported game>");
const hdAt = process.argv.indexOf("--hd");
const hd = hdAt < 0 ? null : process.argv[hdAt + 1];
assert.ok(hd === null || hd === "off" || hd === "on", "--hd must be off or on");
const run = await openGame(opts, { shots: opts.shots, headed: opts.headed });
const scaleValues = { sharp: 0, smooth: 1, crt: 2, nearest: 3, integer: 4 };
const originalSettings = (await run.state())?.settings;

async function setScale(scale) {
  await run.page.evaluate((value) => {
    window.Module.cwrap("ra2_setting", null, ["number", "number", "number"])(0, value, 0);
  }, scaleValues[scale]);
  await run.page.waitForFunction(
    (value) => window.ra2Store?.getSnapshot().settings?.scale === value,
    scale,
    { timeout: 30_000 },
  );
}

async function setHd(enabled) {
  await run.page.evaluate((value) => {
    window.Module.cwrap("ra2_setting", null, ["number", "number", "number"])(2, value ? 1 : 0, 0);
  }, enabled);
  await run.page.waitForFunction(
    (value) => window.ra2Store?.getSnapshot().settings?.hd === value,
    enabled,
    { timeout: 30_000 },
  );
}

async function compare(label) {
  const result = await run.page.evaluate(async () => {
    const m = window.Module;
    const shared = m.cwrap("ra2_shared", "number", [])() >>> 2;
    const words = new Int32Array(m.HEAPU8.buffer);
    const u8 = m.HEAPU8;
    let result;
    const diagnostic = {
      oddSeq: 0,
      sourceChanged: 0,
      noContext: 0,
      presenterSeqMismatch: 0,
      canvasSizeMismatch: 0,
      changedDuringRead: 0,
      last: null,
    };
    for (let attempt = 0; attempt < 100; attempt++) {
      const seq = Atomics.load(words, shared + 1);
      if (seq < 0 || seq & 1) {
        diagnostic.oddSeq++;
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
      let snapshot;
      try {
        if (
          Atomics.load(words, shared + 1) !== seq ||
          Atomics.load(words, shared + 1048) !== frameIndex ||
          Atomics.load(words, shared + 2) >>> 0 !== ptr
        ) {
          diagnostic.sourceChanged++;
          continue;
        }
        const expected = new Uint8Array(width * height * 4);
        if (format === 0) {
          for (let y = 0; y < height; y++)
            expected.set(u8.subarray(ptr + y * pitch, ptr + y * pitch + width * 4), y * width * 4);
        } else {
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
              }
            }
        }
        if (Atomics.load(words, shared + 1) === seq)
          snapshot = { width, height, format, seq, expected };
        else diagnostic.sourceChanged++;
      } finally {
        Atomics.store(words, shared + 1047, -1);
      }
      if (!snapshot) continue;

      if (snapshot.format === 0) {
        // The 2D presenter draws into a stable canvas bitmap. Let its next
        // animation-frame draw catch up when the copied source was newer.
        const presenter = window.ra2Presenter;
        const canvas = presenter?.canvas;
        const context = canvas?.getContext("2d");
        diagnostic.last = {
          seq: snapshot.seq,
          sharedSeq: Atomics.load(words, shared + 1),
          presenterSeq: presenter?.frameSeq,
          width: snapshot.width,
          height: snapshot.height,
          canvasWidth: canvas?.width,
          canvasHeight: canvas?.height,
          context: context?.constructor?.name ?? null,
        };
        if (
          !context ||
          presenter.frameSeq !== snapshot.seq ||
          canvas.width !== snapshot.width ||
          canvas.height !== snapshot.height
        ) {
          if (!context) diagnostic.noContext++;
          if (presenter?.frameSeq !== snapshot.seq) diagnostic.presenterSeqMismatch++;
          if (canvas?.width !== snapshot.width || canvas?.height !== snapshot.height)
            diagnostic.canvasSizeMismatch++;
          await new Promise((resolve) => requestAnimationFrame(resolve));
          continue;
        }
        const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
        if (presenter.frameSeq !== snapshot.seq) {
          diagnostic.changedDuringRead++;
          await new Promise((resolve) => requestAnimationFrame(resolve));
          continue;
        }
        let different = 0;
        for (let i = 0; i < snapshot.expected.length; i++)
          if (snapshot.expected[i] !== actual[i]) different++;
        result = {
          width: snapshot.width,
          height: snapshot.height,
          cw: canvas.width,
          ch: canvas.height,
          format: snapshot.format,
          different,
        };
        break;
      }

      // Pin and copy the source before GPU readback. A live game may publish
      // another frame while readPixels blocks the page thread.
      const capture = await window.ra2Presenter.capture();
      if (capture.frameSeq !== snapshot.seq) continue;
      let different = 0;
      let firstDifferent = null;
      for (let i = 0; i < snapshot.expected.length; i++)
        if (snapshot.expected[i] !== capture.data[i]) {
          different++;
          if (!firstDifferent)
            firstDifferent = {
              index: i,
              expected: snapshot.expected[i],
              actual: capture.data[i],
            };
        }
      result = {
        width: snapshot.width,
        height: snapshot.height,
        cw: capture.width,
        ch: capture.height,
        format: snapshot.format,
        different,
        firstDifferent,
        presenter: window.ra2Presenter?.constructor?.name,
        hd: window.ra2Store?.getSnapshot().settings?.hd,
        scale: window.ra2Store?.getSnapshot().settings?.scale,
      };
      break;
    }
    if (!result)
      throw new Error(
        `Could not snapshot raw pixels for the captured frame: ${JSON.stringify(diagnostic)}`,
      );
    return { ...result, pixels: result.width * result.height };
  });
  assert.equal(result.cw, result.width, `${label}: capture width`);
  assert.equal(result.ch, result.height, `${label}: capture height`);
  if (result.different) console.error(`${label} diagnostic: ${JSON.stringify(result)}`);
  assert.equal(result.different, 0, `${label}: pixel differences`);
  console.log(
    `${label}: ${result.width}x${result.height}, format ${result.format}, 0 differing pixels`,
  );
}

try {
  // The capture must use unfiltered 1:1 pixels; restore the user's mode before closing.
  await setScale("nearest");
  if (hd !== null) {
    const enabled = hd === "on";
    await setHd(enabled);
    console.log(`HD vehicles: ${hd}`);
  }
  await run.page.waitForTimeout(1000);
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
  const battleState = await run.state();
  const fpsEvents = run.all.filter((line) => /@ra2 \{"e":"fps"/.test(line)).length;
  console.log(
    `skirmish telemetry: state fps ${battleState?.fps ?? "null"}; ${fpsEvents} fps events`,
  );
  await compare("skirmish frame");
} finally {
  if (originalSettings?.scale in scaleValues) await setScale(originalSettings.scale);
  if (typeof originalSettings?.hd === "boolean") await setHd(originalSettings.hd);
  await run.page.waitForTimeout(250).catch(() => {});
  await run.browser.close();
}
