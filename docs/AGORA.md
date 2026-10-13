# How xorr uses Agora's AUSD

xorr is a council of AI agents that trades for you on Monad, inside a limit you sign and the chain enforces. On Monad
testnet, every dollar in xorr is **Agora's AUSD**:

- the cash on your Home screen;
- the token the on-chain permission is measured in;
- the margin on your Perpl perps desk;
- what comes back to your wallet when you withdraw.

The token is Agora's testnet AUSD, `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` (6 decimals).

## What AUSD does in the product

**One dollar, end to end.** We wanted the permission, the test faucet and the perps desk to count the same dollar.
Agora's testnet AUSD is the one token that makes that possible:

- Agora's own faucet (`requestFunds`) mints it.
- Perpl's testnet Exchange takes it as margin.
- Circle's USDC on this testnet, as published before the reset, has no code.

**Where you see it (a phone-width Expo app):**

| Screen | What it shows |
|---|---|
| Home | the total, then "In AUSD, Agora's dollar · 1 AUSD = $<peg> · Chainlink" |
| Portfolio | Cash · AUSD, with the same peg reading |
| Deposit | "Send only AUSD on Monad testnet." beside the deposit code |
| Fund (onboarding) and Perps | "Get test MON and AUSD", with an explorer link for each transfer |
| Perps | your wallet's AUSD, your AUSD on Perpl, the part locked in positions, and "Withdraw … to my wallet" |
| Built on Monad (`/monad`) | "Agora AUSD: the perps desk's margin", with the live Chainlink AUSD/USD peg |

**A stablecoin is a claim until read.** The app never just assumes 1 AUSD = $1. Beside the balance, it shows
Chainlink's AUSD/USD feed on Monad mainnet, with the reading's age. If the reading is stale, the line turns to a warning
colour.

## How it works

**The settlement token is chosen per chain.** It is set in `server/src/evm/chains.ts`:

```ts
export const SETTLEMENT_SYMBOL: 'USDC' | 'USDG' | 'AUSD' = IS_ROBINHOOD ? 'USDG' : CHAIN_KEY === 'monad-testnet' ? 'AUSD' : 'USDC';
export const MONAD_TESTNET_AUSD = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC' as const;
const MONAD_TESTNET_SETTLEMENT = (process.env.MONAD_TESTNET_SETTLEMENT || MONAD_TESTNET_AUSD) as `0x${string}`;
```

The app has the same switch: `settlementSymbol` in `src/chain.ts`.

**The permission is denominated in AUSD.** `XorrDelegation` takes its settlement token in its constructor. On Monad
testnet it was deployed with AUSD:

- contract: `0x5995925de0169574365cc7f6b65f765275b0bd4b`, Sourcify-verified;
- record: `contracts/deployments/monad-testnet.json`.

The owner's daily cap is counted in AUSD. Because closing a position is not capped, the contract refuses to let a close
move AUSD at all (`SettlementTokenNotClosable`).

**AUSD is Perpl's margin.** In `server/src/monad/perpl-chain.ts`, both of Perpl's networks name AUSD as collateral:

- mainnet: `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`;
- testnet: `0xa901…22dC`.

Funding a desk takes two signatures, both from the owner (`deskCalls` in `src/data/perps.ts`, the Perps screen's
"Put 150 AUSD on Perpl"):

```ts
fund: (ausd, desk, usd) => ({ to: ausd, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [desk, units(usd)] }) }),
open: (desk, usd) => ({ to: desk, data: encodeFunctionData({ abi: DESK, functionName: 'createAccount', args: [units(usd)] }) }),
```

The desk is Perpl's own `DelegatedAccount`. xorr's agent key is only its operator, so it can trade the AUSD but never
withdraw it. `withdrawCollateral` always pays the owner.

**Test funds come from Agora first.** `POST /perps/fund-test` is in `server/src/monad/perpl-routes.ts`. It:

1. simulates `requestFunds(owner)` on Agora's faucet, `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`;
2. if the faucet will serve, sends that call;
3. otherwise sends 500 AUSD from the deployment's own reserve, by an ordinary transfer (that reserve was claimed from
   Agora's faucet earlier).

Each wallet can claim once a day, recorded in `faucet_claims`.

**The peg** comes from `GET /monad/feed/AUSD` (`server/src/monad/routes.ts`). It reads Chainlink's AUSD/USD proxy on
Monad mainnet, `0xE20751C7B5867bCBef815ffc1b284c3f412a9e13` (`server/src/monad/chainlink.ts`). The `/monad` page reads
the same feed through `sponsors-live.ts`.

## Engineering notes

**Agora's faucet is rate-limited for everyone at once.** It reverts with `MaxFrequencyExceeded()`, so the route
simulates first and never sends a call that will fail. It falls back to the reserve instead. The recording runbook says
it plainly: if "Get test funds" is slow, wait 30 s and tap again.

**AUSD's storage is namespaced.** On a local fork of Monad mainnet, `fundAusd` (`server/src/fork/perpl-keeper.ts`) gives
a wallet AUSD:

