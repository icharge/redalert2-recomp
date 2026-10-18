// W6.3: a big file copies into the real origin-private file system without its bytes sitting in memory.
//
//   node e2e/opfs.mjs [--mb 300]
//
// Streams that many megabytes of generated data through copyInstall (src/storage/opfs.ts) into OPFS in
// Chrome, watching the JS heap, then checks the size and removes the file. Needs `pnpm dev` running.
import { chromium } from "playwright-core";
import { options } from "./lib.mjs";

const argv = process.argv.slice(2);
const mb = Number(argv[argv.indexOf("--mb") + 1] || 300);
const base = options(argv);
const browser = await chromium.launch({
  executablePath: base.chrome,
  headless: !base.headed,
  args: ["--no-sandbox", "--enable-precise-memory-info"],
});
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto(base.url);

let peakLive = 0;
let sampling = true;
const live = async () => {
  await cdp.send("HeapProfiler.collectGarbage");
  return (await cdp.send("Runtime.getHeapUsage")).usedSize;
};
const baseline = await live();
const sampler = (async () => {
  while (sampling) {
    peakLive = Math.max(peakLive, await live());
    await new Promise((r) => setTimeout(r, 30));
  }
})();
const result = await page.evaluate(async (megabytes) => {
  const { copyInstall, opfsTarget } = await import("/src/storage/opfs.ts");
  const root = await navigator.storage.getDirectory();
  const probe = await root.getDirectoryHandle("e2e-opfs", { create: true });
  const target = opfsTarget(Promise.resolve(probe));
  const size = megabytes * 1024 * 1024;
  const chunk = new Uint8Array(1024 * 1024).fill(7);
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= size) return controller.close();
      controller.enqueue(chunk.slice());
      sent += chunk.length;
    },
  });
  const began = performance.now();
  await copyInstall({
    jobs: [
      {
        name: "big.bin",
        size,
        lastModified: 1,
        needs: ["ra2md"],
        home: "ra2md",
        open: () => stream,
      },
    ],
    target,
    markDone: async () => {},
  });
  const seconds = (performance.now() - began) / 1000;
  const written = await target.size("game/ra2md/big.bin");
  await root.removeEntry("e2e-opfs", { recursive: true });
  return { size, written, seconds };
}, mb);
sampling = false;
await sampler;
result.growthMb = (peakLive - baseline) / 1048576;

console.log(
  `${mb} MB: wrote ${result.written === result.size ? "all of it" : `${result.written} bytes of ${result.size}`} ` +
    `in ${result.seconds.toFixed(1)} s (${(mb / result.seconds).toFixed(0)} MB/s); the live JS heap (after a forced collection) grew at most ${result.growthMb.toFixed(1)} MB`,
);
await browser.close();
if (result.written !== result.size || result.growthMb > mb / 5) {
  console.error("FAIL: the copy is incomplete, or it held too much in memory");
  process.exit(1);
}
