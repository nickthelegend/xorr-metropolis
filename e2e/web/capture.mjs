/**
 * Every screen of the app, photographed on the local fork stack at phone and desktop size (2026-10-07).
 *
 * A real passkey account is made and given a real history first — test funds, the permission, a $20 buy routed between
 * Kuru and Uniswap, a council round, a Perpl desk with an open long — so each screen shows what it shows a person who uses
 * it, never fixtures. The onboarding is photographed as it is walked, and three states are taken on purpose: empty (a
 * fresh account, before anything happened), offline (the executor unreachable), and stopped (after hold-to-stop).
 *
 * Then every route under `app/` is opened (dynamic ones with a real id) at 390 × 844 and 1440 × 900 and saved as
 *   <OUT>/<area>/<nn>-<screen>-{mobile,desktop}.png
 * with a manifest (`<OUT>/manifest.json`) that the contact sheets and the gallery are built from. A route this build hides
 * is photographed once, as "not here", rather than 26 times.
 *
 *   sh infra/monad-fork/local-stack.sh up
 *   node e2e/web/capture.mjs                                   # → docs/screens
 *   OUT=/tmp/before VIEWPORTS=mobile ROUTES=/,/council node e2e/web/capture.mjs
 */
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
const OUT = process.env.OUT ?? fileURLToPath(new URL('../../docs/screens/', import.meta.url));
const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 3000);
const ONLY = process.env.ROUTES?.split(',').filter(Boolean);
const VIEWPORTS = (process.env.VIEWPORTS ?? 'mobile,desktop').split(',');
const SIZES = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };
const QUICK = process.env.QUICK === '1'; // skip the perps desk set-up
/** Photograph the onboarding and the states even when ROUTES narrows the route list (a before/after pass). */
const WALK = !ONLY || process.env.WALK === '1';

/** Which area a route belongs to: the sections the contact sheets are grouped by. */
function areaOf(r) {
  const p = r.split('/')[1] ?? '';
  if (['welcome', 'wallet', 'fund', 'delegate', 'goals', 'proposal'].includes(p)) return 'onboarding';
  if (r === '/' || ['inbox', 'notifications', 'briefing', 'catchup', 'explore', 'more', 'search', 'profile'].includes(p)) return 'home';
  if (['markets', 'order', 'swap', 'route', 'crosscheck', 'venues', 'sources', 'coverage', 'chart', 'asset'].includes(p)) return 'trade';
  if (['portfolio', 'holdings', 'tokens', 'watchlist', 'deposit', 'send', 'pnl', 'disposals', 'export', 'withdraw-everything', 'sell-everything', 'flatten', 'position', 'auto-close'].includes(p)) return 'money';
  if (['bot', 'agent', 'strategies', 'strategy', 'strategy-library', 'roster-compare', 'schedule', 'proposals', 'judge', 'voice'].includes(p)) return 'agents';
  if (p === 'council') return 'council';
  if (['perps', 'perpl', 'risk'].includes(p)) return 'perps';
  if (['history', 'activity', 'runs', 'audit', 'explain', 'verify', 'metrics', 'system', 'network', 'networks'].includes(p)) return 'history';
  return 'safety';
}

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

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: SIZES.mobile });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
});
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
const v = (l) => l.filter({ visible: true }).first();
const T = { ui: 60_000, chain: 240_000 };

const manifest = [];
const counters = {};
const slug = (s) => s.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
/** Photograph what is on screen now, at every viewport asked for. */
async function shot(area, name, route, note = '') {
  mkdirSync(join(OUT, area), { recursive: true });
  counters[area] = (counters[area] ?? 0) + 1;
  const base = `${String(counters[area]).padStart(2, '0')}-${slug(name)}`;
  const files = {};
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(SIZES[vp]);
    await page.waitForTimeout(vp === VIEWPORTS[0] ? SETTLE_MS : 900);
    const file = join(OUT, area, `${base}-${vp}.png`);
    await page.screenshot({ path: file });
    files[vp] = relative(OUT, file);
  }
  if (VIEWPORTS.at(-1) !== 'mobile') {
    await page.setViewportSize(SIZES.mobile);
    // Crossing the design width re-lays the app out; let it settle before anything is pressed.
    await page.waitForTimeout(2000);
  }
  manifest.push({ area, name, route, note, files });
  console.log(`${area}/${base}  ${route}${note ? `  (${note})` : ''}`);
}
const go = (route) => page.goto(`${WEB}${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });

// The executor answers its first reads slowly on a cold fork; nothing below should photograph that.
for (let ok = 0, i = 0; ok < 3 && i < 180; i++) {
  ok = (await fetch(`${API}/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 1000));
}

