// What the browser shows for the cursor in the shell's menus (docs/web/cursor-layer.md).
// Opens the launcher's YR card and stops at the main menu (no scripted presses), moves
// the real pointer over the picture and reads the shared words and the elements the
// presenters draw the cursor with. The page draws the cursor by default; --cursor game
// asks for the game's own software cursor instead. Run the dev server first.
//
//   node e2e/cursor-page-menu.mjs --game ../game \
//        --url "http://127.0.0.1:5173/" --profile ../../work/perf/wdt-profile
import { chromium } from "playwright-core";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { sharedProfile } from "./lib.mjs";

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const url = option("--url", "http://127.0.0.1:5173/");
const game = option("--game", path.resolve("..", "game"));
// One shared persistent profile for every game-imported check (see lib.mjs).
const profile = path.resolve(option("--profile", sharedProfile));
const shots = path.resolve(option("--shots", path.resolve("..", "work", "tests", "cursor-shots")));
const cursorParam = option("--cursor", "");
/** --software: choose the game's own cursor in the launcher (its stored setting). */
const software = argv.includes("--software");
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
if (software) {
  // The launcher's Cursor setting, as LauncherGameSettings stores it.
  await page.evaluate(() => localStorage.setItem("ra2.software-cursor.slot-1-ra2md", "1"));
  console.log("[browser] launcher cursor setting: game's own (software)");
}
await slot.locator('[data-game-id="ra2md"]').getByRole("button", { name: "Play" }).click();
await page.waitForURL(/\/game\/1(?:\?|$)/, { timeout: 120_000 });
console.log("[browser] the game was opened at", page.url());
if (software) {
  // The URL carries the choice for this launch; leave the profile as it was.
  await page.evaluate(() => localStorage.removeItem("ra2.software-cursor.slot-1-ra2md"));
}

const gameUrl = new URL(page.url());
if (cursorParam) gameUrl.searchParams.set("cursor", cursorParam);
for (const arg of ["--mute", "--debuglog"]) gameUrl.searchParams.append("arg", arg);
await page.goto(gameUrl.toString());

const read = async () =>
  page.evaluate(async () => {
    const handle = await window.ra2Session;
    const snapshot = window.ra2Store?.getSnapshot();
    const canvases = [...document.querySelectorAll("canvas")].map((c) => ({
      cls: c.className,
      ariaHidden: c.getAttribute("aria-hidden"),
      w: c.width,
      h: c.height,
      display: getComputedStyle(c).display,
      cursor: getComputedStyle(c).cursor.slice(0, 40),
    }));
    const overlay = [...document.querySelectorAll("img")].map((i) => ({
      cls: i.className,
      display: getComputedStyle(i).display,
      left: i.style.left,
      top: i.style.top,
      w: i.style.width,
      h: i.style.height,
    }));
    if (!handle) return { phase: snapshot?.phase ?? "loading", canvases, overlay, lock: null };
    const { HEAP32 } = handle.memory();
    const at = handle.shared >> 2;
    const word = (index) => Atomics.load(HEAP32, at + index);
    return {
      phase: snapshot?.phase,
      protocol: word(0),
      pointerX: word(1042),
      pointerY: word(1043),
      gameW: word(1037),
      gameH: word(1038),
      cursorKind: word(6),
      cursorSeq: word(5),
      pageCursorSeq: word(1056),
      pageCursorKind: word(1057),
      pageCursorRequest: word(1062),
      pageCursorW: word(1060),
      pageCursorH: word(1061),
      lock: document.pointerLockElement?.tagName ?? null,
      canvases,
      overlay,
    };
  });

const deadline = Date.now() + 300_000;
let state = null;
for (;;) {
  state = await read();
  if (state.phase === "crashed" || state.phase === "exited") break;
  if (state.protocol >= 10 && state.phase === "running") break;
  if (Date.now() > deadline) break;
  await page.waitForTimeout(2000);
}
console.log(
  "[browser] reached the shell:",
  JSON.stringify({ phase: state.phase, protocol: state.protocol }),
);

// Let the shell settle, then a real pointer move: what the menu does with it.
await page.waitForTimeout(6000);
await page.mouse.move(500, 400);
await page.mouse.move(640, 480, { steps: 10 });
await page.waitForTimeout(1500);
state = await read();
console.log("menu:", JSON.stringify(state, null, 1));
await page.screenshot({ path: path.join(shots, "browser-menu.png") });
console.log("shot:", path.join(shots, "browser-menu.png"));

// Does the page's input see a move at all, and who is under the pointer? A real
// move that the shared pointer ignores could be a swallowed event or the game
// warping its own pointer (SetCursorPos -> warp_cursor) right after.
const probe = await page.evaluate(async () => {
  const handle = await window.ra2Session;
  const { HEAP32 } = handle.memory();
  const at = handle.shared >> 2;
  const word = (index) => Atomics.load(HEAP32, at + index);
  const canvas = [...document.querySelectorAll("canvas")].find(
    (c) => c.getAttribute("aria-hidden") !== "true",
  );
  let seen = 0;
  const count = () => seen++;
  canvas?.addEventListener("mousemove", count);
  const before = { x: word(1042), y: word(1043) };
  const box = canvas?.getBoundingClientRect();
  canvas?.dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: (box?.left ?? 0) + (box?.width ?? 0) * 0.75,
      clientY: (box?.top ?? 0) + (box?.height ?? 0) * 0.75,
      bubbles: true,
    }),
  );
  await new Promise((r) => setTimeout(r, 300));
  canvas?.removeEventListener("mousemove", count);
  return {
    at: document.elementFromPoint(640, 480)?.className ?? null,
    delivered: seen,
    before,
    after: { x: word(1042), y: word(1043) },
  };
});
console.log("pointer probe:", JSON.stringify(probe));

// Escape: the shell asks whether to leave the game (a dialog the page draws itself).
await page.mouse.click(640, 480);
await page.keyboard.press("Escape");
await page.waitForTimeout(2500);
state = await read();
console.log("after Escape:", JSON.stringify(state, null, 1));
await page.screenshot({ path: path.join(shots, "browser-menu-escape.png") });
console.log("shot:", path.join(shots, "browser-menu-escape.png"));

await browser.close();
