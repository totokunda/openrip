# Plan: hardware encoding on every platform, with a software fallback

Status 2026-10-20: saved for later; nothing started. Today OpenRip encodes only through VideoToolbox on macOS, and Settings' "Hardware encoding" can't be turned off because there is no software encoder behind it.

## Where things stand

- **FFmpeg** is a minimal static LGPL build (`engine/scripts/build-ffmpeg.sh`). Its only encoders are `aac`, `h264_videotoolbox`, `hevc_videotoolbox` and `prores_videotoolbox`. x264 and x265 were left out because they are GPL.
- **The export crate** has only the VideoToolbox path. `engine/crates/export/src/lib.rs` lists the software encoder as "Not written yet". `videotoolbox::available()` (`engine/crates/export/src/videotoolbox.rs`) probes the codecs, and `core::export::available_codecs()` reports them to the app. The Export dialog already lists whatever the engine reports, so per-machine codec lists come for free.
- **Windows and Linux** have no builds at all. `apps/app/scripts/build-engine.mjs` prints "no engine build for this platform yet". `engine/scripts/check-targets.sh` only proves the engine compiles for other targets. Working Windows and Linux builds of the whole app have to come before hardware encoding there.

## Encoders per platform

All of these are reached through FFmpeg.

| Platform | Encoders | Notes |
|---|---|---|
| macOS | VideoToolbox | Done: H.264, HEVC, HEVC with alpha, ProRes |
| Windows | NVIDIA NVENC, Intel Quick Sync (oneVPL), AMD AMF; Media Foundation and D3D12 as vendor-neutral fallbacks | H.264 and HEVC everywhere; AV1 on newer GPUs (RTX 40, Intel Arc, AMD RDNA3) |
| Linux | VAAPI (Intel, AMD, NVIDIA via a shim), NVENC, Quick Sync, Vulkan Video (newer, vendor-neutral) | Needs the right drivers on the user's machine |
| Web, later | WebCodecs | The browser picks the hardware |

**Software fallback:** OpenH264 (BSD) for H.264 and FFmpeg's `prores_ks` (LGPL) for ProRes. This keeps x264/x265 and their GPL terms out. Cisco pays OpenH264's patent fees only for its own binary downloaded at runtime, so decide whether to ship it that way.

**Licence:** every hardware encoder above stays within FFmpeg's LGPL. They build against MIT-licensed headers (such as nv-codec-headers and the AMF headers), and the proprietary driver libraries are loaded at runtime, not linked. No `--enable-nonfree`, no GPL.

## Engine work

1. **Discovery.** At startup, try to open each candidate encoder with a tiny test frame, as `videotoolbox::available()` does now. Cache the results per machine: backend, hardware or software, codecs, maximum size, 10-bit, alpha.
2. **Choosing an encoder.**
   - With "Hardware encoding" on, use the best device for the chosen codec. On Windows try NVENC, then Quick Sync, then AMF, then Media Foundation. On Linux try NVENC, then VAAPI/Quick Sync, then Vulkan.
   - If none works, or one fails mid-export, retry in software.
   - With it off, always use software.
3. **Mapping settings.** Translate our export settings (quality preset, bitrate, frame rate, profile, keyframe interval, colour range) for each backend, since each names its rate-control modes and presets differently. This is the fiddliest part.
4. **Getting frames to the encoder.**
   - **v1:** copy each rendered frame from the GPU into memory and upload it to the encoder. This works everywhere and is fast enough for 1080p and 4K30.
   - **v2:** hand the GPU texture straight to the encoder with no copy (wgpu to D3D12/D3D11 on Windows, Vulkan or DMA-BUF on Linux), for 4K60 and faster.
5. **Hardware decoding for playback**, which matters as much as encoding for smooth editing: D3D11VA, D3D12VA, NVDEC or Quick Sync on Windows; VAAPI, NVDEC or Vulkan on Linux. Today's FFmpeg build enables only the macOS decoders.
6. **Which codecs to offer where.**
   - ProRes has no hardware encoder outside Apple, so it uses `prores_ks` in software there, including 4444 with alpha.
   - HEVC with alpha is Apple-only; elsewhere, hide it and offer ProRes 4444.
   - AV1 appears only on GPUs that support it.

## Build and packaging

- **FFmpeg per platform and architecture:**
  - Windows x64, built with MSVC or cross-compiled with MinGW: NVENC, AMF, oneVPL, Media Foundation, D3D11VA and D3D12VA.
  - Linux x64 and arm64: VAAPI, NVENC, oneVPL and Vulkan.
- **`build-engine.mjs`** gains Windows and Linux builds, with the same check that the addon links nothing unexpected.
- **Windows:** only the small oneVPL dispatcher ships with the app; the drivers provide the rest.
- **Linux:** libva and the GPU drivers come from the user's system, so AppImage or Flatpak packaging must not bundle drivers. Flatpak needs its GL extension for the drivers.
- **electron-builder** gains Windows and Linux targets.

## Edge cases

- Laptops with two GPUs: choose the right adapter.
- Older NVENC cards cap H.264 at 4096 px, and encoders need sizes aligned to even or block multiples.
- Consumer NVIDIA cards allow only a few encode sessions at once.
- If the driver resets mid-export, restart from the last segment in software.
- 10-bit support has to be detected per device.

## Testing

The hardware paths can't be tested from a Mac, which makes testing the bottleneck.

- **Software path:** can run in CI on all three platforms.
- **Hardware paths:** need real machines. At minimum, an NVIDIA box and an Intel or AMD box, each on Windows and on Linux. Cloud GPU instances (for example AWS g4dn with an NVIDIA T4) cover NVIDIA; Intel and AMD need physical machines.
- **The check for each machine:** export every codec through every backend, then check the files, compare quality against the software encode, measure speed, and confirm the fallback works.

## Phases

1. **Software fallback**: OpenH264 and `prores_ks`, plus discovery, choosing an encoder, and a working on/off switch. Doable and testable on a Mac: one agent run.
2. **Windows and Linux builds of the whole app**, with software encoding only, so OpenRip runs there at all. Large, and needs those machines to test.
3. **Windows hardware**: NVENC, Quick Sync, AMF and Media Foundation, plus hardware decoding.
4. **Linux hardware**: VAAPI, NVENC, Quick Sync and Vulkan, plus hardware decoding and packaging.
5. **No-copy GPU interop**, for speed.

Phases 2 to 4 need access to Windows and Linux machines, physical or remote, with NVIDIA, Intel and AMD GPUs.
