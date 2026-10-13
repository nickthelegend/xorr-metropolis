#!/usr/bin/env python3
"""Frame QA for a make.py video before rendering: 7 composites (footage + overlay) in one sheet. python3 qa.py <name> t1 … t7"""
import os, subprocess, sys
from PIL import Image
name, times = sys.argv[1], sys.argv[2:]
W = os.path.join(os.path.dirname(os.path.abspath(__file__)), "work", name)
subprocess.run(["node", "qa.mjs", os.path.join(W, "hf", "index.html"), W] + times, check=True)
S = Image.new("RGB", (1920, 1080 * ((len(times) + 1) // 2) // 2))
for i, t in enumerate(times):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", t, "-i", os.path.join(W, "base.mp4"), "-frames:v", "1", os.path.join(W, "qb.png")], check=True)
    b = Image.open(os.path.join(W, "qb.png")).convert("RGBA")
    b.alpha_composite(Image.open(os.path.join(W, f"ov_{t}.png")).convert("RGBA"))
    S.paste(b.convert("RGB").resize((960, 540)), ((i % 2) * 960, (i // 2) * 540))
S.save(os.path.join(W, "qa.png")); print(os.path.join(W, "qa.png"))
