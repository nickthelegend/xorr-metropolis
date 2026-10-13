# Sponsor coverage (13 Oct 2026)

Live app: https://xorr-metropolis.vercel.app (Monad testnet) · executor https://executor-monad-testnet-production.up.railway.app.
In the app: **For judges** (`/judges`) and **Built on Monad** (`/monad`) show each one with a reading made now.

| Sponsor | Status | Where | Evidence |
|---|---|---|---|
| **Perpl** | working, testnet | Perps desk through Perpl's DelegatedAccount; caps before signing; exit guard; one-hold stop | 13 Oct: close [`0x1d530ae2…`](https://testnet.monadvision.com/tx/0x1d530ae29ffc2b64798851d832826ba017ffb280852a6b254a5456f3e50e6e4f), exit guard [`0x54a880a1…`](https://testnet.monadvision.com/tx/0x54a880a1620e74216b3f782b57426988ce48b53b1e3d0cfcc284fd28c53e3ee4), operator removed [`0x6babda2c…`](https://testnet.monadvision.com/tx/0x6babda2cd2223fff91024027e3bc60c8fd72962185a87f8c7e90e9bf1bfd367e), then a raw order reverts [`0xd9e94a3d…`](https://testnet.monadvision.com/tx/0xd9e94a3d06845f125326ae206bc63720b067d866767dd6067925c7286365aaac) — `evidence/prove-perpl-desk-testnet-2026-10-13.txt` |
| **Chainlink CRE** | working, testnet | `cre/mon-price` workflow → `XorrPriceReceiver` the council's price desk reads | receiver [`0x5309…aD42`](https://testnet.monadvision.com/address/0x5309e806fA530426c0ad72F22D15E473F9b7aD42) (exact match on sourcify.dev and MonadVision); report [`0x0a228a13…`](https://testnet.monadvision.com/tx/0x0a228a1365c0873ca5c5f8d02b96fb818bd809a4ede68f3a1fb4977fe49fc101) (MON/USD 0.023975) |
| **Chainlink Data Feeds** | working, live reads | MON/USD, ETH, BTC, AUSD on Monad; every buy gated against them | `/monad/feed/MON` on the executor; Built on Monad |
| **Agora AUSD** | working, testnet | the perps desk's margin; peg read from Chainlink | AUSD transfer and deposit in the 13 Oct proof; peg on `/monad` |
| **Envio** | working, hosted | HyperIndex on Railway (HyperSync on Monad testnet) powers History (grants, desks, anchors); spot fills via `/indexed/recent` on the fork | `indexer/config.testnet.yaml`; `/monad` shows the indexed block |
| **Mera** | working (web) | passkey accounts, the stateless test, PRF-sealed notes, the passkey checked by Monad's P256 precompile | `e2e:fork`, `e2e:monad`; the native path awaits a device |
| **Kuru** | working on a fork of Monad mainnet | every buy measures Kuru's book against Uniswap v3 and fills on the better (`KuruVenue`) | fork fills in `evidence/`; testnet has no Kuru spot market |
| **Kimi** | working, capped | the Strategist seat (`council/strategist.ts`): thinking off, cached, a persisted daily cap, skipped on a veto | 13 Oct live vote: "no — the Trend Reader and Macro Desk both vote no: falling price at -0.80% and crowded longs paying 0.0056%/h…" (`strategist.live.test.ts`) |
| **MetaMask** | built | `mm-plugin-perpl/`: markets and risk ran in mm 7.0.0 | wallet commands wait for the owner's `mm login` (doitlater.md) |

Monad-native items: `docs/ROADMAP-WIN.md` "Monad-native coverage".
