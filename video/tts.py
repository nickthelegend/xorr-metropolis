#!/usr/bin/env python3
"""Narrate script.json with ElevenLabs, one file per line, with character timestamps for the captions.

Re-voices only lines whose text changed (work/vo/lines.json caches each line's text). The key comes from the
environment (ELEVENLABS_API_KEY) and is never written anywhere.
Run from video/: python3 tts.py
"""
import base64, json, os, subprocess, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "work", "vo")
os.makedirs(OUT, exist_ok=True)
spec = json.load(open(os.path.join(HERE, "script.json")))
key = os.environ["ELEVENLABS_API_KEY"]
manifest = os.path.join(OUT, "lines.json")
prev = {l["id"]: l for l in json.load(open(manifest))} if os.path.exists(manifest) else {}
out = []
for sc in spec["scenes"]:
    for i, text in enumerate(sc["lines"]):
        lid = f"{sc['id']}_{i + 1:02d}"
        wav = os.path.join(OUT, lid + ".wav")
        old = prev.get(lid)
        if old and old["text"] == text and old["voice"] == spec["voice"] and os.path.exists(wav):
            out.append(old)
            continue
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{spec['voice']}/with-timestamps?output_format=mp3_44100_128",
            data=json.dumps({"text": text, "model_id": spec["model"],
                             "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.15}}).encode(),
            headers={"xi-api-key": key, "content-type": "application/json"})
        d = json.load(urllib.request.urlopen(req, timeout=120))
        mp3 = os.path.join(OUT, lid + ".mp3")
        open(mp3, "wb").write(base64.b64decode(d["audio_base64"]))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp3, "-ar", "48000", "-ac", "1", wav], check=True)
        secs = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav],
                                    capture_output=True, text=True).stdout)
        a = d["alignment"]
        out.append({"id": lid, "scene": sc["id"], "text": text, "voice": spec["voice"], "file": wav, "seconds": round(secs, 3),
                    "chars": a["characters"], "starts": a["character_start_times_seconds"], "ends": a["character_end_times_seconds"]})
        print(f"{lid} {secs:6.2f}s  {text[:70]}", flush=True)
json.dump(out, open(manifest, "w"))
print(f"{len(out)} lines, {sum(l['seconds'] for l in out):.1f}s of speech")
