/**
 * The full journey for the Metropolis videos, recorded on the local fork of Monad mainnet at 1920×1080 (2026-10-14).
 *
 * The same beats as e2e/web/record-demo.mjs (passkey, funds, permission, buy routed Kuru vs Uniswap, the council, the Perpl
 * desk, Perpl risk, History from Envio, the gauntlet, Built on Monad, the stop), with three changes for the videos:
 * the desktop layout, a visible cursor that eases to every click, and Chrome's screencast frames (sharp text, each with
 * its time) instead of Playwright's recorder. No caption bar: the narration and captions are added in video/.
 *
 *   sh infra/monad-fork/local-stack.sh up
 *   node video/record-flow.mjs   → video/work/flow/{frames/*.jpg, frames.json, run.json}
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
const OUT_DIR = process.env.OUT_DIR ?? 'video/work/flow';
const T = { ui: 60_000, chain: 180_000 };
const VIEW = { width: 1920, height: 1080 };

const browser = await chromium.launch();
// Recorded at the viewport's own size: a larger video size only pads the picture with grey; it is scaled up at the end.
const CURSOR = `
(() => {
  if (window.__cur) return; window.__cur = 1;
  const add = () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.6 14.8 L10.6 21.6 L13.6 20.3 L10.7 13.6 L17 13.6 Z" fill="#fff" stroke="#0b0b10" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(960px,540px)', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.55))', transition: 'transform .18s cubic-bezier(.3,.7,.4,1)' });
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      Object.assign(r.style, { position: 'fixed', left: e.clientX - 22 + 'px', top: e.clientY - 22 + 'px', width: '44px', height: '44px', borderRadius: '50%', border: '2px solid #9b87ff', background: 'rgba(124,92,255,.18)', zIndex: 2147483646, pointerEvents: 'none', transition: 'transform .45s ease-out, opacity .45s ease-out', transform: 'scale(.4)', opacity: '1' });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.5)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 500);
    }, true);
  };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', add) : add();
})();`;
const context = await browser.newContext({ viewport: VIEW, colorScheme: 'dark' });
await context.addInitScript(CURSOR);
const page = await context.newPage();
// Every click eases the mouse to its target first, so the cursor travels instead of jumping.
let mx = 960, my = 540;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
async function glide(x, y, ms = 650) {
  const sx = mx, sy = my, steps = Math.max(6, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps);
    await page.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k);
    await page.waitForTimeout(16);
  }
  mx = x; my = y;
}
const LocatorProto = Object.getPrototypeOf(page.locator('body'));
const realClick = LocatorProto.click;
LocatorProto.click = async function (opts) {
  try {
    await this.waitFor({ state: 'visible', timeout: opts?.timeout ?? 60_000 });
    await this.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
    const b = await this.boundingBox();
    if (b) { await glide(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(160); }
  } catch { /* the real click reports it */ }
  return realClick.call(this, opts);
};
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 240));
});
page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 240)}`));

const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
});
mkdirSync(join(OUT_DIR, 'frames'), { recursive: true });
const frames = [];
let fn = 0;
cdp.on('Page.screencastFrame', (f) => {
  const name = `f${String(fn++).padStart(6, '0')}.jpg`;
  writeFileSync(join(OUT_DIR, 'frames', name), Buffer.from(f.data, 'base64'));
  frames.push({ name, t: f.metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

// ------------------------------------------------------------------ captions: a bar under the app, not over it

const captions = [];
async function caption(title, body) {
  captions.push({ at: now(), title, body });
}

// ------------------------------------------------------------------ beats, holds and cuts

const cuts = [];
const beats = [];
/** A wait on the chain or the executor: kept a second either side, the middle cut. */
async function wait(promise) {
  const a = now();
  const r = await promise;
  const b = now();
  if (b - a > 2.5) cuts.push([a + 1, b - 1]);
  return r;
}
/** A page load, cut from the film until the screen it opens is ready to look at. */
async function go(path, ready) {
  const a = now();
  await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded', timeout: T.chain });
  await ready().waitFor({ timeout: T.chain });
  const b = now();
  if (b - a > 0.6) cuts.push([a, b - 0.3]);
}
/** Time for a viewer to read what is on screen — counted, so a measured time can leave it out. */
let held = 0;
const hold = (s) => {
  held += s;
  return page.waitForTimeout(s * 1000);
};
async function beat(name, fn) {
  const a = now();
  try {
    await fn();
    beats.push({ name, at: a, end: now() });
    console.log(`✓ ${name}`);
  } catch (e) {
    console.log(`✗ ${name}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    await context.close();
    await browser.close();
    process.exit(1);
  }
}
const v = (l) => l.filter({ visible: true }).first();
const tap = (name) => v(page.getByText(name, { exact: true })).click({ timeout: T.ui });
const text = () => page.evaluate(() => document.body.innerText);

