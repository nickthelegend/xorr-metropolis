/**
 * The demo video, recorded from the running product on a local fork of Monad mainnet (2026-10-06).
 *
 * It walks the 3-minute script in `docs/SUBMISSION.md` in the order the script gives, in Chromium with a WebAuthn
 * authenticator that has PRF, and records it with Playwright's own recorder: every frame is the real app doing the real
 * thing, with a caption bar under it saying what is happening. Nothing on screen is staged — a beat that fails stops the
 * recording, like the journey (`fork-journey.mjs`), whose steps this follows.
 *
 * Waiting on the chain is not worth watching, so each wait is logged and cut afterwards (ffmpeg), leaving a second
 * either side; everything a viewer should read stays at full length.
 *
 *   sh infra/monad-fork/local-stack.sh up
 *   WEB=http://localhost:8092 API=http://localhost:8790 node e2e/web/record-demo.mjs     # → docs/demo/flows/*.mp4
 *
 * One real run, then every flow cut from it (onboarding, funding, permission and council, the buy, the Perpl desk,
 * History, the stop) and the whole of it as the tour, `00-full-tour.mp4`.
 *
 * The beats that need a live network (the MetaMask plugin in a terminal, the CRE report and the stop on MonadVision)
 * are recorded after the testnet go (docs/DEPLOY-LATER.md §10).
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
const OUT_DIR = process.env.OUT_DIR ?? 'docs/demo/flows';
/**
 * The flows cut from the one recording (2026-10-07), each the beats it is made of. A flow is the real run's own frames
 * for those beats, with the same waits cut — not a re-enactment.
 */
const FLOWS = [
  ['00-full-tour', null],
  ['01-onboarding-passkey', ['open', 'passkey', 'stateless']],
  ['02-funding', ['fund']],
  ['03-permission-and-council', ['grant', 'council']],
  ['04-buy-kuru-or-uniswap', ['markets', 'buy and route']],
  ['05-perpl-desk-long-and-close', ['perps desk', 'long and exits', 'risk']],
  ['06-history-envio', ['history']],
  ['07-stop', ['stop']],
];
/** Each video's height: 1080 lines at most, H.264, so it plays anywhere and stays small. */
const HEIGHT = 1080;
const T = { ui: 60_000, chain: 180_000 };
const VIEW = { width: 390, height: 844 };
const BAR = 112; // the caption bar under the app, in CSS pixels

if (process.env.ENCODE_FROM) {
  // Encode again from a recording already made: its raw video and the beats saved beside it.
  const saved = JSON.parse(readFileSync(join(process.env.ENCODE_FROM, 'beats.json'), 'utf8'));
  encode(saved.raw, saved.beats, saved.cuts, process.env.ENCODE_FROM);
  process.exit(0);
}
const dir = mkdtempSync(join(tmpdir(), 'xorr-demo-'));
const browser = await chromium.launch();
// Recorded at the viewport's own size: a larger video size only pads the picture with grey; it is scaled up at the end.
const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir, size: VIEW } });
const page = await context.newPage();
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

// ------------------------------------------------------------------ captions: a bar under the app, not over it

