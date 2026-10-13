#!/usr/bin/env python3
"""Make one of the Metropolis videos from its edit list: narration, timeline, footage bed, overlay, render, mix.

    python3 make.py edl/submission.json [--no-render]   → ../docs/demo/xorr-<name>.mp4 and .srt

An edit list is a list of segments. Each is footage from one of two real takes, or a card:
  flow  the full journey on the local fork of Monad mainnet (record-flow.mjs → work/flow): seconds since its start;
  live  the hosted app on Monad testnet (capture.mjs → work/capture): seconds since its first scene;
  card  a title, stats or receipt card (opaque).
A segment lasts as long as its narration (or `min`). Footage is fitted to it honestly: the take's chain waits are cut
(run.json) are fast-forwarded at ×2–×8 and the rest plays at ×1 where it fits (×0.85–×2.5 otherwise); every sped-up
stretch carries a \"⏩ ×N\" chip. Nothing is cut out or re-ordered within a segment. Voice: ElevenLabs Daniel (metropolis-funding/VOICES.md), the same in every video.
"""
import base64, bisect, datetime, html, json, os, re, shutil, subprocess, sys, urllib.request
import numpy as np, soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
EDL = json.load(open(sys.argv[1]))
NAME = EDL["name"]
W = os.path.join(HERE, "work", NAME)
os.makedirs(os.path.join(W, "vo"), exist_ok=True)
VOICE, SPEED, MODEL = "onwK4e9ZLuTAKqWW03F9", 1.1, "eleven_multilingual_v2"
FPS, SR = 30, 48000
GAP, LEAD, TAIL = 0.35, 0.35, 0.45
E = html.escape

# ── 1. narration: one ElevenLabs call per line, cached by text (shared across videos) ─────────────────────────────
CACHE = os.path.join(HERE, "work", "vo-cache")
os.makedirs(CACHE, exist_ok=True)


def voice(text):
    import hashlib
    h = hashlib.sha1(f"{VOICE}|{SPEED}|{MODEL}|{text}".encode()).hexdigest()[:16]
    meta, wav = os.path.join(CACHE, h + ".json"), os.path.join(CACHE, h + ".wav")
    if os.path.exists(meta) and os.path.exists(wav):
        return json.load(open(meta))
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128",
        data=json.dumps({"text": text, "model_id": MODEL,
                         "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.15, "speed": SPEED}}).encode(),
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"], "content-type": "application/json"})
    d = json.load(urllib.request.urlopen(req, timeout=120))
    mp3 = os.path.join(CACHE, h + ".mp3")
    open(mp3, "wb").write(base64.b64decode(d["audio_base64"]))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp3, "-ar", str(SR), "-ac", "1", wav], check=True)
    a = d["alignment"]
    m = {"text": text, "file": wav, "seconds": len(sf.read(wav)[0]) / SR,
         "chars": a["characters"], "starts": a["character_start_times_seconds"], "ends": a["character_end_times_seconds"]}
    json.dump(m, open(meta, "w"))
    print(f"  voiced {m['seconds']:5.2f}s  {text[:70]}", flush=True)
    return m


def words(l):
    out, cur, st, last = [], "", None, 0
    for ch, a, b in zip(l["chars"], l["starts"], l["ends"]):
        if ch.isspace():
            if cur: out.append([cur, st, last]); cur = ""
            continue
        if not cur: st = a
        cur += ch; last = b
    if cur: out.append([cur, st, last])
    return out


