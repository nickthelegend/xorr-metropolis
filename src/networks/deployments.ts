/**
 * Every network xorr is deployed on, and the one place a new one is added.
 *
 * A build is made for one chain at a time — its executor, RPC and pinned contract are inlined when it is built
 * (`scripts/build-web.mjs`). This build runs on two: a fork of Monad mainnet (real pools, test money) and Monad testnet
 * (where the contracts are deployed and verified). Neither is real money, and each says so. What is deployed
 * where was known only to the deploy scripts. This names each deployment and the executor that serves it; everything a
 * screen says about one (whether it is up, its block, its contract, whether trades settle there) is read live from that
 * executor. No status or capability is ever written down here.
 *
 * A new chain is a new row: the chain key its executor serves (`XORR_CHAIN`), the id its chain answers `eth_chainId`
 * with, the executor's address, and a public explorer where one has seen that chain.
 */
import { API_BASE } from '@/data/apiBase';
import { CHAIN_KEY } from '@/chain';

export type Deployment = {
  /** The chain key the executor serves, as its `/health` names it. */
  key: string;
  /** How the network is named to a person. */
  name: string;
  /** What the chain answers `eth_chainId` with. A fork answers the id of the chain it copies. */
  chainId: number;
  /**
   * The executor that serves it, or null where none has a public address yet — the card then says so and reads nothing.
   */
  api: string | null;
  /** A public block explorer for it, or null where no public explorer has seen the chain, as on a fork. */
  explorer: string | null;
  /** Nothing on it is real money. */
  test: boolean;
};

/*
 * No Monad executor has a recorded public address yet (PLAN.md P0.7). A build made for a Monad key knows its own
 * executor — the one it was built against — so that build fills its own row in, when that executor is served over https;
 * any other build, and a developer's Metro against a local executor, says the address is not known rather than guess.
 */
const ownApi = (key: string): string | null => (CHAIN_KEY === key && /^https:\/\//.test(API_BASE) ? API_BASE : null);

export const DEPLOYMENTS: readonly Deployment[] = [
  {
    key: 'monad-fork',
    name: 'Monad fork',
    chainId: 143,
    api: ownApi('monad-fork'),
    explorer: null,
    test: true,
  },
  {
    key: 'monad-testnet',
    name: 'Monad testnet',
    chainId: 10143,
    api: ownApi('monad-testnet'),
    explorer: 'https://testnet.monadvision.com',
    test: true,
  },
];

const bare = (url: string) => url.replace(/\/+$/, '');

/** The deployment a chain key names, if xorr is deployed on it. */
export function deploymentFor(key: string | undefined): Deployment | undefined {
  return key ? DEPLOYMENTS.find((d) => d.key === key) : undefined;
}

/**
 * The deployment this build talks to, matched by its executor's address.
 *
 * Not by chain key: two builds for the same chain can point at different executors, and naming the wrong one as "this
 * app" would put another executor's facts under it. A build no deployment serves — a developer's Metro against a local
 * executor — has none.
 */
export function thisDeployment(apiBase: string = API_BASE): Deployment | undefined {
  return DEPLOYMENTS.find((d) => d.api !== null && bare(d.api) === bare(apiBase));
}
