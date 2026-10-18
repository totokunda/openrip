#!/usr/bin/env python3
"""Split scenes' precision and recall on real footage with known boundaries.

Edits are built with FFmpeg from single-take camera originals (files named like a phone's,
IMG_<n>, found in the media a CapCut drafts folder uses, read only): random segments of
different takes joined by hard cuts, dissolves and fades through black at known times. The
detector (`openrip-dev scene-scan`) runs on each edit and on each untouched take, and its
cuts are matched to the truth:

- a hard cut is found when a detected cut is within one frame of it;
- a dissolve or a fade when a detected cut falls inside the transition (a frame of slack).

Untouched takes have no boundaries: whatever is found there is a false positive. Nothing is
written next to the media; the edits go to the work folder.

    bench/scenes/scene-bench.py <drafts-root> <openrip-dev> [--work DIR] [--edits N] [--seed S]
        [--sensitivity X] [--keep]
"""
import argparse
import json
import os
import random
import re
import subprocess
import sys
import tempfile

FPS = 30
SIZE = (720, 1280)


def draft_media(root):
    """Readable camera originals the drafts use, with their durations (s)."""
    found = {}
    for d in sorted(os.listdir(root)):
        f = os.path.join(root, d, "draft_info.json")
        if not os.path.isfile(f):
            continue
        try:
            doc = json.load(open(f))
        except (OSError, ValueError):
            continue
        for v in doc.get("materials", {}).get("videos", []):
            p = v.get("path", "")
            if v.get("type") == "video" and re.match(r"IMG_\d+", os.path.basename(p)) and os.path.isfile(p) and os.access(p, os.R_OK):
                found.setdefault(p, v.get("duration", 0) / 1e6)
    return sorted((p, d) for p, d in found.items() if d >= 2.5)


def build_edit(sources, rng, out):
    """One edit of 8-12 segments; returns the truth: [(kind, start, end)] in seconds."""
    n = rng.randint(8, 12)
    picks, last = [], None
    for _ in range(n):
        choice = rng.choice([s for s in sources if s[0] != last] or sources)
        last = choice[0]
        length = rng.uniform(1.6, min(4.5, choice[1] - 0.2))
        start = rng.uniform(0.0, max(0.0, choice[1] - length - 0.1))
        picks.append((choice[0], start, length))
    joins = [rng.choices(["hard", "dissolve", "fade"], weights=[6, 2.5, 1.5])[0] for _ in range(n - 1)]
    w, h = SIZE
    inputs, chains, frames = [], [], []
    for i, (path, start, length) in enumerate(picks):
        # Exactly this many frames, so the boundaries fall where the truth says.
        n_frames = max(2, round(length * FPS))
        frames.append(n_frames)
        inputs += ["-ss", f"{start:.3f}", "-t", f"{length + 0.5:.3f}", "-i", path]
        chains.append(f"[{i}:v]setpts=PTS-STARTPTS,fps={FPS},trim=end_frame={n_frames},setpts=PTS-STARTPTS,scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,settb=1/{FPS}[s{i}]")
    truth, current, total = [], "s0", frames[0]
    for i, kind in enumerate(joins, start=1):
        out_label = f"j{i}"
        if kind == "hard":
            chains.append(f"[{current}][s{i}]concat=n=2:v=1:a=0,settb=1/{FPS}[{out_label}]")
            truth.append(("hard", total / FPS, total / FPS))
            total += frames[i]
        else:
            dur = min(round(rng.uniform(0.3, 1.0) * FPS), frames[i] - 1, frames[i - 1] - 1)
            offset = total - dur
            transition = "fade" if kind == "dissolve" else "fadeblack"
            chains.append(f"[{current}][s{i}]xfade=transition={transition}:duration={dur / FPS:.6f}:offset={offset / FPS:.6f},settb=1/{FPS}[{out_label}]")
            truth.append((kind, offset / FPS, (offset + dur) / FPS))
            total += frames[i] - dur
        current = out_label
    cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(chains), "-map", f"[{current}]", "-r", str(FPS), "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-an", out]
    subprocess.run(cmd, check=True)
    return truth


def scan(dev, path, sensitivity):
    r = subprocess.run([dev, "scene-scan", path, "--json", "--sensitivity", str(sensitivity)], capture_output=True, text=True, check=True)
    return json.loads(r.stdout.strip().splitlines()[-1])


def match(truth, cuts):
    """True positives by kind, and the unmatched detections."""
    slack = 1.0 / FPS + 1e-3
    free = sorted(c["time"] for c in cuts)
    hits = {"hard": [0, 0], "dissolve": [0, 0], "fade": [0, 0]}
    for kind, start, end in truth:
        hits[kind][1] += 1
        lo, hi = (start - slack, end + slack)
        best = min((t for t in free if lo <= t <= hi), key=lambda t: abs(t - (start + end) / 2), default=None)
        if best is not None:
            free.remove(best)
            hits[kind][0] += 1
    return hits, len(free)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("dev")
    ap.add_argument("--work", default=None)
    ap.add_argument("--edits", type=int, default=8)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--sensitivity", type=float, default=0.5)
    ap.add_argument("--keep", action="store_true", help="reuse edits already in the work folder")
    a = ap.parse_args()
    work = a.work or tempfile.mkdtemp(prefix="scene-bench-")
    os.makedirs(work, exist_ok=True)
    sources = draft_media(a.root)
    if len(sources) < 3:
        sys.exit(f"only {len(sources)} usable takes")
    print(f"{len(sources)} takes, work folder {work}")
    rng = random.Random(a.seed)
    totals = {"hard": [0, 0], "dissolve": [0, 0], "fade": [0, 0]}
    false_pos, detected, seconds = 0, 0, 0.0
    for e in range(a.edits):
        out = os.path.join(work, f"edit-{e}.mp4")
        truth_file = out + ".json"
        if a.keep and os.path.exists(out) and os.path.exists(truth_file):
            truth = [tuple(t) for t in json.load(open(truth_file))]
            rng.random()
        else:
            truth = build_edit(sources, rng, out)
            json.dump(truth, open(truth_file, "w"))
        found = scan(a.dev, out, a.sensitivity)
        hits, fp = match(truth, found["cuts"])
        for k in totals:
            totals[k][0] += hits[k][0]
            totals[k][1] += hits[k][1]
        false_pos += fp
        detected += len(found["cuts"])
        seconds += found["frames"] / FPS
        missed = [(k, round(s, 2)) for k, s, _ in truth if not any(s - 0.04 <= c["time"] <= _ + 0.04 for c in found["cuts"])]
        print(f"edit {e}: {len(truth)} boundaries, {len(found['cuts'])} found, {fp} false; missed {missed}")
    tp = sum(v[0] for v in totals.values())
    n = sum(v[1] for v in totals.values())
    precision = tp / detected if detected else 1.0
    recall = tp / n if n else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    print(f"\nedits: {n} boundaries in {seconds / 60:.1f} min; precision {precision:.3f}, recall {recall:.3f}, F1 {f1:.3f}")
    for k, (hit, total) in totals.items():
        print(f"  {k:8s} recall {hit}/{total} = {hit / total if total else 1:.3f}")
    # The untouched takes: anything found is a false positive.
    fp_takes, take_secs = 0, 0.0
    for path, _ in sources:
        found = scan(a.dev, path, a.sensitivity)
        fp_takes += len(found["cuts"])
        take_secs += found["frames"] / FPS
    print(f"untouched takes: {fp_takes} false positives in {len(sources)} takes ({take_secs / 60:.1f} min of footage)")


if __name__ == "__main__":
    main()
