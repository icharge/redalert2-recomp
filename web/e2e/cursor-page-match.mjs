// ?cursor=page in a real browser, end to end: import the install into OPFS once
// (a persistent profile keeps it), start a skirmish through the launcher, then
// read the page-cursor words from shared memory and screenshot the match
// (docs/web/cursor-layer.md). Run the dev server first.
//
//   node e2e/cursor-page-match.mjs --game ../game \
//        --url "http://127.0.0.1:5173/" --profile ../../work/tests/cursor-profile
import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const url = option("--url", "http://127.0.0.1:5173/");
const game = option("--game", path.resolve("..", "game"));
const profile = path.resolve(
  option("--profile", path.resolve("..", "work", "tests", "cursor-profile")),
);
const shots = path.resolve(option("--shots", path.resolve("..", "work", "tests", "cursor-shots")));
mkdirSync(shots, { recursive: true });
mkdirSync(profile, { recursive: true });

const browser = await chromium.launchPersistentContext(profile, {
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  viewport: { width: 1280, height: 960 },
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
page.setDefaultTimeout(180_000);
page.on("console", (m) => {
  if (m.type() === "error" || m.text().includes("[cursor]")) console.log(`[page] ${m.text()}`);
});

let urlAtGame = "";
const installed = existsSync(path.join(profile, "Default"));
await page.goto(url);
if (!installed) console.log("[browser] importing the install into OPFS (once)…");
await page.getByRole("heading", { name: "Your games" }).waitFor({ timeout: 180_000 });
const slot = page.locator('[data-slot-id="1"]');
if (!(await slot.count())) {
  await page.getByRole("button", { name: "Import a folder…" }).click();
  await page.locator('input[type="file"]').setInputFiles(game);
  await page.getByText(/^Found /).waitFor({ timeout: 180_000 });
  await page.getByRole("button", { name: /^Import / }).click();
  await slot.waitFor({ timeout: 900_000 });
}
await slot.locator('[data-game-id="ra2md"]').getByRole("button", { name: "Play" }).click();
await page.waitForURL(/\/game\/1(?:\?|$)/, { timeout: 120_000 });
urlAtGame = page.url();

const gameUrl = new URL(urlAtGame);
gameUrl.searchParams.set("cursor", "page");
for (const arg of [
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
  "--key",
  "0x48@18",
])
  gameUrl.searchParams.append("arg", arg);
await page.goto(gameUrl.toString());

const deadline = Date.now() + 300_000;
let state = null;
for (;;) {
  state = await page.evaluate(async () => {
    const handle = await window.ra2Session;
    const snapshot = window.ra2Store?.getSnapshot();
    if (!handle) return { phase: snapshot?.phase ?? "loading" };
    const { HEAP32 } = handle.memory();
    const at = handle.shared >> 2;
    const word = (index) => Atomics.load(HEAP32, at + index);
    return {
      phase: snapshot?.phase,
      protocol: word(0),
      pageCursorSeq: word(1056),
      pageCursorKind: word(1057),
      pageCursorRequest: word(1062),
      pageCursorPaletteSeq: word(1067),
      pointerX: word(1042),
      pointerY: word(1043),
      cursorKind: word(6),
    };
  });
  if (state.pageCursorRequest === 1) break;
  if (state.phase === "crashed" || state.phase === "exited") break;
  if (Date.now() > deadline) break;
  await page.waitForTimeout(1000);
}
// A real pointer move is what the page cursor follows (the scripted --move is
// host-side and does not touch shared.pointer_x/y): move over the picture.
await page.waitForTimeout(4000);
await page.mouse.move(400, 350);
await page.mouse.move(640, 480, { steps: 8 });
await page.waitForTimeout(500);
state = await page.evaluate(async () => {
  const handle = await window.ra2Session;
  const { HEAP32 } = handle.memory();
  const at = handle.shared >> 2;
  const word = (index) => Atomics.load(HEAP32, at + index);
  return {
    phase: window.ra2Store?.getSnapshot().phase,
    protocol: word(0),
    pageCursorSeq: word(1056),
    pageCursorKind: word(1057),
    pageCursorRequest: word(1062),
    pageCursorPaletteSeq: word(1067),
    pointerX: word(1042),
    pointerY: word(1043),
    cursorKind: word(6),
  };
});
console.log("state:", JSON.stringify(state));
const shot = path.join(shots, "browser-cursor-page.png");
await page.screenshot({ path: shot });
console.log("shot:", shot);

// Escape opens the pause dialog: the game hands the cursor back to Win32
// (CursorKind.Overlay), and the page layer draws that arrow too
// (docs/web/cursor-layer.md, "the whole game").
await page.keyboard.press("Escape");
await page.waitForTimeout(3000);
const paused = await page.evaluate(async () => {
  const handle = await window.ra2Session;
  const { HEAP32 } = handle.memory();
  const at = handle.shared >> 2;
  const word = (index) => Atomics.load(HEAP32, at + index);
  const layer = [...document.querySelectorAll("canvas")].find(
    (c) => c.getAttribute("aria-hidden") === "true",
  );
  const overlay = document.querySelector("img[class*=cursor]");
  return {
    cursorKind: word(6),
    pageCursorKind: word(1057),
    pageCursorRequest: word(1062),
    lock: document.pointerLockElement?.tagName ?? null,
    layer: layer
      ? {
          visibility: getComputedStyle(layer).visibility,
          width: layer.style.width,
          transform: layer.style.transform,
          backing: `${layer.width}x${layer.height}`,
        }
      : null,
    overlay: overlay ? getComputedStyle(overlay).display : null,
    canvasCursor: [...document.querySelectorAll("canvas")].find(
      (c) => c.getAttribute("aria-hidden") !== "true",
    )?.style.cursor,
  };
});
console.log("pause:", JSON.stringify(paused));
const pauseShot = path.join(shots, "browser-cursor-pause.png");
await page.screenshot({ path: pauseShot });
console.log("shot:", pauseShot);

await browser.close();
process.exit(state?.pageCursorRequest === 1 && paused.cursorKind === 3 ? 0 : 1);
