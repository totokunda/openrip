#!/usr/bin/env python3 -I
"""Spoken-English fixtures for checking auto captions, made with macOS `say` so the true
text is known.

  engine/scripts/speech-fixture.py <out-dir> [voice]

Writes, in <out-dir>:
  sentences.wav, sentences.txt, sentences.spans.json
      Five sentences, each rendered on its own and placed 1.2 s after the one before, so
      each sentence's true start and end (where its sound begins and stops) are known.
  words.wav, words.txt, words.spans.json
      Twelve words said one at a time, 0.7 s apart: the true start and end of every word.
Both are 16 kHz mono 16-bit WAV. Nothing here is committed: macOS makes them on demand.
"""
import json
import os
import struct
import subprocess
import sys
import tempfile
import wave

RATE = 16000
SENTENCES = [
    "The quick brown fox jumps over the lazy dog.",
    "Please call Stella and ask her to bring these things with her from the store.",
    "Six spoons of fresh snow peas, five thick slabs of blue cheese, and maybe a snack for her brother Bob.",
    "We also need a small plastic snake and a big toy frog for the kids.",
    "She can scoop these things into three red bags, and we will go meet her Wednesday at the train station.",
]
WORDS = ["Tomorrow", "morning", "we", "should", "open", "the", "garden", "window", "before", "breakfast", "starts", "today"]


def say(text, voice, path):
    subprocess.run(["say", "-v", voice, "-o", path, "--file-format=WAVE", f"--data-format=LEI16@{RATE}", text], check=True)
    with wave.open(path) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1
        raw = w.readframes(w.getnframes())
    return list(struct.unpack(f"<{len(raw) // 2}h", raw))


def trimmed(samples, threshold=300):
    """The samples from where the sound starts to where it stops, and the offsets."""
    loud = [i for i, s in enumerate(samples) if abs(s) > threshold]
    return samples[loud[0] : loud[-1] + 1]


def build(parts, gap, lead, voice, tmp):
    out = [0] * int(lead * RATE)
    spans = []
    for text in parts:
        s = trimmed(say(text, voice, os.path.join(tmp, "x.wav")))
        start = len(out) / RATE
        out += s
        spans.append({"text": text, "start": round(start, 3), "end": round(len(out) / RATE, 3)})
        out += [0] * int(gap * RATE)
    return out, spans


def write(prefix, samples, spans, text):
    with wave.open(prefix + ".wav", "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    with open(prefix + ".spans.json", "w") as f:
        json.dump(spans, f, indent=1)
    with open(prefix + ".txt", "w") as f:
        f.write(text + "\n")


def main():
    out = sys.argv[1]
    voice = sys.argv[2] if len(sys.argv) > 2 else "Samantha"
    os.makedirs(out, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        samples, spans = build(SENTENCES, 1.2, 0.8, voice, tmp)
        write(os.path.join(out, "sentences"), samples, spans, " ".join(SENTENCES))
        samples, spans = build(WORDS, 0.7, 0.8, voice, tmp)
        write(os.path.join(out, "words"), samples, spans, " ".join(WORDS))
    print("wrote", out)


main()
