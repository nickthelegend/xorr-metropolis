/**
 * Before/after screenshots for the development wave (docs/ROADMAP-WIN.md), at 390 × 844 and 1440 × 900 (2026-10-07).
 *
 * Signs a passkey account in on the local fork, funds it, grants the permission and buys $20 of MON, then photographs
 * what each feature changed, scrolled to where the feature is, into docs/screens/wave/<feature>-<shot>-after-<vp>.png.
 *
 *   WEB=http://localhost:8092 API=http://localhost:8790 FEATURES=f1 node e2e/web/wave-shots.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
const OUT = process.env.OUT ?? fileURLToPath(new URL('../../docs/screens/wave/', import.meta.url));
const FEATURES = (process.env.FEATURES ?? 'f1,f2,f3,f4,f5').split(',');
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

/** Both sizes of what is on screen; `scrollTo` (a test id) is brought into view at each size first. */
async function shot(name, scrollTo) {
  for (const [vp, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(1_500);
    if (scrollTo) await v(page.getByTestId(scrollTo)).scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `${name}-after-${vp}.png`) });
  }
  await page.setViewportSize(SIZES.mobile);
  await page.waitForTimeout(1_500);
  console.log(`wave/${name}-after-{mobile,desktop}.png`);
}

for (let ok = 0, i = 0; ok < 3 && i < 180; i++) {
  ok = (await fetch(`${API}/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 1000));
}

// F2 comes first: the explainer is what a person sees before they have an account.
if (FEATURES.includes('f2')) {
  await go('/welcome');
  await shot('f2-welcome');
  await v(page.getByTestId('welcome-start')).click({ timeout: T.chain });
  for (const n of [1, 2, 3]) {
    await page.waitForTimeout(1_200);
    if (n === 3) await v(page.getByText(/^\d+ ms$/)).waitFor({ timeout: 30_000 }).catch(() => undefined);
    await shot(`f2-how-${n}`);
    if (n < 3) await v(page.getByTestId(`how-next-${n}`)).click();
  }
}

// A real account with one fill, for every feature that shows one (all but the explainer).
if (FEATURES.some((f) => f !== 'f2')) {
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
  await v(page.getByLabel('2', { exact: true })).click();
  await v(page.getByLabel('0', { exact: true })).click();
  await page.getByRole('button', { name: 'Buy $20 of WMON' }).click({ timeout: T.ui });
  await v(page.getByText(/^Bought /)).waitFor({ timeout: T.chain });
}

if (FEATURES.includes('f1')) {
  await go('/runs');
  await v(page.getByText(/^W?MON$/)).click({ timeout: T.ui });
  await v(page.getByTestId('speed-receipt')).waitFor({ timeout: T.ui });
  await shot('f1-run-receipt', 'speed-receipt');
  await go('/council');
  await v(page.getByTestId('council-convene')).click({ timeout: T.ui });
  await v(page.getByText(/^Approved \d–\d\.|^Not approved|^Vetoed/)).waitFor({ timeout: T.chain });
  await shot('f1-council');
}

if (FEATURES.includes('f3')) {
  // A round that filled shows the whole replay, the transaction and its speed included; the council is asked about MON,
  // then ETH, then BTC, until one is approved and fills (each is a real vote on the fork's live inputs).
  await go('/council');
  await v(page.getByTestId('council-convene')).waitFor({ timeout: T.ui });
  for (const sym of ['MON', 'ETH', 'BTC']) {
    const rounds = await page.getByTestId('council-replay').filter({ visible: true }).count();
    const fills = await page.getByTestId('council-vote-to-fill').filter({ visible: true }).count();
    await v(page.getByText(sym, { exact: true })).click();
    await v(page.getByTestId('council-convene')).click();
    for (let i = 0; i < 240 && (await page.getByTestId('council-replay').filter({ visible: true }).count()) <= rounds; i++) await page.waitForTimeout(1_000);
    await page.waitForTimeout(1_500);
    const filled = (await page.getByTestId('council-vote-to-fill').filter({ visible: true }).count()) > fills;
    console.log(`  council on ${sym}: ${filled ? 'approved and filled' : 'not filled'}`);
    if (filled) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('f3-council');
  await v(page.getByTestId('council-replay')).click();
  await v(page.getByTestId('replay-seat-risk-keeper')).waitFor({ timeout: T.ui });
  await v(page.getByTestId('replay-pause')).click();
  await shot('f3-replay-playing', 'replay-seat-risk-keeper');
  await v(page.getByTestId('replay-all')).click();
  await v(page.getByTestId('replay-outcome')).waitFor({ timeout: T.ui });
  await shot('f3-replay-verdict', 'replay-verdict');
  if (/Executed/.test(await v(page.getByTestId('replay-outcome')).innerText())) {
    await v(page.getByTestId('speed-receipt')).waitFor({ timeout: T.ui });
    await shot('f3-replay-fill', 'speed-receipt');
  }
}

console.log(`console errors and API responses ≥ 400: ${errors.length}${errors.length ? `\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}` : ''}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
