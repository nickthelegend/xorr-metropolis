/**
 * Which chain the APP signs on.
 *
 * There was no such thing. `PrivyProvider` named `baseSepolia` as its `defaultChain` and nothing
 * else in the client mentioned a chain at all — so every transaction the USER signs went to Base
 * Sepolia regardless of what the executor was settling on. On a `base-fork` deployment that is
 * every write in the product pointed at the wrong network:
 *
 *   - the delegation `grant` lands on Sepolia while the executor reads the fork, so the bot has
 *     permission on a chain nobody is trading, and none where it is
 *   - the ERC-20 approvals go with it
 *   - a withdrawal is signed against a chain that does not hold the funds
 *
 * It showed up in Privy's own confirmation sheet: "Network: Base Sepolia" over a Base-mainnet USDC
 * address, with `balanceOf` returning `0x` because that contract has no code there.
 *
 * This mirrors `server/src/evm/chains.ts` deliberately — the app and the executor have to agree
 * about which chain they are on, and the only way to be sure is for both to read it from the same
 * name in the same `.env`.
 */
import { arbitrum, arbitrumSepolia, base, baseSepolia, monad, monadTestnet, robinhood, robinhoodTestnet } from 'viem/chains';
import { isAddress, type Address, type Chain } from 'viem';

export type ChainKey =
  | 'base'
  | 'base-sepolia'
  | 'base-fork'
  | 'localnet'
  | 'arbitrum'
  | 'arbitrum-sepolia'
  | 'arbitrum-fork'
  | 'robinhood'
  | 'robinhood-testnet'
  | 'robinhood-fork'
  | 'monad'
  | 'monad-testnet'
  | 'monad-fork'
  | 'solana-fork'
  | 'solana-devnet'
  | 'solana-localnet'
  | 'solana-mainnet';

/**
 * What money on each chain is, in the executor's three words (`server/src/evm/money.ts`): real on a mainnet, test funds on
 * a public test network, a copy on a fork. What this file tells a person about their money follows it, never a key:
 * `testNetwork` was every key but `base`, which would have called a mainnet added under any other key a test network.
 */
const MONEY: Record<ChainKey, 'real' | 'test' | 'copy'> = {
  base: 'real',
  'base-sepolia': 'test',
  'base-fork': 'copy',
  localnet: 'copy',
  arbitrum: 'real',
  'arbitrum-sepolia': 'test',
  'arbitrum-fork': 'copy',
  robinhood: 'real',
  'robinhood-testnet': 'test',
  'robinhood-fork': 'copy',
  monad: 'real',
  'monad-testnet': 'test',
  'monad-fork': 'copy',
  'solana-fork': 'copy',
  'solana-devnet': 'test',
  'solana-localnet': 'copy',
  'solana-mainnet': 'real',
};

const ASKED = process.env.EXPO_PUBLIC_XORR_CHAIN ?? 'monad-fork';

/*
 * A chain this app does not know is refused where the app is built. It was an unchecked cast, and an unknown key signed on
 * Base Sepolia under the label "Base fork": the wrong chain for every transaction a person signs.
 */
if (!Object.prototype.hasOwnProperty.call(MONEY, ASKED)) {
  throw new Error(
    `EXPO_PUBLIC_XORR_CHAIN=${ASKED} is not a chain this app knows (${Object.keys(MONEY).join(', ')}). ` +
      'Add it here, as the executor adds it to server/src/evm/money.ts.',
  );
}

/*
 * The Solana keys stay in the vocabulary — the executor still knows them, and `server/src/evm/chain-agreement.test.ts`
 * holds the two lists to each other — but this app signs on EVM chains only: its wallet, its grant and its withdrawals
 * are Ethereum transactions. A build for a Solana key would label a Base chain "Solana" and sign there, so it is refused.
 */