# ── 2. timeline ──────────────────────────────────────────────────────────────────────────────────────────────────────
t, segs, cues, pieces = 0.0, [], [], []
for i, sg in enumerate(EDL["segments"]):
    start = t
    t += LEAD if sg.get("lines") else 0
    for text in sg.get("lines", []):
        l = voice(text)
        a, _ = sf.read(l["file"], dtype="float32")
        pieces.append((t, a))
        buf = []
        for w in words(l):
            if buf and len(" ".join(x[0] for x in buf + [w])) > 44:
                cues.append([t + buf[0][1], t + buf[-1][2], " ".join(x[0] for x in buf)]); buf = []
            buf.append(w)
            if re.search(r"[.?!:]$", w[0]) and len(" ".join(x[0] for x in buf)) > 14:
                cues.append([t + buf[0][1], t + buf[-1][2], " ".join(x[0] for x in buf)]); buf = []
        if buf: cues.append([t + buf[0][1], t + buf[-1][2], " ".join(x[0] for x in buf)])
        t += l["seconds"] + GAP
    if sg.get("lines"): t += TAIL - GAP
    t = max(t, start + sg.get("min", 0))
    segs.append({**sg, "start": round(start, 3), "end": round(t, 3)})
TOTAL = round(t, 3)
for a, b in zip(cues, cues[1:]):
    a[1] = b[0] - 0.03 if b[0] - a[1] < 0.6 else a[1] + 0.3
cues[-1][1] = min(TOTAL - 0.1, cues[-1][1] + 0.4)
buf = np.zeros(int(TOTAL * SR) + SR, dtype=np.float32)
for st, a in pieces:
    k = int(round(st * SR)); buf[k:k + len(a)] += a
sf.write(os.path.join(W, "narration.wav"), buf[: int(TOTAL * SR)], SR)


