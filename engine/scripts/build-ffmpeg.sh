#!/bin/sh
# Build the FFmpeg the engine links into its addon: static libraries, LGPL only, with just
# the demuxers, decoders, encoders and filters the engine uses, so the app needs no FFmpeg
# installed and ships no GPL code.
#
#   engine/scripts/build-ffmpeg.sh [arm64|x86_64]   (default: this Mac's architecture)
#
# Installs into engine/.ffmpeg/<arch>/ (include/, lib/*.a). Point FFMPEG_DIR there and build
# with the `static-ffmpeg` feature (scripts/build-engine.mjs does both).
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
  x86_64 | x64) ARCH=x86_64 ;;
  *) echo "unknown architecture $ARCH" >&2; exit 1 ;;
esac

HERE=$(cd "$(dirname "$0")/.." && pwd)
ROOT="$HERE/.ffmpeg"
PREFIX="$ROOT/$ARCH"
SRC="$ROOT/src/ffmpeg-$VERSION"
if [ -f "$PREFIX/lib/libavcodec.a" ] && [ "$(cat "$PREFIX/.version" 2>/dev/null)" = "$STAMP" ]; then
  echo "FFmpeg $VERSION for $ARCH is already built in $PREFIX"
  exit 0
fi

mkdir -p "$ROOT/src"
if [ ! -d "$SRC" ]; then
  TARBALL="$ROOT/src/ffmpeg-$VERSION.tar.xz"
  [ -f "$TARBALL" ] || curl -fL --retry 3 -o "$TARBALL" "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz"
  echo "$SHA256  $TARBALL" | shasum -a 256 -c -
  tar -xJf "$TARBALL" -C "$ROOT/src"
fi

BUILD="$ROOT/build-$ARCH"
rm -rf "$BUILD"
mkdir -p "$BUILD"
cd "$BUILD"

CROSS=""
if [ "$ARCH" != "$(uname -m)" ]; then
  CROSS="--enable-cross-compile"
fi
# The oldest macOS the app supports.
MIN=11.0
# FFmpeg's x86 assembly needs nasm; without it Intel builds decode in plain C (slower in
# software, which only some formats need: VideoToolbox decodes H.264, HEVC and ProRes).
ASM=""
if [ "$ARCH" = x86_64 ] && ! command -v nasm >/dev/null 2>&1; then
  echo "warning: nasm not found; building x86_64 FFmpeg without its assembly (brew install nasm)" >&2
  ASM="--disable-x86asm"
fi

"$SRC/configure" \
  --prefix="$PREFIX" \
  --arch="$ARCH" --target-os=darwin $CROSS $ASM \
  --cc="clang -arch $ARCH" --cxx="clang++ -arch $ARCH" \
  --extra-cflags="-mmacosx-version-min=$MIN" --extra-ldflags="-mmacosx-version-min=$MIN" \
  --enable-static --disable-shared --enable-pic \
  --disable-programs --disable-doc --disable-network --disable-autodetect \
  --disable-avdevice \
  --enable-zlib --enable-videotoolbox --enable-audiotoolbox \
  --disable-everything \
  --enable-protocol=file \
  --enable-demuxer=mov,matroska,avi,mpegts,mpegps,m4v,h264,hevc,mp3,aac,ac3,eac3,flac,ogg,wav,w64,aiff,caf,image2,image_jpeg_pipe,image_png_pipe,image_webp_pipe,image_bmp_pipe,image_tiff_pipe,gif \
  --enable-decoder=h264,hevc,prores,vp8,vp9,av1,mpeg4,mpeg1video,mpeg2video,h263,dnxhd,mjpeg,png,bmp,tiff,webp,gif \
  --enable-decoder=aac,aac_latm,mp3,mp3float,mp2,mp2float,ac3,eac3,flac,alac,opus,vorbis \
  --enable-decoder=pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_u8,pcm_alaw,pcm_mulaw \
  --enable-encoder=aac,h264_videotoolbox,hevc_videotoolbox,prores_videotoolbox,prores_ks \
  --enable-muxer=mp4,mov,matroska \
  --enable-parser=h264,hevc,av1,vp8,vp9,mpeg4video,mpegvideo,h263,dnxhd,mjpeg,png,bmp,webp,gif,aac,aac_latm,mpegaudio,ac3,flac,opus,vorbis \
  --enable-bsf=vp9_superframe_split,av1_frame_split,extract_extradata,h264_mp4toannexb,hevc_mp4toannexb,aac_adtstoasc \
  --enable-hwaccel=h264_videotoolbox,hevc_videotoolbox,prores_videotoolbox,vp9_videotoolbox,av1_videotoolbox,mpeg4_videotoolbox \
  --enable-filter=atempo,aformat,aresample,anull,format,null,scale

make -j"$(sysctl -n hw.ncpu)"
make install
echo "$STAMP" > "$PREFIX/.version"
echo "FFmpeg $VERSION for $ARCH installed in $PREFIX"
