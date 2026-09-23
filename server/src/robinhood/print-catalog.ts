/**
 * Prints the live Robinhood Chain Stock Token catalog, the current session, and for NVDA / TSLA /
 * AAPL / SPY the Chainlink price and age, the pool-implied price, the deviation and the guard's
 * verdict. Every number comes from a live read.
 *
 *   npx tsx src/robinhood/print-catalog.ts [usdg=100]
 */
import { fetchAsset, fetchPrice, tokenPrice } from './api.js';
import { stockCatalog } from './catalog.js';
import { chainlinkPrice, deviationBps, quoteUsdgToToken, ROBINHOOD_RPC } from './chain.js';
import { maxDeviationBps, stockTradeCheck } from './guards.js';
import { marketClock } from './session.js';

const usdg = Number(process.argv[2] ?? 100);
const now = new Date();
const fmt = (n: number, d = 4) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const clock = marketClock(now);
console.log(`Robinhood Chain 4663 via ${ROBINHOOD_RPC}`);
console.log(`Now ${now.toISOString()} — session: ${clock.session} (${clock.phase}); ${clock.reason}\n`);

const t0 = Date.now();
const catalog = await stockCatalog();
console.log(`Catalog: ${catalog.length} Stock Tokens ACTIVE on 4663 with a funded USDG pool (${Date.now() - t0} ms)`);
console.log(
  ['SYMBOL'.padEnd(7), 'POOL USDG'.padStart(14), 'FEE'.padStart(6), 'API MULT'.padStart(22), 'ONCHAIN MULT'.padStart(22), 'FEED'.padEnd(44), 'ADDRESS'].join(' '),
);
for (const e of catalog) {
  console.log(
    [
      e.symbol.padEnd(7),
      fmt(e.pool.usdg, 0).padStart(14),
      String(e.pool.fee).padStart(6),
      e.multiplier.padStart(22),
      (e.onchainMultiplier === undefined ? '?' : (Number(e.onchainMultiplier) / 1e18).toFixed(18)).padStart(22),
      (e.chainlinkFeed ?? '— no feed').padEnd(44),
      e.address,
    ].join(' ') + (e.multiplierMismatch ? '  MULTIPLIER MISMATCH' : ''),
  );
  if (e.pendingMultiplier) console.log(`        notice: ${e.pendingMultiplier.notice}`);
  for (const n of e.corporateActions) console.log(`        corp action: ${n}`);
}

console.log(`\nGuards for a ${usdg} USDG buy (max deviation ${maxDeviationBps()} bps):`);
for (const symbol of ['NVDA', 'TSLA', 'AAPL', 'SPY']) {
  const entry = catalog.find((e) => e.symbol === symbol);
  const asset = await fetchAsset(symbol);
  if (!entry || !asset) {
    console.log(`${symbol}: not in catalog`);
    continue;
  }
  const [cl, q, rh] = await Promise.all([
    chainlinkPrice(symbol, now),
    quoteUsdgToToken(entry.address, usdg, { pool: entry.pool.address, fee: entry.pool.fee, usdg: entry.pool.usdg, usdgBalance: 0n }),
    fetchPrice(symbol),
  ]);
  const rhTok = tokenPrice(rh, asset.currentMultiplier);
  const verdict = await stockTradeCheck({ symbol, side: 'buy', usdg, now });
  const age = cl.ageSec < 120 ? `${cl.ageSec}s` : `${(cl.ageSec / 60).toFixed(1)}m`;
  console.log(
    `${symbol.padEnd(5)} chainlink $${fmt(cl.price)} (age ${age}${cl.stale ? ', STALE' : ''}) | ` +
      `pool ${entry.pool.fee / 10_000}% implied $${fmt(q.impliedPrice)} | ` +
      `deviation ${deviationBps(q.impliedPrice, cl.price).toFixed(1)} bps | ` +
      `robinhood mid×mult $${fmt(rhTok.mid)}${rh.isTradingHalt ? ' HALTED' : ''} | ` +
      `guard: ${verdict.ok ? 'OK' : `REFUSED ${verdict.reason}`}`,
  );
  console.log(`      ${verdict.detail.message}`);
}
