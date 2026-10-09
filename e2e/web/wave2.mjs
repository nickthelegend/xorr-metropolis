/**
 * Wave 2 (docs/ROADMAP-WIN.md "Wave 2"), on the local stack at 390 px (2026-10-08). W1 is e2e/web/explore.mjs.
 *
 *   W4  signed out: /judges lists every bounty, each with a live reading or its status, and every screen link opens.
 *   W3  a new passkey account: History and Runs, empty, show the latest fills on xorr (everyone's, said so) from
 *       Envio's index, and Monad's blocks going final.
 *   W2  the Council opens on what the council is; Kimi's absence is said on its seat and in full below the bench.
 *   W5  after two buys: Runs leads with the speed history — a bar per fill, the median, the sync sends, the gas.
 * Fails on a console error or an API response ≥ 400.
 *
 *   WEB=http://localhost:8092 API=http://localhost:8790 node e2e/web/wave2.mjs
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
const T = { ui: 60_000, chain: 240_000 };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
});
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
page.on('response', (r) => r.url().startsWith(API) && r.status() >= 400 && errors.push(`${r.status()} ${r.url().slice(API.length)}`));
const v = (l) => l.filter({ visible: true }).first();
const go = (r) => page.goto(`${WEB}${r}`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
const fail = async (why) => {
  console.log(`✗ ${why}`);
  await browser.close();
  process.exit(1);
};
const text = async (id) => (await v(page.getByTestId(id)).innerText({ timeout: T.ui })).replace(/\n+/g, ' · ');

// W4 — For judges, signed out, from Welcome.
await go('/welcome');
await v(page.getByTestId('welcome-judges')).click({ timeout: T.ui }).catch(() => fail('Welcome has no link for judges'));
await page.waitForURL((u) => u.pathname === '/judges', { timeout: T.ui });
const rows = await page.locator('[data-testid^="judges-row-"]').count();
if (rows < 11) await fail(`/judges lists ${rows} bounties, not 11`);
await v(page.getByTestId('judges-live-kuru')).waitFor({ timeout: T.ui }).catch(() => fail('Kuru has no live reading'));
console.log(`✓ W4 ${rows} bounties; Kuru: ${(await text('judges-live-kuru')).slice(0, 80)}; Envio: ${(await text('judges-live-envio')).slice(0, 80)}`);
const links = await page.locator('[data-testid^="judges-link-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
const opened = new Set();
for (const id of links) {
  await go('/judges');
  const link = v(page.getByTestId(id));
  await link.scrollIntoViewIfNeeded();
  const before = new URL(page.url()).pathname;
  await link.click({ timeout: T.ui });
  await page.waitForURL((u) => u.pathname !== before, { timeout: T.ui }).catch(() => fail(`${id} did not open its screen`));
  opened.add(new URL(page.url()).pathname);
}
console.log(`✓ W4 all ${links.length} screen links open: ${[...opened].join(', ')}`);

// W3 — a new account: empty History and Runs preview the latest fills on xorr.
await go('/wallet');
await page.getByTestId('passkey-create').click({ timeout: T.chain });
await v(page.getByText('Continue — add funds', { exact: true })).waitFor({ timeout: T.chain });
for (const route of ['/history', '/runs']) {
  await go(route);
  await v(page.getByTestId('recent-on-xorr')).waitFor({ timeout: T.ui }).catch(() => fail(`${route} shows no fills on xorr`));
  const t = await text('recent-on-xorr');
  if (!/Everyone’s fills, not yours/.test(t) || !/(Bought with \$[\d.,]+|Sold [\d.,]+ \w+)/.test(t)) await fail(`${route}'s preview: ${t.slice(0, 200)}`);
  await v(page.getByTestId('commit-strip')).waitFor({ timeout: T.ui });
  console.log(`✓ W3 ${route}: ${t.slice(0, 140)}`);
}

// W2 — the Council leads with what it is.
await go('/council');
await v(page.getByTestId('council-convene')).waitFor({ timeout: T.ui });
const body = await page.evaluate(() => document.body.innerText);
const firstLines = body.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).join(' | ');
if (/not configured/.test(firstLines)) await fail(`the Council still opens on "not configured": ${firstLines}`);
const kimi = (await fetch(`${API}/council/seats`).then((r) => r.json())).strategist;
if (kimi && !kimi.configured) {
  await v(page.getByTestId('council-kimi-seat-off')).waitFor({ timeout: T.ui }).catch(() => fail('the Kimi seat does not say it needs a key'));
  await v(page.getByTestId('council-strategist-off')).waitFor({ timeout: T.ui });
}
console.log(`✓ W2 opens on: ${firstLines.slice(0, 160)}`);

// W5 — two buys, then Runs leads with the speed history.
await go('/wallet');
await v(page.getByText('Continue — add funds', { exact: true })).click({ timeout: T.chain });
await v(page.getByText(/^Get [\d,]+ test USDC$/)).click({ timeout: T.ui });
await v(page.getByText(/^Added [\d,.]+ USDC/)).waitFor({ timeout: T.chain });
await v(page.getByText('Continue — set the limits', { exact: true })).click();
await v(page.getByText('Sign this permission', { exact: true })).click();
await page.waitForURL((u) => !u.pathname.includes('delegate'), { timeout: T.chain });
for (const usd of ['20', '10']) {
  await go('/order/WMON');
  await v(page.getByRole('button', { name: /^Buy \$/ })).waitFor({ timeout: T.ui });
  for (let i = 0; i < 7; i++) await v(page.getByLabel('Delete', { exact: true })).click();
  for (const d of usd) await v(page.getByLabel(d, { exact: true })).click();
  await page.getByRole('button', { name: `Buy $${usd} of WMON` }).click({ timeout: T.ui });
  await v(page.getByText(/^Bought /)).waitFor({ timeout: T.chain });
}
await page.waitForTimeout(3_000);
await go('/runs');
await v(page.getByTestId('speed-history')).waitFor({ timeout: T.ui }).catch(() => fail('Runs has no speed history after two fills'));
const sh = await text('speed-history');
if (!/median execution time/.test(sh) || !/last 2 trades/.test(sh)) await fail(`the speed history: ${sh}`);
await v(page.getByTestId('speed-history-details')).click();
if (!/2 of 2 came back with their receipt from the send/.test(await text('speed-history'))) await fail('the details do not count the sync receipts');
console.log(`✓ W5 ${sh.slice(0, 220)}`);

console.log(`console errors and API responses ≥ 400: ${errors.length}${errors.length ? `\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}` : ''}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
