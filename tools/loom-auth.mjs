/**
 * Sign in to both deployed builds once, off camera, and save the sessions for `tools/loom.mjs`.
 *
 * Uses Privy's own test-credentials flow (a real session, real `verifyAuthToken`), the same account on both origins
 * so the Robinhood build and the Arbitrum build show one person's wallet.
 *
 *   node tools/loom-auth.mjs            → docs/demo/.loom-state.json (gitignored)
 */
import { chromium } from 'playwright';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../.env'));
} catch {}

export const ORIGINS = {
  robinhood: process.env.LOOM_RH_URL ?? 'https://xorr-arbitrum.vercel.app',
  arbitrum: process.env.LOOM_ARB_URL ?? 'https://xorr-arbitrum-one.vercel.app',
};
export const STATE = path.resolve(import.meta.dirname, '../docs/demo/.loom-state.json');
const EMAIL = process.env.E2E_PRIVY_EMAIL ?? 'test-4668@privy.io';

async function account() {
  const appId = process.env.PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!appId || !secret) throw new Error('PRIVY_APP_ID/SECRET required');
  const r = await fetch(`https://auth.privy.io/api/v1/apps/${appId}/test_credentials`, {
    headers: { authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString('base64')}`, 'privy-app-id': appId },
  });
  const list = r.ok ? ((await r.json()).data ?? []) : [];
  const a = list.find((x) => x.email === EMAIL) ?? list[0];
  if (!a) throw new Error('no Privy test account');
  return a;
}

async function signIn(page, base, a) {
  await page.goto(`${base}/wallet`, { waitUntil: 'networkidle' });
  if (await page.evaluate(() => !!localStorage.getItem('privy:token'))) return;
  await page.fill('input[type=email]', a.email);
  await page.getByText(/email me a code/i).first().click();
  await page.waitForSelector('input[placeholder*="6-digit"]', { timeout: 30_000 });
  await page.fill('input[placeholder*="6-digit"]', a.otp_code);
  await page.getByText(/verify and create/i).first().click();
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1_000);
    if (await page.evaluate(() => !!localStorage.getItem('privy:token'))) break;
  }
  await page.waitForTimeout(6_000);
  if (!(await page.evaluate(() => !!localStorage.getItem('privy:token')))) throw new Error(`sign-in on ${base} produced no session`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = await account();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await ctx.newPage();
  for (const base of Object.values(ORIGINS)) {
    await signIn(page, base, a);
    console.log(`signed in on ${base} as ${a.email}`);
  }
  await fs.mkdir(path.dirname(STATE), { recursive: true });
  await ctx.storageState({ path: STATE });
  await browser.close();
  console.log(`session → ${STATE}`);
}
