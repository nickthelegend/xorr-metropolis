/**
 * Chain configuration.
 *
 * Base is the target: 1inch routes there, and the same deployment is what goes to Base Build Camp.
 * `localnet` is an anvil fork of Base Sepolia — a real EVM running real contracts, so enforcement
 * is genuinely proven without waiting on a faucet.
 *
 * `base-fork` is an anvil fork of Base MAINNET. It is the only environment where the whole thesis
 * can actually run end to end: the real 1inch router, real USDC, real Aave, and the real Ondo
 * tokenized equities all exist there with real liquidity, and none of them exist on Sepolia. Fills
 * are genuine EVM execution against genuine pool state — the only thing that is not real is that
 * the chain is a local copy.
 */
import { arbitrum, arbitrumSepolia, base, baseSepolia, foundry, robinhood, robinhoodTestnet } from 'viem/chains';
import type { Chain } from 'viem';
import 'dotenv/config';
import { KNOWN_CHAINS, isKnownChain, moneyOn, networkName, type KnownChain } from './money.js';
import { isSolanaCluster } from '../solana/clusters.js';

/** Every chain this executor knows. A chain is added in `evm/money.ts` first, saying what its money is. */
export type ChainKey = KnownChain;

// Named XORR_CHAIN, not CHAIN: Foundry auto-loads .env and treats CHAIN as its own --chain
// flag, which makes every cast/forge command in this repo fail with a confusing parse error.
const ASKED = process.env.XORR_CHAIN ?? 'localnet';

/*
 * When XORR_CHAIN is a Solana cluster (PLAN.md §0.2), EVM chains are inactive.
 * For any unknown chain outside of Solana, refuse start.
 */
if (isSolanaCluster(ASKED)) {
  // Active chain is Solana. EVM chain definitions fall back to localnet as a stub.
} else if (!isKnownChain(ASKED)) {
  throw new Error(
    `XORR_CHAIN=${ASKED} is not a chain this executor knows (${KNOWN_CHAINS.join(', ')}). ` +
      'Add it to server/src/evm/money.ts, saying what its money is, then give it an RPC and a chain in server/src/evm/chains.ts.',
  );
}
export const CHAIN_KEY: ChainKey = isKnownChain(ASKED) ? ASKED : 'localnet';

/** Guardrail: real money needs a deliberate, reviewed decision, never a default. */
if (moneyOn(CHAIN_KEY) === 'real' && process.env.ALLOW_MAINNET !== 'yes') {
  throw new Error(
    `Refusing to start against ${networkName(CHAIN_KEY)}. Set ALLOW_MAINNET=yes only with a deliberate decision.`,
  );
}

const RPCS: Record<ChainKey, string> = {
  localnet: process.env.LOCAL_RPC ?? 'http://127.0.0.1:8545',
  'base-fork': process.env.FORK_RPC ?? 'http://127.0.0.1:8545',
  'base-sepolia': process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org',
  base: process.env.BASE_RPC ?? 'https://mainnet.base.org',
  arbitrum: process.env.ARBITRUM_RPC ?? 'https://arb1.arbitrum.io/rpc',
  'arbitrum-sepolia': process.env.ARBITRUM_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc',
  'arbitrum-fork': process.env.FORK_RPC ?? 'http://127.0.0.1:8545',
  robinhood: process.env.ROBINHOOD_RPC ?? 'https://rpc.mainnet.chain.robinhood.com',
  'robinhood-testnet': process.env.ROBINHOOD_TESTNET_RPC ?? 'https://rpc.testnet.chain.robinhood.com',
  'robinhood-fork': process.env.FORK_RPC ?? 'http://127.0.0.1:8545',
};

