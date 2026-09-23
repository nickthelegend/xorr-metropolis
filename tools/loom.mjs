/**
 * The loom: a short, plain-spoken walk through xorr, recorded from the deployed apps.
 *
 * One idea per scene. Each scene is the real signed-in app (the Robinhood Chain build, and the Arbitrum build for the
 * GMX hedge), a big caption that says the idea in words, and a voice reading the same words. Loading is cut out: each
 * scene's footage starts once its page has settled, so the video never shows a spinner.
 *
 *   node tools/loom-auth.mjs     sign in once, off camera
 *   node tools/loom.mjs          → docs/demo/xorr-loom.mp4 (1920×1080, voice-over)
 *
 * Needs macOS `say` for the voice and ffmpeg (no drawtext needed: captions are rendered as images by the browser).
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ORIGINS, STATE } from './loom-auth.mjs';

const OUT = path.resolve(import.meta.dirname, '../docs/demo');
const WORK = path.join(OUT, '.loom');
const FINAL = path.join(OUT, 'xorr-loom.mp4');
const VOICE = process.env.LOOM_VOICE ?? 'Samantha';
const RATE = process.env.LOOM_RATE ?? '178';

const PHONE = { width: 402, height: 874 };
const W = 1920;
const H = 1080;
/** The phone on the canvas: 980 tall, its width in the app's own proportion. */
const PH = 980;
const PW = Math.round((PHONE.width / PHONE.height) * PH / 2) * 2;
const PX = 250;
const PY = (H - PH) / 2;
const LEAD = 0.35; // seconds of quiet before each line
const TAIL = 0.9; // seconds held after it

const RH = ORIGINS.robinhood;
const ARB = ORIGINS.arbitrum;

/** Smoothly scroll the list under the pointer, so the motion reads on camera. */
const scroll = (dy) => async (page) => {
  await page.mouse.move(PHONE.width / 2, PHONE.height * 0.7);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, dy / 12);
    await page.waitForTimeout(40);
  }
};

const SCENES = [
  {
    id: 'welcome',
    url: `${RH}/welcome`,
    title: 'Meet xorr',
    say: 'This is xorr. A I agents trade tokenized stocks for you, and they can never take your money.',
    text: 'AI agents trade tokenized stocks for you. They can never take your money.',
  },
  {
    id: 'home',
    url: `${RH}/`,
    title: 'Your own wallet',
    say: 'You sign in with just an email, and you get a wallet that is yours.',
    text: 'Sign in with an email. You get a wallet that only you control.',
  },
  {
    id: 'stocks',
    url: `${RH}/xstocks`,
    title: 'Real stock tokens',
    say: 'These are stock tokens on Robinhood Chain. Nvidia, Tesla, Apple, and the S and P 500.',
    text: 'Stock tokens on Robinhood Chain: NVIDIA, Tesla, Apple, the S&P 500.',
  },
  {
    id: 'nvda',
    url: `${RH}/xstock/NVDA`,
    title: 'Every price, checked twice',
    say: 'Before any trade, the pool price is checked against Chainlink. If they disagree, nothing trades.',
    text: 'The pool price is checked against Chainlink. If they disagree, nothing trades.',
  },
  {
    id: 'roster',
    url: `${RH}/bot/roster`,
    title: 'Hire an agent',
    say: 'Hire an agent. Each one has its own strategy, and its own wallet.',
    text: 'Each agent has its own strategy and its own wallet.',
  },
  {
    id: 'agent',
    url: `${RH}/agent/momentum-scout`,
    title: 'You set its limit',
    say: 'You give it a daily limit. Here, one hundred dollars a day. The smart contract enforces it, not us.',
    text: '$100 a day, enforced by the smart contract on chain. Not by us.',
  },
  {
    id: 'council',
    url: `${RH}/council`,
    title: 'Four checks vote',
    say: 'Before every trade, four checks vote. All four said yes, so the agent bought, and signed it with its own wallet.',
    text: 'All four said yes, so the agent traded, signed by its own wallet. The transaction is right there.',
  },
  {
    id: 'veto',
    url: null, // stays on the council and scrolls
    before: scroll(420),
    title: 'One no stops it',
    say: 'When a check says no, like here, nothing trades.',
    text: 'The Risk Keeper vetoed this one, so nothing was sent.',
  },
  {
    id: 'holdings',
    url: `${RH}/holdings`,
    title: 'Yours to keep',
    say: 'Everything the agents buy stays in your wallet.',
    text: 'What the agents buy stays in your wallet.',
  },
  {
    id: 'hedge',
    url: `${ARB}/hedge`,
    title: 'Hedge on GMX',
    say: 'On Arbitrum, the Hedge Desk opens and closes GMX positions for your account.',
    text: 'On Arbitrum, the Hedge Desk opens and closes GMX positions. They stay yours.',
  },
  {
    id: 'safety',
    url: `${RH}/safety`,
    title: 'Stop everything',
    say: 'And one tap stops every agent, right on the chain.',
    text: 'One tap stops every agent, on chain.',
  },
  {
    id: 'end',
    url: null,
    end: true,
    say: 'xorr. Your money, your limits, and agents that show their work.',
  },
];

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const durationOf = (file) => Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The voice: one clip per scene, and how long each runs. */
function voice() {
  for (const s of SCENES) {
    s.audio = path.join(WORK, `${s.id}.aiff`);
    execFileSync('say', ['-v', VOICE, '-r', RATE, '-o', s.audio, s.say]);
    s.hold = LEAD + durationOf(s.audio) + TAIL;
  }
}