if (ASKED.startsWith('solana-')) {
  throw new Error(
    `EXPO_PUBLIC_XORR_CHAIN=${ASKED} is a Solana cluster. This app signs on EVM chains (Monad, Robinhood Chain, Arbitrum); ` +
      'build it for one of those.',
  );
}

export const CHAIN_KEY = ASKED as ChainKey;

/** Monad mainnet, testnet or a fork of it: crypto spot and Perpl perps, no Stock Tokens. */
export const onMonad = CHAIN_KEY.startsWith('monad');

/**
 * Every chain this app knows, which must be every chain the executor knows.
 *
 * `server/src/evm/chain-agreement.test.ts` holds the two lists to each other: a chain the executor can be
 * started on and the app cannot be built for is a deployment nobody can reach from the product.
 */
export const CHAIN_KEYS = Object.keys(MONEY) as ChainKey[];

/** What money on any chain is, not only this build's. A key this app does not know is real: nothing is reassured on a guess. */
export function moneyOnChain(key: string): 'real' | 'test' | 'copy' {
  return Object.prototype.hasOwnProperty.call(MONEY, key) ? MONEY[key as ChainKey] : 'real';
}

const money = MONEY[CHAIN_KEY];

/**
 * What money on the chain this build signs on is, in the executor's own three words.
 *
 * Exported for `net/chainMatch.ts`, which has to say whether a disagreement between this build and its
 * executor is a wiring problem or a money one. `testNetwork` cannot answer that: it folds `test` and `copy`
 * into one boolean, and the sentence needs to know which.
 */
export const chainMoney: 'real' | 'test' | 'copy' = money;

/**
 * How this build's chain is named inside a sentence, as the executor names it.
 *
 * `chainLabel` is a title — "Base fork" — and reads wrong mid-sentence. The EVM strings are the ones
 * `evm/money.ts` writes and the Solana ones are the ones `solana/clusters.ts` writes, so a sentence naming
 * both sides of a mismatch names them the same way whichever side of the app the chain belongs to.
 */
const SENTENCE_NAMES: Record<ChainKey, string> = {
  base: 'Base mainnet',
  'base-sepolia': 'Base Sepolia',
  'base-fork': 'a fork of Base mainnet',
  localnet: 'a local fork of Base Sepolia',
  arbitrum: 'Arbitrum One',
  'arbitrum-sepolia': 'Arbitrum Sepolia',
  'arbitrum-fork': 'a fork of Arbitrum One',
  robinhood: 'Robinhood Chain',
  'robinhood-testnet': 'Robinhood Chain testnet',
  'robinhood-fork': 'a fork of Robinhood Chain',
  monad: 'Monad mainnet',
  'monad-testnet': 'Monad testnet',
  'monad-fork': 'a fork of Monad mainnet',
  'solana-fork': 'Solana Mainnet Fork',
  'solana-devnet': 'Solana Devnet',
  'solana-localnet': 'Solana Localnet',
  'solana-mainnet': 'Solana Mainnet',
};

export const chainSentenceName = SENTENCE_NAMES[CHAIN_KEY];

/** Any chain's sentence name, for the screens that talk about a chain other than this build's. */
export function chainSentenceNameOf(key: string): string {
  return Object.prototype.hasOwnProperty.call(SENTENCE_NAMES, key) ? SENTENCE_NAMES[key as ChainKey] : key;
}

/**
 * A fork of Base IS Base — same id, same deployed contracts, different node. So the chain is Base
 * with its RPC replaced, exactly as the executor does it; anything else and viem believes the
 * chain has no Multicall3 and silently reads zeros.
 */
function withRpc(chain: Chain, rpc: string | undefined): Chain {
  if (!rpc) return chain;
  return { ...chain, rpcUrls: { default: { http: [rpc] }, public: { http: [rpc] } } };
}

const RPC = process.env.EXPO_PUBLIC_CHAIN_RPC;

