#!/bin/sh
# Build the FFmpeg the engine links into its addon: static libraries, LGPL only, with just
# the demuxers, decoders, encoders and filters the engine uses, so the app needs no FFmpeg
# installed and ships no GPL code.
#
#   engine/scripts/build-ffmpeg.sh [arm64|x86_64]   (default: this machine's architecture)
#
# On macOS, Linux and Windows. Windows builds with MSVC (the addon's Rust target is
# x86_64-pc-windows-msvc, as Electron's napi addons need): run it from an MSYS2 shell whose
# PATH has MSVC's cl.exe, link.exe and lib.exe (MSVC's "x64 Native Tools" prompt, then
# `msys2_shell.cmd -use-full-path`), with make and nasm installed in MSYS2.
#
# Installs into engine/.ffmpeg/<arch>/ on macOS and engine/.ffmpeg/<os>-<arch>/ elsewhere
# (linux-x86_64, linux-arm64, windows-x86_64), each with include/ and lib/. Point
# FFMPEG_DIR there and build with the `static-ffmpeg` feature (scripts/build-engine.mjs
# does both).
set -eu

VERSION=9.0.2
# Bumped when the configure flags change, so an older build is made again.
REVISION=3
STAMP="$VERSION.$REVISION"
# Pinned from ffmpeg.org on 2026-10-16, after checking its release signature (key
# FCF986EA15E6E293A5644F10B4322F04D67658D8).
SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
ARCH=${1:-$(uname -m)}
case "$ARCH" in
  arm64 | aarch64) ARCH=arm64 ;;
  x86_64 | x64 | amd64) ARCH=x86_64 ;;
  *) echo "unknown architecture $ARCH" >&2; exit 1 ;;
esac
case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux) OS=linux ;;
  MINGW* | MSYS*) OS=windows ;;
  *) echo "no FFmpeg build for $(uname -s) yet" >&2; exit 1 ;;
esac
HOST_ARCH=$(uname -m)
[ "$HOST_ARCH" = aarch64 ] && HOST_ARCH=arm64

HERE=$(cd "$(dirname "$0")/.." && pwd)
ROOT="$HERE/.ffmpeg"
# macOS keeps the folder it always had; the others are named for their OS too.
if [ "$OS" = macos ]; then NAME=$ARCH; else NAME=$OS-$ARCH; fi
PREFIX="$ROOT/$NAME"
SRC="$ROOT/src/ffmpeg-$VERSION"
# MSVC names the static libraries avcodec.lib, the others libavcodec.a.
if [ "$OS" = windows ]; then LIBAVCODEC=avcodec.lib; else LIBAVCODEC=libavcodec.a; fi
if [ -f "$PREFIX/lib/$LIBAVCODEC" ] && [ "$(cat "$PREFIX/.version" 2>/dev/null)" = "$STAMP" ]; then
  echo "FFmpeg $VERSION for $NAME is already built in $PREFIX"
  exit 0
fi

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1
}
# Download $1 to $2 (once) and check it against the SHA-256 $3.
fetch() {
  [ -f "$2" ] || curl -fL --retry 3 -o "$2" "$1"
  if [ "$(sha256 "$2")" != "$3" ]; then
    echo "$2: checksum mismatch" >&2
    exit 1
  fi
}

mkdir -p "$ROOT/src"
if [ ! -d "$SRC" ]; then
  TARBALL="$ROOT/src/ffmpeg-$VERSION.tar.xz"
  fetch "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz" "$TARBALL" "$SHA256"
  tar --no-same-owner -xJf "$TARBALL" -C "$ROOT/src"
fi

BUILD="$ROOT/build-$NAME"
rm -rf "$BUILD"
mkdir -p "$BUILD"
cd "$BUILD"

CROSS=""
if [ "$ARCH" != "$HOST_ARCH" ]; then
  CROSS="--enable-cross-compile"