// Warm: a fork answers its first reads slowly; none of that belongs in the film.
for (let ok = 0, i = 0; ok < 3 && i < 120; i++) {
  ok = (await fetch(`${API}/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 1000));
}

let landed = 0;
let heldAtLanding = 0;
// The first minute a judge sees (ROADMAP-WIN F2): what xorr is, then Monad's blocks going final, live (MONAD-TECH 1).
await beat('explainer', async () => {
  await wait(page.goto(`${WEB}/welcome`, { waitUntil: 'domcontentloaded', timeout: 180_000 }));
  await wait(v(page.getByTestId('welcome-start')).waitFor({ timeout: 180_000 }));
  cuts.push([0, now()]); // the blank page and the first load
  await caption('xorr on Monad', 'A council of AI agents trades for you — inside a limit the chain enforces. Recorded live on a fork of Monad mainnet.');
  await hold(4);
  await v(page.getByTestId('welcome-start')).click({ timeout: T.ui });
  await caption('How xorr works', 'Three steps before sign-up: a council votes on every trade, inside a limit the chain enforces, on Monad.');
  await hold(2.5);
  await v(page.getByTestId('how-next-1')).click({ timeout: T.ui });
  await hold(2.5);
  await v(page.getByTestId('how-next-2')).click({ timeout: T.ui });
  await wait(v(page.getByTestId('commit-stats')).waitFor({ timeout: T.ui }));
  const stats = await v(page.getByTestId('commit-stats')).innerText();
  const m = stats.match(/Voted in ([\d.]+ m?s) · final in ([\d.]+ m?s)/);
  await caption('Monad mainnet, live', m ? `Each block Proposed → Voted → Final, from Monad’s own stream: voted in ${m[1]}, final in ${m[2]}.` : 'Each block Proposed → Voted → Final, from Monad’s own stream.');
  await hold(5.5);
});

await beat('open', async () => {
  await go('/wallet', () => page.getByTestId('passkey-create'));
  await hold(1);
});

await beat('passkey', async () => {
  await caption('Mera passkey', 'One passkey, no email, no seed phrase. The wallet key comes from the passkey itself.');
  landed = Date.now();
  heldAtLanding = held;
  await page.getByTestId('passkey-create').click({ timeout: T.ui });
  await wait(page.getByText('Continue — add funds', { exact: true }).waitFor({ timeout: T.chain }));
  await hold(3);
});

await beat('fund', async () => {
  await caption('Test funds', 'Your own address, and a thousand test dollars from the fork — real USDC, moved on a copy of Monad.');
  await tap('Continue — add funds');
  const get = v(page.getByText(/^Get [\d,]+ test USDC$/));
  await wait(get.waitFor({ timeout: T.ui }));
  await hold(1.5);
  await get.click();
  await wait(v(page.getByText(/^Added [\d,.]+ USDC/)).waitFor({ timeout: T.chain }));
  await hold(2.5);
});

await beat('grant', async () => {
  await caption('The permission', 'A daily limit, an end date, the venues. Mera’s signing session signs it — no wallet popup.');
  await tap('Continue — set the limits');
  await hold(3);
  await tap('Sign this permission');
  await wait(page.waitForURL((u) => !u.pathname.includes('delegate'), { timeout: T.chain }));
  // The pauses this film adds for reading are not part of the time.
  const ttft = ((Date.now() - landed) / 1000 - (held - heldAtLanding)).toFixed(1);
  await caption('Permission confirmed on Monad', `${ttft} s from the app on screen to a confirmed on-chain permission: account, test funds, the grant signed.`);
  await hold(4);
});

await beat('stateless', async () => {
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('xorr.mera.v1') ?? '{}').address);
  await caption('The stateless test', `Browser storage wiped. The passkey alone brings back ${before.slice(0, 6)}…${before.slice(-4)}.`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await go('/wallet', () => v(page.getByTestId('passkey-sign-in')));
  await hold(1.5);
  await v(page.getByTestId('passkey-sign-in')).click({ timeout: T.ui });
  await wait(page.waitForFunction(() => Boolean(JSON.parse(localStorage.getItem('xorr.mera.v1') ?? '{}').address), null, { timeout: T.chain }));
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('xorr.mera.v1') ?? '{}').address);
  if (after !== before) throw new Error(`a different account came back: ${after}`);
  await caption('The stateless test', `Same account: ${after.slice(0, 6)}…${after.slice(-4)}. Nothing that signs was ever stored.`);
  await hold(3);
});

await beat('home', async () => {
  await go('/', () => v(page.getByText(/^Add funds$/)));
  await caption('Home', 'Your balance, the agents, and the next step where the eye already is.');
  await hold(4);
});

await beat('markets', async () => {
  await go('/markets', () => v(page.getByText(/^MON$/)));
  await caption('Markets', 'Spot prices, live. Every buy is checked against Chainlink before it fills.');
  await hold(3.5);
});

await beat('buy and route', async () => {
  await caption('Buy $20 of MON', 'Every order measures Kuru’s on-chain order book against Uniswap v3 and fills on the better one.');
  await go('/order/MON', () => v(page.getByRole('button', { name: /^Buy \$/ })));
  for (let i = 0; i < 7; i++) await v(page.getByLabel('Delete', { exact: true })).click();
  await v(page.getByLabel('2', { exact: true })).click();
  await v(page.getByLabel('0', { exact: true })).click();
  await hold(1.5);
  await page.getByRole('button', { name: 'Buy $20 of WMON' }).click({ timeout: T.ui });
  await wait(v(page.getByText(/^Bought /)).waitFor({ timeout: T.chain }));
  await hold(2);
  await go('/runs', () => v(page.getByText(/^W?MON$/)));
  await v(page.getByText(/^W?MON$/)).click({ timeout: T.ui });
  await wait(v(page.getByText(/^Filled$/)).waitFor({ timeout: T.ui }));
  const routing = await page.getByTestId('run-routing').innerText({ timeout: 10_000 }).catch(() => null);
  await caption('What routing was worth', routing ?? 'One venue measured for this fill.');
  await hold(5);
  // The speed receipt (ROADMAP-WIN F1, MONAD-TECH 2): the fill's time with its receipt from the send, and its gas on Monad.
  const card = v(page.getByTestId('speed-receipt'));
  await wait(card.waitFor({ timeout: T.ui }));
  await card.scrollIntoViewIfNeeded();
  const ms = await v(page.getByTestId('speed-ms')).innerText().catch(() => '');
  const cost = await v(page.getByTestId('speed-cost')).innerText().catch(() => '');
  const exec = ms.trim() || undefined;
  const usd = cost.match(/(\$[\d.]+) fee/)?.[1];
  const x = cost.match(/([\d,]+)× cheaper/)?.[1];
  await caption(
    'The speed receipt',
    `${exec ? `Executed in ${exec} on the fork, its receipt returned with the send. ` : ''}${usd ? `Its gas: ${usd} on Monad${x ? `, ${x}× less than the same gas on Ethereum` : ''}.` : ''}`.trim() || 'Every fill carries its speed and its cost.',
  );
  await hold(6);
});

await beat('council', async () => {
  await go('/council', () => v(page.getByTestId('council-convene')));
  await caption('The council', 'Four desks vote on Monad’s own numbers: Chainlink, Kuru’s book, Perpl funding, your limit.');
  await hold(2);
  await v(page.getByTestId('council-convene')).click({ timeout: T.ui });
  await wait(v(page.getByText(/^Approved \d–\d\.|^Not approved|^Vetoed/)).waitFor({ timeout: T.chain }));
  const body = await text();
  const verdict = body.match(/Approved \d–\d\.|Not approved[^\n]*|Vetoed[^\n]*/)?.[0] ?? '';
  const outcome = body.match(/\n(Executed|Not executed|Failed|Refused)\n/)?.[1] ?? '';
  // The caption says what this round did: a round the council turned down sent nothing, and must not be described as a fill.
  await caption(
    'The council',
    /Executed/.test(outcome)
      ? `${verdict} ${outcome}. The vote and the fill land within a second — Monad makes a block every 300 ms.`
      : `${verdict.replace(/\.$/, '')} — so nothing was sent. The council is the brake as well as the trigger.`,
  );
  await hold(4);
  // The replay (ROADMAP-WIN F3): the round again, seat by seat, with what each desk read. Played, not cut.
  await v(page.getByTestId('council-replay')).click({ timeout: T.ui });
  await wait(v(page.getByTestId('replay-proposal')).waitFor({ timeout: T.ui }));
  await caption('Replay', 'The round again, seat by seat: what each desk read when it voted, then the verdict and what the chain did.');
  await v(page.getByTestId('replay-outcome')).waitFor({ timeout: 30_000 });
  await hold(3);
});

await beat('perps desk', async () => {
  await go('/perps', () => page.getByTestId('perps-fund-test'));
  await caption('Perps on Perpl', 'AUSD as margin, and a desk that is Perpl’s own DelegatedAccount: the agent can trade it, never withdraw.');
  await page.getByTestId('perps-fund-test').click({ timeout: T.ui });
  await wait(v(page.getByText(/AUSD \(fork\)|AUSD/)).waitFor({ timeout: T.chain }));
  await hold(2);
  await page.getByTestId('perps-create').click({ timeout: T.ui });
  await wait(page.getByTestId('perps-open-account').waitFor({ timeout: T.chain }));
  await page.getByTestId('perps-open-account').click({ timeout: T.chain });
  const allow = page.getByTestId('perps-allow');
  const long = page.getByTestId('perps-open_long');
  await wait(allow.or(long).filter({ visible: true }).first().waitFor({ timeout: T.chain }));
  if (await allow.isVisible()) {
    await allow.click();
    await wait(v(long).waitFor({ timeout: T.chain }));
  }
  await hold(2);
});

await beat('long and exits', async () => {
  await caption('Long MON', 'An IOC order through the desk, priced from the book Perpl’s Exchange holds right now.');
  await v(page.getByText(/^MON$/)).click({ timeout: T.ui }).catch(() => undefined);
  await page.getByTestId('perps-open_long').click({ timeout: T.ui });
  const close = v(page.getByText(/^Close long/));
  await wait(close.waitFor({ timeout: T.chain }));
  await close.scrollIntoViewIfNeeded();
  await caption('An open position', 'Entry, mark and distance to liquidation — read from Perpl’s Exchange.');
  await hold(4);
  const exits = page.getByTestId('perps-exits');
  if (await exits.count()) {
    await exits.scrollIntoViewIfNeeded();
    await caption('Standing exits, every 30 seconds', 'Close near liquidation, at a stop-loss or take-profit, or when a loser pays too much funding.');
    await hold(4.5);
  }
  await close.scrollIntoViewIfNeeded();
  await close.click();
  await wait(page.getByText('No open positions. Long or short above, or let an agent do it.').waitFor({ timeout: T.chain }));
  await caption('Closed', 'The margin is back in the desk, which only its owner can withdraw from.');
  await hold(2.5);
});

await beat('risk', async () => {
  await caption('Perpl risk', 'Every Perpl market: funding paid and its yearly pace, open interest, spread, staleness — and what deserves a look.');
  await go('/perpl', () => v(page.getByText(/^BTC\b/)));
  await hold(3);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 420);
    await hold(1.5);
  }
});

await beat('history', async () => {
  await caption('The on-chain record, indexed by Envio', 'Grants, spends and desks, indexed by Envio HyperIndex as the blocks arrive.');
  for (let i = 0; i < 20; i++) {
    const card = page.getByTestId('history-indexed').filter({ visible: true });
    await go('/history', () => v(page.getByText('History', { exact: true })));
    await wait(card.waitFor({ timeout: 15_000 }).catch(() => undefined));
    if ((await card.count()) && /spent over \d+ orders?/.test(await card.innerText())) {
      await card.scrollIntoViewIfNeeded();
      await hold(5);
      return;
    }
    await wait(page.waitForTimeout(3000));
  }
  throw new Error('History never showed the indexed record');
});

// The research behind every strategy the agents run (ROADMAP-WIN F5).
await beat('gauntlet', async () => {
  await go('/gauntlet', () => v(page.getByTestId('gauntlet-funnel')));
  await caption('The strategy gauntlet', '313 strategies backtested, then tested on data they never saw. 10 survived — and each of the rest says where it fell.');
  await hold(5);
});

// Everything xorr uses of Monad itself, read live (ROADMAP-WIN F4, MONAD-TECH 1–8).
await beat('built on monad', async () => {
  await go('/monad', () => v(page.getByTestId('monad-item-commits')));
  await caption('Built on Monad', 'What xorr uses of Monad itself — each read live, each saying where it runs.');
  await hold(3);
  await v(page.getByTestId('monad-passkey-check')).scrollIntoViewIfNeeded();
  await v(page.getByTestId('monad-passkey-check')).click({ timeout: T.ui });
  await wait(v(page.getByTestId('monad-passkey-result')).waitFor({ timeout: T.ui }));
  await v(page.getByTestId('monad-passkey-result')).scrollIntoViewIfNeeded();
  await caption('Your passkey, checked by Monad', 'The passkey signs a challenge, and Monad’s P256 precompile verifies the signature — on mainnet and on the fork.');
  await hold(4.5);
  await v(page.getByTestId('monad-item-staking')).scrollIntoViewIfNeeded();
  await caption('Staking and x402', 'Native staking read from the 0x1000 precompile; other agents pay per call for the council’s read through Monad’s x402 facilitator.');
  await hold(3);
  await v(page.getByTestId('monad-item-x402')).scrollIntoViewIfNeeded();
  await hold(2.5);
});

await beat('stop', async () => {
  await caption('One hold stops everything', 'The permission is revoked and the desk’s operator removed — on chain.');
  const hold2 = v(page.getByText('Hold to stop all trading', { exact: true }));
  await go('/safety', () => hold2);
  await hold(1.5);
  const box = await hold2.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(2500);
  await page.mouse.up();
  await wait(v(page.getByText('Trading stopped', { exact: true })).waitFor({ timeout: T.chain }));
  const after = await page.evaluate(async (api) => {
    const { token } = JSON.parse(localStorage.getItem('xorr.mera.v1') ?? '{}');
    return fetch(`${api}/perps/desk`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
  }, API);
  if (after.operatorActive !== false) throw new Error('the desk operator is still active');
  await caption('Trading stopped', 'Read back from the chain: permission revoked, desk operator inactive. xorr — the agents trade; the chain keeps the limit.');
  await hold(6);
});

await cdp.send('Page.stopScreencast').catch(() => {});
await context.close();
await browser.close();
const benign = errors.filter((e) => !/favicon/.test(e));
console.log(`console errors: ${benign.length}${benign.length ? `\n  ${benign.join('\n  ')}` : ''}`);
writeFileSync(join(OUT_DIR, 'frames.json'), JSON.stringify(frames));
writeFileSync(join(OUT_DIR, 'run.json'), JSON.stringify({ t0: t0 / 1000, beats, cuts, captions, errors: benign }, null, 1));
console.log(`${frames.length} frames, ${beats.length} beats, ${cuts.length} waits`);
