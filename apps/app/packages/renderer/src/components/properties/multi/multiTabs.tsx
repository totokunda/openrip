import React from "react";
import type { AnyClipProps } from "@/lib/types";
import AdjustBasic from "../adjust/AdjustBasic";
import AdjustHsl from "../adjust/AdjustHsl";
import AdjustCurves from "../adjust/AdjustCurves";
import AdjustWheels from "../adjust/AdjustWheels";
import SpeedProperties from "../SpeedProperties";
import MirrorEdits from "./MirrorEdits";
import { MultiBlend, MultiTransform } from "./MultiTransform";

/** A tab of the inspector and the sections it shows as sub-tabs (ClipPropertiesPanel's). */
export interface InspectorSection {
  id: string;
  label: string;
  content: React.ReactNode;
  /** Fills the tab's height and scrolls itself (for a footer pinned at the bottom). */
  own?: boolean;
}
export interface InspectorTab {
  id: string;
  label: string;
  sections: InspectorSection[];
}

const stack = (...parts: React.ReactNode[]) => <div className="min-w-0 divide-y divide-brand-divider">{parts}</div>;

/** The keyframe lists the Adjust tab writes. */
const ADJUST_KEYS = (p: string) => p.startsWith("adjust:") || p.startsWith("hsl:") || p === "wheels:intensity" || p === "lut:intensity";
const SPEED_FIELDS = ["speed", "changePitch", "smoothSlowMo"];
const COLOR_FIELDS = ["color"];

/**
 * The inspector's tabs for several selected clips (CapCut's, docs/plan/capcut-ui-spec.md §6.25).
 * Videos and photos get Video (Transform and Blend, the values they share), Adjust (Basic, HSL,
 * Curves, Color wheel) and, when all are videos, Speed (Standard); the Adjust and Speed panels
 * are the single clip's, editing the last selected clip, and each edit is made on the others
 * too (MirrorEdits). Any other mix gets Properties: Transform and Blend for the clips that have
 * them. What can't apply to several clips cleanly (masks, Remove BG, curves of speed, Auto
 * adjust and Color match, which are made from one clip) is left out.
 */
export const multiTabs = (ids: string[], primary: string, clips: AnyClipProps[]): InspectorTab[] => {
  const chosen = ids.map((id) => clips.find((c) => c.clipId === id)).filter((c): c is AnyClipProps => !!c);
  const media = chosen.length > 0 && chosen.every((c) => c.type === "video" || c.type === "image");
  const videos = media && chosen.every((c) => c.type === "video" && !(c as any).freeze);
  const common = stack(<MultiTransform key="transform" ids={ids} />, <MultiBlend key="blend" ids={ids} />);
  if (!media) {
    const visual = chosen.some((c) => ["video", "image", "text", "sticker", "shape"].includes(c.type));
    return [
      {
        id: "properties",
        label: "Properties",
        sections: [
          {
            id: "basic",
            label: "Basic",
            content: visual ? (
              common
            ) : (
              <p className="px-3 py-6 text-[12px] leading-snug text-[#6c6c6c] text-center" data-testid="multi-note">
                These clips have no properties in common. Select clips of one kind to edit them together.
              </p>
            ),
          },
        ],
      },
    ];
  }
  const mirror = (fields: string[], child: React.ReactNode, keys?: (p: string) => boolean) => (
    <MirrorEdits primaryId={primary} ids={ids} fields={fields} keys={keys}>
      {child}
    </MirrorEdits>
  );
  const adjust = (child: React.ReactNode) => mirror(COLOR_FIELDS, child, ADJUST_KEYS);
  return [
    { id: "video", label: "Video", sections: [{ id: "basic", label: "Basic", content: common }] },
    ...(videos ? [{ id: "duration", label: "Speed", sections: [{ id: "standard", label: "Standard", own: true, content: mirror(SPEED_FIELDS, <SpeedProperties clipId={primary} mode="standard" />) }] }] : []),
    {
      id: "adjust",
      label: "Adjust",
      sections: [
        { id: "basic", label: "Basic", content: adjust(<AdjustBasic clipId={primary} />) },
        { id: "hsl", label: "HSL", content: adjust(<AdjustHsl clipId={primary} />) },
        { id: "curves", label: "Curves", content: adjust(<AdjustCurves clipId={primary} />) },
        { id: "wheels", label: "Color wheel", content: adjust(<AdjustWheels clipId={primary} />) },
      ],
    },
  ];
};
