// The right-click menu on a clip, shared by the Konva timeline and the canvas one so both
// give the same items, in the same order, with the same enabling. A compound clip on its
// own gets its own hand-built menu.
import { useClipStore } from "@/lib/clip";
import { useControlsStore } from "@/lib/control";
import type { AnyClipProps, VideoClipProps } from "@/lib/types";
import { freezeTarget } from "@/lib/timeline-motion";
import { rotate90, toggleFlip } from "@/lib/transform-presets";
import { rangeByClip } from "@/lib/timeline-shortcuts";
import { OPEN_CROP_EVENT } from "@/lib/crop";
import { openRangeExport } from "@/lib/export-scope";
import { deleteRenderingCache, renderTimeline } from "@/lib/prerender";
import { soundMenuItems } from "@/lib/audio-tools";
import { analysisMenuItems } from "@/lib/analysis";
import { enhanceMenuItems, withEnhance } from "@/lib/enhance";
import { attributeMenuItems } from "@/lib/clip-presets";
import { captionMenuItems, useAutoCaptions } from "@/lib/autocaptions";
import { extractCompoundAudio, openCompoundTranscript } from "@/lib/compound-actions";
import { transcriptMenuItems } from "@/lib/transcript";
import { useContextMenuStore, ContextMenuItem } from "@/lib/context-menu";
import { canReplaceClip, replaceClip, revealClipFile } from "@/lib/replace-clip";
import { canTrimClip, useTrimClip } from "@/lib/trim-clip";
import { isCompound } from "@/lib/compound";
import { canGroup } from "@/lib/bundle";
import { openCompound } from "@/lib/compound-edit";