def ts(x):
    ms = int(round(x * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


SRT = os.path.join(W, "captions.srt")
with open(SRT, "w") as f:
    for n, (a, b, c) in enumerate(cues, 1):
        f.write(f"{n}\n{ts(a)} --> {ts(b)}\n{c}\n\n")
print(f"{NAME}: {TOTAL:.1f}s ({int(TOTAL // 60)}:{TOTAL % 60:04.1f}), {len(segs)} segments, {len(cues)} cues")

# ── 3. footage bed ───────────────────────────────────────────────────────────────────────────────────────────────────
TAKES = {}
fl = os.path.join(HERE, "work", "flow")
run = json.load(open(os.path.join(fl, "run.json")))
fr = json.load(open(os.path.join(fl, "frames.json")))
TAKES["flow"] = {"dir": fl, "frames": fr, "t": [f["t"] for f in fr], "t0": run["t0"], "cuts": sorted(run["cuts"])}
lv = os.path.join(HERE, "work", "capture")
mk = json.load(open(os.path.join(lv, "markers.json")))["markers"]
fr = json.load(open(os.path.join(lv, "frames.json")))
TAKES["live"] = {"dir": lv, "frames": fr, "t": [f["t"] for f in fr], "t0": mk[0]["t"], "cuts": []}
black = os.path.join(W, "black.jpg")
from PIL import Image
Image.new("RGB", (1920, 1080), "black").save(black)


def kept(take, a, b):
    """The [a, b] window of a take with its chain waits removed: a list of (from, to) runs."""
    runs, x = [], a
    for ca, cb in take["cuts"]:
        if cb <= x or ca >= b: continue
        if ca > x: runs.append((x, ca))
        x = max(x, cb)
    if x < b: runs.append((x, b))
    return runs


def pieces_for(take, a, b, dout):
    """Fit [a, b] of a take into dout seconds: chain waits fast-forwarded at ×2–×8, the rest at ×1 where it fits
    (×0.85–×2.5 otherwise). Returns [(src_from, src_to, speed)] in order, and a skip from the start if it still overflows."""
    parts, x = [], a
    for ca, cb in take["cuts"]:
        if cb <= x or ca >= b: continue
        if ca > x: parts.append([x, ca, "n"])
        parts.append([max(x, ca), min(b, cb), "w"]); x = min(b, cb)
    if x < b: parts.append([x, b, "n"])
    N = sum(q - p for p, q, k in parts if k == "n"); Wt = sum(q - p for p, q, k in parts if k == "w")
    if Wt == 0:
        r, w = min(2.5, max(0.85, N / dout)), 1
    else:
        r, w = 1.0, min(8.0, max(2.0, Wt / max(0.01, dout - N)))
        if N + Wt / 8 > dout:   # even ×8 waits overflow: speed the rest too
            w = 8.0; r = min(2.5, N / max(0.01, dout - Wt / 8))
        elif dout - N > Wt / 2:  # time to spare: waits at ×2, the rest no slower than ×0.85
            w = 2.0; r = max(0.85, N / (dout - Wt / 2))
    out = [(p, q, (r if k == "n" else w)) for p, q, k in parts]
    total = sum((q - p) / v for p, q, v in out)
    return out, max(0.0, total - dout)


def chip(v):
    return f"⏩ ×{v:.0f}" if v >= 1.95 else f"⏩ ×{v:.1f}"


frames_out, chips = [], []
for sg in segs:
    n = int(round(sg["end"] * FPS)) - int(round(sg["start"] * FPS))
    if sg["src"] == "card":
        frames_out += [black] * n; sg["rate"] = None; continue
    tk = TAKES[sg["src"]]
    pcs, over = pieces_for(tk, sg["from"], sg["to"], n / FPS)
    skip = over if sg.get("keep") != "start" else 0.0
    sg["rate"] = round(max(v for _, _, v in pcs), 2)
    # output time → source time, walking the pieces; record each sped-up stretch for its chip
    ot = -skip
    spans = []
    for p_, q_, v in pcs:
        d = (q_ - p_) / v
        spans.append((ot, ot + d, p_, v)); ot += d
    for (o1, o2, p_, v) in spans:
        if v > 1.15 and o2 > 0 and o1 < n / FPS:
            chips.append([sg["start"] + max(0, o1), sg["start"] + min(n / FPS, o2), chip(v)])
    for k in range(n):
        o = k / FPS
        src = None
        for (o1, o2, p_, v) in spans:
            if o1 <= o < o2: src = p_ + (o - o1) * v; break
        if src is None: src = pcs[-1][1] - 0.02
        j = max(0, bisect.bisect_right(tk["t"], tk["t0"] + src) - 1)
        frames_out.append(os.path.join(tk["dir"], "frames", tk["frames"][j]["name"]))
# merge touching chips with the same label; give each at least 0.6 s on screen
merged = []
for c in sorted(chips):
    if merged and merged[-1][2] == c[2] and c[0] - merged[-1][1] < 0.3: merged[-1][1] = c[1]
    else: merged.append(c)
chips = [[a_, max(b_, a_ + 0.6), t_] for a_, b_, t_ in merged]
with open(os.path.join(W, "frames.txt"), "w") as f:
    for p in frames_out:
        f.write(f"file '{p}'\nduration {1 / FPS:.6f}\n")
    f.write(f"file '{frames_out[-1]}'\n")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", os.path.join(W, "frames.txt"),
                "-vf", f"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps={FPS},format=yuv420p",
                "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-r", str(FPS), os.path.join(W, "base.mp4")], check=True)
for sg in segs:
    print(f"  {sg['start']:7.2f}-{sg['end']:7.2f} {sg['src']:5} {('x' + str(sg['rate'])) if sg['rate'] else '':6} {sg.get('label', sg.get('card', {}).get('title', ''))[:50]}")

# ── 4. overlay ───────────────────────────────────────────────────────────────────────────────────────────────────────
out, tw, cn = [], [], [0]


def clip(cls, start, dur, track, inner):
    cn[0] += 1
    cid = f"c{cn[0]}"
    out.append(f'<div id="{cid}" class="clip {cls}" data-start="{start:.3f}" data-duration="{dur:.3f}" data-track-index="{track}"><div class="in" id="{cid}i">{inner}</div></div>')
    return cid


