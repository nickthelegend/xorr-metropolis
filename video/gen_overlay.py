#!/usr/bin/env python3
"""Write hf/index.html: everything in the cut that is not footage, as one transparent 1920×1080 composition.

The intro (opaque, 0–35 s), the honest tags over the live footage, the scene label, the captions timed from the voice,
and the outro. Adapted from clockin/videos/_pipeline/gen_overlay.py for landscape web capture.
In : work/timing.json, work/cut.json (from build.py: where the receipts sit), receipts.json (read from the RPC)
Run from video/: python3 gen_overlay.py
"""
import html, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
timing = json.load(open(os.path.join(HERE, "work", "timing.json")))
cut = json.load(open(os.path.join(HERE, "work", "cut.json")))
TOTAL = timing["total"]
S = {s["id"]: s for s in timing["scenes"]}
L = {l["id"]: l for s in timing["scenes"] for l in s["lines"]}
E = html.escape
out, tw, n = [], [], [0]


def clip(cls, start, dur, track, inner, style=""):
    n[0] += 1
    cid = f"c{n[0]}"
    out.append(f'<div id="{cid}" class="clip {cls}" data-start="{start:.3f}" data-duration="{dur:.3f}" data-track-index="{track}"'
               f'{f" style={chr(34)}{style}{chr(34)}" if style else ""}><div class="in" id="{cid}i">{inner}</div></div>')
    return cid


def fade(cid, start, dur, rise=14, inn=0.35, outd=0.3):
    tw.append(f'tl.fromTo("#{cid}i",{{opacity:0,y:{rise}}},{{opacity:1,y:0,duration:{inn},ease:"power3.out"}},{start:.3f});')
    tw.append(f'tl.to("#{cid}i",{{opacity:0,duration:{outd},ease:"power1.in"}},{start + dur - outd:.3f});')


T = lambda lid: L[lid]["start"]
INTRO = S["intro"]["end"]

# ── intro: opaque, five beats on the five lines ───────────────────────────────
seats = [("Price", "#4f7bff"), ("Risk", "#a46bff"), ("Trend", "#c98a3a"), ("Perps", "#2fbf85"), ("Kimi", "#7d6bd9")]
blocks = "".join(f'<div class="blk" id="blk{i}"><div class="bn">block {i + 1}</div><div class="segs">'
                 + "".join(f'<i id="seg{i}_{k}"></i>' for k in range(4)) + f'</div><div class="bs" id="bs{i}">proposed</div></div>' for i in range(5))
intro = (
    '<div class="glow"></div>'
    '<div id="b1" class="beat center"><div class="big">' + "".join(f'<span class="w">{E(w)}</span> ' for w in "Trading bots ask for a lot of trust.".split()) + '</div></div>'
    '<div id="b2" class="beat"><div class="cards">'
    '<div class="card" id="k1"><div class="ck">They want</div><div class="cv">your keys</div></div>'
    '<div class="card" id="k2"><div class="ck">They move</div><div class="cv">your balance</div></div>'
    '<div class="card" id="k3"><div class="ck">When it goes wrong</div><div class="cv">no brake</div></div>'
    '<div class="strike" id="strike"></div></div></div>'
    '<div id="b3" class="beat"><img class="wm" id="wm3" src="assets/wordmark.png" alt="XORR">'
    '<div class="seats">' + "".join(f'<div class="seat" id="st{i}"><div class="dot" style="background:{c};box-shadow:0 0 40px {c}88"></div><div class="sl">{E(nm)}</div></div>' for i, (nm, c) in enumerate(seats)) + '</div>'
    '<div class="limit" id="lim"><div class="lk">YOUR LIMIT · SIGNED BY YOU · ENFORCED ON CHAIN</div><div class="bar"><div class="fill" id="limfill"></div></div></div></div>'
    '<div id="b4" class="beat center"><div class="hold"><svg viewBox="0 0 200 200" class="ring"><circle cx="100" cy="100" r="88" class="rbg"/>'
    '<circle cx="100" cy="100" r="88" class="rfg" id="ring"/></svg><div class="hl" id="hl">HOLD</div></div>'
    '<div class="hcap" id="hcap">One hold stops every agent, <b>on chain</b>.</div></div>'
    '<div id="b5" class="beat"><div class="mk">BUILT ON MONAD</div><div class="blocks">' + blocks + '</div>'
    '<div class="mstats" id="mstats"><span>voted <b>~0.3 s</b></span><span>final <b>~0.5 s</b></span></div>'
    '<div class="mnote" id="mnote">Read live from Monad mainnet’s commit states, in the app.</div></div>'
    '<div id="b6" class="beat"><img class="coin" id="coin6" src="assets/coin.png" alt=""><img class="wm6" id="wm6" src="assets/wordmark.png" alt="XORR">'
    '<div class="tag6" id="tag6">A council of AI agents trades for you on Monad, and one hold stops it on chain.</div>'
    '<div class="chips6" id="chips6"><span class="chip g">LIVE · MONAD TESTNET</span><span class="chip">PERPL</span><span class="chip">CHAINLINK</span><span class="chip">KIMI</span><span class="chip">ENVIO</span></div></div>'
)
ci = clip("full intro", 0, INTRO, 0, intro)


