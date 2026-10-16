# OpenRip engine (Rust)

Cargo workspace for the engine that replaces the TypeScript media pipeline. See [ROADMAP.md](../ROADMAP.md) §2.

| Crate | Status | What it is |
|---|---|---|
| `openrip-model` | started | Project format: microsecond time with exact frame-rate maths, `Animated<T>` keyframes, tracks → segments → materials mirroring CapCut's drafts. Edits as serializable commands (`Edit`) with exact undo/redo (`Document`) |
| `openrip-capcut` | started | CapCut draft importer (read-only) with an import report — coverage in [docs/parity/capcut-import.md](../docs/parity/capcut-import.md) |
| `openrip-v1` | started | Importer for projects saved by the TypeScript app (format v1) |
| `openrip-media` | started | Demux/decode through FFmpeg 9 with VideoToolbox hardware decode (frames stay in IOSurface-backed NV12/P010). Frame-accurate `frame_at(t)` with forward-decode vs seek cost model, open-GOP handling, probe (codec, rate, rotation, colour). Needs FFmpeg dev libraries (`brew install ffmpeg pkgconf`) |
| `openrip-dev` | started | Developer CLI (`capcut-import`, `capcut-scan`, `v1-import`, `v1-scan`, `probe`, `decode-bench`) |

```bash
cd engine
cargo test
OPENRIP_FUZZ_SEEDS=2000 cargo test --release -p openrip-model random_edit   # long randomized undo/redo run
cargo run --release -p openrip-dev -- capcut-scan "$HOME/Movies/CapCut/User Data/Projects/com.lveditor.draft"
cargo run --release -p openrip-dev -- decode-bench <video>   # add --sw for software decode
```

The decode tests generate their fixtures with the `ffmpeg` CLI (barcoded frame numbers in H.264 with B-frames and open GOP, HEVC 8/10-bit, 29.97 fps, MPEG-TS, VFR, ProRes) and check every frame of every seek.