/*
 * A full run replaces only what it writes: the area folders and the manifest. Never the folder itself — `docs/screens`
 * also holds older captures and the before set, and a run on 2026-10-07 that cleared the whole folder deleted the
 * before set, which is not in git until it is committed.
 */
const AREA_DIRS = ['onboarding', 'home', 'trade', 'money', 'agents', 'council', 'perps', 'history', 'safety', 'states'];
if (!ONLY) for (const a of AREA_DIRS) rmSync(join(OUT, a), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------ onboarding, as it is walked
await go('/welcome');
await v(page.getByText(/^Get started$/)).waitFor({ timeout: T.chain }).catch(() => undefined);
if (WALK) await shot('onboarding', 'welcome', '/welcome');
await go('/wallet');
await page.getByTestId('passkey-create').waitFor({ timeout: T.chain });
if (WALK) await shot('onboarding', 'wallet', '/wallet', 'signed out');
await page.getByTestId('passkey-create').click();
await v(page.getByText('Continue — add funds', { exact: true })).waitFor({ timeout: T.chain });
if (WALK) await shot('onboarding', 'wallet-created', '/wallet', 'passkey account made');
await v(page.getByText('Continue — add funds', { exact: true })).click();
await v(page.getByText(/^Get [\d,]+ test USDC$/)).waitFor({ timeout: T.ui });
if (WALK) await shot('onboarding', 'fund', '/fund');
await v(page.getByText(/^Get [\d,]+ test USDC$/)).click();
await v(page.getByText(/^Added [\d,.]+ USDC/)).waitFor({ timeout: T.chain });
if (WALK) await shot('onboarding', 'fund-added', '/fund', 'test funds arrived');
await v(page.getByText('Continue — set the limits', { exact: true })).click();
await v(page.getByText('Sign this permission', { exact: true })).waitFor({ timeout: T.ui });
if (WALK) await shot('onboarding', 'delegate', '/delegate');
await v(page.getByText('Sign this permission', { exact: true })).click();
await page.waitForURL((u) => !u.pathname.includes('delegate'), { timeout: T.chain });

// ------------------------------------------------------------------ empty states, before anything has happened
if (WALK) {
  for (const r of ['/history', '/activity', '/runs', '/council', '/portfolio']) {
    await go(r);
    await shot('states', `${slug(r)}-empty`, r, 'a new account, nothing traded yet');
  }
}

// ------------------------------------------------------------------ a real history
await go('/order/WMON');
await v(page.getByRole('button', { name: /^Buy \$/ })).waitFor({ timeout: T.ui });
for (let i = 0; i < 7; i++) await v(page.getByLabel('Delete', { exact: true })).click();
await v(page.getByLabel('2', { exact: true })).click();
await v(page.getByLabel('0', { exact: true })).click();
if (WALK) await shot('trade', 'order-ticket', '/order/WMON', '$20 entered');
await page.getByRole('button', { name: 'Buy $20 of WMON' }).click({ timeout: T.ui });
await v(page.getByText(/^Bought /)).waitFor({ timeout: T.chain });

await go('/council');
await v(page.getByTestId('council-convene')).click({ timeout: T.ui });
await v(page.getByText(/^Approved \d–\d\.|^Not approved|^Vetoed/)).waitFor({ timeout: T.chain });

if (!QUICK) {
  await go('/perps');
  await page.getByTestId('perps-fund-test').click({ timeout: T.ui });
  await v(page.getByText(/AUSD/)).waitFor({ timeout: T.chain });
  await page.getByTestId('perps-create').click({ timeout: T.ui });
  await page.getByTestId('perps-open-account').click({ timeout: T.chain });
  const allow = page.getByTestId('perps-allow');
  const long = page.getByTestId('perps-open_long');
  await allow.or(long).filter({ visible: true }).first().waitFor({ timeout: T.chain });
  if (await allow.isVisible()) await allow.click();
  await v(long).waitFor({ timeout: T.chain });
  await v(page.getByText(/^MON$/)).click({ timeout: T.ui }).catch(() => undefined);
  await v(long).click();
  await v(page.getByText(/^Close long/)).waitFor({ timeout: T.chain });
}

// ------------------------------------------------------------------ real ids for the dynamic routes
const token = await page.evaluate(() => JSON.parse(localStorage.getItem('xorr.mera.v1') ?? '{}').token);
const get = (p) => fetch(`${API}${p}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const first = (x, key) => (Array.isArray(x) ? x[0] : x?.[key]?.[0]);
const [runs, agents, activity, strategies, positions, library] = await Promise.all([
  get('/runs?limit=5'),
  get('/agents'),
  get('/activity'),
  get('/strategies'),
  get('/positions'),
  get('/strategies/library'),
]);
const sample = {
  id: first(runs, 'runs')?.id,
  seq: (Array.isArray(activity) ? activity : (activity?.events ?? [])).find((e) => e.kind === 'trade')?.id,
  agent: first(agents, 'agents')?.id ?? 'momentum-scout',
  strategy: first(strategies, 'strategies')?.id,
  position: first(positions, 'positions')?.id,
  library: first(library, 'items')?.id ?? first(library, 'strategies')?.id,
};
const fill = (r) =>
  r
    .replace('/runs/[id]', `/runs/${sample.id ?? 'none'}`)
    .replace('/agent/[id]', `/agent/${sample.agent}`)
    .replace('/bot/[id]', `/bot/${sample.agent}`)
    .replace('/strategy/[id]', `/strategy/${sample.strategy ?? 'none'}`)
    .replace('/auto-close/[id]', `/auto-close/${sample.position ?? 'none'}`)
    .replace('/position/[id]', `/position/${sample.position ?? 'none'}`)
    .replace('/strategy-library/[id]', `/strategy-library/${sample.library ?? 'none'}`)
    .replace(/\/(audit|explain)\/\[seq\]/, (_m, p) => `/${p}/${sample.seq ?? 1}`)
    .replace('/order/[symbol]', '/order/WMON')
    .replace('/legal/[doc]', '/legal/terms')
    .replace(/\[symbol\]/g, 'MON')
    .replace(/\[classId\]/g, 'crypto')
    .replace(/\[id\]/g, 'none');

// ------------------------------------------------------------------ every route
const ONBOARDING_DONE = new Set(['/welcome', '/wallet', '/fund', '/delegate']);
let notHereTaken = false;
for (const r of routes()) {
  const url = fill(r);
  if (ONLY && !ONLY.some((o) => url === o || url.startsWith(`${o}/`))) continue;
  if (!ONLY && ONBOARDING_DONE.has(url)) continue;
  try {
    await go(url);
    await page.waitForTimeout(SETTLE_MS);
    // A screen still showing skeletons is photographed once they are gone — the briefing reads the news (~12 s), a
    // backtest computes on real history — or after 15 s, when the skeleton is what a person would see too.
    for (let i = 0; i < 30; i++) {
      const loading = await page.locator('[aria-label="Loading"]').filter({ visible: true }).count();
      if (loading === 0) break;
      await page.waitForTimeout(500);
    }
    const text = await page.evaluate(() => document.body.innerText);
    if (/Not in this app yet|That screen has nothing behind it here/.test(text)) {
      if (notHereTaken) continue;
      notHereTaken = true;
      await shot('safety', 'not-here', url, 'a route this build hides');
      continue;
    }
    await shot(areaOf(url), url, url);
  } catch (e) {
    console.log(`✗ ${url}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  }
}