def beat(bid, a, b):
    tw.append(f'tl.fromTo("#{bid}",{{opacity:0}},{{opacity:1,duration:0.35}},{a:.3f});')
    tw.append(f'tl.to("#{bid}",{{opacity:0,duration:0.3}},{b - 0.3:.3f});')


t1, t2, t3, t4, t5 = (T(f"intro_0{i}") for i in range(1, 6))
b6 = L["intro_05"]["end"] + 0.4
beat("b1", 0.15, t2 - 0.05)
tw.append('tl.fromTo("#b1 .w",{opacity:0,y:30},{opacity:1,y:0,duration:0.45,stagger:0.12,ease:"power3.out"},0.3);')
beat("b2", t2 - 0.05, t3 - 0.1)
for i, lag in enumerate((0.1, 1.5, 3.4)):
    tw.append(f'tl.fromTo("#k{i + 1}",{{opacity:0,y:40,scale:0.92}},{{opacity:1,y:0,scale:1,duration:0.5,ease:"back.out(1.5)"}},{t2 + lag:.3f});')
tw.append(f'tl.fromTo("#strike",{{scaleX:0}},{{scaleX:1,duration:0.45,ease:"power2.inOut"}},{t2 + 4.9:.3f});')
beat("b3", t3 - 0.1, t4 - 0.05)
tw.append(f'tl.fromTo("#wm3",{{opacity:0,y:-20,scale:0.9}},{{opacity:1,y:0,scale:1,duration:0.6,ease:"power3.out"}},{t3:.3f});')
tw.append(f'tl.fromTo("#b3 .seat",{{opacity:0,y:40,scale:0.6}},{{opacity:1,y:0,scale:1,duration:0.5,stagger:0.18,ease:"back.out(1.7)"}},{t3 + 1.0:.3f});')
tw.append(f'tl.fromTo("#lim",{{opacity:0,y:20}},{{opacity:1,y:0,duration:0.4}},{t3 + 3.4:.3f});')
tw.append(f'tl.fromTo("#limfill",{{scaleX:0}},{{scaleX:0.62,duration:1.6,ease:"power2.out"}},{t3 + 3.7:.3f});')
beat("b4", t4 - 0.05, t5 - 0.05)
tw.append(f'tl.fromTo("#ring",{{strokeDashoffset:553}},{{strokeDashoffset:0,duration:1.3,ease:"none"}},{t4 + 0.2:.3f});')
tw.append(f'tl.to("#hl",{{color:"#ff5a5a",duration:0.2}},{t4 + 1.5:.3f});')
tw.append(f'tl.fromTo("#hcap",{{opacity:0,y:16}},{{opacity:1,y:0,duration:0.4}},{t4 + 0.3:.3f});')
beat("b5", t5 - 0.05, b6)
for i in range(5):
    a = t5 + 0.5 + i * 0.75
    tw.append(f'tl.fromTo("#blk{i}",{{opacity:0,x:60}},{{opacity:1,x:0,duration:0.4,ease:"power3.out"}},{a:.3f});')
    for k, (col, word, dt) in enumerate((("#8a8aa0", "proposed", 0.0), ("#7c5cff", "voted", 0.35), ("#22c55e", "final", 0.6), ("#22c55e", "verified", 1.6))):
        tw.append(f'tl.to("#seg{i}_{k}",{{backgroundColor:"{col}",opacity:1,duration:0.12}},{a + dt + 0.2:.3f});')
        tw.append(f'tl.set("#bs{i}",{{textContent:"{word}",color:"{col}"}},{a + dt + 0.2:.3f});')
