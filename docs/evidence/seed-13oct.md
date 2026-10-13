# Team-seeded activity, Monad testnet, 13 Oct 2026

**These are team-seeded wallets, not users.** The XORR team made three fresh wallets on 13 Oct to show the whole path on
Monad testnet, and a judge can open one of these rounds without signing in. Each wallet goes:

1. Permission: a Perpl desk created from the owner's own signature, funded, and given limits.
2. One council round.
3. The trade that round approved.

The script is `server/src/seed-activity.ts`. It ran inside the hosted executor. Gas and AUSD came from XORR's own
testnet faucet key, about 0.59 MON in all.

The rounds are marked `convened_by = 'team-seed'`, and the app labels them "team-seeded":

- Public replay: <https://xorr-metropolis.vercel.app/council/sample>. It shows the newest seeded round, signed out.
- API: `GET /council/public` on <https://executor-monad-testnet-production.up.railway.app/council/public>.

Every wallet got the same limits: $100 an order, $300 a day, 2x. Every proposal was "buy $50 of BTC".

| | Wallet | Desk (Perpl DelegatedAccount) | Round | Vote | Trade tx |
|---|---|---|---|---|---|
| 1 | 0xD27d47c49799500abfc668780375a8F37633E22c | 0x67aBb4D761DA56C038Daa981DEfF737FDB9F0008 | 8 | Approved 4–1 | [0x3801226d…](https://testnet.monadexplorer.com/tx/0x3801226dad6e0b03b059874dcc5bd39392a233133b1b20bf043f3b21728aad5f) |
| 2 | 0xE5ae9a0C0Cf66903596681dF583f1b72906A824f | 0xA5f35159A6B9a5f2A2e80E62A83d10BCb7dc8732 | 9 | Approved 2–1 | [0x58b91c83…](https://testnet.monadexplorer.com/tx/0x58b91c83217ddcd94ccda5e4543adb012b5c36f8f17b0128a241ea520520dd48) |
| 3 | 0x3a1615def5bdfbE3d7906E0Ef218a863bC08432E | 0xE2073018CdD93E1fC5fed903cC6Fc0A447281F85 | 10 | Approved 2–1 | [0x312d9dba…](https://testnet.monadexplorer.com/tx/0x312d9dba3d69fc9f225897e327cf4d6eaa3bd05ecef1c0d238825b3602f820a3) |

Each approved round opened a 1x long of 0.00059 BTC on Perpl testnet through the owner's desk.

## Permission txs

- Desk created from the owner's signature (`createWithSignature`):
  - wallet 1: [0x2d00f1eb…](https://testnet.monadexplorer.com/tx/0x2d00f1eb9be31fa4915e22b93bacb626668bc122cf3f207c599a26c5d2e24479)
  - wallet 2: [0x5cfde065…](https://testnet.monadexplorer.com/tx/0x5cfde0658b66c68b54c4d90eb4a456ffb1446460dda21fd8681ea88e33bd9b86)
  - wallet 3: [0x4468bb54…](https://testnet.monadexplorer.com/tx/0x4468bb548ca8e4d67bd293489f2bec449d20c1744060ee8fa0b150e0cf2b65bd)
- Wallet 3's desk funded and its Perpl account opened:
  - AUSD.transfer: [0xe2e6ac00…](https://testnet.monadexplorer.com/tx/0xe2e6ac006fe1c248305005e6db7efcea807de963e63201d43710437433e340c3)
  - createAccount(150 AUSD): [0x3fe0f2cc…](https://testnet.monadexplorer.com/tx/0x3fe0f2cc7bc1428668c67c144397c14633985ad2176ea1f8e063e3a557befdb9)
- The owner allows Perpl's current `execOrder` on the desk (`setOperatorAllowlist`):
  - wallet 1: [0x7c729b4b…](https://testnet.monadexplorer.com/tx/0x7c729b4b88dc69bc2522b1822418cb810e5f5174517071af369e8ddbf1938422)
  - wallet 2: [0x48137624…](https://testnet.monadexplorer.com/tx/0x48137624ecec0ee697e979ea6c755b322821679a1a45f014f83daec521194fb7)
  - wallet 3: [0xbe2e41fe…](https://testnet.monadexplorer.com/tx/0xbe2e41fe2efc3e5c41f0c8e18d4ab33e6946c7156e67ef187fcb1358c1ea6fb4)

## Funding from XORR's faucet

| Wallet | MON | AUSD |
|---|---|---|
| 1 | [0x3da8f15a…](https://testnet.monadexplorer.com/tx/0x3da8f15afe79425abf60fd758780373d6952eed25b5e126519efa92ebbf1ad9e), [0x57116232…](https://testnet.monadexplorer.com/tx/0x571162326533e22383ab83f8e8a69f66ff0377cb4f0250a25d1ff683bd1f07da) | [0x7ff57b5b…](https://testnet.monadexplorer.com/tx/0x7ff57b5b6ceba2348510c814c4bcc84134774e276f922c334aeeefb3019f3c3c), [0x714628af…](https://testnet.monadexplorer.com/tx/0x714628afd0251e4ccfc7982fdae380040e1cab85a1f6c4bd09cdfabdba3626f3) |
| 2 | [0xce7f2742…](https://testnet.monadexplorer.com/tx/0xce7f2742c7e7cf1876afdcd5e4a62db8251cf650f466efd14a49177e986cced9) | [0x353a80f1…](https://testnet.monadexplorer.com/tx/0x353a80f1074fcdc07f287cdd29ac3ae7d69a0e551e6ff85f36e7791bdcc515b3) |
| 3 | [0xd16e1fb1…](https://testnet.monadexplorer.com/tx/0xd16e1fb11ce8d8d470181ff01814a9d42e405a761da1c11c7c1239785e908712) | [0x896075d4…](https://testnet.monadexplorer.com/tx/0x896075d4e21dd252d7521082f3d6ceb6b7b63c637fd2adf4b853f91547308584), [0xa4f6012c…](https://testnet.monadexplorer.com/tx/0xa4f6012c6389bd3110cd012affd29487da9bbccd7b81e193d07da3250346eabe) |

An earlier wallet, 0xb83b93B5992A26f8D424b3bd5Ed41759DF63118A, was funded from a laptop run and then abandoned: that run
could not reach the hosted database. It holds 0.08 MON and 200 AUSD.

## What failed first, kept honestly

Rounds 1–7 were the same three wallets, and every one was vetoed:

- The risk seat could not read the desk. Monad testnet's public RPC answers 15 requests a second, and a round reads a lot
  at once. Reads now fall back to Monad's other public testnet RPCs (`server/src/evm/client.ts`).
- MON's Chainlink feed on testnet was 226 minutes old, past its 60-minute heartbeat, so the price seat vetoed the MON
  proposals. The seeds then proposed BTC instead.

The vetoed rounds stay in the record. The council refusing to trade blind is the system working.
