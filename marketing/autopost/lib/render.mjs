// Turns slide HTML into 1080 x 1350 PNGs with the browser the tests already use.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

export async function render(slides, dir) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  const files = [];
  try {
    for (const [i, html] of slides.entries()) {
      const htmlPath = join(dir, `slide-${i + 1}.html`);
      writeFileSync(htmlPath, html);
      await page.goto(`file:///${htmlPath.replaceAll("\\", "/")}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      // JPEG: the only picture format Instagram accepts (high quality, well under its 8 MB limit).
      const jpg = join(dir, `slide-${i + 1}.jpg`);
      await page.screenshot({ path: jpg, type: "jpeg", quality: 92 });
      files.push(jpg);
    }
  } finally {
    await browser.close();
  }
  return files;
}