tw.append(f'tl.fromTo("#mstats",{{opacity:0,y:16}},{{opacity:1,y:0,duration:0.4}},{t5 + 3.2:.3f});')
tw.append(f'tl.fromTo("#mnote",{{opacity:0}},{{opacity:1,duration:0.4}},{t5 + 4.4:.3f});')
beat("b6", b6, INTRO)
tw.append(f'tl.fromTo("#coin6",{{opacity:0,scale:0.85,rotation:-8}},{{opacity:1,scale:1,rotation:0,duration:1.0,ease:"power3.out"}},{b6:.3f});')
tw.append(f'tl.fromTo("#wm6",{{opacity:0,y:20}},{{opacity:1,y:0,duration:0.5,ease:"power3.out"}},{b6 + 0.4:.3f});')
tw.append(f'tl.fromTo("#tag6",{{opacity:0,y:16}},{{opacity:1,y:0,duration:0.5}},{b6 + 0.9:.3f});')
tw.append(f'tl.fromTo("#chips6 .chip",{{opacity:0,y:12}},{{opacity:1,y:0,duration:0.35,stagger:0.12}},{b6 + 1.4:.3f});')

# ── over the live footage: the honest tag, the scene label ─────────────────────
live = [s for s in timing["scenes"] if s["kind"] == "live"]
receipts = cut["receipts"]   # [[start, end, which], …] in the final timeline
rc = json.load(open(os.path.join(HERE, "receipts.json")))
short = lambda a: f"{a[:6]}…{a[-4:]}"

# the app spans: each live scene minus the receipt spans
app_spans = []
for s in live:
    a, b = s["start"], s["end"]
    for xa, xb, _ in receipts:
        if xa < b and xb > a:
            if xa > a: app_spans.append([a, xa, s])
            a = xb
    if b - a > 0.2: app_spans.append([a, b, s])

for a, b, s in app_spans:
    c = clip("tagtl", a, b - a, 2, '<span class="pill live"><i class="ld"></i>LIVE · MONAD TESTNET</span><span class="url">xorr-metropolis.vercel.app</span>')
    fade(c, a, b - a, rise=-10, inn=0.3, outd=0.2)
    num = live.index(s) + 1
    extra = '<div class="pill seed">TEAM-SEEDED WALLET · LABELLED IN THE APP</div>' if s["id"] in ("council", "trade") else ""
    c = clip("label", a, b - a, 3, f'<div class="lnum">{num:02d}</div><div class="ltitle">{E(s["label"])}</div>{extra}')
    fade(c, a, b - a, rise=10, inn=0.35, outd=0.2)

CARDS = {
    "fill": ("THE FILL · ROUND 11", "execOrder on Perpl, through the owner's desk",
             [("From", f'{short(rc["fill"]["from"])} · xorr’s operator key'), ("To", f'{short(rc["fill"]["to"])} · the owner’s Perpl desk'),
              ("Method", f'execOrder ({rc["fill"]["input"]})')],
             "READ FROM MONAD TESTNET · eth_getTransactionReceipt"),
    "stop": ("THE STOP · OUR TESTNET PROOF RUN, 13 OCT", "removeOperator: xorr's key taken off the desk",
             [("From", f'{short(rc["stop"]["from"])} · the owner'), ("To", f'{short(rc["stop"]["to"])} · the owner’s Perpl desk'),
              ("Method", f'removeOperator ({rc["stop"]["input"]})')],
             "READ FROM MONAD TESTNET · eth_getTransactionReceipt · FROM OUR PROOF RUN"),
}
import datetime
for a, b, which in receipts:
    r = rc[which]
    kick, title, rows, tag = CARDS[which]
    when = datetime.datetime.fromtimestamp(r["time"], datetime.timezone.utc).strftime("%d %b %Y, %H:%M:%S UTC")
    rows = rows + [("Block", f'{r["block"]:,} · {when}'), ("Gas used", f'{r["gasUsed"]:,}')]
    body = "".join(f'<div class="rr"><span class="rk">{E(k)}</span><span class="rv">{E(v)}</span></div>' for k, v in rows)
    c = clip("full rcpt" + (" dim" if which == "fill" else ""), a, b - a, 4,
             '<div class="glow"></div><div class="rcard" id="rc_' + which + '">'
             f'<div class="rkick">{E(kick)}</div><div class="rtitle">{E(title)}</div>'
             f'<div class="rstatus"><span class="ok">✓ Success</span><span class="rhash">{E(r["hash"])}</span></div>{body}</div>')
    tw.append(f'tl.fromTo("#{c}i",{{opacity:0}},{{opacity:1,duration:0.35}},{a:.3f});')
    tw.append(f'tl.fromTo("#rc_{which}",{{y:40,scale:0.96}},{{y:0,scale:1,duration:0.5,ease:"power3.out"}},{a:.3f});')
    tw.append(f'tl.fromTo("#rc_{which} .rr",{{opacity:0,x:-14}},{{opacity:1,x:0,duration:0.3,stagger:0.12}},{a + 0.35:.3f});')
    tw.append(f'tl.to("#{c}i",{{opacity:0,duration:0.3}},{b - 0.3:.3f});')
    c = clip("tagtl", a, b - a, 5, f'<span class="pill ex">{E(tag)}</span>')
    fade(c, a, b - a, rise=-10, inn=0.3, outd=0.2)

