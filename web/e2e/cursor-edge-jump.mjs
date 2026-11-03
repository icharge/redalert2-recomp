// Does the game's cursor jump while the pointer is locked and the view scrolls
// at an edge? (docs/web/cursor-layer.md, "Pointer Lock")
//
// Starts a skirmish through the dev server's game folder, locks the pointer,
// holds the mouse against the right edge and then the left one, and records at
// animation-frame rate: Shared.pointer_x/y, the game's cursor warps (warp_seq),
// the camera, the cursor sprite's transform, and the mouse object's own frame /
// hot spot / drawn position. Windowed first, then fullscreen.
//
//   node e2e/cursor-edge-jump.mjs --game ../game [--video 1920x1080]
//        [--cursor game] [--windowed] [--still]
//
// The report lands in --shots (default e2e/shots) as edge-phases.json. A
// pointer delta between samples is a jump only when it is not the test's own
// synthetic move: this is a diagnostic, not a pass/fail check.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const argv = process.argv.slice(2);
const cursor = argv.includes("--cursor") ? argv[argv.indexOf("--cursor") + 1] : "";
const windowed = argv.includes("--windowed");
const opts = options(argv);
const url = new URL(opts.url);
url.searchParams.set(
  "video",
  argv.includes("--video") ? argv[argv.indexOf("--video") + 1] : "800x600",
);
if (cursor) url.searchParams.set("cursor", cursor);
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
  "--waitlog",
  "Capture_Mouse@4",
  "--move",
  "236,240@7",
);
const run = await startPage(opts);
const { page, all, shot } = run;
/** WWMouseClass (both editions; host.c's RA2_MOUSE_VA): YR is gamemd. */
const MOUSE_VA = opts.edition === "ra2" ? 0x00b2af5c : 0x00b78164;

const startSampling = (mouseVa) =>
  page.evaluate(async (mouseVa) => {
    const handle = await window.ra2Session;
    const { HEAP32 } = handle.memory();
    const at = handle.shared >> 2;
    const word = (index) => Atomics.load(HEAP32, at + index);
    const layer = () =>
      [...document.querySelectorAll("canvas")].find(
        (c) => c.getAttribute("aria-hidden") === "true",
      );
    const sample = () => {
      const tactical = HEAP32[0x887324 >> 2];
      const canvas = layer();
      const picture = document.querySelector('canvas[aria-label="The game"]');
      const rect = picture?.getBoundingClientRect();
      const mouse = HEAP32[mouseVa >> 2] ?? 0;
      const at = (offset) => (mouse ? HEAP32[(mouse + offset) >> 2] : 0);
      const shape = mouse ? HEAP32[(mouse + 4) >> 2] : 0;
      const frame = at(0x8);
      const u16 = (addr) => (HEAP32[addr >> 2] >>> ((addr & 3) * 8)) & 0xffff;
      // SHP header: reserved, width, height, frames; then 24-byte entries.
      const entry = shape + 8 + frame * 24;
      return {
        t: Math.round(performance.now()),
        px: word(1042),
        py: word(1043),
        warpSeq: word(1039),
        warpX: word(1040),
        warpY: word(1041),
        cursorKind: word(6),
        pageCursorKind: word(1057),
        seq: word(1056),
        hotX: word(1058),
        hotY: word(1059),
        frameW: word(1060),
        frameH: word(1061),
        mouseFrame: at(0x8),
        mouseX: at(0x14),
        mouseY: at(0x18),
        mouseHotX: at(0x3c),
        mouseHotY: at(0x40),
        drawnX: at(0x48),
        drawnY: at(0x4c),
        drawnW: at(0x50),
        drawnH: at(0x54),
        shpW: shape ? u16(shape + 2) : 0,
        shpH: shape ? u16(shape + 4) : 0,
        entryX: shape ? (u16(entry) << 16) >> 16 : 0,
        entryY: shape ? (u16(entry + 2) << 16) >> 16 : 0,
        entryW: shape ? u16(entry + 4) : 0,
        entryH: shape ? u16(entry + 6) : 0,
        gameW: word(1037),
        gameH: word(1038),
        box: rect
          ? [
              Math.round(rect.left),
              Math.round(rect.top),
              Math.round(rect.width),
              Math.round(rect.height),
            ]
          : null,
        request: word(1062),
        camX: tactical ? HEAP32[(tactical + 0xb0) >> 2] : 0,
        camY: tactical ? HEAP32[(tactical + 0xb4) >> 2] : 0,
        transform: canvas?.style.transform ?? "",
        size: canvas ? `${canvas.style.width}x${canvas.style.height}` : "",
        visibility: canvas?.style.visibility ?? "",
        locked: !!document.pointerLockElement,
      };
    };
    window.__edge = { rows: [], marks: {}, timer: 0 };
    window.__edge.mark = (name) => (window.__edge.marks[name] = Math.round(performance.now()));
    window.__edge.timer = setInterval(() => window.__edge.rows.push(sample()), 8);
  }, mouseVa);
const stopSampling = () =>
  page.evaluate(() => {
    clearInterval(window.__edge.timer);
    return { rows: window.__edge.rows, marks: window.__edge.marks };
  });