/** Each chain as viem knows it. A record, so a chain added to `MONEY` cannot be missing here. */
const CHAINS: Record<ChainKey, () => Chain> = {
  base: () => withRpc(base, RPC),
  'base-sepolia': () => withRpc(baseSepolia, RPC),
  'base-fork': () => withRpc({ ...base, name: 'Base fork' }, RPC ?? 'http://127.0.0.1:8545'),
  localnet: () => withRpc({ ...base, name: 'Base fork' }, RPC ?? 'http://127.0.0.1:8545'),
  arbitrum: () => withRpc(arbitrum, RPC),
  'arbitrum-sepolia': () => withRpc(arbitrumSepolia, RPC),
  'arbitrum-fork': () => withRpc({ ...arbitrum, name: 'Arbitrum fork' }, RPC ?? 'http://127.0.0.1:8545'),
  robinhood: () => withRpc(robinhood, RPC),
  'robinhood-testnet': () => withRpc(robinhoodTestnet, RPC),
  'robinhood-fork': () => withRpc({ ...robinhood, name: 'Robinhood Chain fork' }, RPC ?? 'http://127.0.0.1:8545'),
  monad: () => withRpc(monad, RPC),
  'monad-testnet': () => withRpc(monadTestnet, RPC),
  'monad-fork': () => withRpc({ ...monad, name: 'Monad fork' }, RPC ?? 'http://127.0.0.1:8545'),
  'solana-fork': () => withRpc({ ...base, name: 'Solana fork' }, RPC ?? 'http://127.0.0.1:8899'),
  'solana-devnet': () => withRpc({ ...baseSepolia, name: 'Solana Devnet' }, RPC ?? 'https://api.devnet.solana.com'),
  'solana-localnet': () => withRpc({ ...base, name: 'Solana Localnet' }, RPC ?? 'http://127.0.0.1:8899'),
  'solana-mainnet': () => withRpc({ ...base, name: 'Solana Mainnet' }, RPC ?? 'https://api.mainnet-beta.solana.com'),
};

export const activeChain: Chain = CHAINS[CHAIN_KEY]();

/**
 * Every chain the wallet may be asked to switch to.
 *
 * The active one first: Privy offers the list, and a user who is shown two Bases has to guess.
 * Base mainnet stays available so a wallet funded there is still readable.
 */
export const supportedChains: Chain[] =
  activeChain.id === monad.id
    ? [activeChain, monadTestnet]
    : activeChain.id === monadTestnet.id
      ? [activeChain, monad]
      : activeChain.id === robinhood.id
    ? [activeChain, arbitrum]
    : activeChain.id === robinhoodTestnet.id
      ? [activeChain, arbitrumSepolia]
      : activeChain.id === arbitrum.id
    ? [activeChain, arbitrumSepolia]
    : activeChain.id === arbitrumSepolia.id
      ? [activeChain, arbitrum]
      : activeChain.id === base.id
        ? [activeChain, baseSepolia]
        : [activeChain, base];

const LABELS: Record<ChainKey, string> = {
  base: 'Base',
  'base-sepolia': 'Base Sepolia',
  'base-fork': 'Base fork',
  localnet: 'Base fork',
  arbitrum: 'Arbitrum',
  'arbitrum-sepolia': 'Arbitrum Sepolia',
  'arbitrum-fork': 'Arbitrum fork',
  robinhood: 'Robinhood Chain',
  'robinhood-testnet': 'Robinhood Chain testnet',
  'robinhood-fork': 'Robinhood Chain fork',
  monad: 'Monad',
  'monad-testnet': 'Monad testnet',
  'monad-fork': 'Monad fork',
  'solana-fork': 'Solana fork',
  'solana-devnet': 'Solana Devnet',
  'solana-localnet': 'Solana Localnet',
  'solana-mainnet': 'Solana Mainnet',
};

/** For the screens that name the network to the user. */
export const chainLabel = LABELS[CHAIN_KEY];

/** A network whose money is not real is for testing: nothing on it is real money. */
export const testNetwork = money !== 'real';

