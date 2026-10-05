/**
 * Every screen, signed in, on the local fork: what each one shows when opened cold (2026-10-06).
 *
 * A passkey account is created, funded, granted and given one fill, so screens that need history have some; then every
 * route under `app/` is opened in turn (dynamic ones with a real id or symbol) and recorded:
 *   - console errors and uncaught exceptions, per screen;
 *   - an error state on screen ("couldn’t load", "Failed to fetch", "Something went wrong");
 *   - "Not here" — a route this build hides — which is only a fault if the app links to it (`--strict-hidden`).
 *
 *   WEB=http://localhost:8092 API=http://localhost:8790 node e2e/web/crawl.mjs
 * Exits 1 when any screen has a console error or an error state.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 3500);

/** Routes from the file tree: groups dropped, index folded, layouts and the dev screens left out. */
function routes(dir = APP) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '_dev') continue;
      out.push(...routes(p));
    } else if (name.endsWith('.tsx') && !name.startsWith('_') && !name.startsWith('+')) {
      const r = '/' + relative(APP, p).replace(/\.tsx$/, '').replace(/\([^)]+\)\/?/g, '').replace(/(^|\/)index$/, '');
      out.push(r.replace(/\/+/g, '/').replace(/\/$/, '') || '/');
    }
  }
  return [...new Set(out)].sort();
}

const ERROR_TEXT = /couldn[’']t load|Failed to fetch|Something went wrong|Unexpected error|is not a function|undefined is not/i;
/** Earlier xorr builds' chains: copy naming them on the Monad build is stale. */
const OLD_CHAIN = /\b(Arbitrum|Robinhood|Solana|Base Sepolia|on Base|X Layer|GMX|Hyperliquid|1inch)\b/;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
});
let errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
const visible = (l) => l.filter({ visible: true }).first();

// A real account with a little history.
await page.goto(`${WEB}/wallet`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
await page.getByTestId('passkey-create').click({ timeout: 180_000 });
await visible(page.getByText('Continue — add funds', { exact: true })).click({ timeout: 120_000 });
await visible(page.getByText(/^Get [\d,]+ test USDC$/)).click({ timeout: 60_000 });
await visible(page.getByText(/^Added [\d,.]+ USDC/)).waitFor({ timeout: 120_000 });
await visible(page.getByText('Continue — set the limits', { exact: true })).click();
await visible(page.getByText('Sign this permission', { exact: true })).click();
await page.waitForURL((u) => !u.pathname.includes('delegate'), { timeout: 120_000 });
await page.goto(`${WEB}/order/WMON`, { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 7; i++) await visible(page.getByLabel('Delete', { exact: true })).click({ timeout: 60_000 });
await visible(page.getByLabel('1', { exact: true })).click();
await visible(page.getByLabel('0', { exact: true })).click();
await page.getByRole('button', { name: 'Buy $10 of WMON' }).click({ timeout: 60_000 });
// A cold fork can take minutes to answer the first order (state fetched from Monad on demand).
await visible(page.getByText(/^Bought /)).waitFor({ timeout: 300_000 });

const token = await page.evaluate(() => JSON.parse(localStorage.getItem('xorr.mera.v1') ?? '{}').token);
const get = (p) => fetch(`${API}${p}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const [runs, agents, activity, strategies, positions, library] = await Promise.all([
  get('/runs?limit=5'),
  get('/agents'),
  get('/activity'),
  get('/strategies'),
  get('/positions'),
  get('/strategies/library'),
]);
const first = (x, key) => (Array.isArray(x) ? x : (x?.[key] ?? []))[0];
const sample = {
  id: runs?.[0]?.id,
  symbol: 'MON',
  // A trade row: the one Activity lets a person open as an explanation.
  seq: (Array.isArray(activity) ? activity : (activity?.events ?? [])).find((e) => e.kind === 'trade')?.id,
  agent: first(agents, 'agents')?.id,
  strategy: first(strategies, 'strategies')?.id,
  position: first(positions, 'positions')?.id,
  library: first(library, 'items')?.id ?? first(library, 'strategies')?.id,
};
console.log('sample ids', JSON.stringify(sample));
const fill = (r) =>
  r
    .replace('/runs/[id]', `/runs/${sample.id ?? 'none'}`)
    .replace('/agent/[id]', `/agent/${sample.agent ?? 'none'}`)
    .replace('/strategy/[id]', `/strategy/${sample.strategy ?? 'none'}`)
    .replace('/auto-close/[id]', `/auto-close/${sample.position ?? 'none'}`)
    .replace('/position/[id]', `/position/${sample.position ?? 'none'}`)
    .replace('/strategy-library/[id]', `/strategy-library/${sample.library ?? 'none'}`)
    .replace(/\/(audit|explain)\/\[seq\]/, (_m, p) => `/${p}/${sample.seq ?? 1}`)
    .replace('/order/[symbol]', '/order/WMON')
    .replace('/legal/[doc]', '/legal/terms')
    .replace(/\[symbol\]/g, sample.symbol)
    .replace(/\[classId\]/g, 'crypto')
    .replace(/\[id\]/g, 'none');

const results = [];
for (const r of routes()) {
  const url = fill(r);
  errors = [];
  let status = 'ok';
  let note = '';
  try {
    await page.goto(`${WEB}${url}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(SETTLE_MS);
    const text = await page.evaluate(() => document.body.innerText);
    if (/Not in this app yet|That screen has nothing behind it here/.test(text)) status = 'hidden';
    const bad = text.match(ERROR_TEXT);
    if (bad) {
      status = 'error-state';
      note = text.split('\n').find((l) => ERROR_TEXT.test(l))?.slice(0, 120) ?? bad[0];
    } else if (status !== 'hidden' && OLD_CHAIN.test(text)) {
      status = 'old-chain-copy';
      note = text.split('\n').find((l) => OLD_CHAIN.test(l))?.slice(0, 120) ?? '';
    }
  } catch (e) {
    status = 'load-failed';
    note = e instanceof Error ? e.message.split('\n')[0] : String(e);
  }
  const consoleErrors = errors.filter((e) => !/favicon/.test(e));
  if (consoleErrors.length && status === 'ok') status = 'console-error';
  results.push({ route: url, status, note: note || consoleErrors[0] || '' });
  console.log(`${status.padEnd(13)} ${url}${note || consoleErrors[0] ? `  — ${(note || consoleErrors[0]).slice(0, 140)}` : ''}`);
}
await browser.close();

const count = (s) => results.filter((x) => x.status === s).length;
console.log(`\n${results.length} screens: ${count('ok')} ok, ${count('hidden')} hidden here, ${count('error-state')} error states, ${count('console-error')} console errors, ${count('old-chain-copy')} naming an old chain, ${count('load-failed')} failed to load`);
process.exit(count('error-state') + count('console-error') + count('old-chain-copy') + count('load-failed') > 0 ? 1 : 0);
