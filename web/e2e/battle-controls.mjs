// Real browser input: Modern orders, Queue Five, live HD, and locked edge scrolling.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
const url = new URL(opts.url); url.searchParams.set("video", "640x480"); opts.url = url.toString();
opts.pageArgs.push("--mute", "--debuglog", "--env", "RA2_MODERN_TRACE=1", "--press", "0xE2:1667@1", "--press", "0x100:1401@2", "--press", "0x102:1559@3");
const run = await startPage(opts);
const { page, all, clickGame, moveGame, shot } = run;
const report = {};
const waitLog = async (text, after = 0, timeout = 120000) => {
  const deadline = Date.now() + timeout;
  while (!all.slice(after).some((line) => line.includes(text))) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${text}`);
    assert.notEqual((await run.state())?.phase, "crashed");
    await page.waitForTimeout(250);
  }
};
const setting = (key, value) => page.evaluate(([k,v]) => window.Module.cwrap("ra2_setting", null, ["number","number","number"])(k,v,0), [key,value]);
// Guest addresses belong to this YR build. Read-only observations, never game-state edits.
const guest = () => page.evaluate(() => {
  const mem = window.Module.HEAP32;
  const tactical = mem[0x887324 >> 2];
  const selected = mem[0xA8ECC8 >> 2], data = mem[0xA8ECBC >> 2];
  const object = selected > 0 && data ? mem[data >> 2] : 0;
  return { selected, object,
    objectPosition: object ? [mem[(object + 0xA0) >> 2], mem[(object + 0xA4) >> 2]] : [],
    queueIndex: mem[0xA802D0 >> 2],
    camera: [mem[(tactical + 0xB0) >> 2], mem[(tactical + 0xB4) >> 2]],
    tactical };
});
const recentFps = async (hd) => {
  const samples = [];
  await setting(2, hd ? 1 : 0);
  await page.waitForTimeout(2000);
  for (let i = 0; i < 8; i++) { samples.push(await run.state()); await page.waitForTimeout(1000); }
  return samples.map(({ fps, ms, pacing }) => ({ fps, ms, pacing }));
};
try {
  await waitLog("Capture_Mouse");
  await page.waitForTimeout(3000);
  await moveGame(236, 240); await page.keyboard.press("h"); await page.waitForTimeout(1500);
  await setting(3, 1);
  await page.waitForFunction(() => window.ra2Store.getSnapshot().settings?.modern);
  await clickGame(220, 215);
  await page.waitForTimeout(1200);
  report.selection = await guest();
  assert.ok(report.selection.selected > 0, `left click did not select the MCV: ${JSON.stringify(report.selection)}`);
  let at = all.length;
  const beforeOrder = await guest();
  await clickGame(330, 250, "right");
  await page.waitForTimeout(6000);
  const afterOrder = await guest();
  const orderDelta = (afterOrder.queueIndex - beforeOrder.queueIndex + 128) % 128;
  report.rightClick = { before: beforeOrder, after: afterOrder, orderDelta,
    trace: all.slice(at).filter((line) => line.includes("[modern]")) };
  assert.equal(afterOrder.selected, beforeOrder.selected, "right-click changed the selection");
  assert.equal(orderDelta, 1, "Modern right-click did not enqueue exactly one contextual order");
  assert.notDeepEqual(afterOrder.objectPosition, beforeOrder.objectPosition,
    "selected MCV did not move after the contextual right-click order");
  console.log("PASS Modern right-click queued one order and moved the selected MCV");

  // Start a fresh skirmish for the build and Queue Five flow. The MCV used
  // above is intentionally moving, while this acceptance sequence expects it
  // to deploy at its original starting cell.
  at = all.length;
  await page.reload();
  await waitLog("Capture_Mouse", at);
  await run.waitFor("battle", (s) => (s?.fps ?? 0) > 0, 240);
  await setting(3, 0);
  await moveGame(236, 240); await page.waitForTimeout(1000); await page.keyboard.press("h");
  await page.waitForTimeout(1500); await clickGame(236, 213); await page.waitForTimeout(1000);
  at = all.length; await page.keyboard.press("d"); await waitLog("Adding event DEPLOY", at);
  await page.waitForTimeout(8000);
  const places = [[330,250],[150,250],[236,320],[330,320],[120,170],[130,330],[380,180],[360,360],[90,260],[400,280],[236,390],[110,400],[380,420],[70,150]];
  for (const [y, seconds] of [[251,29],[300,32]]) {
    await moveGame(523,y); await page.waitForTimeout(400); at = all.length;
    await clickGame(523,y); await waitLog("Adding event PRODUCE", at);
    await page.waitForTimeout(seconds*1000);
    await clickGame(523,y); at = all.length;
    for (const [x,y] of places) { await clickGame(x,y); await page.waitForTimeout(250); }
    await waitLog("Adding event PLACE", at);
    await page.waitForTimeout(4000);
  }
  await clickGame(573,210); await moveGame(523,251); await page.waitForTimeout(1000);
  await setting(3, 1);
  await page.waitForFunction(() => window.ra2Store.getSnapshot().settings?.modern);
  const before = await guest(); at = all.length;
  await page.keyboard.down("Shift"); await clickGame(523,251); await page.keyboard.up("Shift");
  await waitLog("Adding event PRODUCE", at); await page.waitForTimeout(500);
  const after = await guest();
  report.queue = { before: before.queueIndex, after: after.queueIndex,
    delta: (after.queueIndex-before.queueIndex+128)%128 };
  assert.equal(report.queue.delta, 5, "Shift-click appended exactly five production events");
  console.log("PASS power plant, barracks and Queue Five by browser mouse");
  report.classic = await recentFps(false); report.hd = await recentFps(true);
  await shot("hd-battle");
  report.edges = [];
  for (const fullscreen of [false,true]) {
    await page.keyboard.press("h"); await moveGame(236,240); await page.waitForTimeout(1000);
    if (fullscreen) { await page.keyboard.press("F11"); await page.waitForFunction(() => !!document.fullscreenElement); }
    await page.keyboard.press("F10");
    await page.getByRole("button", { name: "Lock pointer for edge scrolling" }).click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    const before = await guest();
    // Use opposite logical edges so the second pass can move away from the
    // map boundary reached in the first pass.
    const mouse = await page.evaluate(() => { const r = document.querySelector('canvas[aria-label="The game"]').getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; });
    await page.mouse.move(mouse.x,mouse.y); await page.mouse.move(mouse.x+(fullscreen?-2000:2000),mouse.y);
    await page.waitForTimeout(2000);
    const after = await guest(); report.edges.push({ fullscreen, before, after });
    assert.notDeepEqual(after.camera,before.camera,"locked edge moved the actual tactical camera");
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => !document.pointerLockElement);
    await shot(fullscreen ? "edge-fullscreen" : "edge-window");
  }
  console.log("PASS actual Pointer Lock edge scrolling in window and fullscreen");
} finally {
  await shot("last").catch(() => {});
  writeFileSync(path.join(opts.shots,"run.log"),all.join("\n"));
  writeFileSync(path.join(opts.shots,"report.json"),JSON.stringify(report,null,2));
  await run.browser.close();
}
