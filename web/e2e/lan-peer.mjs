// Browser-level WebRTC test without loading the game: two real peers exchange
// the same SDP strings the LAN panel copies, then pass binary datagrams.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const url =
  process.argv.find((arg) => arg.startsWith("http://") || arg.startsWith("https://")) ??
  "http://127.0.0.1:5173/";
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const leftBrowser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
let rightBrowser;

try {
  rightBrowser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
  const left = await leftBrowser.newPage();
  const right = await rightBrowser.newPage();
  await Promise.all([left.goto(url), right.goto(url)]);

  const createPeer = () =>
    import("/src/game/lan.ts").then(({ LanPeer }) => {
      globalThis.__lanPackets = [];
      globalThis.__lanStatus = "idle";
      globalThis.__lanPeer = new LanPeer(
        (status) => {
          globalThis.__lanStatus = status;
        },
        (packet) => {
          globalThis.__lanPackets.push([...packet]);
        },
      );
    });
  await Promise.all([left.evaluate(createPeer), right.evaluate(createPeer)]);

  const offer = await left.evaluate(() => globalThis.__lanPeer.createOffer());
  const answer = await right.evaluate((text) => globalThis.__lanPeer.answerOffer(text), offer);
  await left.evaluate((text) => globalThis.__lanPeer.acceptAnswer(text), answer);
  const connected = (page) =>
    page.waitForFunction(() => globalThis.__lanStatus === "connected", null, { timeout: 45000 });
  await Promise.all([connected(left), connected(right)]);

  const first = [0, 4, 0, 7, 9, 8];
  assert.equal(
    await left.evaluate((packet) => globalThis.__lanPeer.send(new Uint8Array(packet)), first),
    true,
  );
  await right.waitForFunction(
    (packet) => JSON.stringify(globalThis.__lanPackets[0]) === JSON.stringify(packet),
    first,
  );
  const second = [0, 7, 0, 4, 6, 5];
  assert.equal(
    await right.evaluate((packet) => globalThis.__lanPeer.send(new Uint8Array(packet)), second),
    true,
  );
  await left.waitForFunction(
    (packet) => JSON.stringify(globalThis.__lanPackets[0]) === JSON.stringify(packet),
    second,
  );
  console.log("PASS: two browser LanPeer clients connected and exchanged binary IPX datagrams.");
} finally {
  await leftBrowser.close();
  await rightBrowser?.close();
}
