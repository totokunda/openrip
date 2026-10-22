# Building OpenRip from source

## Prerequisites

- **Node.js 24.x** (see `apps/app/package.json` → `engines.node`)
- **Git**
- **Rust** (stable, from [rustup.rs](https://rustup.rs)) for the engine. `npm start` and `npm run build` build it (`scripts/build-engine.mjs`) into `apps/app/native/<platform>-<arch>/`; packaged builds carry it under `resources/engine/`. Without Rust, or on a platform the engine isn't built for yet, the app runs on its own preview. `npm run build:engine` builds it on its own. It builds on macOS, Linux (x64, arm64) and Windows (x64), each with a minimal LGPL FFmpeg built the first time (`engine/scripts/build-ffmpeg.sh`), which needs:
  - **Linux:** a C/C++ toolchain, `nasm`, `cmake`, `pkg-config`, `clang` and the zlib, ALSA and libclang headers (on Ubuntu: `sudo apt install build-essential nasm cmake pkg-config clang libclang-dev zlib1g-dev libasound2-dev`).
  - **Windows:** Visual Studio's C++ build tools, LLVM (for libclang), and [MSYS2](https://www.msys2.org) at `C:\msys64` (or `MSYS2_BASH` set to its `usr\bin\bash.exe`) with `pacman -S make nasm diffutils`. Run the build from Visual Studio's "x64 Native Tools" prompt, so FFmpeg's build finds `cl.exe`.

FFmpeg doesn't need a separate install. Development builds use the `ffmpeg-static` / `ffprobe-static` npm packages, and packaged builds bundle those binaries under `resources/ffmpeg/`. To use your own FFmpeg instead, set `FFMPEG_PATH` / `FFPROBE_PATH`.

## Clone

The LUT filter packs live in an optional Git submodule. It's large (about 900 MB, mostly the `full` pack that packaged builds leave out by default). Without it the app still works, but the Filters panel is empty.

```bash
git clone --recurse-submodules https://github.com/totokunda/openrip.git
cd openrip
# or, in an existing clone:
git submodule update --init --recursive
```

## Run in development

```bash
cd apps/app
npm install
npm start
```

## Typecheck and build

```bash
cd apps/app
npm run typecheck
npm run build
```

## Package installers

```bash
cd apps/app
npm run bundle          # current platform
npm run bundle:mac      # macOS (dmg + zip)
npm run bundle:win      # Windows (nsis)
npm run bundle:linux    # Linux (deb, AppImage, tar.gz)
```

Output goes to `apps/app/dist/`.

To build for this Mac and install it in `/Applications` (it waits for a running OpenRip to quit and keeps the app it replaces in `~/Library/Caches/OpenRip/previous/`):

```bash
npm run install:mac
```

### Code signing

- **macOS:** set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` (or the App Store Connect API key variables) to enable notarization. Without them the build is signed but not notarized.
- **Windows:** see `apps/app/scripts/sign-windows.js`.
