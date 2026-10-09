/**
 * Before/after screenshots for wave 2 (docs/ROADMAP-WIN.md "Wave 2"), at 390 × 844 and 1440 × 900 (2026-10-08).
 *
 * Signed out: Explore (W1) and the judges' screen (W4). Then a fresh passkey account with nothing yet: History and Runs
 * empty (W3) and the Council (W2). Then funded, granted and two buys: Runs with fills (W5).
 * Into docs/screens/wave2/<shot>-<before|after>-<mobile|desktop>.png.
 *
 *   PHASE=before|after FEATURES=w1,w2,w3,w4,w5 node e2e/web/wave2-shots.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
const OUT = process.env.OUT ?? fileURLToPath(new URL('../../docs/screens/wave2/', import.meta.url));
const PHASE = process.env.PHASE ?? 'after';
const FEATURES = (process.env.FEATURES ?? 'w1,w2,w3,w4,w5').split(',');
const SIZES = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };
const T = { ui: 60_000, chain: 240_000 };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: SIZES.mobile });
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
/** Until no loading skeleton is on screen (they carry aria-label="Loading"), then a beat for motion to finish. */
async function settled() {
  for (let i = 0; i < 60 && (await page.locator('[aria-label="Loading"]').filter({ visible: true }).count()) > 0; i++) await page.waitForTimeout(500);
  await page.waitForTimeout(1_500);
}
async function shot(name, scrollTo) {
  for (const [vp, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(1_200);
    if (scrollTo) await v(page.getByTestId(scrollTo)).scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `${name}-${PHASE}-${vp}.png`) });
  }
  await page.setViewportSize(SIZES.mobile);
  await page.waitForTimeout(1_000);
  console.log(`wave2/${name}-${PHASE}-{mobile,desktop}.png`);
}

for (let ok = 0, i = 0; ok < 3 && i < 180; i++) {
  ok = (await fetch(`${API}/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 1000));
}

if (FEATURES.includes('w1')) {
  await go('/explore');
  await settled();
  await shot('w1-explore');
}
if (FEATURES.includes('w4')) {
  // Before, the closest a judge had was "Check it yourself" (/judge); after, the bounty map.
  await go(PHASE === 'before' ? '/judge' : '/judges');
  await settled();
  await shot('w4-judges');
}

if (FEATURES.some((f) => ['w2', 'w3', 'w5'].includes(f))) {
  await go('/wallet');
  await page.getByTestId('passkey-create').click({ timeout: T.chain });
  await v(page.getByText('Continue — add funds', { exact: true })).waitFor({ timeout: T.chain });
}
if (FEATURES.includes('w3')) {
  await go('/history');
  await settled();
  await shot('w3-history-empty');
  await go('/runs');
  await settled();
  await shot('w3-runs-empty');
}
if (FEATURES.includes('w2')) {
  await go('/council');
  await settled();
  await shot('w2-council');
}
if (FEATURES.includes('w5')) {
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
  await go('/runs');
  await settled();
  await shot('w5-runs');
}

console.log(`console errors and API responses ≥ 400: ${errors.length}${errors.length ? `\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}` : ''}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
