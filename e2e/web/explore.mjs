/**
 * Explore tells the story first (docs/ROADMAP-WIN.md W1), on the local stack at 390 px (2026-10-08).
 *
 * Signed out: Explore opens on the story tiles and "Your money", with at most twelve links before a tap; each story tile
 * opens its screen; "Everything else" opens the rest of the list, and none of the screens the old list had are lost.
 * Fails on a console error or an API response ≥ 400.
 *
 *   WEB=http://localhost:8092 API=http://localhost:8790 node e2e/web/explore.mjs
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
const open = () => page.goto(`${WEB}/explore`, { waitUntil: 'domcontentloaded', timeout: 300_000 });

await open();
await v(page.getByTestId('explore-story-monad')).waitFor({ timeout: T.ui }).catch(() => fail('Explore does not open on the story'));
await page.waitForTimeout(1_500);
const buttons = await page.getByRole('button').filter({ visible: true }).allInnerTexts();
// The header's back button is not a link to a screen.
const links = buttons.filter((t) => t.trim() && !/^back$/i.test(t.trim()));
if (links.length > 12) await fail(`${links.length} links before a tap: ${links.join(' | ').slice(0, 300)}`);
console.log(`✓ ${links.length} links before a tap (at most 12)`);

const story = ['monad', 'council', 'gauntlet', 'runs', 'perps', 'how'];
for (const s of story) {
  await open();
  await v(page.getByTestId(`explore-story-${s}`)).click({ timeout: T.ui });
  await page.waitForURL((u) => u.pathname === `/${s}`, { timeout: T.ui }).catch(() => fail(`the ${s} tile did not open /${s}`));
}
console.log(`✓ every story tile opens its screen: ${story.map((s) => `/${s}`).join(', ')}`);

await open();
await v(page.getByTestId('explore-everything')).click({ timeout: T.ui });
await v(page.getByTestId('explore-group')).waitFor({ timeout: T.ui }).catch(() => fail('Everything else did not open'));
const more = await page.getByRole('button').filter({ visible: true }).count();
for (const title of ['Disposals', 'Export', 'Verification', 'Sources', 'System', 'Briefing']) {
  if (!(await page.getByText(title, { exact: true }).count())) await fail(`"${title}" is gone from Explore`);
}
console.log(`✓ Everything else opens the rest (${more} links now on screen); Disposals, Export, Verification, Sources, System, Briefing all there`);

console.log(`console errors and API responses ≥ 400: ${errors.length}${errors.length ? `\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}` : ''}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