const FONT = `-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif`;
const LIME = '#c6f432';

/** The canvas, the phone's rounded mask, one caption per scene and the end card, drawn by the browser. */
async function art(browser) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const shot = async (file, html, omitBackground = false) => {
    await page.setContent(`<html><body style="margin:0;width:${W}px;height:${H}px;${omitBackground ? 'background:transparent' : ''}">${html}</body></html>`);
    await page.screenshot({ path: file, omitBackground });
  };

  await shot(
    path.join(WORK, 'bg.png'),
    `<div style="position:absolute;inset:0;background:radial-gradient(1200px 800px at 18% 50%, #16200a 0%, #050505 60%, #000 100%)"></div>
     <div style="position:absolute;left:${PX - 10}px;top:${PY - 10}px;width:${PW + 20}px;height:${PH + 20}px;border-radius:54px;background:#111;border:2px solid #2a2a2a;box-shadow:0 30px 120px rgba(198,244,50,.10)"></div>
     <div style="position:absolute;left:880px;bottom:60px;font:500 24px ${FONT};color:#5b5b5b;letter-spacing:.3px">xorr.finance · Arbitrum Open House Singapore</div>`,
  );
  await shot(
    path.join(WORK, 'mask.png'),
    `<div style="position:absolute;inset:0;background:#000"></div><div style="position:absolute;left:0;top:0;width:${PW}px;height:${PH}px;border-radius:44px;background:#fff"></div>`,
  );
  const steps = SCENES.filter((s) => !s.end);
  for (const [i, s] of steps.entries()) {
    s.caption = path.join(WORK, `cap-${s.id}.png`);
    await shot(
      s.caption,
      `<div style="position:absolute;left:880px;top:0;bottom:0;width:900px;display:flex;flex-direction:column;justify-content:center">
         <div style="font:700 26px ${FONT};color:${LIME};letter-spacing:2px">STEP ${i + 1} OF ${steps.length}</div>
         <div style="font:800 76px/1.05 ${FONT};color:#fff;margin-top:22px;letter-spacing:-1.5px">${esc(s.title)}</div>
         <div style="font:500 40px/1.35 ${FONT};color:#b9b9b9;margin-top:30px;max-width:860px">${esc(s.text)}</div>
       </div>`,
      true,
    );
  }
  const end = SCENES.find((s) => s.end);
  end.caption = path.join(WORK, 'end.png');
  await shot(
    end.caption,
    `<div style="position:absolute;inset:0;background:radial-gradient(900px 600px at 50% 45%, #16200a 0%, #000 70%);display:flex;flex-direction:column;align-items:center;justify-content:center">
       <div style="font:900 150px ${FONT};color:#fff;letter-spacing:-4px">xorr<span style="color:${LIME}">.</span></div>
       <div style="font:600 46px ${FONT};color:#d8d8d8;margin-top:18px">Your money. Your limits.</div>
       <div style="font:600 46px ${FONT};color:#d8d8d8;margin-top:6px">Agents that show their work.</div>
       <div style="font:500 26px ${FONT};color:#6b6b6b;margin-top:56px">Robinhood Chain stock tokens · GMX on Arbitrum · one wallet per agent</div>
     </div>`,
  );
  await ctx.close();
}

