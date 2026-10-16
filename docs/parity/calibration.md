# CapCut calibration session

Some facts about CapCut's draft format can only be learned from CapCut itself. This session pins them down so `openrip-capcut` converts them exactly:

1. **Track flags.** What the track `attribute` bits mean (values seen: 0, 1, 2, 6).
2. **Transform units.** How the inspector's Position / Scale / Rotate values map to `clip.transform`, `clip.scale` and `clip.rotation` in the draft, and where they land in a rendered frame. This includes the direction of the y-axis.
3. **Text size.** How CapCut's font-size unit maps to pixels.

It takes about 5 minutes. Nothing is written to CapCut's folders by OpenRip; we only read the draft afterwards.

## Steps

0. Generate the marker image once: `bench/calibration/make-assets.sh` → `bench/calibration/marker.png` (a 400×400 red square with a white centre block and a green top-left corner).
1. In CapCut, create a new project named **`openrip-calibration`**. Set it to **16:9 (1920×1080), 30 fps**.
2. **Marker (0–2 s):** import `marker.png` and put it on the main track from 0 s to 2 s. Select it, and in the inspector set **Scale 50%**, **Position X 200, Y 100**, **Rotate 30°**. Leave everything else at its default.
3. **Text (2–4 s):** add a default text clip from 2 s to 4 s. Don't change its style, size or position.
4. **Track flags (4–6 s):** put `spikes/frame-transport/media/test-4k60-hevc.mp4` on **three separate overlay tracks**, each from 4 s to 6 s. On the first of those tracks click **mute**, on the second **hide**, and on the third **lock**.
5. Export: **1080p, 30 fps, H.264**, into `bench/calibration/out/` (create the folder).

Then tell Claude it's done. It will read the `openrip-calibration` draft and measure the exported frames at 1 s (marker) and 3 s (text).

## Results

_To be filled in after the session._