def fade(cid, a, d, rise=12, inn=0.3, outd=0.2):
    tw.append(f'tl.fromTo("#{cid}i",{{opacity:0,y:{rise}}},{{opacity:1,y:0,duration:{inn},ease:"power3.out"}},{a:.3f});')
    tw.append(f'tl.to("#{cid}i",{{opacity:0,duration:{outd},ease:"power1.in"}},{a + d - outd:.3f});')


TAG = {"flow": '<span class="pill fork">REAL APP · LOCAL FORK OF MONAD MAINNET</span><span class="url">sped-up stretches marked ⏩</span>',
       "live": '<span class="pill live"><i class="ld"></i>LIVE · MONAD TESTNET</span><span class="url">xorr-metropolis.vercel.app</span>'}
rc = json.load(open(os.path.join(HERE, "receipts.json")))
short = lambda x: f"{x[:6]}…{x[-4:]}"
app_spans = []
chapter = 0
for sg in segs:
    a, b = sg["start"], sg["end"]; d = b - a
    if sg["src"] in TAKES:
        app_spans.append((a, b))
        c = clip("tagtl", a, d, 2, TAG[sg["src"]]); fade(c, a, d, rise=-8)
        if sg.get("label"):
            if sg.get("chapter", True): chapter += 1
            num = f'<div class="lnum">{chapter:02d}</div>' if sg.get("chapter", True) else ""
            c = clip("label", a, d, 3, f'{num}<div class="ltitle">{E(sg["label"])}</div>'
                     + (f'<div class="lsub">{E(sg["sub"])}</div>' if sg.get("sub") else "")
                     + (f'<div class="pill seed">{E(sg["chip"])}</div>' if sg.get("chip") else ""))
            fade(c, a, d)
        continue
    cd = sg["card"]
    kind = cd.get("kind", "title")
    if kind == "receipt":
        r = rc[cd["which"]]
        rows = [("From", f'{short(r["from"])} · {cd["fromWho"]}'), ("To", f'{short(r["to"])} · {cd["toWho"]}'),
                ("Method", f'{cd["method"]} ({r["input"]})'),
                ("Block", f'{r["block"]:,} · ' + datetime.datetime.fromtimestamp(r["time"], datetime.timezone.utc).strftime("%d %b %Y, %H:%M:%S UTC")),
                ("Gas used", f'{r["gasUsed"]:,}')]
        body = (f'<div class="rcard"><div class="rkick">{E(cd["kicker"])}</div><div class="rtitle">{E(cd["title"])}</div>'
                f'<div class="rstatus"><span class="ok">✓ Success</span><span class="rhash">{E(r["hash"])}</span></div>'
                + "".join(f'<div class="rr"><span class="rk">{E(k)}</span><span class="rv">{E(v)}</span></div>' for k, v in rows) + '</div>')
        tag = '<span class="pill ex">READ FROM MONAD TESTNET · eth_getTransactionReceipt</span>'
    elif kind == "stats":
        body = (f'<div class="tcard"><div class="rkick">{E(cd["kicker"])}</div><div class="ttl">{E(cd["title"])}</div>'
                + '<div class="stats">' + "".join(f'<div class="st"><div class="sv">{E(v)}</div><div class="sk">{E(k)}</div></div>' for v, k in cd["stats"]) + '</div>'
                + (f'<div class="tsub">{E(cd["sub"])}</div>' if cd.get("sub") else "") + '</div>')
        tag = f'<span class="pill ex">{E(cd["tag"])}</span>' if cd.get("tag") else ""
    elif kind == "kinetic":
        # Kinetic type over the brand's coin: each line's words rise in turn; `hi` words are lit in the accent colour.
        hi = set(cd.get("hi", []))
        rows = "".join('<div class="kl">' + " ".join(f'<span class="kw{" hi" if w.strip(".,").lower() in hi else ""}">{E(w)}</span>' for w in line.split()) + '</div>'
                       for line in cd["words"])
        body = (f'<img class="kcoin" src="assets/coin.png" alt="">'
                + (f'<div class="rkick kk">{E(cd["kicker"])}</div>' if cd.get("kicker") else "")
                + f'<div class="kin">{rows}</div>')
        tag = ""
    elif kind == "terminal":
        # A real CLI run, line by line as it was printed (the lines come from the run's own output, file in `src`).
        lines = json.load(open(os.path.join(HERE, cd["src"])))
        body = ('<div class="term"><div class="tbar"><i></i><i></i><i></i><span>' + E(cd.get("title", "")) + '</span></div><div class="tbody">'
                + "".join(f'<div class="tl{" tcmd" if x.startswith("$") else ""}{" tok" if x.startswith(("✓", chr(34))) else ""}{" tlog" if "USER LOG" in x else ""}">{E(x)}</div>' for x in lines)
                + '</div></div>')
        tag = f'<span class="pill ex">{E(cd["tag"])}</span>' if cd.get("tag") else ""
    elif kind == "outro":
        body = ('<img class="coin" src="assets/coin.png" alt=""><img class="wm6" src="assets/wordmark.png" alt="XORR">'
                f'<div class="tag6">{E(cd["title"])}</div><div class="ourl">xorr-metropolis.vercel.app</div>'
                '<div class="chips6 o">' + "".join(f'<span class="chip{" g" if i == 0 else ""}">{E(x)}</span>' for i, x in enumerate(cd.get("chips", []))) + '</div>')
        tag = ""
    else:
        body = (f'<div class="tcard"><div class="rkick">{E(cd.get("kicker", ""))}</div><div class="ttl xl">{E(cd["title"])}</div>'
                + (f'<div class="tsub">{E(cd["sub"])}</div>' if cd.get("sub") else "")
                + ('<div class="chips6 c">' + "".join(f'<span class="chip">{E(x)}</span>' for x in cd.get("chips", [])) + '</div>' if cd.get("chips") else "")
                + '</div>')
        tag = f'<span class="pill ex">{E(cd["tag"])}</span>' if cd.get("tag") else ""
    c = clip("full slate", a, d, 1, '<div class="glow"></div>' + body)
    tw.append(f'tl.fromTo("#{c}i",{{opacity:0}},{{opacity:1,duration:0.3}},{a:.3f});')
    tw.append(f'tl.fromTo("#{c}i .rcard, #{c}i .tcard, #{c}i .coin",{{y:30,opacity:0}},{{y:0,opacity:1,duration:0.5,ease:"power3.out"}},{a + 0.05:.3f});')
    tw.append(f'tl.fromTo("#{c}i .rr, #{c}i .st, #{c}i .chip",{{opacity:0,y:10}},{{opacity:1,y:0,duration:0.3,stagger:0.1}},{a + 0.35:.3f});')
    if kind == "terminal":
        tw.append(f'tl.fromTo("#{c}i .tl",{{opacity:0}},{{opacity:1,duration:0.05,stagger:{max(0.25, min(1.2, (d - 3) / max(1, len(json.load(open(os.path.join(HERE, cd["src"])))))) ):.3f}}},{a + 0.4:.3f});')
    if kind == "kinetic":
        per = max(0.12, min(0.32, (d - 1.2) / max(1, sum(len(l.split()) for l in cd["words"]))))
        tw.append(f'tl.fromTo("#{c}i .kw",{{opacity:0,y:60,rotationX:-40}},{{opacity:1,y:0,rotationX:0,duration:0.45,stagger:{per:.3f},ease:"power3.out"}},{a + 0.15:.3f});')
        tw.append(f'tl.fromTo("#{c}i .kcoin",{{scale:1.08,rotation:-6}},{{scale:1,rotation:4,duration:{d:.2f},ease:"none"}},{a:.3f});')
    if b < TOTAL - 0.05: tw.append(f'tl.to("#{c}i",{{opacity:0,duration:0.25}},{b - 0.25:.3f});')
    if tag:
        c2 = clip("tagtl", a, d, 2, tag); fade(c2, a, d, rise=-8)

