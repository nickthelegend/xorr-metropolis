#!/usr/bin/env python3
"""Lay the narration on a timeline and time the captions from ElevenLabs' character timestamps.

In : script.json, work/vo/lines.json
Out: work/timing.json (scenes and lines), work/narration.wav, captions.srt (cues from the voice's own word times)
"""
import json, os, re
import numpy as np, soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, "work")
SR = 48000
GAP, LEAD, TAIL = 0.45, 0.7, 0.9
INTRO_MIN, OUTRO_HOLD = 35.0, 3.2
CUE_MAX = 46
spec = json.load(open(os.path.join(HERE, "script.json")))
lines = {l["id"]: l for l in json.load(open(os.path.join(W, "vo", "lines.json")))}


def words(l):
    """Words with start/end seconds from the character alignment."""
    out, cur, st = [], "", None
    for ch, a, b in zip(l["chars"], l["starts"], l["ends"]):
        if ch.isspace():
            if cur: out.append([cur, st, last]); cur = ""
            continue
        if not cur: st = a
        cur += ch; last = b
    if cur: out.append([cur, st, last])
    return out


t, scenes, cues, pieces = 0.0, [], [], []
for si, sc in enumerate(spec["scenes"]):
    start = t
    t += 0.5 if si == 0 else LEAD
    ls = []
    for i, _ in enumerate(sc["lines"]):
        l = lines[f"{sc['id']}_{i + 1:02d}"]
        a, sr = sf.read(l["file"], dtype="float32"); assert sr == SR
        pieces.append((t, a))
        ls.append({"id": l["id"], "text": l["text"], "start": round(t, 3), "end": round(t + l["seconds"], 3)})
        # cues: break at sentence ends, else before CUE_MAX characters
        buf = []
        for w in words(l):
            text = " ".join(x[0] for x in buf + [w])
            if buf and len(text) > CUE_MAX:
                cues.append({"start": t + buf[0][1], "end": t + buf[-1][2], "text": " ".join(x[0] for x in buf)}); buf = []
            buf.append(w)
            if re.search(r"[.?!:]$", w[0]) and len(" ".join(x[0] for x in buf)) > 14:
                cues.append({"start": t + buf[0][1], "end": t + buf[-1][2], "text": " ".join(x[0] for x in buf)}); buf = []
        if buf: cues.append({"start": t + buf[0][1], "end": t + buf[-1][2], "text": " ".join(x[0] for x in buf)})
        t += l["seconds"] + GAP
    t = t - GAP + TAIL
    if sc["id"] == "intro": t = max(t, INTRO_MIN)
    if sc["id"] == "outro": t += OUTRO_HOLD
    scenes.append({"id": sc["id"], "kind": sc["kind"], "label": sc.get("label", ""), "start": round(start, 3), "end": round(t, 3), "lines": ls})

total = round(t, 3)
for a, b in zip(cues, cues[1:]):   # hold each cue until the next, if the gap is short
    if b["start"] - a["end"] < 0.6: a["end"] = b["start"] - 0.03
    else: a["end"] += 0.3
buf = np.zeros(int(total * SR) + SR, dtype=np.float32)
for st, a in pieces:
    i = int(round(st * SR)); buf[i:i + len(a)] += a
sf.write(os.path.join(W, "narration.wav"), buf[: int(total * SR)], SR)


def ts(x):
    ms = int(round(x * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


with open(os.path.join(HERE, "captions.srt"), "w") as f:
    for n, c in enumerate(cues, 1):
        f.write(f"{n}\n{ts(c['start'])} --> {ts(c['end'])}\n{c['text']}\n\n")
json.dump({"total": total, "scenes": scenes, "cues": [{**c, "start": round(c["start"], 3), "end": round(c["end"], 3)} for c in cues]},
          open(os.path.join(W, "timing.json"), "w"), indent=1)
for s in scenes: print(f"{s['id']:9} {s['start']:7.2f} -> {s['end']:7.2f} ({s['end'] - s['start']:5.2f}s)")
print(f"total {total:.2f}s, {len(cues)} cues")
