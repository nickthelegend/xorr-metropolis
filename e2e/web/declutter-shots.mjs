/**
 * After shots for the readability pass (METROPOLIS-ORCHESTRATION "READABILITY RULE", 2026-10-09), 390 and 1440 px, into
 * docs/screens/declutter/<screen>-after-<vp>.png. The befores are the wave shots of the same screens.
 *
 *   node e2e/web/declutter-shots.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
const OUT = fileURLToPath(new URL('../../docs/screens/declutter/', import.meta.url));
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
page.on('response', (r) => r.url().startsWith(API) && r.status() >= 400 && errors.push(`${r.status()} ${r.url().slice(API.length)}`));
const v = (l) => l.filter({ visible: true }).first();
const go = (r) => page.goto(`${WEB}${r}`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
async function shot(name, scrollTo) {
  for (const [vp, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(1_200);
    if (scrollTo) await v(page.getByTestId(scrollTo)).scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `${name}-after-${vp}.png`) });
  }
  await page.setViewportSize(SIZES.mobile);
  await page.waitForTimeout(800);
  console.log(`declutter/${name}-after-{mobile,desktop}.png`);
}

await go('/welcome');
await v(page.getByTestId('welcome-start')).click({ timeout: T.chain });
for (const n of [1, 2]) await v(page.getByTestId(`how-next-${n}`)).click({ timeout: T.ui });
await v(page.getByTestId('commit-stats')).waitFor({ timeout: T.ui });
await shot('how-monad');

await go('/wallet');
await page.getByTestId('passkey-create').click({ timeout: T.chain });
await v(page.getByText('Continue — add funds', { exact: true })).click({ timeout: T.chain });
await v(page.getByText(/^Get [\d,]+ test USDC$/)).click({ timeout: T.ui });
await v(page.getByText(/^Added [\d,.]+ USDC/)).waitFor({ timeout: T.chain });
await v(page.getByText('Continue — set the limits', { exact: true })).click();
await v(page.getByText('Sign this permission', { exact: true })).click();
await page.waitForURL((u) => !u.pathname.includes('delegate'), { timeout: T.chain });
await go('/order/WMON');
await v(page.getByRole('button', { name: /^Buy \$/ })).waitFor({ timeout: T.ui });
for (let i = 0; i < 7; i++) await v(page.getByLabel('Delete', { exact: true })).click();
for (const d of '20') await v(page.getByLabel(d, { exact: true })).click();
await page.getByRole('button', { name: 'Buy $20 of WMON' }).click({ timeout: T.ui });
await v(page.getByText(/^Bought /)).waitFor({ timeout: T.chain });
await go('/runs');
await v(page.getByText(/^W?MON$/)).click({ timeout: T.ui });
await v(page.getByTestId('speed-ms')).waitFor({ timeout: T.ui });
await shot('run-speed', 'speed-receipt');

await go('/council');
await v(page.getByTestId('council-convene')).click({ timeout: T.ui });
await v(page.getByText(/^Approved \d–\d\.|^Not approved|^Vetoed/)).waitFor({ timeout: T.chain });
await shot('council');
await v(page.getByTestId('council-replay')).click();
await v(page.getByTestId('replay-seat-risk-keeper')).waitFor({ timeout: T.ui });
await v(page.getByTestId('replay-pause')).click();
await shot('replay', 'replay-seat-risk-keeper');

await go('/monad');
await v(page.getByTestId('monad-item-staking')).waitFor({ timeout: T.ui });
await v(page.getByTestId('commit-stats')).waitFor({ timeout: T.ui });
await shot('monad');
await go('/gauntlet');
await v(page.getByTestId('gauntlet-funnel')).waitFor({ timeout: T.ui });
await shot('gauntlet', 'gauntlet-list');

console.log(`console errors and API responses ≥ 400: ${errors.length}${errors.length ? `\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}` : ''}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
