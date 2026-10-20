# CapCut desktop UI spec (measured reference for OpenRip's editor)

Reference build: CapCut 9.5.0 for macOS, captured 2026-10-18. This spec is for agents building OpenRip's CapCut-style editor (ROADMAP Phase 4). Read it together with the screenshots it cites.

**Legal line (ROADMAP Phase 4).** Copy layout, proportions, interaction patterns and workflows only. Never ship CapCut's name, logos, icons, effects, music, fonts, templates, stickers or any other bundled content. Use openly licensed assets (OFL fonts, CC0/CC-BY media) and OpenRip's own icon set. CapCut colour values below are for reference: OpenRip uses its own accent in place of CapCut's cyan, and its own palette tokens.

## 0. How to read this spec

- **Screenshots** live outside the repo in `~/CapCut-Reference/` and stay local. Paths below are relative to that folder, for example `03-editor-overview/003-base-timeline-built.png`. `manifest.csv` there says how each state was reached. Ignore `_redundant/`, `_diagnostics/` and `_tools/`.
- **Units.** Each capture is a full-screen Retina PNG, 3024×1964 device px. Every number here is in **logical px** (device px ÷ 2), measured with PIL by scanning pixel rows and columns for colour changes. The CapCut window is at logical (0,33) and is 1512×949. Coordinates are screen coordinates: x from the screen's left edge, y from the screen's top edge. The window's content starts at y=33. A 1 px light outline (#2b2b2b, macOS) runs round the window. A few captures (the 004–006 layout presets) have the window 1 px lower.
- **Half pixels.** CapCut draws hairlines one device px wide, which is 0.5 logical px. Use `0.5px` borders on Retina, or `1px` with a darker colour on 1x screens.
- **Colours** are sRGB hex sampled from the PNGs. Text colours are the core (most saturated) pixel of a glyph, so treat them as ±3.
- **Type sizes** are estimated from glyph heights (SF Pro cap height ≈ 0.705 em, ascender ≈ 0.74 em). They can be off by about 0.5 px. OpenRip uses the system UI font (SF Pro on macOS); CapCut's UI face is very close to it.
- **Scope marks** in section 6: **OOS** means out of scope (AI/ML, cloud, account or payment, sharing/publishing, or CapCut content). OpenRip status is **has**, **partly** or **missing**, judged against `docs/inventory/current-app.md` and `apps/app/packages/renderer/src/components`.
- **Short references.** Outside section 6, a bare `001`, `002` or `003` means `03-editor-overview/001-empty-editor.png`, `002-three-media-imported.png` or `003-base-timeline-built.png`. A bare file name right after a full path is in that path's folder. In section 6, each subsection names its folder.
- **Private content.** The captures show filenames, project names and caption text from the user's machine. Don't transcribe them into code, fixtures or docs.

## 1. Window layout grid (editor)

### 1.1 Default preset at 1512×949

Reference: `03-editor-overview/003-base-timeline-built.png` (also `001-empty-editor.png`, `002-three-media-imported.png`; all three have the same grid).

The window has a dark background, `bg.window`. Four rounded panels float on it with even gaps: left panel, player, inspector, and a full-width timeline below. The top bar is not a panel: it is window background with controls on it.

| Region | x (from–to) | y (from–to) | Size | Share |
|---|---|---|---|---|
| Window outline (macOS) | 0–1512 | 32–982 | 1 px #2b2b2b | – |
| Top bar (title bar) | 1–1511 | 33–68 | 35 px tall | 3.7% of window height |
| Outer margin, left/right | 1–9, 1503–1511 | – | 8 px | – |
| Left panel | 9–526 | 68–564 | 517 × 496 | 34.6% of content width |
| Gutter | 526–533 | – | 7 px | – |
| Player | 533–1106 | 68–564 | 573 × 496 | 38.4% |
| Gutter | 1106–1113 | – | 7 px | – |
| Inspector | 1113–1503 | 68–564 | 390 × 496 | 26.1% |
| Gutter between top row and timeline | – | 564–570 | 6 px | – |
| Timeline | 9–1503 | 570–972 | 1494 × 402 | full content width |
| Outer margin, bottom | – | 972–980 | 8 px | – |

"Content width" is the 1494 px between the outer margins. In the 904 px between the top bar and the bottom margin, the top row takes 54.9%, the gutter 0.7% and the timeline 44.5%.

Panel anatomy, the same for all four panels:

| Part | Value |
|---|---|
| Corner radius | 8 px (16 device px; measured on the left panel's top-left and the timeline's bottom-left corners) |
| Border, shadow | none; the gutters show `bg.window` between panels |
| Header strip (left-panel tabs, player title, inspector tabs) | 41.5 px tall, `bg.header` #303030, then a 0.5 px hairline #070709. Body starts 42 px below the panel top |
| Timeline toolbar | 32 px tall on `bg.panel` #262626 (no separate header colour), then a 0.5 px hairline #070709 |
| Body | `bg.panel` #262626 |
| Internal column divider (left panel: secondary sidebar to content) | 0.5 px #070709, full body height |

Top bar contents (y centre 50.5):

| Element | x | Size | Notes |
|---|---|---|---|
| macOS traffic lights | 14, 36, 58 (left edges) | 12 px circles, 10 px apart | centre y 50 |
| Autosave status "Auto saved: hh:mm:ss" | 82 | 12–13 px text, #949494 | absent in an empty project (`001`) |
| Project title | centred on the window (≈756) | 12–13 px semibold, #fafafa | click to rename |
| Layout switcher icon + chevron | 1230 (icon 18×14), 1254 (chevron 6×4) | – | opens the layout menu, §1.3 |
| Second icon (shortcuts/keyboard) | 1268 | 18×14 | – |
| "Ultra" button | 1296 | 59 × 22, #3b3b3b | OOS (subscription) |
| "Share" button | 1363 | 62 × 22, #4f4f4f | OOS (publishing) |
| "Export" button | 1433 | 67 × 22, accent fill #57becb, white icon and label | right edge 11 px from the window edge |

### 1.2 What flexes

Every capture is at the same window size, so resize behaviour isn't shown directly. The presets (§1.3) and the layout menu's "Reset current layout" item show this much:
- The inspector holds at about 368–390 px in every preset. The left panel and player take what's left.
- The timeline always spans whatever columns are not full height.
- Panel sizes in a preset can be changed and reset, so the gutters are drag handles (CapCut desktop resizes panels by dragging gutters; the captures show no cursor).

Recommended for OpenRip:
- Keep the gutters (7 px vertical, 6 px horizontal) as splitters.
- Defaults are the Default-preset numbers as fractions: left 0.346, player 0.384, inspector 0.261 of content width; top row 0.549 of content height.
- Minimums: inspector 360, left panel 360, player 400, timeline 200 px.
- On window resize, the player and timeline absorb changes first; the inspector keeps its pixel width.
- Store sizes per preset and add "Reset current layout".

### 1.3 Layout presets

Reference: `04-top-bar/001-layout-menu-default.png` (menu), `03-editor-overview/004-media-layout.png`, `005-attributes-layout.png`, `006-vertical-layout.png`. Also listed in the macOS menu (`00-menu-bar/003-layout-submenu.png`).

The layout menu drops from the top-bar layout icon. Items: Default, Media, Attributes, Vertical, separator, "Reset current layout". A check marks the current one.

Measured panel rectangles (logical px; in these three captures the window sits 1 px lower, so the top bar is y 34–69):

| Preset | Full-height column | Left panel | Player | Inspector | Timeline |
|---|---|---|---|---|---|
| Default | none | x 9–526 (517), top row | x 533–1106 (573), top row | x 1113–1503 (390), top row | x 9–1503, y 570–972 |
| Media | left panel, x 9–494 (485), y 69–973 | – | x 501–1128 (627), y 69–557 | x 1135–1503 (368), y 69–557 | x 501–1503 (1002), y 563–973 |
| Attributes | inspector, x 1135–1503 (368), y 69–973 | x 9–458 (449), y 69–557 | x 465–1128 (663), y 69–557 | – | x 9–1128 (1119), y 563–973 |
| Vertical | player, x 1105–1503 (398), y 69–973 | x 9–723 (714), y 69–557 | – | x 730–1098 (368), y 69–557 (inspector sits between left panel and player) | x 9–1098 (1089), y 563–973 |

In all three alternative presets the top row is 488 px and the timeline 410 px; in Default they are 496 and 402. Gutters stay 7 px between columns and 6 px between rows. In Vertical, a portrait (9:16) project fills the tall player much better; that's the point of that preset.

OpenRip today has three presets (default, media column, properties column) in `bars/Topbar.tsx`: **partly** (Vertical and "Reset current layout" are missing).

## 2. Colour roles

CapCut's palette is a near-neutral dark grey ramp plus one cyan accent. Sampled values:

### 2.1 Surfaces, borders, text

| Role (suggested token) | CapCut value | Where sampled |
|---|---|---|
| `bg.window`: window, top bar, gutters | #141414 | `003` gutters and top bar |
| `bg.panel`: panel body, timeline body, dialog body | #262626 | all panels; dialogs (`31-dialogs/038-linkage-settings.png`) |
| `bg.header`: panel header strips, menu and popover surface, inspector footer | #303030 | tab rows, layout menu, Details footer (`001`) |
| `bg.sunken`: numeric fields, text inputs, segmented-control track, search field | #1c1c1c | inspector fields and sub-tab track (`003`) |
| `bg.raised`: selected segment, stepper buttons, align-button group, cards, drop zone, chips | #3b3b3b (sidebar group buttons #3a3a3a) | `003` inspector; `001` import drop zone; linkage cards |
| `bg.button.secondary`: secondary buttons (Share, Cancel, Reset, Delete, Modify), selected chips | #4f4f4f | top bar, linkage and crop dialogs |
| `bg.hover`: menu-row hover, hovered list rows | #404040 | context menus, player header menu |
| `bg.field.form`: inputs and dropdowns in dialogs and forms (Project settings, Captions form) | #343337 fill, #29292d border | `17-inspector-project/001-project-settings-details.png`, `11-left-captions/001-auto-captions-default.png` |
| `bg.toggle.on`: chip behind an active timeline toggle | #1b1b1c | timeline toolbar in `003` |
| `bg.track`: timeline track row band (between 2 px track gaps of `bg.panel`) | #292929 in the clip area, #2a2a2a in the track-header column | `03-editor-overview/005-attributes-layout.png` |
| `border.hairline`: header underline, sidebar/content divider, toolbar underline | #070709 at 0.5 px | `003` |
| `border.divider`: section dividers in the inspector, Details groups | #373737 at 1 px | `003`, `001` |
| `border.menu`: popover/menu outline | 0.5 px #000000 outside, 0.5 px #494949 inside | `04-top-bar/001-layout-menu-default.png` |
| `border.dashed`: empty drop zones | dashed ≈ #3e3e3e (timeline), #525252 (media drop zone) | `001` |
| `text.strong`: titles, values, selected segment, button labels | #fafafa to #ffffff | project title, selected sub-tab, field values |
| `text.primary`: tab labels, property labels, menu items, clip labels | #e0e0e0 | left tabs, inspector tabs, clip chips |
| `text.secondary`: unselected segment labels, empty-state copy | #cccccc | sub-tabs, timeline empty state |
| `text.tertiary`: autosave status, card labels, descriptions, shortcuts | #949494 | top bar, media cards, menus |
| `text.muted`: empty-state copy in lists, popover section heads, Details labels | #6c6c6c (Details labels #7a7a7a) | `05-left-media/013-yours-favorites-empty.png`, `001-empty-import-dropdown.png` |
| `text.ruler`: ruler labels | ≈ #6c6c6c; major ticks #727272, minor ticks #404040 | `003` ruler |
| `text.disabled`: disabled transport and timecode, dimmed icons | #3e3e42 to #525252 | `001` player bar with no media |
| Scrim behind modal dialogs | black at about 40% (Linkage settings) to 60% (Crop, Settings) | `31-dialogs/038-linkage-settings.png`, `31-dialogs/039-crop-dialog.png` |

### 2.2 Accent

CapCut's accent is cyan **#57becb** (hover/pressed variants not sampled; the text-on-accent colour is #fafafa). OpenRip should define a single `accent` token of its own and use it in exactly these roles:

| Role | Where CapCut uses it | Reference |
|---|---|---|
| Selected tab (left-panel icon + label, inspector tab label) | text and icon colour only; no underline, no fill | `003` ("Text" tab, "Video" tab) |
| Selected secondary-sidebar item | label colour (item keeps its #3a3a3a fill) | `001` ("Media"), `03-editor-overview/004-media-layout.png` ("For You") |
| Current timecode in the player bar | colour of the current time; total time stays #e0e0e0 with a #404040 slash | `003` |
| Primary button fill | Export, Done, Confirm, Save (secondary buttons such as Cancel, Reset, Delete, Modify are #4f4f4f) | top bar, `31-dialogs/038-linkage-settings.png`, `31-dialogs/039-crop-dialog.png` |
| Toggle on, checkbox on | track/box fill; knob and tick are white | Uniform scale toggle, Blend checkbox in `003` |
| Active timeline toggles | accent glyph on a #1b1b1c chip | magnet, snap, linkage in the timeline toolbar (`003`) |
| Check mark in menus | the tick before the current item | layout menu |
| Keyframe diamond (active) and markers | fill | `30-timeline-toolbar/029-scale-keyframe-graph.png`, `030-marker-edit-popover.png` |
| Import "+" badge in the empty media drop zone | 18 px filled circle | `001` |

### 2.3 Timeline clip colours

These are CapCut's measured colours. OpenRip keeps the system (a hue per clip kind, every body at about the same darkness, the label chip a tint of the body) but draws its own hues, a family around its lavender accent (decided 2026-10-18): video #322c4c, sound from a video #2c2846 with a #7a6cc0 waveform, music #22305a with #5a78c4, text #8a4560, filter #483f8e, effect #7a4886, sticker #c08a3e, adjustment #9c8848. They live in `renderer/src/lib/timeline-colors.ts`.

Best reference: `31-dialogs/038-linkage-settings.png`, which shows one swatch per clip type, plus the timelines in `005-attributes-layout.png` and `030-marker-edit-popover.png`. Each clip has a body colour and a label chip that is the body with about 8–10% white over it.

| Clip type | Body | Label chip | Notes |
|---|---|---|---|
| Video, photo, overlay (main track and overlay tracks) | #1e4c51 (#1d4950 on audio) | #2f5e63 / #2f5b62 | Thumbnails fill the middle band. Audio extracted from a video keeps the teal (#1d4950), waveform #33757d |
| Audio (music library) | #182f55 | #2e4466 | waveform in a lighter blue (from the Linkage legend) |
| Sound effects | #34466c | #48597b | |
| Text-to-speech audio | #15394a | #294d5c | OOS feature, colour listed for completeness |
| Text, text template, caption | #924e3c | #9c604f | captions add a caption glyph before the label |
| Sticker | #cc9641 | #d1a051 | on the timeline a sticker clip shows the sticker image instead of a text chip |
| Video effect | #6e4c7f | #7c5e8c | |
| Filter | #464186 | #595493 | |
| Adjustment layer | #a58744 | #af9355 | |
| Transition | not a bar: a translucent light-grey rounded handle ≈16 px wide, the full clip height, centred on the cut between two clips | | `30-timeline-toolbar/030-marker-edit-popover.png` (main-track cut) |
| Clip label text | #e0e0e0 on the chip | | |
| Selected clip | 1.5 px white (#ffffff) outline round the whole clip | | `003` main clip |
| Unselected clip edge | 0.5 px #373737 line top and bottom | | |
| Playhead | 1 px white line; head is a hollow white shield 10×14 px (2 px stroke) sitting in the ruler | | `003` |
| Ruler | labels ≈ #6c6c6c; major tick #727272 (1 × 10.5 px), minor tick #404040 (1 × 5.5 px) | | `003` |
| Marker | small flag in the ruler, colour picked from cyan (default), red, orange, green, purple | | `30-timeline-toolbar/030-marker-edit-popover.png` |

## 3. Typography

All sizes are logical px. Weights are judged by eye from stroke thickness. Use SF Pro (`-apple-system, BlinkMacSystemFont, "SF Pro Text"`), and turn on tabular figures (`font-variant-numeric: tabular-nums`) for every time, frame count, number field and ruler label.

| Role | Size | Weight | Colour | Reference |
|---|---|---|---|---|
| Project title (top bar) | 12–13 | semibold | `text.strong` | `003` |
| Autosave status | 12–13 | regular | `text.tertiary` | `003` |
| Left-panel tab label (under icon) | 11.5–12 | medium | `text.primary`; selected `accent` | `003` |
| Inspector top tabs (Video, Audio, Speed…) | 13 | semibold | `text.primary`; selected `accent` | `003` |
| Panel title (player "Player-Timeline 01") | 13 | regular | #ffffff | `003` |
| Segmented sub-tabs (Basic, Remove BG, Mask…) | 12 | regular | selected `text.strong`, others `text.secondary`–`text.primary` | `003` |
| Section header in inspector (Transform, Blend…) | 12 | semibold | `text.primary` | `003` |
| Group subhead inside a section (Color, Lightness) | 12 | regular | `text.tertiary` | `25-inspector-adjustment-layer/003-basic-color.png` |
| Helper/description text | 12 | regular | `text.tertiary` | `20-inspector-audio/001-basic-volume-fades.png` |
| Property label (Scale, Position…) | 12 | regular | `text.primary` | `003` |
| Property value in a numeric field | 12 | regular, tabular | `text.strong`–`text.primary` | `003` |
| Details field label / value | 12 / 13 | regular | #7a7a7a / #cccccc | `001` |
| Secondary-sidebar item | 12 | semibold | `text.primary`; selected `accent` | `001` |
| Menu item | 13 | regular | `text.primary`; disabled `text.disabled` | layout menu, context menus |
| Two-line menu item (quality menu) | 13 semibold title + 12 description | – | `text.strong` / `text.ruler` | `16-player/004-quality-menu.png` |
| Menu shortcut | 12–13 | regular | `text.tertiary` | context menus, §4.13 |
| Button label (Export, Done, Confirm, Cancel) | 13 (12 in 20 px footer buttons) | semibold | `text.strong` | top bar, dialogs |
| Player timecode | 12 | regular, tabular (≈7 px digit pitch) | current `accent`, total `text.primary` | `003` |
| Ruler label ("00:05") | 10.5–11 | regular, tabular | `text.ruler` | `003` |
| Clip label (name, duration) | 11–12 | regular | `text.primary` on chip | `003` |
| Library card label | 11–12 | regular | `text.tertiary` | `05-left-media/004-media-added-badges.png` |
| Badge text ("Added", duration on card) | 10–11 | regular | `text.primary` | `05-left-media/004-media-added-badges.png` |
| Track header glyphs | icons only (no text) | – | #5e5e5e to #d8d8d8 | `003` |
| Dialog title | 12–13 | semibold | `text.strong` | `31-dialogs/038-linkage-settings.png`, `31-dialogs/016-export-video-settings.png`, `02-settings/001-draft.png` |
| Empty-state copy | 12–13 | regular | `text.secondary` (timeline), #6c6c6c (library lists) | `001`, `05-left-media/013-yours-favorites-empty.png` |
| Empty-state title (inspector) | 16 | semibold | #ffffff | `18-inspector-video/023-audio-separated-state.png` |

Timecode format is `HH:MM:SS:FF` (frames after the last colon), for example `00:00:06:08 / 00:00:34:14`. The ruler shows `MM:SS` labels on major ticks.

## 4. Components

Measurements are logical px at the Default layout unless a screenshot says otherwise. "Panel-left" means the panel's left edge (for the inspector, x=1113).

### 4.1 Top bar

Reference: `03-editor-overview/003-base-timeline-built.png`, `04-top-bar/001-layout-menu-default.png`.

- 35 px tall, `bg.window`, no bottom border; panels start right under it.
- Left: traffic lights (macOS), then the autosave status at x=82.
- Centre: the project title, 12–13 px semibold, centred on the window, not on the free space.
- Right, from the right edge inwards, 11 px inset: Export (67×22, accent, white upload glyph + label, radius ≈4), Share (62×22, #4f4f4f, OOS), Ultra (59×22, #3b3b3b, OOS). Then a 18×14 keyboard/shortcuts glyph at x=1268 and the 18×14 layout glyph with a 6×4 chevron at x=1230–1261. Buttons are 7–8 px apart; glyphs are #949494.
- OpenRip: drop Ultra and Share, keep Export, the layout menu and a shortcuts entry. Put the project switcher on the title (OpenRip's Topbar already has rename and a switcher).

### 4.2 Left panel tab row (icon over label)

Reference: `003`, `001` (Media selected), `06-left-audio/001-audio-default.png` (Audio selected).

| Property | Value |
|---|---|
| Row height | 41.5 px (the panel header strip), `bg.header` |
| Tab width | content-sized: label width + ≈8 px, minimum ≈49 px; tabs touch (no gap). Measured label centres at x 33, 81.5, 131, 179, 229, 283.5, 339, 389.5, 445.5 |
| Icon | 16–17 px line glyph, top at y=75 (7 px under the panel top), centred over the label |
| Label | 11.5–12 px medium, top at y=94, baseline ≈102.5; 4 px gap from icon bottom to label top |
| Unselected | icon and label `text.primary` #e0e0e0 |
| Selected | icon (filled variant of the glyph) and label `accent`; no underline, no background |
| Overflow | tabs clip at the right and a 12×19 scroll button (#4f4f4f, radius ≈3, #cccccc chevron) sits at the right end (x 508–520); once scrolled, a matching left button appears |
| Order | Media, Audio, Text, Stickers, Effects, Transitions, Captions, Filters, Adjustment, Templates, then AI tabs (AI avatar…) past the scroll button (`006-vertical-layout.png` shows the full row: …Adjustment, Templates, AI avatar) |

### 4.3 Secondary sidebar column

Reference: `05-left-media/004-media-added-badges.png`, `001-empty-import-dropdown.png`, `14-left-templates/001-editor-templates-default.png`, `03-editor-overview/004-media-layout.png`.

| Property | Value |
|---|---|
| Column | x 9–129 (120 px) inside the left panel, then a 0.5 px #070709 divider; content area x 129.5–526 (396.5 px) |
| Item | x 17–121 (104 wide, 8 px inset each side), 24 px tall, 32 px pitch, first item at y 126 (16 px under the header), radius ≈4, label inset ≈9 |
| Label | 12–13 px semibold, `text.primary` |
| Group header (has children, chevron ▾/▴ at the right) | `bg.raised` fill; an expanded group's label turns `accent` with a ▴ chevron |
| Top-level single item | `bg.raised` fill |
| Child item, unselected | no fill, `text.primary` |
| Selected item | `bg.raised` fill, `accent` label |
| Badge | a small cyan "AI" corner tag on AI groups (OOS) |
| One open group | only one group is expanded: the one holding the selection, or the one last opened. Opening a folded group selects its first section and folds the open one |
| Overflow | everything down to the open group's heading stays at the top and whatever follows the group stays at the bottom ("Sounds effects", "Copyright", "Shapes" sit on the panel's bottom edge, 16 px above it); only the open group's sections scroll between them, the last visible one fading out. Long labels end in an ellipsis ("Sounds effe…") |
| OpenRip | 132 px column: SF Pro semibold is wider than CapCut's UI font, and at 120 px "Add adjustment" and "Video effects" (beside its chevron) don't fit |

Media tab tree: Import ▴ (Media, Subprojects), Yours ▾ (Favorites, My presets, Brand assets), Generate ▾ (AI), Spaces ▾ (cloud), Library ▾ (stock), Dreamina (AI). OpenRip keeps Import (Media, Subprojects) and Yours (Favorites, My presets) only.

### 4.4 Media/library toolbar

Reference: `05-left-media/004-media-added-badges.png`, `007-media-sort-menu.png`, `008-media-filter-menu.png`, `009-media-list-view.png`, `010-record-hover.png`, `011-media-search-open.png`, `001-empty-import-dropdown.png`.

| Element | Value |
|---|---|
| Row | y 123–147 (24 tall), content-left + 12 (x 141.5) to content-right − 12 |
| Import | 72×24, `bg.raised`, dashed #4f4f4f border, radius ≈4, accent circle "+" glyph (white +) and "Import" 12 px medium. Opens a menu (186 wide): From device, From library (OOS) |
| Record | 63×24, `bg.raised`, camera glyph + "Record"; hover fill #4f4f4f |
| Right group (icons #d4d4d4, 1 px #404040 separators 12 tall between them) | search · grid/list toggle · sort ▾ · filter ▾. An open or active icon gets a #3f3f3f square behind it |
| Search open | a 331×24 field replaces Import and Record: fill #121212, 1 px #515151 border, radius ≈4, placeholder "Search media"; the filter stays on its right |
| Sort menu (155 wide) | Time imported, Time created, Name, Type, Duration · separator · Latest to earliest, Earliest to latest (accent ticks on the current choices) |
| Filter menu | All, Video, Audio, Image |
| Group heading under the toolbar | "All" (or category name) 12 px `text.primary` at y≈161 |
| Library pages (stock, effects, filters…) | search field at the top, then category chips or a sidebar; a funnel filter (All/Commercial, OOS) on the right |

### 4.5 Library item cards

Reference: `05-left-media/004-media-added-badges.png`, `005-media-item-hover.png`, `002-prores-imported.png`, `009-media-list-view.png`, `09-left-effects/047-classic-item-hover.png`, `048-download-hover.png`, `10-left-transitions/018-item-hover.png`, `12-left-filters/033-item-hover.png`, `06-left-audio/025-music-item-hover.png`, `026-music-item-context.png`.

**Media card (imported files):**

| Property | Value |
|---|---|
| Thumbnail | 120×80 fixed, `bg.raised` behind a letterboxed frame, radius ≈4. Columns at x 141.5 and 277.5 (16 px gap); at the Default width only two fit, the grid wraps; row pitch 112 |
| Label | 4 px under the card, one line with a middle ellipsis ("abc…xyz.mp4"), 11–12 px `text.tertiary` |
| Proxy tag | inline before the label: 26×14, #cccccc fill, black text |
| "Added" badge | top-left, 4 px inset, ≈34×14, #141414 (slightly translucent) fill, `text.primary` 10–11 px, radius ≈2. Means "used on the timeline" |
| Duration | top-right, ≈6 px inset, `text.primary`, no fill ("00:12") |
| Hover | an 18 px accent circle with a white "+" at the bottom-right, 4 px inset (adds to the timeline at the playhead) |
| Selected | 1.5 px accent outline, plus white range handles centred on the left and right edges (the card becomes an in/out range picker) |
| List view | rows 372 wide, a 46 px filmstrip with the label under it, 78 px pitch |

**Effect, transition, filter, sticker, text-style tiles:** 86×86, radius ≈6, `bg.raised`, three columns on a ≈102 px pitch starting at x 143.5. With a name, the label sits 6 px under the tile (12 px `text.tertiary`, ellipsis) and rows are 116 px apart; without, ≈100. Hover shows two dark translucent 18 px circles at the bottom-right (favourite star, download), 4.5 px apart. Downloaded items swap download for "+". Hovering the download circle shows no extra change in the captures.

**Audio rows:** 370×48 on a 60 px pitch, `bg.raised`, 32×32 cover at 8 px padding, title 12 px semibold `text.primary`, second line "artist · m:ss" 11 px `text.tertiary`; right side two 16 px circular buttons (#1d1d1d: favourite, download or "+"). The previewing row gets a 1.5 px accent outline and a loading ring in place of download.

**Context menu on a media card** (`006-media-item-context-menu.png`, ≈238 wide): Rename, Delete, Open file location, New folder with selected item, New timeline with selected item, Cancel file proxy, Export selected clips, Create multi-camera clip (disabled), Link to media (disabled), Split scenes (AI), Transcript (AI).

### 4.6 Player

Reference: `003`, `001` (empty), `16-player/*`.

| Part | Value |
|---|---|
| Header | 41.5 px `bg.header` + hairline. Title "Player-" + the timeline's name, 13 px #ffffff at panel-left + 12.5. Menu glyph (three 1 px lines, 13×10.5, #67676f) at panel-right − 16.5 |
| Canvas area | panel body between header and bottom bar (y 110–≈520 in Default); background is `bg.panel` #262626, no separate letterbox colour. The frame is centred and fitted |
| Selected-clip overlay | thin white bounding box with small round corner handles on the video in the canvas (`003`) |
| Bottom bar | ≈44 px tall, no divider, controls centred on y=542 (22 px above the panel bottom) |
| Timecode | at panel-left + 8.5: current `HH:MM:SS:FF` in `accent`, a #404040 "/" with 4 px either side, total in `text.primary` at x 618.5; 12 px tabular. Each timecode block is ≈64 px wide |
| Audio level meter | stereo meter 22×16 at x 694: two grey (#373636) bar columns when idle, green bars while playing (`16-player/002-guides-rulers-menu.png`) |
| Play/pause | 10×12 glyph, centred on the player (x≈820), #cecece |
| Right group (right to left, ≈30–35 px pitch) | fullscreen (13×13) at panel-right − 8.5; "Ratio" boxed-text button (27.5×12); zoom/fit glyph (17×17); "Full" boxed-text quality button (19.5×12); a 14×16 glyph that toggles a branded social-platform overlay (OOS; the capture summary found no generic safe-area control) |
| Disabled (no media) | timecode and all controls drop to #3e3e42–#525252 (`001`) |

Player menus and modes:

| Item | Layout | Reference |
|---|---|---|
| Header menu | 200 px wide, 32 px rows, 13 px `text.primary`, `›` for submenus; hover row #404040 (28 tall, inset 4.5, radius ≈4). Items: Color oscilloscope ›, Guides and rulers ›, Export still frames | `16-player/001-header-menu.png`, `002-guides-rulers-menu.png` |
| Quality menu ("Full") | 329 px wide, 46 px two-line rows: 13 px semibold title + grey description, accent tick at x+14, text at x+42. Full quality (original resolution), High, Medium, Low ("smoother playback, no impact on exported video") | `004-quality-menu.png` |
| Zoom popover | 180×37 `bg.header` popover: zoom-out glyph, slider, zoom-in glyph. While zoomed, a mini navigator thumbnail appears at the canvas's bottom-right | `005-zoom-popover.png` |
| Ratio menu | 180 px wide, 28 px rows, 1 px #434343 separators, a small aspect-shape glyph at the right of each row: Original ✓, Custom · 16:9, 4:3, 2.35:1, 2:1, 1.85:1 · 9:16, 3:4, 5.8-inch, 1:1 | `006-aspect-ratio-menu.png` |
| Guides | 1 px accent guide line across the canvas; right-click a guide: Edit guide, Delete guide; Edit guide opens a small dialog (units Pixels/Percent, position) | `003-horizontal-guide.png`, `008-guide-context-menu.png`, `31-dialogs/014-edit-guide-dialog.png`, `015-guide-units-menu.png` |
| Rulers | ≈16 px bands along the top and left edges of the canvas area, ticks #404040, labels #767676 in project pixels with 0 at the canvas centre (e.g. −2200 … 2200 across, 1400 … −1400 down); drag from a ruler to make a guide | `010-rulers-visible.png` |
| Scopes | canvas shrinks to the top part (y 111–364); three black scope panels below (y 368–495, ≈182 wide, 5 px apart, 8 px inset): RGB parade, waveform, vectorscope, scales 0/512/1023 | `009-color-oscilloscope.png` |
| Fullscreen | whole screen #292929 behind the frame; a floating 556×44 rounded bar (#0a0a0c) near the bottom with play, timecodes (accent/white), a scrub track with accent fill and a 6 px white dot, and an exit button | `007-fullscreen-preview.png` |


### 4.7 Inspector tab rows

Reference: `003`, `001` (Details), `18-inspector-video/*`.

**Top tabs.** On the 41.5 px header strip. Text-only labels, 13 px semibold, `text.primary`; selected `accent`, no underline. First label at panel-left + 11; 26–27 px gaps between labels (label starts 1124, 1182.5, 1241.5, 1304, 1387, 1449.5). A 12×20 scroll button (#4f4f4f, #cccccc chevron) at the right end when tabs overflow; a matching left button appears once scrolled (`18-inspector-video/024-ai-stylize-form.png`). Video clip tabs: Video, Audio, Speed, Animation, Adjust, AI stylize (clipped).

**Sub-tabs (segmented control).** Directly under the header, top at y=123 (13 px below the hairline):

| Property | Value |
|---|---|
| Track | x panel-left+12 to panel-right−12 (366 px at Default), 24 px tall, `bg.sunken` #1c1c1c, radius ≈4–6 |
| Segments | equal widths (4 × 91.5 px for Basic, Remove BG, Mask, Retouch) |
| Selected segment | `bg.raised` #3b3b3b, radius ≈4, label `text.strong` |
| Unselected | no fill, label `text.secondary` #cccccc |
| Below | a 1 px `border.divider` at y≈158, 11 px under the track |

**Nothing selected.** The inspector shows a single "Details" tab (accent) with project fields as a label/value grid: labels 12 px #7a7a7a at panel-left + 12.5, values 13 px #cccccc at panel-left + 152, 32 px row pitch, groups split by a `border.divider`. A 36 px `bg.header` footer holds a "Modify" button (72×20, #4f4f4f) at panel-right − 12 (`001`, `17-inspector-project/010-details-empty.png`).

### 4.8 Property rows (inspector)

Reference: `003` (Video › Basic), `25-inspector-adjustment-layer/003-basic-color.png`, `21-inspector-text/004-basic-default-text.png`.

Measured on Video › Basic in `003`:

| Element | Value |
|---|---|
| Content inset | 12 px from both inspector edges (x 1125 to 1491) |
| Section header (Transform, Blend, Stabilize…) | 12 px semibold `text.primary`, followed by a small ▲/▼ disclosure caret; optional 12×12 checkbox before the title when the section can be switched on/off. Right end: reset glyph (↺, ≈13 px) then keyframe navigator `‹ ◇ ›` (≈30 px wide) |
| Collapsed section pitch | 55 px from divider to divider; header text centred; 1 px `border.divider` between sections |
| Property label column | label at x=1125 (panel-left+12); controls start 104–120 px later: x=1245 in Video › Basic (Position, Rotate), x=1229 in Text › Basic. Use one 112 px label column in OpenRip |
| Label-over-slider rows (Scale, Opacity) | label line, then a full-width slider on the next line (label top y 215.5, slider centre y 238) |
| Inline rows (Uniform scale, Position, Rotate) | 38–39 px pitch |
| Slider | track 2 px, #404040, filled part #fafafa (white, not accent), from x 1125 to 1365 (240 px) when a keyframe navigator follows, to 1401 when not; thumb a white rounded rect 8×12. Bipolar sliders (Temp, Exposure…) show no fill at 0 and may have a centre tick; colour sliders use gradient tracks |
| Numeric field | 54×22 at x 1383–1437 (18 px after the slider end), `bg.sunken`, radius ≈4, value 12 px tabular `text.strong` with unit ("100%", "0.00°", "0.5s") |
| Stepper | 16×22 `bg.raised` button with ▲▼ glyphs, 2 px right of the field |
| Keyframe navigator | at x 1460–1490: ‹ (5 px glyph), diamond (≈9 px outline, #565656 → white on hover, accent when a key exists at the playhead), › |
| X/Y pair (Position) | two 68×22 fields (x 1245–1313 and 1342–1410), each with a grey "X"/"Y" prefix inside and a 16 px stepper 6 px after it |
| Rotate | 68×22 field + stepper, then a ≈17 px round dial (#1c1c1c with a white tick) |
| Toggle | 36×16 pill; 8 px #fafafa knob inset 4 px; on = `accent` track, knob right; off = #4f4f4f, knob left; locked-on #253438 |
| Checkbox | 12×12, radius ≈2; off #515151, on `accent` with a white tick. Section title starts at x 1145 when a checkbox precedes it. Unchecked-but-expanded sections dim their rows to `text.disabled` |
| Dropdown | 22 px tall, `bg.raised` #3b3b3b, radius ≈4, value left, chevron right; spans the control column to x 1491 |
| Colour well | 84×22: #3b3b3b frame, 2 px inset swatch (64×18), 18 px chevron area |
| Segmented/toggle buttons (B, U, I; case TT/tt/Tt; text alignment) | 26×22 buttons on `bg.raised`, 12 px apart for B/U/I; grouped buttons share one 22 px rounded group |
| Multiline text box | full content width × 64, `bg.sunken`, radius ≈4, 12 px text; pinned at the top of Text › Basic while rows scroll |
| Panel footer | 36 px `bg.header` bar at the panel bottom with right-aligned 20–22 px buttons: primary "Save as preset" (≈88 wide, accent), secondary "Reset"/"Apply to all" (72–78 wide, #4f4f4f), disabled primary #253438 with grey text |
| Tile grid (presets, animations, masks, bubbles) | 60×60 tiles on #3b3b3b, 78 px pitch (92 when labelled underneath), "None" first, selected tile gets an accent outline; download/star badges on content tiles |
| Mixed value (multi-select) | field shows "-" |
| Alignment buttons | one `bg.raised` group, 294×22 at x 1125–1419: 6 align glyphs (left, centre-h, right, top, centre-v, bottom) + 2 dimmed distribute glyphs after a divider |

Rows below 22 px controls sit on a 38 px pitch; label-over-slider rows on a 43 px pitch. Group subheads inside a section ("Color", "Lightness", "Effects" in Adjust) are 12 px `text.tertiary`.

#### 4.8a Text › Basic

Reference: `21-inspector-text/004-basic-default-text.png` to `017-curve-controls.png`.

Order: text box (64 tall) · Font dropdown (244×22 at x 1229) + stepper · Font size slider · Pattern B/U/I · Case TT/tt/Tt · Color well + keyframe · Character spacing and Line spacing fields · Alignment (6 glyphs: 3 horizontal, 3 vertical) · Preset style grid ("Aa" tiles, 7 per row) · Transform (Scale, Uniform scale, Position, Plane rotation, align row) · checkbox sections Blend (Opacity only, no blend mode on text), Stroke (Color, Thickness), Background (2 style tiles, Color, Opacity, Rounded rectangle, Height, Width, Y-offset, X-offset), Glow (2 style tiles, Color, Intensity, Range, Y/X offset), Shadow (Color, Opacity, Blurriness, Distance, Angle), Curve (Strength, bipolar) · footer "Save as preset".

**Font popover** (`005-font-picker.png`): #303030 popover ≈258 wide, 25 px search field (`bg.sunken`), filter chips (20 px pills, selected #4f4f4f), section heads in #6c6c6c ("Recently used", "Presets"), 28 px rows with a check on the current font. OpenRip lists system and bundled OFL fonts here.

#### 4.8b Colour picker

Reference: `21-inspector-text/006-text-color-picker.png`, `007-color-format-menu.png`, `008-color-rgb-fields.png`.

Popover ≈246×376, `bg.panel`, 10 px padding: saturation/value square 226×120 (12 px ring handle) · eyedropper button 22×22 + hue bar 22 tall (17 px disc handle) · format dropdown (Hex / RGB, 52×22) + value field (170×22; RGB shows three fields) · "My colors" dropdown (226×22) · swatch grid, 16 px swatches on a 22.5 px pitch, 10 columns, "+" first to save the current colour, selected swatch ringed white. No alpha control.

#### 4.8c Colour grading (adjustment layer and video Adjust)

Reference: `25-inspector-adjustment-layer/*`.

- **Sub-tabs** Basic, HSL, Curves, Color wheel, Mask (segments sized to content here).
- **HSL** (`007-hsl-red.png`): eyedropper (24 wide) + 8 channel rings on a 40 px pitch (Red, Orange, Yellow, Green, Cyan, Blue, Purple, Magenta). Unselected = 23–24 px hollow ring (3.5 px stroke) in the channel colour; selected = 16 px filled disc with a 1 px white ring at 24 px. Then Hue, Saturation, Brightness sliders with gradient tracks.
- **Curves** (`015-curves-luma.png`, `029-curves-red-full.png`): one block per channel (Luma, Red, Green, Blue), each with a colour dot, eyedropper and reset; graph 366×244, background #070709, 4×4 grid in #202022, 1 px white curve with ring end points. No keyframes.
- **Color wheel** (`019-color-wheel-primary.png`, `021-color-wheel-mode-dropdown.png`–`023-color-wheel-log-bottom.png`, `030-primary-wheels-lower-controls.png`): mode dropdown Primary/Log, Intensity slider, four ≈120 px wheels in a 2×2 grid (hue ring ≈7 px, centre puck, side triangle handles, grey luminance arc), each with R/G/B fields (20 tall) under 4 px colour bars. Primary: Shadows, Middle grey, Highlights (labelled "Tint" in this build), Offset. Log: Shadow, Middle tone, Highlight, Offset.
- **Mask** (`024-multiple-masks.png`–`028-mask-tracking-bottom.png`): mask chips (24 px pills ≈112 wide; selected #4f4f4f), "+" add button, shape tiles (Split, Filmstrip, Circle, Rectangle, Text, Brush, Pen), Mask settings (invert, Position X/Y, Rotation, Size W/H with link, Feather, Round corners), Track mask (OOS).

### 4.9 Timeline toolbar

Reference: `03-editor-overview/003-base-timeline-built.png` (video selected), `001-empty-editor.png` (nothing selected), `30-timeline-toolbar/020-audio-context-menu.png` (audio selected), `026-selection-tool-menu.png`, `027-preview-axis-menu.png`, `31-dialogs/038-linkage-settings.png`. No toolbar tooltips were captured, so names are inferred from glyphs and menus.

Bar: y 570–602 (32 px) on `bg.panel`, then a 0.5 px #070709 hairline. Glyphs ≈16 px in ≈24–28 px hit targets on a 36 px pitch; normal #c9c9c9, disabled #575757. Group dividers are 1 px #3b3b3b, 16 px tall, at x 45.5, 106 and 447 (CapCut hangs the two right-hand dividers from the top edge; centre them in OpenRip).

| # | Control | Centre x | Notes |
|---|---|---|---|
| 1 | Add (+) | 25 | menu not captured |
| 2 | Selection tool ▾ | 66, chevron 88.5 | menu: Select (A), Split (B), Select leftward ([), Select rightward (]) (`30-timeline-toolbar/026-selection-tool-menu.png`) |
| 3 | Undo | 135 | |
| 4 | Redo | 171 | disabled when nothing to redo |
| 5 | Split at playhead | 207 | |
| 6 | Delete left of playhead | 243 | trims the selected clip's left part |
| 7 | Delete right of playhead | 278.5 | |
| 8 | Delete | 315 | |
| 9 | Add marker | 351 | marker popover, §4.12 |
| 10 | Crop | 387 | opens the Crop dialog (`31-dialogs/039-crop-dialog.png`) |
| 11 | Transform tools ▾ (corner triangle) | 423.5 | dropdown 238 px wide with 36 px rows, 16 px glyph + label: Freeze, Reverse, Mirror, Rotate (`30-timeline-toolbar/031-clip-transform-tools-menu.png`) |
| 12–18 | AI tool buttons (sparkle glyphs, "HD") | 473–689 | OOS; #12 is enabled for audio clips |
| 19 | Overflow chip "‹" | 730 | 12×20, #4f4f4f; hides 12–18 when space runs out |
| 20 | Record voiceover (mic) | 1073 | opens the voiceover panel (`31-dialogs/036-voiceover-panel.png`) |
| 21 | Main-track magnet | 1122 | toggle |
| 22 | Auto snap | 1158 | toggle |
| 23 | Linkage ▾ | 1194, dropdown 1213.5 | toggle; dropdown opens Linkage settings (`31-dialogs/038-linkage-settings.png`) |
| 24 | Preview axis ▾ | 1244, dropdown 1263.5 | toggle; menu: Preview video and audio / Preview video only (`30-timeline-toolbar/027-preview-axis-menu.png`) |
| 25 | Zoom to fit | 1307 | fits the whole timeline (`30-timeline-toolbar/037-timeline-fit-toggles-off.png`) |
| 26 | Zoom out | 1343 | |
| 27 | Zoom slider | track x 1367.5–1462.5 (95 px) | 2 px track, filled #e0e0e0, empty #404040, 8 px white thumb |
| 28 | Zoom in | 1487 | |

Toggle on: the glyph turns `accent` on a 24×23 #1b1b1c chip (radius ≈4); a toggle with a dropdown gets a 12 px #141414 segment attached on its right. Toggle off: grey glyph, no chip.

The toolbar adapts to the selection: nothing selected shows 1–9 and 12 with split and the delete-side buttons dimmed; audio shows 1–9 and 12; text, effect, filter and transition show 1–8; a sticker shows 1–8 plus Mirror; a video shows everything.

### 4.10 Track headers

Reference: `003`, `005-attributes-layout.png`, `30-timeline-toolbar/023-track-height-menu.png`, `024-track-waveform-size-menu.png`.

| Property | Value |
|---|---|
| Column | x 9–131.5 (123 px), then a 1 px #141414 divider at x 132. The same width in every preset |
| Cells | one per track, `bg.track` #2a2a2a, the track's height, separated by 2 px gaps of `bg.panel` |
| Glyphs | ≈12 px, centres at x 22.7 (track type), 46.8 (lock), 70.8 (eye), 95 (mute), 119 ("…" menu), 24 px apart, vertically centred. Type glyph #5e5e5e, controls #d8d8d8 |
| Text, effect, filter, adjustment, sticker, caption tracks | type, lock, eye |
| Video tracks (main and overlay) | type, lock, eye, mute, "…" |
| Audio tracks | type, lock, mute, "…" (no eye) |
| "…" menu | Track height › Short / Default ✓ / Tall; Audio waveform size › 30% ✓ / 60% / 100% (157 px wide) |
| Cover column | x 133–182.5 between the header and time 0; on the main track only, a 38–42 px dashed rounded "Cover" tile (#3b3b3b, edit glyph over "Cover" 11 px) opens the cover editor |
| Selected track | its band lightens to #2c2c2c with #333333 lines (`022-empty-space-context-menu.png`) |
| Many tracks | the overlay area scrolls on its own and the main track stays pinned below it, separated by a #070709 line |

### 4.11 Clip bars

Reference: `003`, `005-attributes-layout.png`, `30-timeline-toolbar/031-clip-transform-tools-menu.png`, `31-dialogs/038-linkage-settings.png`.

| Track / clip | Row | Clip height | Inner layout |
|---|---|---|---|
| Text, caption, sticker, effect, filter, adjustment | 24 px row + 2 px gap (26 pitch) | 22 | single band: type glyph (≈12 px) + label chip, 4 px left padding. Stickers show the sticker image instead of a text chip |
| Overlay video/photo | 52 px row + 2 px gap | 50 | label band 18 (chips: name, duration), thumbnail band 19, bottom band 13 (the clip's own audio waveform) |
| Main track video | 76 px band (#2f2f2f with #373737 lines top and bottom) | 74 | label band 17–18, thumbnail band 39, bottom band 16 (own audio waveform) |
| Audio | 50 px row + 2 px gap | 48 | label chip at top-left over the waveform; waveform bars #33757d on extracted audio (lighter tint of the clip colour), baseline #597f84 |

- Waveforms (measured on `003`'s extracted audio and `18-inspector-video/001`'s video band): bars 1 px wide every 2 px (2 device px on, 2 off), the first 1.5 px into the clip, rising from the clip's (or band's) bottom edge, drawn to half a pixel; no bar where the sound is under the floor. Each bar is the RMS of 2 px of sound on a dB scale: full × (1 + dB / 52) px, dB the RMS of the mono mix (the channels averaged; ffmpeg's `-ac 1` reads 3 dB louder), full 30.5 px on an audio clip at 30% and 13.5 px in the video's 16 px band; the audio clip's bars sit 2 px after their sound, the band's on it (fitted from the engine's buckets for IMG_9079 to `003`'s 214 bars: correlation 0.98, 0.8 px off on average; to `001`'s band: 0.976, 0.3 px). The 0.5 px line across (#597f84 on teal, about white at 27%) sits at 13 px on the audio clip and 6.5 px in the band for 0 dB. Music's bars are #3a7faf on #182f55 (the Linkage legend). A photo, or a video whose sound was extracted, has an empty bottom band. OpenRip draws all of this in its own colours (renderer/src/lib/timeline-colors.ts).
- Clip corner radius ≈3–4 px.
- Label chip: 14–16 px tall, radius ≈3, 4 px from the clip's top-left, padding ≈4 px; the clip colour with ≈7–10% white over it; effect, filter, adjustment, caption and template chips start with a 12 px type glyph; media clips add a second chip with the duration (`HH:MM:SS:FF`); 11–12 px `text.primary`.
- Thumbnails tile about every 50 px.
- Thumbnails: tiles at the clip's aspect, laid edge to edge across the band; photos repeat the still.
- Adjacent clips on one track touch with a 0.5–1 px dark seam.
- Selected clip: 1.5 px white rounded outline round the whole clip, including the bands; each end gets a ≈3 px white trim handle with a vertical dotted grip at mid-height. Split clips each get their own chips (`30-timeline-toolbar/028-split-video-state.png`).
- Transition: a translucent rounded handle, ≈16 px wide, full clip height, centred on the cut (`30-timeline-toolbar/030-marker-edit-popover.png`).
- Keyframe: a 9 px diamond on the clip at the key's time, accent with a dark outline (`30-timeline-toolbar/029-scale-keyframe-graph.png`).
- A selected clip with speed shows a "1.00x ▸" badge at its top-right (`30-timeline-toolbar/020-audio-context-menu.png`, `18-inspector-video/020-speed-standard.png`).
- Freeze frame inserts a separate clip labelled "Freeze" (default 3 s) at the playhead, splitting the source clip around it (`30-timeline-toolbar/033-freeze-frame-state.png`). A reversed clip shows no badge (`034-reversed-video-state.png`).
- A compound clip is one main-track clip with a compound glyph before its name chip; opening it replaces the timeline with the nested sequence and shows a "‹ Compound clip1" breadcrumb centred in the timeline toolbar (click ‹ to go back) (`28-inspector-compound/001-compound-basic.png`, `002-compound-open-timeline.png`).
- Dragging media in shows a translucent ghost clip with its name, and a thin accent line across the track area where a new track will be created (`30-timeline-toolbar/038-drag-to-timeline-preview.png`).
- Text with an In animation shows a thin white line with an arrowhead at the clip's bottom-left (`30-timeline-toolbar/022-empty-space-context-menu.png`).
- A 2 px #3a7faf bar sometimes runs under the main clip (probably render status; unconfirmed).
- "Cover" button: 42×42 rounded tile (#3b3b3b, edit glyph + "Cover" 12 px) in the 50 px gap left of time 0 on the main track (x 138–180).
- The empty timeline shows a dashed drop zone across the main track: 70 px tall, `bg.track` fill, film glyph and "Drag material here and start to create" 13 px `text.secondary` (`001`).

### 4.12 Ruler, playhead, markers and keyframe graph

Reference: `003`, `30-timeline-toolbar/029-scale-keyframe-graph.png`, `030-marker-edit-popover.png`.

| Part | Value |
|---|---|
| Ruler band | from the toolbar hairline (y 602.5) to ≈620; same `bg.panel` as the tracks |
| Time 0 | 50 px right of the track-header divider (x=183 at Default), leaving room for the Cover tile |
| Major tick | 1 × 10.5 px #727272, with a "MM:SS" label 4 px to its right, 10.5–11 px tabular `text.ruler`. At the default zoom, majors are every 5 s, 37.35 px per second |
| Zoom range | minimum zoom: majors every 30 s ("00:30", "01:00") (`30-timeline-toolbar/035-timeline-zoom-minimum.png`); maximum zoom: frame labels ("2f", "4f", "6f") with the clip's thumbnails repeating per frame (`036-timeline-zoom-maximum.png`). Label intervals step through frames, seconds and multi-second spans as you zoom |
| Minor tick | 1 × 5.5 px #404040, 12 per major interval (every ≈15.6 px here) |
| Playhead | 1 px #ffffff line through ruler and tracks; head is a hollow white shield 10×14 px with a 2 px stroke (flat rounded top, U-shaped bottom), top at y 603.5 just under the toolbar hairline |
| Marker | flag-shaped tab hanging below the ruler line, default `accent`; double-click opens a popover with name and time fields (`bg.sunken` inputs), five colour swatches (cyan, red, orange, green, purple), and Delete (secondary) / Done (primary) buttons |
| Keyframe graph | opens inside the selected clip, above its bands, still inside the white outline: a 20 px group row ("Transform ▲", #4f4f4f), a 20 px property row ("Scale ▲", #3b3b3b) with four curve-shape buttons (custom, ease in, ease out, ease in-out; selected one in `accent`) and a `‹ ◆ ›` navigator, then a 100 px plot (#262626) with dotted grid lines, min/max value labels top-left and bottom-left ("2.00", "-0.00"), a white value curve and accent diamonds |

### 4.13 Context menus and dropdown menus

Reference: `30-timeline-toolbar/001-video-context-menu.png` and the other `30-timeline-toolbar/0xx-*-context-menu.png` files; `04-top-bar/001-layout-menu-default.png`.

| Property | Value |
|---|---|
| Surface | `bg.header` #303030; outline 0.5 px #000 outside + 0.5 px #494949 inside; soft dark shadow (≈12 px) |
| Corner radius | 6–8 px |
| Width | content-sized: clip menu 315–317 px, empty-space menu 178, layout menu 178, track header menu 157, submenus 104–227 |
| Row height | 32 px, text vertically centred |
| Padding | ≈4 px top and bottom; labels at menu-left + 45.5 in clip menus whether or not a row has an icon (icons 16 px, #cbcbcb, at menu-left + 18); ≈33 in short menus with only a check column |
| Separator | 1 px #404040, inset 4–5 px from both sides; a group of n items is n × 32 + 4 px tall |
| Label | 13–14 px regular `text.primary`; disabled `text.disabled` #525252 (for example "Group" with a single clip selected) |
| Shortcut column | right-aligned at menu-right − 19, `text.tertiary` #949494, each key glyph spaced (`⌘ C`, `⌥ G`, `⇧ ⌃ S`) |
| Submenu | `›` chevron (#cacaca) 17.5 px from the right edge instead of a shortcut; submenus open touching the parent, first item level with the parent row, and flip upward near the window bottom (`012-video-context-render.png`). The parent row keeps the hover highlight while its submenu is open |
| Check | accent tick in the left column for the current choice |
| Hover | #404040 rectangle 28 px tall, inset 4 px each side, radius ≈4 (`30-timeline-toolbar/026-selection-tool-menu.png`, `16-player/002-guides-rulers-menu.png`) |
| Badges | CapCut adds "Free"/diamond badges (purple #8f7ef7) to AI items; OpenRip has no such items |

### 4.14 Dialogs

**Common chrome.** Centred modal over a black scrim (≈60%: the backdrop drops to about 0.4 of its brightness; the Linkage dialog's is lighter, ≈40%). Surface `bg.panel` #262626, radius ≈12, 1 px #3c3c3c outline, large soft shadow. Title bar 34 px, title 12–13 px semibold `text.strong` (left-aligned in Settings and Export, centred in Crop and Linkage), 1 px #373737 divider under it. Footer buttons are 28 px tall, radius ≈4: secondary #4f4f4f, primary `accent`, 8–10 px apart, right-aligned with 16 px padding (Settings uses two full-width 236 px buttons). Form inputs use `bg.field.form` #343337; selects use `bg.raised` #3b3b3b; the native macOS open panel is used for files (`31-dialogs/012-import-file-dialog.png`, `013-import-captions-file-dialog.png`).

| Dialog | Size | Layout | Reference |
|---|---|---|---|
| **Export** | 719.5×663 | Title "Export-" + project name. Left column ≈350 wide: cover preview (178.5×318 for 9:16) with an "Edit cover" chip at its top-left. Right column: labels at dialog-x + 358 (105 wide), controls at + 463; selects 224×22, text fields 239.5×22; 38 px row pitch. Top fields: Export timeline (read-only), Name, Export to + folder button. Then collapsible sections, each with an enable checkbox + 12 px semibold title + ▲ and a #373737 divider: Video (Resolution, Bit rate, Codec, a #808080 hint line, Format, Frame rate, read-only Color space), Audio (Format), Export GIF (Resolution), Captions (Format, encoding). Rows of an unchecked section grey out (#525252 label, #2c2c2c select with #626262 text). Footer 53 px: film glyph + "Duration: 35s \| Size: about 59 MB" + ⓘ on the left; Cancel (71×28) and Export (70×28) on the right | `31-dialogs/016-export-video-settings.png` to `026-export-caption-format-menu.png` |
| **Settings** | 510×753 | Title "Settings". Segmented tabs Draft, Edit, Performance, General (480×24 track, 4 × 120). Content well 480×602 `bg.window` #141414, radius 6, 24 px side padding; labels ≈164 wide (12 px `text.primary`), controls at well-x + 188 (≈268 wide); 46 px row pitch (22 px control + 24 gap); helper text under a control in #cccccc; path rows = 242×22 field + 22×22 folder button (#505056); groups split by #262626 dividers. Footer: Cancel and Save, 236×28 each | `02-settings/001-draft.png`, `005-edit.png`, `011-performance.png`, `014-general.png` |
| **Shortcuts** | 718 wide | Title bar 34 (#303030), tabs Timeline / Player / Basic / Other, preset dropdown (Shortcut 1–5), list well 688×500 #141414 in two columns split by a #303030 line, 40 px rows (action left, key badges right; named keys such as Space, Home, esc drawn as white badges). Click a row to edit: the key field shows "×" and a "Click to modify shortcut" tooltip. Footer 53 px: Reset, Cancel, Save (disabled #15393c until changed) | `02-settings/026-shortcuts-timeline.png` to `036-shortcuts-preset-dropdown.png` |
| **Project settings** ("Modify" in Details) | 512×640 | Title, segmented Details / Performance (24 tall), inner well #141414 inset 16, labels at x 540, controls at x 704 (264 wide), 38 px pitch, section labels #7a7a7a, radio buttons for Imported media (12 px ring #505056, 6 px accent dot), warning text #cda737. Cancel and Save 236×28 | `17-inspector-project/001-project-settings-details.png`, `008-project-settings-performance.png` |
| **Crop** | 959×639 (x 277–1236, y 189–828) | 35 px title bar (#1b1b1c), title "Crop" centred, red close dot at left. Near-black (#0b0b0b) stage (568 tall) with the frame, a dashed rule-of-thirds cross, white round corner handles and pill edge handles. A mini transport under the frame (timecodes + scrub line). 36 px bottom bar (#29292d): Rotation slider + "0°" field with stepper, Crop ratio select (Free, …, 3:4, 4:3, 16:9, 9:16), then Reset (secondary) and Confirm (primary) at the right | `31-dialogs/039-crop-dialog.png`, `040-crop-ratio-menu.png` |
| **Linkage settings** | 562 wide | Title centred. One-line description. 4-column grid of 123×55.5 `bg.raised` tiles, each showing a mini clip pill in that clip type's colour, with a checkbox + label under it (Text, Effects, Stickers, Filters, Adjust, Overlay, Audio, Sound effects, Text to speech). Footer: "Select all" checkbox at left; Cancel, Done | `31-dialogs/038-linkage-settings.png`, `02-settings/010-edit-linkage-settings.png` |
| **Edit guide** | 302×198 | Units select (Pixels / Percent), Position field (#1d1d1d) + 15 px stepper, Cancel / OK | `31-dialogs/014-edit-guide-dialog.png`, `015-guide-units-menu.png` |
| **Find and replace (captions)** | 227×194 | Find field, Replace with field (31 tall, #070709), Cancel and Replace all (90×22; disabled #253438) | `27-inspector-caption/003-caption-search-replace.png` |
| **Voiceover** | ≈291×537 panel | Body #1b1b1c, record card #242425: big record button, timer, "Recording not started", level meter; input device select (230×22) with "Microphone connected"; input volume slider + field; Echo reduction and Mute project checkboxes | `31-dialogs/036-voiceover-panel.png`, `037-voiceover-input-menu.png` |
| **Select a cover** | – | Segmented "Select from video" / "Local", filmstrip scrubber, footer "Create new cover", Cancel, "Edit cover". The cover design workspace behind "Edit cover" is mostly AI and template content (OOS) | `31-dialogs/027-cover-frame-selector.png`, `028-cover-design-templates.png`–`035-cover-exit-confirmation.png` |
| **Exit confirmation** | small | "Exit editing? Your changes won't be saved", Cancel (#404248) and Exit (destructive #eb4646), ≈80×27 each | `31-dialogs/035-cover-exit-confirmation.png` |
| **Trash** (from Home) | 512×471 | Its own window: 34 px #303030 title bar, body #1b1b1c, "Recently moved (n)" with help text about 30-day retention, Grid/List select, empty-trash icon, cards with "N days \| size", menu Delete ⌫ / Restore | `01-home/020-trash-view.png` to `024-trash-list-view.png` |

### 4.15 Home screen

Reference: `01-home/001-at-rest.png`, `014-project-view-dropdown.png`, `015-projects-list-view.png`, `016-project-search-open.png`, `017-project-search-empty.png`, `018-project-card-hover.png`, `019-project-card-context-menu.png`, `025-home-scrolled-1.png`.

The home screen is a separate full-window page with no panels and no top bar. Background is a subtle vertical gradient (#06181c at the top to #090909 at the bottom); OpenRip can use `bg.window` flat or tint it with its own accent.

| Part | Value |
|---|---|
| Traffic lights | top-left, as in the editor |
| Top-right icon buttons | centre y 58, 35.5 px pitch, 24×23 hover square (#162326). CapCut: Share, Update, Feedback, Settings; OpenRip keeps Settings (and an update indicator) |
| Sidebar | items x 20–196 (176 wide), 32 tall, ≈44 px pitch; 12 px glyph at x 30, 13 px label at x 54; selected item fill #162225 radius ≈6, label #e0e0e0; unselected #cccccc; group headers ("Create with AI", "Management") 12 px #949494; dividers #252f31 |
| Content column | starts at x 240, right edge x ≈1451 |
| Create project banner | x 241–1450.5, y 77.5–220 (1209.5×143), radius ≈8, accent gradient, centred "+" tile and "Create project" ≈28 px bold. On scroll it collapses to an 87 px sticky bar (`01-home/025-home-scrolled-1.png`) |
| "Projects" heading | ≈16 px bold `text.primary` |
| Projects toolbar (right-aligned) | 24 px buttons, #29292d, 8 px apart: search (23 wide; expands to a 252×26 field, #141414, 0.5 px #3a3a3a border, placeholder "Search project name"), Grid/List select (39), Trash (63), Project sync (OOS) |
| Project grid | from x 245: 124×123 thumbnails (cover image, radius 6) on a 146 px pitch (22 px gap), 8 columns at this width; name 13 px #cccccc under it, then "size \| duration" 11–12 px #7a7a7a |
| Card hover | thumbnail lightens and a "…" button appears (`01-home/018-project-card-hover.png`); click "…" or right-click: Rename, Duplicate, Delete ⌫ (Upload is OOS), a 133 px menu (`01-home/019-project-card-context-menu.png`) |
| List view | columns Name, Size, Duration, Last edited (sortable, ↓ on the active one); header 11–12 px #7a7a7a over a 1 px #1c1c1c divider; 46 px rows with a 36 px thumbnail; hover row #1c1c1c (`01-home/015-projects-list-view.png`) |
| Search with no match | illustration + "No related projects found" (`01-home/017-project-search-empty.png`) |
| Gear menu | Settings, …, Third-party copyright, Version (others OOS) (`01-home/079-settings-menu.png`) |

## 5. States

CapCut keeps state changes quiet: colour shifts on the dark ramp, white or accent outlines, and no animation that the stills can show.

| State | Pattern | Reference |
|---|---|---|
| **Hover: menu row** | #404040 rounded rect, 28 px tall, inset 4 px | `30-timeline-toolbar/026-selection-tool-menu.png`, `16-player/002-guides-rulers-menu.png` |
| **Hover: button on `bg.raised`** | fill steps up one level, #3b3b3b → #4f4f4f | `05-left-media/010-record-hover.png` |
| **Hover: media card** | 18 px accent "+" circle at the bottom-right (add at playhead) | `05-left-media/005-media-item-hover.png` |
| **Hover: library tile** | dark translucent 18 px circles at the bottom-right: favourite star and download (or "+") | `09-left-effects/047-classic-item-hover.png`, `10-left-transitions/018-item-hover.png`, `12-left-filters/033-item-hover.png` |
| **Hover: audio row** | favourite and add buttons at the right | `06-left-audio/025-music-item-hover.png` |
| **Hover: home cards and icons** | see §4.15 | `01-home/002`–`013-project-sync-tooltip.png` |
| **Hover: toolbar buttons, track header icons, keyframe diamonds, sliders** | not captured (the filter keyframe hover in `24-inspector-filter/002-keyframe-hover.png` shows no visible change) | §7 |
| **Selected: tab** | accent label (and accent filled icon in the left panel); nothing else | `003` |
| **Selected: sidebar item** | `bg.raised` fill + accent label; an expanded group header also turns accent | `05-left-media/004-media-added-badges.png` |
| **Selected: segment** | `bg.raised` segment on a `bg.sunken` track, label `text.strong` | `003` |
| **Selected: tile / chip** | 1.5 px accent outline (tiles); #4f4f4f fill with `text.primary` (chips; unselected #3b3b3b with `text.tertiary`) | `21-inspector-text/020-animation-in-grid.png`, `18-inspector-video/018-retouch-face-controls.png` |
| **Selected: media card** | 1.5 px accent outline + white in/out range handles on its sides | `05-left-media/002-prores-imported.png` |
| **Selected: clip** | 1.5 px white outline + white trim handles with dotted grips | `003`, `30-timeline-toolbar/028-split-video-state.png` |
| **Selected: track** | header and band lighten to #2c2c2c with #333333 lines | `30-timeline-toolbar/022-empty-space-context-menu.png` |
| **Selected: list row (previewing audio)** | 1.5 px accent outline + loading ring | `06-left-audio/026-music-item-context.png` |
| **Toggle states** | toggle on = accent track; timeline toggles on = accent glyph on a #1b1b1c chip | `003` |
| **Disabled: text** | `text.disabled` #525252 (menu rows, "Group" with one clip); disabled labels #4b4b4b–#5e5e5e | `30-timeline-toolbar/001-video-context-menu.png`, `22-inspector-sticker/001-sticker-transform.png` |
| **Disabled: icons** | #575757 (toolbar), #484848 (player with no media) | `03-editor-overview/001-empty-editor.png` |
| **Disabled: primary button** | #253438 fill, grey label | `27-inspector-caption/003-caption-search-replace.png` |
| **Disabled: section rows** | rows under an unchecked section are dimmed but visible (e.g. Stabilize › Level, Fill channel) | `18-inspector-video/005-stabilize-options-view.png`, `20-inspector-audio/002-basic-channel-section.png` |
| **Focus: text field** | search field darkens to #121212 with a 1 px #515151 border; no accent focus ring is visible anywhere in the captures | `05-left-media/011-media-search-open.png`, `09-left-effects/045-search-open.png` |
| **Focus: keyboard focus ring** | not captured. OpenRip should still draw a 2 px accent ring on keyboard focus (`:focus-visible`) for accessibility | – |
| **Menu open** | the panel behind dims slightly (#262626 → ≈#232323) | `05-left-media/007-media-sort-menu.png` |
| **Modal open** | app dimmed by a black scrim, ≈40–60% | `31-dialogs/038-linkage-settings.png`, `039-crop-dialog.png` |
| **Empty: media** | dashed drop zone (`bg.raised` ≈#3b3b3b, radius ≈6) with accent "+" and "Import", grey hint underneath | `03-editor-overview/001-empty-editor.png` |
| **Empty: timeline** | dashed 70 px drop zone across the main track: film glyph + "Drag material here and start to create" | `001` |
| **Empty: lists (favourites, presets, subprojects)** | ≈30×27 outline glyph in #6c6c6c, 12 px #6c6c6c message 17 px below it, with an inline accent link ("Go to Library") | `05-left-media/013-yours-favorites-empty.png`, `012-subprojects-empty.png`, `09-left-effects/044-favorites.png` |
| **Empty: search with no match** | illustration + one-line message in the list area ("No related projects found"); CapCut's content libraries show recommendations instead. `32-states/004-media-search-no-match.png` failed to capture the empty state (§7) | `01-home/017-project-search-empty.png`, `32-states/003-library-elements-empty-search.png`, `09-left-effects/046-unmatched-search-results.png` |
| **Empty: inspector** | nothing selected → project Details; feature unavailable → illustration, 16 px semibold white title, two-line #6c6c6c description, 120×26 accent button | `17-inspector-project/010-details-empty.png`, `18-inspector-video/023-audio-separated-state.png` |
| **Loading: page** | small spinner + "Loading……" centred in the content area | `32-states/001-home-templates-search-loading.png` |
| **Loading: inline** | "Loading…" with a spinner in place of a list (effect mask, retouch presets) | `23-inspector-effect/002-fade-in-mask.png`, `18-inspector-video/018-retouch-face-controls.png` |
| **Loading: item** | spinner ring on the item's action button | `06-left-audio/026-music-item-context.png` |
| **Background job** | the timeline dims and a centred grey pill with a progress glyph and "Cancel" floats over it | `32-states/005-timeline-processing-cancel-overlay.png` |
| **Proxy in progress** | "Proxy" tag on the card while transcoding | `05-left-media/002-prores-imported.png` |
| **Drag in progress** | translucent ghost clip with its name follows the pointer; a thin accent line marks where a new track will be inserted | `30-timeline-toolbar/038-drag-to-timeline-preview.png` |
| **Coach mark (walkthrough)** | everything dims except the target; a hand-drawn arrow, step counter ("1/5"), bold title, Next (accent) and Exit (secondary) buttons | `31-dialogs/042-walkthrough-import-step.png` |
| **Error: item** | dark overlay on the card with an "!" glyph and a short message ("Couldn't open this template") | `14-left-templates/001-editor-templates-default.png` |

## 6. Feature inventory by area

This is the build checklist: every control and option visible in the captures, grouped by area. Each row names the CapCut screenshot that shows it and OpenRip's status:
- **has**: OpenRip already does this (look and placement may still differ);
- **partly**: some of it exists, or it exists only as engine rendering of imported CapCut drafts with no editing UI, or in a different place;
- **missing**: not in OpenRip.

Out-of-scope items (AI/ML, cloud, account, sharing, CapCut content) are listed under each table instead of in it, so the counts cover in-scope work only. Where CapCut's version is ML but a classic algorithm does the same job (stabilisation, denoise, loudness normalisation, beat detection, chroma key, and since 2026-10-18 motion tracking, scene detection, optical-flow interpolation and colour matching: §6.31), the row is in scope and means the classic version.

OpenRip status comes from `docs/inventory/current-app.md` (dated 2026-10-15) plus later commits (undo/redo, the Animation tab, CapCut import, engine export) and the components under `apps/app/packages/renderer/src/components`.

### 6.0 Summary

| Area | Has | Partly | Missing |
|---|---:|---:|---:|
| 6.1 App menu bar (macOS) | 15 | 0 | 0 |
| 6.2 Home screen | 15 | 1 | 0 |
| 6.3 Settings and shortcuts | 28 | 5 | 2 |
| 6.4 Editor top bar and layout | 8 | 0 | 0 |
| 6.5 Left panel: Media | 21 | 0 | 2 |
| 6.6 Left panel: Audio | 4 | 0 | 0 |
| 6.7 Left panel: Text | 4 | 1 | 0 |
| 6.8 Left panel: Stickers | 3 | 0 | 0 |
| 6.9 Left panel: Effects | 4 | 0 | 0 |
| 6.10 Left panel: Transitions | 3 | 0 | 0 |
| 6.11 Left panel: Captions | 5 | 0 | 0 |
| 6.12 Left panel: Filters | 4 | 0 | 0 |
| 6.13 Left panel: Adjustment | 3 | 0 | 0 |
| 6.14 Left panel: Templates | 1 | 0 | 0 |
| 6.15 Player | 13 | 0 | 0 |
| 6.16 Inspector: project (nothing selected) | 8 | 3 | 0 |
| 6.17 Inspector: video clip | 40 | 0 | 0 |
| 6.18 Inspector: photo clip | (see 6.17) | | |
| 6.19 Inspector: audio clip | 7 | 0 | 0 |
| 6.20 Inspector: text clip | 23 | 0 | 0 |
| 6.21 Inspector: sticker clip | 2 | 0 | 0 |
| 6.22 Inspector: effect, filter and transition clips | 6 | 0 | 0 |
| 6.23 Inspector: adjustment layer (also the video Adjust tab) | 11 | 0 | 0 |
| 6.24 Inspector: caption clip | 4 | 0 | 0 |
| 6.25 Inspector: multiple selection and compound clips | 4 | 2 | 0 |
| 6.26 Timeline toolbar | 20 | 2 | 0 |
| 6.27 Timeline tracks, clips, ruler | 24 | 0 | 0 |
| 6.28 Context menus | 19 | 1 | 1 |
| 6.29 Export dialog | 16 | 0 | 0 |
| 6.30 Other dialogs | 6 | 0 | 0 |
| 6.31 Classic-algorithm features brought into scope (2026-10-18) | 12 | 0 | 0 |
| **Total (353 in-scope features)** | **333** | **15** | **5** |

Re-audited 2026-10-19 against main 8d265833: every non-OOS row that read missing or partly was checked against the code and the smoke steps, and the counts above are the rows' current statuses (329 has, 16 partly, 8 missing of 353; 93.2% strict, 95.5% with partly as half). Before it (audited against ab4960fe) the table read 289 / 36 / 28 of 353 (81.9% strict, 87.0% with partly as half). Before that (audited against 06c8dac7) the table read 251 / 45 / 57 of 353. Earlier: a re-audit on 2026-10-19 against main 06c8dac7 gave 251 / 45 / 57; before that the summary read 127 / 75 / 149 while the rows read 170 / 69 / 114; an audit on 2026-10-18 against main at c795cf7d found 108 has, 106 partly and 123 missing of the first 337 rows. Since then: Settings › Edit › Linkage settings works in the editor, and a project holds several timelines (File › New timeline, New timeline with selected item, the Export timeline menu): 333 has, 15 partly, 5 missing (94.3%).

### 6.1 App menu bar (macOS)

Screenshots are in `00-menu-bar/` unless a path says otherwise.

Captured from Home, so editor-only items show disabled (see §7).

| Feature | CapCut reference | OpenRip |
|---|---|---|
| App menu › About (version) | `00-menu-bar/001-about.png`, `002-capcut-menu.png` | has (About window: OpenRip's mark, version, copyright) |
| App menu › Settings | `002-capcut-menu.png` | has (the Settings window, ⌘,) |
| App menu › Back to home page | `002-capcut-menu.png` | has (off on the home screen) |
| App menu › Layout › Default, Media, Attributes, Vertical, Reset current layout | `003-layout-submenu.png` | has (Attributes is OpenRip's Inspector layout) |
| App menu › More › Third-party copyright (licences view) | `007-more-submenu.png`, `31-dialogs/006-third-party-copyright.png` | has (OpenRip's npm and Cargo notices, made from the lockfiles at build time) |
| App menu › Quit ⌘Q | `002-capcut-menu.png` | has |
| File › New Project ⌘N | `004-file-menu.png`, `008-editor-file-menu.png` | has (File menu item and ⌘N) |
| File › New timeline (several timelines per project) | `008-editor-file-menu.png` | has (switch, rename, duplicate and delete from the player title's timeline menu) |
| File › Import ⌘I | `004-file-menu.png` | has (File menu item and ⌘I) |
| File › Export ⌘E | `004-file-menu.png` | has (File menu item and ⌘E) |
| Edit › Undo ⌘Z, Redo ⇧⌘Z | `005-edit-menu.png` | has |
| Edit › Split ⌘B | `009-editor-edit-menu.png` | has (Edit menu item and ⌘B) |
| Edit › Copy, Cut, Paste, Delete | `005-edit-menu.png` | has |
| Help › Shortcut | `006-help-menu.png` | has (opens the Shortcuts window) |
| Help › Walkthrough (first-run tour: spotlight, step counter, Next/Exit) | `006-help-menu.png`, `31-dialogs/042-walkthrough-import-step.png` | has (Help menu; spotlight, step counter, Next and Exit; harness walkthrough) |

Out of scope: Terms of Service, Privacy Policy, Network Testing, Help › Feedback (OpenRip links to its issue tracker instead).

### 6.2 Home screen

Screenshots are in `01-home/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Separate home page shown at launch and via "Back to home page" | `01-home/001-at-rest.png` | has (Home is its own view at launch; Back to home page returns to it) |
| Create project banner (sticky on scroll) | `001-at-rest.png`, `003-create-project-hover.png`, `025-home-scrolled-1.png` | has (the banner pins to the top once scrolled, with quick-start cards: Continue, CapCut project, Import media, sizes, Library) |
| Project grid with cover thumbnails | `001-at-rest.png` | has (covers drawn from the saved cover file) |
| Card details: name, size, duration | `001-at-rest.png` | has (name, then size and length) |
| Card hover "…" and menu: Rename | `018-project-card-hover.png`, `019-project-card-context-menu.png` | has (inline rename in the Topbar) |
| Card menu: Duplicate | `019-project-card-context-menu.png` | has (the menu has Open, Rename, Duplicate, Show the file, Save as template, Delete) |
| Card menu: Delete (to Trash) | `019-project-card-context-menu.png` | has (moves to the Trash; see below) |
| Grid / List view switch | `014-project-view-dropdown.png` | has |
| List view: Name, Size, Duration, Last edited, sortable | `015-projects-list-view.png` | has (cover, name, ratio, length, size, last edited; a Sort menu) |
| Search projects by name | `016-project-search-open.png` | has |
| No-results state | `017-project-search-empty.png` | has |
| Trash: recently deleted (30-day retention), Restore, Delete permanently, empty trash, grid/list | `020-trash-view.png`–`024-trash-list-view.png` | has (Delete moves a project, its cover, masks and media folder to a trash folder; Home's Trash window: "Recently moved (n)", days left, Grid / List, a circle to select, right-click Delete / Restore, Empty trash; 30 days, then emptied at start-up; the delete toast has Undo. Harness `trash`) |
| Home sidebar: Home, Templates (local templates) | `001-at-rest.png`, `028-templates-page.png` | has (no store: the page's search, Orientation and Duration filters and tall cards, filled by "Save as template" on a project's menu; Use template starts a project with its own copy of the media; empty state explains it. Library page: Media tab, All / Videos / Images / Audio, search, Favorites, Grid / List, Sort, refresh over the files the projects import. Harness `templatespage`, `librarypage`) |
| Settings gear (Settings, Third-party copyright, Version) | `079-settings-menu.png`, `012-settings-tooltip.png` | has (Version opens About) |
| Update-available indicator | `010-update-tooltip.png` | partly (update toasts) |
| Open a CapCut draft as a project (OpenRip-only) | – | has (Projects › Open CapCut Project) |

Out of scope: account card and Renew, Video Studio, Design Studio, Library (generated assets), Spaces, Invite friends, promo card, EditPilot and the AI cards, AI-powered creative suite, Share, Feedback, Project sync and cloud badges, Upload, the template store (search, filters, categories, Favorites, Purchased, Pro), Brand kit.

### 6.3 Settings and shortcuts

Screenshots are in `02-settings/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Draft › Save to (projects folder) | `02-settings/001-draft.png`, `020-draft-save-path-picker.png` | has (the projects, covers and mask data move to the folder chosen) |
| Draft › Screen recording folder | `001-draft.png`, `021-draft-recording-path-picker.png` | has (a folder picker with Default; recordings go there) |
| Draft › Cache: don't delete / auto delete after 90, 60, 30, 15 days; cache size + clear | `001-draft.png`, `002-draft-cache-age-dropdown.png` | has (engine thumbnails, export audio mixes, kept exports; old files deleted at start) |
| Draft › Preset save path | `001-draft.png`, `023-draft-preset-path-picker.png` | has (a folder picker with Default; saved presets are kept there) |
| Edit › Step forward or back many N frames | `005-edit.png` | has (⇧← / ⇧→) |
| Edit › Adjust value many N units | `005-edit.png` | has (↑ / ↓ in the inspector's value fields, ⇧ for N) |
| Edit › Image duration (s or frames) | `005-edit.png`, `009-edit-image-duration-unit.png` | has |
| Edit › Target loudness: −23, −14, −12 LUFS | `006-edit-target-loudness.png` | has (the Audio tab's Normalize loudness and the clip menu use it) |
| Edit › Play audio while scrubbing | `005-edit.png` | missing (the row shows disabled) |
| Edit › Linkage settings | `010-edit-linkage-settings.png` | has (in the editor its Settings button opens the timeline's Linkage settings; on Home, with no timeline, it's disabled) |
| Edit › Arrange layers by default | `005-edit.png` | missing (the row shows disabled) |
| Edit › Default frame rate: 24, 25, 29.97, 30, 50, 59.94, 60 | `007-edit-frame-rate.png` | has (a new project's) |
| Edit › Time code: HH:MM:SS+frame or HH:MM:SS:FF | `008-edit-time-code.png` | has (the player, the marker box, the project's length; the two differ at 29.97 and 59.94) |
| Edit › Sound when export completes | `005-edit.png` | has |
| Performance › Hardware encoding, Hardware decoding | `011-performance.png` | partly (decoding switches the engine's decoder; encoding is always VideoToolbox) |
| Performance › Auto optimization (None / Smart) | `012-performance-optimization-dropdown.png` | has (the app's own preview's playable copies) |
| Performance › Proxy default, proxy folder, proxy size + clear | `011-performance.png`, `024-performance-proxy-path-picker.png` | partly (size and folder shown; proxies are per item and the engine plays originals) |
| Performance › Rendering cache location, size, auto clear, auto render | `011-performance.png`, `025-performance-rendering-path-picker.png` | partly (size, clear and auto clear by size work; the location is fixed and there is no pre-render or auto render) |
| General › Language | `014-general.png` | partly (English only; the words come from lib/i18n.ts, ready for more) |
| General › Notifications | `014-general.png` | has (when an export finishes) |
| General › Software update: automatic or notify | `014-general.png` | has (and Check for updates) |
| Shortcuts window: categories Timeline, Player, Basic, Other | `026-shortcuts-timeline.png`–`034-shortcuts-other.png` | has |
| Shortcuts: click to rebind, Reset, Save | `026-shortcuts-timeline.png` | has (a key another action has is refused and named) |
| Shortcuts: presets 1–5 | `036-shortcuts-preset-dropdown.png` | has |
| Keys: Space play/pause, ←/→ frame step, Home/End, K/L shuttle | `031-shortcuts-player.png`, `026-shortcuts-timeline.png` | has (J/K/L shuttle, harness shuttle) |
| Keys: ⌘B split, ⌘⇧B split all, Q/W delete left/right | `026-shortcuts-timeline.png` | has |
| Keys: A select mode, B split mode, [ ] select leftward/rightward | `026-shortcuts-timeline.png` | has (A, B, [ and ]) |
| Keys: P magnet, N snapping, ~ linkage, S preview axis | `026-shortcuts-timeline.png` | partly (preview axis has no default key) |
| Keys: M marker, ⌥M new-colour marker, ⇧M / ⌥⇧M next/previous marker | `028-shortcuts-timeline-2.png` | has |
| Keys: ⌥K keyframe panel, ⇧⌥K add keyframe | `029-shortcuts-timeline-3.png` | has |
| Keys: ⌘+ / ⌘− zoom, ⇧Z zoom to fit, ⌘scroll zoom, ⌥scroll pan | `026-shortcuts-timeline.png` | has (⌘scroll zooms, ⇧scroll pans) |
| Keys: V activate/deactivate clip, ⇧⌃S extract audio | `026-shortcuts-timeline.png` | has |
| Keys: ⌘C/⌘X/⌘V, ⌘Z/⌘⇧Z, ⌫ | `032-shortcuts-basic.png` | has |
| Keys: ⌘⇧C / ⌘⇧V copy/paste attributes | `032-shortcuts-basic.png` | has |
| Keys: ⌘⇧F full-screen preview, ⌘⌥R rulers, ⌘; guides | `031-shortcuts-player.png` | has (⌘⇧F, ⌘⌥R rulers, ⌘; guides) |

Out of scope: Download to, Auto sync, Synced items, Default space, Size limit, Dreamina sync, the shortcuts for Generate captions and voice isolation.

### 6.4 Editor top bar and layout

Screenshots are in `03-editor-overview/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Autosave status "Auto saved: hh:mm:ss" | `03-editor-overview/003-base-timeline-built.png` | has ("Auto saved: hh:mm:ss" in the top bar) |
| Project title, click to rename | `003-base-timeline-built.png` | has |
| Layout menu: Default, Media, Attributes, Vertical | `04-top-bar/001-layout-menu-default.png`, `03-editor-overview/004-media-layout.png`–`006-vertical-layout.png` | has (Default, Media, Inspector, Vertical; also in the app menu) |
| Reset current layout | `04-top-bar/001-layout-menu-default.png` | has (Topbar and app menu) |
| Resizable panels (gutters as splitters), sizes remembered per preset | inferred from "Reset current layout" | has (sizes kept per layout) |
| Panels in windows of their own (the player on a second display) | not in the references | has (OpenRip's: a header dragged out or Pop out, Dock back in a 34 px window strip, places kept per panel) |
| Keyboard shortcuts button | `003-base-timeline-built.png` | has (opens the Shortcuts window, where keys can be rebound) |
| Export button | `003-base-timeline-built.png` | has |

Out of scope: Ultra, Share, the floating EditPilot pill (timeline bottom-right).

### 6.5 Left panel: Media

Screenshots are in `05-left-media/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Import from device (file picker), Import button with menu | `05-left-media/001-empty-import-dropdown.png`, `003-import-dropdown-with-media.png`, `31-dialogs/012-import-file-dialog.png` | has |
| Drop files from Finder onto the panel; empty drop zone "Import / Drag and drop videos, photos, and audio files here" | `03-editor-overview/001-empty-editor.png` | has |
| Record (screen/camera) button | `05-left-media/010-record-hover.png` | has (screen, camera or both, with microphone; harness record) |
| Search imported media; no-match state | `011-media-search-open.png` (`32-states/004-media-search-no-match.png` does not show the empty state) | has |
| Grid / list (filmstrip) view toggle | `009-media-list-view.png` | has (a toggle in the toolbar) |
| Sort: time imported, time created, name, type, duration; newest/oldest first | `007-media-sort-menu.png` | has |
| Type filter: All, Video, Audio, Image | `008-media-filter-menu.png` | has |
| Card with thumbnail and duration | `004-media-added-badges.png` | has |
| "Added" badge on media used in the timeline | `004-media-added-badges.png` | has (grid and list) |
| Proxy tag on proxied media | `004-media-added-badges.png` | has |
| Hover "+" adds the item at the playhead | `005-media-item-hover.png` | has |
| In/out range handles on a selected card (add a sub-range) | `002-prores-imported.png` | has |
| Card menu: Rename, Delete, Open file location | `006-media-item-context-menu.png` | has |
| Card menu: Create/Cancel file proxy | `006-media-item-context-menu.png` | has |
| Card menu: New folder with selected item (bins/folders) | `006-media-item-context-menu.png` | has |
| Card menu: New timeline with selected item (several timelines per project) | `006-media-item-context-menu.png` | has |
| Card menu: Export selected clips | `006-media-item-context-menu.png` | missing |
| Card menu: Create multi-camera clip | `006-media-item-context-menu.png` | missing |
| Card menu: Link to media (relink missing files) | `006-media-item-context-menu.png` | has (Link to media on a missing card, and link missing in a folder; harness relink) |
| Subprojects library (compound clips you can reuse) | `012-subprojects-empty.png` | has |
| Yours › Favorites | `013-yours-favorites-empty.png`, `014-favorites-type-filter.png` | has (starred stock media) |
| Yours › My presets (saved clip presets) | `015-my-presets-library.png` | has (saved clip presets; harness presets) |
| Library: stock videos and photos (categories, search, Videos / Photos, tiles with length, hover and player preview, "+", drag, favourites, download spinner, credits) from key-free openly licensed sources (Openverse CC0/PDM/CC BY, Wikimedia Commons CC0/PD/CC BY, NASA) | `023-library-default.png`, `031-library-filter-menu.png` | has (no Commercial filter, everything listed is free to use; CC BY credits are in Library > Credits) |

Out of scope: Import › From library (stock), Generate (AI image, AI video, AI dialogue scene: `15-left-ai-and-other/009-media-generate-default.png`–`15-left-ai-and-other/034-dialogue-react-tab.png`), Spaces and Brand assets (`017-spaces-default.png`–`020-spaces-asset-context.png`, `016-brand-assets-empty.png`), the Library's Commercial filter (`031-library-filter-menu.png`–`034-library-search-orientation-menu.png`), Dreamina (`15-left-ai-and-other/035-dreamina-default.png`), the media card's Transcript is in scope since 2026-10-19 with a local model (§6.31), as is Split scenes, the "AI clipper" bottom bar, the empty state's Generate and AI avatars tiles.

### 6.6 Left panel: Audio

Screenshots are in `06-left-audio/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Import › Extract audio from a video file | `06-left-audio/028-audio-import-extract.png` | has (the Extracted view lists each video's sound with an Extract audio card; Detach audio on the timeline too) |
| Audio list rows: cover, title, artist · duration, preview on click, favourite, add | `025-music-item-hover.png`, `026-music-item-context.png` | has (cover or note, title, artist · duration, licence chip, click to preview, star, download arrow with spinner turning into "+"; a downloaded row drags onto the timeline; no right-click menu) |
| Library pattern for local or openly licensed music and sound-effect packs (categories, search) | `001-audio-default.png`, `027-sounds-trending.png` | has (Music and Sound effects from Openverse: CC0, Public Domain, CC BY; categories under each heading, search; [music-library.md](../parity/music-library.md)) |
| Yours › Favorites | `029-audio-yours.png` | has (Music / Sound effects chips; favourites are kept whole and downloaded, so they work offline) |

Out of scope: CapCut Music and Sound effects content, TikTok sounds, Brand music, AI music (`15-left-ai-and-other/036-ai-music-default.png`, `15-left-ai-and-other/037-ai-music-history.png`), Copyright check (`030-copyright-check-view.png`).

### 6.7 Left panel: Text

Screenshots are in `07-left-text/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Add text: "Default text" tile (click or drag to add) | `07-left-text/001-add-text-default.png` | has (a Default text tile: click or drag; T draws a box on the player) |
| Text style presets grid (OpenRip's own styles) | `003-text-effects-default.png` | has (OpenRip's own presets in Basic, Title, Caption and Style, with search; click or drag; harness textpresets) |
| Text templates (local, multi-paragraph) | `004-text-template-default.png` | has (about 55 of OpenRip's own designs in eight categories as groups of text and shape clips; search, favourites, hover play, click preview, "+", drag; words edited in the group's Text template tab) |
| Yours › Favorites, Presets (saved text styles) | `002-text-yours.png` | partly (Yours ▸ Presets holds the saved text styles; no Yours ▸ Favorites in the Text tab) |
| Local captions entry (SRT import, see 6.11) | `001-add-text-default.png` | has (the Text tab's Captions entry is Add captions, see 6.11) |

Out of scope: AI packaging (`15-left-ai-and-other/038-text-ai-packaging.png`), Auto captions, CapCut text effects and templates, "AI generated" templates.

### 6.8 Left panel: Stickers

Screenshots are in `08-left-stickers/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Shapes: square, circle, triangle, parallelogram, trapezoid, line, arrow, custom pen shape | `08-left-stickers/002-shapes-library.png` | has (rectangle, circle, triangle, parallelogram, trapezoid, line, arrow and the Pen; click or drag; harness shapes, pen) |
| Sticker library for openly licensed PNG/GIF/APNG stickers | `001-stickers-default.png` | has (Fluent Emoji, Noto Emoji and the animated Noto emoji; [stickers.md](../parity/stickers.md)): categories, search, a style filter, click to preview, "+", drag onto the timeline or the player, a download mark and spinner on tiles not on the machine |
| Yours › Favorites | `001-stickers-default.png` | has (Favorites at the top of the column, a star on each tile) |

Out of scope: CapCut sticker content, AI generated stickers (`15-left-ai-and-other/041-stickers-ai-generated.png`), GIPHY (`003-giphy-library.png`).

### 6.9 Left panel: Effects

Screenshots are in `09-left-effects/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Video effect library (OpenRip's own shader effects), drag to the timeline as an effect clip or onto a clip | `09-left-effects/001-video-effects-trending.png` | has (79 effects, harness `effectsui`) |
| Favorites with empty state | `044-favorites.png` | has |
| Search with recent searches (removable, clear all) | `045-search-open.png`, `046-unmatched-search-results.png` | has |
| Tile hover: favourite, download/add | `047-classic-item-hover.png`, `048-download-hover.png` | has (the tile plays; star and +) |

Out of scope: CapCut effect content, Body effects (ML segmentation), Magic cutout, Trending searches.

### 6.10 Left panel: Transitions

Screenshots are in `10-left-transitions/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Transition library; drag a tile onto a cut | `10-left-transitions/001-trending.png`, `018-item-hover.png` | has (112 transitions in 12 categories, drawn by the engine; click, + or drag onto a cut; harness translib, transui) |
| Favorites | `002-favorites.png` | has |
| Tile hover: favourite, download/add | `018-item-hover.png`, `019-download-hover.png` | has |

Out of scope: CapCut transition content.

### 6.11 Left panel: Captions

Screenshots are in `11-left-captions/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Add captions › Import file (SRT, LRC, ASS) | `11-left-captions/005-add-captions.png`, `31-dialogs/013-import-captions-file-dialog.png` | has (SRT, VTT, LRC and ASS) |
| Imported subtitle file card, "+ Import file" | `007-srt-imported.png` | has (the files brought in so far; harness captionsio) |
| Caption style templates (OpenRip's own) | `006-caption-templates.png` | has (OpenRip's own looks, with whole, three-word and one-word styles) |
| Auto captions with a local speech model: spoken language, word timing for word-by-word styles, highlight keywords, filler words (in scope since 2026-10-19) | `001-auto-captions-default.png`–`003-bilingual-language-menu.png` | has (local Whisper model: spoken language, keywords, filler words, word timing; harness autocaptions) |
| Auto lyrics with the same model | `004-auto-lyrics.png` | has (same panel in lyrics mode) |

Out of scope for now (AI features come after parity): bilingual captions and AI emojis within Auto captions, AI packaging, AI emojis (`15-left-ai-and-other/040-captions-ai-emojis.png`).

### 6.12 Left panel: Filters

Screenshots are in `12-left-filters/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Filter library (LUT based), drag to the timeline as a filter clip | `12-left-filters/001-featured.png` | has |
| Categories and search | `001-featured.png`, `032-unmatched-search-results.png` | has |
| Favorites | `031-favorites.png` | has |
| Tile hover: favourite, add | `033-item-hover.png`, `034-download-hover.png` | has (the tile plays; star and +) |

Out of scope: CapCut filter content, the All/Commercial filter (`030-commercial-filter-dropdown.png`).

### 6.13 Left panel: Adjustment

Screenshots are in `13-left-adjustment/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| "Custom adjustment" tile: add an adjustment layer clip | `13-left-adjustment/001-add-adjustment.png`, `004-custom-hover.png` | has (the tile, its hover "+", a click or drag onto the timeline; the layer is a bar on a track of its own that grades everything beneath it) |
| LUT list of local .cube files | `13-left-adjustment/003-lut.png` (wrong view captured, see §7) | has (Import, the list, click previews, "+" or a drag adds a layer with that LUT) |
| My adjustment presets | `002-yours.png` | has (Yours lists the presets saved with Save as preset, kept in the app's storage; "+" and a drag add a layer with them; no brand presets) |

Out of scope: Brand presets (cloud).

### 6.14 Left panel: Templates

Screenshots are in `14-left-templates/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Local project templates (save a project as a template, start from one) | `14-left-templates/001-editor-templates-default.png` | has (the editor tab lists them as tall cards; a click previews, "Use" lays the clips in at the playhead as one undo step, "New" starts a project) |

Out of scope: the template store (content, use counts, "Featured"), the AI avatar tab (`15-left-ai-and-other/042-ai-avatar-library.png`–`15-left-ai-and-other/046-video-translator.png`).

### 6.15 Player

Screenshots are in `16-player/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Play/pause, centred | `03-editor-overview/003-base-timeline-built.png` | has (centred in the player's bar) |
| Current / total timecode `HH:MM:SS:FF` | `03-editor-overview/003-base-timeline-built.png` | has |
| Stereo audio level meter | `16-player/002-guides-rulers-menu.png` | has (the engine's mix level; idle without the engine preview) |
| Safe-area overlay toggle (generic; CapCut's is branded) | `03-editor-overview/003-base-timeline-built.png` | has (the bar's first button on the right) |
| Preview quality menu: Full, High, Medium, Low (playback only) | `16-player/004-quality-menu.png` | has (playback at 1, ¾, ½, ¼ of the screen's size) |
| Zoom popover (slider, −/+) | `005-zoom-popover.png` | has (50–400% of fit; ⌥⇧+, ⌥⇧−, ⌥⇧Z) |
| Zoom navigator thumbnail while zoomed | `005-zoom-popover.png` | has |
| Ratio menu: Original, Custom, 16:9, 4:3, 2.35:1, 2:1, 1.85:1, 9:16, 3:4, 5.8-inch, 1:1 | `006-aspect-ratio-menu.png` | has |
| Fullscreen preview with floating transport | `007-fullscreen-preview.png` | has |
| Header menu › Color oscilloscope: RGB parade, waveform, vectorscope | `001-header-menu.png`, `009-color-oscilloscope.png` | has (WebGL2 from the engine's frame) |
| Header menu › Guides and rulers; rulers; draggable guides; Edit guide (Pixels/Percent, position); Delete guide | `002-guides-rulers-menu.png`, `010-rulers-visible.png`, `003-horizontal-guide.png`, `008-guide-context-menu.png`, `31-dialogs/014-edit-guide-dialog.png`, `31-dialogs/015-guide-units-menu.png` | has (guides saved in the project and undone; clips snap to them) |
| Header menu › Export still frames | `001-header-menu.png` | has (PNG at the project's size, by the engine) |
| Selected clip bounding box with handles on the canvas | `03-editor-overview/003-base-timeline-built.png` | has |

### 6.16 Inspector: project (nothing selected)

Screenshots are in `17-inspector-project/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Details panel: Name, Path, Imported media, Arrange layers, Proxy, Timeline name, Aspect ratio, Resolution, Frame rate; Modify button | `17-inspector-project/010-details-empty.png`, `001-project-settings-details.png` | has (Project and Details tabs: name, path, media, arrange layers, proxy, ratio, resolution, frame rate, Modify) |
| Project settings › Name | `001-project-settings-details.png` | has (Topbar rename) |
| Project settings › Save to (project folder) | `001-project-settings-details.png` | has (moves the projects folder) |
| Project settings › Imported media: Copy media to project / Stay in original location | `001-project-settings-details.png` | has |
| Project settings › Color space: Rec. 709 SDR, Rec. 2020 SDR, Rec. 2100 HLG, Rec. 2100 PQ | `002-color-space-dropdown.png` | partly (only Rec. 709 SDR; the rest disabled with a note) |
| Project settings › Arrange layers (one-way) | `001-project-settings-details.png` | partly (shown on, disabled with a note) |
| Project settings › Aspect ratio list | `004-aspect-ratio-dropdown.png` | has |
| Project settings › Resolution: Adapted, Custom | `006-resolution-dropdown.png` | has (Custom is W × H fields) |
| Project settings › Frame rate: 24, 25, 29.97, 30, 50, 59.94, 60 | `007-frame-rate-dropdown.png` | has |
| Project settings › Performance: Proxy on/off, proxy resolution 720P/540P | `008-project-settings-performance.png`, `009-proxy-resolution-dropdown.png` | partly (shown disabled: the engine plays the originals) |
| Global edits › Make volume consistent (classic loudness matching) | `011-project-smart-suggestions.png`, `012-project-global-edits-bottom.png` | has |

Out of scope: Smart suggestions › Analyze, Make colors better, Make voice clearer, Make video clearer, Retouch face.

### 6.17 Inspector: video clip

Screenshots are in `18-inspector-video/` unless a path says otherwise.

Tabs: Video (Basic, Remove BG, Mask, Retouch), Audio, Speed, Animation, Adjust, AI stylize.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Transform › Scale (slider, %, stepper) | `001-video-selected-basic-top.png` | has |
| Transform › Uniform scale toggle | `001-video-selected-basic-top.png` | has |
| Transform › Position X/Y | `001-video-selected-basic-top.png` | has |
| Transform › Rotate (field + dial) | `001-video-selected-basic-top.png` | has |
| Transform › align left/centre/right/top/middle/bottom | `001-video-selected-basic-top.png` | has |
| Section reset (↺) | `001-video-selected-basic-top.png` | has (video and photo sections) |
| Keyframe navigator on every animatable property (‹ ◇ ›) | `001-video-selected-basic-top.png` | has (video, photo, text, audio volume, effects and filters) |
| Blend › Mode: Default, Color dodge, Linear burn, Hard light, Multiply, Color burn, Overlay, Brighten, Darken, Soft light, Screen | `025-blend-mode-menu.png` | has |
| Blend › Opacity | `002-basic-blend-enhancement-controls.png` | has |
| Stabilize › Level (classic stabilisation) | `005-stabilize-options-view.png` | has (Level) |
| Reduce image noise (classic denoise) | `004-basic-enhancement-sections.png` | has |
| Remove flickers (classic deflicker) | `006-basic-ai-canvas-lower.png` | has |
| Motion blur (frame blending) | `006-basic-ai-canvas-lower.png` | has |
| Canvas › None, Blur (4 strengths), Color (swatches) | `007-basic-bottom-canvas.png`, `008-canvas-type-menu.png`, `009-canvas-blur-options.png`, `010-canvas-color-options.png` | has |
| Canvas › Pattern (OpenRip's own patterns) | `011-canvas-pattern-options.png` | has |
| Canvas › Apply to all | `007-basic-bottom-canvas.png` | has |
| Remove BG › Chroma key (colour picker, strength, shadow; expanded controls not captured) | `012-remove-background-options.png` | has (eyedropper on the picture, intensity, shadow, edge smoothing, spill) |
| Mask › Add mask, several masks per clip | `013-mask-default.png`, `25-inspector-adjustment-layer/024-multiple-masks.png` | has (checkbox, Add mask, chips and "+"; each mask cuts the clip) |
| Mask shapes › Circle, Rectangle, Stars | `013-mask-default.png` | has (circle, rectangle, 5-point star) |
| Mask shapes › Split (linear), Filmstrip (mirror) | `014-mask-split-controls.png` | has |
| Mask shapes › Heart | `013-mask-default.png` | has |
| Mask shapes › Text mask (content, font, size, B/U/I, spacing, alignment) | `015-mask-text-formatting.png` | has (system fonts; no vertical text) |
| Mask shapes › Brush (brush, eraser, size, feather, expansion) | `016-mask-brush-controls.png` | has (brush, eraser, clear; no quick brush) |
| Mask shapes › Pen (free polygon) | `017-mask-pen-controls.png` | has (anchors with curve handles) |
| Mask settings › Position, Rotation, Size W/H with link | `25-inspector-adjustment-layer/025-mask-rectangle.png` | has |
| Mask settings › Feather, Invert | `014-mask-split-controls.png`, `25-inspector-adjustment-layer/025-mask-rectangle.png` | has |
| Mask settings › Round corners, Expansion | `016-mask-brush-controls.png`, `25-inspector-adjustment-layer/026-rectangle-mask-controls.png` | has (expansion on the brush and pen; its scale unconfirmed) |
| Speed › Standard: speed slider (ticks) and 1.00x field | `020-speed-standard.png` | has (0.1–5×) |
| Speed › Duration field (set length directly) | `020-speed-standard.png` | has |
| Speed › Change audio pitch toggle | `020-speed-standard.png` | has (the engine resamples when on) |
| Speed › speed badge on the timeline clip | `020-speed-standard.png` | has ("1.00x" or "Curve" on the clip, opens the Speed tab) |
| Speed › Curve presets (Montage, Hero, Bullet, Jump cut, Flash in, Flash out) and Custom | `021-speed-curve-presets.png` | has |
| Speed › Custom curve editor (log axis 0.1×–10×, add/remove points, reset) | `022-speed-curve-editor.png` | has (add, remove, drag points, reset; harness speedui) |
| Speed › Reset footer button | `020-speed-standard.png` | has |
| Audio tab (volume, fades on the video's own audio) | `20-inspector-audio/001-basic-volume-fades.png` | has |
| Audio tab › "Audio is separated" state with Recover audio | `023-audio-separated-state.png` | has (Recover audio gives the video its sound back; harness audiosep) |
| Animation tab › In / Out / Combo with duration (OpenRip's own animations) | `21-inspector-text/020-animation-in-grid.png` (same layout) | has (In, Out and Combo with duration, OpenRip's own) |
| Adjust tab (see 6.23) | `25-inspector-adjustment-layer/*` | has |
| Crop (from the timeline toolbar): ratio Free/…/16:9/9:16, rotation slider, Reset, Confirm | `31-dialogs/039-crop-dialog.png`, `31-dialogs/040-crop-ratio-menu.png` | has (rotation straightens the picture inside the frame) |
| Mirror (horizontal flip) | `30-timeline-toolbar/032-mirrored-video-state.png` | has (Transform's Mirror and Flip, and the timeline's transform tools menu) |

Out of scope: Enhance quality, AI remove, AI expand, AI remix, Eye contact, Lip sync, Relight, Auto reframe, AI movement, Camera tracking, Remove BG › Auto removal and Custom removal, all of Retouch (`018-retouch-face-controls.png`, `019-retouch-features-controls.png`), AI stylize (`024-ai-stylize-form.png`), Velocity effects, Canvas › Brand backgrounds, CapCut canvas patterns.

### 6.18 Inspector: photo clip

Screenshots are in `19-inspector-photo/` unless a path says otherwise.

Same as video except: tabs are Video, Animation, Tracking, Adjust, AI stylize (no Audio or Speed tab), and Basic has no Stabilize. Reference: `19-inspector-photo/001-photo-selected-basic-top.png`. OpenRip status follows 6.17; the photo Tracking tab is in §6.31.

### 6.19 Inspector: audio clip

Screenshots are in `20-inspector-audio/` unless a path says otherwise.

Tabs: Basic, Voice changer, Speed.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Volume (dB) with keyframes | `001-basic-volume-fades.png` | has |
| Fade in, Fade out (s) | `001-basic-volume-fades.png` | has |
| Normalize loudness (to a target level) | `001-basic-volume-fades.png` | has (a switch in the Basic tab and in the clip menu) |
| Reduce noise (classic DSP) | `002-basic-channel-section.png` | has |
| Fill channel (copy L to R or R to L) | `002-basic-channel-section.png` | has |
| Voice changer › Voice filters with OpenRip's own DSP presets (search, favourites, Apply to all) | `003-voice-changer-library.png` | has |
| Speed (with pitch option) | not captured for audio; see 6.17 | has |

Out of scope: Enhance voice, Audio translator, Isolate voice, Voice characters, Speech to song, CapCut voice preset content.

### 6.20 Inspector: text clip

Screenshots are in `21-inspector-text/` unless a path says otherwise.

Tabs: Text (Basic, Bubble, Effects), Animation (In, Out, Loop), Tracking, Text to speech, AI avatars.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Multiline text box (pinned while rows scroll) | `004-basic-default-text.png` | has |
| Font dropdown + stepper | `004-basic-default-text.png` | has (20 fonts) |
| Font popover: search, recently used, favourites | `005-font-picker.png` | has (search, recently used, favourites) |
| Font size | `004-basic-default-text.png` | has |
| Bold, Italic, Underline | `004-basic-default-text.png` | has |
| Case: UPPER, lower, Title | `004-basic-default-text.png` | has |
| Colour well with keyframes | `004-basic-default-text.png` | has |
| Colour picker: SV square, hue bar, eyedropper, Hex/RGB, saved swatches | `006-text-color-picker.png`, `007-color-format-menu.png`, `008-color-rgb-fields.png` | has (SV square, hue bar, eyedropper, Hex or RGB, saved swatches) |
| Character spacing, Line spacing | `004-basic-default-text.png` | has |
| Alignment: horizontal and vertical | `004-basic-default-text.png` | has |
| Preset styles (OpenRip's own) | `009-basic-presets-transform.png` | has |
| Transform › Scale, Uniform scale, Position, Plane rotation, align | `009-basic-presets-transform.png`, `010-basic-transform-blend.png` | has |
| Blend › Opacity | `010-basic-transform-blend.png` | has |
| Stroke › Colour, Thickness | `011-basic-stroke-background.png`, `012-stroke-enabled-controls.png` | has |
| Background › Colour, Opacity, Rounded corners | `013-background-enabled-controls.png` | has |
| Background › style tiles, Height, Width, X/Y offset | `014-background-geometry.png` | has |
| Glow › Colour, Intensity, Range, X/Y offset | `015-glow-controls.png` | has |
| Shadow › Colour, Opacity, Blur, Distance, Angle | `016-shadow-controls.png` | has (X/Y offset in place of distance/angle) |
| Curve › Strength (curved text) | `017-curve-controls.png` | has |
| Save as preset | `004-basic-default-text.png` | has |
| Animation › In with duration | `020-animation-in-grid.png`, `021-animation-type-slide-applied.png` | has (In, Out and Loop kinds) |
| Animation › Out, Loop | `020-animation-in-grid.png` | has |
| Template text: per-paragraph text fields | `001-template-basic-paragraphs.png` | has (the group's Text template tab) |

Out of scope: Bubble and CapCut's Effects content (`018-bubble-grid.png`, `019-effects-grid.png`; the Effects tab with OpenRip's own styles is in §6.31, as is Tracking), Text to speech (`024-text-to-speech.png`), AI avatars, CapCut fonts and preset content.

### 6.21 Inspector: sticker clip

Screenshots are in `22-inspector-sticker/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Transform (scale, locked uniform scale, position, rotate, align) | `22-inspector-sticker/001-sticker-transform.png` | has (a sticker clip's Stickers tab: Transform, keyframeable) |
| Animation › In, Out, Loop with duration | `002-sticker-animation.png` | has (the clip moves the engine draws; CapCut's animation content is out of scope) |

Out of scope: CapCut animation content (Tracking is in §6.31).

### 6.22 Inspector: effect, filter and transition clips

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Effect › Details: name, per-effect parameters (e.g. Speed) with keyframes | `23-inspector-effect/001-fade-in-basic.png` | has (Intensity and each effect's own parameters) |
| Effect › Mask tab | `002-fade-in-mask.png` | has |
| Filter › name, Intensity | `24-inspector-filter/001-cool-black-inspector.png` | has |
| Filter › Intensity keyframes | `002-keyframe-hover.png` | has |
| Transition › name, Duration (slider, field, stepper) | `26-inspector-transition/001-white-flash-inspector.png` | has (name, duration and the transition's own parameters) |
| Transition › Apply to all | `26-inspector-transition/001-white-flash-inspector.png` | has |

### 6.23 Inspector: adjustment layer (also the video Adjust tab)

Screenshots are in `25-inspector-adjustment-layer/` unless a path says otherwise.


| Feature | CapCut reference | OpenRip |
|---|---|---|
| Adjustment layer clip that grades everything beneath it | `001-basic-top.png` | has (a filter-track bar with the Adjust tab's tools; the engine draws it over the composite beneath, for its duration) |
| LUT › Name (local .cube list), Intensity | `001-basic-top.png`, `002-lut-dropdown.png` | has (the project's LUTs and Import) |
| Adjust › Color: Temp, Tint, Saturation | `003-basic-color.png` | has |
| Adjust › Lightness: Exposure, Contrast, Highlight, Shadow, Whites, Blacks, Brilliance | `004-basic-scroll-2.png` | has |
| Adjust › Effects: Sharpen, Clarity, Particles, Fade, Vignette | `005-basic-scroll-3.png` | has |
| Keyframes on every slider | `003-basic-color.png` | has |
| HSL: 8 channels × Hue, Saturation, Brightness; eyedropper | `007-hsl-red.png` | has |
| Curves: Luma, Red, Green, Blue; eyedropper | `015-curves-luma.png`, `029-curves-red-full.png` | has |
| Color wheel: Primary (Shadows, Middle grey, Highlights, Offset) and Log (Shadow, Middle tone, Highlight, Offset) with Intensity and R/G/B fields | `019-color-wheel-primary.png`, `021-color-wheel-mode-dropdown.png`, `022-color-wheel-log.png`, `023-color-wheel-log-bottom.png`, `030-primary-wheels-lower-controls.png` | has |
| Mask on an adjustment layer (several masks, shapes, settings) | `024-multiple-masks.png`–`026-rectangle-mask-controls.png` | has |
| Save as preset | `001-basic-top.png` | has (to Yours in the Adjustment tab; no brand kit) |

Out of scope: Color correction, Protect skin tone (Auto adjust, Color match and Track mask are in §6.31), "Add presets to brand kit".

### 6.24 Inspector: caption clip

Screenshots are in `27-inspector-caption/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Text › "Apply to all main captions" plus the text controls (6.20) | `27-inspector-caption/001-caption-text-basic.png` | has |
| Captions › list editor: search, numbered rows, edit text in place | `002-caption-list-editor.png` | has |
| Captions › Find and replace (Replace all) | `003-caption-search-replace.png` | has |
| Word-by-word caption display styles | – | has (whole, three-word and one-word styles for word-timed captions) |

### 6.25 Inspector: multiple selection and compound clips

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Multi-select "Properties" tab: shared Transform, mixed values shown as "-", align and distribute | `29-inspector-multi/001-multiple-selection-transform.png` | has (harness multisel) |
| Multi-select of videos: tabs Video, Speed, Adjust; sub-tabs Basic, Retouch | `29-inspector-multi/002-multiple-video-context-menu.png` | has (Video, Speed, Adjust; harness multisel) |
| Multi-select menu: Group ⌘G, Create compound clip ⌥G, Create multi-camera clip, Save preset, Export selected clips (Copy/paste attributes disabled) | `29-inspector-multi/002-multiple-video-context-menu.png` | partly (Group, Create compound clip, Save preset, Export selected clips, Copy/paste attributes; no multi-camera clip) |
| Compound clip: selected compound uses the video inspector | `28-inspector-compound/001-compound-basic.png` | has |
| Compound clip: open the nested timeline, breadcrumb back | `28-inspector-compound/002-compound-open-timeline.png` | has |
| Compound clip menu: Undo compound clip ⌥⇧G, Pre-process compound clip (render it) | `28-inspector-compound/003-compound-context-menu.png` | partly (Undo compound clip and Open compound clip; no Pre-process, there is no pre-render) |

### 6.26 Timeline toolbar

Screenshots are in `30-timeline-toolbar/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Add (+) menu | `03-editor-overview/003-base-timeline-built.png` (menu not captured) | has |
| Selection tool: Select (A) | `30-timeline-toolbar/026-selection-tool-menu.png` | has |
| Selection tool: Split/blade tool (B) | `026-selection-tool-menu.png` | has (B, harness tltools) |
| Selection tool: Select leftward ([), Select rightward (]) (select every clip before/after) | `026-selection-tool-menu.png` | has (toolbar menu and the keys [ and ]) |
| Undo, Redo | `03-editor-overview/003-base-timeline-built.png` | has |
| Split at playhead | `03-editor-overview/003-base-timeline-built.png`, `028-split-video-state.png` | has |
| Delete left of playhead, Delete right of playhead | `03-editor-overview/003-base-timeline-built.png` | has (Q and W too) |
| Delete | `03-editor-overview/003-base-timeline-built.png` | has |
| Add marker (M); marker popover: name, time, 5 colours, Delete, Done | `030-marker-edit-popover.png` | has (the popover edits name, time and colour; Delete, Done) |
| Crop dialog | `31-dialogs/039-crop-dialog.png`, `31-dialogs/040-crop-ratio-menu.png` | has |
| Freeze frame (inserts a 3 s Freeze clip) | `031-clip-transform-tools-menu.png`, `033-freeze-frame-state.png` | has (harness freezeui) |
| Reverse | `031-clip-transform-tools-menu.png`, `034-reversed-video-state.png` | has |
| Mirror | `032-mirrored-video-state.png` | has |
| Rotate (90° steps) | `003-video-context-edit.png` | has |
| Record voiceover (input device, monitoring) | `31-dialogs/036-voiceover-panel.png`, `31-dialogs/037-voiceover-input-menu.png` | has (input device, input volume, Echo reduction, level meter, Mute project; harness voiceoveroptions) |
| Main-track magnet (ripple the main track) | `03-editor-overview/003-base-timeline-built.png` | has (harness tlmagnet) |
| Auto snap toggle | `03-editor-overview/003-base-timeline-built.png` | has |
| Linkage toggle and Linkage settings (which overlay types move/delete with main-track clips) | `31-dialogs/038-linkage-settings.png` | has |
| Preview axis (hover-scrub preview; video and audio, or video only) | `027-preview-axis-menu.png` | partly (video only; the video-and-audio choice is disabled) |
| Zoom to fit | `037-timeline-fit-toggles-off.png` | has (⇧Z too) |
| Zoom range from 30 s majors down to single frames | `035-timeline-zoom-minimum.png`, `036-timeline-zoom-maximum.png` | partly (zoom levels 1-10, down to 5 frames across; not single frames) |
| Zoom out, slider, zoom in | `03-editor-overview/003-base-timeline-built.png` | has |

Out of scope: toolbar buttons 12–18 (AI tools and "HD" enhance), EditPilot pill.

### 6.27 Timeline tracks, clips, ruler

Screenshots are in `30-timeline-toolbar/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Track header: type glyph | `03-editor-overview/003-base-timeline-built.png` | has |
| Track header: lock | `03-editor-overview/003-base-timeline-built.png` | has |
| Track header: hide (eye) | `03-editor-overview/003-base-timeline-built.png` | has |
| Track header: mute | `03-editor-overview/003-base-timeline-built.png` | has |
| Track "…" › Track height: Short, Default, Tall | `023-track-height-menu.png` | has (video and audio tracks; Short and Tall are 0.7× and 1.4× the row, not captured) |
| Track "…" › Audio waveform size: 30%, 60%, 100% | `024-track-waveform-size-menu.png` | has (bars 1×, 2× and 3.3× as tall; 60% and 100% not captured) |
| Cover tile on the main track, cover frame picker | `03-editor-overview/003-base-timeline-built.png`, `31-dialogs/027-cover-frame-selector.png` | has (the tile opens the cover editor; the automatic cover is the first frame until one is chosen) |
| Video thumbnails on clips | `03-editor-overview/003-base-timeline-built.png` | has |
| Audio waveforms | `03-editor-overview/003-base-timeline-built.png` | has (CapCut's bars, scale, volume line and colours: renderer/src/lib/waveform.ts) |
| Video clip's own audio waveform in a bottom band | `03-editor-overview/003-base-timeline-built.png` | has |
| Label chip with name and duration | `03-editor-overview/003-base-timeline-built.png` | has (video, photo and audio clips) |
| Colour per clip type | `31-dialogs/038-linkage-settings.png` | has (different colours) |
| Selection outline with trim handles | `03-editor-overview/003-base-timeline-built.png` | has |
| Transition handle on a cut (select, delete, drag duration) | `030-marker-edit-popover.png`, `013-transition-context-menu.png` | has (select, Delete, drag a side for the duration; harness transui) |
| Keyframe diamonds on clips | `029-scale-keyframe-graph.png` | has (on the selected clip) |
| In-timeline keyframe graph with ease presets | `029-scale-keyframe-graph.png` | has (⌥K; ease presets and handles) |
| Markers on the ruler | `030-marker-edit-popover.png` | has |
| Speed badge on clips | `020-audio-context-menu.png` | has |
| Magnetic main track pinned below scrolling overlay tracks | `22-inspector-sticker/001-sticker-transform.png` | has |
| Ruler with MM:SS labels and minor ticks | `03-editor-overview/003-base-timeline-built.png` | has |
| Playhead with head | `03-editor-overview/003-base-timeline-built.png` | has |
| Empty-timeline drop zone ("Drag material here and start to create") | `03-editor-overview/001-empty-editor.png` | has ("Drag and drop media to start creating") |
| Drag-in ghost clip and new-track indicator line | `038-drag-to-timeline-preview.png` | has (ghost clip, drop on the dashed line between tracks) |
| Horizontal scrollbar | `03-editor-overview/003-base-timeline-built.png` | has |

### 6.28 Context menus

Screenshots are in `30-timeline-toolbar/` unless a path says otherwise.

Video clip menu (`30-timeline-toolbar/001-video-context-menu.png` to `012-video-context-render.png`); other clip types reuse most items (`013-transition-context-menu.png`–`025-sticker-context-menu.png`).

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Copy ⌘C, Cut ⌘X, Delete ⌫ | `001-video-context-menu.png` | has |
| Paste (empty space) | `022-empty-space-context-menu.png` | has |
| Copy/paste attributes › Copy attributes ⌘⇧C, Paste attributes | `002-video-context-attributes.png`, `017-adjustment-attributes-submenu.png` | has |
| Edit › Freeze, Reverse, Mirror, Rotate, Crop | `003-video-context-edit.png` | has |
| Extract audio ⇧⌃S | `001-video-context-menu.png` | has (Detach audio) |
| Enhance audio › Normalize loudness; Reduce noise (classic) | `006-video-context-enhance-audio.png` | has (Normalize loudness, Reduce noise) |
| Enhance visuals › Stabilize (classic) | `007-video-context-enhance-visuals.png` | has (Stabilize, Reduce image noise, Remove flickers) |
| Enhance motion › Motion blur | `009-video-context-enhance-motion.png` | has |
| Group / Ungroup | `001-video-context-menu.png` | has |
| Create compound clip (subproject) ⌥G | `001-video-context-menu.png` | has |
| Save preset | `001-video-context-menu.png` | has |
| Export selected clips | `001-video-context-menu.png` | has (several clips too) |
| Deactivate clip (V) | `001-video-context-menu.png` | has |
| More clip actions › Replace clip, Trim clip, Open file location | `010-video-context-more-actions.png` | partly (Replace clip and Open file location; Trim clip is greyed) |
| Range › Select by clip ⇧X, Deselect | `011-video-context-range.png`, `018-adjustment-range-submenu.png` | has (also Export range) |
| Render › Whole timeline, In, Out, Delete rendering cache | `012-video-context-render.png` | missing |
| Audio clip › Auto mark beats (classic beat detection) | `020-audio-context-menu.png` | has (Auto mark beats in the clip menu: Beat 1, Beat 2, Off, Mark beat, Clear beats) |
| Sticker clip › Mirror | `025-sticker-context-menu.png` | has |
| Empty space › Close gap, Close all gaps, Select | `022-empty-space-context-menu.png` | has |
| Transition › Delete | `013-transition-context-menu.png` | has |
| Split at playhead from the menu | – (CapCut keeps it in the toolbar) | has |

Out of scope for now: EditPilot (every menu's first item), Generate captions (the clip menu's route to Auto captions, which is in scope above), Isolate voice and its submenu, Remove background, Enhance voice, Enhance quality, Adjust color › Color correction, Camera tracking, AI movement, Image to video, AI avatars, Text to speech, AI packaging.

### 6.29 Export dialog

Screenshots are in `31-dialogs/` unless a path says otherwise.

References: `31-dialogs/016-export-video-settings.png` to `026-export-caption-format-menu.png`.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Export dialog with Name and Export to + folder | `016-export-video-settings.png` | has |
| Cover preview with "Edit cover" | `016-export-video-settings.png`, `027-cover-frame-selector.png` | has (the project's cover; Edit cover opens the cover editor, `openCoverEditor()` in `lib/cover.ts`) |
| Export timeline (choose which timeline) | `016-export-video-settings.png` | has (a menu when the project has several timelines) |
| Video section on/off (export audio only) | `016-export-video-settings.png`, `023-export-audio-gif-captions.png` | has (each section has its checkbox; off greys its rows) |
| Resolution: 480P, 720P, 1080P, 2K, 4K, 8K | `017-export-resolution-menu.png` | has (8K is listed; the hardware encoder may refuse it) |
| Bit rate: Lower, Recommended, Higher | `018-export-bitrate-menu.png` | has (5 000 / 8 000 / 11 000 Kbps at 1080P 24 fps, scaled by size and rate) |
| Bit rate › Custom (Kbps) | `019-export-custom-bitrate.png` | has (held to within 10% by a constant-rate encode) |
| Codec: H.264, HEVC (with one-line descriptions) | `020-export-codec-menu.png` | has |
| Codec: HEVC with alpha, ProRes 422 / LT / HQ | `020-export-codec-menu.png` | has (ProRes 422 LT, 422, HQ, 4444 and HEVC with alpha; harness exportcodecs) |
| Format: mp4, mov | `021-export-format-menu.png` | has |
| Frame rate: 24, 25, 29.97, 30, 50, 59.94, 60 | `022-export-frame-rate-menu.png` | has (the engine renders at the chosen rate) |
| Color space (shown, follows the project) | `016-export-video-settings.png` | has (Rec. 709 SDR, read-only) |
| Audio section: MP3, WAV, AAC, FLAC | `023-export-audio-gif-captions.png`, `024-export-audio-format-menu.png` | has (sound-only files by the engine; AAC is an .m4a) |
| Export GIF: 240P, 320P, 640P | `023-export-audio-gif-captions.png`, `025-export-gif-resolution-menu.png` | has (15 fps, 256 colours a frame) |
| Export captions: SRT, TXT, UTF-8 | `023-export-audio-gif-captions.png`, `026-export-caption-format-menu.png` | has (the timeline's texts) |
| Footer: duration and estimated file size | `016-export-video-settings.png` | has (bit rate × length, live) |

Out of scope: Sync exported videos to space, Check copyright, premium markers on GIF and caption options.

### 6.30 Other dialogs

Screenshots are in `31-dialogs/` unless a path says otherwise.

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Cover › Select from video (frame scrubber) | `31-dialogs/027-cover-frame-selector.png` | has (engine frame at a scrubber over a filmstrip; harness `covereditor`) |
| Cover › Local image | `027-cover-frame-selector.png` | has |
| Cover › basic text on the cover | `029-cover-design-text.png`, `035-cover-exit-confirmation.png` | has (title, subtitle, body text; drag, words, size, colour, bold; Save, Cancel with Exit editing?; templates, stickers and AI left out) |
| Voiceover panel: record, timer, level meter, input device, input volume, Echo reduction, Mute project | `036-voiceover-panel.png`, `037-voiceover-input-menu.png` | has |
| Native file dialogs for media and caption import | `012-import-file-dialog.png`, `013-import-captions-file-dialog.png` | has (media and caption files) |
| Confirm before discarding unsaved edits | `035-cover-exit-confirmation.png` | has (alert dialog for deletes; editor autosaves) |

Out of scope: cover design templates, stickers, AI design panel, AI image tools, Brand kit, Frames (`028-cover-design-templates.png`, `030-cover-design-stickers.png`–`034-cover-ai-tools-menu.png`); Feedback (`002-feedback-default.png`–`005-feedback-issue-bottom.png`); Network testing (`011-network-status.png`); local-network permission prompt (`001-local-network-permission.png`); voiceover Enhance voice.

### 6.31 Classic-algorithm features brought into scope (2026-10-18)

CapCut's versions of these are listed under AI or left out above; each has a classic, non-ML method that does the same job, so OpenRip builds that (the rule in §6's preamble).

| Feature | CapCut reference | OpenRip |
|---|---|---|
| Split scenes: cut a clip at its shot changes (Media and clip menus) | `30-timeline-toolbar/001-video-context-menu.png` | has (the clip menu and the media card) |
| Optical flow (Video ▸ Basic): frames blended along motion for smoother low frame rates | `18-inspector-video/004-basic-enhancement-sections.png` | has (preview and export; the frame-rate select is inferred because CapCut's panel was not captured) |
| Speed ▸ Smooth slow-mo: in-between frames by motion interpolation when slowed down | `18-inspector-video/020-speed-standard.png` | has (preview and export; its Mode select is inferred, CapCut's panel not captured; harness slowmo) |
| Text ▸ Tracking: a text follows a point or region of the video under it | `21-inspector-text/022-tracking-default.png`, `023-motion-tracking-options.png` | has (follows a point or region; adds a Rotation toggle CapCut lacks; harness tracking) |
| Sticker ▸ Tracking | `22-inspector-sticker/001-sticker-transform.png` (its tab row) | has (same tab as text) |
| Photo/overlay ▸ Tracking | `19-inspector-photo/001-photo-selected-basic-top.png` | has (same tab as text) |
| Mask ▸ Track mask: the mask follows the tracked region, with its direction menu | `25-inspector-adjustment-layer/026-rectangle-mask-controls.png`, `027-mask-track-direction-menu.png`, `028-mask-tracking-bottom.png` | has (the mask follows the tracked region; CapCut's Hide behaviour is unknown) |
| Adjust ▸ Auto adjust: levels, white balance and contrast set from the clip's own statistics | `25-inspector-adjustment-layer/001-basic-top.png`, `30-timeline-toolbar/008-video-context-adjust-color.png` | has (on the Adjust tab and the clip menu; it lists the values it set; harness colormatch) |
| Adjust ▸ Color match: a clip graded to match a reference frame's colour statistics | `25-inspector-adjustment-layer/001-basic-top.png`, `30-timeline-toolbar/008-video-context-adjust-color.png` | has (the reference is picked from a dropdown, not by clicking a clip) |
| Smart suggestions ▸ Make colors consistent: every clip matched to one reference | `17-inspector-project/011-project-smart-suggestions.png` | has (Project tab ▸ Global edits; one undo step) |
| Transcript: the clip's words from a local speech model, editing the video by its text (in scope since 2026-10-19) | `05-left-media/006-media-item-context-menu.png` | has (Captions ▸ Transcript; clip and media-card menus; delete words, remove fillers and pauses) |
| Text ▸ Effects with OpenRip's own styles (CapCut's content stays out) | `21-inspector-text/019-effects-grid.png` | has (the Effects sub-tab of the Text tab; harness textstyles) |

## 7. Gaps in the captures (recapture list)

**Status.** `summary.md` and `frontier.md` are final: the capture pass finished with 395 primary screenshots, no open checklist items, and documented exclusions. It is a representative distinct-UI archive, not every category, tooltip string or destination. The gaps below are what this spec still finds thin. Items marked † block a spec decision; the rest are nice to have.

**Editor layout and chrome**
1. † Window resize: every capture is at 1512×949. Capture the editor at a smaller and a larger window, and mid-drag on a gutter, to confirm which panels flex and the minimum sizes (§1.2 is inferred from the presets).
2. Top bar: project-title click/rename and the keyboard icon's popover or tooltip.
3. Tooltips anywhere in the editor: none were captured (the archive omits tooltip-only variants by design). Every timeline toolbar name in §4.9 is inferred from its glyph or menu.

**Player**
4. Header menu › Color oscilloscope and Guides and rulers submenus shown open (`16-player/002` shows only hover; their end states are in `009` and `010`). Per the summary, there is no canvas context menu away from a guide, and no safe-area control was found in the player menus.

**Left panel**
5. † Adjustment › LUT view: `13-left-adjustment/003-lut.png` still shows Yours › Brand presets.
6. Hover states for left-panel tabs and secondary-sidebar items.
7. Audio › Import: only the Extract audio card is visible; confirm whether there is an Import card.

**Inspector**
8. † Video › Animation and Video › Adjust tabs for a video clip (the frontier says they reuse the text and adjustment layouts; one capture each would confirm the tab contents).
9. † Remove BG › Chroma key expanded (in scope for OpenRip): colour picker, strength, shadow controls.
10. Stabilize › Level values and Audio › Fill channel values (both captured disabled).
11. Mask shapes Filmstrip, Circle, Stars, Heart controls; Curves Green and Blue blocks; Effect › Mask loaded state (`23-inspector-effect/002` is mid-load).
12. Audio clip › Speed tab; colour picker "My colors" open; Text › Preset style expanded; caption-list icon tooltips.

**Timeline**
13. The "+" (Add) menu at the toolbar's left end.
14. † Edit results still missing: linked vs unlinked audio, trim-handle hover, magnet on vs off after a delete, marquee selection, the snap line while dragging. (Split, freeze, reverse, mirror, keyframe graph, markers, compound clips, zoom limits and the drag ghost are now captured.)
15. Hover and pressed states for toolbar buttons, toggles and track-header icons.
16. The unexplained bottom-centre pill on the timeline's lower edge and the blue bar under the main clip (`22-inspector-sticker/001`).

**States**
17. † `32-states/004-media-search-no-match.png` shows the query typed but all items still listed; recapture the media no-match state.
18. Keyboard focus rings anywhere (Tab through a dialog and the inspector).
19. Hover and focus on inspector fields, sliders and tiles.

**Dialogs and lists**
20. Export › Codec list is cut off after ProRes 422 HQ (`31-dialogs/020-export-codec-menu.png`); the blend-mode and project frame-rate lists may also continue off-screen (`18-inspector-video/025-blend-mode-menu.png`, `17-inspector-project/007-frame-rate-dropdown.png`).
21. Shortcuts: a row in edit mode with a conflict warning would settle conflict handling.

**Artefacts to ignore:** a teal circular ✓ bubble over the search field in `01-home/016`, `017`, `05-left-media/011`, `09-left-effects/045` and `32-states/004` comes from the capture session, not CapCut.

**Excluded by the capture rules** (OpenRip designs these itself): export progress and completion, recording in progress, any AI job state, Trash restore/delete, settings changes, account and sync flows, legal and support pages, further Home launch destinations.

**Resolved since the first draft:** compound clip inspector, nested timeline and menu (`28-inspector-compound/001`–`003`); multi-selection context menu (`29-inspector-multi/002`); Freeze/Reverse/Mirror/Rotate dropdown (`30-timeline-toolbar/031`, recaptured); freeze and reverse results (`033`, `034`); zoom minimum, maximum and fit (`035`–`037`); drag-in preview (`038`); player rulers (`16-player/010`); editor File and Edit menus (`00-menu-bar/008`, `009`); walkthrough coach mark (`31-dialogs/042`); `0548`–`0549` replaced by `30-timeline-toolbar/025` and `026`.
