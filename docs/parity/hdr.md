# HDR (HLG) video

iPhones record HDR video by default: HEVC 10-bit, BT.2020 primaries, HLG transfer, with Dolby Vision profile 8.4 metadata. Three of the clips the local drafts still have on disk are like this, and they account for 65 clip uses, about a third of the uses whose media is present. CapCut shows them as SDR. OpenRip used to decode them with the BT.2020 matrix and stop there, which shows the HLG signal as if it were SDR gamma: flat and pale.

## What CapCut does (measured on one frame)

The reference is the cover of a draft whose first frame is a plain HLG clip, so the cover is CapCut's own render of it. The cover is JPEG at 1080×1920. It is compared with the same frame decoded at 10 bits, before and after each candidate conversion.

| Conversion | PSNR vs CapCut |
|---|---|
| None: BT.2020 matrix only (OpenRip before) | 18.3 dB |
| Apple's (AVAssetImageGenerator, SDR forced) | 25.8 dB |
| BT.2100 display light (OOTF γ 1.2), best scaling, BT.709 primaries, gamma 2.4 | 27.6 dB |
| Scene light × *k*, BT.709 primaries, gamma 2.4 (best *k* 1.25) | 27.7 dB |
| **Scene light × 1.15, BT.709 primaries, gamma 2.4, soft shoulder from 0.6** | **29.5 dB** |
| Upper bound: the best free per-channel curve | 29.2 dB |

The fit reaches the bound a free curve allows for this frame. What remains is JPEG noise and the frame's own detail, so this one frame can't separate the transform any further.

On neutral greys, CapCut's output matches scene light × 1.15 with gamma 1/2.4 within about 0.01 up to signal 0.6. Above that CapCut rolls off (signal 0.975 gives 0.93). The shoulder used here is quadratic: it keeps the curve's value and slope at 0.6 and reaches white at 1.4.

## What OpenRip does

`VideoFrame::transfer()` reports HLG from the stream's colour tags. The GPU import shader (`hlg_to_sdr` in `shaders.wgsl`) applies the fitted conversion to HLG frames:
1. HLG inverse OETF to scene light;
2. × 1.15;
3. BT.2020 → BT.709 primaries;
4. gamma 1/2.4;
5. the shoulder.

Preview, export and thumbnails all go through it. The draft from the table goes from 18.3 to 29.9 dB against its cover, with text and compositing included.

Not covered:
- **PQ (HDR10).** Nothing in the local drafts uses it, so there is no CapCut reference to measure against.
- **The CPU fallback (`to_rgb`).** It doesn't convert; hardware decoding always handles these clips.

A calibration clip with known HLG greys and colours would pin the curve down exactly and show whether CapCut uses the Dolby Vision metadata.
