// Failure and recovery paths for the native Network -> browser LAN session.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
if (!opts.testGame) throw new Error("lan-session.mjs requires --game with an edition fixture");
opts.pageArgs.push("--mute", "--debuglog", "--env", "HLE_NETTRACE=1");
opts.watchChannels = true;
const iniName = opts.edition === "ra2" ? "RA2.INI" : "RA2MD.INI";
const named = (name) => {
  const ini = readFileSync(path.resolve(opts.testGame, iniName), "utf8");
  const handle = [...name].map((c) => c.charCodeAt(0).toString(16)).join(",");
  return {
    ...opts,
    gameFileOverrides: {
      [iniName]: Buffer.from(
        ini
          .replace(/(\[LAN\][^[]*?\bScenIndex=)\d+/i, (_all, prefix) => `${prefix}0`)
          .replace(/(\[LAN\][^[]*?\bUnitCount=)\d+/i, (_all, prefix) => `${prefix}0`)
          .replace(/^Handle=.*$/m, `Handle=${handle},`),
      ),
    },
  };
};
const waitEnded = (run) =>
  run.page.waitForFunction(
    () => window.ra2Store?.getSnapshot().lanSessionActive === null,
    undefined,
    { timeout: 30000 },
  );
const enter = async (run) => {
  await run.clickGame(720, 305);
  await run.page.getByRole("dialog", { name: "LAN multiplayer" }).waitFor({ timeout: 45000 });
  const request = (await run.state()).lanSession?.request;
  assert.ok(request, "native Network must create a new request");
  return request;
};
const run = await startPage(named("FailureHost"));
let guest;
try {
  await run.waitFor("main menu", (s) => s?.phase === "running", 240);
  const oldRequest = await enter(run);
  await run.shot("failure-native-lan-modal");
  const replyResults = await run.page.evaluate(async (id) => {
    const game = await window.ra2Session;
    return [
      game.exports.ra2_lan_session_reply(0, 1),
      game.exports.ra2_lan_session_reply(id, 2),
      game.exports.ra2_lan_session_reply(id + 1, 1),
      game.exports.ra2_lan_session_reply(id, 0),
      game.exports.ra2_lan_session_reply(id, 0),
    ];
  }, oldRequest);
  assert.deepEqual(replyResults, [0, 0, 0, 1, 0], "invalid and duplicate replies are rejected");
  await run.page.getByRole("dialog", { name: "LAN multiplayer" }).waitFor({ state: "hidden" });
  await waitEnded(run);
  assert.equal(
    await run.page.evaluate(
      async (id) => (await window.ra2Session).exports.ra2_lan_session_reply(id, 1),
      oldRequest,
    ),
    0,
    "a reply from a cancelled request is stale",
  );
  await run.shot("failure-escape-main-menu");

  const request = await enter(run);
  await run.page.context().grantPermissions([], { origin: new URL(opts.url).origin });
  await run.page.getByRole("button", { name: "Create WebRTC session" }).click();
  await run.page.getByLabel("LAN invitation", { exact: true }).waitFor({ timeout: 45000 });
  await run.page.getByRole("button", { name: "Copy invitation" }).click();
  await run.page.getByRole("alert").getByText("Clipboard access is unavailable.").waitFor();
  await run.shot("failure-clipboard-denied");

  await run.page.getByRole("button", { name: "Retry" }).click();
  await run.page.getByRole("button", { name: "Join WebRTC session" }).click();
  await run.page.getByLabel("LAN invitation to join").fill("not an SDP offer");
  await run.page.getByRole("button", { name: "Join with invitation" }).click();
  await run.page.getByRole("alert").waitFor();
  await run.page.getByRole("button", { name: "Retry" }).click();
  await run.page.getByLabel("LAN invitation to join").fill("still not an SDP offer");
  await run.page.getByRole("button", { name: "Join with invitation" }).click();
  await run.page.getByRole("alert").waitFor();
  await run.page.getByRole("button", { name: "Retry" }).click();

  // A dialog owns keyboard, pointer and canvas input while the native LAN
  // lobby is visible behind it. Interact with both surfaces and verify no
  // native setup window was created and no pointer lock was acquired.
  const invitation = run.page.getByLabel("LAN invitation to join");
  await invitation.fill("typing stays in the browser dialog");
  await invitation.press("Control+A");
  await invitation.press("Backspace");
  await run.clickGame(720, 221); // would open native New if the modal leaked input
  await run.page.waitForTimeout(800);
  assert.ok(
    !run.all.some((line) => line.includes("open 0xBC")),
    "modal clicks cannot open native setup",
  );
  assert.equal(
    (await run.state()).lanSession?.request,
    request,
    "modal typing/clicks retain the request",
  );
  await run.clickGame(10, 10); // canvas click cannot trigger the app's automatic pointer lock
  await run.page.waitForTimeout(300);
  assert.equal(
    await run.page.evaluate(() => document.pointerLockElement),
    null,
    "modal blocks pointer lock",
  );
  await run.shot("failure-input-isolated");
  await run.page.keyboard.press("Escape");
  await waitEnded(run);
  const nextRequest = await enter(run);
  assert.notEqual(nextRequest, request, "re-entry gets a fresh request");

  // A fresh two-client session verifies a real channel loss while the native
  // lobby is active. Reuse the fresh request opened above so the same native
  // session owns both the transport and the channel-loss recovery prompt.
  guest = await startPage(named("FailureGuest"));
  await guest.waitFor("guest main menu", (state) => state?.phase === "running", 240);
  await enter(guest);
  await run.page.getByRole("button", { name: "Create WebRTC session" }).click();
  const frameBeforeIceWait = await run.page.evaluate(async () => {
    const game = await window.ra2Session;
    return Atomics.load(game.memory().HEAP32, (game.shared >> 2) + 1);
  });
  await run.page.waitForFunction(
    async (before) => {
      const gamePromise = window.ra2Session;
      const connection = window.__lanTestConnections?.at(-1);
      if (!gamePromise || !connection || connection.iceGatheringState !== "gathering") return false;
      const game = await gamePromise;
      return Atomics.load(game.memory().HEAP32, (game.shared >> 2) + 1) !== before;
    },
    frameBeforeIceWait,
    { timeout: 15000 },
  );
  const offerField = run.page.getByLabel("LAN invitation", { exact: true });
  await offerField.waitFor({ timeout: 45000 });
  const offer = await offerField.inputValue();
  await guest.page.getByRole("button", { name: "Join WebRTC session" }).click();
  await guest.page.getByLabel("LAN invitation to join").fill(offer);
  await guest.page.getByRole("button", { name: "Join with invitation" }).click();
  const answerField = guest.page.getByLabel("LAN answer", { exact: true });
  await answerField.waitFor();
  const answer = await answerField.inputValue();
  await run.page.getByLabel("LAN answer to connect").fill(answer);
  await run.page.getByRole("button", { name: "Connect with answer" }).click();
  await Promise.all(
    [run, guest].map((client) =>
      client.page
        .getByRole("status")
        .filter({ hasText: "Connection ready." })
        .waitFor({ timeout: 45000 }),
    ),
  );
  await Promise.all([
    run.page.getByRole("button", { name: "Continue to LAN lobby" }).click(),
    guest.page.getByRole("button", { name: "Continue to LAN lobby" }).click(),
  ]);
  await Promise.all([
    run.page.getByRole("dialog").waitFor({ state: "hidden" }),
    guest.page.getByRole("dialog").waitFor({ state: "hidden" }),
  ]);
  await run.page.evaluate(() => {
    const channel = window.__lanTestChannels?.findLast(
      (candidate) => candidate.readyState === "open",
    );
    if (!channel) throw new Error("test did not capture the current open host data channel");
    channel.close();
  });
  await run.page.waitForFunction(
    () => document.body.innerText.includes("The LAN connection was lost."),
    undefined,
    { timeout: 10000 },
  );
  const recovery = await run.page.evaluate(() => ({
    dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) => ({
      name: d.getAttribute("aria-labelledby"),
      visible: d.getClientRects().length > 0,
    })),
    text: document.body.innerText,
    pointerLocked: !!document.pointerLockElement,
  }));
  console.log("Lobby channel-loss recovery:", JSON.stringify(recovery));
  assert.ok(
    recovery.text.includes("The LAN connection was lost."),
    "lobby channel loss is surfaced",
  );
  await run.shot("failure-channel-dropped");
  await guest.shot("failure-channel-peer");
  console.log(
    "PASS: stale/duplicate replies, Escape/cancel/re-entry, clipboard denial, malformed SDP retry, modal input/pointer isolation, and lobby channel loss.",
  );
} catch (error) {
  await run.shot("failure").catch(() => {});
  await guest?.shot("failure").catch(() => {});
  throw error;
} finally {
  writeFileSync(path.join(opts.shots, "session-host.log"), run.all.join("\n"));
  if (guest) writeFileSync(path.join(opts.shots, "session-guest.log"), guest.all.join("\n"));
  await run.browser.close();
  await guest?.browser.close();
}
