# Split scenes, Auto adjust and Color match

CapCut's Split scenes, Adjust ▸ Auto adjust, Adjust ▸ Color match and Smart suggestions ▸ Make colors consistent are machine-learning features. OpenRip's are classic image analysis: no model, no network, the same answer for the same footage. The method does the same job, and where it can't tell, it leaves the clip alone. The code is the pure crate `engine/crates/analysis` (`openrip-analysis`), which reads pixels in memory and knows nothing of files, threads or the platform (it is in `scripts/check-targets.sh`'s pure list, so it builds for iOS, Android and wasm). `openrip-playback` decodes the frames and feeds it.

## Split scenes (`scenes.rs`)

Each frame is shrunk to about 4,000 pixels and described by its luma and chroma planes, a luma histogram, a chroma histogram and its edges (Sobel, thresholded). Two frames get a difference score from three measures that fail in different places:

- the histograms' L1 distance (which colours are there, wherever they move);
- the edge change ratio (Zabih, Miller and Mai, 1995): the share of edges that appear or vanish beyond a pixel of slack, which a change of light doesn't move;
- the mean luma difference.

The last two are taken after the best global shift between the frames (a coarse-to-fine search), so a pan or tilt isn't a change of shot.

- **Hard cuts:** a neighbouring pair's score above an absolute floor and well above the median of the scores around it (an adaptive threshold: a handheld or busy shot raises its own baseline), the largest nearby, and not a flash (the frame before looks like the one just after).
- **Dissolves and fades:** scores between frames a span apart (0.2 to 1.6 s), peaking where a blend explains the change: the middle frame close to the mean of the span's ends (a cross-fade is that blend; a pan or a walker isn't), and the ends different in structure (an exposure change keeps its edges). The cut goes where the blend is half way.
- **Through black or white:** a run of blank frames between two shots is one boundary in its middle (one at each end if the run is long enough to be a scene); a fade out and in through a dark frame is one boundary at the darkest frame.

Boundaries closer than the shortest scene (0.4 s) keep the clearest; none falls in the first or last shortest scene. Frames are pushed one at a time and only a short window is kept, so a long file costs no more memory than a short one. The thresholds are constants in `scenes.rs`.

### Measured

`bench/scenes/scene-bench.py` builds clips from sources with cuts, dissolves and fades at known places and scores what `openrip-dev` finds (a boundary counts when it is within half a second of a true one).

| Set | Boundaries | Precision | Recall | Notes |
|---|---:|---:|---:|---|
| Tuning | 73 | 1.000 | 0.973 | thresholds were set on this |
| Held out | 112 | 1.000 | 0.964 | hard cuts 71/74, dissolves 24/25, fades 13/13 |
| Untouched takes | none | | | 2 false positives in 14.4 min |

The held-out set was not looked at while tuning. The misses are cuts between shots that are alike in colour, structure and light.

## Auto adjust (`auto.rs`, `stats.rs`)

The clip's statistics come from frames sampled across it (`stats.rs`), in Oklab (`colour.rs`; Ottosson, 2020), a perceptual space where averages and spreads follow what the eye sees. Each statistic is brought into a band that well-exposed, balanced footage sits in and left alone when it is already there (a low-key or pastel clip is a choice, not a fault):

1. White balance (Temperature, Tint): the cast of the near-neutral pixels, mostly taken out.
2. Levels (Whites, Blacks): the 99.5th luma percentile up towards white and the 0.5th down towards black when the clip doesn't reach them.
3. Brightness: the mean Oklab lightness into its band.
4. Contrast: the luma spread into its band, then brightness again, as contrast moves it.
5. Saturation: the mean chroma into its band (a nearly grey clip stays grey).

Every target is reached by solving against the sliders' own maths (the compositor's CPU reference of its Adjust pass), not a rule of thumb, so the values are right for CapCut's slider curves. The result is ordinary Adjust slider values, shown in the panel and editable; the clip keeps a record of what it added (`color.auto`) so turning Auto adjust off removes only that and the user's own changes stay. Intensity scales the values.

## Color match (`matching.rs`)

Reinhard, Ashikhmin, Gooch and Shirley, "Color Transfer between Images" (2001): each channel's mean and spread taken from the clip's to the reference's. It is done in Oklab rather than the paper's lαβ (the channels hardly interact there either). The spreads' ratios are bounded so a nearly grey clip isn't stretched into noise nor a busy one flattened: a match should look like a grade, not a repaint. The transfer is baked into a 33-point 3D lookup table the compositor applies to the clip's own pixels, in a second LUT slot drawn before the clip's own LUT, then mixed in by the intensity. The clip stores both sides' statistics (`color.match`), so reopening the project redraws the match without reading the media again, and the engine's `color_match` effect makes the table itself.

Make colors consistent matches every clip in the project to one reference clip (the one under the playhead) as one undo step; the matches are marked `consistent`.

### Measured

`colormatch` (smoke harness, 19 checks): with a clip graded dark and warm as the reference, the matched clip's mean colour ends no more than half as far from the reference as it began, intensity 0 gives back the clip's own frame, and off, undo and redo each restore the engine's frame.

## Against CapCut

- CapCut's versions are ML; ours are classic. Split scenes can miss a cut between very similar shots that a learned model might catch, and it won't invent one in a clean take (2 false positives in 14.4 minutes of untouched footage).
- Color match takes the reference from a dropdown of the project's clips; CapCut's is picked by clicking a clip.
- Split scenes is in the clip menu, not on the media card.
- Auto adjust lists the sliders it set; CapCut sets them without showing the values.
- Nothing here is compared pixel for pixel with CapCut: its result depends on its model, so the checks are against known cut positions and against the reference's colours.
