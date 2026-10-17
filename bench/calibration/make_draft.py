"""Build calibration sessions as CapCut drafts, so nobody has to assemble them by hand.

Session 1's draft (made by hand in CapCut 9.5) is the template: its photo and text
segments are cloned with fresh ids and re-timed, so every field CapCut expects is present.

    python3 make_draft.py --template <session-1 draft dir> [--root <drafts folder>] [--register] [--replace] <session>...

Writes <drafts folder>/<session> for each session (default folder: next to the template).
--register also adds them to CapCut's root_meta_info.json (backed up first) so they show on
the home screen; CapCut must be closed then, because it rewrites that file on exit.
--replace rebuilds sessions that already exist instead of skipping them.

The drafts' images are copied to ~/Movies/openrip-calibration-media (--media-dir) and
referenced there. CapCut is sandboxed: it may read ~/Movies, but a file elsewhere only
after the user picks it in CapCut, so images referenced from this folder show as missing.
"""
import argparse
import copy
import json
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SEC = 1_000_000
MARKER_1TO1 = 400 / 1080  # marker.png drawn texel-for-texel on a 1080-high canvas
MEDIA_DIR = Path.home() / "Movies" / "openrip-calibration-media"


@dataclass
class Img:
    media: str
    start: float
    dur: float
    scale: float = 1.0
    rot: float = 0.0
    dx_px: float = 0.0  # offset from centre in canvas pixels, +x right
    dy_px: float = 0.0  # +y up
    alpha: float = 1.0
    adjust: tuple = ()  # (CapCut adjust type, value -1..1) pairs, e.g. (("brightness", 0.5),)
    mask: dict = None  # rectangle mask config overrides (CapCut's common_mask "config" keys)


@dataclass
class Txt:
    start: float
    dur: float
    size: float
    stroke: float = 0.0  # CapCut stroke width (black), 0 = none
    background: float = 0.0  # CapCut background width/height (black, opaque, style 2, radius 0.4: the common real-world case), 0 = none
    text: str = ""  # replaces the template's text ("Default text") when set
    anim: str = ""  # library intro animation by resource id (see ANIMS), cloned from an existing draft
    anim_dur: float = 0.0
    fixed_width: float = -1.0  # CapCut text box width (-1 = auto-sized box)
    scale: float = 1.0
    bold: bool = False  # CapCut's B button (bold_width 0.008)
    italic: bool = False  # CapCut's I button (italic_degree 10)
    curve: float = 0.0  # CapCut's curved text angle (text_curve), 0 = straight


@dataclass
class Sticker:
    resource: str  # CapCut sticker resource id, cloned from an existing draft that uses it
    start: float
    dur: float
    scale: float = 1.0
    dx_px: float = 0.0
    dy_px: float = 0.0


# Library text intros used in the drafts, by CapCut resource id.
ANIMS = {"type_1": "6724920249654710791", "type_2": "6724920636403094028", "typewriter": "7210980292243231233"}
_LINE = "OpenRip types this line"
_CURVE = "OpenRip bends this line"
# Library stickers in the local drafts: three PNGs (465×466, 540×540, 471×540) and a GIF (280×280).
STICKERS = {"png_a": "7314575603322146056", "png_b": "7388438985074330887", "png_c": "7227150928544140550", "gif": "7505300385456819517"}
_RECT = dict(width=0.5, height=0.3)
_WRAP = "one two three four five six seven eight nine ten eleven twelve thirteen"


# Session 4: one Adjust slider per clip on the chart, to measure CapCut's colour formulas.
_ADJ4 = [("brightness", v) for v in (-1, -0.5, 0.5, 1)] + [("contrast", v) for v in (-1, -0.5, 0.5, 1)] + \
        [("saturation", v) for v in (-1, -0.5, 0.5, 1)] + [("temperature", v) for v in (-1, -0.5, 0.5, 1)] + \
        [(t, v) for t in ("tone", "highlight", "shadow", "white", "black", "light_sensation") for v in (-1, 1)] + \
        [(t, v) for t in ("fade", "sharpen", "clear", "vignetting") for v in (0.5, 1)]

