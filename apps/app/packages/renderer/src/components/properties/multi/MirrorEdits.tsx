import React, { useEffect } from "react";
import { useClipStore } from "@/lib/clip";
import { isRestoring } from "@/lib/history";
import { applyKeys, applyLeaves, keyDiff, leafDiff } from "@/lib/multi-edit";
import type { AnyClipProps } from "@/lib/types";

/**
 * Lets a single clip's panel edit several clips: the panel (inside) edits the last selected
 * clip, and what each edit changes in `fields` (leaf by leaf, so the others keep the rest of
 * their own values) and in the keyframe lists `keys` takes is made on the other selected clips
 * too, in the same step. An undo puts every clip back at once and isn't followed.
 */
const MirrorEdits: React.FC<{
  primaryId: string;
  ids: string[];
  fields: string[];
  keys?: (property: string) => boolean;
  children: React.ReactNode;
}> = ({ primaryId, ids, fields, keys, children }) => {
  const others = ids.filter((id) => id !== primaryId).join("|");
  const field = fields.join("|");
  useEffect(() => {
    const follow = others ? others.split("|") : [];
    if (!follow.length) return;
    return useClipStore.subscribe((state, prev) => {
      if (isRestoring() || state.clips === prev.clips) return;
      const before = prev.clips.find((c) => c.clipId === primaryId) as Record<string, any> | undefined;
      const after = state.clips.find((c) => c.clipId === primaryId) as Record<string, any> | undefined;
      if (!before || !after || before === after) return;
      const patches = new Map<string, Record<string, unknown>>();
      for (const id of follow) {
        const patch: Record<string, unknown> = {};
        for (const f of fields) {
          const leaves = leafDiff(before[f], after[f]);
          if (leaves.length) patch[f] = leaves;
        }
        const changes = keys ? keyDiff(before.keyframes, after.keyframes, keys) : {};
        if (Object.keys(changes).length) patch.keyframes = changes;
        if (Object.keys(patch).length) patches.set(id, patch);
      }
      // Each one as it is when its turn comes (an edit before it may have moved the clips).
      for (const [id, patch] of patches) {
        const mine = useClipStore.getState().clips.find((c) => c.clipId === id) as Record<string, any> | undefined;
        if (!mine) continue;
        const next: Record<string, unknown> = {};
        for (const [f, v] of Object.entries(patch)) next[f] = f === "keyframes" ? applyKeys(mine.keyframes, v as any) : applyLeaves(mine[f], v as any);
        useClipStore.getState().updateClip(id, next as Partial<AnyClipProps>);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryId, others, field, keys]);
  return <>{children}</>;
};

export default MirrorEdits;
