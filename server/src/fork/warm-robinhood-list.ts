import type { Address } from 'viem';

/** The Stock Tokens with funded USDG pools on 2026-09-23 and their Chainlink feeds on Robinhood Chain. */
export const WARM_STOCKS: { symbol: string; token: Address; feed: Address }[] = [
  { symbol: 'NVDA', token: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', feed: '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15' },
  { symbol: 'TSLA', token: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', feed: '0x4A1166a659A55625345e9515b32adECea5547C38' },
  { symbol: 'AAPL', token: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', feed: '0x6B22A786bAa607d76728168703a39Ea9C99f2cD0' },
  { symbol: 'SPY', token: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', feed: '0x319724394D3A0e3669269846abE664Cd621f9f6A' },
];
