# CapCut parity protocol

CapCut Desktop is the reference for OpenRip. Every performance number and every visual result is reported next to the CapCut number for the same media, the same edit and the same machine. A result without a CapCut column is incomplete.

Reference build: CapCut 9.5.0 (macOS), installed at `/Applications/CapCut.app`. Record the CapCut version with every result, because its engine changes between releases.

## What we compare

| Axis | Question | How it's measured |
|---|---|---|
| **Performance** | Is OpenRip as fast and as light as CapCut doing the same thing? | `bench/sample-procs.mjs`, run identically against both apps: CPU % summed across each app's processes, resident memory, system GPU utilization. Plus app-specific counters (dropped frames, scrub latency, export wall time). |
| **Output (visual)** | Does the same edit produce the same pixels? | Export the same scenario from both apps at the same settings, then compare frames with FFmpeg `ssim`/`psnr` and colour ΔE on fixed frame indices. |
| **Output (container)** | Same codec, bitrate behaviour, colour tags, audio? | `ffprobe` on both exports: codec/profile/level, pixel format, colour primaries/transfer/matrix/range, bitrate, GOP, audio format. |
| **Features** | Can a CapCut user do the same thing? | The P0/P1/P2 matrix in [`docs/inventory/capcut.md`](../inventory/capcut.md), tracked as a checklist. |
| **Projects** | Does a CapCut project open correctly in OpenRip? | Import CapCut drafts (see below) and compare exports frame by frame, as above. |

## Rules for a fair comparison

- Same machine, power source and display, with no other heavy apps open. Note the machine in the result (current reference: Apple M2 Max, macOS 27, 4K display attached).
- Same source files from `spikes/frame-transport/media/` (regenerate with the FFmpeg commands in the spike README), plus real camera footage once the corpus has it.
- Same project settings: resolution, frame rate, preview quality (CapCut "Full" unless a run says otherwise), with proxies off unless the run is a proxy test.
- Warm up for 3 s, then measure for at least 15 s. Run each measurement 3 times and report the median.
- Report what each side is actually doing. Early OpenRip spikes measure a subset of the pipeline (for example decode + display only, with no audio or timeline UI). Say so next to the number, rather than claiming a win over a pipeline that does more work.

## Scenario corpus (planned)

Each scenario is one small file describing an edit: media, clips, ranges, transforms, adjustments, keyframes, text, transitions. A generator turns it into both an OpenRip project and a CapCut draft, so the two apps run byte-identical edits. Starter set:

1. 4K60 HEVC, single clip, play 15 s (playback cost)
2. 8K30 HEVC, single clip (decode ceiling)
3. Three 4K tracks composited with scale/position/opacity (compositing)
4. Basic adjust: exposure, contrast, saturation, temperature (colour maths)
5. .cube LUT at 100% and 50% intensity
6. Text with stroke, shadow and background
7. Keyframed position/scale/opacity with ease curves
8. Speed 2× and 0.5× with pitch preserved, reverse
9. Dissolve and slide transitions
10. Rectangle/circle masks with feather and invert
11. Export 4K60 H.264 and HEVC with hardware encoding (export wall time and output)

## CapCut projects in OpenRip

CapCut drafts are plain JSON (`~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<project>/draft_info.json` in 9.5.0). The structure:

- Tracks hold segments, with microsecond `source_timerange` and `target_timerange`, speed, volume, transform (`clip`), keyframe refs and `render_index`.
- Segments point into about 55 material tables: videos, audios, texts, canvases, speeds, transitions, masks, chromas, colour wheels, curves, HSL and more.

OpenRip's engine model mirrors these concepts on purpose, so that importing CapCut projects is a translation rather than a reinterpretation. Rules:

- **Import only, read-only.** Never write into CapCut's data folder unless the user explicitly asks. Its project index is easy to corrupt.
- **Versioned adapters.** CapCut changes its schema between releases, so test against real drafts from each supported version.
- **What can't carry over gets a report.** Effects, filters, transitions, stickers, templates and fonts from CapCut's online library are proprietary assets that OpenRip doesn't ship. Map each one to the closest built-in OpenRip equivalent, or flag it with a placeholder and list it in an import report.

## Results

Results go in `docs/parity/results/` as dated markdown files, each with the CapCut version, the machine and the raw JSON from the sampler.
