// Drive the game with the mouse and keys through the page, saving screenshots:
//
//   node e2e/drive.mjs --step "click 719,221@3" --step "shot single-player@5" ...
//
// A step is `ACTION@SECONDS`: the seconds are counted from when the main menu opened.
//   click X,Y      a left click at a point in the game's pixels
//   rclick X,Y     a right click
//   rdrag X,Y,X2,Y2  press the right button at a point, move to the second one over a second, hold it there 2 s, release
//   move X,Y       move the mouse
//   key CODE       press a key (a KeyboardEvent.code: Escape, KeyA, Enter)
//   shot NAME      save e2e/shots/NAME.png
//   picture NAME   print how much of the canvas is lit, and a checksum (a change = it drew)
//   state          print the game's state
import { options, picture, startPage } from "./lib.mjs";

const argv = process.argv.slice(2);
const steps = argv
  .map((a, i) => (argv[i - 1] === "--step" ? a : null))
  .filter(Boolean)
  .map((text) => {
    const [action, at] = text.split("@");
    return { action: action.trim(), at: Number(at ?? 0) };
  })
  .sort((a, b) => a.at - b.at);

const t = await startPage(options(argv));
await t.waitFor("the main menu", (s) => s?.phase === "running");
const menuAt = Date.now();
console.log(`main menu after ${((menuAt - t.started) / 1000).toFixed(0)}s`);

for (const step of steps) {
  const wait = menuAt + step.at * 1000 - Date.now();
  if (wait > 0) await t.page.waitForTimeout(wait);
  const [verb, arg = ""] = step.action.split(/\s+/);
  const at = `${((Date.now() - menuAt) / 1000).toFixed(1)}s`;
  if (process.env.LOG_GREP)
    t.lines.push(
      `### ${step.action} (log line ${await t.page.evaluate(() => window.ra2Store?.getLog().length ?? 0)})`,
    );
  if (verb === "rdrag") {
    const [x, y, x2, y2] = arg.split(",").map(Number);
    await t.rdrag(x, y, x2, y2);
    console.log(`${at} ${step.action}`);
  } else if (verb === "click" || verb === "rclick" || verb === "move") {
    const [x, y] = arg.split(",").map(Number);
    if (verb === "move") {
      await t.moveGame(x, y);
    } else {
      await t.clickGame(x, y, verb === "rclick" ? "right" : "left");
    }
    console.log(`${at} ${step.action}`);
  } else if (verb === "key") {
    await t.page.keyboard.press(arg);
    console.log(`${at} ${step.action}`);
  } else if (verb === "shot") {
    await t.shot(arg);
    console.log(`${at} shot ${arg}`);
  } else if (verb === "picture") {
    console.log(`${at} picture ${arg} ${JSON.stringify(await picture(t.page))}`);
  } else if (verb === "state") {
    console.log(`${at} state ${JSON.stringify(await t.state())}`);
  } else {
    await t.fail(`unknown step ${step.action}`);
  }
  const s = await t.state();
  if (s?.phase === "crashed") await t.fail(`the game crashed: ${s.error}`);
}
console.log("log tail:");
const lines = await t.log();
console.log(lines.slice(-12).join("\n"));
// LOG_GREP=regex prints every log line that matches (a trace the game prints)
if (process.env.LOG_GREP) {
  const re = new RegExp(process.env.LOG_GREP);
  console.log(`log lines matching ${re}:`);
  const all = await t.page.evaluate(() => window.ra2Store?.getLog() ?? []);
  console.log([...all, ...t.lines].filter((l) => re.test(l)).join("\n"));
}
await t.browser.close();