- AUSD is upgradeable with OpenZeppelin v5's ERC-7201 storage, so the usual mapping-slot probe misses the balance.
- `fundAusd` writes the balance at the `openzeppelin.storage.ERC20` slot instead.
- If that doesn't take, it impersonates Perpl's Exchange, which holds AUSD margin, and makes an ordinary transfer.

That is how the browser e2e `93ff7ac` runs passkey → AUSD → Perpl → stop with no faucet.

**A stablecoin feed is not a heartbeat feed.** AUSD/USD updates on deviation, so a round an hour old is not by itself a
fault. The age is shown, not hidden.

**Mainnet AUSD is held, not routed.** On Monad mainnet, AUSD is in the token registry (`server/src/venues/tokens.ts`) and
shown in balances. Spot buys are not routed through it, because no Uniswap pool on Monad held more than a few dollars of
it (checked 2026-09-24).

**History:**

| Commit | Change |
|---|---|
| `86f7900` | Deployed on Monad testnet, settling in Agora's AUSD, verified on Sourcify |
| `9b84ce2` | Perps screen: open, fund, trade, stop, resume and withdraw a Perpl desk |
| `14e8745` | Portfolio names its dollar: Cash · AUSD |
| `665570d` | AUSD's peg beside the cash, from Chainlink on Monad |
| `cbd0dc3` | AUSD named on Home |
| `93ff7ac` | Browser e2e on the fork: passkey to AUSD to Perpl to stop |

## Mobile: what is built and what is shown

**The app.** xorr is one Expo / React Native codebase:

- Expo SDK 57, React Native 0.86.3, Expo Router;
- iOS and Android ids `finance.xorr.app` in `app.json`.

The app judges use, and the demo video, run that codebase in the browser, mobile-first at phone width.

**Sign-in is Mera passkeys** (`src/auth/mera/`):

- **Web:** `platform.ts` uses the browser's WebAuthn. This is what is shown and tested (`e2e:fork`, `e2e:monad`).
- **Native:** `platform.native.ts` is built. It uses `react-native-passkey` through Mera's React Native client, with the
  Keychain/Keystore via `expo-secure-store`. It is offered only once a build names a passkey domain
  (`EXPO_PUBLIC_MERA_RP_ID`). It has not been run on a device, and no native binary was shipped for the hackathon.

## The value AUSD brought

**One unit of account across every surface.** The limit you sign, the balance you see, the margin on Perpl and the
money you withdraw are all the same token. Nothing is bridged or wrapped between them, and there is no second stablecoin
to explain on a phone screen.

**A real faucet on a real testnet.** Agora's faucet and Perpl both use AUSD, so a new wallet goes from empty to an open
Perpl position on Monad testnet with real contracts, not mocks.

**A dollar you can check.** AUSD comes with a Chainlink feed on Monad, so the app can show the peg beside the balance
instead of asserting it.

## Live proof (Monad testnet)

**The withdrawal returns AUSD to the owner (13 Oct).** From `docs/evidence/prove-perpl-desk-testnet-2026-10-13.txt`:

- owner `0x2ea15b8B…B32e`, desk `0xa21Fa870…98b5`, Perpl account #692 holding 148.90 AUSD;
- the agent opened and closed a MON long through the desk, then the owner removed it;
- `desk.withdrawCollateral(148.427218)`:
  https://testnet.monadvision.com/tx/0xec19b9ee5bfc70ccce4e3dd969cfb8c6b34841ead1d686a7dc438555d499bc3c
- the owner's AUSD went from 349.320731 to 497.747949 (+148.427218).

**Team-seeded wallets fund desks in AUSD (13 Oct).** From `docs/evidence/seed-13oct.md`, made with
`server/src/seed-activity.ts`:

- Wallet 3, `AUSD.transfer` to its desk:
  https://testnet.monadvision.com/tx/0xe2e6ac006fe1c248305005e6db7efcea807de963e63201d43710437433e340c3
- Wallet 3, `createAccount(150 AUSD)`:
  https://testnet.monadvision.com/tx/0x3fe0f2cc7bc1428668c67c144397c14633985ad2176ea1f8e063e3a557befdb9
- Round 11's wallet:
  - AUSD to the desk: https://testnet.monadvision.com/tx/0x3300985b08c86a8f21765e1d0d06e549e7e40f3a5fb06c6107ad686913af0a10
  - `createAccount(150 AUSD)`: https://testnet.monadvision.com/tx/0x0fdda18bb741680b085ffa4ebf21b5f03529fdeeae38f75a8478135a86384efd
- Round 11's trade, made with that AUSD margin (a 1x BTC long on Perpl):
  https://testnet.monadvision.com/tx/0x47e37f0c1702d8d5ca5351a61a3814966bd636b225cd7e09e80f23b43baea21e

**Settlement contract:** `XorrDelegation(AUSD)` deploy tx:
https://testnet.monadvision.com/tx/0x808687beb5699fc3a07353f65780e4e89f83d52452795b6871fb6b0c148d764e

**See it live:** https://xorr-metropolis.vercel.app. Home shows the AUSD line; Perps shows the desk; `/monad` shows the peg.
