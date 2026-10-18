# Portability: the engine as an API core

Status 2026-10-17. The engine is meant to run wherever OpenRip does: the desktop app today, and iOS, Android and the web later. The Electron app is one client of it, through a thin Node addon. This page sets out the layers, the seams platform code sits behind, what each target builds and runs today, and the rule for new code. `engine/scripts/check-targets.sh` checks the build side.

## The rule for new code

- **No unconditional platform dependencies.** A crate below the bindings never needs a platform's SDK, an OS service or a C library just to build.
- **Platform code goes behind a seam** (a trait the engine calls, or a default-on feature) **with a portable fallback**: the engine still builds and does something sensible without it, even if that's "no device", a CPU read-back or a clear error.
- **Gate by what the API needs.** `target_vendor = "apple"` for APIs every Apple platform has (VideoToolbox, CoreVideo, IOSurface, Metal). `target_os` only for APIs one OS has (Electron's `sharedTexture` on macOS, `clang_rt.osx`). A library behind a Cargo feature (FFmpeg, cpal) is optional and on by default.
- **Files and threads go through `openrip-platform`**: `assets::read`/`open`/`list`/`write` instead of `std::fs`, `tasks::spawn` instead of `std::thread`. A platform backend that owns its own thread (cpal's stream) keeps it inside the backend.
- **`check-targets.sh` passes** before a change lands. If a crate can't build for a target yet, the script and this page say why; it isn't left out quietly.

## Layers

```
bindings      openrip-node (napi: the Electron app)        later: Swift/Kotlin (UniFFI or C ABI), wasm-bindgen
                  │
core API      openrip-core   projects in, Session (frames, playback clock, edits), Thumbnails and waveforms,
                  │          export with progress and cancel, CapCut conversion, text blocks, engine info
                  │
engine        openrip-export ──► openrip-playback ──► openrip-render ──► openrip-frame
                  │                  │    │                                   ▲
                  │                  │    └──► openrip-media (decode seams) ──┘
                  └──────────────────┴──────► openrip-audio (decode seam, mixer)
shared        openrip-frame (decoded pictures, pixel types)    openrip-platform (assets, tasks)
pure          openrip-model    openrip-capcut    openrip-v1

backends      behind seams in the engine crates: FFmpeg, VideoToolbox, cpal, IOSurface/Metal
```

- **Bindings only convert.** `openrip-node` is napi types to and from `openrip-core`'s, one session and one export at a time, as the app expects (`index.d.ts`). The logic lives in core, so a Swift, Kotlin or wasm binding wraps the same calls. Core's API is plain Rust: owned data, `Result` with stable messages, objects usable from any thread (`Thumbnails`, `ExportControl`), and a session whose render work can run on the binding's own worker (`Session::frame_job` → `FrameJob::render` → `Session::hand_out`).
- **Rendering needs decoded frames, not the decoder.** `openrip-render` depends on `openrip-frame`, not `openrip-media`, so it builds without FFmpeg. Each decode backend implements `FramePixels` for its own buffers.
- **Pure crates stay pure**: model, CapCut and v1 import and platform are plain Rust with no platform code. Frame has one Apple-gated accessor (the `CVPixelBuffer` behind a hardware frame) and is otherwise the same.

## Seams

| Seam | Where | Entry points | Built in today | Fallback, and still to write |
|---|---|---|---|---|
| Video decode | `media/src/backend.rs` | `VideoSource` (frame by time, scrub stand-ins, keyframes), `VideoBackend`, `open_video`, `add_video_backend` | FFmpeg demux and decode, with VideoToolbox on Apple (native for H.264/HEVC in MP4/MOV, FFmpeg's hwaccel otherwise); feature `ffmpeg` | No backend: opening a video says so. Todo: MediaCodec (Android), WebCodecs (web) |
| Still decode | `media/src/still.rs` | `decode_still`, `StillBackend`, `add_still_backend` | PNG in Rust everywhere; FFmpeg for the rest (`ffmpeg`) | PNG only. Todo: ImageIO (iOS), `ImageDecoder` (Android), `createImageBitmap` (web) |
| Audio decode | `audio/src/source.rs` | `AudioSource`, `AudioBackend`, `open_audio`, `add_audio_backend` | FFmpeg (`ffmpeg`), with `atempo` for pitch-keeping speed changes | No backend: clips are silent. Without FFmpeg, sped-up clips are resampled (pitch follows speed). Todo: platform decoders, a portable time-stretch |
| Audio output | `playback/src/output.rs` | `AudioOutput`, `set_audio_output` | cpal (`cpal`): CoreAudio, AAudio, WASAPI, ALSA | No output: the player doesn't open and the preview runs by the wall clock. Todo: an AudioWorklet output for the web |
| Encode | `export/src/lib.rs` | `Encoder`, `open_encoder`, `Picture` (what to draw each frame into) | VideoToolbox H.264/HEVC through FFmpeg on Apple, fed NV12 IOSurfaces, AAC audio (`ffmpeg`) | No encoder: export says so. Todo: FFmpeg software encode from `Picture::Rgba` (other desktops), MediaCodec with an input surface (Android), WebCodecs `VideoEncoder` (web) |
| GPU texture interop | `render/src/interop.rs` | `Surface`, `Compositor::render_into`, video import | Apple: hardware frames' IOSurface planes as Metal textures; BGRA and NV12 IOSurfaces rendered into | Frames read back and uploaded (`to_rgb`); a `Surface` holds pixels read back from the GPU. Todo: `AHardwareBuffer` with Vulkan (Android), `importExternalTexture` (web), DXGI and dmabuf (other desktops) |
| Asset access | `platform/src/assets.rs` | `Assets` (read, open, exists, list, version, write, local_path), `set_assets`, `Memory` | `FileSystem` (paths); `Memory` serves blobs in memory in front of another resolver | Names are any string, so handles and URLs work for everything the engine reads itself. FFmpeg opens by name (`local_path`); todo: a custom AVIO over `Assets::open` for handles and blobs |
| Fonts | `render/src/fonts.rs` | `register` (core's `register_fonts`), `resolve`, `families`, `font_folders` | Faces a client registers by asset name (the app's bundled WOFF2 files), and the platform's font folders (macOS, Windows, Linux, Android) scanned through `assets` | No folders (iOS, the web): only registered faces, else the text's fallback font. Todo: the web's local fonts, iOS's system fonts through the client |
| Task spawning | `platform/src/tasks.rs` | `Spawner`, `spawn`, `Task` | `Threads`: an OS thread per worker | A worker that can't start is an error (or that optional worker is skipped). Todo: a Web Worker spawner for wasm threads |

The workers that start through `tasks::spawn`: one frame server per source, the render-ahead preview, decoder prefetch, the scrub workers and the audio mixer (and the VideoToolbox warm-up).

## Features

| Crate | Features (default on) | What they bring |
|---|---|---|
| `openrip-media` | `ffmpeg` | `VideoDecoder`, `probe`, FFmpeg's still backend, VideoToolbox |
| `openrip-audio` | `ffmpeg` | `AudioDecoder`, `atempo` time-stretch |
| `openrip-playback` | `ffmpeg`, `cpal` | forwards `ffmpeg` to media and audio; cpal output |
| `openrip-export` | `ffmpeg` | the VideoToolbox encoder; forwards `ffmpeg` to playback and audio |
| `openrip-core` | `ffmpeg`, `audio-output` | everything above |

The workspace's dependencies on media, audio, playback and export come without default features, and each member asks for what it uses. The addon takes core's defaults (plus `static-ffmpeg` in the app's builds), `openrip-dev` asks for FFmpeg and cpal, and render's tests ask for FFmpeg to decode test clips. Tests and examples that decode real media declare `required-features`, so `cargo test --no-default-features` runs the rest.

## What each target supports today

`check-targets.sh` runs `cargo check` (nothing links) for these. The pure crates are model, platform, capcut, v1 and frame. "Engine" is render, media, audio, playback, export and core without default features.

| Target | Checked by the script | Runs today | Still missing |
|---|---|---|---|
| macOS (aarch64, x86_64) | host: the engine without FFmpeg or cpal (the full build is the app's) | Everything: the app's preview, playback, export, thumbnails, CapCut import | – |
| iOS (`aarch64-apple-ios`) | pure crates; engine without FFmpeg; with cpal; with FFmpeg and VideoToolbox (FFmpeg headers from the macOS arm64 build) | Not run yet. The code paths are the macOS ones: VideoToolbox decode, Metal interop over IOSurfaces, the VideoToolbox encoder, CoreAudio through cpal | An iOS build of FFmpeg (`build-ffmpeg.sh` makes macOS ones) or native backends; a Swift binding over core; fonts: iOS has no font folders to read, so the client registers what it offers (`register_fonts`); the fallback for CapCut's own text still looks in macOS's folders (`playback/src/preview.rs`) |
| Android (`aarch64-linux-android`) | pure crates; engine without FFmpeg; with cpal (AAudio) | Not run yet. Would composite with wgpu (Vulkan or GLES) and play through AAudio, and read PNGs | A MediaCodec video backend and an audio decoder (there is no Android FFmpeg build); the NDK to link; a Kotlin binding; an encoder; zero-copy interop |
| Web (`wasm32-unknown-unknown`) | pure crates; engine without FFmpeg (wgpu's WebGPU backend) | Not run yet | See below |
| Windows, Linux | not checked (the script runs on a Mac) | – | FFmpeg builds there, but there's no encoder and no zero-copy interop yet (VideoToolbox and IOSurface only) |

The web build compiles, but these stand between it and a frame on screen:

- **No OS threads.** wasm32 without atomics can't spawn threads, so the workers don't start: the render-ahead pipeline reports an error, and prefetch and the scrub workers are skipped. What's left is the synchronous path (`FrameJob::render` or `render_image` on the calling thread). For the same reason render enables wgpu's `fragile-send-sync-non-atomic-wasm` on wasm32: the engine's types are `Send` for its worker threads, and wgpu's WebGPU objects only are when there are no threads. A threaded web build (wasm atomics with Web Workers) needs the compositor kept on one worker instead.
- **Blocking GPU setup.** `Compositor::new` waits for the adapter with `pollster`, which a browser's main thread can't do. It needs an async constructor.
- **Clock.** `std::time::Instant` panics on `wasm32-unknown-unknown`, and the engine reads it for frame timing, the wall clock and traces. It needs a clock seam (`web-time` behind `openrip-platform`).
- **Backends.** WebCodecs for video and audio decode and for encoding, `createImageBitmap` for stills, an `Assets` resolver over `fetch` and `File` blobs, an AudioWorklet output.

## Notes

- New ids use `uuid` v4. On the web its randomness comes from the browser (`uuid`'s `js` feature, only on `wasm32-unknown-unknown`).
- wgpu's Vulkan and GLES backends (Android, the web) pull in `ordered-float`. Version 5.5 needs Rust 1.90, so the lockfile keeps 5.1 while the toolchain is 1.89. It doesn't affect Apple builds, which don't use it.
- The Android check needs no NDK while every dependency is pure Rust. A dependency that compiles C for Android will need the NDK's clang on the path.
- FFmpeg isn't checked for Android or the web: there's no build of it for either, and the native codecs (MediaCodec, WebCodecs) are the backends to write there.