fi
# FFmpeg's x86 assembly needs nasm; without it Intel builds decode in plain C (slower in
# software: on macOS only some formats (VideoToolbox decodes H.264, HEVC and ProRes), but
# all of them on Windows and Linux).
ASM=""
if [ "$ARCH" = x86_64 ] && ! command -v nasm >/dev/null 2>&1; then
  echo "warning: nasm not found; building x86_64 FFmpeg without its assembly (install nasm)" >&2
  ASM="--disable-x86asm"
fi

# ---- Encoders, for the export crate's encoder discovery (owned by the encoders work) ----
# AAC everywhere, plus each platform's video encoders below. Built in so the export crate
# can pick them up; until it does, the engine reports only VideoToolbox's codecs.
#   prores_ks: software ProRes (LGPL), where there's no ProRes hardware encoder.
#   h264_mf, hevc_mf (Windows): Media Foundation's H.264/HEVC, the GPU's encoder where the
#     driver has one, else Microsoft's software one. FFmpeg loads mfplat.dll when one opens,
#     so the addon still loads on Windows editions without Media Foundation (the N ones).
SOFTWARE_ENCODERS=prores_ks
WINDOWS_ENCODERS=h264_mf,hevc_mf
# ---- Hardware decoders ----
# VideoToolbox on macOS. D3D11VA on Windows is built in (FFmpeg loads d3d11.dll when it's
# used) but the engine doesn't ask for it yet. VAAPI on Linux is left out for now: FFmpeg
# links libva itself, so the addon wouldn't load on a machine without it.

# Per platform: the toolchain, zlib, hardware decoding and encoders.
case "$OS" in
  macos)
    # The oldest macOS the app supports.
    MIN=11.0
    set -- \
      --target-os=darwin --cc="clang -arch $ARCH" --cxx="clang++ -arch $ARCH" \
      --extra-cflags="-mmacosx-version-min=$MIN" --extra-ldflags="-mmacosx-version-min=$MIN" \
      --enable-pic --enable-zlib --enable-videotoolbox --enable-audiotoolbox \
      --enable-encoder=aac,h264_videotoolbox,hevc_videotoolbox,prores_videotoolbox,$SOFTWARE_ENCODERS \
      --enable-hwaccel=h264_videotoolbox,hevc_videotoolbox,prores_videotoolbox,vp9_videotoolbox,av1_videotoolbox,mpeg4_videotoolbox
    ;;
  linux)
    # zlib is the system's (libz.so.1 is on every desktop Linux; zlib1g-dev to build).
    set -- \
      --target-os=linux --enable-pic --enable-zlib \
      --enable-encoder=aac,$SOFTWARE_ENCODERS
    ;;
  windows)
    [ "$ARCH" = x86_64 ] || { echo "Windows builds are x86_64 only for now" >&2; exit 1; }
    command -v cl.exe >/dev/null 2>&1 || { echo "cl.exe isn't on PATH: run this from MSVC's x64 Native Tools prompt through msys2_shell.cmd -use-full-path" >&2; exit 1; }
    # zlib, which Windows doesn't have, built here with MSVC as a static library, z.lib (what
    # configure's -lz asks MSVC's linker for).
    ZLIB_VERSION=1.3.1
    ZLIB="$ROOT/zlib-$NAME"
    if [ ! -f "$ZLIB/lib/z.lib" ]; then
      fetch "https://zlib.net/fossils/zlib-$ZLIB_VERSION.tar.gz" "$ROOT/src/zlib-$ZLIB_VERSION.tar.gz" 9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23
      rm -rf "$ROOT/src/zlib-$ZLIB_VERSION" "$ZLIB"
      tar --no-same-owner -xzf "$ROOT/src/zlib-$ZLIB_VERSION.tar.gz" -C "$ROOT/src"
      mkdir -p "$ZLIB/include" "$ZLIB/lib"
      (cd "$ROOT/src/zlib-$ZLIB_VERSION" &&
        MSYS2_ARG_CONV_EXCL='*' cl.exe -nologo -c -MT -O2 adler32.c compress.c crc32.c deflate.c gzclose.c gzlib.c gzread.c gzwrite.c infback.c inffast.c inflate.c inftrees.c trees.c uncompr.c zutil.c &&
        MSYS2_ARG_CONV_EXCL='*' lib.exe -nologo -out:z.lib adler32.obj compress.obj crc32.obj deflate.obj gzclose.obj gzlib.obj gzread.obj gzwrite.obj infback.obj inffast.obj inflate.obj inftrees.obj trees.obj uncompr.obj zutil.obj &&
        cp z.lib "$ZLIB/lib/" && cp zlib.h zconf.h "$ZLIB/include/")
    fi
    # Found through MSVC's own search paths, which configure's flag translation doesn't touch.
    INCLUDE="$(cygpath -w "$ZLIB/include");${INCLUDE:-}"
    LIB="$(cygpath -w "$ZLIB/lib");${LIB:-}"
    export INCLUDE LIB
    # -MT: the static C runtime, as the addon links it (Electron ships no VC++ runtime).
    set -- \
      --toolchain=msvc --target-os=win64 --extra-cflags=-MT \
      --enable-w32threads --enable-zlib --enable-d3d11va --enable-mediafoundation \
      --enable-encoder=aac,$SOFTWARE_ENCODERS,$WINDOWS_ENCODERS \
      --enable-hwaccel=h264_d3d11va,hevc_d3d11va,vp9_d3d11va,av1_d3d11va,mpeg2_d3d11va
    ;;