SESSIONS = {
    "openrip-calibration-2": dict(canvas=(1920, 1080, "16:9"), tracks=[
        [Img("pattern.png", 0, 1), Img("pattern.png", 1, 1, 0.5), Img("pattern.png", 2, 1, 0.5, 45)],
        [Txt(3, 1, 15), Txt(4, 1, 30), Txt(5, 1, 10)],
    ]),
    # Resampling at other factors, image borders over a grey background, sub-pixel offset,
    # opacity; then text stroke and background widths over grey.
    "openrip-calibration-3": dict(canvas=(1920, 1080, "16:9"), tracks=[
        [Img("grey.png", 0, 14)],
        [Img("pattern.png", 0, 1, 0.25), Img("pattern.png", 1, 1, 0.375), Img("pattern.png", 2, 1, 0.75),
         Img("pattern.png", 3, 1, 1.5), Img("marker.png", 4, 1, MARKER_1TO1), Img("marker.png", 5, 1, MARKER_1TO1, 30),
         Img("marker.png", 6, 1, 0.5), Img("marker.png", 7, 1, 0.5, 30), Img("marker.png", 8, 1, 0.25),
         Img("marker.png", 9, 1, MARKER_1TO1, 0, 0.37, -0.25), Img("pattern.png", 10, 1, alpha=0.5)],
        [Txt(11, 1, 15, stroke=0.06), Txt(12, 1, 15, stroke=0.15), Txt(13, 1, 15, background=0.28)],
    ]),
    "openrip-calibration-4": dict(canvas=(1920, 1080, "16:9"), tracks=[
        [Img("pattern.png", 0, 1)] + [Img("pattern.png", 1 + i, 1, adjust=(a,)) for i, a in enumerate(_ADJ4)],
    ]),
    # Text intros (character timing, and the typewriter's caret), then line wrapping: the
    # same words in boxes of several fixed widths and clip scales, and an auto-sized box.
    "openrip-calibration-5": dict(canvas=(1080, 1920, "9:16"), tracks=[
        [Img("black.png", 0, 23)],
        # Size 11 keeps the line (767 px) inside the canvas, so nothing wraps or overflows.
        [Txt(0, 3, 11, text=_LINE, anim="type_1", anim_dur=2), Txt(3, 3, 11, text=_LINE, anim="type_2", anim_dur=2),
         Txt(6, 3, 11, text=_LINE, anim="typewriter", anim_dur=2), Txt(9, 2, 15, text="in the park", anim="typewriter", anim_dur=1 / 3),
         Txt(11, 1, 15, text=_WRAP, fixed_width=600), Txt(12, 1, 15, text=_WRAP, fixed_width=600, scale=0.6),
         Txt(13, 1, 15, text=_WRAP, fixed_width=900), Txt(14, 1, 10, text=_WRAP, fixed_width=600),
         Txt(15, 1, 15, text=_WRAP), Txt(16, 1, 15, text="one two three\n" + _WRAP, fixed_width=600),
         Txt(17, 1, 15, text=_LINE + " " + _LINE, background=0.28, fixed_width=600), Txt(18, 2, 11, text=_LINE, anim="type_1", anim_dur=2, stroke=0.08),
         Txt(20, 1, 30, text="Bold", bold=True), Txt(21, 1, 30, text="Bold"), Txt(22, 1, 30, text="Italic", italic=True)],
    ]),
    # Landscape: does the fixed width scale with the canvas width?
    "openrip-calibration-5-landscape": dict(canvas=(1920, 1080, "16:9"), tracks=[
        [Img("black.png", 0, 3)],
        [Txt(0, 1, 15, text=_WRAP, fixed_width=600), Txt(1, 1, 15, text=_WRAP, fixed_width=1200), Txt(2, 1, 8, text=_WRAP)],
    ]),
    # Masks on the pattern (rectangle: turned, feathered, rounded, inverted), library stickers
    # at known scales (PNG and GIF), and curved text at several angles.
    "openrip-calibration-6": dict(canvas=(1080, 1920, "9:16"), tracks=[
        [Img("pattern.png", 0, 1, mask=_RECT), Img("pattern.png", 1, 1, mask=_RECT | dict(rotation=30)),
         Img("pattern.png", 2, 1, mask=_RECT | dict(feather=0.3)), Img("pattern.png", 3, 1, mask=_RECT | dict(feather=1.0)),
         Img("pattern.png", 4, 1, mask=_RECT | dict(roundCorner=0.5)), Img("pattern.png", 5, 1, mask=_RECT | dict(roundCorner=1.0)),
         Img("pattern.png", 6, 1, mask=_RECT | dict(invert=True)),
         Img("pattern.png", 7, 1, mask=_RECT | dict(centerX=0.3, centerY=-0.2, rotation=45, feather=0.2, roundCorner=0.3))],
        [Sticker("png_a", 8, 1), Sticker("png_b", 9, 1), Sticker("png_c", 10, 1), Sticker("png_b", 11, 1, 0.5, 200, 300), Sticker("gif", 12, 3)],
        [Txt(15, 1, 15, text=_CURVE, curve=60), Txt(16, 1, 15, text=_CURVE, curve=120), Txt(17, 1, 15, text=_CURVE, curve=180),
         Txt(18, 1, 15, text=_CURVE, curve=-90), Txt(19, 1, 15, text=_CURVE, curve=360)],
    ]),
    # Landscape: does a sticker's size follow the canvas width or height?
    "openrip-calibration-6-landscape": dict(canvas=(1920, 1080, "16:9"), tracks=[
        [Img("black.png", 0, 2)],
        [Sticker("png_b", 0, 1), Sticker("gif", 1, 1)],
    ]),
    # Portrait canvas: text size vs width or longer side; pattern contain-fit at 1080/1920 = 0.5625.
    "openrip-calibration-3-portrait": dict(canvas=(1080, 1920, "9:16"), tracks=[
        [Img("pattern.png", 0, 1), Img("marker.png", 1, 1, MARKER_1TO1), Img("black.png", 2, 1)],
        [Txt(2, 1, 15)],
    ]),
}


