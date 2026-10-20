// The project's timelines at work (File ▸ New timeline; see lib/project-timelines.ts): making,
// switching, renaming, duplicating and deleting them, and reading one for the export. The
// timeline being edited is in the clip store as always; switching parks it in the list and
// brings the other in, the way opening a compound does (lib/compound-edit.ts): the player, the
// inspector and the engine follow the stores. Undo is per timeline (history.ts swapHistory).
import { v4 as uuidv4 } from "uuid";
import { toast } from "sonner";
import { useClipStore } from "./clip";
import { useControlsStore } from "./control";
import { closeAllCompounds } from "./compound-edit";
import { foldStack } from "./compound";
import { forgetTimelineHistory, swapHistory } from "./history";
import {
  afterDelete,
  cloneTimelineContent,
  emptyContent,
  nextTimelineName,
  park,
  renameIn,
  take,
  uniqueName,
  type ProjectTimeline,
  type TimelineContent,
} from "./project-timelines";

/** What the editor shows now as a timeline's content, compounds closed (call after `closeAllCompounds`). */
const captureActive = (): TimelineContent => {
  const s = useClipStore.getState();
  const c = useControlsStore.getState();
  return {
    clips: s.clips,
    timelines: s.timelines,
    markers: s.markers,
    magnet: s.magnet,
    clipDuration: s.clipDuration,
    playhead: c.focusFrame,
    view: { total: c.totalTimelineFrames, window: [...c.timelineDuration] as [number, number], zoom: c.zoomLevel as number },
  };
};

const parkActive = park;

/** Make `id` the timeline being edited, `list` (parked timelines with content, the one being left included) the project's. */
const activate = (list: ProjectTimeline[], from: string, id: string, forget: string[] = []) => {
  const { list: parked, content } = take(list, id);
  const controls = useControlsStore.getState();
  if (controls.isPlaying) controls.pause();
  swapHistory(
    from,
    id,
    () => {
      useClipStore.setState({
        clips: content.clips,
        timelines: content.timelines,
        markers: content.markers,
        magnet: content.magnet,
        clipDuration: content.clipDuration,
        projectTimelines: parked,
        activeTimelineId: id,
        compoundStack: [],
        mainPreview: null,
      });
      useControlsStore.setState({
        totalTimelineFrames: content.view.total,
        timelineDuration: content.view.window,
        zoomLevel: content.view.zoom as any,
        selectedClipIds: [],
        selectedMaskId: null,
        selectedMarkerId: null,
        range: null,
      });
      useControlsStore.getState().setFocusFrame(content.playhead, false);
    },
    forget,
  );
};

/** Edit another of the project's timelines. False when it is the one being edited or doesn't exist. */
export function switchTimeline(id: string): boolean {
  const s = useClipStore.getState();
  if (id === s.activeTimelineId || !s.projectTimelines.some((t) => t.id === id)) return false;
  closeAllCompounds();
  const from = useClipStore.getState().activeTimelineId;
  activate(parkActive(useClipStore.getState().projectTimelines, from, captureActive()), from, id);
  return true;
}

/** File ▸ New timeline: an empty timeline, named "Timeline 02", … , opened for editing. Returns its id. */
export function createTimeline(name?: string): string {
  closeAllCompounds();
  const s = useClipStore.getState();
  const id = uuidv4();
  const entry: ProjectTimeline = { id, name: uniqueName(name?.trim() || nextTimelineName(s.projectTimelines.map((t) => t.name)), s.projectTimelines.map((t) => t.name)), content: emptyContent() };
  // The new one goes at the end of the list.
  const list = [...parkActive(s.projectTimelines, s.activeTimelineId, captureActive()), entry];
  activate(list, s.activeTimelineId, id);
  return id;
}

/** A copy of a timeline (its clips, tracks and markers with fresh ids), named "<name> copy" and opened for editing. Returns its id. */
export function duplicateTimeline(id?: string): string | null {
  closeAllCompounds();
  const s = useClipStore.getState();
  const source = id ?? s.activeTimelineId;
  const parked = parkActive(s.projectTimelines, s.activeTimelineId, captureActive());
  const at = parked.findIndex((t) => t.id === source);
  if (at < 0) return null;
  const copyId = uuidv4();
  const entry: ProjectTimeline = {
    id: copyId,
    name: uniqueName(`${parked[at].name} copy`, parked.map((t) => t.name)),
    content: cloneTimelineContent(parked[at].content!, uuidv4),
  };
  activate([...parked.slice(0, at + 1), entry, ...parked.slice(at + 1)], s.activeTimelineId, copyId);
  return copyId;
}

/** Rename a timeline (the one being edited by default). */
export function renameTimeline(id: string, name: string) {
  const { projectTimelines } = useClipStore.getState();
  const next = renameIn(projectTimelines, id, name);
  if (next !== projectTimelines) useClipStore.setState({ projectTimelines: next });
}

/** Delete a timeline; the project keeps at least one. Deleting the one being edited opens the next. False when refused. */
export function deleteTimeline(id: string): boolean {
  const s = useClipStore.getState();
  if (s.projectTimelines.length < 2 || !s.projectTimelines.some((t) => t.id === id)) return false;
  if (id !== s.activeTimelineId) {
    forgetTimelineHistory(id);
    useClipStore.setState({ projectTimelines: s.projectTimelines.filter((t) => t.id !== id) });
    return true;
  }
  const next = afterDelete(s.projectTimelines, id)!;
  closeAllCompounds();
  const list = s.projectTimelines.filter((t) => t.id !== id);
  activate(list, id, next, [id]);
  return true;
}

/** File ▸ New timeline (and the player's menu): a new timeline, with a short note of where it is. */
export function newTimelineFromMenu(): string {
  const id = createTimeline();
  const name = useClipStore.getState().projectTimelines.find((t) => t.id === id)?.name ?? "";
  toast(`${name} created`, { position: "bottom-right", duration: 2000, style: { width: "fit-content" } });
  return id;
}

/**
 * A timeline's content as the project is saved and exported (compounds as edited so far): the
 * active timeline's from the stores, another's as parked. Null when there's no such timeline.
 */
export function timelineRoot(id?: string): { clips: TimelineContent["clips"]; timelines: TimelineContent["timelines"]; markers: TimelineContent["markers"]; clipDuration: number; magnet: boolean } | null {
  const s = useClipStore.getState();
  const want = id ?? s.activeTimelineId;
  if (want === s.activeTimelineId) {
    const root = foldStack(s.compoundStack, s.clips, s.timelines);
    return { ...root, markers: s.markers, clipDuration: s.compoundStack[0]?.clipDuration ?? s.clipDuration, magnet: s.magnet };
  }
  const c = s.projectTimelines.find((t) => t.id === want)?.content;
  return c ? { clips: c.clips, timelines: c.timelines, markers: c.markers, clipDuration: c.clipDuration, magnet: c.magnet } : null;
}
