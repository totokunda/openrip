# Building OpenRip from source

## Prerequisites

- **Node.js 24.x** (see `apps/app/package.json` → `engines.node`)
- **Git**

FFmpeg doesn't need a separate install. Development builds use the `ffmpeg-static` / `ffprobe-static` npm packages, and packaged builds bundle those binaries under `resources/ffmpeg/`. To use your own FFmpeg instead, set `FFMPEG_PATH` / `FFPROBE_PATH`.

## Clone

The LUT filter packs live in a Git submodule:

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

### Code signing

- **macOS:** set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` (or the App Store Connect API key variables) to enable notarization. Without them the build is signed but not notarized.
- **Windows:** see `apps/app/scripts/sign-windows.js`.