# ── captions: the right-hand panel beside the app, along the bottom over full-width pages ──
for cue in timing["cues"]:
    a, b = cue["start"], max(cue["start"] + 0.25, cue["end"])
    side = any(x <= a < y for x, y, _ in app_spans)
    c = clip("cap side" if side else "cap bottom", a, b - a, 6, f'<span class="capbox">{E(cue["text"])}</span>')
    tw.append(f'tl.fromTo("#{c}i",{{opacity:0,y:8}},{{opacity:1,y:0,duration:0.14,ease:"power2.out"}},{a:.3f});')

# ── outro ─────────────────────────────────────────────────────────────────────
o = S["outro"]
oc = clip("full outro", o["start"], TOTAL - o["start"], 7,
          '<div class="glow"></div><img class="coin" id="ocoin" src="assets/coin.png" alt=""><img class="wm6" id="owm" src="assets/wordmark.png" alt="XORR">'
          '<div class="tag6" id="otag">A council of AI agents trades for you on Monad, and one hold stops it on chain.</div>'
          '<div class="ourl" id="ourl">xorr-metropolis.vercel.app</div>'
          '<div class="chips6" id="ochips"><span class="chip g">LIVE · MONAD TESTNET</span><span class="chip">TRY IT IN A BROWSER</span></div>')
os_ = o["start"]
tw.append(f'tl.fromTo("#{oc}i",{{opacity:0}},{{opacity:1,duration:0.5}},{os_:.3f});')
tw.append(f'tl.fromTo("#ocoin",{{opacity:0,scale:0.85,rotation:8}},{{opacity:1,scale:1,rotation:0,duration:1.0,ease:"power3.out"}},{os_ + 0.1:.3f});')
tw.append(f'tl.fromTo("#owm",{{opacity:0,y:20}},{{opacity:1,y:0,duration:0.5}},{os_ + 0.4:.3f});')
tw.append(f'tl.fromTo("#otag",{{opacity:0,y:16}},{{opacity:1,y:0,duration:0.5}},{os_ + 0.8:.3f});')
tw.append(f'tl.fromTo("#ourl",{{opacity:0,scale:0.92}},{{opacity:1,scale:1,duration:0.5,ease:"back.out(1.6)"}},{os_ + 1.4:.3f});')
tw.append(f'tl.fromTo("#ochips .chip",{{opacity:0,y:12}},{{opacity:1,y:0,duration:0.35,stagger:0.12}},{os_ + 1.9:.3f});')
tw.append(f'tl.to("#{oc}i",{{opacity:0,duration:0.8}},{TOTAL - 0.8:.3f});')

CSS = open(os.path.join(HERE, "overlay.css")).read()
doc = f'''<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>XORR Metropolis demo overlay</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
{CSS}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL:.3f}" data-width="1920" data-height="1080">
{chr(10).join(out)}
    </div>
    <script>
      const tl = gsap.timeline({{ paused: true }});
{chr(10).join("      " + t for t in tw)}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
'''
open(os.path.join(HERE, "hf", "index.html"), "w").write(doc)
print(f"hf/index.html: {n[0]} clips, {len(tw)} tweens, {TOTAL:.2f}s")