def new_id(lower=False):
    s = str(uuid.uuid4())
    return s if lower else s.upper()


def material_index(materials):
    return {m["id"]: (kind, m) for kind, items in materials.items() if isinstance(items, list) for m in items if isinstance(m, dict) and "id" in m}


def clone_segment(seg, index, materials, main):
    """Clone a segment and every material it references, with fresh ids."""
    kind, mat = index[seg["material_id"]]
    seg = copy.deepcopy(seg)
    seg["id"] = new_id()
    main = copy.deepcopy(main if main is not None else mat)
    main["id"] = new_id()
    materials[kind].append(main)
    seg["material_id"] = main["id"]
    refs = []
    for ref in seg["extra_material_refs"]:
        rkind, rmat = index[ref]
        rmat = copy.deepcopy(rmat)
        rmat["id"] = new_id()
        materials[rkind].append(rmat)
        refs.append(rmat["id"])
    seg["extra_material_refs"] = refs
    return seg, main


def us(seconds):
    return round(seconds * SEC)


def adjust_templates(root: Path, kinds):
    """One Adjust effect material of each kind, from existing drafts (read only)."""
    found = {}
    for f in sorted(root.glob("*/draft_info.json")):
        try:
            effects = json.loads(f.read_text()).get("materials", {}).get("effects", [])
        except (OSError, ValueError):
            continue
        for e in effects:
            if e.get("type") in kinds and e["type"] not in found and Path(e.get("path", "")).exists():
                found[e["type"]] = e
        if len(found) == len(kinds):
            break
    missing = set(kinds) - set(found)
    if missing:
        raise SystemExit(f"no existing draft uses these Adjust sliders, so there is no template: {sorted(missing)}")
    return found


def anim_templates(root: Path, wanted):
    """One animation entry per wanted resource id, from existing drafts (read only), whose
    downloaded bundle is still in CapCut's cache."""
    found = {}
    for f in sorted(root.glob("*/draft_info.json")):
        try:
            mats = json.loads(f.read_text()).get("materials", {}).get("material_animations", [])
        except (OSError, ValueError):
            continue
        for m in mats:
            for a in m.get("animations", []):
                if a.get("resource_id") in wanted and a["resource_id"] not in found and Path(a.get("path", "")).exists():
                    found[a["resource_id"]] = a
    missing = set(wanted) - set(found)
    if missing:
        raise SystemExit(f"no existing draft uses these animations, so there is no template: {sorted(missing)}")
    return found


def mask_template(root: Path):
    """A rectangle mask material from an existing draft (read only) whose bundle is cached."""
    for f in sorted(root.glob("*/draft_info.json")):
        try:
            masks = json.loads(f.read_text()).get("materials", {}).get("common_mask", [])
        except (OSError, ValueError):
            continue
        for m in masks:
            if m.get("resource_type") == "rectangle" and Path(m.get("path", "")).exists():
                return m
    raise SystemExit("no existing draft uses a rectangle mask, so there is no template")


