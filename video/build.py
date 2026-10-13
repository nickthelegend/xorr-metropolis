#!/usr/bin/env python3
"""Cut the footage bed (1920×1080, 30 fps, no audio) to the narration timeline.

Each live scene plays the take from where that scene started in it (work/capture/markers.json), at real speed: the take
holds every scene at least as long as its narration. The trade scene holds on the replay's outcome; the stop scene
is black under the overlay's receipt. Writes work/base.mp4 and work/cut.json (where the receipts sit).
"""
import bisect, json, os, subprocess
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, "work")
FPS = 30
timing = json.load(open(os.path.join(W, "timing.json")))
cap = os.path.join(W, "capture")
frames = json.load(open(os.path.join(cap, "frames.json")))
mk = {m["id"]: m["t"] for m in json.load(open(os.path.join(cap, "markers.json")))["markers"]}
ft = [f["t"] for f in frames]
S = {s["id"]: s for s in timing["scenes"]}
L = {l["id"]: l for s in timing["scenes"] for l in s["lines"]}
black = os.path.join(W, "black.jpg")
Image.new("RGB", (1920, 1080), "black").save(black)

# Monad's testnet explorers answer a headless browser with a bot check, so the fill and the stop are shown as receipts
# read from the RPC (gen_overlay.py): the trade scene holds on the replay's outcome, the stop scene is graphic only.
xs = L["trade_02"]["start"] - 0.5
HOLD = {"trade": 10.8}   # seconds of take to use at most; then hold that frame (the take navigates away after it)
spans = []   # (final start, final end, source start, source cap)
for s in timing["scenes"]:
    if s["kind"] != "live" or s["id"] == "stop": continue
    spans.append((s["start"], s["end"], mk[s["id"]], mk[s["id"]] + HOLD.get(s["id"], 1e9)))
receipts = [[round(xs, 3), S["trade"]["end"], "fill"], [S["stop"]["start"], S["stop"]["end"], "stop"]]
json.dump({"receipts": receipts, "spans": spans}, open(os.path.join(W, "cut.json"), "w"), indent=1)

total = timing["total"]
lst = []
for k in range(int(round(total * FPS))):
    t = k / FPS
    src = None
    for a, b, s0, cap_ in spans:
        if a <= t < b:
            st = min(s0 + (t - a), cap_)
            i = bisect.bisect_right(ft, st) - 1
            src = os.path.join(cap, "frames", frames[max(0, i)]["name"])
            break
    lst.append(src or black)
with open(os.path.join(W, "frames.txt"), "w") as f:
    for p in lst:
        f.write(f"file '{p}'\nduration {1 / FPS:.6f}\n")
    f.write(f"file '{lst[-1]}'\n")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", os.path.join(W, "frames.txt"),
                "-vf", f"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps={FPS},format=yuv420p",
                "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-r", str(FPS), os.path.join(W, "base.mp4")], check=True)
for a, b, s0, _ in spans: print(f"  {a:7.2f}-{b:7.2f}  from take +{s0 - mk['welcome']:.2f}s")
print("base:", os.path.join(W, "base.mp4"), f"{len(lst)} frames")
