// One focused, real-browser check for the throwaway content POC.
// Start internet-content.mjs, then run from web/: node e2e/internet-content-check.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.INTERNET_POC_URL ?? "http://127.0.0.1:5180/";
const shots = path.resolve("../build-web/internet-content-poc");
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto(base);
  await page.waitForFunction(() =>
    document.getElementById("request-status").textContent.includes("JSON loaded"),
  );
  assert.equal(
    await page.evaluate(() => crossOriginIsolated),
    true,
    "same isolation headers as the game",
  );
  assert.equal(await page.locator(".post").count(), 3);
  assert.ok(requests.includes("/news.json"), "content was fetched as a separate file");
  await page.screenshot({ path: path.join(shots, "json.png"), fullPage: true });

  await page.locator("#slow").click();
  assert.equal(await page.locator("#news-panel").getAttribute("aria-busy"), "true");
  assert.equal(await page.locator(".post").count(), 3, "cached news stays visible during refresh");
  await page.screenshot({ path: path.join(shots, "loading.png"), fullPage: true });
  await page.waitForFunction(
    () => document.getElementById("news-panel").getAttribute("aria-busy") === "false",
  );
  await page.locator("#fail").click();
  await page.waitForFunction(() =>
    document.getElementById("request-status").textContent.includes("HTTP 503"),
  );
  assert.equal(await page.locator(".post").count(), 3, "failed refresh keeps loaded posts");

  await page.locator("#format").selectOption("html");
  await page.waitForFunction(() =>
    document.getElementById("request-status").textContent.includes("HTML loaded"),
  );
  const html = page.frameLocator("#html-frame");
  await html.locator("h1").waitFor();
  assert.match(await html.locator("h1").textContent(), /A live page/);
  assert.equal(await page.locator("#html-frame").getAttribute("sandbox"), "");
  assert.ok(requests.includes("/news.html"));
  await page.screenshot({ path: path.join(shots, "html.png"), fullPage: true });

  // Fetched HTML stays a read-only document, including under real isolation headers.
  await page.route("**/news.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<h1>Read-only announcement</h1><script>parent.pocInjected = true</script><a href="https://example.com">Link</a><meta http-equiv="refresh" content="0;url=https://example.com">',
    }),
  );
  await page.locator("#load").click();
  await html.locator("h1", { hasText: "Read-only announcement" }).waitFor();
  assert.equal(await html.locator("script, meta[http-equiv=refresh], a[href]").count(), 0);
  assert.equal(await page.evaluate(() => globalThis.pocInjected), undefined);
  await page.unroute("**/news.html");

  // A new source's failure has no cached content and displays an unavailable state.
  await page.locator("#source").fill(new URL("missing.json", base).href);
  await page.locator("#load").click();
  await page.waitForFunction(() =>
    document.getElementById("request-status").textContent.includes("HTTP 404"),
  );
  assert.equal(
    await page.locator("#news-status").textContent(),
    "The news is unavailable right now.",
  );
  await page.screenshot({ path: path.join(shots, "unavailable.png"), fullPage: true });

  await page.locator("#format").selectOption("json");
  await page.waitForFunction(() =>
    document.getElementById("request-status").textContent.includes("JSON loaded"),
  );
  await page.locator("#slow").click();
  await page.locator("#close").click();
  assert.equal(await page.locator("#news-panel").isVisible(), false);
  await page.locator("#return").click();
  await page.waitForFunction(() =>
    document.getElementById("request-status").textContent.includes("JSON loaded"),
  );
  assert.equal(await page.locator("#news-panel").isVisible(), true);

  await page.setViewportSize({ width: 430, height: 900 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  await page.screenshot({ path: path.join(shots, "narrow.png"), fullPage: true });
  assert.deepEqual(errors, [], "no browser runtime exceptions");
  console.log(
    "PASS: JSON and HTML HTTP loads, loading/cached failure, sandbox, unavailable, leave/return, narrow layout.",
  );
  console.log(`Screenshots: ${shots}`);
} finally {
  await browser.close();
}