const CHAINS: Record<ChainKey, Chain> = {
  localnet: { ...foundry, id: baseSepolia.id, name: 'Base Sepolia (local fork)' },
  /*
   * A fork of Base IS Base — same chain id, same deployed contracts, same everything but the
   * node. Spreading `foundry` first and only overriding the id kept foundry's empty `contracts`,
   * so viem believed the chain had no Multicall3 and refused to batch. The whole balance read came
   * back as zero through a `.catch`, and the home screen showed $0.00 for a funded wallet.
   *
   * So: take Base wholesale and change only the RPC.
   */
  'base-fork': { ...base, name: 'Base (local mainnet fork)' },
  'base-sepolia': baseSepolia,
  base,
  arbitrum,
  'arbitrum-sepolia': arbitrumSepolia,
  // Same reasoning as base-fork: the fork IS Arbitrum One (Multicall3 and all), only the node differs.
  'arbitrum-fork': { ...arbitrum, name: 'Arbitrum One (fork)' },
  robinhood,
  'robinhood-testnet': robinhoodTestnet,
  'robinhood-fork': { ...robinhood, name: 'Robinhood Chain (fork)' },
};

export const chain = CHAINS[CHAIN_KEY];
export const rpcUrl = RPCS[CHAIN_KEY];

/** True on Arbitrum One, its fork and Arbitrum Sepolia. */
export const IS_ARBITRUM = CHAIN_KEY === 'arbitrum' || CHAIN_KEY === 'arbitrum-fork' || CHAIN_KEY === 'arbitrum-sepolia';

/** True on Robinhood Chain, its fork and its testnet: where the Stock Tokens live, settled in USDG. */
export const IS_ROBINHOOD = CHAIN_KEY === 'robinhood' || CHAIN_KEY === 'robinhood-fork' || CHAIN_KEY === 'robinhood-testnet';

/**
 * What the settlement token is called where a person reads it. USDG (Paxos) on Robinhood Chain, where the Stock Token
 * pools are quoted in it; USDC everywhere else.
 */
export const SETTLEMENT_SYMBOL: 'USDC' | 'USDG' = IS_ROBINHOOD ? 'USDG' : 'USDC';

/**
 * The chain id 1inch is asked about. A local fork of Base Sepolia still quotes against Base; every Arbitrum key quotes
 * against Arbitrum One, because 1inch has no Sepolia deployment.
 */
export const ONEINCH_CHAIN_ID = IS_ARBITRUM ? 42161 : IS_ROBINHOOD ? 4663 : 8453;

/**
 * Canonical addresses, per chain.
 *
 * These used to be a single flat object of Base MAINNET addresses used on every network. On Base
 * Sepolia that meant the app asked for the balance of a USDC contract that does not exist there,
 * got back `0x`, and the whole delegation flow died on a decode error before the user could sign
 * anything. A token address is a property of a chain, not of a product.
 *
 * Circle deploys USDC to a different address on Sepolia; WETH is at the same predeploy on both.
 * cbBTC and the tokenized equities are mainnet-only, and are absent here rather than pointed at an
 * address with no code — code that reads them must handle absence, not discover it at runtime.
 */
const BASE_MAINNET_ADDRESSES = {
  /** 1inch Aggregation Router v6 — the same address across every chain it supports. */
  oneInchRouter: '0x111111125421cA6dc452d289314280a0f8842A65',
  usdcBase: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  wethBase: '0x4200000000000000000000000000000000000006',
  /** Coinbase Wrapped BTC on Base — 8 decimals, the Base-native way to hold BTC exposure. */
  cbbtcBase: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  /** 1inch's sentinel for native ETH. */
  nativeEth: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
} as const;

const BASE_SEPOLIA_ADDRESSES = {
  // 1inch does not run on Sepolia. The address is kept so the venue allowlist has a stable shape;
  // nothing routes there on a testnet, and the executor's own tests use the fork for real fills.
  oneInchRouter: '0x111111125421cA6dc452d289314280a0f8842A65',
  /** Circle's USDC on Base Sepolia — a different deployment from mainnet. */
  usdcBase: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  /** WETH is the same predeploy on every OP-stack chain. */
  wethBase: '0x4200000000000000000000000000000000000006',
  cbbtcBase: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  nativeEth: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
} as const;

/**
 * Arbitrum One. The field names still say "Base" because every reader was written against Base; they mean "the settlement
 * chain's". USDC is Circle's native deployment (not bridged USDC.e); the BTC slot is WBTC, Arbitrum's deep BTC market.
 */
