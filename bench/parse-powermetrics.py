#!/usr/bin/env python3
"""Summarise per-process GPU time from macOS `powermetrics` output.

Capture (needs admin rights; the `tasks` sampler is what adds per-process rows):
    sudo powermetrics --samplers tasks,gpu_power --show-process-gpu -i 1000 -n 15 > /tmp/gpu-<app>.txt

Summarise:
    python3 bench/parse-powermetrics.py /tmp/gpu-capcut.txt --match CapCut
    python3 bench/parse-powermetrics.py /tmp/gpu-openrip.txt --match "Electron|VTDecoder"

Reports, per matching process name, the mean GPU time in ms per second of wall time
(1000 ms/s = the GPU busy for that process the whole time), plus the system GPU
active residency and power for context.
"""
import argparse
import re
import statistics
from collections import defaultdict


def parse(path, match):
    pattern = re.compile(match, re.I) if match else None
    text = open(path, encoding="utf-8", errors="replace").read()
    samples = text.split("*** Sampled system activity")[1:]
    per_proc = defaultdict(list)  # name -> [gpu ms/s per sample]
    residency, power = [], []
    for sample in samples:
        m = re.search(r"GPU HW active residency:\s+([\d.]+)%", sample)
        if m:
            residency.append(float(m.group(1)))
        m = re.search(r"GPU Power: (\d+) mW", sample)
        if m:
            power.append(int(m.group(1)))
        lines = sample.splitlines()
        header_idx = next((i for i, l in enumerate(lines) if l.startswith("Name") and "GPU ms/s" in l), None)
        if header_idx is None:
            continue
        header = lines[header_idx]
        # Columns are separated by 2+ spaces; the name column can contain single spaces.
        cols = re.split(r"\s{2,}", header.strip())
        gpu_col = cols.index("GPU ms/s")
        seen = defaultdict(float)
        for line in lines[header_idx + 1 :]:
            if not line.strip() or line.startswith("ALL_TASKS") or line.startswith("**"):
                if line.startswith("**"):
                    break
                continue
            parts = re.split(r"\s{2,}", line.strip())
            if len(parts) <= gpu_col:
                continue
            name = parts[0]
            if pattern and not pattern.search(name):
                continue
            try:
                seen[name] += float(parts[gpu_col])
            except ValueError:
                continue
        for name, v in seen.items():
            per_proc[name].append(v)
    return samples, per_proc, residency, power


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--match", default="")
    a = ap.parse_args()
    samples, per_proc, residency, power = parse(a.path, a.match)
    n = len(samples)
    print(f"samples: {n}")
    if residency:
        print(f"system GPU active residency: mean {statistics.mean(residency):.1f}%  max {max(residency):.1f}%")
    if power:
        print(f"system GPU power: mean {statistics.mean(power):.0f} mW  max {max(power)} mW")
    if not per_proc:
        print("no per-process GPU rows found (was the `tasks` sampler enabled?)")
        return
    total = 0.0
    for name, vals in sorted(per_proc.items(), key=lambda kv: -sum(kv[1])):
        mean = sum(vals) / n  # absent samples count as 0
        total += mean
        print(f"  {name:<40} GPU {mean:7.1f} ms/s")
    print(f"  {'TOTAL (matching)':<40} GPU {total:7.1f} ms/s")


if __name__ == "__main__":
    main()
