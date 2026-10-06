/**
 * Email sign-in (Privy), the account path beside the passkey for people without a PRF passkey (2026-10-06).
 *
 * The code is real: Privy's test accounts carry their own one-time codes, which Privy hands to the app's owner through
 * its API (`/apps/<id>/test_credentials`, app id and secret). This types one into the app's own form, so the session
 * that results is a real Privy session, and the executor must accept it. Fails on any console error or API response
 * ≥ 400.
 *
 *   WEB=http://localhost:8092 API=http://localhost:8790 node e2e/web/email-signin.mjs
 *
 * PRIVY_APP_ID and PRIVY_APP_SECRET from the environment, else from server/.env.local-monad (never printed).
 */
import { chromium } from 'playwright';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

const WEB = process.env.WEB ?? 'http://localhost:8092';
const API = process.env.API ?? 'http://localhost:8790';
const T = { ui: 60_000, chain: 120_000 };

const fromFile = (k) => readFileSync('server/.env.local-monad', 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '');
const appId = process.env.PRIVY_APP_ID ?? fromFile('PRIVY_APP_ID');
const secret = process.env.PRIVY_APP_SECRET ?? fromFile('PRIVY_APP_SECRET');
if (!appId || !secret) {
  console.log('✗ PRIVY_APP_ID / PRIVY_APP_SECRET not set');
  process.exit(1);
}
const creds = await fetch(`https://auth.privy.io/api/v1/apps/${appId}/test_credentials`, {
  headers: { authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}`, 'privy-app-id': appId },
}).then((r) => r.json());
const account = (creds.data ?? creds.test_credentials ?? creds)?.find?.((c) => c.email && c.otp_code);
if (!account) {
  console.log(`✗ the Privy app has no test account with an email: ${JSON.stringify(creds).slice(0, 160)}`);
  process.exit(1);
}

const errors = [];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 240));
});
page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 240)}`));
page.on('response', (r) => {
  if (r.url().startsWith(API) && r.status() >= 400) errors.push(`${r.status()} ${r.request().method()} ${r.url().slice(API.length)}`);
});
const v = (l) => l.filter({ visible: true }).first();

try {
  await page.goto(`${WEB}/wallet`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await v(page.getByPlaceholder('you@example.com')).fill(account.email, { timeout: 180_000 });
  await v(page.getByText('Email me a code', { exact: true })).click({ timeout: T.ui });
  await v(page.getByPlaceholder('6-digit code')).fill(account.otp_code, { timeout: T.ui });
  await v(page.getByText('Verify and create wallet', { exact: true })).click({ timeout: T.ui });
  await v(page.getByText(/^Continue — add funds$|^Continue$/)).waitFor({ timeout: T.chain });
  const body = await page.evaluate(() => document.body.innerText);
  const address = body.match(/0x[0-9a-fA-F]{4,}…?[0-9a-fA-F]*/)?.[0];
  console.log(`✓ email sign-in: ${account.email.replace(/^(.).*@/, '$1…@')} → a Privy session and its embedded wallet${address ? ` (${address})` : ''}; the executor accepted it`);
} catch (e) {
  console.log(`✗ email sign-in: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  console.log((await page.evaluate(() => document.body.innerText).catch(() => '')).split('\n').filter(Boolean).slice(0, 25).join(' | '));
  await browser.close();
  process.exit(1);
}
const benign = errors.filter((e) => !/favicon/.test(e));
console.log(`console errors and API responses ≥ 400: ${benign.length}${benign.length ? `\n  ${benign.join('\n  ')}` : ''}`);
await browser.close();
process.exit(benign.length ? 1 : 0);
