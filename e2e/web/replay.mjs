/**
 * The council replay (docs/ROADMAP-WIN.md F3), on the local fork, at 390 px (2026-10-07).
 *
 * A passkey account is funded and grants its permission; it puts $50 of MON to the council; "Replay" on the round opens
 * /council/<id>, which plays the proposal, each seat with what it read, the verdict, and (for an executed round) the
 * transaction with its vote-to-fill time and speed receipt. Checks the beats arrive in order (the verdict is not there
 * before the seats), pause holds, play again starts over, and under reduced motion the whole round is there at once.
 * Fails on a console error or an API response ≥ 400.
 *
 *   WEB=http://localhost:8092 API=http://localhost:8790 node e2e/web/replay.mjs
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
const go = (r) => page.goto(`${WEB}${r}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
const fail = async (why) => {
  console.log(`✗ ${why}`);
  await browser.close();
  process.exit(1);
};
const seen = (id) => page.getByTestId(id).filter({ visible: true }).count().then((n) => n > 0);

for (let ok = 0, i = 0; ok < 3 && i < 180; i++) {
  ok = (await fetch(`${API}/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 1000));
}

// A real account: passkey, test USDC from the fork's faucet, the permission signed.
await go('/wallet');
await page.getByTestId('passkey-create').click({ timeout: T.chain });
await v(page.getByText('Continue — add funds', { exact: true })).click({ timeout: T.chain });
await v(page.getByText(/^Get [\d,]+ test USDC$/)).click({ timeout: T.ui });
await v(page.getByText(/^Added [\d,.]+ USDC/)).waitFor({ timeout: T.chain });
await v(page.getByText('Continue — set the limits', { exact: true })).click();
await v(page.getByText('Sign this permission', { exact: true })).click();
await page.waitForURL((u) => !u.pathname.includes('delegate'), { timeout: T.chain });
console.log('✓ signed in, funded, permission granted');

// Put $50 of MON to the council, then open the round's replay.
await go('/council');
await v(page.getByTestId('council-convene')).click({ timeout: T.ui });
const verdict = await v(page.getByText(/^Approved \d–\d\.|^Not approved|^Vetoed/)).innerText({ timeout: T.chain });
console.log(`✓ convened: ${verdict}`);
await v(page.getByTestId('council-replay')).click({ timeout: T.ui });
await page.waitForURL((u) => /^\/council\/\d+$/.test(u.pathname), { timeout: T.ui }).catch(() => fail('Replay did not open /council/<id>'));
const roundPath = new URL(page.url()).pathname;
console.log(`✓ Replay opened ${roundPath}`);

// The beats arrive in order: the proposal first, the verdict only after every seat.
await v(page.getByTestId('replay-proposal')).waitFor({ timeout: T.ui }).catch(() => fail('no proposal'));
if (await seen('replay-verdict')) await fail('the verdict was there before the seats had voted');
const seats = ['session-desk', 'risk-keeper', 'trend-reader', 'macro-desk'];
for (const s of seats) {
  await v(page.getByTestId(`replay-seat-${s}`)).waitFor({ timeout: 15_000 }).catch(() => fail(`seat ${s} never appeared`));
  const text = (await v(page.getByTestId(`replay-seat-${s}`)).innerText()).replace(/\n+/g, ' · ');
  // Each desk shows what it read when the round convened, not just its vote.
  if (!/\$|%|bps|left|no funding|could not be read/i.test(text)) await fail(`seat ${s} shows no readings: ${text.slice(0, 160)}`);
  console.log(`✓ ${s}: ${text.slice(0, 150)}`);
}
await v(page.getByTestId('replay-verdict')).waitFor({ timeout: 15_000 }).catch(() => fail('no verdict'));
console.log(`✓ verdict: ${(await v(page.getByTestId('replay-verdict')).innerText()).replace(/\n+/g, ' · ').slice(0, 140)}`);
await v(page.getByTestId('replay-outcome')).waitFor({ timeout: 15_000 }).catch(() => fail('no outcome'));
const outcome = (await v(page.getByTestId('replay-outcome')).innerText()).replace(/\n+/g, ' · ');
console.log(`✓ outcome: ${outcome.slice(0, 160)}`);
if (/^WHAT THE CHAIN DID · Executed/i.test(outcome)) {
  await v(page.getByTestId('replay-vote-to-fill')).waitFor({ timeout: 5_000 }).catch(() => fail('an executed round with no vote-to-fill time'));
  await v(page.getByTestId('speed-receipt')).waitFor({ timeout: 30_000 }).catch(() => fail('an executed round with no speed receipt'));
  console.log(`✓ the fill's speed receipt: ${(await v(page.getByTestId('speed-receipt')).innerText()).replace(/\n+/g, ' · ').slice(0, 140)}`);
}

// Play again starts over; pause holds where it is.
await v(page.getByTestId('replay-again')).click({ timeout: 5_000 }).catch(() => fail('no Play again at the end'));
await page.waitForTimeout(300);
if (await seen('replay-verdict')) await fail('Play again did not start over');
await v(page.getByTestId('replay-pause')).click({ timeout: 5_000 });
const held = await page.locator('[data-testid^="replay-seat-"]').filter({ visible: true }).count();
await page.waitForTimeout(4_000);
const after = await page.locator('[data-testid^="replay-seat-"]').filter({ visible: true }).count();
if (after !== held || (await seen('replay-verdict'))) await fail(`pause did not hold (${held} seats, then ${after})`);
console.log(`✓ play again starts over; pause holds at ${held} seat(s)`);
await v(page.getByTestId('replay-all')).click();
await v(page.getByTestId('replay-verdict')).waitFor({ timeout: 5_000 }).catch(() => fail('Show all did not show the verdict'));
console.log('✓ show all');

// Reduced motion: the whole round at once, and nothing to play.
await page.emulateMedia({ reducedMotion: 'reduce' });
await go(roundPath);
await v(page.getByTestId('replay-verdict')).waitFor({ timeout: 20_000 }).catch(() => fail('reduced motion did not show the round whole'));
if (await seen('replay-pause')) await fail('reduced motion still offers to play');
console.log('✓ reduced motion: shown whole, holds still');

// Someone else's round, or none: a plain error, not a crash. (Its 404 is expected, so it is not counted.)
const before = errors.length;
await page.emulateMedia({ reducedMotion: 'no-preference' });
await go('/council/999999999');
await v(page.getByText(/No such round/i)).waitFor({ timeout: 20_000 }).catch(() => fail('an unknown round did not say so'));
errors.splice(before).filter((e) => !/^404 \/council\/rounds\/999999999/.test(e) && !/404/.test(e)).forEach((e) => errors.push(e));
console.log('✓ an unknown round says so');

console.log(`console errors and API responses ≥ 400: ${errors.length}${errors.length ? `\n  ${[...new Set(errors)].slice(0, 8).join('\n  ')}` : ''}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