// ------------------------------------------------------------------ offline, then stopped
if (WALK) {
  await page.route(`${API}/**`, (route) => route.abort());
  for (const r of ['/', '/portfolio']) {
    await go(r);
    await page.waitForTimeout(6000);
    await shot('states', `${slug(r)}-offline`, r, 'the executor unreachable');
  }
  await page.unroute(`${API}/**`);
  await go('/safety');
  const hold = v(page.getByText('Hold to stop all trading', { exact: true }));
  await hold.waitFor({ timeout: T.ui });
  await shot('states', 'safety-live', '/safety', 'before the stop');
  const box = await hold.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2500);
  await page.mouse.up();
  await v(page.getByText('Trading stopped', { exact: true })).waitFor({ timeout: T.chain });
  await shot('states', 'safety-stopped', '/safety', 'after hold-to-stop, read back from the chain');
}

writeFileSync(join(OUT, ONLY ? 'manifest-partial.json' : 'manifest.json'), JSON.stringify({ taken: new Date().toISOString(), viewports: VIEWPORTS, sizes: SIZES, screens: manifest }, null, 2));
const benign = errors.filter((e) => !/favicon|Failed to load resource|ERR_FAILED|net::/.test(e));
console.log(`\n${manifest.length} screens · console errors outside the offline state: ${benign.length}${benign.length ? `\n  ${[...new Set(benign)].slice(0, 10).join('\n  ')}` : ''}`);
await browser.close();
