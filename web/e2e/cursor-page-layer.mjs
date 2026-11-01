// ?cursor=page wiring in a real browser, without needing the game files to fit
// the page's memory (the dev path copies the whole install into wasm memory,
// which this tree's 1 GB can't): the Play screen mounts the cursor layer as soon
// as it renders, and the shared words are read from a live module when one
// boots. Prints what it found and exits 0 if the flag wired the layer.
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://127.0.0.1:5173/?dev=1&cursor=page&edition=ra2md";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 960 },
  serviceWorkers: "block",
});
const console_ = [];
page.on("console", (m) => console_.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => console_.push(`[pageerror] ${e.message}`));
await page.goto(url);
// The Play screen is the one with a canvas; the layer is the aria-hidden one.
await page.waitForSelector("canvas", { timeout: 120000 });
await page.waitForTimeout(5000);
const found = await page.evaluate(() => {
  const canvases = [...document.querySelectorAll("canvas")].map((c) => ({
    ariaHidden: c.getAttribute("aria-hidden"),
    display: c.style.display,
    cursor: c.style.cursor,
  }));
  return { canvases, log: console.log.length };
});
const flag = console_.find((line) => line.includes("the page draws the in-match cursor"));
console.log("canvases:", JSON.stringify(found.canvases));
console.log("flag line:", flag ?? "(not yet: the game has not started)");
console.log("console tail:", console_.slice(-6).join(" | "));
await browser.close();
const layer = found.canvases.some((c) => c.ariaHidden === "true" && c.display === "block");
process.exit(layer ? 0 : 1);
