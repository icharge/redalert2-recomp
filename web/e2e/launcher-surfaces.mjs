// Shared app surfaces, including body portals and the lazily loaded file browser.
// Start Vite, then: node e2e/launcher-surfaces.mjs --url http://127.0.0.1:5173/
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
  const radii = {
    retro: "5px",
    skeuomorphic: "16px",
    "framed-tech": "0px",
    "game-ui": "2px",
    "game-feel": "5px",
    atmosphere: "5px",
    animation: "8px",
  };
  const results = [];
  async function surface(locator, theme, width) {
    await locator.waitFor();
    const style = await locator.evaluate((el) => {
      const css = getComputedStyle(el),
        box = el.getBoundingClientRect();
      return {
        radius: css.borderTopLeftRadius,
        fill: css.backgroundImage,
        color: css.color,
        overflow: el.scrollWidth - el.clientWidth,
        left: box.left,
        right: box.right,
      };
    });
    assert.equal(style.radius, radii[theme], `${theme}: surface radius`);
    assert.notEqual(style.fill, "none", `${theme}: material missing`);
    assert.ok(
      style.overflow <= 2 && style.left >= -2 && style.right <= width + 2,
      `${theme}/${width}: surface clipped: ${JSON.stringify(style)}`,
    );
    return style;
  }
  async function screenshot(name) {
    await page.waitForTimeout(320);
    await page.screenshot({ path: path.join(opts.shots, name + ".png") });
  }
  for (const theme of Object.keys(radii)) {
    await picker.selectOption(theme);
    assert.equal(await page.locator("html").getAttribute("data-launcher-theme"), theme);
    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 740 });
      await page.getByRole("button", { name: "Game settings", exact: true }).click();
      let dialog = page.getByRole("dialog");
      await surface(dialog, theme, width);
      await page.getByRole("combobox", { name: /resolution/ }).click();
      await surface(page.getByRole("listbox"), theme, width);
      await page.keyboard.press("Escape");
      if (width !== 320) await screenshot(`${theme}-settings-${width}`);
      await page.getByRole("button", { name: "Done", exact: true }).click();

      await page.getByRole("button", { name: "Saved games", exact: true }).click();
      await surface(page.getByRole("dialog"), theme, width);
      await page.getByRole("button", { name: "Done", exact: true }).click();

      await page.getByRole("button", { name: "Manage collection", exact: true }).click();
      dialog = page.getByRole("dialog");
      await surface(dialog, theme, width);
      if (width === 1440) await screenshot(`${theme}-collection`);
      const remove = page.getByRole("button", { name: /^Remove / });
      await remove.focus();
      await remove.click();
      await surface(page.getByRole("alertdialog"), theme, width);
      const destructive = page.getByRole("button", { name: "Remove", exact: true });
      assert.equal(await destructive.getAttribute("data-accent-color"), "red");
      await page.getByRole("button", { name: "Keep it", exact: true }).click();
      await page.getByRole("button", { name: "Done", exact: true }).click();

      await page.getByRole("button", { name: "Browse files", exact: true }).click();
      await surface(page.getByRole("dialog"), theme, width);
      const explorer = page.locator(".fe_fileexplorer_inner_wrap");
      await explorer.waitFor();
      const fileStyle = await explorer.evaluate((el) => ({
        fill: getComputedStyle(el).backgroundColor,
        ink: getComputedStyle(el).color,
      }));
      assert.notEqual(fileStyle.fill, "rgb(255, 255, 255)", `${theme}: white file browser`);
      assert.notEqual(fileStyle.ink, "rgb(0, 0, 0)", `${theme}: unreadable file browser`);
      if (width === 1440) await screenshot(`${theme}-files`);
      await page.getByRole("button", { name: "Close", exact: true }).click();

      await page.getByRole("button", { name: "Mods…", exact: true }).click();
      await surface(page.getByRole("dialog"), theme, width);
      if (width === 1440) await screenshot(`${theme}-mods`);
      await page.getByRole("button", { name: "Done", exact: true }).click();

      await page.getByRole("button", { name: "Add installation", exact: true }).click();
      await page.getByRole("heading", { name: "Bring your game" }).waitFor();
      assert.equal(
        await page.locator("html").getAttribute("data-launcher-theme"),
        theme,
        "Theme lost on import route",
      );
      await surface(page.locator(".rt-Card"), theme, width);
      await page.getByRole("button", { name: "Back to launcher", exact: true }).click();
      assert.equal(await picker.inputValue(), theme);
      results.push({ theme, width });
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await picker.selectOption("animation");
  await page.getByRole("button", { name: "Game settings", exact: true }).click();
  assert.equal(
    await page.getByRole("dialog").evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${results.length} theme/viewport combinations; settings, dropdowns, saves, collection, removal confirmations, files, mods, import and reduced motion; no page errors.`,
  );
} finally {
  await browser.close();
}
