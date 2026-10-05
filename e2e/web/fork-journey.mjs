/**
 * The whole product on a local fork of Monad mainnet, driven in a real browser (2026-10-06): the Mera passkey account,
 * and Agora's demo path — passkey login, an AUSD balance, a Perpl trade — with a Kuru-or-Uniswap spot fill between.
 *
 *   1. Create a passkey account (Mera: PRF → key; a WebAuthn virtual authenticator with PRF stands in for the device).
 *   2. Fund it from the fork faucet, then sign the trading permission — no wallet popup: Mera's signing session signs.
 *   3. Buy MON from the order ticket; open the run: the venue that filled it and, where both were measured, what the
 *      other venue would have delivered.
 *   4. Perps: test MON and AUSD (the AUSD balance), open a Perpl desk (owner signs; Perpl's own DelegatedAccount), fund
 *      it, allow trading, long MON, close it.
 *   5. Hold to stop: the permission is revoked and the desk's operator removed.
 *
 * Every step asserts what the screen says, and the run fails on any console error.
 *
 * Needs: the fork (`infra/monad-fork/entrypoint.sh`), its bootstrap (`npm run rebuild:fork`), the Perpl keeper
 * (`src/fork/perpl-keeper.ts`), the executor with `.env.fork`, and the web app built against them. Then:
 *   WEB=http://localhost:8092 node e2e/web/fork-journey.mjs
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
const OUT = process.env.OUT ?? '/tmp';
const T = { ui: 60_000, chain: 120_000 };

const errors = [];
const log = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 240));
});
page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 240)}`));

// A platform authenticator with PRF, as iCloud Keychain or Google Password Manager would be.
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
});

const shot = (name) => page.screenshot({ path: `${OUT}/journey-${name}.png` });
const text = () => page.evaluate(() => document.body.innerText);
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    say(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    await shot(`failed-${name.replace(/\W+/g, '-')}`).catch(() => undefined);
    say(`✗ ${name}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    say((await text().catch(() => '')).split('\n').filter(Boolean).slice(0, 30).join(' | '));
    await browser.close();
    process.exit(1);
  }
}
// The web stack keeps earlier screens mounted but hidden: every match is of what is on screen now.
const tap = (name) => page.getByText(name, { exact: true }).filter({ visible: true }).first().click({ timeout: T.ui });

let landed = Date.now();
await step('create a passkey account', async () => {
  await page.goto(`${WEB}/wallet`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.getByTestId('passkey-create').waitFor({ timeout: 180_000 });
  landed = Date.now(); // the app on screen: the clock a person would start
  await page.getByTestId('passkey-create').click({ timeout: 180_000 });
  await page.getByText('Continue — add funds', { exact: true }).waitFor({ timeout: T.chain });
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('xorr.mera.v1') ?? 'null'));
  if (!s?.address || !s?.token) throw new Error('no passkey session stored');
  say(`  account ${s.address} (derived from the passkey; nothing that signs is stored)`);
});

await step('fund from the fork faucet', async () => {
  await tap('Continue — add funds');
  const get = page.getByText(/^Get [\d,]+ test USDC$/).filter({ visible: true }).first();
  await get.waitFor({ timeout: T.ui });
  await get.click();
  await page.getByText(/^Added [\d,.]+ USDC/).filter({ visible: true }).first().waitFor({ timeout: T.chain });
});

await step('sign the trading permission (Mera signing session, no popup)', async () => {
  await tap('Continue — set the limits');
  await tap('Sign this permission');
  await page.waitForURL((u) => !u.pathname.includes('delegate'), { timeout: T.chain });
});

say(`  time to first transaction: ${((Date.now() - landed) / 1000).toFixed(1)} s from opening the app to a confirmed permission`);

await step('the stateless test: storage cleared, the passkey rebuilds the same account', async () => {
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('xorr.mera.v1') ?? '{}').address);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(`${WEB}/wallet`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('passkey-sign-in').filter({ visible: true }).click({ timeout: T.ui });
  await page.waitForFunction(() => Boolean(JSON.parse(localStorage.getItem('xorr.mera.v1') ?? '{}').address), null, { timeout: T.chain });
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('xorr.mera.v1') ?? '{}').address);
  if (after !== before) throw new Error(`a different account came back: ${after} (was ${before})`);
  say(`  ${after}: the same account, from the passkey alone`);
});

await step('buy $20 of MON, and see where it filled', async () => {
  await page.goto(`${WEB}/order/MON`, { waitUntil: 'domcontentloaded' }); // the ticket opens as WMON
  await page.getByRole('button', { name: /^Buy \$/ }).filter({ visible: true }).first().waitFor({ timeout: T.ui });
  for (let i = 0; i < 7; i++) await page.getByLabel('Delete', { exact: true }).filter({ visible: true }).first().click();
  await page.getByLabel('2', { exact: true }).filter({ visible: true }).first().click();
  await page.getByLabel('0', { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Buy $20 of WMON' }).click({ timeout: T.ui });
  await page.getByText(/^Bought /).filter({ visible: true }).first().waitFor({ timeout: T.chain });
  await page.goto(`${WEB}/runs`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/^W?MON$/).filter({ visible: true }).first().click({ timeout: T.ui });
  await page.getByText(/^Filled$/).filter({ visible: true }).first().waitFor({ timeout: T.ui });
  const routing = await page.getByTestId('run-routing').innerText({ timeout: 10_000 }).catch(() => null);
  say(`  ${routing ?? 'one venue measured for this fill'}`);
  await shot('run');
});

await step('history: the on-chain record, indexed by Envio', async () => {
  // The indexer (indexer/, RPC sync) follows the fork in realtime; give it a few blocks to see the buy.
  for (let i = 0; i < 20; i++) {
    await page.goto(`${WEB}/history`, { waitUntil: 'domcontentloaded' });
    const card = page.getByTestId('history-indexed').filter({ visible: true });
    await card.waitFor({ timeout: 15_000 }).catch(() => undefined);
    if ((await card.count()) && /spent over 1 order/.test(await card.innerText())) {
      say(`  ${(await card.innerText()).replace(/\n+/g, ' | ')}`);
      return;
    }
    await page.waitForTimeout(3000);
  }
  throw new Error('the History screen never showed the indexed record of the buy');
});

await step('perps: test MON and AUSD, then open a Perpl desk', async () => {
  await page.goto(`${WEB}/perps`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('perps-fund-test').click({ timeout: T.ui });
  await page.getByText(/AUSD \(fork\)|AUSD/).filter({ visible: true }).first().waitFor({ timeout: T.chain });
  await page.getByTestId('perps-create').click({ timeout: T.ui });
  await page.getByTestId('perps-open-account').click({ timeout: T.chain });
  // A desk made from Perpl's factory may need its operator allowlist brought up to date: one more owner signature.
  const allow = page.getByTestId('perps-allow');
  const long = page.getByTestId('perps-open_long');
  await allow.or(long).filter({ visible: true }).first().waitFor({ timeout: T.chain });
  if (await allow.isVisible()) await allow.click();
  await long.filter({ visible: true }).waitFor({ timeout: T.chain });
  const body = await text();
  const ausd = body.match(/Wallet: ([\d.,]+) AUSD/);
  say(`  AUSD in the wallet: ${ausd?.[1] ?? '?'}; desk open on Perpl`);
});

await step('long MON on Perpl, then close it', async () => {
  await page.getByText(/^MON$/).filter({ visible: true }).first().click({ timeout: T.ui }).catch(() => undefined);
  await page.getByTestId('perps-open_long').click({ timeout: T.ui });
  const close = page.getByText(/^Close long/).filter({ visible: true }).first();
  await close.waitFor({ timeout: T.chain });
  const pos = (await text()).match(/MON[^\n]*\n[^\n]*Long[\s\S]{0,200}?Liquidation [^\n]+/);
  say(`  position: ${pos ? pos[0].replace(/\s+/g, ' ').slice(0, 160) : 'open'}`);
  await shot('perps-position');
  await close.click();
  await page.getByText('No open positions. Long or short above, or let an agent do it.').waitFor({ timeout: T.chain });
});

await step('hold to stop: permission revoked, desk operator removed', async () => {
  await page.goto(`${WEB}/safety`, { waitUntil: 'domcontentloaded' });
  const hold = page.getByText('Hold to stop all trading', { exact: true }).filter({ visible: true }).first();
  await hold.waitFor({ timeout: T.ui });
  const box = await hold.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2500);
  await page.mouse.up();
  // "Trading stopped" only once revoke() is confirmed on chain (StopCurtain); "Stopping all trading" is the signature in flight.
  await page.getByText('Trading stopped', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: T.chain });
  const curtain = (await text()).split('\n').filter(Boolean);
  say(`  ${curtain.slice(curtain.indexOf('Trading stopped'), curtain.indexOf('Trading stopped') + 3).join(' · ')}`);
  await shot('stopped');
  // Read back from the chain, through the executor: the permission and the desk's operator, both.
  const after = await page.evaluate(async (api) => {
    const { token } = JSON.parse(localStorage.getItem('xorr.mera.v1') ?? '{}');
    const get = (p) => fetch(`${api}${p}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
    return { desk: await get('/perps/desk'), delegation: await get('/delegation') };
  }, API);
  if (after.desk.operatorActive !== false) throw new Error(`the desk's operator is still active: ${JSON.stringify(after.desk.operatorActive)}`);
  say(`  desk operator active: ${after.desk.operatorActive}; delegation: ${JSON.stringify(after.delegation).slice(0, 120)}`);
});

const benign = errors.filter((e) => !/favicon/.test(e));
say(`console errors: ${benign.length}${benign.length ? `\n  ${benign.join('\n  ')}` : ''}`);
await browser.close();
process.exit(benign.length ? 1 : 0);
