// Visual/interaction checks for the real Launcher using its dev-only fixture.
// Start Vite, then: node e2e/launcher-themes.mjs --url http://127.0.0.1:5173/
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { options } from "./lib.mjs";

const opts = options(process.argv.slice(2));
mkdirSync(opts.shots, { recursive: true });
const browser = await chromium.launch({ executablePath: opts.chrome, headless: !opts.headed });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(new URL("e2e/launcher-themes.html", opts.url).href);
  const picker = page.getByRole("combobox", { name: "Launcher theme" });
  await picker.waitFor();
  for (const theme of [
    "retro",
    "skeuomorphic",
    "framed-tech",
    "game-ui",
    "game-feel",
    "atmosphere",
    "animation",
  ]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await picker.selectOption(theme);
    await page.waitForTimeout(1050);
    await page.locator(".launcher-page").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: path.join(opts.shots, `${theme}.png`) });
    for (const width of [320, 375, 414, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const edition of ["ra2", "ra2md"]) {
        await page.locator(`[data-edition-choice="${edition}"]`).click();
        const dimensions = await page.locator(".launcher-page").evaluate((el) => ({
          width: el.clientWidth,
          content: el.scrollWidth,
          body: document.body.scrollWidth,
        }));
        assert.ok(
          dimensions.content <= dimensions.width + 2 && dimensions.body <= width + 2,
          `${theme}/${edition}/${width}: horizontal overflow`,
        );
        const play = page.getByRole("button", { name: "Play", exact: true });
        assert.equal(await play.isEnabled(), true);
        await play.scrollIntoViewIfNeeded();
        const box = await play.boundingBox();
        assert.ok(
          box && box.x >= 0 && box.x + box.width <= width + 2,
          `${theme}/${edition}/${width}: Play clipped`,
        );
      }
    }
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(
      await page.locator(".import-button svg").isVisible(),
      true,
      `${theme}: import icon missing`,
    );
    await page.locator(".launcher-page").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: path.join(opts.shots, `${theme}-mobile.png`) });
    for (const name of ["Game settings", "Saved games", "Manage collection"]) {
      const trigger = page.getByRole("button", { name, exact: true });
      await trigger.click();
      await page.getByRole("dialog").waitFor();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.tagName === "BUTTON");
      assert.equal(
        await trigger.evaluate((el) => el === document.activeElement),
        true,
        `${theme}: ${name} loses focus`,
      );
    }
  }
  await picker.selectOption("atmosphere");
  await page.reload();
  assert.equal(await picker.inputValue(), "atmosphere", "Theme lost on reload");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await picker.selectOption("animation");
  assert.equal(
    await page
      .locator(".launcher-page")
      .evaluate((el) => el.getAnimations({ subtree: true }).length),
    0,
  );
  // The preview's launch callback is intentionally explicit and cannot start a game.
  const dialog = page.waitForEvent("dialog");
  const launching = page
    .getByRole("button", { name: "Play", exact: true })
    .click({ noWaitAfter: true });
  const launch = await dialog;
  assert.match(launch.message(), /selected.*preview does not start the game/);
  await launch.dismiss();
  await launching;
  assert.deepEqual(errors, []);
  console.log(
    "PASS: seven themes, both editions, six widths, theme restore, utility focus, reduced motion, preview callback; no browser errors.",
  );
} finally {
  await browser.close();
}
