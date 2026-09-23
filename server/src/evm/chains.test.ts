/**
 * The venues a grant names (PLAN.md 3.1).
 *
 * `SETTLEMENT_VENUES` is what the app asks the user to sign and what the safety screen shows. The SwapVM book
 * was missing from it, so no grant made through the app could ever reach the venue settlement tries second.
 *
 * And the chain it starts on: one it knows, and real money only by a deliberate decision.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const BOOK = '0x74e1283711106a5844eb20760c7cb6405933c54f';
const PROGRAMS = '0x2fbae90b836545d6a0cb947ff701c27d7b627bd1';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const venues = async () => (await import('./chains.js')).SETTLEMENT_VENUES.map((v) => v.toLowerCase());

describe('the venues a grant names', () => {
  it('on Robinhood Chain is SwapRouter02 alone: no 1inch (no deployment there), no Aave, no Base-era book', async () => {
    vi.stubEnv('XORR_CHAIN', 'robinhood-fork');
    vi.stubEnv('ONEINCH_API_KEY', 'a-key');
    vi.stubEnv('AQUA_BOOK_ADDRESS', BOOK);
    vi.stubEnv('SWAPVM_BOOK_ADDRESS', PROGRAMS);
    expect(await venues()).toEqual(['0xcaf681a66d020601342297493863e78c959e5cb2']);
  });

  it('on Arbitrum One is SwapRouter02 and Aave, with the 1inch router only where a key makes 1inch a venue', async () => {
    vi.stubEnv('XORR_CHAIN', 'arbitrum-fork');
    vi.stubEnv('ONEINCH_API_KEY', '');
    expect(await venues()).toEqual(['0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', '0x794a61358d6845594f94dc1db02a252b5b4814ad']);
    vi.resetModules();
    vi.stubEnv('ONEINCH_API_KEY', 'a-key');
    expect(await venues()).toContain('0x111111125421ca6dc452d289314280a0f8842a65');
  });

  it('never names an Aqua or SwapVM book, whatever the environment says (they were Base-only and are gone)', async () => {
    vi.stubEnv('XORR_CHAIN', 'base-fork');
    vi.stubEnv('AQUA_BOOK_ADDRESS', BOOK);
    vi.stubEnv('SWAPVM_BOOK_ADDRESS', PROGRAMS);
    const list = await venues();
    expect(list).not.toContain(BOOK);
    expect(list).not.toContain(PROGRAMS);
  });
});

describe('the chain this executor starts on', () => {
  it('is refused when the executor does not know it, naming the chains it does', async () => {
    vi.stubEnv('XORR_CHAIN', 'optimism');
    await expect(import('./chains.js')).rejects.toThrow(
      'XORR_CHAIN=optimism is not a chain this executor knows (base, base-sepolia, base-fork, localnet, arbitrum, arbitrum-sepolia, arbitrum-fork, robinhood, robinhood-testnet, robinhood-fork, monad, monad-testnet, monad-fork).',
    );
  });

  it('is refused on Monad testnet until it names the test settlement token xorr deployed there', async () => {
    vi.stubEnv('XORR_CHAIN', 'monad-testnet');
    vi.stubEnv('MONAD_TESTNET_SETTLEMENT', '');
    await expect(import('./chains.js')).rejects.toThrow('XORR_CHAIN=monad-testnet needs MONAD_TESTNET_SETTLEMENT');
  });

  it('on a Monad fork, is chain 143 settling in Circle\'s USDC, with no 1inch whatever the environment says', async () => {
    vi.stubEnv('XORR_CHAIN', 'monad-fork');
    vi.stubEnv('ONEINCH_API_KEY', 'a-key');
    const c = await import('./chains.js');
    expect(c.chain.id).toBe(143);
    expect(c.SETTLEMENT_SYMBOL).toBe('USDC');
    expect(c.ADDRESSES.usdcBase).toBe('0x754704Bc059F8C67012fEd69BC8A327a5aafb603');
    expect(c.ONEINCH_ENABLED).toBe(false);
    expect(c.SETTLEMENT_VENUES.map((v) => v.toLowerCase())).not.toContain('0x111111125421ca6dc452d289314280a0f8842a65');
    expect(c.explorerTx('0xabc')).toBe('fork:0xabc');
  });

  it('is refused where its money is real, unless ALLOW_MAINNET=yes says that was decided', async () => {
    vi.stubEnv('XORR_CHAIN', 'base');
    vi.stubEnv('ALLOW_MAINNET', '');
    await expect(import('./chains.js')).rejects.toThrow(
      'Refusing to start against Base mainnet. Set ALLOW_MAINNET=yes only with a deliberate decision.',
    );
    vi.resetModules();
    vi.stubEnv('ALLOW_MAINNET', 'yes');
    expect((await import('./chains.js')).CHAIN_KEY).toBe('base');
  });

  it.each([
    ['base', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'https://basescan.org/tx/0xabc'],
    ['base-fork', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'fork:0xabc'],
    ['base-sepolia', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'https://sepolia.basescan.org/tx/0xabc'],
    ['localnet', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'local:0xabc'],
  ])('on %s, settles in its own USDC and shows a transaction where that chain shows it', async (key, usdc, link) => {
    vi.stubEnv('XORR_CHAIN', key);
    vi.stubEnv('ALLOW_MAINNET', key === 'base' ? 'yes' : '');
    const chains = await import('./chains.js');
    expect(chains.ADDRESSES.usdcBase).toBe(usdc);
    expect(chains.explorerTx('0xabc')).toBe(link);
  });
});