/**
 * The one place a money screen shows the network: a small chip on Deposit, Send and Fund.
 *
 * The main screens are chain-agnostic; where money moves the network is named, because that is where a deposit has to
 * be sent. A copy of a chain says so in its name ("Robinhood Chain fork"), so a fork is never taken for the real thing.
 */
export const networkChip = chainLabel;

/**
 * Where a transaction the USER signs is broadcast (PLAN.md 4.1).
 *
 * Privy's embedded wallet previews and broadcasts through Privy's own RPC for a chain it knows, and
 * a fork of Base is chain 8453 — indistinguishable from real Base. Pointing `rpcUrls` at the fork
 * changes what the app reads and not what Privy signs against, so on a fork build every
 * user-signed transaction was simulated against real Base, where the wallet holds nothing:
 *
 *   Execution reverted with reason: ERC20: transfer amount exceeds balance
 *
 * — over an amount shown as `0 USDC`, which is true of real Base and says nothing about the fork
 * the user is looking at.
 *
 * `eth_signTransaction` only signs. So on a fork build the wallet signs a transaction whose nonce,
 * gas and fees were read from the fork, and the app broadcasts it to the fork itself
 * (`src/wallet/userSigning.ts`). Proven with a Privy wallet on the Railway fork
 * (`tools/prove-user-signing.ts`): Privy signed for chain 8453 without consulting real Base, and the
 * fork mined it. On Base and Base Sepolia the wallet sends, because there Privy's RPC is the chain.
 *
 * The bot's own trades never depended on this: the executor signs with its delegate key against the
 * RPC it is given. This is only the transactions a PERSON signs — the grant, the approvals, a withdrawal.
 */
export const walletSignsOnly = money === 'copy';

/** The settlement token by name: Paxos USDG on Robinhood Chain (where the Stock Token pools are quoted), USDC elsewhere. */
export const settlementSymbol: 'USDC' | 'USDG' | 'AUSD' = CHAIN_KEY.startsWith('robinhood')
  ? 'USDG'
  : CHAIN_KEY === 'monad-testnet'
    ? 'AUSD'
    : 'USDC';

/**
 * Can a deposit code name the chain this build is on?
 *
 * A deposit code encodes `ethereum:<address>@<chainId>` (EIP-681), and a phone wallet that scans it opens on that chain
 * id. On Base and Base Sepolia the id is the chain this build reads. A fork of Base is 8453 too — real Base's id — so on a
 * fork build the same code opens a phone wallet on real Base, where a transfer is real money sent to an address whose
 * balance this build never reads. Any copy of a chain carries the id of the chain it copies, so none has a code.
 */
export const depositQrWorks = money !== 'copy';

/**
 * What a deposit code encodes: EIP-681, `ethereum:<address>@<chainId>`, which a phone wallet opens on that chain. Only
 * drawn where `depositQrWorks` — a copy of a chain carries the real chain's id, and the phone would pay there.
 */
export function depositUri(address: string): string {
  return `ethereum:${address}@${activeChain.id}`;
}

/** Said where the code would be: a copy of a chain has no code, and its money is test funds. */
export const depositQrNote =
  money === 'copy' ? `${chainLabel}. Test funds only.` : `Send only ${settlementSymbol} on ${chainLabel}.`;

/**
 * The delegation contract this build trusts, when the build pinned one (FEATURES.md #24).
 *
 * `scripts/build-web.mjs` writes it only after the executor it builds for, the deployment's own record and the chain all
 * agree on it. A grant refuses any other contract, and a stop can go there without asking the executor
 * (`src/wallet/delegationChain.ts`). A build that did not pin one — a developer's Metro, whose `.env` may name another
 * deployment's contract — pins nothing, and grants and stops still check the chain before they are signed.
 */
const PINNED = process.env.EXPO_PUBLIC_PINNED_DELEGATION;
export const pinnedDelegation: Address | undefined = PINNED && isAddress(PINNED) ? PINNED : undefined;
