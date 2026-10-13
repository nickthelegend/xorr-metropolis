/**
 * The live demo take: the hosted app on Monad testnet, signed out, at 1920×1080, with a visible animated cursor.
 *
 * Frames come from Chrome's screencast (JPEG q92, each with its own timestamp) so text stays sharp; build.py turns them
 * into constant 30 fps. Each scene holds at least its narration length (work/timing.json) and logs where it starts.
 *   node capture.mjs   → work/capture/frames/*.jpg, work/capture/frames.json, work/capture/markers.json
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = 'https://xorr-metropolis.vercel.app';
const API = 'https://executor-monad-testnet-production.up.railway.app';
const OUT = path.join(HERE, 'work/capture');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
const timing = JSON.parse(fs.readFileSync(path.join(HERE, 'work/timing.json'), 'utf8'));
const dur = Object.fromEntries(timing.scenes.map((s) => [s.id, s.end - s.start]));
const round = (await (await fetch(`${API}/council/public`)).json()).round;
const STOP_TX = '0x6babda2cd2223fff91024027e3bc60c8fd72962185a87f8c7e90e9bf1bfd367e';
const explorer = (h) => `https://testnet.monadexplorer.com/tx/${h}`;

const CURSOR = `
(() => {
  if (window.__cur) return; window.__cur = 1;
  const add = () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.6 14.8 L10.6 21.6 L13.6 20.3 L10.7 13.6 L17 13.6 Z" fill="#fff" stroke="#0b0b10" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(960px,540px)', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.55))' });
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark' });
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

let cdp;
const frames = [];
let n = 0;
async function attach() {
  cdp = await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame', async (f) => {
    const name = `f${String(n++).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(OUT, 'frames', name), Buffer.from(f.data, 'base64'));
    frames.push({ name, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
}

// The cursor: eased moves, ~60 steps a second.
let mx = 960, my = 540;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
async function moveTo(x, y, ms = 900) {
  const sx = mx, sy = my, steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps);
    await page.mouse.move(sx + (x - sx) * k, sy + (y - sy) * k);
    await page.waitForTimeout(16);
  }
  mx = x; my = y;
}
async function moveToEl(loc, ms = 900, dx = 0.5, dy = 0.5) {
  const b = await loc.boundingBox();
  if (b) await moveTo(b.x + b.width * dx, b.y + b.height * dy, ms);
  return b;
}
async function click(loc, ms = 900) {
  await moveToEl(loc, ms);
  await page.waitForTimeout(220);
  await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up();
}
// A smooth wheel scroll over the phone column.
async function scroll(px, ms = 2200) {
  const steps = Math.round(ms / 33);
  let done = 0;
  for (let i = 1; i <= steps; i++) {
    const target = Math.round(px * ease(i / steps));
    await page.mouse.wheel(0, target - done); done = target;
    await page.waitForTimeout(33);
  }
}
const markers = [];
const now = () => Date.now() / 1000;
async function scene(id, fn) {
  const t0 = now();
  markers.push({ id, t: t0 });
  console.log(`▶ ${id} (${dur[id].toFixed(1)} s)`);
  await fn();
  const left = dur[id] + 1.2 - (now() - t0);
  if (left > 0) await page.waitForTimeout(left * 1000);
}
async function go(url, ready) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  if (ready) await ready().catch((e) => console.log('  (ready wait:', e.message.slice(0, 80), ')'));
  await page.mouse.move(mx, my);
  await page.waitForTimeout(600);
}
const v = (l) => l.filter({ visible: true }).first();

// Warm the routes so the take never shows a cold load.
for (const r of ['/welcome', '/monad', '/council', '/gauntlet']) await page.goto(WEB + r, { waitUntil: 'networkidle', timeout: 90_000 }).catch(() => {});
await go(WEB + '/welcome', () => v(page.getByText('Get started', { exact: true })).waitFor({ timeout: 60_000 }));
await attach();
await page.waitForTimeout(500);

await scene('welcome', async () => {
  await page.waitForTimeout(800);
  await moveTo(520, 610, 1400);              // the side panel's three promises
  await page.waitForTimeout(1600);
  await moveToEl(v(page.getByText('Get started', { exact: true })), 1300);
  await page.waitForTimeout(1500);
  await moveToEl(v(page.getByText('For judges', { exact: false })), 900);
});

await go(WEB + '/monad', () => v(page.getByTestId('commit-stats')).waitFor({ timeout: 60_000 }));
await scene('monad', async () => {
  await moveToEl(v(page.getByTestId('commit-strip')), 1200, 0.5, 0.45);
  await page.waitForTimeout(6500);
  await moveToEl(v(page.getByTestId('commit-stats')), 900, 0.3, 0.5);
  await page.waitForTimeout(4200);
  await moveTo(1000, 640, 600);
  await scroll(520, 2400);
  await page.waitForTimeout(2600);
  await scroll(560, 2400);
  await page.waitForTimeout(1500);
});

await go(WEB + '/council', () => v(page.getByTestId('council-sample')).waitFor({ timeout: 60_000 }));
await scene('council', async () => {
  await page.waitForTimeout(700);
  await click(v(page.getByTestId('council-sample')), 1100);
  await v(page.getByTestId('replay-proposal')).waitFor({ timeout: 30_000 });
  await moveTo(1290, 300, 900);
  await page.waitForTimeout(1200);
});

await scene('trade', async () => {
  // Wherever the replay is, show the verdict and the fill.
  if (!(await page.getByTestId('replay-outcome').isVisible().catch(() => false))) await click(v(page.getByTestId('replay-all')), 900);
  await page.waitForTimeout(500);
  const out = v(page.getByTestId('replay-outcome'));
  await out.scrollIntoViewIfNeeded().catch(() => {});
  await moveToEl(out, 900, 0.4, 0.4);
  await page.waitForTimeout(8500);
  await go(explorer(round.txHash), () => page.getByText(round.txHash.slice(0, 12), { exact: false }).first().waitFor({ timeout: 45_000 }));
  markers.push({ id: 'trade-explorer', t: now() });
  await moveTo(820, 380, 900);
  await page.waitForTimeout(4500);
});

await go(WEB + '/gauntlet', () => v(page.getByTestId('gauntlet-funnel')).waitFor({ timeout: 60_000 }));
await scene('gauntlet', async () => {
  await moveToEl(v(page.getByTestId('gauntlet-funnel')), 1100, 0.5, 0.35);
  await page.waitForTimeout(4200);
  await moveTo(1000, 700, 600);
  await scroll(420, 2200);
});

await go(explorer(STOP_TX), () => page.getByText(STOP_TX.slice(0, 12), { exact: false }).first().waitFor({ timeout: 45_000 }));
await scene('stop', async () => {
  await moveTo(700, 420, 1200);
  await page.waitForTimeout(3000);
  await moveTo(900, 560, 1000);
});

markers.push({ id: 'end', t: now() });
await cdp.send('Page.stopScreencast').catch(() => {});
await page.waitForTimeout(300);
fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames));
fs.writeFileSync(path.join(OUT, 'markers.json'), JSON.stringify({ markers, round: { id: round.id, txHash: round.txHash, txLink: round.txLink }, errors }, null, 1));
console.log(`${frames.length} frames; page errors: ${errors.length}`);
await browser.close();
