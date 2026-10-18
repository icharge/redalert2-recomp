// Makes public/icons/icon-192.png and icon-512.png from icon.svg, in Chrome. Run it when the icon changes:
//
//   node e2e/icons.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { options } from "./lib.mjs";

const base = options(process.argv.slice(2));
const dir = path.resolve("public/icons");
const svg = readFileSync(path.join(dir, "icon.svg"), "utf8");
const browser = await chromium.launch({ executablePath: base.chrome, headless: true });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: path.join(dir, `icon-${size}.png`), omitBackground: true });
  await page.close();
  console.log(`icon-${size}.png`);
}
await browser.close();
