// Original in-game WOL Custom Match smoke check, against local RA2Web on :19090.
// Run from web/: node e2e/wol.mjs --url 'http://localhost:5173/?target=game'
// Add --two for a second native client, --start for the handoff, or --interactive.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { startPage, options } from "./lib.mjs";

const opts = options(process.argv.slice(2));
opts.pageArgs.push("--mute", "--debuglog");
const ra2 = new URL(opts.url).searchParams.get("target") === "game";
const lobby = `#Lob_${ra2 ? 33 : 41}_0`;
const wrongPassword = process.argv.includes("--wrong-password");
const abortStart = process.argv.includes("--abort");
const partRace = process.argv.includes("--part-race");
const finish = process.argv.includes("--finish");
const play = process.argv.includes("--play") || partRace || finish;
const roomPassword = process.argv.includes("--password") || wrongPassword ? "pocpass" : null;
const clients = {};
const redact = (value) =>
  String(value)
    .replace(/session \S+/gi, "session [redacted]")
    .replace(/\bticket \S+/gi, "ticket [redacted]")
    .replace(/(STARTG .+? :.+? :\S+ \d+) \S+/g, "$1 [redacted]")
    .replace(/(joingame\s+#\S+\s+1\s+\d+\s+\d+(?:\s+\d+){4})\s+\S+/gi, "$1 [redacted]")
    .replace(/(joingame\s+#\S+\s+0)\s+\S+/gi, "$1 [redacted]");
const wirePayload = (payload) =>
  typeof payload === "string" ? redact(payload) : `[datagram ${payload.byteLength} bytes]`;
async function waitNative(run, text, after = 0) {
  const deadline = Date.now() + 20000;
  while (!run.all.slice(after).some((l) => l.includes(text))) {
    assert.ok(Date.now() < deadline, `timed out waiting for native ${text}`);
    await run.page.waitForTimeout(100);
  }
}
async function waitWire(run, match, label) {
  const deadline = Date.now() + 15000;
  while (!run.wire.some(match)) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${label}`);
    await run.page.waitForTimeout(100);
  }
}

function simulationFrame(run) {
  const last = run.all.findLast((line) => /\[record\].* game frame \d+/.test(line));
  return Number(/ game frame (\d+)/.exec(last ?? "")?.[1] ?? 0);
}

async function verifyPlaying(host, guest) {
  const deadline = Date.now() + 120000;
  while ([host, guest].some((run) => simulationFrame(run) < 300)) {
    assert.ok(
      ![host, guest].some((run) =>
        run.all.some((line) => line.includes("Negotiate_Scenario_Transfer failed")),
      ),
      "native scenario negotiation must succeed",
    );
    assert.ok(
      Date.now() < deadline,
      "both simulations must leave the loading wait and reach frame 300",
    );
    await host.page.waitForTimeout(250);
  }
  const before = [host, guest].map(simulationFrame);
  await host.page.waitForTimeout(5000);
  for (const [index, run] of [host, guest].entries()) {
    assert.ok(
      simulationFrame(run) > before[index] + 60,
      "simulation keeps advancing with its remote peer",
    );
    assert.ok(
      run.all.some((line) => line.includes("Received FRAMESYNC")),
      "native connection receives frame synchronization",
    );
  }
  const sizes = (await Promise.all([host, guest].map((run) => run.state()))).map(
    (state) => state?.size,
  );
  console.log(
    "PLAYING",
    JSON.stringify({ before, after: [host, guest].map(simulationFrame), sizes }),
  );
  // --expect-size 1920x1080: the online resolution clamp (docs/ra2-resolution-plan.md, step 3)
  const expectAt = process.argv.indexOf("--expect-size");
  if (expectAt > 0) {
    // "WxH" for both clients, or "WxH,WxH" for the host then the guest
    const wanted = process.argv[expectAt + 1].split(",").map((size) => {
      const [w, h] = size.split("x").map(Number);
      return { w, h };
    });
    assert.deepEqual(
      sizes,
      wanted.length === 1 ? [wanted[0], wanted[0]] : wanted,
      `clients play at ${process.argv[expectAt + 1]}`,
    );
  }
  await dump("host", "playing");
  await dump("guest", "playing");
}

async function finishYuriMatch(host, guest) {
  assert.ok(!ra2, "--finish currently drives the YR native quit-menu fixture");
  assert.deepEqual(
    (await guest.state()).size,
    { w: 640, h: 480 },
    "quit-menu fixture uses the confirmed legacy guest mode",
  );
  const guestBefore = guest.wire.length;
  const hostBefore = host.wire.length;
  const guestNativeBefore = guest.all.length;
  const hostNativeBefore = host.all.length;
  await guest.page.evaluate(() => {
    document.exitPointerLock();
    document.querySelector("canvas").requestPointerLock = () => Promise.resolve();
  });
  await guest.page.keyboard.press("Escape");
  await waitNative(guest, "[dialog] open 0xFF");
  await guest.page.waitForTimeout(1500); // Native menu animation/control initialization.
  await dump("guest", "abort-menu");
  await guest.clickGame(555, 265); // Abort Mission, then Quit rather than Observe.
  await guest.page.waitForTimeout(1000);
  await dump("guest", "abort-choice");
  await guest.clickGame(555, 239);
  await waitNative(host, "MPlayer_Defeated() - Opponent woltst2 has been defeated");
  const returned = (name, after) => (line, index) =>
    index >= after && line.includes(`:${name}!`) && line.includes(" JOIN ") && line.includes(lobby);
  await waitWire(
    guest,
    returned("woltst2", guestBefore),
    "guest returns to WOL lobby after quitting",
  );
  await waitNative(guest, "Joined Channel", guestNativeBefore);
  await waitNative(host, "Disconnect_Gracefully");
  await host.page.waitForTimeout(3000);
  await dump("host", "victory-score");
  await host.clickGame(720, 557); // Continue from the native 800x600 score screen.
  await waitWire(host, returned("woltst1", hostBefore), "winner returns to WOL lobby");
  await waitNative(host, "Joined Channel", hostNativeBefore);
  for (const run of [host, guest]) {
    const deadline = Date.now() + 10000;
    while (await run.page.evaluate(() => window.wolTestRelaySocket.readyState !== 3)) {
      assert.ok(Date.now() < deadline, "returning to lobby must close the finished gameplay relay");
      await run.page.waitForTimeout(100);
    }
    assert.equal(
      await run.page.evaluate(() =>
        window.Module.cwrap("ra2_wolapi_current_session", "number", [])(),
      ),
      0,
    );
  }
  await host.page.waitForTimeout(1000); // Allow the returning native lobby to paint.
  await dump("host", "match-finished");
  await dump("guest", "match-finished");
}

async function dump(name, shot) {
  const run = clients[name];
  await run.shot(shot);
  writeFileSync(`${opts.shots}/${name}/game.log`, run.all.join("\n"));
  writeFileSync(`${opts.shots}/${name}/wire.log`, run.wire.join("\n"));
  writeFileSync(`${opts.shots}/${name}/browser.log`, run.lines.join("\n"));
  console.log(name, shot, JSON.stringify(await run.state()), run.wire.slice(-3));
}

async function interact() {
  console.log("READY");
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    const a = JSON.parse(line),
      name = a.client ?? "host",
      run = clients[name];
    if (a.quit) {
      input.close();
      break;
    }
    if (a.click) await run.clickGame(...a.click);
    if (a.key) await run.page.keyboard.press(a.key);
    if (a.type) await run.page.keyboard.type(a.type, { delay: 50 });
    if (a.eval) console.log(await run.page.evaluate(a.eval));
    if (a.read)
      console.log(
        await run.page.evaluate(
          (addrs) => addrs.map((at) => [at, window.Module.HEAPU32[at / 4]]),
          a.read,
        ),
      );
    await run.page.waitForTimeout(a.wait ?? 700);
    await dump(name, a.shot ?? "current");
  }
}

async function enterRoomPassword(run, password) {
  await run.clickGame(400, 299);
  await run.page.keyboard.press("End");
  for (let i = 0; i < 12; i++) await run.page.keyboard.press("Backspace");
  await run.page.keyboard.type(password, { delay: 100 });
  await run.page.waitForTimeout(250); // Let queued native characters land before changing focus.
  const after = run.all.length;
  await run.clickGame(310, 414);
  return after;
}

async function open(name, username) {
  const run = await startPage({ ...opts, shots: `${opts.shots}/${name}` });
  clients[name] = run;
  await run.page.evaluate(() => {
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(url, protocols) {
        super(url, protocols);
        if (String(url).includes("127.0.0.1:19090")) window.wolTestSocket = this;
        if (String(url).endsWith("/gserv/native")) window.wolTestRelaySocket = this;
      }
    };
  });
  run.wire = [];
  run.page.on("websocket", (ws) => {
    if (!ws.url().includes("127.0.0.1:19090")) return;
    ws.on("framesent", (f) => run.wire.push("> " + wirePayload(f.payload)));
    ws.on("framereceived", (f) => run.wire.push("< " + wirePayload(f.payload)));
    ws.on("close", () => run.wire.push("[closed]"));
  });
  await run.waitFor(name + " main menu", (s) => s?.phase === "running", 180);
  assert.deepEqual(
    (await run.state()).size,
    { w: 800, h: 600 },
    "menu coordinates require 800x600",
  );
  await run.page.waitForTimeout(1000);
  await run.clickGame(720, 263);
  await waitNative(run, "[dialog] open 0x10E");
  await run.page.waitForTimeout(800);
  await run.clickGame(720, ra2 ? 263 : 305);
  await waitNative(run, "[dialog] open 0x10F");
  await run.page.waitForTimeout(1200);
  for (const [y, text] of [
    [ra2 ? 167 : 250, username],
    [ra2 ? 205 : 300, process.env.WOL_TEST_PASSWORD ?? "wolpass1"],
  ]) {
    await run.clickGame(388, y);
    await run.page.keyboard.press("End");
    for (let i = 0; i < 12; i++) await run.page.keyboard.press("Backspace");
    await run.page.keyboard.type(text, { delay: 100 });
    await run.page.waitForTimeout(250);
  }
  await run.clickGame(720, 220);
  await waitNative(run, "Joined Channel");
  const joinedAt = run.wire.findIndex((l) => l.includes(" JOIN ") && l.includes(lobby));
  await waitWire(run, (l, index) => index > joinedAt && l.includes(" 323 "), "post-join game list");
  await run.page.waitForTimeout(400);
  assert.ok(
    run.wire.some((l) => l.includes(`JOIN :`) && l.includes(lobby)),
    "joins edition lobby",
  );
  assert.ok(
    run.wire.some((l) => l.includes(`:${username}!`) && l.includes(" JOIN ") && l.includes(lobby)),
    "login uses the complete typed nickname",
  );
  await dump(name, "lobby");
  return run;
}

try {
  const host = await open("host", "woltst1");
  // --room-flags 0x400: publish the room's resolution bit as the server would
  // relay it to the guest (the first WOLAPI2 number, the room's reserved field
  // at [room + 0x20], which the join check reads). YR now treats either
  // resolution bit as the 1920x1080 cap; 0x400 is what a host that ticked
  // "Limit screen resolution" publishes. The game itself only sets the bit
  // from that option, so the test sets it on the wire.
  const flagsAt = process.argv.indexOf("--room-flags");
  if (flagsAt > 0) {
    const flags = Number(process.argv[flagsAt + 1]);
    await host.page.evaluate((flags) => {
      const send = window.Module.ra2WolSend;
      window.Module.ra2WolSend = (line) =>
        send(
          line.replace(
            /WOLAPI2:(\d+),(\d+),(\d+),(\d+);/,
            (all, a, b, c, d) => `WOLAPI2:${((Number(a) & ~0x600) | flags) >>> 0},${b},${c},${d};`,
          ),
        );
    }, flags);
  }
  if (process.argv.includes("--disconnect")) {
    const after = host.all.length;
    await host.page.evaluate(() => window.wolTestSocket.close());
    await waitNative(host, "NetStatus disconnect not in game", after);
    await host.page.waitForTimeout(700);
    await dump("host", "disconnected");
  } else if (
    process.argv.includes("--two") ||
    process.argv.includes("--start") ||
    play ||
    abortStart ||
    process.argv.includes("--chat") ||
    roomPassword
  ) {
    await host.clickGame(720, 220);
    await waitNative(host, "[dialog] open 0xC3");
    await host.page.waitForTimeout(700);
    await dump("host", "create-dialog");
    if (roomPassword) {
      await host.clickGame(480, 222);
      await host.page.keyboard.type(roomPassword, { delay: 100 });
      await host.page.waitForTimeout(250);
    }
    await host.clickGame(283, ra2 ? 377 : 357);
    await waitWire(host, (l) => l.startsWith("> joingame "), "native room creation");
    await host.page.waitForTimeout(1500);
    await dump("host", "created");
    assert.ok(
      host.wire.some((l) => l.startsWith("> joingame ")),
      "native Create Game sends JOINGAME",
    );
    const guest = await open("guest", "woltst2");
    await waitWire(
      guest,
      (l) => l.includes(" 322 ") && l.includes("#woltst1's_game"),
      "host room listing",
    );
    await guest.page.waitForTimeout(300);
    await guest.clickGame(150, ra2 ? 47 : 65);
    await guest.clickGame(720, 263);
    // A limited YR room (the option on, or --room-flags 0x200/0x400) prompts a
    // guest configured above 1920x1080; accepting stores that size. A room
    // without the limit publishes no flag and never prompts.
    const roomFlags = flagsAt > 0 ? Number(process.argv[flagsAt + 1]) : 0;
    if (!ra2 && roomFlags & 0x600) {
      const guestWidth = await guest.page.evaluate(() => window.Module.HEAPU32[0xa8eb84 / 4]);
      if (guestWidth > 1920) {
        await waitNative(guest, "[dialog] open 0xFB");
        await guest.page.waitForTimeout(500);
        await dump("guest", "resolution-confirm");
        await guest.clickGame(711, 241); // Yes: store 1920x1080.
        let stored = [];
        for (let i = 0; i < 15; i++) {
          stored = await guest.page.evaluate(() => [
            window.Module.HEAPU32[0xa8eb84 / 4],
            window.Module.HEAPU32[0xa8eb88 / 4],
          ]);
          if (stored[0] === 1920) break;
          await guest.page.waitForTimeout(200);
        }
        assert.deepEqual(stored, [1920, 1080], "accepting stores 1920x1080");
      }
    }
    if (roomPassword) {
      await waitNative(guest, "[dialog] open 0xE1");
      await guest.page.waitForTimeout(500);
      await dump("guest", "password-prompt");
      if (wrongPassword) {
        const after = await enterRoomPassword(guest, "wrong");
        await waitWire(guest, (l) => l.includes(" 475 "), "bad-password rejection");
        await waitNative(guest, "[dialog] open 0xD0", after);
        await dump("guest", "bad-password");
        const retryWire = guest.wire.length;
        await guest.clickGame(545, 434); // Acknowledge the native bad-password message.
        await waitWire(
          guest,
          (l, i) => i >= retryWire && l.includes(" 323 "),
          "lobby recovery after bad password",
        );
        await guest.page.waitForTimeout(300);
        const retryNative = guest.all.length;
        await guest.clickGame(150, ra2 ? 47 : 65);
        await guest.clickGame(720, 263);
        await waitNative(guest, "[dialog] open 0xE1", retryNative);
        await guest.page.waitForTimeout(300);
      }
      await enterRoomPassword(guest, roomPassword);
    }
    await waitWire(guest, (l) => l.startsWith("> joingame "), "native room join");
    await waitWire(
      guest,
      (l) => l.includes(":woltst2!") && l.includes(" JOINGAME "),
      "native join acknowledgement",
    );
    await waitWire(
      guest,
      (l) => l.includes(":woltst1!") && l.includes(" GAMEOPT "),
      "host setup options",
    );
    await guest.page.waitForTimeout(2500);
    assert.ok(
      guest.wire.some((l) => l.includes(":woltst2!") && l.includes(" JOINGAME ")),
      "second player receives join acknowledgement",
    );
    assert.ok(
      guest.wire.some((l) => l.includes(":woltst1!") && l.includes(" GAMEOPT ")),
      "second player receives host game options",
    );
    const metadata = /WOLAPI2:(\d+),(\d+),(\d+),(\d+);/.exec(
      host.wire.filter((l) => l.includes("WOLAPI2:")).at(-1),
    );
    assert.ok(metadata, "host publishes native channel metadata");
    const nativeChannel = await guest.page.evaluate(
      (at) => {
        const h = window.Module.HEAPU32;
        return [h[(at + 32) / 4], h[(at + 4) / 4], h[(at + 8) / 4], h[(at + 28) / 4]];
      },
      ra2 ? 0xb299c0 : 0xb76b10,
    );
    const expectedChannel = metadata.slice(1).map(Number);
    if (roomPassword) expectedChannel[3] |= 384; // Password/private LIST mode comes from the server.
    assert.deepEqual(
      nativeChannel,
      expectedChannel,
      "native join preserves room flags, resolution and capacity",
    );
    if (ra2) {
      // The size the game will open the match at (RA2.INI's, or what the join check clamped it to).
      const matchSize = (run) =>
        run.page.evaluate(() => [
          window.Module.HEAPU32[0xa40b38 / 4],
          window.Module.HEAPU32[0xa40b3c / 4],
        ]);
      console.log(
        "MATCH SIZE after join",
        JSON.stringify({ host: await matchSize(host), guest: await matchSize(guest) }),
      );
    }
    await dump("guest", "join-result");
    await dump("host", "two-players");
    if (process.argv.includes("--chat")) {
      for (const [sender, receiver, text] of [
        [host, guest, "hello from host"],
        [guest, host, "hello from guest"],
      ]) {
        await sender.clickGame(240, ra2 ? 493 : 548); // Native setup-screen chat edit.
        await sender.page.keyboard.type(text, { delay: 100 });
        await sender.page.waitForTimeout(250);
        await sender.page.keyboard.press("Enter");
        await waitWire(
          sender,
          (l) => l.startsWith("> privmsg ") && l.trimEnd().endsWith(` :${text}`),
          "native outgoing chat",
        );
        await waitWire(
          receiver,
          (l) => l.includes(" PRIVMSG ") && l.trimEnd().endsWith(` :${text}`),
          "relayed chat",
        );
      }
      await host.page.waitForTimeout(500);
      await guest.page.waitForTimeout(500);
      await dump("host", "chat");
      await dump("guest", "chat");
    }
    if (process.argv.includes("--start") || play || abortStart) {
      const options = (line) => /^> gameopt #[^ ]+ :(\d+,.*)/s.exec(line)?.[1];
      const before = host.wire.map(options).filter(Boolean).at(-1);
      await host.clickGame(ra2 ? 140 : 80, ra2 ? 305 : 261); // Short Game
      await waitWire(host, (l) => options(l) && options(l) !== before, "host option change");
      const changed = host.wire.map(options).filter(Boolean).at(-1);
      await waitWire(
        guest,
        (l) => l.includes(" GAMEOPT ") && l.endsWith(` :${changed}`),
        "guest option sync",
      );
      await dump("guest", "options-synced");
      await guest.clickGame(720, 263); // Accept
      await waitWire(
        host,
        (l) => l.includes(":woltst2!") && l.includes(" GAMEOPT ") && l.includes(" :A1"),
        "guest acceptance",
      );
      if (abortStart)
        await host.page.evaluate(() => {
          const send = window.Module.ra2WolSend;
          window.Module.ra2WolSend = (line) =>
            send(line.startsWith("startg ") ? `${line},missing` : line);
        });
      await host.clickGame(720, 263); // Start Game
      if (abortStart) {
        await waitWire(host, (l) => l.includes(" STARTG_ABORT "), "rejected start");
        await host.page.waitForTimeout(700);
        // The native failed callback returns before its success-only OnGameStart log.
        const pending = await host.page.evaluate(
          ([byte, word]) => [window.Module.HEAPU8[byte], window.Module.HEAPU32[word / 4]],
          ra2 ? [0xb2ac04, 0xb2ac40] : [0xb77dec, 0xb77e28],
        );
        assert.deepEqual(pending, [0, 0], "native failed callback clears the pending-start fields");
        assert.equal(
          await host.page.evaluate(() =>
            window.Module.cwrap("ra2_wolapi_current_session", "number", [])(),
          ),
          0,
        );
        assert.ok(
          !guest.wire.some((l) => l.includes(" STARTG ")),
          "guest does not receive a successful handoff",
        );
        await host.page.waitForTimeout(1000);
        await dump("host", "start-aborted");
      } else {
        for (const run of [host, guest]) {
          await waitWire(run, (l) => l.includes(" STARTG "), "player start ticket");
          await waitNative(run, "OnGameStart");
        }
        if (partRace) {
          const room = / STARTG (\S+)/.exec(
            guest.wire.find((line) => line.includes(" STARTG ")),
          )[1];
          // Reproduce the real ordering: the WOL host leaves before the guest's
          // UDP NET_GO is handled. This must not erase the host used to validate it.
          await guest.page.evaluate((room) => {
            window.Module.ra2WolReceiveLine(`:woltst1!local PART ${room}`);
            window.Module.ra2WolReceiveLine(`:wol-ra2web 353 woltst2 = ${room} :woltst2,0,1,1`);
          }, room);
        }
        const handoff = (run) =>
          / STARTG (\S+) :(\S+) :(\S+) (\d+)/
            .exec(run.wire.find((l) => l.includes(" STARTG ")))
            .slice(1);
        assert.deepEqual(
          handoff(host),
          handoff(guest),
          "players receive the same room, gserv, game ID and timestamp",
        );
        const requested = host.wire
          .find((l) => l.startsWith("> startg "))
          .trim()
          .split(" ")[3]
          .split(",")
          .sort();
        assert.deepEqual(
          requested,
          ["woltst1", "woltst2"],
          "native start includes both players in the game-supplied order",
        );
        const expectedId = Number(/^g(\d+)-/.exec(handoff(host)[2])[1]);
        for (const run of [host, guest]) {
          // OnGameStart stores its game-ID argument here in the supported binaries.
          const nativeId = await run.page.evaluate(
            (at) => window.Module.HEAPU32[at / 4],
            ra2 ? 0xb2a7fc : 0xb779d4,
          );
          assert.equal(nativeId, expectedId, "native callback consumes the server instance number");
          const session = await run.page.evaluate(() => {
            const module = window.Module;
            const at = module.cwrap("ra2_wolapi_current_session", "number", [])();
            if (!at) return null;
            const text = (offset, size) =>
              String.fromCharCode(...module.HEAPU8.slice(at + offset, at + offset + size)).split(
                "\0",
              )[0];
            return {
              room: text(0, 48),
              url: text(48, 256),
              id: text(304, 64),
              hasTicket: text(368, 128).length > 0,
              timestamp: module.HEAPU32[(at + 496) / 4],
              number: module.HEAPU32[(at + 500) / 4],
            };
          });
          assert.deepEqual(
            session,
            {
              room: handoff(run)[0],
              url: handoff(run)[1],
              id: handoff(run)[2],
              hasTicket: true,
              timestamp: Number(handoff(run)[3]),
              number: expectedId,
            },
            "full authenticated handoff survives in game memory",
          );
        }
        await dump("host", "start-handoff");
        await dump("guest", "start-handoff");
        if (play) await verifyPlaying(host, guest);
        if (finish) await finishYuriMatch(host, guest);
        // --hold <seconds> keeps both clients running after the handoff, to watch the match load and play.
        const holdAt = process.argv.indexOf("--hold");
        if (holdAt > 0) {
          const hold = Number(process.argv[holdAt + 1]) || 30;
          for (let waited = 0; waited < hold; waited += 10) {
            await host.page.waitForTimeout(Math.min(10, hold - waited) * 1000);
            await dump("host", `hold-${waited + 10}`);
            await dump("guest", `hold-${waited + 10}`);
          }
        }
      }
    }
  } else {
    await host.clickGame(720, 557);
    await host.page.waitForTimeout(1500);
    await dump("host", "online-hub");
    await host.clickGame(720, 557);
    await host.page.waitForTimeout(1500);
    await dump("host", "logged-out");
    assert.ok(host.wire.includes("[closed]"), "Main Menu closes the WOL connection");
  }
  console.log(play ? "WOL native gameplay check passed" : "WOL native menu smoke check passed");
  if (process.argv.includes("--interactive")) await interact();
} catch (error) {
  console.error(error);
  for (const name of Object.keys(clients)) await dump(name, "failure").catch(() => {});
  process.exitCode = 1;
  if (process.argv.includes("--interactive")) await interact();
} finally {
  await Promise.race([
    Promise.all(Object.values(clients).map((run) => run.browser.close())),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  process.exit(process.exitCode ?? 0);
}
