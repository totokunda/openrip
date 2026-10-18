# What the local drafts use that wasn't drawn (2026-10-17)

CapCut 9.5.0, macOS. A script read every `draft_info.json` (65 drafts with one) and counted the segments using each feature that wasn't drawn. It counted only uses with a value that changes something: a slider at 0, or an HSL range or curve that does nothing, isn't counted. For each feature it also noted the screen time, whether the feature shows at frame 0 (so the cover checks it), and whether there's media and a CapCut export to compare against.

| Feature | Segments | Drafts | Seconds | At frame 0 | Ground truth | Rank |
|---|---|---|---|---|---|---|
| Curves | 40 | 1 | 126 | 1 | export, cover | 1 |
| Clarity | 30 (all at 0.02 but two) | 3 | 53 | 2 | export; calibration export at 0.5 and 1 | 2 |
| Stickers | 11, but 10 on hidden tracks | 4 | 15 | 0 visible | one export, on the external disk | 3 |
| Vignette | 4 (0.08 twice) | 2 | 23 | 1 | calibration export | 4 |
| HSL | 3 ranges on one clip | 1 | 3.5 | 1 | cover (the draft's export is of another version) | 5 |
| AI colour match / correct | 2 each | 1 | 7.5 | 0 | export | 6, not drawable without CapCut's models |
| Fade | 2 | 1 (calibration) | 2 | 0 | calibration export | 7 |
| Particle | 1, at 0 | 1 | 3.5 | 1 | — | nothing to draw |
| Video effect | 1 | 1 | 5 | 1 | cover | its bundle isn't in CapCut's cache |
| Log wheels | 0 | | | | | |
| Masks other than the rectangle | 0 | | | | | |

The ranking weighs uses by how much they show: a slider at 0.02 shows little, and a sticker on a hidden track not at all. All of these were worked down in that order; [colour.md](../colour.md), [stickers.md](../stickers.md) and [masks.md](../masks.md) have what was done and the parity numbers.

## Regression checks

- **Cover parity** (`openrip-dev cover-parity`) over all 56 drafts with a cover and media, using copies whose moved media paths point at the external disk. After the colour work, only the three drafts that use these features changed: HSL +4.7 dB, curves +0.7 dB, clarity 0.02 −0.1 dB (the print's resolution; its export is unchanged).
- **The external disk:** midway through the work it stopped listing its folders. They stat, but list as empty, even outside the sandbox. The 27 drafts whose media is there then dropped out of the comparison. On the 29 drafts still comparable, the sticker and mask work changed no cover; neither feature appears at any draft's first frame.
- **The app round trip** (`openrip-dev app-roundtrip`) stays at 138.1 dB: on 58 drafts while the disk was readable, and on the 32 with local media afterwards. It is also exact on the scratch drafts with visible stickers and with every new colour feature.
