// How a proxy's video is encoded. A video of more than 8 bits a sample (log footage: an iPhone's
// ProRes or 10-bit HEVC) gets a 10-bit HEVC proxy where the engine keeps 10 bits on the GPU
// (Apple Silicon): a LUT stretches log footage's tones, and through an 8-bit H.264 proxy they band
// and block. VideoToolbox makes it about as fast as libx264; libx265 would be ten times slower.
// Everything else keeps the 8-bit H.264 proxy. Both are all keyframes, for scrubbing.

/** The first video stream's pixel format in FFmpeg's description of a file (`ffmpeg -i`'s output). */
export const describedPixelFormat = (description: string): string | undefined => /Stream #\d+:\d+.*?: Video: [^,]+, ([a-z0-9_]+)/.exec(description)?.[1];

/** Whether an FFmpeg pixel format holds more than 8 bits a sample (yuv422p10le, p010le, …). */
export const deepPixelFormat = (pixFmt: string | undefined): boolean => /(9|10|12|14|16|48|64)(le|be)$/.test(pixFmt ?? "");

/** Whether a source of this depth gets a 10-bit proxy here. */
export const tenBitProxy = (deep: boolean, platform: string = process.platform, arch: string = process.arch): boolean => deep && platform === "darwin" && arch === "arm64";

/** FFmpeg's video encoding arguments for a proxy. */
export const proxyVideoArgs = (tenBit: boolean): string[] =>
  tenBit
    ? ["-c:v", "hevc_videotoolbox", "-profile:v", "main10", "-q:v", "75", "-pix_fmt", "p010le", "-tag:v", "hvc1"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p"];
