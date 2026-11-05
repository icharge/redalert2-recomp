// Two-browser WDT match probe: both clients enter World Domination directly
// from the WOL profile screen, pick Allied, fight for a territory, and dump
// both game logs. Development scratch, not part of the suite.
// The input helpers below (clicks, warps, drags) are kept as a catalogue of the
// techniques this probe used; each one is wired into the probe as needed.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.noDev = true;
opts.pageArgs.push("--debuglog", "--mute");

const gameExe = readFileSync(path.resolve("../game/game.exe"));

async function waitDialog(run, id, after = run.all.length, ms = 90000) {
  const deadline = Date.now() + ms;
  while (!run.all.slice(after).some((l) => l.includes(`[dialog] open ${id}`))) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for dialog ${id}`);
    await run.page.waitForTimeout(200);
  }
}

async function login(run, user) {
  const state = await run.page.evaluate(() => window.ra2Store?.getSnapshot() ?? null);
  const yuri = (state?.title ?? "").toLowerCase().includes("yuri");
  const [x, y0, y1] = yuri ? [401, 254, 297] : [398, 167, 205];
  const [submitX, submitY] = yuri ? [706, 220] : [720, 220];
  for (const [y, text] of [
    [y0, user],
    [y1, "wolpass1"],
  ]) {
    await run.clickGame(x, y);
    await run.page.keyboard.press("End");
    for (let i = 0; i < 16; i++) await run.page.keyboard.press("Backspace");
    await run.page.keyboard.type(text, { delay: 40 });
    await run.page.waitForTimeout(150);
  }
  await run.clickGame(submitX, submitY);
}

async function enterWdt(run, user) {
  await run.waitFor(`${user} main menu`, (s) => s?.phase === "running", 240);
  await run.page.waitForTimeout(3000);
  await run.clickGame(720, 263); // Internet
  await waitDialog(run, "0x10E");
  await run.page.waitForTimeout(2000);
  await run.clickGame(711, 346); // World Domination on the WOL profile screen
  await waitDialog(run, "0x10F");
  await run.page.waitForTimeout(2500);
  await login(run, user);
  await run.page.waitForTimeout(4000);
  if (run.all.some((l) => l.includes("[dialog] open 0xFB"))) {
    await run.clickGame(707, 204); // Yes, switch to 640x480
    await run.page.waitForTimeout(4000);
  }
  await run.page.waitForTimeout(3000);
  // The WDT screen opens a side-select overlay (0x125); the map only takes
  // input after that overlay closes.
  await waitDialog(run, "0x125", 0);
  await run.page.waitForTimeout(1500);
  await run.clickGame(190, 115); // Allied
  const closed = Date.now() + 15000;
  while (Date.now() < closed && !run.all.some((l) => l.includes("[dialog] closed 0x125"))) {
    await run.page.waitForTimeout(200);
  }
  await run.page.waitForTimeout(4000);
  await run.shot(`${user}-map`);
  if (!run.all.some((l) => l.includes("[dialog] closed 0x125"))) {
    throw new Error(`${user}: WDT side-select did not close`);
  }
}

const makeRun = (user) => ({
  ...opts,
  shots: path.join(opts.shots, user),
  gameFileOverrides: { "game.exe": gameExe },
});

const first = await startPage(makeRun("wdtprb1"));
let second;
try {
  await enterWdt(first, "wdtprb1");
  second = await startPage(makeRun("wdtprb2"));
  await enterWdt(second, "wdtprb2");
  for (const run of [first, second]) {
    // The WDT challenge is a drag + release on the map: the client reports
    // each territory it passes, then opens its match window (0x117) and
    // joins the matching lobby on release. Retry until the window opens.
    let opened = false;
    for (let attempt = 0; attempt < 5 && !opened; attempt++) {
      const startX = 560 + attempt * 20;
      await run.page.mouse.move(startX, 250);
      await run.page.mouse.down();
      for (const [x, y] of [
        [600, 240],
        [650, 250],
        [700, 240],
        [660, 260],
        [620, 270],
      ]) {
        await run.page.mouse.move(x + attempt * 10, y);
        await run.page.waitForTimeout(120);
      }
      await run.page.mouse.up();
      await run.page.waitForTimeout(3000);
      opened = run.all.some((l) => l.includes("[dialog] open 0x117"));
      console.log(
        `${run === first ? "wdtprb1" : "wdtprb2"} match window attempt ${attempt}: ${opened}`,
      );
    }
    if (!opened) throw new Error("WDT match window did not open");
  }
  // Both clients stay in the match. Play it: select the starting force, then
  // scroll the view toward the enemy base and keep ordering the force onto it,
  // so the game itself decides the battle. A house that loses every object ends
  // the match with a real win (completion status 256), which is what WDT
  // settlement needs.
  const secondClosed = false;
  const gamePoint = async (run, x, y) =>
    run.page.evaluate(
      ([gx, gy]) => {
        const c = document.querySelector("canvas");
        const size = window.ra2Store?.getSnapshot().size;
        const width = size?.w ?? c.width;
        const height = size?.h ?? c.height;
        const r = c.getBoundingClientRect();
        const scale = Math.min(r.width / width, r.height / height);
        return {
          x: r.left + (r.width - width * scale) / 2 + (gx + 0.5) * scale,
          y: r.top + (r.height - height * scale) / 2 + (gy + 0.5) * scale,
        };
      },
      [x, y],
    );
  const dragSelect = async (run, x0, y0, x1, y1) => {
    const a = await gamePoint(run, x0, y0);
    const b = await gamePoint(run, x1, y1);
    await run.page.mouse.move(a.x, a.y);
    await run.page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await run.page.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
      await run.page.waitForTimeout(60);
    }
    await run.page.mouse.up();
  };
  const attackAt = async (run, x, y) => {
    const point = await gamePoint(run, x, y);
    await run.page.mouse.click(point.x, point.y, { button: "right", delay: 80 });
  };
  // In-game clicks: the game maps pointer events against its own picture size,
  // which is the canvas backing store (input.ts picture() = canvas.width/height).
  // The lobby screens are driven by clickGame's store-based mapping instead.
  const canvasPoint = async (run, x, y) =>
    run.page.evaluate(
      ([gx, gy]) => {
        const c = document.querySelector("canvas");
        const r = c.getBoundingClientRect();
        const scale = Math.min(r.width / c.width, r.height / c.height);
        return {
          x: r.left + (r.width - c.width * scale) / 2 + (gx + 0.5) * scale,
          y: r.top + (r.height - c.height * scale) / 2 + (gy + 0.5) * scale,
        };
      },
      [x, y],
    );
  const gclick = async (run, x, y, button = "left") => {
    const p = await canvasPoint(run, x, y);
    await run.page.mouse.click(p.x, p.y, { button, delay: 80 });
  };
  const gmove = async (run, x, y) => {
    const p = await canvasPoint(run, x, y);
    await run.page.mouse.move(p.x, p.y);
  };
  // Pointer Lock makes mouse.move() a delta, so absolute page coordinates drift
  // (measured: cursor rendered at page+228,-18). game-pixel accuracy is possible
  // through the shared struct's SetCursorPos fields: ra2_shared() exposes
  // warp_seq/warp_x/warp_y, which input.ts applies to its virtual cursor.
  // This computes the game pixel under a page point and warps there before the
  // click, so the click lands exactly where the screenshot says.
  const warpClick = async (run, pageX, pageY, button = "left") =>
    run.page
      .evaluate(
        ([px, py, btn]) => {
          const c = document.querySelector("canvas");
          const r = c.getBoundingClientRect();
          const M = window.Module;
          const base = M.cwrap("ra2_shared", "number", [])() >> 2;
          const i32 = new Int32Array(M.HEAPU8.buffer);
          const load = (i) => {
            try {
              return Atomics.load(i32, i);
            } catch {
              return i32[i];
            }
          };
          const store = (i, v) => {
            try {
              Atomics.store(i32, i, v);
            } catch {
              i32[i] = v;
            }
          };
          const gw = load(base + 1037) || c.width;
          const gh = load(base + 1038) || c.height;
          const scale = Math.min(r.width / gw, r.height / gh) || 1;
          const gx = Math.floor((px - r.left - (r.width - gw * scale) / 2) / scale);
          const gy = Math.floor((py - r.top - (r.height - gh * scale) / 2) / scale);
          const seq = load(base + 1039);
          store(base + 1040, gx);
          store(base + 1041, gy);
          store(base + 1039, seq + 1);
          const o = { bubbles: true, cancelable: true, clientX: px, clientY: py, view: window };
          const rb = btn === "right";
          c.dispatchEvent(new MouseEvent("mousemove", { ...o, buttons: 0 }));
          c.dispatchEvent(
            new MouseEvent("mousedown", { ...o, button: rb ? 2 : 0, buttons: rb ? 2 : 1 }),
          );
          c.dispatchEvent(new MouseEvent("mouseup", { ...o, button: rb ? 2 : 0, buttons: 0 }));
          return { gx, gy, gw, gh };
        },
        [pageX, pageY, button],
      )
      .then((v) => console.log("WARPC", JSON.stringify(v)));
  // Split press/release so the game sees the button held across frames: a
  // down+up in one task is collapsed by the presenter's pointer state.
  const warpEvent = async (run, pageX, pageY, phase, button) =>
    run.page.evaluate(
      ([px, py, ph, btn]) => {
        const c = document.querySelector("canvas");
        const r = c.getBoundingClientRect();
        const M = window.Module;
        const base = M.cwrap("ra2_shared", "number", [])() >> 2;
        const i32 = new Int32Array(M.HEAPU8.buffer);
        const load = (i) => {
          try {
            return Atomics.load(i32, i);
          } catch {
            return i32[i];
          }
        };
        const store = (i, v) => {
          try {
            Atomics.store(i32, i, v);
          } catch {
            i32[i] = v;
          }
        };
        const gw = load(base + 1037) || c.width;
        const gh = load(base + 1038) || c.height;
        const scale = Math.min(r.width / gw, r.height / gh) || 1;
        const gx = Math.floor((px - r.left - (r.width - gw * scale) / 2) / scale);
        const gy = Math.floor((py - r.top - (r.height - gh * scale) / 2) / scale);
        const o = { bubbles: true, cancelable: true, clientX: px, clientY: py, view: window };
        if (ph === "move") {
          c.dispatchEvent(new MouseEvent("mousemove", { ...o, buttons: btn === 2 ? 2 : 1 }));
          return { gx, gy };
        }
        if (ph !== "up") {
          const seq = load(base + 1039);
          store(base + 1040, gx);
          store(base + 1041, gy);
          store(base + 1039, seq + 1);
          c.dispatchEvent(new MouseEvent("mousemove", { ...o, buttons: 0 }));
          c.dispatchEvent(
            new MouseEvent("mousedown", { ...o, button: btn, buttons: btn === 2 ? 2 : 1 }),
          );
        } else {
          c.dispatchEvent(new MouseEvent("mouseup", { ...o, button: btn, buttons: 0 }));
        }
        return { gx, gy };
      },
      [pageX, pageY, phase, button ?? 0],
    );
  // A real (trusted) click at an exact game pixel: move the pointer over the
  // canvas (its delta is irrelevant), publish the target through the shared
  // warp fields, then press/release with real events. input.ts ignores the
  // client position under Pointer Lock and reads the warped virtual cursor, so
  // the event carries the exact cell while still being a genuine button hold.
  const warpOnly = (run, pageX, pageY) =>
    run.page.evaluate(
      ([px, py]) => {
        const c = document.querySelector("canvas");
        const r = c.getBoundingClientRect();
        const M = window.Module;
        const base = M.cwrap("ra2_shared", "number", [])() >> 2;
        const i32 = new Int32Array(M.HEAPU8.buffer);
        const load = (i) => {
          try {
            return Atomics.load(i32, i);
          } catch {
            return i32[i];
          }
        };
        const store = (i, v) => {
          try {
            Atomics.store(i32, i, v);
          } catch {
            i32[i] = v;
          }
        };
        const gw = load(base + 1037) || c.width;
        const gh = load(base + 1038) || c.height;
        const scale = Math.min(r.width / gw, r.height / gh) || 1;
        const gx = Math.floor((px - r.left - (r.width - gw * scale) / 2) / scale);
        const gy = Math.floor((py - r.top - (r.height - gh * scale) / 2) / scale);
        store(base + 1040, gx);
        store(base + 1041, gy);
        store(base + 1039, load(base + 1039) + 1);
        return { gx, gy };
      },
      [pageX, pageY],
    );
  const trustedClick = async (run, pageX, pageY, button, hold) => {
    await run.page.mouse.move(pageX, pageY);
    await warpOnly(run, pageX, pageY);
    await run.page.waitForTimeout(60);
    await run.page.mouse.down({ button });
    await run.page.waitForTimeout(hold ?? 150);
    await run.page.mouse.up({ button });
  };
  const clickUnit = async (run, x, y, shift) => {
    const point = await gamePoint(run, x, y);
    if (shift) await run.page.keyboard.down("Shift");
    await run.page.mouse.click(point.x, point.y, { delay: 60 });
    if (shift) await run.page.keyboard.up("Shift");
  };
  // Right click at a game-space point, however far outside the view: the
  // presenter maps clientX/clientY without clamping, so this names an arbitrary
  // map cell.
  const clickFar = async (run, gx, gy) => {
    await run.page.evaluate(
      ([x, y]) => {
        const c = document.querySelector("canvas");
        const size = window.ra2Store?.getSnapshot().size;
        const width = size?.w ?? c.width;
        const height = size?.h ?? c.height;
        const r = c.getBoundingClientRect();
        const scale = Math.min(r.width / width, r.height / height) || 1;
        const clientX = r.left + (r.width - width * scale) / 2 + (x + 0.5) * scale;
        const clientY = r.top + (r.height - height * scale) / 2 + (y + 0.5) * scale;
        const base = { bubbles: true, cancelable: true, clientX, clientY, view: window };
        c.dispatchEvent(new MouseEvent("mousemove", { ...base, buttons: 0 }));
        c.dispatchEvent(new MouseEvent("mousedown", { ...base, button: 2, buttons: 2 }));
        c.dispatchEvent(new MouseEvent("mouseup", { ...base, button: 2, buttons: 0 }));
      },
      [gx, gy],
    );
  };
  // Hold the pointer against the right edge: the game scrolls the tactical view.
  const scrollRight = async (run, ms) => {
    const edge = await gamePoint(run, 600, 300);
    await run.page.mouse.move(edge.x, edge.y);
    await run.page.waitForTimeout(ms);
  };
  const press = async (run, code) => {
    await run.page.evaluate(() => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) ae.blur();
    });
    await run.page.waitForTimeout(80);
    await run.page.keyboard.press(code);
  };
  const running = () =>
    first.all.some((l) => l.includes("Frame 0, my sent") || l.includes("Player ready"));
  for (let i = 0; i < 40 && !running(); i++) await first.page.waitForTimeout(2000);
  await first.page.waitForTimeout(14000);
  // Centre each client on its own base and select one object, so the view is
  // drawn (not shroud) and the house colour of the units can be judged.
  for (const run of [first, second]) {
    // A pointer event in the field gives the game focus before the hotkeys.
    await warpEvent(run, 400, 300, "down");
    await run.page.waitForTimeout(150);
    await warpEvent(run, 400, 300, "up");
    await run.page.waitForTimeout(400);
    for (let i = 0; i < 3; i++) {
      await press(run, "KeyH");
      await run.page.waitForTimeout(700);
    }
    await press(run, "KeyN");
    await run.page.waitForTimeout(1200);
  }
  await first.shot("view1");
  await second.shot("view2");
  await first.shot("a-final");
  await second.shot("b-final");
  // Finish the match: 0x108 is the post-game score box. Wait for it on both
  // clients, then press its Continue button (template control 0x6D1 at
  // [317,255,108,23] inside a 432x288 box centred on the 800x600 match screen).
  const clients = secondClosed ? [first] : [first, second];
  for (const run of clients) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline && !run.all.some((l) => l.includes("[dialog] open 0x108"))) {
      await run.page.waitForTimeout(250);
    }
  }
  for (const run of clients) {
    if (!run.all.some((l) => l.includes("[dialog] open 0x108"))) continue;
    // Continue sits in the score box's bottom-right pane, ~(1150, 893) on the
    // 1280x960 canvas (the 800x600 match screen stretched to the page).
    await run.page.mouse.click(1150, 893);
    await run.page.waitForTimeout(1200);
    if (!run.all.some((l) => l.includes("[dialog] closed 0x108"))) {
      await run.page.keyboard.press("Enter");
      await run.page.waitForTimeout(1200);
    }
    if (!run.all.some((l) => l.includes("[dialog] closed 0x108"))) {
      await run.page.mouse.click(720, 558); // same point in game coordinates
      await run.page.waitForTimeout(1200);
    }
  }
  await first.page.waitForTimeout(6000);
  await first.shot("a-continue");
  if (!secondClosed) await second.shot("b-continue");
  // The map screen should be back at the authored 640x480.
  await first.page.waitForTimeout(4000);
} finally {
  for (const [user, run] of [
    ["wdtprb1", first],
    ["wdtprb2", second],
  ]) {
    if (!run) continue;
    writeFileSync(path.join(opts.shots, user, "game.log"), run.all.join("\n"));
    writeFileSync(path.join(opts.shots, user, "browser.log"), run.lines.join("\n"));
    const lines = run.all;
    console.log(
      user,
      JSON.stringify({
        adopted: lines.some((l) => l.includes("adopted game channel")),
        start: lines.some((l) => l.includes("OnGameStart")),
        options: lines.some((l) => l.includes("Decoding game options")),
        ports: lines.some((l) => l.includes("Allocated port")),
        unable: lines.some((l) => l.includes("[dialog] open 0xD0")),
        matchWindow: lines.some((l) => l.includes("[dialog] open 0x117")),
        scoreScreen: lines.some((l) => l.includes("[dialog] open 0x108")),
        scoreClosed: lines.some((l) => l.includes("[dialog] closed 0x108")),
        backToMap: lines.some((l) => l.includes("[dialog] open 0x125")),
        display640: (lines.filter((l) => l.includes("@ra2")).slice(-1)[0] || "").includes(
          '"w":640',
        ),
        picks: lines.filter((l) => l.includes("[wdt] pick")).slice(-3),
        tail: lines
          .filter((l) =>
            /\[wol\]|OnGameStart|Decoding|Allocated|display mode|\[dialog\] open/.test(l),
          )
          .slice(-18),
      }),
    );
  }
  await first.browser.close();
  if (second) await second.browser.close().catch(() => {});
}
