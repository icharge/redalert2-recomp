// Two real browser clients: manual WebRTC pairing, then the game's IPX LAN lobby.
// Run with the web dev server and both browser modules built (docs/web/testing.md).
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { options, picture, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.pageArgs.push("--mute", "--debuglog", "--env", "HLE_NETTRACE=1");
const iniName = opts.edition === "ra2" ? "RA2.INI" : "RA2MD.INI";
const namedGame = (name) => {
  const ini = readFileSync(path.resolve(opts.testGame, iniName), "utf8");
  const handle = [...name].map((character) => character.charCodeAt(0).toString(16)).join(",");
  const lanIni = ini
    .replace(/(\[LAN\][^[]*?\bScenIndex=)\d+/i, (_match, prefix) => `${prefix}0`)
    .replace(/(\[LAN\][^[]*?\bUnitCount=)\d+/i, (_match, prefix) => `${prefix}0`);
  return {
    ...opts,
    gameFileOverrides: {
      [iniName]: Buffer.from(lanIni.replace(/^Handle=.*$/m, `Handle=${handle},`)),
    },
  };
};
const hostOpts = namedGame("BrowserHost");
const host = await startPage(hostOpts);
let guest;

const waitForLog = async (run, text, timeoutMs = 45000) => {
  await run.page.waitForFunction(
    (needle) => (window.ra2Store?.getLog() ?? []).some((line) => line.includes(needle)),
    text,
    { timeout: timeoutMs },
  );
};

const waitForPublishedFrame = (run) =>
  run.page.waitForFunction(
    async () => {
      const game = await window.ra2Session;
      const base = game.shared >> 2;
      const heap = game.memory().HEAP32;
      return (
        Atomics.load(heap, base + 1) > 0 &&
        Atomics.load(heap, base + 3) > 0 &&
        Atomics.load(heap, base + 4) > 0
      );
    },
    undefined,
    { timeout: 45000 },
  );

const openLan = async (run) => {
  // This is the original native Network button in dialog 0xE2.
  const frameBeforeNetwork = await run.page.evaluate(async () => {
    const game = await window.ra2Session;
    return Atomics.load(game.memory().HEAP32, (game.shared >> 2) + 1); // Shared.frameSeq
  });
  console.log(`${run === host ? "host" : "guest"}: clicking native Network`);
  await run.clickGame(720, 305);
  await run.page.getByRole("dialog", { name: "LAN multiplayer" }).waitFor({ timeout: 45000 });
  console.log(`${run === host ? "host" : "guest"}: browser modal opened over native LAN screen`);
  const snapshot = await run.state();
  assert.ok(snapshot.lanSession?.request, "native Network must publish a fresh LAN request");
  const frameAtRequest = await run.page.evaluate(async () => {
    const game = await window.ra2Session;
    return Atomics.load(game.memory().HEAP32, (game.shared >> 2) + 1);
  });
  assert.notEqual(
    frameAtRequest,
    frameBeforeNetwork,
    "a game frame must be published after native Network before its LAN request is observed",
  );
  await run.shot("lan-modal");
  const frame = await run.page
    .locator("canvas")
    .first()
    .evaluate((canvas) => canvas.toDataURL().split(",")[1]);
  writeFileSync(path.join(run.shots, "lan-background.png"), Buffer.from(frame, "base64"));
  return snapshot.lanSession.request;
};

try {
  const guestOpts = namedGame("BrowserGuest");
  guest = await startPage({ ...guestOpts, shots: `${opts.shots}/guest` });
  await Promise.all([
    host.waitFor("host main menu", (state) => state?.phase === "running"),
    guest.waitFor("guest main menu", (state) => state?.phase === "running"),
  ]);
  // Wait for the actual shared frame boundary before reading game files from
  // WasmFS; the initial menu event can precede first-frame initialization.
  await Promise.all([waitForPublishedFrame(host), waitForPublishedFrame(guest)]);
  const requests = await Promise.all([openLan(host), openLan(guest)]);
  assert.ok(
    requests.every((request) => request > 0),
    "each runtime has a nonzero request ID",
  );
  // Both runtimes have now published their post-0xBB LAN frames. Read the
  // staged key only after this game-thread boundary has been observed.
  const keys = await Promise.all(
    [host, guest].map((run) =>
      run.page.evaluate(() => {
        const bytes = window.Module?.FS?.readFile("/game/woldata.key");
        return bytes ? Array.from(bytes) : null;
      }),
    ),
  );
  assert.ok(
    keys.every((key) => key?.length === 128 && key.every((byte) => byte >= 0x30 && byte <= 0x39)),
    "each HLE client must stage a 128-digit WOL key",
  );
  assert.notDeepEqual(keys[0], keys[1], "LAN clients must receive distinct WOL keys");
  // a click before the LAN module is up makes no invitation: the loop below clicks again
  const create = host.page.getByRole("button", { name: "Create WebRTC session" });
  await create.click();
  const hostOffer = host.page.getByLabel("LAN invitation", { exact: true });
  await hostOffer.waitFor({ timeout: 45000 });
  for (const deadline = Date.now() + 60000; Date.now() < deadline;) {
    if ((await hostOffer.inputValue()).trim()) break;
    if (await create.isEnabled()) await create.click();
    await host.page.waitForTimeout(1000);
  }
  const offer = await hostOffer.inputValue();
  await host.shot("lan-host-offer");
  assert.ok(offer.trim().length > 0, "the host must produce a non-empty SDP offer");

  await guest.page.getByRole("button", { name: "Join WebRTC session" }).click();
  const guestOffer = guest.page.getByLabel("LAN invitation to join", { exact: true });
  await guestOffer.fill(offer);
  assert.equal(
    (await guestOffer.inputValue()).length,
    offer.length,
    "the guest received the full offer text",
  );
  const join = guest.page.getByRole("button", { name: "Join with invitation" });
  await join.waitFor({ state: "visible" });
  await guest.page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Join with invitation"),
    );
    return button instanceof HTMLButtonElement && !button.disabled;
  });
  await join.click();
  const guestAnswer = guest.page.getByLabel("LAN answer", { exact: true });
  await guestAnswer.waitFor();
  // the answer is filled in once the guest's side has gathered its candidates
  await guest.page.waitForFunction(
    () => document.querySelector('[aria-label="LAN answer"]')?.value?.trim(),
    undefined,
    { timeout: 60000 },
  );
  const answer = await guestAnswer.inputValue();

  await host.page.getByLabel("LAN answer to connect", { exact: true }).fill(answer);
  await host.page.getByRole("button", { name: "Connect with answer" }).click();
  const connected = async (run) =>
    run.page.waitForFunction(
      () => document.querySelector('[role="status"]')?.textContent?.includes("Connection ready."),
      undefined,
      { timeout: 45000 },
    );
  await Promise.all([connected(host), connected(guest)]);

  // Give both players distinct in-game names before entering the IPX lobby.
  await host.page.getByRole("button", { name: "Continue to LAN lobby" }).click();
  await guest.page.getByRole("button", { name: "Continue to LAN lobby" }).click();
  await Promise.all(
    [host, guest].map(async (run) => {
      await run.page.getByRole("dialog").waitFor({ state: "hidden" });
      await run.page.waitForTimeout(500);
    }),
  );
  await Promise.all([waitForLog(host, "open 0xBB"), waitForLog(guest, "open 0xBB")]);
  await host.shot("lan-host-lobby");
  await guest.shot("lan-guest-lobby");

  // The page's chat box takes only the typing meant for the chat line: the LAN screen's own name
  // field ("Your Name", Edit 0x541) keeps its keys. It sits at 134..273 x 16..37 in Yuri's Revenge's
  // 800x600 menu and at 216..352 x 76..97 in Red Alert 2's.
  {
    const box = host.page.getByRole("textbox", { name: "Chat message" });
    await box.waitFor({ timeout: 15000 });
    if (opts.edition === "ra2") await host.clickGame(284, 87);
    else await host.clickGame(205, 27);
    await host.page.waitForTimeout(500);
    assert.equal((await host.state()).chatField.keys, false, "the game's name field has the focus");
    await host.page.keyboard.type("Zq", { delay: 80 });
    await host.page.waitForTimeout(300);
    assert.equal(await box.inputValue(), "", "typing in the name field stays out of the chat box");
    assert.notEqual(
      await box.evaluate((el) => el === document.activeElement),
      true,
      "the chat box did not take the focus",
    );
    await host.shot("lan-host-name-field");
    for (let i = 0; i < 2; i++) await host.page.keyboard.press("Backspace", { delay: 80 });
    await host.page.waitForTimeout(300);
    assert.equal(await box.inputValue(), "", "Backspace in the name field stays with the game too");
    console.log("ok  the LAN screen's name field keeps its typing; the chat box takes none");
  }

  await host.clickGame(720, 221); // New
  await waitForLog(host, "open 0xBC");
  await waitForLog(guest, "[net] recvfrom 0.0.0.0:");
  assert.ok(
    guest.all.some((line) => /\[net\] recvfrom 0\.0\.0\.0:\d+ [1-9]\d* bytes/.test(line)),
    "the guest must receive a non-empty IPX datagram over WebRTC",
  );
  await host.shot("lan-host-setup");
  await guest.page.waitForTimeout(3000);
  await guest.shot("lan-guest-sees-host");
  // RA2's native LAN list starts lower than YR's.
  const hostRowY = opts.edition === "ra2" ? 167 : 103;
  console.log(`guest: selecting the host game at native row y=${hostRowY}`);
  await guest.clickGame(500, hostRowY); // select the host's game
  await guest.page.waitForTimeout(500);
  await guest.shot("lan-guest-selected-host");
  await guest.clickGame(720, 263); // Join
  await waitForLog(guest, "open 0xBD");
  // The Join dialog is asynchronous; click its Accept button after it opens.
  await guest.page.evaluate(async () => {
    const game = await window.ra2Session;
    game.exports.ra2_input_pointer(1, 720, 263, 0);
    game.exports.ra2_input_pointer(2, 720, 263, 0);
  }); // Accept (directly in 800x600 game pixels)
  await guest.page.waitForTimeout(1000);
  await guest.shot("lan-guest-accepted");
  await Promise.all([waitForLog(host, "recvfrom 0.0.0.0:"), waitForLog(host, "open 0xBC")]);
  await waitForLog(host, "BrowserGuest,", 90000);
  // The roster update can precede the guest's check-in packet. Give the host
  // time to process the Accept before requesting the start.
  await host.page.waitForTimeout(5000);
  await host.clickGame(720, 263); // Request the match start
  // The guest must acknowledge the host's start request on the Join screen.
  await guest.page.waitForTimeout(6000);
  await guest.shot("lan-guest-start-request");
  await guest.page.evaluate(async () => {
    const game = await window.ra2Session;
    game.exports.ra2_input_pointer(1, 720, 263, 0);
    game.exports.ra2_input_pointer(2, 720, 263, 0);
  }); // Acknowledge the host's start request
  await host.page.waitForTimeout(2000);
  await host.clickGame(720, 263); // Start again after the guest's final check-in
  await Promise.all([waitForLog(host, "Capture_Mouse"), waitForLog(guest, "Capture_Mouse")]);
  await Promise.all([
    host.waitFor("host LAN match", (state) => (state?.fps ?? 0) > 0, 120),
    guest.waitFor("guest LAN match", (state) => (state?.fps ?? 0) > 0, 120),
  ]);
  await Promise.all([host.page.waitForTimeout(3000), guest.page.waitForTimeout(3000)]);
  const pictures = await Promise.all([picture(host.page), picture(guest.page)]);
  console.log("Match frame diagnostics:", JSON.stringify(pictures));
  assert.ok(
    pictures.every(({ lit }) => lit > 0),
    "both clients must render non-black match frames",
  );
  await Promise.all([host.shot("lan-host-match"), guest.shot("lan-guest-match")]);
  const beforeOrders = await Promise.all([picture(host.page), picture(guest.page)]);
  // The lean fixtures start with one MCV per player. Select it and deploy it:
  // this produces an observable native world change on each side of the link.
  await Promise.all(
    [host, guest].map(async (run) => {
      await run.page.keyboard.press("N");
      await run.page.keyboard.press("D");
      await run.page.waitForTimeout(5000);
    }),
  );
  const afterOrders = await Promise.all([picture(host.page), picture(guest.page)]);
  assert.ok(
    afterOrders.every((frame, index) => frame.checksum !== beforeOrders[index].checksum),
    "each player's native order must produce a changed shared-match frame",
  );
  await Promise.all([host.shot("lan-host-order-response"), guest.shot("lan-guest-order-response")]);
  console.log(
    "PASS: two clients entered Network, paired over WebRTC, exchanged lobby IPX, started the same match, and each produced a changed gameplay frame after an order.",
  );
  assert.equal((await host.state()).phase, "running");
  assert.equal((await guest.state()).phase, "running");
} catch (error) {
  await host.shot("lan-host-failure").catch(() => {});
  await guest?.shot("lan-guest-failure").catch(() => {});
  throw error;
} finally {
  writeFileSync(path.join(opts.shots, "lan-host.log"), host.all.join("\n"));
  if (guest) writeFileSync(path.join(opts.shots, "lan-guest.log"), guest.all.join("\n"));
  await host.browser.close();
  await guest?.browser.close();
}