const ARBITRUM_ADDRESSES = {
  oneInchRouter: '0x111111125421cA6dc452d289314280a0f8842A65',
  usdcBase: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  wethBase: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  cbbtcBase: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  nativeEth: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
} as const;

/** Arbitrum Sepolia: Circle's test USDC and the canonical WETH. There is no BTC token; the slot repeats WETH's shape. */
const ARBITRUM_SEPOLIA_ADDRESSES = {
  oneInchRouter: '0x111111125421cA6dc452d289314280a0f8842A65',
  usdcBase: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  wethBase: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
  cbbtcBase: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
  nativeEth: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
} as const;

/**
 * Robinhood Chain mainnet. The settlement slot holds Paxos USDG (6 decimals) — the token every Stock Token pool on the
 * chain is quoted in. The BTC slot repeats WETH: there is no BTC token the product trades here.
 */
const ROBINHOOD_ADDRESSES = {
  oneInchRouter: '0x111111125421cA6dc452d289314280a0f8842A65',
  usdcBase: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  wethBase: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  cbbtcBase: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  nativeEth: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
} as const;

/**
 * Robinhood Chain testnet has no canonical USDG (its explorer lists a dozen unofficial "USDG"/"USDC" tokens), so the
 * settlement token is the one xorr deployed there, named by ROBINHOOD_TESTNET_SETTLEMENT. Unset, the executor refuses to
 * start on this key rather than guess.
 */
const ROBINHOOD_TESTNET_SETTLEMENT = process.env.ROBINHOOD_TESTNET_SETTLEMENT as `0x${string}` | undefined;
if (CHAIN_KEY === 'robinhood-testnet' && !(ROBINHOOD_TESTNET_SETTLEMENT && /^0x[0-9a-fA-F]{40}$/.test(ROBINHOOD_TESTNET_SETTLEMENT))) {
  throw new Error('XORR_CHAIN=robinhood-testnet needs ROBINHOOD_TESTNET_SETTLEMENT: the test settlement token xorr deployed there.');
}
const ROBINHOOD_TESTNET_ADDRESSES = {
  oneInchRouter: '0x111111125421cA6dc452d289314280a0f8842A65',
  usdcBase: ROBINHOOD_TESTNET_SETTLEMENT ?? '0x0000000000000000000000000000000000000000',
  wethBase: '0x0000000000000000000000000000000000000000',
  cbbtcBase: '0x0000000000000000000000000000000000000000',
  nativeEth: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
} as const;

type ChainAddresses = {
  oneInchRouter: `0x${string}`;
  usdcBase: `0x${string}`;
  wethBase: `0x${string}`;
  cbbtcBase: `0x${string}`;
  nativeEth: `0x${string}`;
};

/**
 * Addresses for the chain the executor SETTLES on. Follows XORR_CHAIN.
 *
 * A record rather than "Sepolia's, else mainnet's": that fallback would have handed a chain added later Base mainnet's
 * token addresses, where they have no code. A chain added in `evm/money.ts` does not compile until it has a row here.
 */
const ADDRESSES_BY_CHAIN: Record<ChainKey, ChainAddresses> = {
  base: BASE_MAINNET_ADDRESSES,
  'base-fork': BASE_MAINNET_ADDRESSES,
  'base-sepolia': BASE_SEPOLIA_ADDRESSES,
  // What it read before this was a record: only Base Sepolia had a table of its own.
  localnet: BASE_MAINNET_ADDRESSES,
  arbitrum: ARBITRUM_ADDRESSES,
  'arbitrum-fork': ARBITRUM_ADDRESSES,
  'arbitrum-sepolia': ARBITRUM_SEPOLIA_ADDRESSES,
  robinhood: ROBINHOOD_ADDRESSES,
  'robinhood-fork': ROBINHOOD_ADDRESSES,
  'robinhood-testnet': ROBINHOOD_TESTNET_ADDRESSES,
};

export const ADDRESSES = ADDRESSES_BY_CHAIN[CHAIN_KEY];

