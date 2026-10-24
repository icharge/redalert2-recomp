// Two real browser clients: manual WebRTC pairing, then the game's IPX LAN lobby.
// Run with the web dev server and both browser modules built (docs/web/testing.md).
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { options, picture, startPage } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.pageArgs.push("--mute", "--debuglog", "--env", "HLE_NETTRACE=1");
const namedGame = (name) => {
  const ini = readFileSync(path.resolve(opts.testGame, "RA2MD.INI"), "utf8");
  const serial = Buffer.from(readFileSync(path.resolve(opts.testGame, "woldata.key")));
  if (name === "BrowserHost") serial[0] = serial[0] === 0x39 ? 0x38 : serial[0] + 1;
  const handle = [...name].map((character) => character.charCodeAt(0).toString(16)).join(",");
  const lanIni = ini.replace(/(\[LAN\][^[]*?\bScenIndex=)\d+/i, (_match, prefix) => `${prefix}0`);
  return {
    ...opts,
    gameFileOverrides: {
      "RA2MD.INI": Buffer.from(lanIni.replace(/^Handle=.*$/m, `Handle=${handle},`)),
      "woldata.key": serial,
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

const openLan = async (run) => {
  await run.page.getByRole("button", { name: "LAN", exact: true }).click();
};

try {
  const guestOpts = namedGame("BrowserGuest");
  guest = await startPage({ ...guestOpts, shots: `${opts.shots}/guest` });
  await Promise.all([
    host.waitFor("host main menu", (state) => state?.phase === "running"),
    guest.waitFor("guest main menu", (state) => state?.phase === "running"),
  ]);

  await Promise.all([openLan(host), openLan(guest)]);
  await host.page.getByRole("button", { name: "Create invitation" }).click();
  const hostOffer = host.page.getByLabel("LAN invitation", { exact: true });
  await hostOffer.waitFor({ timeout: 45000 });
  const offer = await hostOffer.inputValue();
  const offerFields = await host.page.locator("textarea").evaluateAll((fields) =>
    fields.map((field) => ({
      label: field.getAttribute("aria-label"),
      valueLength: field.value.length,
    })),
  );
  console.log(
    "Offer field diagnostics:",
    JSON.stringify({ offerLength: offer.length, offerFields }),
  );
  await host.shot("lan-host-offer");
  assert.ok(offer.trim().length > 0, "the host must produce a non-empty SDP offer");

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
  const answer = await guestAnswer.inputValue();

  await host.page.getByLabel("LAN answer to connect", { exact: true }).fill(answer);
  await host.page.getByRole("button", { name: "Connect with answer" }).click();
  const connected = async (run) =>
    run.page.waitForFunction(
      () => document.querySelector('[role="status"]')?.textContent?.includes("Connected."),
      undefined,
      { timeout: 45000 },
    );
  await Promise.all([connected(host), connected(guest)]);

  // Give both players distinct in-game names before entering the IPX lobby.
  await host.page.getByRole("button", { name: "Done", exact: true }).click();
  await guest.page.getByRole("button", { name: "Done", exact: true }).click();
  await Promise.all(
    [host, guest].map(async (run) => {
      await run.page.getByRole("dialog").waitFor({ state: "hidden" });
      await run.page.waitForTimeout(500);
    }),
  );
  await Promise.all([host.clickGame(720, 305), guest.clickGame(720, 305)]);
  await Promise.all([waitForLog(host, "open 0xBB"), waitForLog(guest, "open 0xBB")]);
  await host.shot("lan-host-lobby");
  await guest.shot("lan-guest-lobby");

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
  await guest.clickGame(500, 103); // select the host's game (row 1)
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
  await waitForLog(host, "BrowserGuest,9,", 90000);
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
  console.log(
    "PASS: two clients paired over WebRTC, exchanged lobby IPX, and entered the same LAN match.",
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