def sticker_templates(root: Path, wanted):
    """Per sticker resource id: a segment using it, its material, the materials the segment
    references and its track, from an existing draft (read only) whose bundle is cached."""
    found = {}
    for f in sorted(root.glob("*/draft_info.json")):
        try:
            d = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        index = material_index(d.get("materials", {}))
        for track in d.get("tracks", []):
            if track.get("type") != "sticker":
                continue
            for seg in track["segments"]:
                kind, mat = index.get(seg["material_id"], (None, None))
                rid = (mat or {}).get("resource_id")
                if kind == "stickers" and rid in wanted and rid not in found and Path(mat.get("path", "")).exists():
                    found[rid] = (seg, mat, [index[r] for r in seg["extra_material_refs"] if r in index], track)
    missing = set(wanted) - set(found)
    if missing:
        raise SystemExit(f"no existing draft uses these stickers, so there is no template: {sorted(missing)}")
    return found


def stage(fname, media_dir: Path):
    """Copy a calibration image where sandboxed CapCut can read it; returns the copy's path."""
    src, dst = HERE / fname, media_dir / fname
    if not dst.exists() or dst.read_bytes() != src.read_bytes():
        media_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    return dst


def build(name, spec, template: Path, root: Path, media_dir: Path, replace=False):
    src = json.loads((template / "draft_info.json").read_text())
    kinds = {k for tr in spec["tracks"] for c in tr if isinstance(c, Img) for k, _ in c.adjust}
    adjusts = adjust_templates(template.parent, kinds) if kinds else {}
    wanted = {ANIMS[c.anim] for tr in spec["tracks"] for c in tr if isinstance(c, Txt) and c.anim}
    anims = anim_templates(template.parent, wanted) if wanted else {}
    mask_tpl = mask_template(template.parent) if any(isinstance(c, Img) and c.mask for tr in spec["tracks"] for c in tr) else None
    wanted_stickers = {STICKERS[c.resource] for tr in spec["tracks"] for c in tr if isinstance(c, Sticker)}
    stickers = sticker_templates(template.parent, wanted_stickers) if wanted_stickers else {}
    index = material_index(src["materials"])
    photo_track = next(t for t in src["tracks"] if t["type"] == "video" and t["segments"] and index[t["segments"][0]["material_id"]][1].get("type") == "photo")
    text_track = next(t for t in src["tracks"] if t["type"] == "text")
    photo_tpl = index[photo_track["segments"][0]["material_id"]][1]
    W, H, ratio = spec["canvas"]
    duration = max(us(c.start + c.dur) for tr in spec["tracks"] for c in tr)

    d = copy.deepcopy(src)
    d["materials"] = {k: ([] if isinstance(v, list) else v) for k, v in src["materials"].items()}
    timeline_id = new_id()
    d.update(id=timeline_id, duration=duration, fps=30.0, canvas_config={"ratio": ratio, "width": W, "height": H, "background": None})

    media = {}  # file name -> (path, w, h)
    tracks, video_tracks = [], 0
    for ti, clips in enumerate(spec["tracks"]):
        if isinstance(clips[0], Img):
            track = {k: v for k, v in photo_track.items() if k != "segments"} | {"id": new_id(), "attribute": 0, "flag": 0 if video_tracks == 0 else 2, "segments": []}
            for c in clips:
                if c.media not in media:
                    path = stage(c.media, media_dir)
                    media[c.media] = (path, *Image.open(path).size)
                path, w, h = media[c.media]
                photo = copy.deepcopy(photo_tpl) | {"path": str(path), "width": w, "height": h, "material_name": c.media}
                seg, _ = clone_segment(photo_track["segments"][0], index, d["materials"], photo)
                seg.update(target_timerange={"start": us(c.start), "duration": us(c.dur)}, source_timerange={"start": 0, "duration": us(c.dur)},
                           track_render_index=ti, render_index=video_tracks)
                seg["clip"].update(scale={"x": c.scale, "y": c.scale}, rotation=c.rot, alpha=c.alpha,
                                   transform={"x": c.dx_px / (W / 2), "y": c.dy_px / (H / 2)})
                for kind, value in c.adjust:
                    effect = copy.deepcopy(adjusts[kind]) | {"id": new_id(), "value": value}
                    d["materials"]["effects"].append(effect)
                    seg["extra_material_refs"].append(effect["id"])
                    seg["enable_adjust"] = True
                if c.mask:
                    mask = copy.deepcopy(mask_tpl) | {"id": new_id()}
                    mask["config"] = mask["config"] | {"centerX": 0.0, "centerY": 0.0, "rotation": 0.0, "feather": 0.0, "roundCorner": 0.0, "invert": False} | c.mask
                    d["materials"].setdefault("common_mask", []).append(mask)
                    seg["extra_material_refs"].append(mask["id"])
                track["segments"].append(seg)
            video_tracks += 1
        elif isinstance(clips[0], Sticker):
            src_track = stickers[STICKERS[clips[0].resource]][3]
            track = {k: v for k, v in src_track.items() if k != "segments"} | {"id": new_id(), "segments": []}
            for c in clips:
                tseg, tmat, trefs, _ = stickers[STICKERS[c.resource]]
                seg = copy.deepcopy(tseg) | {"id": new_id()}
                mat = copy.deepcopy(tmat) | {"id": new_id()}
                d["materials"].setdefault("stickers", []).append(mat)
                seg["material_id"] = mat["id"]
                refs = []
                for rkind, rmat in trefs:
                    rmat = copy.deepcopy(rmat) | {"id": new_id()}
                    d["materials"].setdefault(rkind, []).append(rmat)
                    refs.append(rmat["id"])
                seg["extra_material_refs"] = refs
                seg.update(target_timerange={"start": us(c.start), "duration": us(c.dur)}, source_timerange={"start": 0, "duration": us(c.dur)},
                           track_render_index=ti, render_index=14000 + ti, common_keyframes=[])
                seg["clip"].update(scale={"x": c.scale, "y": c.scale}, rotation=0.0, alpha=1.0,
                                   transform={"x": c.dx_px / (W / 2), "y": c.dy_px / (H / 2)})
                track["segments"].append(seg)
        else:
            track = {k: v for k, v in text_track.items() if k != "segments"} | {"id": new_id(), "segments": []}
            for c in clips:
                seg, text = clone_segment(text_track["segments"][0], index, d["materials"], None)
                content = json.loads(text["content"])
                if c.text:
                    content["text"] = c.text
                    for style in content["styles"]:
                        style["range"] = [0, len(c.text)]
                for style in content["styles"]:
                    style["size"] = c.size
                    if c.bold:
                        style["bold"] = True
                    if c.italic:
                        style["italic"] = True
                    if c.stroke:
                        style["strokes"] = [{"content": {"render_type": "solid", "solid": {"color": [0, 0, 0]}}, "width": c.stroke, "mode": 0}]
                text.update(content=json.dumps(content, separators=(",", ":")), font_size=c.size, text_size=round(c.size * 2), fixed_width=c.fixed_width,
                            bold_width=0.008 if c.bold else 0.0, italic_degree=10 if c.italic else 0)
                if c.curve:
                    text["text_curve"] = {"enable": True, "angle": c.curve}
                if c.background:
                    # CapCut draws the box only with check_flag bit 0x10 (calibration session 3).
                    text.update(background_color="#000000", background_alpha=1.0, background_style=2, background_round_radius=0.4,
                                background_width=c.background, background_height=c.background, background_vertical_offset=0.0, background_horizontal_offset=0.0,
                                check_flag=int(text.get("check_flag", 7)) | 0x10)
                seg.update(target_timerange={"start": us(c.start), "duration": us(c.dur)}, track_render_index=ti)
                seg["clip"]["scale"] = {"x": c.scale, "y": c.scale}
                if c.anim:
                    entry = copy.deepcopy(anims[ANIMS[c.anim]]) | {"start": 0, "duration": us(c.anim_dur)}
                    holder = next(m for m in d["materials"]["material_animations"] if m["id"] in seg["extra_material_refs"])
                    holder["animations"] = [entry]
                track["segments"].append(seg)
        tracks.append(track)
    d["tracks"] = tracks

    out = root / name
    if out.exists():
        if not replace:
            print(f"skip {out}: already exists (--replace rebuilds it)")
            return None
        shutil.rmtree(out)
    (out / "Timelines" / timeline_id).mkdir(parents=True)
    body = json.dumps(d, ensure_ascii=False, separators=(",", ":"))
    (out / "draft_info.json").write_text(body)
    (out / "Timelines" / timeline_id / "draft_info.json").write_text(body)

    now_us = int(time.time() * SEC)
    project = json.loads((template / "Timelines" / "project.json").read_text())
    project.update(id=new_id(), main_timeline_id=timeline_id, create_time=now_us, update_time=now_us,
                   timelines=[project["timelines"][0] | {"id": timeline_id, "create_time": now_us, "update_time": now_us}])
    (out / "Timelines" / "project.json").write_text(json.dumps(project, separators=(",", ":")))
    (out / "timeline_layout.json").write_text(json.dumps({"dockItems": [{"dockIndex": 0, "ratio": 1, "timelineIds": [timeline_id], "timelineNames": ["Timeline 01"]}], "layoutOrientation": 1}))

    meta = json.loads((template / "draft_meta_info.json").read_text())
    entry_tpl = next(e for e in meta["draft_materials"][0]["value"] if e.get("metetype") == "photo")
    entries = []
    for fname, (path, w, h) in media.items():
        entries.append(copy.deepcopy(entry_tpl) | dict(id=new_id(lower=True), file_Path=str(path), extra_info=fname, width=w, height=h,
                                                         create_time=now_us // SEC, import_time=now_us // SEC, import_time_ms=now_us))
    meta["draft_materials"][0]["value"] = entries
    draft_id = new_id()
    size = sum(p.stat().st_size for p, _, _ in media.values())
    meta.update(draft_id=draft_id, draft_name=name, draft_fold_path=str(out), draft_root_path=str(root),
                tm_draft_create=now_us, tm_draft_modified=now_us, tm_duration=duration, draft_timeline_materials_size_=size)
    (out / "draft_meta_info.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
    store = {"draft_materials": [], "draft_virtual_store": [
        {"type": 0, "value": [{"creation_time": 0, "display_name": "", "filter_type": 0, "id": "", "import_time": 0, "import_time_us": 0, "material_color_tag": "", "sort_sub_type": 0, "sort_type": 0, "subdraft_filter_type": 0}]},
        {"type": 1, "value": [{"child_id": e["id"], "parent_id": ""} for e in entries]}, {"type": 2, "value": []}]}
    (out / "draft_virtual_store.json").write_text(json.dumps(store, separators=(",", ":")))
    (out / "draft_settings").write_text(f"[General]\ncloud_last_modify_platform=mac\ndraft_create_time={now_us // SEC}\ndraft_last_edit_time={now_us // SEC}\nreal_edit_keys=0\nreal_edit_seconds=0\n")
    cover = next(iter(media.values()))[0] if "pattern.png" not in media else media["pattern.png"][0]
    Image.open(cover).convert("RGB").resize((480, round(480 * H / W))).save(out / "draft_cover.jpg", quality=85)
    print(f"wrote {out}")
    return dict(draft_id=draft_id, out=out, now_us=now_us, duration=duration, size=size, name=name)


def register(root: Path, template: Path, built):
    meta_path = root / "root_meta_info.json"
    backup = HERE / "out" / "root_meta_info.backup.json"
    backup.parent.mkdir(exist_ok=True)
    shutil.copy2(meta_path, backup)
    rootmeta = json.loads(meta_path.read_text())
    like = next(e for e in rootmeta["all_draft_store"] if e["draft_fold_path"] == str(template))
    for b in built:
        stale = [e for e in rootmeta["all_draft_store"] if e["draft_fold_path"] == str(b["out"])]
        rootmeta["all_draft_store"] = [e for e in rootmeta["all_draft_store"] if e not in stale]
        e = copy.deepcopy(like)
        e.update(draft_cover=str(b["out"] / "draft_cover.jpg"), draft_fold_path=str(b["out"]), draft_id=b["draft_id"],
                 draft_json_file=str(b["out"] / "draft_info.json"), draft_name=b["name"], tm_draft_create=b["now_us"],
                 tm_draft_modified=b["now_us"], tm_duration=b["duration"], draft_timeline_materials_size=b["size"])
        rootmeta["all_draft_store"].insert(0, e)
        rootmeta["draft_ids"] += 0 if stale else 1
    meta_path.write_text(json.dumps(rootmeta, ensure_ascii=False, separators=(",", ":")))
    print(f"registered {len(built)} draft(s) in {meta_path} (backup: {backup})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", type=Path, required=True, help="session 1 draft folder")
    ap.add_argument("--root", type=Path, help="drafts folder to write into (default: the template's)")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--replace", action="store_true", help="rebuild sessions that already exist")
    ap.add_argument("--media-dir", type=Path, default=MEDIA_DIR, help="where the images are copied for CapCut to read")
    ap.add_argument("sessions", nargs="+", choices=sorted(SESSIONS))
    a = ap.parse_args()
    template = a.template.resolve()
    root = (a.root or template.parent).resolve()
    built = [b for s in a.sessions if (b := build(s, SESSIONS[s], template, root, a.media_dir.expanduser().resolve(), a.replace))]
    if a.register and built:
        register(root, template, built)