/**
 * The tokens a grant approves for the delegation to pull, before any equities: the one it spends and every one it may
 * have to sell. `/delegation/params` hands the app's grant this list, kept to what has code on the chain, and the fork's
 * grant script approves the same one. That script had a shorter list of its own, so a demo wallet a swap had bought into
 * cbBTC could not be sold out of it: the panic flatten's cbBTC leg reverted with SafeTransferFromFailed (2026-09-15).
 */
export const APPROVABLE_TOKENS: readonly { symbol: string; address: `0x${string}` }[] = [
  { symbol: SETTLEMENT_SYMBOL, address: ADDRESSES.usdcBase },
  { symbol: 'WETH', address: ADDRESSES.wethBase },
  ...(CHAIN_KEY === 'arbitrum-sepolia' || IS_ROBINHOOD ? [] : [{ symbol: IS_ARBITRUM ? 'WBTC' : 'CBBTC', address: ADDRESSES.cbbtcBase }]),
];

/**
 * Addresses for the chain 1inch is ASKED about, which is always Base mainnet.
 *
 * These are two different things and conflating them is a real bug: 1inch has no deployment or
 * liquidity on Sepolia, so `ONEINCH_CHAIN_ID` is pinned to 8453 and every quote is a mainnet
 * question. Handing it a Sepolia token address makes it 400 on a token that chain has never heard
 * of — which is exactly what happened when the routing registry started following XORR_CHAIN.
 *
 * On a testnet the consequence is honest and worth stating: prices are real mainnet prices, and
 * settlement is not possible. The fork is where both halves are real at once.
 */
export const QUOTE_ADDRESSES: ChainAddresses = IS_ARBITRUM
  ? ARBITRUM_ADDRESSES
  : IS_ROBINHOOD
    ? ROBINHOOD_ADDRESSES
    : BASE_MAINNET_ADDRESSES;

/** True where the tokenized equities and Aqua actually exist. */
export const IS_BASE_MAINNET_STATE = CHAIN_KEY === 'base' || CHAIN_KEY === 'base-fork';

/** Aave v3 Pool: Base's, or Arbitrum One's on an Arbitrum key. Neither is at this address on a Sepolia. */
export const AAVE_V3_POOL = (
  IS_ARBITRUM ? '0x794a61358D6845594F94dc1DB02A252b5b4814aD' : '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5'
) as `0x${string}`;

/** True where Aave v3 and 1inch liquidity exist on the settlement chain: a mainnet or its fork. */
export const HAS_MAINNET_STATE =
  CHAIN_KEY === 'base' || CHAIN_KEY === 'base-fork' || CHAIN_KEY === 'arbitrum' || CHAIN_KEY === 'arbitrum-fork';

/**
 * Uniswap v3 per chain: QuoterV2 (what a fill will get), SwapRouter02 (what `spend()` forwards to) and the factory.
 *
 * Addresses from Uniswap's deployment lists, and each confirmed to carry code on its chain (Arbitrum One and Robinhood
 * Chain, 2026-09-23). Null where this build does not settle through Uniswap: a testnet quotes against its mainnet
 * (`UNISWAP_QUOTE_CHAIN`) and settles nothing. A record, so a chain added later says, or does not compile.
 */
export type UniswapV3 = { quoter: `0x${string}`; router: `0x${string}`; factory: `0x${string}` };
const UNISWAP_ARBITRUM: UniswapV3 = {
  quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
};
const UNISWAP_ROBINHOOD: UniswapV3 = {
  quoter: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',
  router: '0xcaf681a66d020601342297493863e78c959e5cb2',
  factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
};
const UNISWAP_BASE: UniswapV3 = {
  quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
  router: '0x2626664c2603336E57B271c5C0b26F421741e481',
  factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
};
const UNISWAP_BY_CHAIN: Record<ChainKey, UniswapV3 | null> = {
  base: UNISWAP_BASE,
  'base-fork': UNISWAP_BASE,
  'base-sepolia': null,
  localnet: null,
  arbitrum: UNISWAP_ARBITRUM,
  'arbitrum-fork': UNISWAP_ARBITRUM,
  'arbitrum-sepolia': null,
  robinhood: UNISWAP_ROBINHOOD,
  'robinhood-fork': UNISWAP_ROBINHOOD,
  'robinhood-testnet': null,
};

