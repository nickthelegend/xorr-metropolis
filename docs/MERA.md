# How xorr uses Mera

xorr is a council of AI agents that trades for you on Monad, inside a limit you sign and the chain enforces. Mera
(`@category-labs/mera`) is the account layer: **one passkey is the wallet**. xorr claims both Mera bounties, **Best
Mera-Powered UX** and **One Passkey, Many Keys**.

## What Mera does in the product

- **Sign-up is one passkey.** On `/wallet`, "Create a passkey account" (`passkey-create`) makes the account. There is no
  email, no seed phrase, and nothing that can sign is stored.
- **Signing has no popups.** The trading permission, revokes and the other signatures go through a Mera signing session.
  The passkey is asked at most once, then not again for 15 minutes.
- **The window is visible.** Settings shows "Passkey signing · unlocked" with the minutes left and a tap to lock now, or
  "locked" with what the next signature will do.
- **The stateless test.** Wipe browser storage, press "Sign in with a passkey" (`passkey-sign-in`), and the same account
  comes back. That works because the account is derived from the passkey, not stored.
- **A second key from the same passkey.** Each run has a **Private note**, sealed on the device with a key from the same
  passkey under a different PRF salt. xorr's server stores only ciphertext.
- **The passkey, checked by Monad.** On `/monad`, "Check my passkey on Monad" has the passkey sign a challenge. Monad's
  P256VERIFY precompile at `0x0100` then verifies that signature.

**The second way in.** Privy sign-in is also offered below the passkey buttons: Google, X, a browser wallet, or an
email code. Those accounts use Privy's embedded wallet. Private notes need a passkey, so they are shown only to passkey
accounts.

## How it works

**The account** (`src/auth/mera/derive.ts`). The passkey's 32-byte PRF output becomes a 24-word BIP-39 phrase, and the
key is derived at `m/44'/60'/0'/0/0`. So the same passkey gives the same address on any device. Any BIP-39 wallet derives
the same address from that phrase, so nobody is locked into xorr.

```ts
export function privateKeyFromPrf(prfOutput: Uint8Array): Uint8Array {
  const seed = mnemonicToSeedSync(phraseFromPrf(prfOutput));
  const key = HDKey.fromMasterSeed(seed).derive(ACCOUNT_PATH).privateKey;
  seed.fill(0);
```

**The signing session** (`src/auth/mera/session.ts`). `createPasskeyWithPrfOutput` handles sign-up and
`getPasskeyPrfOutput` handles sign-in. The key goes straight into `createSecp256k1SigningSession`, and xorr zeroes its
own copy:

```ts
const session = createSecp256k1SigningSession({ privateKey });
// Mera keeps its own copy; ours goes.
privateKey.fill(0);
prfOutput.fill(0);
const account = toViemAccount(session);
const until = Date.now() + SIGNING_WINDOW_MS;   // 15 minutes
live = { account, session, until, timer: setTimeout(lockSigning, SIGNING_WINDOW_MS) };
```

Mera sessions have no expiry of their own; `end()` is all there is. xorr adds the 15-minute window and its countdown.
`lockSigning()` calls `session.end()`. Only the address and the executor's session token go to storage
(`xorr.mera.v1`).

`signingAccount()` returns the open session. If none is open, it asks the passkey once. It refuses a passkey that derives
a different address from the one signed in: "That passkey is for …, not the account signed in here. Nothing was signed."

**Answering as a wallet** (`src/auth/mera/provider.ts`). `meraProvider(account, chainId)` answers the requests the
app's signer makes of any wallet: `eth_chainId`, `eth_accounts`, `eth_signTransaction`, `eth_signTypedData_v4` and
`personal_sign`. EIP-712 bigints come back from JSON before they are hashed. It refuses to sign for another chain, and it
never sends: `eth_sendTransaction` throws "A passkey account signs; the app sends. Nothing was sent." In
`src/auth/useGrantDelegation.web.ts`, a signed-in passkey account takes this path instead of Privy's wallet, with
`signOnly: true`.

**Sign-in to the executor** (`server/src/auth/passkey-session.ts`). The passkey never reaches the server.

- `POST /auth/passkey/challenge {address}` returns a message stating that it sends no transaction and costs nothing.
- The account signs that message.
- `POST /auth/passkey/session` checks the signature with viem's `verifyMessage` and returns a 24-hour token.
- The challenge and the token are both HMAC-sealed, so the executor keeps no nonce table and a restart signs no one out.
- The user is `mera:<address>`, and that address is their only wallet.

**Many keys: private notes** (`src/auth/mera/notes.ts`, `notes-key.ts`, `server/src/routes/private-notes.ts`). The
wallet key is the PRF output under Mera's default salt. The notes key is the PRF output under `sha256("xorr.notes.v1")`.

```ts
const got = await getPasskeyPrfOutput({ ...passkeyTarget(), prfSalt: await notesSalt() });
cached = { key: await noteKeyFrom(got.prfOutput), until: Date.now() + SIGNING_WINDOW_MS };
```

- **The key:** `noteKeyFrom` imports those bytes as a non-extractable AES-256-GCM key and zeroes them. The key is held
  for the same 15-minute window as signing.
- **Sealing:** `sealNote` uses a fresh 12-byte IV each time.
- **Storage:** `GET`/`PUT`/`DELETE /notes/:subject` (subject `run:<uuid>`) store only `{iv, ciphertext}` for the
  caller's wallet. The server checks their shape and cannot read them.
- **A key from another passkey** fails GCM's check rather than decrypting to garbage.
- **Where:** the note card is in `app/runs/[id].tsx` (`note-unlock`, `note-save`).

