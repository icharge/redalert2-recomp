// The picture check for the Thai font fix's cost work (docs/web/testing.md, "The Thai picture check").
//
//   cd web; node e2e/thai-shots.mjs --build ../work/build-web-prof --out ../work/thai-shots/A [--profile ../work/perf/profile-fresh]
//                                   [--save ../work/perf/busy.sav] [--headed]
//   cd web; node e2e/thai-shots.mjs --compare ../work/thai-shots/A ../work/thai-shots/A2
//
// Capture: opens the game from the profile with the Thai font fix at the app's default (the stored preference
// is removed, so DEFAULT_THAI_FONT_PREFERENCE applies: enabled), and checks that the game printed the fix's
// `[thaifont] using selected font` line, which only a game started with --thai-font-fix prints. It saves:
//   menu.png        the main menu (the game's 800x600 menu shell)
//   skirmish.png    the Skirmish Game setup screen (the same shell)
//   busy-menu.png   the busy save at 1280x720, with the in-game menu (Escape) open: the game is paused, so the
//                   battlefield and sidebar behind it are still
// and out/run.json with the build's wasm SHA-256 and the fix's line for each session.
//
// Compare: decodes each PNG (8-bit RGB or RGBA, non-interlaced: the page screenshots' format) and reports the
// differing pixels of each image, with their bounding box. It exits 1 on any difference, a size change or a
// missing image. The reference is build A (work/build-web-prof, the original macros and metrics code).
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { options, startPage } from "./lib.mjs";
import { at, loadBusySave, openGame, setResolution, settle } from "./perf-nav.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

export const IMAGES = ["menu.png", "skirmish.png", "busy-menu.png"];

/**
 * Regions of each image that are not compared, in the screenshot's own pixels (x0, y0, x1, y1, inclusive),
 * with the reason. Measured from build A against a second run of build A (work/thai-shots/A vs A2): the
 * differences are only in these. The main menu's radar screen and its small bar-graph monitor animate (the
 * game draws them from its frame count, not from the save), so they differ between runs of the same build. The
 * busy save's frame-rate overlay (the page's stats=1 text) is a counter that changes every second.
 */
export const MASKS = {
  "menu.png": [
    [40, 60, 1000, 900, "animated radar screen of the main menu (differs between runs of build A)"],
    [
      1040,
      40,
      1240,
      200,
      "animated bar-graph monitor of the main menu (differs between runs of build A)",
    ],
  ],
  "busy-menu.png": [
    [0, 0, 260, 90, "page stats overlay: frames per second and draw time, changing each second"],
  ],
  "skirmish.png": [],
};
const THAI_LINE = "[thaifont] using selected font";

/* ---------- PNG decoding (no image library in web/) ---------- */

export function decodePng(buf) {
  const signature = buf.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") throw new Error("not a PNG");
  let pos = 8;
  let width = 0,
    height = 0,
    bitDepth = 0,
    colorType = 0,
    interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels || bitDepth !== 8 || interlace) {
    throw new Error(
      `unsupported PNG (colour type ${colorType}, depth ${bitDepth}, interlace ${interlace})`,
    );
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v;
      switch (filter) {
        case 0:
          v = line[x];
          break;
        case 1:
          v = line[x] + a;
          break;
        case 2:
          v = line[x] + b;
          break;
        case 3:
          v = line[x] + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a),
            pb = Math.abs(p - b),
            pc = Math.abs(p - c);
          v = line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`bad PNG filter ${filter}`);
      }
      cur[x] = v & 255;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

/** The differing pixels of two decoded images: their count, and the bounding box of them. */
export function diffImages(a, b, masks = []) {
  if (a.width !== b.width || a.height !== b.height)
    return { sameSize: false, a: [a.width, a.height], b: [b.width, b.height] };
  let count = 0,
    masked = 0;
  let minX = Infinity,
    minY = Infinity,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (masks.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) {
        masked++;
        continue;
      }
      const ia = (y * a.width + x) * a.channels;
      const ib = (y * b.width + x) * b.channels;
      let differs = false;
      for (let c = 0; c < 3; c++) if (a.data[ia + c] !== b.data[ib + c]) differs = true;
      if (!differs) continue;
      count++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return {
    sameSize: true,
    pixels: a.width * a.height,
    masked,
    differing: count,
    box: count ? [minX, minY, maxX, maxY] : null,
  };
}

