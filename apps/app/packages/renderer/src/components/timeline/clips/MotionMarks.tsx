import React from "react";
import { Arrow, Group, Line, Rect, Text } from "react-konva";
import { useControlsStore } from "@/lib/control";
import { useInspectorStore } from "@/lib/inspector";
import { hasCurve } from "@/lib/speed";
import type { AnyClipProps, ClipAnimation, VideoClipProps } from "@/lib/types";

const BADGE_W = 46;

/**
 * What a clip's bar says about its motion, as CapCut draws it: a thin white line with an
 * arrowhead along its bottom as long as its In animation (from the start) or its Out (to the
 * end), a dashed one across it for a Combo or Loop; and on the selected video or sound its
 * speed at the top right ("1.00x ▸", "Curve ▸"), which opens the Speed tab.
 */
const MotionMarks: React.FC<{ clip: AnyClipProps | undefined; width: number; height: number; selected: boolean }> = ({ clip, width, height, selected }) => {
  const fps = useControlsStore((s) => s.fps) || 30;
  if (!clip) return null;
  const c = clip as VideoClipProps & { animationLoop?: ClipAnimation | null };
  const len = Math.max(1, (clip.endFrame ?? 0) - (clip.startFrame ?? 0));
  const px = (seconds: number) => Math.min(width - 4, Math.max(6, (seconds * fps * width) / len));
  const y = height - 3;
  const timed = (clip.type === "video" || clip.type === "audio") && !c.freeze;
  const label = hasCurve(clip) ? "Curve ▸" : `${Number(c.speed || 1).toFixed(2)}x ▸`;
  return (
    <Group listening={selected && timed}>
      {c.animationIn && <Arrow points={[2, y, 2 + px(c.animationIn.duration), y]} stroke="#ffffff" fill="#ffffff" strokeWidth={1} pointerLength={3.5} pointerWidth={4} listening={false} />}
      {c.animationOut && <Arrow points={[width - 2, y, width - 2 - px(c.animationOut.duration), y]} stroke="#ffffff" fill="#ffffff" strokeWidth={1} pointerLength={3.5} pointerWidth={4} listening={false} />}
      {(c.animationCombo || c.animationLoop) && <Line points={[2, y, width - 2, y]} stroke="#ffffff" strokeWidth={1} dash={[3, 3]} opacity={0.8} listening={false} />}
      {selected && timed && width > BADGE_W + 60 && (
        <Group
          x={width - BADGE_W - 4}
          y={3}
          onClick={(e) => {
            e.cancelBubble = true;
            useInspectorStore.getState().setTab("duration");
          }}
          onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = "pointer")}
        >
          <Rect width={BADGE_W} height={14} cornerRadius={3} fill="rgba(0,0,0,0.35)" />
          <Text width={BADGE_W} height={14} text={label} fontSize={10} fontFamily="-apple-system, BlinkMacSystemFont, sans-serif" fill="#e0e0e0" align="center" verticalAlign="middle" />
        </Group>
      )}
    </Group>
  );
};

export default MotionMarks;
