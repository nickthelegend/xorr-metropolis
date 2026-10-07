/**
 * Contact sheets and a gallery from the screens `capture.mjs` took (2026-10-07).
 *
 *   node e2e/web/sheets.mjs            # reads docs/screens/manifest.json
 *
 * Writes docs/screens/sheets/<area>.png — that area's phone screens in a labelled grid, rendered by Chromium from HTML so
 * the labels are real type — and docs/screens/index.html, a gallery of every screen at both sizes that opens straight
 * from the repository (relative paths, no server, no script).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const DIR = process.env.DIR ?? fileURLToPath(new URL('../../docs/screens/', import.meta.url));
const { screens, taken } = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const AREAS = ['onboarding', 'home', 'trade', 'money', 'agents', 'council', 'perps', 'history', 'safety', 'states'];
const TITLES = {
  onboarding: 'Onboarding — passkey, funds, permission',
  home: 'Home',
  trade: 'Trade — markets, ticket, routing',
  money: 'Money — portfolio, holdings, deposit, send',
  agents: 'Agents and strategies',
  council: 'The council',
  perps: 'Perps on Perpl — desk and risk',
  history: 'History, activity, audit',
  safety: 'Safety, permission, settings',
  states: 'States — empty, offline, stopped',
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const byArea = AREAS.map((a) => [a, screens.filter((s) => s.area === a)]).filter(([, list]) => list.length);

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html { background: #000; }
  body { margin: 0; background-color: #000; background-repeat: no-repeat; min-height: 100vh; color: #fff; font: 14px/1.4 -apple-system, "Inter", system-ui, sans-serif; }
  h1 { font-size: 28px; letter-spacing: -0.5px; margin: 0 0 6px; }
  h2 { font-size: 20px; margin: 36px 0 14px; }
  .sub { color: rgba(255,255,255,.55); }
  .eyebrow { color: #b9acff; font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; }
  .grid { display: grid; gap: 22px; }
  figure { margin: 0; }
  figure img { display: block; width: 100%; border-radius: 14px; border: 1px solid rgba(142,123,255,.35); }
  figcaption { margin-top: 8px; font-size: 12.5px; }
  figcaption b { display: block; font-weight: 600; }
  figcaption span { color: rgba(255,255,255,.5); }
`;

// ------------------------------------------------------------------ the contact sheets
mkdirSync(join(DIR, 'sheets'), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1640, height: 1000 } });
for (const [area, list] of byArea) {
  const html = `<!doctype html><meta charset="utf-8"><style>${STYLE}
    body { padding: 40px 44px 48px; background-image: radial-gradient(1200px 500px at 15% -10%, rgba(106,71,255,.28), transparent 70%); }
    .grid { grid-template-columns: repeat(6, 1fr); }
  </style>
  <div class="eyebrow">xorr · every screen</div>
  <h1>${esc(TITLES[area])}</h1>
  <div class="sub">${list.length} screens at 390 × 844 on a local fork of Monad mainnet, signed in with real data · ${esc(taken.slice(0, 10))}</div>
  <div class="grid" style="margin-top:28px">
    ${list
      .filter((s) => s.files.mobile)
      .map((s) => `<figure><img src="${pathToFileURL(join(DIR, s.files.mobile)).href}"><figcaption><b>${esc(s.route)}</b>${s.note ? `<span>${esc(s.note)}</span>` : ''}</figcaption></figure>`)
      .join('')}
  </div>`;
  const file = join(DIR, 'sheets', `.${area}.html`);
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(DIR, 'sheets', `${area}.png`), fullPage: true });
  console.log(`sheets/${area}.png  ${list.length} screens`);
}
// ------------------------------------------------------------------ before and after
/** The current shot of a screen, by its name (the slug after the number). */
const current = (name, vp) => screens.find((x) => x.files[vp]?.replace(/^.*\/\d+-/, '').replace(new RegExp(`-${vp}\\.png$`), '') === name)?.files[vp];
async function pairSheet(file, title, sub, pairs) {
  if (!pairs.length) return;
  const html = `<!doctype html><meta charset="utf-8"><style>${STYLE}
    body { padding: 40px 44px 48px; background-image: radial-gradient(1200px 500px at 15% -10%, rgba(106,71,255,.28), transparent 70%); }
    .grid { grid-template-columns: repeat(4, 1fr); }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .tag { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: rgba(255,255,255,.45); margin-bottom: 6px; }
    .tag.now { color: #b9acff; }
  </style>
  <div class="eyebrow">xorr · every screen</div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div>
  <div class="grid" style="margin-top:28px">${pairs
    .map(
      (p) => `<figure><div class="pair"><div><div class="tag">Before</div><img src="${pathToFileURL(p.before).href}"></div><div><div class="tag now">Now</div><img src="${pathToFileURL(p.after).href}"></div></div><figcaption><b>${esc(p.label)}</b>${p.note ? `<span>${esc(p.note)}</span>` : ''}</figcaption></figure>`,
    )
    .join('')}</div>`;
  const tmp = join(DIR, 'sheets', '.pairs.html');
  writeFileSync(tmp, html);
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1640, height: 1000 } });
  await pg.goto(pathToFileURL(tmp).href);
  await pg.waitForLoadState('networkidle');
  await pg.screenshot({ path: join(DIR, 'sheets', file), fullPage: true });
  await b.close();
  (await import('node:fs')).unlinkSync(tmp);
  console.log(`sheets/${file}  ${pairs.length} pairs`);
}

// Screens polished in the review: the shot taken before the fix, beside the one taken after.
const polishDir = join(DIR, 'polish');
const polished = existsSync(polishDir)
  ? [...new Set(readdirSync(polishDir).filter((f) => /-before-mobile\.png$/.test(f)).map((f) => f.replace(/-before-mobile\.png$/, '')))]
  : [];
