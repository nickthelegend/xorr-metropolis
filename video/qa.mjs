// Frame QA: the overlay at given times, transparent, composited by qa.py over the footage bed.
import { chromium } from 'playwright';
import path from 'node:path';
const [html, outDir, ...times] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await p.addInitScript(() => { window.__timelines = {}; });
await p.goto('file://' + path.resolve(html), { waitUntil: 'networkidle' });
for (const t of times.map(Number)) {
  await p.evaluate((t) => {
    window.__timelines.main.seek(t, false);
    document.querySelectorAll('.clip').forEach((c) => { const s = +c.dataset.start, d = +c.dataset.duration; c.style.visibility = t >= s && t < s + d ? 'visible' : 'hidden'; });
  }, t);
  await p.waitForTimeout(120);
  await p.screenshot({ path: `${outDir}/ov_${t}.png`, omitBackground: true });
}
await b.close();
