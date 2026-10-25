// Scratch probe: how long the game takes to reach its main menu, with the last game log line each 5 s.
import { startPage, options } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.pageArgs.push("--mute", "--debuglog");
const run = await startPage(opts);
const started = Date.now();
for (let i = 0; i < 18; i++) {
  await run.page.waitForTimeout(5000);
  const s = await run.state();
  console.log(
    `${Math.round((Date.now() - started) / 1000)}s phase=${s?.phase} fps=${s?.fps} last=${(run.all.at(-1) ?? "").slice(0, 100)}`,
  );
  if (s?.phase === "running" || s?.phase === "crashed") break;
}
await run.browser.close();
process.exit(0);