esac

"$SRC/configure" \
  --prefix="$PREFIX" \
  --arch="$ARCH" $CROSS $ASM \
  --enable-static --disable-shared \
  --disable-programs --disable-doc --disable-network --disable-autodetect \
  --disable-avdevice \
  --disable-everything \
  "$@" \
  --enable-protocol=file \
  --enable-demuxer=mov,matroska,avi,mpegts,mpegps,m4v,h264,hevc,mp3,aac,ac3,eac3,flac,ogg,wav,w64,aiff,caf,image2,image_jpeg_pipe,image_png_pipe,image_webp_pipe,image_bmp_pipe,image_tiff_pipe,gif \
  --enable-decoder=h264,hevc,prores,vp8,vp9,av1,mpeg4,mpeg1video,mpeg2video,h263,dnxhd,mjpeg,png,bmp,tiff,webp,gif \
  --enable-decoder=aac,aac_latm,mp3,mp3float,mp2,mp2float,ac3,eac3,flac,alac,opus,vorbis \
  --enable-decoder=pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_u8,pcm_alaw,pcm_mulaw \
  --enable-muxer=mp4,mov,matroska \
  --enable-parser=h264,hevc,av1,vp8,vp9,mpeg4video,mpegvideo,h263,dnxhd,mjpeg,png,bmp,webp,gif,aac,aac_latm,mpegaudio,ac3,flac,opus,vorbis \
  --enable-bsf=vp9_superframe_split,av1_frame_split,extract_extradata,h264_mp4toannexb,hevc_mp4toannexb,aac_adtstoasc \
  --enable-filter=atempo,aformat,aresample,anull,format,null,scale ||
  { grep -m1 -A60 "check_pkg_config zlib" ffbuild/config.log >&2; tail -30 ffbuild/config.log >&2; exit 1; }

if command -v nproc >/dev/null 2>&1; then JOBS=$(nproc); else JOBS=$(sysctl -n hw.ncpu); fi
make -j"$JOBS"
make install
# Windows: zlib goes beside FFmpeg's libraries, for the addon to link.
[ "$OS" = windows ] && cp "$ZLIB/lib/z.lib" "$PREFIX/lib/"
echo "$STAMP" > "$PREFIX/.version"
echo "FFmpeg $VERSION for $NAME installed in $PREFIX"
