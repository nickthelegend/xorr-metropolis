/**
 * The first-run explainer (docs/ROADMAP-WIN.md F2), on the local stack, at 390 px (2026-10-07).
 *
 * A first visit: Welcome → "Get started" → three steps (the council, the chain's limit, Monad live) → the questions that
 * begin sign-up. A second "Get started" on the same device goes straight to the questions. Fails on a console error or an
 * API response ≥ 400.
 *
 *   WEB=http://localhost:8092 API=http://localhost:8790 node e2e/web/explainer.mjs
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
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

await page.goto(`${WEB}/welcome`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
await v(page.getByTestId('welcome-start')).click({ timeout: 120_000 });
await page.waitForURL((u) => u.pathname === '/how', { timeout: 30_000 }).catch(() => fail('Get started did not open the explainer'));
const steps = ['A council votes on every trade', 'Inside a limit the chain enforces', 'Fast enough to vote, then fill'];
for (const [i, title] of steps.entries()) {
  await v(page.getByText(title, { exact: true })).waitFor({ timeout: 30_000 }).catch(() => fail(`step ${i + 1} did not show "${title}"`));
  if (i === 2) {
    const card = await v(page.getByTestId('how-monad')).innerText({ timeout: 30_000 });
    // Monad mainnet's cadence, live: wait for the read rather than photograph "Reading the chain…".
    await v(page.getByText(/^\d+ ms$/)).waitFor({ timeout: 30_000 }).catch(() => undefined);
    console.log(`✓ step 3: ${(await v(page.getByTestId('how-monad')).innerText()).replace(/\n+/g, ' · ').slice(0, 160) || card}`);
  } else {
    console.log(`✓ step ${i + 1}: ${title}`);
  }
  await v(page.getByTestId(`how-next-${i + 1}`)).click();
}
await page.waitForURL((u) => u.pathname === '/goals', { timeout: 30_000 }).catch(() => fail('finishing did not continue to sign-up'));
console.log('✓ finishing continues to sign-up (/goals)');

await page.goto(`${WEB}/welcome`, { waitUntil: 'domcontentloaded' });
await v(page.getByTestId('welcome-start')).click({ timeout: 60_000 });
await page.waitForURL((u) => u.pathname === '/goals', { timeout: 30_000 }).catch(() => fail('a second Get started showed the explainer again'));
console.log('✓ seen once: a second Get started goes straight to sign-up');

const benign = errors.filter((e) => !/favicon/.test(e));
console.log(`console errors and API responses ≥ 400: ${benign.length}${benign.length ? `\n  ${benign.join('\n  ')}` : ''}`);
await browser.close();
process.exit(benign.length ? 1 : 0);
