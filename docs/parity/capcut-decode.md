# How CapCut decodes and seeks (and what OpenRip does about it)

CapCut 9.5.0 for macOS, studied from the outside on 2026-10-16 (Apple Silicon, M2 family). Nothing was disassembled and nothing CapCut owns was modified. The evidence is:

- linked libraries and imported symbols;
- bundled settings and the values CapCut actually uses at runtime;
- the names of the engine's log messages and settings;
- CapCut's on-disk caches;
- the running process's memory and open files.

CapCut's own logs and databases are encrypted, so **its actual seek latencies are not known yet** (see "Measuring CapCut" below).

Confidence: **seen** = observed on this machine; **likely** = strongly suggested by setting names, message names or file layout.

## What CapCut does

| # | Technique | Confidence | Evidence |
|---|---|---|---|
| 1 | **Hardware decode first, chosen per clip.** The engine drives VideoToolbox decompression sessions directly. Fallbacks: a ByteDance FFmpeg 7.0 build, its own HEVC software decoder (ByteVC1) and dav1d. | seen | Linked libraries and imports; decoder-selection and retry settings switched on |
| 2 | **A keyframe/GOP index per media file, computed at import and cached on disk.** It holds the average and maximum GOP length, the keyframe count, whether there are B-frames, and whether a remux is recommended. Seeks look the GOP up in this index, and there is a repair pass for files whose index is wrong. | seen (cache); likely (use) | Per-file JSON in CapCut's import cache. The GOP formulas were verified on OpenRip's test clips. |
| 3 | **Frame-accurate seek = jump to the GOP start, decode forward, skip packets nothing references, check the frame.** The result is validated against the frame's time interval. | likely | Engine messages report "skip non-reference packet during seek" with skip counts and drop rate; a frame-interval check; seek-precision settings switched on |
| 4 | **Two seek modes: scrubbing and accurate.** While dragging, the allowed seek error grows with drag speed, and the newest seek replaces any queued ones. One accurate seek follows when the drag ends. | likely | Separate counters for scrub and accurate seeks; a tolerance computed from drag speed; a "drop older seek commands" path |
| 5 | **Decoded frames stay on the GPU and are cached.** The path is CVPixelBuffer → IOSurface → Metal/GL texture with no copies. There is a decoded-frame cache with a larger reverse mode, and a texture pool capped at 200. | seen (imports, memory); likely (cache) | With a 4K draft open: about 257 MB of IOSurface plus 428 MB GPU-owned |
| 6 | **Pooled readers; the next clip is pre-opened and pre-seeked to its in-point.** | likely; seen (one file open 4×) | Reader-count caps (101 software, plus a hardware cap); one 4K source open on 4 file descriptors at once |
| 7 | **Proxies built for seeking.** H.264, short side 720, source frame rate, **no B-frames, fixed 30-frame GOP**, about 16 Mbps. A proxy is used only when the preview is no larger than it, and is offered automatically after about 2 s of playback stalls. | seen | Proxy files in the cache; matching settings |
| 8 | **Two-phase thumbnails.** First a fast frame snapped to the keyframe, flagged "rough"; then the exact frame. | seen | On OpenRip's 60 fps clip, every rough tile was exactly a keyframe and every exact tile was within one frame. Tiles are 164×92 JPEGs (~3.6 KB), with an LRU cap of about 500 media. |
| 9 | **Reduced-resolution preview.** Downscaling and HDR tone-mapping happen in the YUV→RGB GPU pass. Clips that are covered or off-screen aren't decoded. | seen | Precompiled Metal kernels for 420→RGBA (area / 4×4) and HLG/PQ↔SDR; per-device preview scale (0.75 / 0.7 / 0.6) |
| 10 | **Fallback media.** Reversed clips are pre-rendered to a per-project file (~48 Mbps). Complex ranges can be pre-rendered (15 Mbps). Files that seek badly are remuxed to MOV. | seen | Files in draft folders; settings |

## Where OpenRip's decoder stands (`engine/crates/media`)

| CapCut technique | OpenRip | Notes |
|---|---|---|
| Hardware decode first, fallbacks | ✅ | Native async VideoToolbox for H.264/HEVC in MP4/MOV; FFmpeg (VideoToolbox hwaccel or software) for everything else |
| Frame-accurate seek with packets nothing references skipped | ✅ | Read-ahead finds the exact frame shown. Unreferenced pictures before it are skipped; the rest are decoded without output. |
| Decoded-frame cache | ✅ (decoder level) | 384 MB budget; backward steps hit the cache. A preview-resolution GPU cache shared across sources comes with the compositor. |
| Open-GOP correctness | ✅ | Leading pictures are dropped. VideoToolbox gets a fresh session after a non-IDR keyframe, because it otherwise returns stale surfaces. |
| Persistent keyframe index | ⬜ next | MP4/MOV already have exact sample tables via FFmpeg; the persistent index matters for MPEG-TS, MKV without cues, and badly indexed files |
| Scrub vs accurate seek modes, newest seek wins | ⬜ next (playback crate) | |
| Reader pooling and next-clip pre-warm | ⬜ next (playback crate) | Opening a native session costs about 85 ms, so pre-warming matters |
| Proxies (720p, no B-frames, short GOP) | ⬜ | Use a shorter GOP than CapCut's 30 frames for cheaper seeks |
| Two-phase thumbnails | ⬜ | |
| GPU convert + downscale + tone-map | ⬜ (compositor) | |
| Skip decoding covered clips | ⬜ (compositor) | |

Decoder numbers are in [results/2026-10-16-decode.md](results/2026-10-16-decode.md).

## Measuring CapCut

CapCut's logs are encrypted, so its seek latency has to be measured from the outside:

1. Load the barcoded clips from `engine/crates/media/tests` into a CapCut project.
2. Step through them with the arrow keys, and drag the playhead.
3. Screen-record the preview at 120 fps.

Frames shown per second while stepping or dragging, and how quickly the barcode settles after the input stops, give CapCut's step rate and settle latency. The same test runs against OpenRip once the preview is wired to the engine. It needs a short hands-on session with CapCut, because auto mode blocks driving its UI.
