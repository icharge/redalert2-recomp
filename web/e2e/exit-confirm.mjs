// Intercept Exit before native dialog creation and return the web choice to the game.
// Start Vite first, then pass the locally owned game folder with --game.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
if (!opts.testGame) throw new Error("Pass --game <local game folder>.");
opts.pageArgs.push("--mute");
const run = await startPage(opts);
const report = {};
const requests = [];

const waitForExitPrompt = async () => {
  await run.page.getByRole("heading", { name: "Exit game?" }).waitFor({ timeout: 30_000 });
  const request = await run.page.evaluate(() => window.ra2Store?.getSnapshot().exitConfirmation);
  assert.ok(request?.request, "the web prompt must carry a unique confirmation request");
  assert.ok(!requests.includes(request.request), "reopened prompts must have new request IDs");
  requests.push(request.request);
  assert.ok(
    !run.all.some((line) => line === "[dialog] open 0x120"),
    "no native Exit dialog may be created",
  );
  return request.request;
};

const openExitPrompt = async () => {
  const { size } = await run.state();
  // The 800x600 menu can be centered in a larger configured game surface.
  await run.clickGame(719 + ((size?.w ?? 800) - 800) / 2, 554 + ((size?.h ?? 600) - 600) / 2);
  return waitForExitPrompt();
};

try {
  await run.waitFor("main menu", (state) => state?.phase === "running");
  // The menu event precedes the buttons' slide-in animation.
  await run.page.waitForTimeout(1500);
  await run.shot("main-menu");

  // Use the real Exit Game button in either game's centered menu.
  await openExitPrompt();
  const invalidReplies = await run.page.evaluate(() => {
    const reply = window.Module.cwrap("ra2_exit_confirmation_reply", "number", [
      "number",
      "number",
    ]);
    return [
      reply(0, 1),
      reply(0xffffffff, 1),
      reply(window.ra2Store.getSnapshot().exitConfirmation.request, 2),
    ];
  });
  assert.deepEqual(
    invalidReplies,
    [0, 0, 0],
    "invalid replies must not consume the pending dialog",
  );
  report.invalidRepliesRejected = true;
  await run.shot("exit-confirm-web");
  await run.page.getByRole("button", { name: "Stay in game" }).click();
  await run.page.waitForFunction(() => window.ra2Store?.getSnapshot().exitConfirmation === null);
  assert.equal(
    (await run.state()).phase,
    "running",
    "Cancel must return to the still-running game",
  );
  report.stayReturnsToGame = true;

  await run.page.waitForTimeout(1500);
  await run.shot("exit-confirm-stay");
  await openExitPrompt();
  const staleReply = await run.page.evaluate(
    (previous) =>
      window.Module.cwrap("ra2_exit_confirmation_reply", "number", ["number", "number"])(
        previous,
        1,
      ),
    requests[0],
  );
  assert.equal(staleReply, 0, "an earlier request must not answer a reopened confirmation");
  report.staleRepliesRejected = true;
  await run.page.keyboard.press("Escape");
  await run.page.waitForFunction(() => window.ra2Store?.getSnapshot().exitConfirmation === null);
  assert.equal(
    (await run.state()).phase,
    "running",
    "Escape must cancel in the browser and keep the game open",
  );
  report.escapeReturnsToGame = true;

  await run.page.waitForTimeout(1500);
  await openExitPrompt();
  const workers = new Set(run.page.workers());
  run.page.on("worker", (worker) => workers.add(worker));
  for (const worker of workers) worker.on("close", () => workers.delete(worker));
  run.page.on("worker", (worker) => worker.on("close", () => workers.delete(worker)));
  assert.ok(workers.size > 0, "the running game must have worker threads");
  await run.page.getByRole("button", { name: "Exit game" }).click();
  await run.page.waitForURL(
    (url) => !url.searchParams.has("test") && !url.searchParams.has("dev"),
    { timeout: 30_000 },
  );
  await run.page
    .getByRole("heading", { name: /Your games|Bring your game/ })
    .waitFor({ timeout: 30_000 });
  await run.page.waitForFunction(() => !window.Module && !window.ra2Session);
  assert.equal(workers.size, 0, "leaving the game document must terminate its workers");
  assert.ok(
    run.all.some((line) => line.includes('"e":"exit","code":0')),
    "the game must complete its normal exit path",
  );
  report.exitReturnsToLauncher = true;
  report.gameWorkersAfterExit = workers.size;
  assert.ok(
    !run.all.some((line) => line.includes("called after runtime exit")),
    "cleanup must not call dead WASM exports",
  );
  assert.ok(
    !run.all.some((line) => line === "[dialog] open 0x120"),
    "the game must exit without creating the native confirmation",
  );
  report.nativeExitDialogCreated = false;
  report.requests = requests;
  report.finalState = await run.state();
  await run.shot("exit-confirm-exited");
  console.log("PASS: Exit returns to the launcher and releases the game runtime and workers.");
} catch (error) {
  report.error = String(error);
  report.state = await run.state();
  await run.shot("failure").catch(() => {});
  throw error;
} finally {
  writeFileSync(path.join(opts.shots, "exit-confirm.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(opts.shots, "exit-confirm.log"), run.all.join("\n"));
  await run.browser.close();
}