const phases = [];
try {
  await run.waitFor("battle", (s) => (s?.fps ?? 0) > 0, 240);
  await page.waitForTimeout(3000);

  for (const fullscreen of windowed ? [false] : [false, true]) {
    if (fullscreen) {
      await page.keyboard.press("F11");
      await page.waitForFunction(() => !!document.fullscreenElement);
      await page.waitForTimeout(1500);
    }
    // A match requests Pointer Lock itself (autoLockPointer); without browser
    // activation it waits for a click on the canvas.
    for (let tries = 0; tries < 20; tries++) {
      if (await page.evaluate(() => !!document.pointerLockElement)) break;
      const middle = await page.evaluate(() => {
        const r = document.querySelector('canvas[aria-label="The game"]').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.click(middle.x, middle.y);
      await page.waitForTimeout(250);
    }
    if (!(await page.evaluate(() => !!document.pointerLockElement)))
      throw new Error("the pointer did not lock");
    await page.waitForTimeout(1000);

    if (argv.includes("--still")) {
      // Move the virtual pointer to the middle of the picture and stop: the map
      // does not scroll, so this is the cursor at rest.
      const middle = await page.evaluate(async () => {
        const handle = await window.ra2Session;
        const { HEAP32 } = handle.memory();
        const at = handle.shared >> 2;
        const w = Atomics.load(HEAP32, at + 1037) || 800;
        const h = Atomics.load(HEAP32, at + 1038) || 600;
        const r = document.querySelector('canvas[aria-label="The game"]').getBoundingClientRect();
        const scale = Math.min(r.width / w, r.height / h);
        return {
          dx: (w / 2 - Atomics.load(HEAP32, at + 1042)) * scale,
          dy: (h / 2 - Atomics.load(HEAP32, at + 1043)) * scale,
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
        };
      });
      await page.mouse.move(middle.x + middle.dx, middle.y + middle.dy, { steps: 10 });
      await page.waitForTimeout(2000);
      for (let i = 0; i < 5; i++) {
        await shot(`still-${i}`);
        await page.waitForTimeout(300);
      }
      await page.evaluate(() => document.exitPointerLock());
      break;
    }

    await startSampling(MOUSE_VA);
    const box = await page.evaluate(() => {
      const r = document.querySelector('canvas[aria-label="The game"]').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.evaluate(() => window.__edge.mark("start"));
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__edge.mark("right"));
    await page.mouse.move(box.x + 2000, box.y, { steps: 20 });
    await page.waitForTimeout(2500);
    await shot(fullscreen ? "full-right" : "window-right");
    await page.evaluate(() => window.__edge.mark("left"));
    await page.mouse.move(box.x - 2000, box.y, { steps: 20 });
    await page.waitForTimeout(2500);
    await shot(fullscreen ? "full-left" : "window-left");
    await page.evaluate(() => window.__edge.mark("end"));
    const record = await stopSampling();
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForTimeout(800);

    const { rows, marks } = record;
    const near = (name) => {
      const at = marks[name];
      return rows.reduce((best, row) =>
        Math.abs(row.t - at) < Math.abs(best.t - at) ? row : best,
      );
    };
    const phase = {
      fullscreen,
      marks: Object.fromEntries(Object.entries(marks).map(([k]) => [k, near(k)])),
      warps: rows.filter((r) => r.warpSeq > 0).length,
      samples: rows.length,
      rows,
      jumps: [],
      camera: [],
      moves: [],
    };
    for (let i = 1; i < rows.length; i++) {
      const dx = rows[i].px - rows[i - 1].px;
      if (Math.abs(dx) > 40) phase.jumps.push({ dx, from: rows[i - 1], to: rows[i] });
      if (rows[i].camX !== rows[i - 1].camX || rows[i].camY !== rows[i - 1].camY)
        phase.camera.push(rows[i]);
      if (
        rows[i].transform !== rows[i - 1].transform &&
        rows[i].px === rows[i - 1].px &&
        rows[i].py === rows[i - 1].py
      )
        phase.moves.push({ from: rows[i - 1], to: rows[i] });
    }
    phases.push(phase);
    console.log(
      `\n${fullscreen ? "fullscreen" : "windowed"}: ${rows.length} samples, ${phase.warps} warped, ` +
        `${phase.jumps.length} pointer jumps, ${phase.camera.length} camera changes, ` +
        `${phase.moves.length} moved without a pointer move`,
    );
    console.log("  phases:", JSON.stringify(phase.marks));
    for (const jump of phase.jumps.slice(0, 8))
      console.log("  jump", jump.dx, JSON.stringify(jump.from), "->", JSON.stringify(jump.to));
    for (const row of phase.camera.slice(0, 8)) console.log("  camera", JSON.stringify(row));
    for (const move of phase.moves.slice(0, 8))
      console.log("  moved", JSON.stringify(move.from), "->", JSON.stringify(move.to));
  }
  writeFileSync(path.join(opts.shots, "edge-phases.json"), JSON.stringify(phases, null, 2));
} finally {
  writeFileSync(path.join(opts.shots, "run.log"), all.join("\n"));
  await shot("last").catch(() => {});
  await run.browser.close();
}