/** Uniswap v3 on the chain the executor SETTLES on, or null where nothing settles through it. */
export const UNISWAP = UNISWAP_BY_CHAIN[CHAIN_KEY];

/**
 * Where a quote is asked when the settlement chain has no Uniswap: the mainnet the testnet stands in for, with its own
 * public RPC. Prices are real there; nothing settles. Null where the settlement chain quotes itself.
 */
export const UNISWAP_QUOTE_CHAIN: { uniswap: UniswapV3; rpc: string; chain: Chain } | null = UNISWAP
  ? null
  : IS_ARBITRUM
    ? { uniswap: UNISWAP_ARBITRUM, rpc: process.env.ARBITRUM_RPC ?? 'https://arb1.arbitrum.io/rpc', chain: arbitrum }
    : IS_ROBINHOOD
      ? { uniswap: UNISWAP_ROBINHOOD, rpc: process.env.ROBINHOOD_RPC ?? 'https://rpc.mainnet.chain.robinhood.com', chain: robinhood }
      : { uniswap: UNISWAP_BASE, rpc: process.env.BASE_RPC ?? 'https://mainnet.base.org', chain: base };

/**
 * Whether 1inch is a venue on this chain at all: never on Robinhood Chain (it has no deployment there), and elsewhere
 * only when this deployment holds an API key. It is an optional second quote next to Uniswap, not a dependency.
 */
export const ONEINCH_ENABLED = !IS_ROBINHOOD && Boolean(process.env.ONEINCH_API_KEY);

/**
 * Every contract the delegation is allowed to call, for this chain.
 *
 * One list, read by the grant the user signs AND by the screen that shows them what they granted. A venue the executor
 * may settle through has to be on it, or `spend()` refuses — which is the contract doing its job.
 *
 * Uniswap's SwapRouter02 where this chain settles through it; the 1inch router only where 1inch is enabled (above);
 * Aave only where it is deployed. Permission to call nothing is not dangerous, but it is a claim on the safety screen
 * that is not true, and this screen is the one that has to be exactly true.
 *
 * The Base-era Aqua and SwapVM books are gone from this list (2026-09-23): they existed only on Base, and nothing on
 * Arbitrum or Robinhood Chain settles through them.
 */
export const SETTLEMENT_VENUES: readonly `0x${string}`[] = [
  ...(UNISWAP ? [UNISWAP.router] : []),
  ...(ONEINCH_ENABLED || IS_BASE_MAINNET_STATE || CHAIN_KEY === 'localnet' || CHAIN_KEY === 'base-sepolia'
    ? [ADDRESSES.oneInchRouter]
    : []),
  ...(HAS_MAINNET_STATE ? [AAVE_V3_POOL] : []),
];

/** Where each chain shows a transaction. A record, so a chain added later says where, or does not compile. */
const EXPLORER_TX: Record<ChainKey, (hash: string) => string> = {
  // A fork shares mainnet's history up to the fork block, so an explorer link is right for a
  // pre-fork tx and wrong for one we just mined. Label it rather than link to a 404.
  'base-fork': (hash) => `fork:${hash}`,
  base: (hash) => `https://basescan.org/tx/${hash}`,
  'base-sepolia': (hash) => `https://sepolia.basescan.org/tx/${hash}`,
  localnet: (hash) => `local:${hash}`,
  arbitrum: (hash) => `https://arbiscan.io/tx/${hash}`,
  'arbitrum-sepolia': (hash) => `https://sepolia.arbiscan.io/tx/${hash}`,
  'arbitrum-fork': (hash) => `fork:${hash}`,
  robinhood: (hash) => `https://robinhoodchain.blockscout.com/tx/${hash}`,
  'robinhood-testnet': (hash) => `https://explorer.testnet.chain.robinhood.com/tx/${hash}`,
  'robinhood-fork': (hash) => `fork:${hash}`,
};

export function explorerTx(hash: string): string {
  return EXPLORER_TX[CHAIN_KEY](hash);
}
