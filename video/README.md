# The Metropolis demo video

The output is [`docs/demo/xorr-metropolis.mp4`](../docs/demo/xorr-metropolis.mp4), with captions in
[`.srt`](../docs/demo/xorr-metropolis.srt).

- Length 2:13, 1920×1080.
- H.264 video, AAC audio at −16 LUFS.
- Captions are burned in and also ship as the `.srt`.

## What is in it

**0:00–0:35, intro.** Motion graphics in xorr's own look: black, violet glow, the green X coin, Inter.

- The narration is ElevenLabs "Eric". "Daniel" was auditioned on the same line and took 8.8 s against Eric's 6.1 s.
- The block chips in the intro are an illustration.
- The ~0.3 s voted and ~0.5 s final figures are what the app's live Built on Monad page read that night.

**Then the live app:** https://xorr-metropolis.vercel.app on Monad testnet.

- It is driven by Playwright at 1920×1080 with an injected, eased cursor (`capture.mjs`).
- Frames come from Chrome's screencast, so the text stays sharp.
- Every app shot is tagged "LIVE · MONAD TESTNET".

The live scenes, in order:

- **Welcome.**
- **Built on Monad.** Mainnet's commit states, live.
- **The council.** Round 11, from a team-seeded wallet. It is labelled that way in the app and in the video, and its txs
  are in [`docs/evidence/seed-13oct.md`](../docs/evidence/seed-13oct.md). It was approved 4–0, and Kimi's vote and
  reason are on screen.
- **The trade.** The replay's outcome is on screen, then the fill's receipt.
- **The gauntlet.**
- **The stop.** The receipt of `removeOperator` from the testnet proof run of 13 Oct
  (`docs/evidence/prove-perpl-desk-testnet-2026-10-13.txt`).

**Outro.** The name, the tagline and the live URL. There is no GitHub URL, by request.

## What it does not show, and why

**The passkey sign-up, the permission and the Safety hold are not recorded.** The recording session will not create an
account on a public site. Those flows are in the earlier fork tour,
[`docs/demo/flows/`](../docs/demo/flows/).

**The fill and the stop are shown as receipt cards, not explorer pages.** Monad's testnet explorers (MonadVision,
Monadscan) answer a headless browser with a bot check, and we do not get around those. The cards are read with
`eth_getTransactionReceipt` from Monad testnet's RPC and labelled that way. Each has its full hash, so anyone can look it
up.

## Rebuild

From `video/`:

```bash
set -a; . ../../metropolis-funding/keys/api-keys.env; set +a   # ELEVENLABS_API_KEY, read from the env only
python3 tts.py          # re-voices only changed lines (work/vo/lines.json)
python3 timeline.py     # work/timing.json, work/narration.wav, captions.srt
node capture.mjs        # the live take: work/capture/
python3 build.py        # work/base.mp4, work/cut.json
python3 gen_overlay.py  # hf/index.html (receipts.json: the two receipts, read from the RPC)
python3 assemble.py     # HyperFrames overlay render + mix → docs/demo/xorr-metropolis.mp4 and .srt
```

`work/` is scratch and is not committed. Take a slot with `metropolis-funding/slots/heavy.sh` before the capture and
the render. The pipeline is adapted from `clockin/videos/_pipeline` for landscape web capture.