let current = { title: '', body: '' };
async function paint() {
  await page
    .evaluate(
      ({ title, body, bar }) => {
        let el = document.getElementById('demo-caption');
        if (!el) {
          const style = document.createElement('style');
          style.textContent = `#root{height:calc(100vh - ${bar}px)!important;overflow:hidden}
            #demo-caption{position:fixed;left:0;right:0;bottom:0;height:${bar}px;box-sizing:border-box;padding:12px 16px;
            background:#0b0b0f;border-top:1px solid #2a2a33;color:#f4f4f6;font:500 15px/1.35 -apple-system,system-ui,sans-serif;z-index:2147483647;pointer-events:none}
            #demo-caption b{display:block;color:#a78bfa;font-size:12px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}`;
          document.head.appendChild(style);
          el = document.createElement('div');
          el.id = 'demo-caption';
          document.body.appendChild(el);
        }
        el.innerHTML = `<b></b><span></span>`;
        el.querySelector('b').textContent = title;
        el.querySelector('span').textContent = body;
      },
      { ...current, bar: BAR },
    )
    .catch(() => undefined);
}
page.on('domcontentloaded', () => void paint());
async function caption(title, body) {
  current = { title, body };
  await paint();
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
await beat('open', async () => {
  await wait(page.goto(`${WEB}/wallet`, { waitUntil: 'domcontentloaded', timeout: 180_000 }));
  await wait(page.getByTestId('passkey-create').waitFor({ timeout: 180_000 }));
  cuts.push([0, now()]); // the blank page and the first load
  await caption('xorr on Monad', 'A council of AI agents trades for you — inside a limit the chain enforces. Recorded live on a fork of Monad mainnet.');
  await hold(5);
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
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 380);
    await hold(1.6);
  }
  const kimiOff = await page.getByTestId('council-strategist-off').isVisible().catch(() => false);
  await caption('The Strategist seat', kimiOff ? 'Kimi decides split rounds when its key is set. Here it has none, and the screen says so — no stand-in vote.' : 'Kimi weighs the four desks and decides split rounds. It cannot veto.');
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

const video = page.video();
await context.close();
await browser.close();
const raw = await video.path();
const benign = errors.filter((e) => !/favicon/.test(e));
console.log(`console errors: ${benign.length}${benign.length ? `\n  ${benign.join('\n  ')}` : ''}`);

// The timings first, so an encode that fails can be run again from the same recording (ENCODE_FROM=<dir>).
writeFileSync(join(dir, 'beats.json'), JSON.stringify({ beats, cuts, raw }, null, 2));
encode(raw, beats, cuts, dir);
process.exit(benign.length ? 1 : 0);

// ------------------------------------------------------------------ cut the waits and the blank page loads, encode
/** Cut the waits and the blank page loads from the raw recording, and write the tour and every flow. */
function encode(raw, beats, cuts, dir) {
  /*
   * A page load paints the browser's blank white for a moment before the app draws, and the app is black. Those frames are
   * found by the APP's area alone — the caption bar under it is dark and, averaged in, hid them (the 6 Oct cut kept seven
   * flashes for exactly that reason) — and cut like any wait.
   */
  const appH = VIEW.height - BAR;
  const stats = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', raw, '-vf', `fps=25,crop=iw:${appH}:0:0,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`, '-f', 'null', '-'], { maxBuffer: 64 * 1024 * 1024 }).toString();
  const white = [];
  let t = null;
  for (const line of stats.split('\n')) {
    const tm = line.match(/pts_time:([\d.]+)/);
    if (tm) t = Number(tm[1]);
    const ym = line.match(/YAVG=([\d.]+)/);
    if (ym && t !== null && Number(ym[1]) >= 200) white.push([t - 0.03, t + 0.05]);
  }
  // One range per run of excluded time: a page load is dozens of consecutive blank frames, and an expression with a term
  // per frame is too large for ffmpeg to allocate (the first 7 Oct run failed exactly so).
  const excluded = [...cuts, ...white]
    .sort((a, b) => a[0] - b[0])
    .reduce((out, [a, b]) => {
      const last = out[out.length - 1];
      if (last && a <= last[1] + 0.05) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
      return out;
    }, []);
  const notExcluded = `not(${excluded.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join('+') || '0'})`;
  mkdirSync(OUT_DIR, { recursive: true });
  const made = [];
  for (const [name, names] of FLOWS) {
    const windows = names ? beats.filter((b) => names.includes(b.name)).map((b) => [b.at, b.end]) : null;
    if (names && !windows.length) continue;
    const inFlow = windows ? `(${windows.map(([a, b]) => `between(t,${a.toFixed(2)},${b.toFixed(2)})`).join('+')})*` : '';
    const file = join(OUT_DIR, `${name}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', `fps=25,select='${inFlow}${notExcluded}',setpts=N/25/TB,scale=-2:${HEIGHT}:flags=lanczos`, '-an', '-c:v', 'libx264', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', file]);
    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
    made.push({ file, seconds: Number(seconds.toFixed(1)) });
    console.log(`${file}: ${seconds.toFixed(1)} s`);
  }
  writeFileSync(join(OUT_DIR, 'flows.json'), JSON.stringify({ recorded: new Date().toISOString(), beats, cuts: cuts.length, blankFramesCut: white.length, videos: made }, null, 2));
  console.log(`cut ${cuts.length} waits and ${white.length} blank frames; raw ${raw}; files ${readdirSync(dir).join(', ')}`);
}
