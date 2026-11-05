// Temporary probe: queue from the WDT match window (single client), then
// inject the server's match burst exactly as the matchbot sends it.
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.noDev = true;
opts.pageArgs.push("--debuglog", "--mute");
if (opts.testGame) {
  opts.gameFileOverrides = { "game.exe": readFileSync(path.resolve("../game/game.exe")) };
}
const run = await startPage(opts);

async function waitDialog(id, after = run.all.length, ms = 90000) {
  const deadline = Date.now() + ms;
  while (!run.all.slice(after).some((l) => l.includes(`[dialog] open ${id}`))) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for dialog ${id}`);
    await run.page.waitForTimeout(200);
  }
}
async function login() {
  const state = await run.page.evaluate(() => window.ra2Store?.getSnapshot() ?? null);
  const yuri = (state?.title ?? "").toLowerCase().includes("yuri");
  const [x, y0, y1] = yuri ? [401, 254, 297] : [398, 167, 205];
  const [submitX, submitY] = yuri ? [706, 220] : [720, 220];
  for (const [y, text] of [
    [y0, process.env.WOL_TEST_USER ?? "wdtprb1"],
    [y1, process.env.WOL_TEST_PASSWORD ?? "wolpass1"],
  ]) {
    await run.clickGame(x, y);
    await run.page.keyboard.press("End");
    for (let i = 0; i < 16; i++) await run.page.keyboard.press("Backspace");
    await run.page.keyboard.type(text, { delay: 60 });
    await run.page.waitForTimeout(200);
  }
  await run.clickGame(submitX, submitY);
}

const nick = process.env.WOL_TEST_USER ?? "wdtprb1";
const aiPart = new Array(8).fill("0,-1,-1,-1,-1").join(",");
const gameOpts =
  "0,0,2,10000,100,0,0,1,1,0,1,0,UgBhAG4AZABvAG0AIABNAGEAcAA=,2,1,1000,RandMap.Map,abc123,1,0,0,1,0,1:" +
  `${nick},0,0,0,0,0,0,0,wdtpeer,0,0,1,1,0,0,0:@:${aiPart},WDS=0,WDT=10`;

try {
  if (!opts.testGame) {
    await run.page.getByRole("heading", { name: "Your games" }).waitFor({ timeout: 60000 });
    const card = run.page.locator('[data-slot-id="1"] [data-game-id="ra2"]');
    await card.getByRole("button", { name: "Play" }).click();
  }
  await run.waitFor("main menu", (s) => s?.phase === "running", 240);
  await run.page.waitForTimeout(3000);
  await run.clickGame(720, 263); // Internet
  await waitDialog("0x10E");
  await run.page.waitForTimeout(2000);
  await run.clickGame(711, 346); // World Domination on the WOL profile screen
  await waitDialog("0x10F");
  await run.page.waitForTimeout(2500);
  await login();
  await run.page.waitForTimeout(4000);
  if (run.all.some((l) => l.includes("[dialog] open 0xFB"))) {
    await run.clickGame(707, 204); // Yes, switch to 640x480
    await run.page.waitForTimeout(4000);
  }
  await run.page.waitForTimeout(3000);
  await run.clickGame(190, 115); // Allied
  await run.page.waitForTimeout(6000);

  // The fight gesture: press on the map, drag across a few white territories
  // (the client reports each pick) and release. The release commits the
  // challenge and opens the WOL match window (0x117).
  await run.page.mouse.move(560, 250);
  await run.page.mouse.down();
  for (const [x, y] of [
    [600, 240],
    [650, 250],
    [700, 240],
    [660, 260],
    [620, 270],
  ]) {
    await run.page.mouse.move(x, y);
    await run.page.waitForTimeout(120);
  }
  await run.page.mouse.up();
  await run.page.waitForTimeout(8000);
  await run.shot("queued");
  const before = run.all.length;
  console.log(
    "queued",
    JSON.stringify(run.all.slice(-25).filter((l) => /wdt|dialog|Match|match|pick/i.test(l))),
  );

  const send = (line) =>
    run.page.evaluate((value) => window.Module.ra2WolReceiveLine?.(value), line);
  await send(`:wol 353 ${nick} = #WDTmatch :@${nick},0,50,0 wdtpeer,0,50,0`);
  await send(`:matchbot!matchbot@local GAMEOPT #WDTmatch :${gameOpts}`);
  await run.page.waitForTimeout(1500);
  await send(`:wol-ra2web STARTG #WDTmatch :ws://127.0.0.1:9090/gserv :g9-probe 1793700000 ticket`);
  for (let i = 0; i < 10; i++) {
    await run.page.waitForTimeout(1500);
    await run.shot(`start-${i}`);
  }
  const lines = run.all.slice(before);
  console.log(
    "probe evidence",
    JSON.stringify({
      adopted: lines.some((l) => l.includes("adopted game channel")),
      options: lines.some((l) => l.includes("Decoding game options")),
      start: lines.some((l) => l.includes("OnGameStart")),
      unable: lines.some((l) => l.includes("[dialog] open 0xD0")),
      dialogs: [
        ...new Set(
          lines.map((l) => /\[dialog\] (?:open|closed) (0x[0-9A-F]+)/.exec(l)?.[1]).filter(Boolean),
        ),
      ],
      tail: lines
        .filter((l) =>
          /\[wol\]|\[net\]|OnGameStart|Decoding|Allocated|display mode|\[dialog\] open/.test(l),
        )
        .slice(-30),
    }),
  );
} finally {
  writeFileSync(path.join(opts.shots, "game.log"), run.all.join("\n"));
  writeFileSync(path.join(opts.shots, "browser.log"), run.lines.join("\n"));
  await run.browser.close();
}
