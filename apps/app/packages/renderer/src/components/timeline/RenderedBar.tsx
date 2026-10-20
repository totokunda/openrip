import React from "react";
import { Group, Rect } from "react-konva";
import { useControlsStore } from "@/lib/control";
import { useRenderStore } from "@/lib/prerender";
import { RULER_HEIGHT } from "@/lib/timeline-geometry";

/** The thin bar along the ruler's foot over the parts of the timeline that are rendered (lib/prerender.ts); an edit takes its part off. */
const RenderedBar: React.FC<{ stageWidth: number; startPadding: number }> = ({ stageWidth, startPadding }) => {
  const ranges = useRenderStore((s) => s.ranges);
  const [start, end] = useControlsStore((s) => s.timelineDuration);
  if (ranges.length === 0) return null;
  const span = Math.max(1, end - start);
  const xOf = (f: number) => startPadding + ((f - start) / span) * stageWidth;
  const [left, right] = [startPadding, startPadding + stageWidth];
  return (
    <Group name="timeline-rendered" listening={false}>
      {ranges.map((r) => {
        const x0 = Math.max(left, xOf(r.start));
        const x1 = Math.min(right, xOf(r.end));
        return x1 > x0 ? <Rect key={`${r.start}-${r.end}`} name="rendered-range" x={x0} y={RULER_HEIGHT - 3} width={x1 - x0} height={3} fill="#5aa0e6" /> : null;
      })}
    </Group>
  );
};

export default RenderedBar;