/** The footage: each scene held for its line, its start and end on the recording's clock. */
async function record(browser) {
  const ctx = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    storageState: STATE,
    recordVideo: { dir: WORK, size: PHONE }, // Playwright never upscales frames, so the video is the viewport's own size
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  for (const s of SCENES) {
    if (s.url) {
      await page.goto(s.url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
      await page.waitForTimeout(2_000); // data lands; this part is cut
    }
    if (s.before) {
      s.start = now();
      await s.before(page);
    } else {
      s.start = now();
    }
    await page.waitForTimeout(Math.max(0, s.hold * 1000 - (now() - s.start) * 1000));
    s.stop = s.start + s.hold;
    await page.waitForTimeout(150);
    console.log(`  ${s.id.padEnd(9)} ${s.start.toFixed(2)}s  +${s.hold.toFixed(2)}s  ${page.url()}`);
  }
  const video = page.video();
  await ctx.close();
  return video.path();
}

/** Cut, place on the canvas, caption, voice. */
function compose(raw) {
  const n = SCENES.length;
  const total = SCENES.reduce((a, s) => a + s.hold, 0);
  const args = ['-y', '-loglevel', 'error', '-i', raw, '-loop', '1', '-i', path.join(WORK, 'bg.png'), '-loop', '1', '-i', path.join(WORK, 'mask.png')];
  for (const s of SCENES) args.push('-loop', '1', '-i', s.caption);
  for (const s of SCENES) args.push('-i', s.audio);
  const capIn = (i) => 3 + i;
  const audIn = (i) => 3 + n + i;

  const f = [];
  f.push(`[0:v]split=${n}${SCENES.map((_, i) => `[r${i}]`).join('')}`);
  SCENES.forEach((s, i) => f.push(`[r${i}]trim=start=${s.start.toFixed(3)}:duration=${s.hold.toFixed(3)},setpts=PTS-STARTPTS,fps=30[v${i}]`));
  f.push(`${SCENES.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0,scale=${PW}:${PH}:flags=lanczos,format=rgba[phone]`);
  f.push(`[2:v]crop=${PW}:${PH}:0:0,format=gray,fps=30[m]`);
  f.push(`[phone][m]alphamerge[ph]`);
  f.push(`[1:v]fps=30,format=rgba[bg]`);
  f.push(`[bg][ph]overlay=${PX}:${PY}:shortest=1[c0]`);
  let t = 0;
  let last = 'c0';
  SCENES.forEach((s, i) => {
    const a = t;
    const b = t + s.hold;
    t = b;
    const next = `c${i + 1}`;
    const fadeIn = s.end ? `,fade=t=in:st=${a.toFixed(3)}:d=0.5:alpha=1` : '';
    f.push(`[${capIn(i)}:v]fps=30,format=rgba${fadeIn}[k${i}]`);
    f.push(`[${last}][k${i}]overlay=0:0:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[${next}]`);
    last = next;
  });
  f.push(`[${last}]fade=t=in:st=0:d=0.5,fade=t=out:st=${(total - 0.6).toFixed(3)}:d=0.6,format=yuv420p[vout]`);
  SCENES.forEach((s, i) =>
    f.push(`[${audIn(i)}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round(LEAD * 1000)}:all=1,apad=whole_dur=${s.hold.toFixed(3)},atrim=0:${s.hold.toFixed(3)}[a${i}]`),
  );
  f.push(`${SCENES.map((_, i) => `[a${i}]`).join('')}concat=n=${n}:v=0:a=1,loudnorm=I=-16:TP=-1.5[aout]`);

  args.push('-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(3));
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', FINAL);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  return total;
}

await fs.mkdir(WORK, { recursive: true });
await fs.access(STATE).catch(() => {
  throw new Error('No saved session: run `node tools/loom-auth.mjs` first.');
});
console.log(`voice: ${VOICE}`);
voice();
const browser = await chromium.launch();
await art(browser);
console.log('recording');
const raw = await record(browser);
await browser.close();
console.log('composing');
const total = compose(raw);
console.log(`\n${FINAL}  ${total.toFixed(1)}s`);
