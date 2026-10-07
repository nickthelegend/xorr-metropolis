/**
 * The strategy gauntlet (docs/ROADMAP-WIN.md F5), on the local stack at 390 px (2026-10-07).
 *
 * Explore → The gauntlet: the funnel counts 313 backtested down to the survivors, stage by stage, and the last stage
 * equals the library's survivor count; the list opens on the survivors with their out-of-sample numbers; "Show the cut
 * too" adds the rest with the stage each fell at; a family narrows it; a strategy opens its full record. Fails on a
 * console error or an API response ≥ 400.
 *
 *   WEB=http://localhost:8092 API=http://localhost:8790 node e2e/web/gauntlet.mjs
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
const T = { ui: 60_000 };
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
page.on('response', (r) => r.url().startsWith(API) && r.status() >= 400 && errors.push(`${r.status()} ${r.url().slice(API.length)}`));
const v = (l) => l.filter({ visible: true }).first();
const fail = async (why) => {
  console.log(`✗ ${why}`);
  await browser.close();
  process.exit(1);
};

const lib = await fetch(`${API}/strategies/library?all=1`).then((r) => r.json());
const expected = [lib.gauntlet.tested, ...lib.gauntlet.stages.map((s) => s.passed)];

await page.goto(`${WEB}/explore`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
await v(page.getByText('The gauntlet', { exact: true })).click({ timeout: T.ui }).catch(() => fail('Explore has no gauntlet'));
await page.waitForURL((u) => u.pathname === '/gauntlet', { timeout: T.ui }).catch(() => fail('it did not open /gauntlet'));
const funnel = (await v(page.getByTestId('gauntlet-funnel')).innerText({ timeout: T.ui })).replace(/\n+/g, ' · ');
for (const n of expected) if (!funnel.includes(n.toLocaleString('en-US'))) await fail(`the funnel does not show ${n}: ${funnel}`);
if (expected.at(-1) !== lib.counts.survivors) await fail(`the last stage (${expected.at(-1)}) is not the survivor count (${lib.counts.survivors})`);
console.log(`✓ funnel: ${expected.join(' → ')} · ${funnel.slice(0, 160)}`);

const survivors = await page.locator('[data-testid^="gauntlet-strategy-"]').filter({ visible: true }).count();
if (survivors !== lib.counts.survivors) await fail(`the list opens on ${survivors}, not the ${lib.counts.survivors} survivors`);
const first = (await v(page.locator('[data-testid^="gauntlet-strategy-"]')).innerText()).replace(/\n+/g, ' · ');
if (!/Survived · Return \(OOS\) · [+−]?[\d.,]+%/.test(first)) await fail(`a survivor card lacks its numbers: ${first}`);
console.log(`✓ ${survivors} survivors, first: ${first.slice(0, 120)}`);

await v(page.getByTestId('gauntlet-show-all')).click();
await v(page.getByText(/^(lost on BTC out of sample|lost on unseen data|too few trades to judge|broke in the parameter sweep|broke at double commission|failed on other assets)$/)).waitFor({ timeout: T.ui }).catch(() => fail('the cut do not say where they fell'));
console.log(`✓ the cut shown, each with the stage it fell at`);

const fam = lib.families.find((f) => f.survivors > 0 && f.count > 1);
await v(page.getByText(`${fam.name} · ${fam.survivors}/${fam.count}`, { exact: true })).click();
await page.waitForTimeout(1_500);
const inFamily = await page.locator('[data-testid^="gauntlet-strategy-"]').filter({ visible: true }).count();
if (inFamily !== Math.min(fam.count, 60)) await fail(`${fam.name} shows ${inFamily}, not ${fam.count}`);
console.log(`✓ family ${fam.name}: ${inFamily} strategies`);

await v(page.locator('[data-testid^="gauntlet-strategy-"]')).click();
await page.waitForURL((u) => u.pathname.startsWith('/strategy-library/'), { timeout: T.ui }).catch(() => fail('a strategy did not open its record'));
console.log(`✓ a strategy opens its record: ${new URL(page.url()).pathname}`);

console.log(`console errors and API responses ≥ 400: ${errors.length}${errors.length ? `\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}` : ''}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