for a, b, label in chips:
    c = clip("speed", a, b - a, 4, f'<span class="pill spd">{E(label)}</span>')
    tw.append(f'tl.fromTo("#{c}i",{{opacity:0,scale:0.85}},{{opacity:1,scale:1,duration:0.15}},{a:.3f});')
    tw.append(f'tl.to("#{c}i",{{opacity:0,duration:0.12}},{b - 0.12:.3f});')

for a, b, text in cues:
    side = any(x <= a < y for x, y in app_spans)
    c = clip("cap side" if side else "cap bottom", a, max(0.25, b - a), 6, f'<span class="capbox">{E(text)}</span>')
    tw.append(f'tl.fromTo("#{c}i",{{opacity:0,y:8}},{{opacity:1,y:0,duration:0.14,ease:"power2.out"}},{a:.3f});')

HF = os.path.join(W, "hf")
if os.path.exists(HF): shutil.rmtree(HF)
shutil.copytree(os.path.join(HERE, "hf"), HF, ignore=shutil.ignore_patterns("index.html", "node_modules", "snapshots"))
CSS = open(os.path.join(HERE, "overlay.css")).read() + open(os.path.join(HERE, "overlay-make.css")).read()
open(os.path.join(HF, "index.html"), "w").write(f'''<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=1920, height=1080" />
<title>XORR {NAME}</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
{CSS}
</style></head><body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL:.3f}" data-width="1920" data-height="1080">
{chr(10).join(out)}
</div>
<script>
const tl = gsap.timeline({{ paused: true }});
{chr(10).join(tw)}
window.__timelines["main"] = tl;
</script></body></html>
''')
json.dump({"total": TOTAL, "segments": segs, "cues": cues}, open(os.path.join(W, "timing.json"), "w"), indent=1)
if "--no-render" in sys.argv:
    sys.exit(0)