**The passkey on chain: P256VERIFY** (`src/monad/passkeyCheck.ts`, `server/src/monad/passkey-p256.ts`).

- Mera's ceremony returns PRF output, not a signature. So this check makes its own WebAuthn assertion with
  `navigator.credentials.get` over a challenge from `POST /monad/p256/challenge`. The challenge is single-use and expires
  in two minutes.
- The server rebuilds the signed message as `sha256(authenticatorData ‖ sha256(clientDataJSON))`.
- One P-256 signature fits two public keys. So the first check asks for two assertions and keeps the key both fit; later
  checks need one.
- `POST /monad/p256/verify` makes an `eth_call` to `0x0100` on **Monad mainnet** and on **the executor's own chain**. As
  a control, it also sends the same signature over a different message, which must be refused.
- **Where:** the result is shown under `monad-passkey-result`.
- **The always-on reading:** separately, item 4 on `/monad` (`monad-item-p256`) always shows the same check, made with a
  P-256 key the server generates (`server/src/monad/native.ts`).

**On the phone** (`src/auth/mera/platform.native.ts`). The same session code runs through Mera's
`reactNativeWebAuthnClient`, and the signed-in state is kept in the Keychain/Keystore. It needs a passkey domain
(`EXPO_PUBLIC_MERA_RP_ID`, with the files in `docs/passkey-domain/`). Without one, the passkey buttons are hidden. This
path has not yet been verified on a device, and the P256 check is web-only.

## Engineering notes

**PRF is the requirement, so failures name it.** `src/auth/mera/failure.ts` maps Mera's error codes into words a person
can act on:

- `PRF_UNAVAILABLE` names the providers that work: Chrome with Google Password Manager, Safari 18+ with iCloud Keychain,
  or a security key with PRF.
- A cancelled prompt shows nothing at all.

**Nothing that signs is written down.** Each key, or its PRF bytes, is zeroed as soon as it is handed on:

- the derivation seed, once the key is derived;
- xorr's copy of the key and the PRF output, once Mera's session has the key;
- the notes PRF bytes, once they are imported as the AES key.

The executor's session secret is `XORR_SESSION_SECRET`, or else derived from the delegate key it already holds. Without
either, passkey sign-in is off, and the routes answer 503 saying so.

**Tests:**

- `src/auth/mera/derive.test.ts`: the address is deterministic, and it is BIP-39 portable.
- `src/auth/mera/provider.test.ts`: signs as the account, refuses another chain, never sends.
- `src/auth/mera/notes.test.ts`: the same key opens a note; another passkey cannot; nonces never repeat; its salt is not
  the wallet's.
- `server/src/auth/passkey-session.test.ts` and `server/src/monad/passkey-p256.test.ts`.
- **End to end**, in Chromium with a virtual CTAP2 authenticator that has PRF (`hasPrf: true`): `npm run e2e:fork`,
  `e2e:flows` and `e2e:monad`.

**History:**

| Commit | Change |
|---|---|
| `7b64c9e` | Passkey sign-in: the account derived on the device, signing in a bounded window |
| `d5239c1` | Private notes: a second key from the same passkey |
| `8848601` | Mera on the phone |
| `e6bed0a` | The passkey checked by Monad's P256 precompile on `/monad` |

## The value Mera brought

**Onboarding without a wallet.** A trading app usually starts with "install a wallet, save 12 words". With Mera, the
first screen makes the account in one prompt. In the fork run of 7 Oct, it was 7.7 s from opening the app to a confirmed
on-chain permission.

**Agents need many signatures, and people hate popups.** A council of agents only works if the owner can grant, revoke
and adjust without approving a wallet sheet each time. Mera's session gives that: one passkey prompt, then 15 minutes of
silent signing, then locked again. The window is shown on screen, and you can end it with a tap.

**Stateless by construction.** The address comes from the passkey. So a cleared browser, a new laptop or a phone signs
back into the same account, and the phrase it stands for works in any BIP-39 wallet.

**One passkey, more than a wallet.** The same passkey, under another salt, gives an encryption key for the owner's
private notes on their trades. xorr hosts them and cannot read them. And Monad itself verifies the passkey's own P-256
signature at the precompile. No verifier contract is involved.

## Live proof

- **Demo video:** `docs/demo/xorr-demo.mp4` (2:56). It shows passkey sign-up, the permission signed with no wallet popup,
  and "Check my passkey on Monad" verified by `0x0100`.
- **Walkthrough:** `docs/demo/xorr-walkthrough.mp4` (4:04). It also shows the stateless test: storage wiped, the
  passkey alone, the same account.
- **Where they were recorded:** the signed-in footage in both videos was recorded on a **local fork of Monad mainnet**
  (`video/record-flow.mjs`), and it is tagged that way on screen.
- **Where the P256 reads run:** against Monad mainnet itself, and against the fork.
- **Logged runs** (fork-only):
  - `docs/evidence/e2e-fork-journey-2026-10-07.txt`: account `0xf27d6D6e45CC01e46583b08bFaeBd37D3f3194A6` created from a
    passkey; the permission signed through the Mera session, with no popup; "the stateless test: storage cleared, the
    passkey rebuilds the same account".
  - `docs/evidence/e2e-flows-2026-10-07.txt`: B15 (a private note sealed with the passkey's second key, reopened after a
    reload) and B16 (lock the signing window; the next signature asks the passkey again).
- **Monad testnet:** the hosted app offers passkey sign-up, since the relying party is the page's own host. The
  team-seeded testnet wallets in `docs/evidence/seed-13oct.md` were made by a script, not with passkeys. So xorr cites no
  testnet transaction from a passkey account.