function compare(dirA, dirB) {
  let failed = false;
  const rows = [];
  for (const name of IMAGES) {
    const fa = path.join(dirA, name),
      fb = path.join(dirB, name);
    if (!existsSync(fa) || !existsSync(fb)) {
      rows.push({
        image: name,
        error: `missing (${existsSync(fa) ? "" : "A "}${existsSync(fb) ? "" : "B"})`,
      });
      failed = true;
      continue;
    }
    const masks = MASKS[name] ?? [];
    const d = diffImages(decodePng(readFileSync(fa)), decodePng(readFileSync(fb)), masks);
    if (!d.sameSize || d.differing) failed = true;
    rows.push({
      image: name,
      ...d,
      masks: masks.map((m) => `${m[0]},${m[1]}-${m[2]},${m[3]}: ${m[4]}`),
    });
  }
  for (const r of rows) console.log(JSON.stringify(r));
  console.log(
    failed ? "RESULT: differs" : "RESULT: identical (zero differing pixels in every image)",
  );
  return failed ? 1 : 0;
}

/* ---------- capture ---------- */

function buildIdentity(dir) {
  const wasm = path.join(dir, "ra2.wasm");
  if (!existsSync(wasm)) throw new Error(`--build ${dir}: no ra2.wasm there`);
  const sha = createHash("sha256").update(readFileSync(wasm)).digest("hex");
  return { dir, wasm: path.basename(wasm), sha256: sha };
}

/** Removes the stored Thai preferences so the app's default (fix on) applies to every game this run opens. */
async function useAppDefault(base) {
  const t = await startPage({ ...base, noDev: true, url: new URL("/", base.url).toString() });
  try {
    await t.page.waitForTimeout(1500);
    const removed = await t.page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith("ra2.thai-font."));
      for (const k of keys) localStorage.removeItem(k);
      return keys;
    });
    return removed;
  } finally {
    await t.browser.close().catch(() => {});
  }
}

function fixLine(t) {
  return t.all.find((line) => line.includes(THAI_LINE)) ?? null;
}

async function capture() {
  const build = flag("--build", null);
  const out = path.resolve(flag("--out", ""));
  if (!build || !out || out === path.resolve("."))
    throw new Error("--build <dir> and --out <dir> are required");
  const identity = buildIdentity(path.resolve(build));
  mkdirSync(out, { recursive: true });
  const base = options(argv);
  if (!base.profile) base.profile = "../work/perf/profile-fresh";
  const savePath = path.resolve(flag("--save", "../work/perf/busy.sav"));
  base.shots = path.join(out, "_failures");
  mkdirSync(base.shots, { recursive: true });
  base.gameBuild = path.resolve(build);
  const log = (line) => console.log(line);

  const removed = await useAppDefault(base);
  log(`stored Thai preferences removed (app default applies): ${removed.join(", ") || "none"}`);

  const run = { build: identity, thaiPreferenceRemoved: removed, sessions: [] };

  // Session 1: the menu and the Skirmish Game setup screen, at the menu shell's size.
  {
    const t = await openGame(base, { shots: base.shots, headed: base.headed });
    try {
      await settle(t, 6000);
      const line = fixLine(t);
      if (!line) await t.fail("the game did not start with the Thai font fix (no [thaifont] line)");
      run.sessions.push({ name: "menu", thaiFix: line.trim() });
      await t.page.screenshot({ path: path.join(out, "menu.png") });
      await t.clickGame(...at.singlePlayer);
      await t.page.waitForTimeout(4000);
      await t.clickGame(...at.skirmish);
      await t.page.waitForTimeout(4000);
      await t.page.screenshot({ path: path.join(out, "skirmish.png") });
      log(`menu and skirmish setup shots: ${line.trim()}`);
    } finally {
      await t.browser.close().catch(() => {});
    }
  }

  // Session 2: the busy save at 1280x720, with the in-game menu open (the game is paused behind it).
  {
    const t = await openGame(base, { shots: base.shots, headed: base.headed });
    try {
      await settle(t, 3000);
      await setResolution(t, { w: 1280, h: 720 });
      await loadBusySave(t, savePath, { log });
      const line = fixLine(t);
      if (!line)
        await t.fail(
          "the busy save's game did not start with the Thai font fix (no [thaifont] line)",
        );
      run.sessions.push({ name: "busy", thaiFix: line.trim() });
      await t.page.evaluate(() => document.exitPointerLock());
      await t.page.waitForTimeout(300);
      await t.page.keyboard.press("Escape");
      await t.page.waitForTimeout(3000);
      await t.page.screenshot({ path: path.join(out, "busy-menu.png") });
      log(`busy save in-game menu shot: ${line.trim()}`);
    } finally {
      await t.browser.close().catch(() => {});
    }
  }

  writeFileSync(path.join(out, "run.json"), JSON.stringify(run, null, 2) + "\n");
  console.log(`wrote ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (argv.includes("--compare")) {
    const i = argv.indexOf("--compare");
    const [a, b] = [argv[i + 1], argv[i + 2]];
    if (!a || !b) throw new Error("--compare <dirA> <dirB>");
    process.exitCode = compare(path.resolve(a), path.resolve(b));
  } else {
    await capture();
  }
}