# ── 5. render the overlay, mix, write ────────────────────────────────────────────────────────────────────────────────
overlay = os.path.join(W, "overlay.mov")
subprocess.run(["npx", "--yes", "hyperframes@0.8.139", "render", "--format", "mov", "--no-best-effort", "--workers", "1", "--quiet", "-o", overlay], cwd=HF, check=True)
pad = os.path.join(W, "pad.wav")
expr = "0.10*sin(2*PI*110*t)+0.07*sin(2*PI*164.81*t)+0.06*sin(2*PI*220*t)+0.05*sin(2*PI*261.63*t)+0.04*sin(2*PI*329.63*t)+0.03*sin(2*PI*493.88*t)"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"aevalsrc='({expr})*(0.75+0.25*sin(2*PI*t/9))':s=48000:d={TOTAL + 1:.1f}",
                "-af", "lowpass=f=1400,aecho=0.8:0.7:180|340:0.35|0.22,volume=1.6", "-ac", "2", pad], check=True)
DEMO = os.path.join(HERE, "..", "docs", "demo")
OUTNAME = NAME if NAME.startswith("bounty-") else f"xorr-{NAME}"
final = os.path.join(DEMO, f"{OUTNAME}.mp4")
fc = ";".join(["[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]",
               f"[3:a]atrim=0:{TOTAL:.3f},asetpts=N/SR/TB,volume=0.14,afade=t=in:st=0:d=0.8,afade=t=out:st={TOTAL - 2:.3f}:d=2[bed]",
               "[2:a]aresample=48000,pan=stereo|c0=c0|c1=c0[vo]",
               "[vo][bed]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]"])
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(W, "base.mp4"), "-i", overlay, "-i", os.path.join(W, "narration.wav"), "-i", pad,
                "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
                "-r", "30", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{TOTAL:.3f}", final], check=True)
shutil.copy(SRT, os.path.join(DEMO, f"{OUTNAME}.srt"))
print("final:", os.path.abspath(final))
