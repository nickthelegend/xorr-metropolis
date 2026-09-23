/**
 * The market catalog: which classes the Markets tab offers and, for crypto, which symbols it asks the price feed about.
 *
 * NO PRICE IS STORED HERE. Every row's `px` is a dash and its `chg` empty until a live read replaces them
 * (`src/markets/prices.ts`); a row the feed does not answer for stays a dash. This file used to carry the design
 * prototype's numbers ("BTC $66,560", "LINK $18.44") and Hyperliquid's perp tags, and three classes — commodities,
 * indices, pre-IPO — that nothing prices or trades here. They are gone: a class with no price and nothing to buy is not
 * a market.
 *
 * The Stocks class has no rows of its own. It is the Stock Token catalog (`/market/xstocks`), filled in at runtime by
 * `withStockTokens` (`src/markets/xstockClass.ts`), so a token the executor lists is a row and nothing else is.
 */
import type { AssetClass } from '../types';

export const assetClasses: AssetClass[] = [
  {
    "id": "crypto",
    "label": "Crypto",
    "note": "Spot prices, live",
    "more": "All crypto",
    "instruments": [
      {
        "sym": "BTC",
        "name": "Bitcoin",
        "tag": "Spot",
        "px": "—",
        "chg": "",
        "up": true,
        "c1": "#F7931A",
        "c2": "#B96908",
        "classId": "crypto",
        "feed": "live"
      },
      {
        "sym": "ETH",
        "name": "Ethereum",
        "tag": "Spot",
        "px": "—",
        "chg": "",
        "up": true,
        "c1": "#8FA6E8",
        "c2": "#4B5FA8",
        "classId": "crypto",
        "feed": "live"
      },
      {
        "sym": "AAVE",
        "name": "Aave",
        "tag": "Spot",
        "px": "—",
        "chg": "",
        "up": true,
        "c1": "#B58CFF",
        "c2": "#6E3ED8",
        "classId": "crypto",
        "feed": "live"
      },
      {
        "sym": "LINK",
        "name": "Chainlink",
        "tag": "Spot",
        "px": "—",
        "chg": "",
        "up": true,
        "c1": "#5B93FF",
        "c2": "#1B44CE",
        "classId": "crypto",
        "feed": "live"
      }
    ]
  },
  {
    "id": "stocks",
    "label": "Stocks",
    "note": "Stock Tokens, priced by their pools",
    "more": "All stocks",
    "instruments": []
  }
];
