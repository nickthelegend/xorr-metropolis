/**
 * Built on Monad (docs/ROADMAP-WIN.md F4, MONAD-TECH items 1–8), on the local stack at 390 px (2026-10-07).
 *
 * A passkey account signs in; Home's live Monad line opens /monad; every Monad-native item shows a live reading (commit
 * states timed, the sync send supported on the executor's chain, txpool status on mainnet, P256 checked on mainnet and
 * the fork, staking's epoch and proposer, the reserve precompile, the canonical contracts present); "Check my passkey on
 * Monad" signs with the passkey and Monad's 0x0100 accepts it and refuses the tampered message; and the sponsors' rows
 * read Kuru, Uniswap, Chainlink, Perpl, AUSD and Envio. Fails on a console error or an API response ≥ 400.
 *
 *   WEB=http://localhost:8092 API=http://localhost:8790 node e2e/web/monad.mjs
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

for (let ok = 0, i = 0; ok < 3 && i < 180; i++) {
  ok = (await fetch(`${API}/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 1000));
}

await go('/wallet');
await page.getByTestId('passkey-create').click({ timeout: T.chain });
await v(page.getByText('Continue — add funds', { exact: true })).waitFor({ timeout: T.chain });
console.log('✓ signed in with a passkey');

await go('/');
await v(page.getByTestId('home-monad')).click({ timeout: T.ui }).catch(() => fail('Home has no live Monad line'));
await page.waitForURL((u) => u.pathname === '/monad', { timeout: T.ui }).catch(() => fail('the Monad line did not open /monad'));
console.log('✓ Home → Built on Monad');

// The Monad-native items, each with a live reading.
await v(page.getByTestId('monad-item-staking')).waitFor({ timeout: T.ui }).catch(() => fail('the native readings never arrived'));
await v(page.getByTestId('commit-stats')).waitFor({ timeout: 30_000 }).catch(() => fail('no live commit states'));
const expectations = [
  ['monad-item-commits', /voted in [\d.]+ m?s, final in/],
  ['monad-item-sync', /supported — every fill uses it/],
  ['monad-item-txpool', /Monad mainnet · answers/],
  ['monad-item-p256', /mainnet · valid ✓ · tampered refused ✓/],
  ['monad-item-staking', /Epoch · [\d,]+.*Proposing now · validator #\d+/],
  ['monad-item-gas', /0x1001 on Monad mainnet · answers/],
  ['monad-item-contracts', /WMON .*mainnet ✓ · fork ✓/],
];
for (const [id, re] of expectations) {
  const t = await text(id);
  if (!re.test(t)) await fail(`${id} does not read ${re}: ${t.slice(0, 220)}`);
  console.log(`✓ ${id}: ${t.slice(0, 140)}`);
}

// The passkey itself, checked by Monad's P256 precompile.
await v(page.getByTestId('monad-passkey-check')).click();
await v(page.getByTestId('monad-passkey-result')).waitFor({ timeout: T.ui }).catch(() => fail('the passkey check returned nothing'));
const pk = await text('monad-passkey-result');
if (!/0x0100 on Monad mainnet · signature valid ✓/.test(pk) || !/0x0100 on the fork · signature valid ✓/.test(pk) || !/other message · refused ✓/.test(pk)) await fail(`the passkey was not verified: ${pk}`);
console.log(`✓ passkey: ${pk.slice(0, 200)}`);
// A second check signs once, with the key remembered.
await v(page.getByTestId('monad-passkey-check')).click();
await page.waitForTimeout(3_000);
if (!/signature valid ✓/.test(await text('monad-passkey-result'))) await fail('the second check failed');
console.log('✓ a second check signs once, with the key remembered');

// The sponsors' rows, read live.
for (const [id, re] of [
  ['monad-sponsor-prices', /Kuru order book \(mid\) · \$[\d.]+.*Chainlink MON\/USD · \$[\d.]+/],
  ['monad-sponsor-perpl', /\d+ markets open/],
  ['monad-sponsor-ausd', /Peg \(Chainlink AUSD\/USD\) · \$0\.99|\$1/],
  ['monad-sponsor-envio', /Indexed to block · [\d,]+/],
  ['monad-sponsor-mera', /This session · 0x/],
]) {
  await v(page.getByTestId(id)).scrollIntoViewIfNeeded();
  const t = await text(id);
  if (!re.test(t)) await fail(`${id} does not read ${re}: ${t.slice(0, 200)}`);
  console.log(`✓ ${id}: ${t.slice(0, 120)}`);
}

// Settings reaches it too.
await go('/settings');
await v(page.getByTestId('settings-monad')).click({ timeout: T.ui });
await page.waitForURL((u) => u.pathname === '/monad', { timeout: T.ui }).catch(() => fail('Settings did not open /monad'));
console.log('✓ Settings → Built on Monad');

console.log(`console errors and API responses ≥ 400: ${errors.length}${errors.length ? `\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}` : ''}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
