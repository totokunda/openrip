#!/bin/bash
# Check that the engine's portable crates build for every platform it's meant to run on:
# iOS, Android and the web, besides the desktop. `cargo check` only (nothing is linked), so
# no platform SDK is needed beyond the Rust targets. What must stay portable, the seams
# behind which platform code lives, and what each target supports today:
# docs/plan/portability.md.
#
#   engine/scripts/check-targets.sh [host] [ios] [android] [wasm]    (default: all four)
#
# Install the targets once with:
#   rustup target add aarch64-apple-ios aarch64-linux-android wasm32-unknown-unknown
set -euo pipefail
cd "$(dirname "$0")/.."
# Its own target dir: checking for other targets doesn't disturb the desktop builds.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target/check-targets}"

# Pure Rust, no platform code at all: these build anywhere Rust does.
PURE=(-p openrip-model -p openrip-platform -p openrip-motion -p openrip-capcut -p openrip-v1 -p openrip-frame)
# The engine up to its API, with no built-in backend (no FFmpeg, no cpal): the seams,
# rendering, playback logic, export's render loop and openrip-core. Platform code inside
# them is behind cfgs with a portable fallback.
ENGINE=(-p openrip-render -p openrip-media -p openrip-audio -p openrip-playback -p openrip-export -p openrip-core)
# Not portable on purpose: openrip-node (a Node/Electron addon for the desktop app) and
# openrip-dev (desktop tools that need FFmpeg).

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(host ios android wasm)

failed=()
check() {
  local what="$1"
  shift
  echo "== $what"
  if ! cargo check -q "$@"; then
    failed+=("$what")
  fi
}

need() {
  if ! rustup target list --installed | grep -qx "$1"; then
    echo "missing Rust target $1: rustup target add $1" >&2
    exit 1
  fi
}

for t in "${targets[@]}"; do
  case "$t" in
    host)
      # The desktop build without backends: what the other targets build, checked here first.
      check "host: engine without FFmpeg or cpal" "${PURE[@]}" "${ENGINE[@]}" --no-default-features
      ;;
    ios)
      need aarch64-apple-ios
      check "ios: pure crates" --target aarch64-apple-ios "${PURE[@]}"
      # VideoToolbox, CoreVideo/IOSurface and Metal interop are gated on Apple, not macOS,
      # so they're checked here too.
      check "ios: engine without FFmpeg" --target aarch64-apple-ios "${ENGINE[@]}" --no-default-features
      check "ios: engine with cpal (CoreAudio)" --target aarch64-apple-ios -p openrip-core --no-default-features --features audio-output
      # With FFmpeg: its headers from the arm64 macOS build are enough for `check` (nothing
      # links). Shipping needs an iOS build of FFmpeg, which build-ffmpeg.sh doesn't make yet.
      ffmpeg="${FFMPEG_DIR:-$PWD/.ffmpeg/arm64}"
      if [ -d "$ffmpeg/include" ]; then
        FFMPEG_DIR="$ffmpeg" check "ios: engine with FFmpeg and VideoToolbox (headers only)" --target aarch64-apple-ios -p openrip-core
      else
        echo "== ios: engine with FFmpeg skipped: no FFmpeg headers at $ffmpeg (scripts/build-ffmpeg.sh arm64, or set FFMPEG_DIR)"
      fi
      ;;
    android)
      need aarch64-linux-android
      check "android: pure crates" --target aarch64-linux-android "${PURE[@]}"
      check "android: engine without FFmpeg" --target aarch64-linux-android "${ENGINE[@]}" --no-default-features
      check "android: engine with cpal (AAudio)" --target aarch64-linux-android -p openrip-core --no-default-features --features audio-output
      # Not checked: FFmpeg (there's no Android build of it; MediaCodec is the backend to
      # write instead), and anything that links (that needs the NDK).
      ;;
    wasm)
      need wasm32-unknown-unknown
      check "wasm: pure crates" --target wasm32-unknown-unknown "${PURE[@]}"
      # wgpu's WebGPU backend; no OS threads, so the engine's workers don't start there (see
      # the portability doc for what runs on the web today).
      check "wasm: engine without FFmpeg" --target wasm32-unknown-unknown "${ENGINE[@]}" --no-default-features
      # Not checked: FFmpeg (it doesn't build for wasm32-unknown-unknown; WebCodecs is the
      # backend to write) and cpal (audio output on the web is an AudioWorklet to write).
      ;;
    *)
      echo "unknown target group $t (host, ios, android or wasm)" >&2
      exit 2
      ;;
  esac
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "FAILED:"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
echo "all checks passed"
