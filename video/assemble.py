#!/usr/bin/env python3
"""Render the overlay (alpha MOV), lay it over the footage bed, mix the voice with a quiet pad, -16 LUFS.

Out: ../docs/demo/xorr-metropolis.mp4 and .srt. Run from video/: python3 assemble.py [--skip-render]
"""
import json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.join(HERE, "work")
T = json.load(open(os.path.join(W, "timing.json")))["total"]
overlay = os.path.join(W, "overlay.mov")
DEMO = os.path.join(HERE, "..", "docs", "demo")
os.makedirs(DEMO, exist_ok=True)
final = os.path.join(DEMO, "xorr-metropolis.mp4")
pad = os.path.join(W, "pad.wav")
if not os.path.exists(pad):   # a quiet ambient bed (A minor add9, slow swell): xorr ships no music
    expr = "0.10*sin(2*PI*110*t)+0.07*sin(2*PI*164.81*t)+0.06*sin(2*PI*220*t)+0.05*sin(2*PI*261.63*t)+0.04*sin(2*PI*329.63*t)+0.03*sin(2*PI*493.88*t)"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"aevalsrc='({expr})*(0.75+0.25*sin(2*PI*t/9))':s=48000:d={T + 1:.1f}",
                    "-af", "lowpass=f=1400,aecho=0.8:0.7:180|340:0.35|0.22,volume=1.6", "-ac", "2", pad], check=True)
if "--skip-render" not in sys.argv:
    subprocess.run(["npx", "--yes", "hyperframes@0.8.139", "render", "--format", "mov", "--no-best-effort", "--workers", "1", "--quiet", "-o", overlay],
                   cwd=os.path.join(HERE, "hf"), check=True)
fc = ";".join([
    "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]",
    f"[3:a]atrim=0:{T:.3f},asetpts=N/SR/TB,volume='if(lt(t,1.0),0.5,0.16)':eval=frame,afade=t=in:st=0:d=0.8,afade=t=out:st={T - 2:.3f}:d=2[bed]",
    "[2:a]aresample=48000,pan=stereo|c0=c0|c1=c0[vo]",
    "[vo][bed]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]",
])
subprocess.run(["ffmpeg", "-v", "error", "-stats", "-y", "-i", os.path.join(W, "base.mp4"), "-i", overlay, "-i", os.path.join(W, "narration.wav"), "-i", pad,
                "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
                "-r", "30", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{T:.3f}", final], check=True)
shutil.copy(os.path.join(HERE, "captions.srt"), os.path.join(DEMO, "xorr-metropolis.srt"))
print("final:", os.path.abspath(final))
