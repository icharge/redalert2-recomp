// A WOL-era link opens our dialog instead of the system browser.
//
// The main menu's Internet button reaches the WOL welcome dialog without a
// server: YR's YuriWebSite (1375) reads the registry, RA2's My Information
// (0x10E:1764) leads to Manage Account (0x114:1772). The lift intercepts the
// routine before FindExecutableA, so the page's `open` event is the proof.
//
// Start Vite first (cd web && pnpm dev), then:
//   node e2e/links.mjs --url 'http://127.0.0.1:5173/?target=yuri' \
//                      --edition ra2md --game ../game
//   node e2e/links.mjs --url 'http://127.0.0.1:5173/?target=game' \
//                      --edition ra2 --game ../game
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { options, startPage } from "./lib.mjs";
import { openGame } from "./perf-nav.mjs";

const opts = options(process.argv.slice(2));
if (!opts.testGame && !opts.profile)
  throw new Error("Pass --game <local game folder> or --profile <imported profile>.");
const ra2 = new URL(opts.url).searchParams.get("target") === "game";
// Reaching the link: the WOL welcome, then the button that reads a URL.
const pathArgs = ra2
  ? ["0xE2:1668@1", "0x10E:1764@3", "0x114:1772@5"]
  : ["0xE2:1668@1", "0x10E:1375@3"];
opts.pageArgs.push("--mute", "--debuglog");
for (const press of pathArgs) opts.pageArgs.push("--press", press);

const expected = ra2
  ? { title: "Manage account", url: /^https?:\/\/games2\.westwood\.com\// }
  : { title: "Community", url: /^http:\/\/westwood\.ea\.com\/games\/ccuniverse\/redalert2\// };

const run = opts.testGame ? await startPage(opts) : await openGame(opts, { shots: opts.shots });
const report = { edition: ra2 ? "ra2" : "gamemd" };

try {
  await run.waitFor("main menu", (state) => state?.phase === "running");
  await run.page.waitForFunction(() => window.ra2Store?.getSnapshot().openLink !== null, null, {
    timeout: 90_000,
  });
  const link = await run.page.evaluate(() => window.ra2Store.getSnapshot().openLink);
  assert.ok(link?.seq, "the open event must carry a sequence");
  if (expected.page) {
    // YR's DoWebPageDialog passes a page key, not a URL: the event names the
    // page and leaves url empty instead of inventing the registry sentinel.
    assert.equal(link.page, expected.page);
    assert.equal(link.url, "");
    report.page = link.page;
    assert.ok(
      run.all.some((line) => line === `[page] ${link.page}`),
      "the host must log the page key",
    );
  } else {
    assert.match(link.url, expected.url);
    report.url = link.url;
    // The host logs the URL it received, unchanged, before the event.
    assert.ok(
      run.all.some((line) => line === `[url] ${link.url}`),
      "the host must log the original URL",
    );
  }
  assert.ok(
    !run.all.some((line) => line.includes("TXT_NOBROWSER")),
    "the game must never reach its no-browser message",
  );

  const heading = run.page.getByRole("heading", { name: expected.title });
  await heading.waitFor({ timeout: 10_000 });
  const shown = link.page ? `${link.page} page` : link.url;
  await run.page.getByText(shown, { exact: true }).waitFor({ timeout: 5_000 });
  report.topic = expected.title;

  // An embeddable target (VITE_RA2WEB_SITE_URL set) renders the sandboxed
  // iframe; without it, the confirmation has no outbound link for a dead host.
  const frame = run.page.locator("iframe");
  report.framed = (await frame.count()) > 0;
  if (report.framed) {
    report.frameSrc = await frame.getAttribute("src");
    assert.equal(
      await frame.getAttribute("sandbox"),
      "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox",
    );
    assert.equal(await frame.getAttribute("referrerpolicy"), "no-referrer");
  }

  const outbound = run.page.getByRole("link", { name: "Open in browser" });
  report.outbound = (await outbound.count()) > 0 ? await outbound.getAttribute("href") : null;
  if (report.outbound) {
    assert.equal(await outbound.getAttribute("target"), "_blank");
    assert.equal(await outbound.getAttribute("rel"), "noopener noreferrer");
    assert.ok(!/westwood\.com/i.test(report.outbound), "no dead Westwood link may be offered");
  }

  await run.page.waitForTimeout(500); // let the dialog's fade-in finish for the screenshot
  await run.shot("link-dialog");

  // Closing only dismisses the dialog; the game keeps running.
  await run.page.getByRole("button", { name: /^(Cancel|Close)$/ }).click();
  await run.page.waitForFunction(() => window.ra2Store?.getSnapshot().openLink === null);
  assert.equal((await run.state())?.phase, "running");
  report.dismissed = true;

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error);
  report.state = await run.state();
  await run.shot("failure").catch(() => {});
  throw error;
} finally {
  writeFileSync(path.join(opts.shots, "links.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(opts.shots, "links.log"), run.all.join("\n"));
  await run.browser.close();
}
