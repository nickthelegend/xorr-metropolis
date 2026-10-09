/**
 * Each bounty xorr enters, what it asks, and where in the app it is met (ROADMAP-WIN W4, 2026-10-08).
 *
 * The same entries as docs/SUBMISSION.md "Per bounty", in the app: a judge reading a bounty's requirement can open the
 * screen that meets it rather than take the README's word. `status` is SUBMISSION's own, including what is still left;
 * `live` names the reading `/judges` shows beside it, made now by the executor.
 */
export type Live = 'monad' | 'ausd' | 'perpl' | 'kuru' | 'chainlink' | 'envio' | 'kimi' | 'cre' | 'session' | 'none';

export type Bounty = {
  id: string;
  sponsor: string;
  title: string;
  prize: string;
  asks: string;
  screens: { label: string; route: string }[];
  live: Live;
  status: string;
  evidence: { label: string; path: string }[];
};

const REPO = 'https://github.com/nickthelegend/xorr-metropolis/blob/main/';
export const repoUrl = (path: string) => `${REPO}${path}`;

export const BOUNTIES: readonly Bounty[] = [
  {
    id: 'monad',
    sponsor: 'Monad',
    title: 'Main track: Onchain Finance & Trading',
    prize: 'Track prize',
    asks: 'A product on Monad, judged on product quality, technical excellence, Monad integration, track fit and innovation.',
    screens: [
      { label: 'Built on Monad', route: '/monad' },
      { label: 'The council', route: '/council' },
      { label: 'The gauntlet', route: '/gauntlet' },
      { label: 'How xorr works', route: '/how' },
    ],
    live: 'monad',
    status: 'Built; live on a fork of Monad mainnet, with Monad’s own readings taken from mainnet. Testnet run at the go.',
    evidence: [
      { label: 'Monad-native coverage', path: 'docs/ROADMAP-WIN.md' },
      { label: 'Gas on Monad', path: 'docs/MONAD-GAS.md' },
    ],
  },
  {
    id: 'agora',
    sponsor: 'Agora',
    title: 'Best Mobile Trading App',
    prize: '$10,000',
    asks: 'A mobile app that signs in with Mera, holds and shows an AUSD balance, and trades through Perpl.',
    screens: [
      { label: 'Sign in with a passkey', route: '/wallet' },
      { label: 'Perps, AUSD margin', route: '/perps' },
    ],
    live: 'ausd',
    status: 'Built and shown end to end in the browser; the native passkey path has not yet run on a device.',
    evidence: [{ label: 'Perpl desk on testnet', path: 'docs/evidence/prove-perpl-desk-testnet-2026-09-24.txt' }],
  },
  {
    id: 'perpl-api',
    sponsor: 'Perpl',
    title: 'Best use of the API',
    prize: '$5,000',
    asks: 'A production-ready trading bot or automation system on Perpl.',
    screens: [
      { label: 'The Perpl desk', route: '/perps' },
      { label: 'The council', route: '/council' },
    ],
    live: 'perpl',
    status: 'Met on the fork and on testnet (24 Sep): caps checked before signing, exits every 30 s, an operator that cannot withdraw.',
    evidence: [{ label: 'Desk proof on the fork', path: 'docs/evidence/prove-perpl-desk-fork-2026-10-06.txt' }],
  },
  {
    id: 'perpl-risk',
    sponsor: 'Perpl',
    title: 'Best Analytics / Risk Tool',
    prize: '$3,000',
    asks: 'A real-time analytics, risk-monitoring or portfolio intelligence dashboard focused on Perpl.',
    screens: [{ label: 'Perpl risk', route: '/perpl' }],
    live: 'perpl',
    status: 'Met.',
    evidence: [{ label: 'Per bounty', path: 'docs/SUBMISSION.md' }],
  },
  {
    id: 'kuru',
    sponsor: 'Kuru',
    title: 'Next Consumer Trading App',
    prize: '$5,000',
    asks: 'A consumer spot product that routes trades through Kuru’s on-chain order book.',
    screens: [
      { label: 'Buy MON', route: '/order/WMON' },
      { label: 'Fills and their routing', route: '/runs' },
    ],
    live: 'kuru',
    status: 'Met on the fork: every order measures Kuru against Uniswap v3 and fills on the better.',
    evidence: [{ label: 'Kuru in xorr', path: 'docs/KURU.md' }],
  },
  {
    id: 'metamask',
    sponsor: 'MetaMask',
    title: 'Best Agent Wallet Plugin',
    prize: '$2,500',
    asks: 'A plugin that gives the MetaMask Agent Wallet a new trading power.',
    screens: [{ label: 'The same Perpl desk', route: '/perps' }],
    live: 'none',
    status: 'Built: mm perpl (mm-plugin-perpl/), markets and risk run in mm 7.0.0; wallet commands need mm login.',
    evidence: [{ label: 'The plugin', path: 'mm-plugin-perpl/README.md' }],
  },
  {
    id: 'mera-ux',
    sponsor: 'Mera',
    title: 'Best Mera-Powered UX',
    prize: '$2,500',
    asks: 'Mera as the entire account layer: time to first transaction, the session design, the stateless test.',
    screens: [
      { label: 'Sign in with a passkey', route: '/wallet' },
      { label: 'Signing window', route: '/settings' },
    ],
    live: 'session',
    status: 'Met on the fork.',
    evidence: [{ label: 'Per bounty', path: 'docs/SUBMISSION.md' }],
  },
  {
    id: 'mera-keys',
    sponsor: 'Mera',
    title: 'One Passkey, Many Keys',
    prize: '$2,500',
    asks: 'A creative non-wallet use of Mera’s PRF-derived key material, and a live cross-device test.',
    screens: [
      { label: 'A private note, sealed by the passkey', route: '/runs' },
      { label: 'The passkey checked by Monad', route: '/monad' },
    ],
    live: 'session',
    status: 'Met in the browser; the cross-device test needs two real devices.',
    evidence: [{ label: 'Per bounty', path: 'docs/SUBMISSION.md' }],
  },
  {
    id: 'cre',
    sponsor: 'Chainlink',
    title: 'Best workflow with CRE',
    prize: '$3,000',
    asks: 'A CRE workflow as the orchestration layer between a chain and an external API or agent.',
    screens: [
      { label: 'The council’s price desk', route: '/council' },
      { label: 'Built on Monad', route: '/monad' },
    ],
    live: 'cre',
    status: 'Built, not yet simulated: the cre CLI needs cre login.',
    evidence: [{ label: 'The workflow', path: 'cre/README.md' }],
  },
  {
    id: 'envio',
    sponsor: 'Envio',
    title: 'Best Use of Envio',
    prize: '$1,000 + hosting',
    asks: 'HyperIndex, HyperSync or HyperRPC powering real on-chain data in a core feature.',
    screens: [{ label: 'History, from the index', route: '/history' }],
    live: 'envio',
    status: 'Met locally (RPC sync against the fork); hosting at the go.',
    evidence: [{ label: 'The indexer', path: 'indexer/README.md' }],
  },
  {
    id: 'kimi',
    sponsor: 'Kimi',
    title: 'Kimi credits',
    prize: 'Credits',
    asks: 'Kimi used in the product.',
    screens: [{ label: 'The Strategist seat', route: '/council' }],
    live: 'kimi',
    status: 'Built; sits on the council when the executor has a Moonshot key.',
    evidence: [{ label: 'Per bounty', path: 'docs/SUBMISSION.md' }],
  },
];