const polishPairs = [];
for (const name of polished) {
  for (const vp of ['mobile', 'desktop']) {
    const now = current(name, vp);
    if (now) copyFileSync(join(DIR, now), join(polishDir, `${name}-after-${vp}.png`));
  }
  if (existsSync(join(polishDir, `${name}-after-mobile.png`))) {
    polishPairs.push({ label: name, before: join(polishDir, `${name}-before-mobile.png`), after: join(polishDir, `${name}-after-mobile.png`) });
  }
}
await pairSheet('polished.png', 'Polished in review', 'Every screen that scored 3 or less, before and after its fix (REVIEW.md).', polishPairs);

// The UI before the redesign (captured from the commit before it) beside the same screen now.
const beforeManifest = join(DIR, 'before', 'manifest-partial.json');
const thenNow = [];
if (existsSync(beforeManifest)) {
  for (const b of JSON.parse(readFileSync(beforeManifest, 'utf8')).screens) {
    const name = b.files.mobile.replace(/^.*\/\d+-/, '').replace(/-mobile\.png$/, '');
    const now = screens.find((x) => x.area === b.area && x.files.mobile?.replace(/^.*\/\d+-/, '').replace(/-mobile\.png$/, '') === name);
    if (now) thenNow.push({ label: b.route, note: b.note, before: join(DIR, 'before', b.files.mobile), after: join(DIR, now.files.mobile), beforeRel: `before/${b.files.mobile}`, afterRel: now.files.mobile });
  }
}
await pairSheet('then-and-now.png', 'Then and now', 'The same screens on the UI before the 6–7 Oct redesign, and today.', thenNow);

await browser.close();
for (const [area] of byArea) {
  try {
    (await import('node:fs')).unlinkSync(join(DIR, 'sheets', `.${area}.html`));
  } catch {
    /* already gone */
  }
}

// ------------------------------------------------------------------ the gallery
const gallery = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>xorr — every screen</title>
<style>${STYLE}
  body { padding: 40px clamp(16px, 4vw, 56px) 80px; background-image: radial-gradient(1200px 600px at 10% -10%, rgba(106,71,255,.25), transparent 70%); }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 22px 0 8px; }
  nav a { color: #fff; text-decoration: none; padding: 6px 12px; border-radius: 999px; background: rgba(142,123,255,.14); border: 1px solid rgba(142,123,255,.35); font-size: 13px; }
  .pair { display: grid; grid-template-columns: minmax(160px, 260px) 1fr; gap: 16px; align-items: start; }
  .rows { display: grid; gap: 34px; }
  @media (max-width: 760px) { .pair { grid-template-columns: 1fr; } }
</style></head><body>
<div class="eyebrow">xorr · ${esc(taken.slice(0, 10))}</div>
<h1>Every screen</h1>
<div class="sub">${screens.length} screens, each at 390 × 844 and 1440 × 900, on a local fork of Monad mainnet with a real account: a fill, a council round, an open Perpl position. Contact sheets per area are in <a style="color:#b9acff" href="sheets/">sheets/</a>; scores in <a style="color:#b9acff" href="REVIEW.md">REVIEW.md</a>.</div>
<nav><a href="#then-and-now">Then and now</a><a href="#polished">Polished</a>${byArea.map(([a, l]) => `<a href="#${a}">${esc(TITLES[a])} · ${l.length}</a>`).join('')}</nav>
${thenNow.length ? `<h2 id="then-and-now">Then and now</h2><div class="sub">Before the 6–7 Oct redesign, and today.</div><div class="rows" style="margin-top:16px">${thenNow
  .map((p) => `<div class="pair" style="grid-template-columns: repeat(2, minmax(160px, 260px));"><figure><img loading="lazy" src="${esc(p.beforeRel)}" alt="${esc(p.label)} before"><figcaption><span>Before</span></figcaption></figure><figure><img loading="lazy" src="${esc(p.afterRel)}" alt="${esc(p.label)} now"><figcaption><b>${esc(p.label)}</b>${p.note ? `<span>${esc(p.note)}</span>` : ''}</figcaption></figure></div>`)
  .join('')}</div>` : ''}
${polishPairs.length ? `<h2 id="polished">Polished in review</h2><div class="rows">${polishPairs
  .map((p) => `<div class="pair" style="grid-template-columns: repeat(2, minmax(160px, 260px));"><figure><img loading="lazy" src="polish/${esc(p.label)}-before-mobile.png" alt="${esc(p.label)} before"><figcaption><span>Before</span></figcaption></figure><figure><img loading="lazy" src="polish/${esc(p.label)}-after-mobile.png" alt="${esc(p.label)} after"><figcaption><b>${esc(p.label)}</b><span>After</span></figcaption></figure></div>`)
  .join('')}</div>` : ''}
${byArea
  .map(
    ([area, list]) => `<h2 id="${area}">${esc(TITLES[area])}</h2><div class="rows">${list
      .map(
        (s) => `<div class="pair">${s.files.mobile ? `<figure><img loading="lazy" src="${esc(s.files.mobile)}" alt="${esc(s.route)} on a phone"></figure>` : '<div></div>'}${
          s.files.desktop ? `<figure><img loading="lazy" src="${esc(s.files.desktop)}" alt="${esc(s.route)} on a desktop"><figcaption><b>${esc(s.route)}</b>${s.note ? `<span>${esc(s.note)}</span>` : ''}</figcaption></figure>` : `<figcaption><b>${esc(s.route)}</b></figcaption>`
        }</div>`,
      )
      .join('')}</div>`,
  )
  .join('')}
</body></html>`;
writeFileSync(join(DIR, 'index.html'), gallery);
console.log('index.html');
