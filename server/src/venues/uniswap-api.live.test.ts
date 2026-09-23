/**
 * The Trading API against Uniswap's real service. Runs only with LIVE=1 and a UNISWAP_API_KEY; without the key it proves
 * the client refuses rather than calling out.
 */
import { describe, expect, it } from 'vitest';
import { apiQuote, apiSwap, uniswapApiConfigured, UniswapApiError } from './uniswap-api.js';

const USDG_RH = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const NVDA_RH = '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC';
const SWAPPER = '0x60b0c8343bc8295595542c5d5aa83d4fb2e178cb';

describe.runIf(process.env.LIVE === '1')('Uniswap Trading API (live)', () => {
  it.runIf(!uniswapApiConfigured())('refuses without a key instead of calling out', async () => {
    await expect(apiQuote({ chainId: 4663, tokenIn: USDG_RH, tokenOut: NVDA_RH, amountIn: 50_000_000n, swapper: SWAPPER, slippagePct: 0.5 })).rejects.toBeInstanceOf(UniswapApiError);
  });
  it.runIf(uniswapApiConfigured())('quotes $50 USDG → NVDA on Robinhood Chain and returns router calldata', async () => {
    const q = await apiQuote({ chainId: 4663, tokenIn: USDG_RH, tokenOut: NVDA_RH, amountIn: 50_000_000n, swapper: SWAPPER, slippagePct: 0.5 });
    expect(q.routing).toBe('CLASSIC');
    expect(BigInt(q.quote.output.amount)).toBeGreaterThan(0n);
    const tx = await apiSwap(q);
    expect(tx.data.length).toBeGreaterThan(10);
  }, 30_000);
});