/** Opens the clip menu at the pointer, selecting the clip first if it isn't in the selection. */
export function openClipMenu(clipId: string, clientX: number, clientY: number) {
  // Select this clip if it's not already part of the selection
  const sel = useControlsStore.getState().selectedClipIds || [];
  if (!sel.includes(clipId)) {
    useControlsStore.getState().setSelectedClipIds([clipId]);
  }
  // Use global context menu store
  const controls = useControlsStore.getState();
  const clipsState = useClipStore.getState();
  const clip = clipsState.getClipById(clipId);
  const isVideo = clip?.type === "video";
  const isSeparated = (() => {
    if (!clip || clip.type !== "video") return false;
    try {
      const asset = clipsState.getAssetById(clip.assetId);
      if (!asset) return false;
      const url = new URL(asset.path);
      if ((url.hash || "").replace("#", "") === "video") return true;
      const audioURL = new URL(asset.path);
      audioURL.hash = "audio";
      return (clipsState.clips || []).some(
        (c) => c.type === "audio" && c.assetId === asset.id,
      );
    } catch {
      return false;
    }
  })();
  const targetIds = (controls.selectedClipIds || []).includes(clipId)
    ? controls.selectedClipIds
    : [clipId];
  const isGroup = clip?.type === "group";
  // A compound clip has no media of its own: the tools that read a file's frames or sound skip it.
  const compoundClip = isCompound(clip);

  const otherCommands: ContextMenuItem[] = [];

  // Group (⌘G) sticks the selected clips together, each on its own track; on a group, Ungroup (⌘⇧G).
  const inGroup = targetIds.some((id) => !!clipsState.getClipById(id)?.bundleId);
  otherCommands.push(
    inGroup
      ? { id: "ungroup", label: "Ungroup", action: "ungroup", shortcut: "⌘⇧G" }
      : { id: "group", label: "Group", action: "group", disabled: !canGroup(clipsState.clips, targetIds), shortcut: "⌘G" },
  );

  // Create compound clip (⌥G) from the selection, and (on a compound) Undo compound clip
  // (⌥⇧G) and Open compound clip, after Group as CapCut orders them.
  otherCommands.push({
    id: "create-compound",
    label: "Create compound clip (subproject)",
    action: "custom",
    shortcut: "⌥G",
    run: () => {
      useClipStore.getState().createCompound(targetIds);
    },
  });
  if (compoundClip) {
    otherCommands.push({
      id: "undo-compound",
      label: "Undo compound clip (subproject)",
      action: "custom",
      shortcut: "⌥⇧G",
      disabled: targetIds.length !== 1,
      run: () => {
        useClipStore.getState().breakApartCompound(clipId);
      },
    });
    otherCommands.push({
      id: "open-compound",
      label: "Open compound clip",
      action: "custom",
      disabled: targetIds.length !== 1,
      run: () => void openCompound(clipId),
    });
    // Render the compound's span (CapCut's Pre-process compound clip).
    otherCommands.push({
      id: "preprocess-compound",
      label: "Pre-process compound clip",
      action: "custom",
      disabled: targetIds.length !== 1,
      run: () => void renderTimeline({ start: clip?.startFrame ?? 0, end: clip?.endFrame ?? 0 }),
    });
  }

  // CapCut's Edit ›: Freeze (at the playhead, when it's on the clip) and Reverse on a video;
  // Mirror, Rotate and Crop on a video or photo.
  const editTools: ContextMenuItem[] = [];
  const visuals = targetIds.map((id) => clipsState.getClipById(id)).filter((c): c is AnyClipProps => !!c && (c.type === "video" || c.type === "image") && !isCompound(c));
  if (visuals.length > 0 && !compoundClip) {
    const single = targetIds.length === 1;
    const video = clip?.type === "video" && single && !(clip as VideoClipProps).freeze;
    const children: ContextMenuItem[] = [];
    if (video) {
      const canFreeze = !!freezeTarget(clipsState.clips, clipsState.timelines, controls.focusFrame, [clip!.clipId]);
      children.push({ id: "freeze", label: "Freeze", action: "freeze", disabled: !canFreeze, checked: false });
      // A toggle: ticked while the clip plays backward.
      children.push({ id: "reverse", label: "Reverse", action: "reverse", checked: !!(clip as VideoClipProps).reverse });
    }
    children.push(
      {
        id: "mirror",
        label: "Mirror",
        action: "custom",
        run: () => visuals.forEach((v) => useClipStore.getState().updateClip(v.clipId, toggleFlip(v, "horizontal"))),
      },
      {
        id: "rotate",
        label: "Rotate",
        action: "custom",
        run: () => visuals.forEach((v) => useClipStore.getState().updateClip(v.clipId, rotate90(v, 1))),
      },
      {
        id: "crop",
        label: "Crop",
        action: "custom",
        disabled: !single,
        run: () => {
          useControlsStore.getState().setSelectedClipIds([visuals[0].clipId]);
          window.dispatchEvent(new CustomEvent(OPEN_CROP_EVENT));
        },
      },
    );
    editTools.push({ id: "edit", label: "Edit", action: "none", children });
  }

  const clipActions: ContextMenuItem[] = [
    ...editTools,
    // Split scenes, Enhance visuals, Adjust color ▸ (lib/analysis.ts) and Enhance motion
    // (lib/enhance.ts), in CapCut's order.
    ...(compoundClip ? [] : withEnhance(analysisMenuItems(clip, targetIds.length), enhanceMenuItems(targetIds))),
    // Generate captions: the Auto captions panel for this clip (lib/autocaptions.ts).
    ...(compoundClip ? [] : captionMenuItems(clip, targetIds.length)),
    // Transcript: the clip's words to edit the video by (lib/transcript.ts); a compound has no file of its own.
    ...(compoundClip ? [] : transcriptMenuItems(clip, targetIds.length)),
    {
      id: "split",
      label: "Split at Playhead",
      action: "split",
      disabled: isGroup,
    },
    {
      id: "separate",
      label: "Detach Audio",
      action: "separateAudio",
      disabled: !isVideo || isSeparated || compoundClip,
    },
  ];
  // A video and its detached audio are linked; Unlink lets them go their own ways, Link
  // ties clips together again.
  const anyLinked = targetIds.some((id) => !!clipsState.getClipById(id)?.linkId);
  clipActions.push(
    anyLinked
      ? { id: "unlink", label: "Unlink", action: "unlink" }
      : { id: "link", label: "Link", action: "link", disabled: targetIds.length < 2 || isGroup },
  );

  // CapCut's Deactivate clip (V): greyed and left out of the picture, the sound and the export.
  const allOff = targetIds.every((id) => !!clipsState.getClipById(id)?.deactivated);
  clipActions.push({
    id: "deactivate",
    label: allOff ? "Activate clip" : "Deactivate clip",
    action: "custom",
    shortcut: "V",
    disabled: isGroup,
    run: () => useClipStore.getState().setClipsDeactivated(targetIds),
  });
  // More clip actions ▸ Replace clip, Trim clip, Open file location.
  if (targetIds.length === 1 && canReplaceClip(clip)) {
    clipActions.push({
      id: "more-actions",
      label: "More clip actions",
      action: "none",
      children: [
        { id: "replace-clip", label: "Replace clip", action: "custom", run: () => void replaceClip(clip.clipId) },
        { id: "trim-clip", label: "Trim clip", action: "custom", disabled: !canTrimClip(clip), run: () => useTrimClip.getState().open(clip.clipId) },
        { id: "open-file-location", label: "Open file location", action: "custom", run: () => void revealClipFile(clip.clipId) },
      ],
    });
  }
  // A sticker's Mirror, after Save preset as CapCut orders it.
  const stickers = targetIds.map((id) => clipsState.getClipById(id)).filter((c): c is AnyClipProps => c?.type === "sticker");
  const mirrorItems: ContextMenuItem[] =
    stickers.length > 0
      ? [
          {
            id: "mirror-sticker",
            label: "Mirror",
            action: "custom",
            run: () => stickers.forEach((v) => useClipStore.getState().updateClip(v.clipId, toggleFlip(v, "horizontal"))),
          },
        ]
      : [];
  // Range ›: Select by clip (⇧X) makes the selection's span the range; Deselect clears it.
  const range = useControlsStore.getState().range;
  const rangeItems: ContextMenuItem[] = [
    {
      id: "range",
      label: "Range",
      action: "none",
      children: [
        { id: "range-select", label: "Select by clip", action: "custom", shortcut: "⇧X", run: () => rangeByClip(targetIds) },
        { id: "range-deselect", label: "Deselect", action: "custom", disabled: !range, run: () => useControlsStore.getState().setRange(null) },
        ...(range ? [{ id: "range-export", label: "Export range", action: "custom" as const, run: () => openRangeExport() }] : []),
      ],
    },
  ];
  // Render ›: pre-render the timeline (lib/prerender.ts). In and Out need a range.
  const renderItems: ContextMenuItem[] = [
    {
      id: "render",
      label: "Render",
      action: "none",
      children: [
        { id: "render-whole", label: "Whole timeline", action: "custom", run: () => void renderTimeline("whole") },
        { id: "render-in", label: "In", action: "custom", disabled: !range, run: () => void renderTimeline("in") },
        { id: "render-out", label: "Out", action: "custom", disabled: !range, run: () => void renderTimeline("out") },
        { id: "render-delete", label: "Delete rendering cache", action: "custom", separatorBefore: true, run: () => void deleteRenderingCache() },
      ],
    },
  ];
  // Copy/paste attributes and Save preset (lib/clip-presets.ts).
  const attributeItems = attributeMenuItems(clip, targetIds);
  // Save preset after Group, as CapCut orders them, then Export selected clips: the selected
  // video, photo and audio clips as one file.
  otherCommands.push(attributeItems.preset);
  const exportable = targetIds.filter((id) => {
    const c = clipsState.getClipById(id);
    return c?.type === "video" || c?.type === "image" || (c?.type === "audio" && !!c.assetId);
  });
  if (exportable.length > 0) otherCommands.push({ id: "export", label: "Export selected clips", action: "export" });

  // A compound clip's menu is CapCut's own (28-inspector-compound/003), without its AI and
  // cloud rows: the sound rows read the compound's mix; the ones that read a media file
  // (Enhance audio, Enhance visuals, Adjust color, Enhance motion) read the file the
  // compound is rendered to on first use.
  if (compoundClip && targetIds.length === 1 && clip) {
    const id = clip.clipId;
    const separated = !!(clip as VideoClipProps).audioSeparated;
    const edit: ContextMenuItem = {
      id: "edit",
      label: "Edit",
      action: "none",
      children: [
        { id: "mirror", label: "Mirror", action: "custom", run: () => useClipStore.getState().updateClip(id, toggleFlip(clip, "horizontal")) },
        { id: "rotate", label: "Rotate", action: "custom", run: () => useClipStore.getState().updateClip(id, rotate90(clip, 1)) },
        {
          id: "crop",
          label: "Crop",
          action: "custom",
          run: () => {
            useControlsStore.getState().setSelectedClipIds([id]);
            window.dispatchEvent(new CustomEvent(OPEN_CROP_EVENT));
          },
        },
      ],
    };
    const busy = useAutoCaptions.getState().phase !== "idle";
    useContextMenuStore.getState().openMenu({
      position: { x: clientX, y: clientY },
      target: { type: "clip", clipIds: targetIds, primaryClipId: clipId, isVideo: true },
      groups: [
        {
          id: "edit",
          items: [
            { id: "copy", label: "Copy", action: "copy", shortcut: "⌘C" },
            { id: "cut", label: "Cut", action: "cut", shortcut: "⌘X" },
            attributeItems.attributes,
            { id: "delete", label: "Delete", action: "delete", shortcut: "Del" },
            edit,
          ],
        },
        {
          id: "sound",
          items: [
            { id: "transcript", label: "Transcript", action: "custom", disabled: separated, run: () => void openCompoundTranscript(id) },
            { id: "generate-captions", label: "Generate captions", action: "generateCaptions", disabled: busy || separated },
            { id: "extract-audio", label: "Extract audio", action: "custom", shortcut: "⌃⇧S", disabled: separated, run: () => void extractCompoundAudio(id) },
          ],
        },
        // These read a media file: a compound is rendered to one on first use (lib/compound-render.ts).
        {
          id: "enhance",
          items: [
            ...soundMenuItems(clip).map((i) => ({ ...i, disabled: separated })),
            ...enhanceMenuItems([id]).visuals,
            ...analysisMenuItems(clip, 1).filter((i) => i.id === "adjust-color"),
            ...enhanceMenuItems([id]).motion,
          ],
        },
        {
          id: "compound",
          items: [
            { id: "group", label: "Group", action: "group", disabled: true, shortcut: "⌘G" },
            { id: "create-compound", label: "Create compound clip (subproject)", action: "custom", shortcut: "⌥G", run: () => void useClipStore.getState().createCompound(targetIds) },
            { id: "undo-compound", label: "Undo compound clip (subproject)", action: "custom", shortcut: "⌥⇧G", run: () => void useClipStore.getState().breakApartCompound(id) },
            { id: "preprocess-compound", label: "Pre-process compound clip (subproject)", action: "custom", run: () => void renderTimeline({ start: clip.startFrame ?? 0, end: clip.endFrame ?? 0 }) },
            attributeItems.preset,
          ],
        },
        {
          id: "clip-actions",
          items: [
            { id: "export", label: "Export selected clips", action: "export" },
            {
              id: "deactivate",
              label: clip.deactivated ? "Activate clip" : "Deactivate clip",
              action: "custom",
              shortcut: "V",
              run: () => useClipStore.getState().setClipsDeactivated(targetIds),
            },
            {
              id: "more-actions",
              label: "More clip actions",
              action: "none",
              children: [
                { id: "open-compound", label: "Open compound clip", action: "custom", run: () => void openCompound(id) },
                { id: "replace-clip", label: "Replace clip", action: "custom", disabled: true },
              ],
            },
          ],
        },
        { id: "range", items: rangeItems },
        { id: "render", items: renderItems },
      ],
    });
    return;
  }

  useContextMenuStore.getState().openMenu({
    position: { x: clientX, y: clientY },
    target: {
      type: "clip",
      clipIds: targetIds,
      primaryClipId: clipId,
      isVideo: !!isVideo,
    },
    groups: [
      {
        id: "edit",
        items: [
          { id: "copy", label: "Copy", action: "copy", shortcut: "⌘C" },
          { id: "cut", label: "Cut", action: "cut", shortcut: "⌘X" },
          { id: "paste", label: "Paste", action: "paste", shortcut: "⌘V" },
          attributeItems.attributes,
          {
            id: "delete",
            label: "Delete",
            action: "delete",
            shortcut: "Del",
          },
        ],
      },
      {
        id: "clip-actions",
        items: [...clipActions],
      },
      // Beats and loudness on a clip with sound (lib/audio-tools.ts).
      { id: "audio", items: compoundClip ? [] : soundMenuItems(clip) },
      {
        id: "other",
        items: [...otherCommands],
      },
      { id: "mirror", items: mirrorItems },
      { id: "range", items: rangeItems },
      // CapCut's sticker menu ends at Range (25-sticker-context-menu): no Render there.
      { id: "render", items: stickers.length > 0 ? [] : renderItems },
    ],
  });
}

/**
 * A double click on a clip: a compound opens its own timeline, and a text template's group
 * opens its words (the Text template tab).
 */
export function doubleClickClip(clipId: string, assetMode = false) {
  const clip = useClipStore.getState().getClipById(clipId);
  if (!assetMode && isCompound(clip)) {
    void openCompound(clipId);
    return;
  }
  if (clip?.type !== "group" || !(clip as { template?: unknown }).template) return;
  useControlsStore.getState().setSelectedClipIds([clipId]);
  void import("@/lib/inspector").then((m) => m.useInspectorStore.getState().setTab("template"));
}
